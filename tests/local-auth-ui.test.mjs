import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthApi, normalizeAuthStatus, PREVIEW_POLICY_VERSION, callbackNotice, providerName } from '../public/game/auth.js';
import { CATALOG, DEFAULT_EQUIPPED } from '../public/game/state.js';
import { releaseHarness, reply } from './helpers/release-controller-harness.mjs';
import { auditMarkup } from './helpers/markup-source.mjs';
import { policyDialog, POLICY_NOTICE_VERSION } from '../public/game/policy-views.js';

const PASSWORD=' synthetic password with spaces ';
const GOOGLE='https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=local-fixture-state&nonce=local-fixture-nonce&code_challenge_method=S256&code_challenge=local-fixture-challenge';
const consent={ageConfirmed:true,policyAccepted:true,policyVersion:PREVIEW_POLICY_VERSION};
const anonymous=()=>reply({code:'SIGN_IN_REQUIRED'},401);
const status=(extra={})=>({authenticated:false,account:null,sites:{enabled:false},
  providers:[{id:'google',enabled:true},{id:'kakao',enabled:false},{id:'naver',enabled:false}],
  localAuth:{enabled:true,registrationOpen:true},registration:{open:false,previewOpen:true},...extra});
const snapshot=()=>({serverNow:Date.parse('2026-10-20T00:00:00Z'),today:'2026-10-20',state:{
  playerId:'local-ui-player',name:'시험 토끼',coins:180,owned:CATALOG.filter(item=>item.cost===0).map(item=>item.id),equipped:{...DEFAULT_EQUIPPED},
  results:[],practiceHistory:[],practiceUsage:{},awards:{},active:null,createdAt:'2026-10-20',todayFields:['logic','math','spatial','language','memory'],
  totals:{dailyCount:0,questionCount:0,correctCount:0,practiceCount:0},ranking:{week:'2026-10-19',rows:[],me:null,rank:null,total:0,participated:false,correct:0,score:0,totalTimeMs:null},
}});
function fill(h,{username='trial_user',password=PASSWORD,nickname='시험 토끼',confirm=password,age=true,policy=true}={}){
  h.query('#auth-username').value=username;
  h.query('#auth-password').value=password;
  if(h.query('#auth-nickname'))h.query('#auth-nickname').value=nickname;
  if(h.query('#auth-password-confirm'))h.query('#auth-password-confirm').value=confirm;
  if(h.query('#auth-age'))h.query('#auth-age').checked=age;
  if(h.query('#auth-policy'))h.query('#auth-policy').checked=policy;
}
const posts=h=>h.calls.filter(call=>call.body);
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}

test('local auth capabilities are explicit and strip credentials while keeping local account display metadata',()=>{
  assert.equal(PREVIEW_POLICY_VERSION,POLICY_NOTICE_VERSION);
  const valid=normalizeAuthStatus(status());
  assert.deepEqual(valid.localAuth,{enabled:true,registrationOpen:true});
  assert.deepEqual(valid.registration,{open:false,previewOpen:true});
  for(const change of [
    {localAuth:undefined},{localAuth:{enabled:'true',registrationOpen:true}},
    {localAuth:{enabled:true,registrationOpen:'true'}},{registration:{previewOpen:false}},
    {registration:{previewOpen:'true'}},{authenticated:true},
  ])assert.equal(normalizeAuthStatus(status(change)).localAuth.registrationOpen,false);
  const current=normalizeAuthStatus(status({authenticated:true,account:{provider:'local',linkedProviders:['local','google'],username:'secret-user',password:PASSWORD}}));
  assert.deepEqual(current.account,{provider:'local',linkedProviders:['local','google']});
  assert.equal(providerName('local'),'아이디 로그인');
  assert.doesNotMatch(JSON.stringify(current),/secret-user|synthetic password/);
});

