import { GameApiError } from './api.js';

export const SOCIAL_PROVIDERS = Object.freeze([
  Object.freeze({id:'kakao',name:'카카오'}),
  Object.freeze({id:'google',name:'Google'}),
  Object.freeze({id:'naver',name:'네이버'}),
]);
const PROVIDER_IDS = new Set(SOCIAL_PROVIDERS.map(provider=>provider.id));
const AUTH_PATHS = Object.freeze({
  kakao:'https://kauth.kakao.com/oauth/authorize',
  google:'https://accounts.google.com/o/oauth2/v2/auth',
  naver:'https://nid.naver.com/oauth2/authorize',
});
export const SITES_SIGN_IN = '/signin-with-chatgpt?return_to=%2F';

export function providerName(id){return SOCIAL_PROVIDERS.find(provider=>provider.id===id)?.name||(id==='chatgpt'?'ChatGPT':'로그인 계정');}

/** Keep display metadata separate from game records; never accept an account ID from this API. */
export function normalizeAuthStatus(payload){
  if(!payload||typeof payload.authenticated!=='boolean'||!Array.isArray(payload.providers))
    throw new GameApiError('로그인 연결 상태를 확인하지 못했어요.',{code:'INVALID_AUTH_STATUS'});
  const account=payload.authenticated&&payload.account&&typeof payload.account==='object'?{
    provider:PROVIDER_IDS.has(payload.account.provider)||payload.account.provider==='chatgpt'?payload.account.provider:null,
    linkedProviders:[...new Set((Array.isArray(payload.account.linkedProviders)?payload.account.linkedProviders:[])
      .filter(id=>PROVIDER_IDS.has(id)||id==='chatgpt'))],
  }:null;
  const suppliedReauth=payload.reauthentication;
  const context=payload.authenticated&&typeof suppliedReauth?.accountContext==='string'&&/^[a-f0-9]{64}$/.test(suppliedReauth.accountContext)?suppliedReauth.accountContext:null;
  const playerId=payload.authenticated&&typeof suppliedReauth?.playerId==='string'&&suppliedReauth.playerId.length>0&&suppliedReauth.playerId.length<=200&&!/[\u0000-\u001f\u007f]/.test(suppliedReauth.playerId)?suppliedReauth.playerId:null;
  const reauthProviders=SOCIAL_PROVIDERS.map(provider=>({...provider,
    enabled:provider.id!=='google'&&!!context&&!!playerId&&suppliedReauth?.enabled===true&&account?.linkedProviders.includes(provider.id)===true&&
      Array.isArray(suppliedReauth.providers)&&suppliedReauth.providers.some(item=>item?.id===provider.id&&item.enabled===true),
  }));
  return {
    authenticated:payload.authenticated,account,
    reauthentication:{enabled:reauthProviders.some(provider=>provider.enabled),accountContext:context,playerId,providers:reauthProviders},
    sites:{enabled:payload.sites?.enabled===true},
    providers:SOCIAL_PROVIDERS.map(provider=>{
      const supplied=payload.providers.find(candidate=>candidate?.id===provider.id);
      return {...provider,enabled:supplied?.enabled===true,reason:supplied?.enabled===true?'ready':'not_configured'};
    }),
    registration:{open:payload.registration?.open===true},
  };
}

function validReauthenticationParameters(url,provider){
  if(url.searchParams.getAll('max_age').length!==1||url.searchParams.get('max_age')!=='0')return false;
  if(provider==='kakao')return url.searchParams.getAll('prompt').length===1&&url.searchParams.get('prompt')==='login'&&!url.searchParams.has('auth_type');
  if(provider==='naver')return url.searchParams.getAll('auth_type').length===1&&url.searchParams.get('auth_type')==='reauthenticate'&&!url.searchParams.has('prompt');
  return false; // Google does not support forcing Google Account reauthentication.
}

