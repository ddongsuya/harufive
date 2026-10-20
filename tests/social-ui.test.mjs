import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseHarness, reply } from './helpers/release-controller-harness.mjs';
import { auditMarkup } from './helpers/markup-source.mjs';
import { CATALOG, DEFAULT_EQUIPPED } from '../public/game/state.js';
import { normalizeAuthStatus, validateLoginDestination, callbackNotice } from '../public/game/auth.js';

const NOW=Date.parse('2026-10-20T00:00:00Z'),DAY='2026-10-20';
const snapshot=()=>({serverNow:NOW,today:DAY,state:{
  playerId:'public-player-kept',name:'나의비밀토끼',coins:380,owned:CATALOG.filter(item=>item.cost===0).map(item=>item.id),equipped:{...DEFAULT_EQUIPPED},
  results:[],practiceHistory:[],practiceUsage:{},awards:{},active:null,createdAt:DAY,todayFields:['logic','math','spatial','language','memory'],
  totals:{dailyCount:0,questionCount:0,correctCount:0,practiceCount:0},ranking:{week:'2026-10-19',rows:[],me:null,rank:null,total:0,participated:false,correct:0,score:0,totalTimeMs:null},
}});
function authStatus({authenticated=true,enabled=false,linked=[]}={}){
  return {authenticated,sites:{enabled:true},account:authenticated?{provider:'chatgpt',linkedProviders:linked}:null,
    providers:['kakao','google','naver'].map(id=>({id,enabled,reason:enabled?'ready':'not_configured'})),registration:{open:false}};
}
const anonymous=()=>reply({code:'SIGN_IN_REQUIRED',message:'로그인해 주세요.'},401);
const googleURL='https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=fixture-state&nonce=fixture-nonce&code_challenge_method=S256&code_challenge=fixture-challenge';