test('login form is accessible, uses POST and disables Kakao and Naver even with stale availability',async()=>{
  const h=await releaseHarness({handler:anonymous,authHandler:()=>reply(status({providers:['kakao','google','naver'].map(id=>({id,enabled:true}))}))});
  try{
    const form=h.query('#local-auth-form');
    assert.equal(form.attrs.method,'post');assert.equal(form.attrs.action,'/api/auth/local/login');
    assert.equal(h.query('#auth-password').attrs.type,'password');
    assert.equal(h.query('#auth-password').attrs.autocomplete,'current-password');
    assert.equal(h.query('#auth-username').attrs.autocomplete,'username');
    assert.match(h.app.innerHTML,/Google로 로그인/);
    for(const provider of ['kakao','naver'])assert.equal(await h.click('auth-login',{provider}),false);
    assert.equal(posts(h).length,0);assert.deepEqual(auditMarkup(h.markup()).issues,[]);
    await h.click('auth-mode',{mode:'register'});
    assert.equal(h.query('#auth-password').attrs.autocomplete,'new-password');
    assert.match(h.app.innerHTML,/비밀번호 찾기를 지원하지 않아요/);
    await h.click('policy-open',{kind:'privacy'});assert.equal(h.modal.open,true);
    assert.match(h.modal.innerHTML,/비밀번호 원문은 저장하지 않아요/);
    assert.match(h.modal.innerHTML,/접속 주소와 아이디에서 만든 해시/);
    assert.match(h.modal.innerHTML,/안내 버전, 동의 시각/);
    assert.deepEqual(auditMarkup(h.markup()).issues,[]);
  }finally{h.restore();}
});

test('trial release notice describes the available login choices and password recovery limit',async()=>{
  const h=await releaseHarness({handler:anonymous,authHandler:()=>reply(status())});
  try{
    await h.click('release-info');
    assert.match(h.modal.innerHTML,/아이디 가입 또는 Google/);
    assert.match(h.modal.innerHTML,/카카오와 네이버는 준비 중/);
    assert.match(h.modal.innerHTML,/비밀번호 찾기를 지원하지 않아요/);
    assert.doesNotMatch(h.modal.innerHTML,/가입과 간편 로그인은 아직 준비 중/);
    assert.equal(posts(h).length,0);
    assert.match(policyDialog('terms').body,/안내를 읽거나 닫는 것만으로 약관 동의나 회원가입이 이루어지지 않아요/);
  }finally{h.restore();}
});

test('local registration requires valid fields, matching password and both confirmations before posting',async()=>{
  const h=await releaseHarness({handler:anonymous,authHandler:()=>reply(status())});
  try{
    await h.click('auth-mode',{mode:'register'});
    for(const [input,message] of [
      [{username:'UpperCASE'},/아이디는 영문 소문자/],
      [{password:'short'},/비밀번호는 공백을 포함해 15~128자/],
      [{password:'a'.repeat(129)},/비밀번호는 공백을 포함해 15~128자/],
      [{nickname:'<script>'},/닉네임은 한글/],
      [{confirm:'a different password'},/비밀번호 확인이 일치하지/],
      [{age:false},/확인 항목을 모두 선택/],
      [{policy:false},/확인 항목을 모두 선택/],
    ]){
      fill(h,input);await h.click('auth-local-submit');assert.match(h.app.innerHTML,message);
      assert.equal(posts(h).length,0);
      assert.doesNotMatch(h.app.innerHTML,/synthetic password|value="a different password"|<script>/);
    }
    assert.equal(h.writes.length,0);assert.equal(h.navigations.length,0);
  }finally{h.restore();}
});