/** Only fixed provider authorize endpoints, never an arbitrary URL supplied to navigation. */
export function validateLoginDestination(raw,provider,intent='login'){
  if(provider==='chatgpt'){
    if(raw===SITES_SIGN_IN)return raw;
  }else if(PROVIDER_IDS.has(provider)&&typeof raw==='string'){
    try{
      const url=new URL(raw),expected=new URL(AUTH_PATHS[provider]);
      if(url.protocol==='https:'&&url.origin===expected.origin&&url.pathname===expected.pathname&&
        !url.username&&!url.password&&!url.hash&&url.searchParams.get('response_type')==='code'&&
        url.searchParams.get('state')&&url.searchParams.get('nonce')&&
        url.searchParams.get('code_challenge_method')==='S256'&&url.searchParams.get('code_challenge')&&
        (intent!=='reauth'||validReauthenticationParameters(url,provider)))return url.href;
    }catch{}
  }
  throw new GameApiError('로그인 이동 주소를 확인하지 못했어요. 다시 시도해 주세요.',{code:'INVALID_AUTH_REDIRECT',retryable:false});
}

export function callbackNotice(search=''){
  const params=new URLSearchParams(search);
  if(params.get('auth')==='reauthenticated')return {kind:'info',text:'본인 확인 응답을 받았어요. 현재 계정의 정보 관리 권한을 다시 확인할게요.'};
  if(params.get('auth')==='linked')return {kind:'success',text:'로그인 수단을 연결했어요. 같은 친구와 기록으로 이어서 만나요.'};
  if(params.get('auth')==='success')return {kind:'success',text:'로그인했어요. 나의 기록을 이어서 만나요.'};
  if(!params.has('auth_error'))return null;
  const messages={
    ACCESS_DENIED:'로그인을 취소했거나 동의가 완료되지 않았어요. 원할 때 다시 시작해 주세요.',
    PROVIDER_DENIED:'로그인을 취소했거나 동의가 완료되지 않았어요. 원할 때 다시 시작해 주세요.',
    SIGNUP_CLOSED:'새 계정 가입은 아직 준비 중이에요. 이미 연결한 로그인 수단으로 이용해 주세요.',
    REGISTRATION_CLOSED:'새 계정 가입은 아직 준비 중이에요. 이미 연결한 로그인 수단으로 이용해 주세요.',
    IDENTITY_ALREADY_LINKED:'이 로그인은 다른 게임 계정에 연결되어 있어요. 기록을 자동으로 합치지 않았어요.',
    ACCOUNT_ALREADY_LINKED:'이 로그인은 다른 게임 계정에 연결되어 있어요. 기록을 자동으로 합치지 않았어요.',
    STATE_INVALID:'로그인 요청이 만료되었거나 다른 창에서 바뀌었어요. 이 화면에서 다시 시작해 주세요.',
    INVALID_STATE:'로그인 요청이 만료되었거나 다른 창에서 바뀌었어요. 이 화면에서 다시 시작해 주세요.',
    LINK_SESSION_CHANGED:'로그인 중 계정이 바뀌었어요. 현재 계정을 확인하고 다시 연결해 주세요.',
    NOT_CONFIGURED:'이 로그인은 연결 준비 중이에요. 잠시 후 다시 확인해 주세요.',
    PROVIDER_NOT_CONFIGURED:'이 로그인은 연결 준비 중이에요. 잠시 후 다시 확인해 주세요.',
    PROVIDER_DISABLED:'이 로그인은 연결 준비 중이에요. 잠시 후 다시 확인해 주세요.',
    ACCOUNT_CONFLICT:'이 로그인은 다른 게임 계정에 연결되어 있어요. 기록을 자동으로 합치지 않았어요.',
    ACCOUNT_CHANGED:'로그인 중 계정이 바뀌었어요. 현재 계정을 확인하고 다시 연결해 주세요.',
    PROVIDER_UNAVAILABLE:'로그인 서비스와 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
    TOO_MANY_REQUESTS:'로그인 요청이 잠시 몰렸어요. 잠시 후 다시 시도해 주세요.',
  };
  return {kind:'error',text:messages[String(params.get('auth_error')).toUpperCase()]||'로그인을 마치지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.'};
}

