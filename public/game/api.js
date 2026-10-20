/** Same-origin transport. This module never creates game results or changes balances. */
export class GameApiError extends Error {
  constructor(message,{code='NETWORK_ERROR',status=0,retryable=true,retryAfter=0,signInUrl=null}={}) {
    super(message);this.name='GameApiError';
    Object.assign(this,{code,status,retryable,retryAfter,signInUrl});
  }
}

export function createRequestId() {
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  const bytes=new Uint8Array(16);
  if(!globalThis.crypto?.getRandomValues)throw new GameApiError('안전한 연결을 확인한 뒤 다시 열어 주세요.',{code:'CRYPTO_UNAVAILABLE',retryable:false});
  globalThis.crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function createGameApi({fetcher=(...args)=>fetch(...args),monotonic=()=>performance.now(),timeoutMs=20000}={}) {
  let serverEpoch=Date.now(),receivedAt=monotonic(),retryUntil=0,expectedPlayerId=null;
  function now(){return serverEpoch+Math.max(0,monotonic()-receivedAt);}
  function retryIn(){return Math.max(0,Math.ceil((retryUntil-monotonic())/1000));}
  async function request(action,body) {
    if(retryIn())throw new GameApiError(`${retryIn()}초 후 다시 연결할 수 있어요.`,{code:'RATE_LIMITED',status:429,retryAfter:retryIn()});
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await fetcher(`/api/game/${action}`,{
        method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),
          ...((body||action==='export')&&expectedPlayerId?{'X-Haru-Player':expectedPlayerId}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal
      });
      let payload;
      try{payload=await response.json();}
      catch{throw new GameApiError('서버 응답을 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.',{status:response.status,code:'INVALID_RESPONSE'});}
      const retryAfter=Math.max(0,Number(response.headers?.get?.('Retry-After'))||0);
      if(response.status===429)retryUntil=monotonic()+Math.max(1,retryAfter)*1000;
      if(!response.ok)throw new GameApiError(typeof payload?.message==='string'?payload.message:'요청을 처리하지 못했어요.',{
        status:response.status,code:payload?.code||'REQUEST_FAILED',
        retryable:response.status>=500||response.status===408||response.status===429||payload?.code==='BUSY',
        retryAfter,
        signInUrl:payload?.signInUrl
      });
      if(action!=='export') {
        const timestamp=typeof payload?.serverNow==='number'?payload.serverNow:Date.parse(payload?.serverNow);
        if(!payload?.state||!Number.isFinite(timestamp)||!/^\d{4}-\d{2}-\d{2}$/.test(payload?.today||''))
          throw new GameApiError('게임 기록을 불러오지 못했어요. 다시 연결해 주세요.',{code:'INVALID_RESPONSE'});
        serverEpoch=timestamp;receivedAt=monotonic();
        expectedPlayerId=typeof payload.state.playerId==='string'?payload.state.playerId:null;
      }
      return payload;
    } catch(error) {
      if(error instanceof GameApiError)throw error;
      throw new GameApiError(error?.name==='AbortError'?'응답을 기다리는 시간이 길어졌어요. 저장 여부를 같은 요청으로 다시 확인해 주세요.':'연결이 끊어져 처리 결과를 확인하지 못했어요. 연결 후 같은 요청으로 다시 확인해 주세요.',{code:error?.name==='AbortError'?'REQUEST_TIMEOUT':'NETWORK_ERROR'});
    } finally {clearTimeout(timeout);}
  }
  return {now,retryIn,bootstrap:()=>request('bootstrap'),export:()=>request('export'),
    mutate:(action,body)=>request(action,body)};
}