test('local registration sends exact values without trimming the password and reloads the authenticated game',async()=>{
  let signedIn=false;
  const h=await releaseHarness({handler:()=>signedIn?reply(snapshot()):anonymous(),authHandler:call=>{
    if(call.url==='/api/auth/status')return reply(status({authenticated:signedIn,account:signedIn?{provider:'local',linkedProviders:['local']}:null}));
    assert.equal(call.url,'/api/auth/local/register');
    assert.deepEqual(call.body,{username:'trial_user',password:PASSWORD,nickname:'시험 토끼',...consent});
    signedIn=true;return reply({authenticated:true});
  }});
  try{
    await h.click('auth-mode',{mode:'register'});fill(h,{nickname:'  시험   토끼  '});
    await h.click('auth-local-submit');
    assert.equal(posts(h).length,1);assert.equal(posts(h)[0].options.method,'POST');
    assert.equal(posts(h)[0].options.credentials,'same-origin');assert.equal(posts(h)[0].options.cache,'no-store');
    assert.match(h.app.innerHTML,/오늘의 도전 시작/);
    assert.doesNotMatch(h.app.innerHTML,/synthetic password/);
    assert.equal(h.writes.length,0);assert.equal(h.navigations.length,0);assert.doesNotMatch(location.href,/trial_user|synthetic/);
    await h.click('nav',{view:'profile'});assert.match(h.app.innerHTML,/아이디 로그인으로 이용 중/);
  }finally{h.restore();}
});

test('password login accepts Enter, sends no signup claims, and shows a generic credential failure',async()=>{
  const h=await releaseHarness({handler:anonymous,authHandler:call=>{
    if(call.url==='/api/auth/status')return reply(status());
    assert.equal(call.url,'/api/auth/local/login');assert.deepEqual(call.body,{username:'trial_user',password:PASSWORD});
    return reply({code:'INVALID_CREDENTIALS',message:'private backend account detail'},401);
  }});
  try{
    fill(h);let prevented=false;
    await h.app.fire('submit',{target:h.query('#local-auth-form'),preventDefault(){prevented=true;}});
    assert.equal(prevented,true);assert.equal(posts(h).length,1);
    assert.match(h.app.innerHTML,/아이디 또는 비밀번호를 확인/);
    assert.doesNotMatch(h.app.innerHTML,/private backend|synthetic password/);
    assert.equal(h.query('#auth-password').value,'');assert.equal(h.query('#auth-username').value,'trial_user');
    assert.equal(h.writes.length,0);
  }finally{h.restore();}
});

test('Google login stays ordinary while Google signup explicitly carries confirmed preview policy',async()=>{
  for(const signup of [false,true]){
    const h=await releaseHarness({handler:anonymous,authHandler:call=>{
      if(call.url==='/api/auth/status')return reply(status());
      assert.equal(call.url,'/api/auth/google/start');
      assert.deepEqual(call.body,signup?{intent:'login',signup:consent}:{intent:'login'});
      return reply({url:GOOGLE});
    }});
    try{
      if(signup){
        await h.click('auth-mode',{mode:'register'});
        await h.click('auth-google-signup',{provider:'google'});assert.equal(posts(h).length,0);
        h.query('#auth-age').checked=true;h.query('#auth-policy').checked=true;
        await h.click('auth-google-signup',{provider:'google'});
      }else await h.click('auth-login',{provider:'google'});
      assert.equal(posts(h).length,1);assert.deepEqual(h.navigations,[{url:GOOGLE,target:'_top'}]);
    }finally{h.restore();}
  }
});

test('signup-required callback opens the signup choice without claiming an account or verified age',async()=>{
  const h=await releaseHarness({search:'?auth_error=signup_required',handler:anonymous,authHandler:()=>reply(status())});
  try{
    assert.match(h.app.innerHTML,/아직 가입한 계정이 없어요/);assert.match(h.app.innerHTML,/Google로 가입하기/);
    assert.match(h.app.innerHTML,/본인·연령 인증을 대신하지 않아요/);
    assert.doesNotMatch(h.app.innerHTML,/가입했어요|연령 인증 완료/);
    assert.equal(posts(h).length,0);assert.equal(location.search,'');
    assert.match(callbackNotice('?auth_error=signup_required').text,/회원가입/);
  }finally{h.restore();}
});