await test('social account UI uses server availability and explicit account-link intent',async t=>{
  await t.test('all three unconfigured providers are disabled and never manufacture a login',async()=>{
    const h=await releaseHarness({handler:anonymous,authHandler:()=>reply(authStatus({authenticated:false}))});
    try{
      for(const id of ['kakao','google','naver']){
        const button=h.app.querySelectorAll('[data-action="auth-login"]').find(item=>item.dataset.provider===id);
        assert.ok(button);assert.equal(button.disabled,true);assert.equal(await h.click('auth-login',{provider:id}),false);
      }
      assert.match(h.app.innerHTML,/카카오/);assert.match(h.app.innerHTML,/Google/);assert.match(h.app.innerHTML,/네이버/);
      assert.equal(h.calls.filter(call=>call.body).length,0);assert.equal(h.navigations.length,0);assert.equal(h.writes.length,0);
      await h.click('release-info');assert.match(h.modal.innerHTML,/만 14세 이상 이용자/);assert.match(h.modal.innerHTML,/연령 확인 절차를 준비하고 있어요/);assert.match(h.modal.innerHTML,/게임물 등급은 아직 확정되지 않았어요/);
      await h.click('close-modal',{},true);assert.equal(h.modal.open,false);
      assert.deepEqual(auditMarkup(h.markup()).issues,[]);
    }finally{h.restore();}
  });

  await t.test('link requires confirmation and navigates to the fixed provider in the top-level window',async()=>{
    const h=await releaseHarness({handler:()=>reply(snapshot()),authHandler:call=>{
      if(call.url==='/api/auth/status')return reply(authStatus({enabled:true,linked:['kakao']}));
      assert.equal(call.url,'/api/auth/google/start');assert.deepEqual(call.body,{intent:'link'});
      return reply({url:googleURL});
    }});
    try{
      await h.click('nav',{view:'profile'});
      assert.equal(await h.click('auth-link',{provider:'kakao'}),false);
      await h.click('auth-link',{provider:'google'});
      assert.equal(h.calls.filter(call=>call.body).length,0);assert.match(h.modal.innerHTML,/기록을 합칠 수 없어요/);
      await h.click('auth-link-confirm',{provider:'google'},true);
      const post=h.calls.find(call=>call.url==='/api/auth/google/start');
      assert.equal(post.options.credentials,'same-origin');assert.equal(post.options.cache,'no-store');assert.equal(post.options.method,'POST');
      assert.deepEqual(h.navigations,[{url:googleURL,target:'_top'}]);
      assert.match(h.app.innerHTML,/나의비밀토끼/);assert.match(h.app.innerHTML,/380/);assert.equal(h.writes.length,0);
      assert.deepEqual(auditMarkup(h.markup()).issues,[]);
    }finally{h.restore();}
  });

  await t.test('unsafe auth redirect is rejected before any browser navigation',async()=>{
    const h=await releaseHarness({handler:anonymous,authHandler:call=>call.url==='/api/auth/status'?reply(authStatus({authenticated:false,enabled:true})):reply({url:'https://attacker.example/collect'})});
    try{
      await h.click('auth-login',{provider:'google'});
      assert.equal(h.navigations.length,0);assert.match(h.app.innerHTML,/로그인 이동 주소를 확인하지 못했어요/);
      assert.equal(h.calls.filter(call=>call.url==='/api/auth/google/start').length,1);
      assert.doesNotMatch(h.app.innerHTML,/나의비밀토끼|attacker/);
    }finally{h.restore();}
  });

  await t.test('ChatGPT sign-in explicitly clears app sign-out before a normal platform anchor',async()=>{
    const h=await releaseHarness({handler:anonymous,authHandler:call=>{
      if(call.url==='/api/auth/status')return reply(authStatus({authenticated:false}));
      assert.equal(call.url,'/api/auth/sites-start');assert.deepEqual(call.body,{});
      return reply({url:'/signin-with-chatgpt?return_to=%2F'});
    }});
    try{
      await h.click('auth-sites');
      assert.deepEqual(h.navigations,[{url:'/signin-with-chatgpt?return_to=%2F',target:'_top'}]);
      assert.equal(h.calls.filter(call=>call.url==='/api/auth/sites-start').length,1);
      assert.doesNotMatch(h.app.innerHTML,/coin-wallet|나의비밀토끼/);
    }finally{h.restore();}
  });

  await t.test('lost logout response hides all personal state and can be safely retried',async()=>{
    let signedIn=true,logouts=0;
    const h=await releaseHarness({handler:()=>signedIn?reply(snapshot()):anonymous(),authHandler:call=>{
      if(call.url==='/api/auth/status')return reply(authStatus({authenticated:signedIn}));
      assert.equal(call.url,'/api/auth/logout');signedIn=false;logouts++;
      if(logouts===1)throw new TypeError('response lost');
      return reply({ok:true});
    }});
    try{
      await h.click('nav',{view:'profile'});await h.click('auth-logout');
      assert.doesNotMatch(h.app.innerHTML+h.modal.innerHTML,/나의비밀토끼|coin-wallet|보유 코인 380/);
      assert.match(h.app.innerHTML,/로그아웃 처리 결과를 확인하지 못했으니/);assert.equal(h.modal.open,false);
      await h.click('auth-logout');assert.equal(logouts,2);
      assert.match(h.app.innerHTML,/ChatGPT 계정으로 시작하기/);
      assert.doesNotMatch(h.app.innerHTML,/나의비밀토끼|처리 결과를 확인하지 못/);
      await h.focus();assert.doesNotMatch(h.app.innerHTML,/나의비밀토끼|coin-wallet/);
      assert.deepEqual(auditMarkup(h.markup()).issues,[]);
    }finally{h.restore();}
  });

  await t.test('callback cancellation/signup errors are readable, bounded and removed from the address',async()=>{
    const h=await releaseHarness({search:'?auth_error=signup_closed',handler:anonymous,authHandler:()=>reply(authStatus({authenticated:false}))});
    try{
      assert.match(h.app.innerHTML,/새 계정 가입은 아직 준비 중/);assert.equal(location.search,'');
      await h.click('auth-dismiss');assert.doesNotMatch(h.app.innerHTML,/새 계정 가입은 아직 준비 중/);
      assert.deepEqual(auditMarkup(h.markup()).issues,[]);
    }finally{h.restore();}
    assert.match(callbackNotice('?auth_error=account_conflict').text,/다른 게임 계정/);
    assert.match(callbackNotice('?auth_error=account_changed').text,/계정이 바뀌/);
    assert.doesNotMatch(callbackNotice('?auth_error=%3Cscript%3Eprivate-token').text,/script|private-token/);
  });
});

test('client accepts no account identifiers, extra providers or arbitrary navigation destinations',()=>{
  const status=normalizeAuthStatus({...authStatus({enabled:true,linked:['google','google','invented']}),
    account:{provider:'google',linkedProviders:['google','google','invented'],userId:'private-id',email:'private@example.com'},
    providers:[{id:'google',enabled:true,client_secret:'secret'},{id:'invented',enabled:true}],
  });
  assert.deepEqual(status.account,{provider:'google',linkedProviders:['google']});
  assert.equal(status.providers.find(provider=>provider.id==='kakao').enabled,false);
  assert.equal(status.providers.length,3);assert.doesNotMatch(JSON.stringify(status),/private-id|private@|client_secret|invented/);
  for(const url of ['javascript:alert(1)','https://accounts.google.com.attacker.example/o/oauth2/v2/auth','https://accounts.google.com/o/oauth2/v2/auth?response_type=token','https://accounts.google.com:444/o/oauth2/v2/auth',googleURL+'#secret'])assert.throws(()=>validateLoginDestination(url,'google'));
  assert.throws(()=>validateLoginDestination('//attacker.example','chatgpt'));
});

test('standalone and unknown auth capabilities hide the Sites sign-in path', async () => {
  for (const sites of [{ enabled: false }, undefined]) {
    const h = await releaseHarness({ handler: anonymous,
      authHandler: () => reply({ ...authStatus({ authenticated: false }), sites }),
    });
    try {
      assert.doesNotMatch(h.app.innerHTML, /data-action="auth-sites"|signin-with-chatgpt/);
      assert.match(h.app.innerHTML, /카카오/);
      assert.equal(h.navigations.length, 0);
      assert.deepEqual(auditMarkup(h.markup()).issues, []);
    } finally { h.restore(); }
  }
});