export function createAuthApi({fetcher=(...args)=>fetch(...args),timeoutMs=12000,monotonic=()=>performance.now()}={}){
  const controllers=new Set();let retryUntil=0,destroyed=false,generation=0,statusSequence=0,currentReauth=null;
  const retryIn=()=>Math.max(0,Math.ceil((retryUntil-monotonic())/1000));
  function invalidated(){return new GameApiError('로그인 요청이 바뀌었어요. 현재 화면에서 다시 확인해 주세요.',{code:'STALE_AUTH_RESPONSE',retryable:false});}
  function cancelPending(){generation++;statusSequence++;currentReauth=null;for(const controller of controllers)controller.abort();controllers.clear();}
  async function request(path,body,context){
    if(destroyed)throw invalidated();
    const epoch=generation;
    if(retryIn())throw new GameApiError(`${retryIn()}초 뒤에 로그인을 다시 시도해 주세요.`,{code:'RATE_LIMITED',status:429,retryAfter:retryIn()});
    const controller=new AbortController();controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetcher('/api/auth/'+path,{
        method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(context?{'X-Haru-Account':context}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal,
      });
      if(destroyed||epoch!==generation||controller.signal.aborted)throw invalidated();
      let payload;try{payload=await response.json();}catch{throw new GameApiError('로그인 응답을 확인하지 못했어요. 다시 시도해 주세요.',{code:'INVALID_AUTH_RESPONSE'});}
      if(destroyed||epoch!==generation||controller.signal.aborted)throw invalidated();
      const retryAfter=Math.max(0,Number(response.headers.get('Retry-After'))||0);
      if(response.status===429)retryUntil=monotonic()+Math.max(1,retryAfter)*1000;
      if(!response.ok)throw new GameApiError(typeof payload?.message==='string'?payload.message:'로그인을 처리하지 못했어요.',{
        status:response.status,code:payload?.code||'AUTH_FAILED',retryable:response.status>=500||response.status===429,retryAfter,
      });
      return payload;
    }catch(error){
      if(error instanceof GameApiError)throw error;
      throw new GameApiError(error?.name==='AbortError'?'로그인 연결이 지연되고 있어요. 다시 시도해 주세요.':'로그인 서버와 연결하지 못했어요. 잠시 후 다시 확인해 주세요.',{code:error?.name==='AbortError'?'AUTH_TIMEOUT':'AUTH_NETWORK_ERROR'});
    }finally{clearTimeout(timer);controllers.delete(controller);}
  }
  return {
    retryIn,
    status:async()=>{
      const sequence=++statusSequence;currentReauth=null;
      const status=normalizeAuthStatus(await request('status'));
      if(sequence!==statusSequence||destroyed)throw invalidated();
      currentReauth=status.reauthentication;return status;
    },
    start:async(provider,intent,context)=>{
      if(!PROVIDER_IDS.has(provider)||!['login','link','reauth'].includes(intent))throw new GameApiError('로그인 방식을 다시 선택해 주세요.',{code:'INVALID_AUTH_ACTION',retryable:false});
      const reauth=currentReauth;
      if(intent==='reauth'&&(!reauth?.enabled||context!==reauth.accountContext||!/^[a-f0-9]{64}$/.test(context||'')||!reauth.providers.some(item=>item.id===provider&&item.enabled)))
        throw new GameApiError('현재 계정의 본인 확인 연결을 먼저 확인해 주세요.',{code:'REAUTH_NOT_READY',retryable:false});
      const response=await request(provider+'/start',{intent},intent==='reauth'?context:undefined);
      if(intent==='reauth'&&(reauth!==currentReauth||context!==currentReauth?.accountContext))throw invalidated();
      return validateLoginDestination(response.url,provider,intent);
    },
    sitesStart:async()=>validateLoginDestination((await request('sites-start',{})).url,'chatgpt'),
    logout:()=>{cancelPending();return request('logout',{});},
    cancelPending,
    destroy:()=>{destroyed=true;cancelPending();},
  };
}