test('pending login disables duplicate submission and ignores a late response after the tab is hidden',async()=>{
  const entered=deferred(),release=deferred();
  const h=await releaseHarness({handler:anonymous,authHandler:async call=>{
    if(call.url==='/api/auth/status')return reply(status());
    entered.resolve();await release.promise;return reply({authenticated:true});
  }});
  try{
    fill(h);const pending=h.click('auth-local-submit');await entered.promise;
    assert.equal(await h.click('auth-local-submit'),false);
    assert.equal(await h.click('auth-mode',{mode:'register'}),false);
    assert.equal(h.query('#auth-password').value,'');
    h.document.hidden=true;await h.document.fire('visibilitychange');
    release.resolve();await pending;
    assert.equal(posts(h).length,1);assert.equal(h.calls.filter(call=>call.url==='/api/game/bootstrap').length,1);
    assert.equal(h.writes.length,0);assert.equal(h.navigations.length,0);
    h.document.hidden=false;await h.document.fire('visibilitychange');
    assert.match(h.app.innerHTML,/Google로 로그인/);assert.doesNotMatch(h.app.innerHTML,/오늘의 도전 시작/);
  }finally{release.resolve();h.restore();}
});

test('an unclear registration result never retries automatically or announces success',async()=>{
  for(const response of ['lost','malformed','limited']){
    const h=await releaseHarness({handler:anonymous,authHandler:call=>{
      if(call.url==='/api/auth/status')return reply(status());
      if(response==='lost')throw new TypeError('Synthetic lost response');
      return response==='limited'?reply({code:'RATE_LIMITED'},429,{'Retry-After':'60'}):reply({authenticated:'true'});
    }});
    try{
      await h.click('auth-mode',{mode:'register'});fill(h);await h.click('auth-local-submit');
      assert.equal(posts(h).length,1);assert.doesNotMatch(h.app.innerHTML,/가입했어요|오늘의 도전 시작/);
      assert.match(h.app.innerHTML,response==='limited'?/요청이 잠시 몰렸어요/:/회원가입 결과를 확인하지 못했어요/);
      assert.equal(h.query('#auth-password').value,'');assert.equal(h.query('#auth-password-confirm').value,'');
      await h.advance(1000);assert.equal(posts(h).length,1);assert.equal(h.writes.length,0);
    }finally{h.restore();}
  }
});

test('mode changes clear passwords and malformed local availability cannot expose registration',async()=>{
  const h=await releaseHarness({handler:anonymous,authHandler:()=>reply(status())});
  try{
    fill(h);await h.click('auth-mode',{mode:'register'});
    assert.equal(h.query('#auth-password').value,'');assert.equal(h.query('#auth-password-confirm').value,'');
    assert.doesNotMatch(h.app.innerHTML,/synthetic password/);
    assert.equal(h.query('#auth-username').value,'trial_user');
  }finally{h.restore();}
  const closed=await releaseHarness({handler:anonymous,authHandler:()=>reply(status({registration:{open:false,previewOpen:false}}))});
  try{
    assert.equal(await closed.click('auth-mode',{mode:'register'}),false);
    assert.equal(closed.query('#auth-nickname'),null);assert.equal(closed.query('#auth-age'),null);
    assert.match(closed.app.innerHTML,/이미 가입한 계정으로 로그인/);
  }finally{closed.restore();}
});

test('auth transport rejects incomplete Google signup consent and returns no server credentials on local success',async()=>{
  const calls=[];const api=createAuthApi({fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return reply({authenticated:true,password:'server-private',username:'server-private'});}});
  try{
    for(const invalid of [null,{}, {...consent,ageConfirmed:'true'}, {...consent,policyVersion:'old'}])await assert.rejects(api.start('google','login',undefined,invalid),{code:'INVALID_SIGNUP_CONFIRMATION'});
    await assert.rejects(api.start('kakao','login',undefined,consent),{code:'INVALID_SIGNUP_CONFIRMATION'});
    assert.equal(calls.length,0);
    assert.deepEqual(await api.localLogin({username:'trial_user',password:PASSWORD}),{authenticated:true});
    assert.deepEqual(await api.localRegister({username:'trial_user',password:PASSWORD,nickname:'시험토끼',...consent}),{authenticated:true});
    assert.equal(calls.length,2);
  }finally{api.destroy();}
});
