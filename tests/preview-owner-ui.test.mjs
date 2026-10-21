import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAuthStatus } from '../public/game/auth.js';
import { CATALOG, DEFAULT_EQUIPPED } from '../public/game/state.js';
import { releaseHarness, reply } from './helpers/release-controller-harness.mjs';
import { auditMarkup } from './helpers/markup-source.mjs';

const enrollment={enabled:true,provider:'google',accountLimit:1};
const googleURL='https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=owner-fixture-state&nonce=owner-fixture-nonce&code_challenge_method=S256&code_challenge=owner-fixture-challenge';
const anonymous=()=>reply({code:'SIGN_IN_REQUIRED',message:'로그인해 주세요.'},401);
const status=(overrides={})=>({
  authenticated:false,account:null,sites:{enabled:false},registration:{open:false},
  providers:[{id:'kakao',enabled:false},{id:'google',enabled:true},{id:'naver',enabled:false}],
  previewEnrollment:{...enrollment},...overrides,
});
const buttonFor=(h,provider)=>h.app.querySelectorAll('[data-action="auth-login"]').find(button=>button.dataset.provider===provider);

test('owner enrollment display capability accepts only the exact anonymous Google contract',()=>{
  const ready=normalizeAuthStatus(status({previewEnrollment:{...enrollment,email:'private-owner@example.com',accountId:'private-owner-id',ageVerified:true}}));
  assert.deepEqual(ready.previewEnrollment,enrollment);
  assert.equal(ready.registration.open,false);
  assert.doesNotMatch(JSON.stringify(ready),/private-owner|ageVerified/);
  for(const invalid of [
    undefined,null,true,{},
    {...enrollment,enabled:false},{...enrollment,enabled:'true'},{...enrollment,enabled:1},
    {...enrollment,provider:'kakao'},{...enrollment,provider:'Google'},
    {...enrollment,accountLimit:0},{...enrollment,accountLimit:2},{...enrollment,accountLimit:'1'},
  ]){
    assert.equal(normalizeAuthStatus(status({previewEnrollment:invalid})).previewEnrollment.enabled,false);
  }
  for(const providers of [[],[{id:'google',enabled:false}],[{id:'google',enabled:'true'}],[{id:'kakao',enabled:true}]]){
    assert.equal(normalizeAuthStatus(status({providers})).previewEnrollment.enabled,false);
  }
  assert.equal(normalizeAuthStatus(status({authenticated:true,account:{provider:'google',linkedProviders:['google']}})).previewEnrollment.enabled,false);
});

test('owner enrollment uses ordinary Google OAuth login and clearly limits the entry to the operator',async()=>{
  const h=await releaseHarness({handler:anonymous,authHandler:call=>{
    if(call.url==='/api/auth/status')return reply(status());
    assert.equal(call.url,'/api/auth/google/start');
    assert.deepEqual(call.body,{intent:'login'});
    return reply({url:googleURL});
  }});
  try{
    assert.equal(buttonFor(h,'google').disabled,false);
    assert.match(h.app.innerHTML,/시험 계정 만들기/);
    assert.match(h.app.innerHTML,/지정된 운영자 Google 계정으로만 시험 계정을 만들 수 있어요\. 일반 가입은 아직 준비 중이에요\./);
    assert.equal(buttonFor(h,'kakao').disabled,true);
    assert.equal(buttonFor(h,'naver').disabled,true);
    assert.doesNotMatch(h.app.innerHTML,/연령 확인 완료|가입 완료|data-action="auth-sites"/);
    await h.click('auth-login',{provider:'google'});
    assert.deepEqual(h.navigations,[{url:googleURL,target:'_top'}]);
    const posts=h.calls.filter(call=>call.body);
    assert.equal(posts.length,1);
    assert.deepEqual(posts[0].body,{intent:'login'});
    assert.equal(posts[0].options.credentials,'same-origin');
    assert.equal(posts[0].options.cache,'no-store');
    assert.equal(h.writes.length,0);
    assert.deepEqual(auditMarkup(h.markup()).issues,[]);
  }finally{h.restore();}
});

test('owner entry label is never offered for another configured provider',async()=>{
  const h=await releaseHarness({handler:anonymous,authHandler:()=>reply(status({providers:[{id:'kakao',enabled:true},{id:'google',enabled:true},{id:'naver',enabled:true}]}))});
  try{
    // Read each button's child span through the actual parsed controller DOM.
    for(const provider of ['kakao','naver']){
      const button=buttonFor(h,provider);
      const labels=h.app.nodes.filter(node=>node.parentElement===button&&node.tagName==='SPAN');
      assert.deepEqual(labels.map(label=>label.textContent),['계속하기']);
    }
    const googleButton=buttonFor(h,'google');
    assert.deepEqual(h.app.nodes.filter(node=>node.parentElement===googleButton&&node.tagName==='SPAN').map(label=>label.textContent),['시험 계정 만들기']);
    assert.equal(h.calls.filter(call=>call.body).length,0);
  }finally{h.restore();}
});

test('missing or malformed owner metadata preserves existing-account login and closed signup guidance',async()=>{
  for(const previewEnrollment of [undefined,{...enrollment,enabled:false},{...enrollment,provider:'naver'},{...enrollment,accountLimit:'1'}]){
    const h=await releaseHarness({handler:anonymous,authHandler:call=>call.url==='/api/auth/status'?reply(status({previewEnrollment})):reply({url:googleURL})});
    try{
      assert.doesNotMatch(h.app.innerHTML,/시험 계정 만들기|지정된 운영자/);
      assert.match(h.app.innerHTML,/새 계정 가입은 준비 중이에요\. 이미 연결한 계정으로 로그인할 수 있어요\./);
      assert.equal(buttonFor(h,'google').disabled,false);
      await h.click('auth-login',{provider:'google'});
      assert.deepEqual(h.navigations,[{url:googleURL,target:'_top'}]);
      assert.deepEqual(h.calls.find(call=>call.url==='/api/auth/google/start').body,{intent:'login'});
    }finally{h.restore();}
  }
});

test('an unavailable Google provider cannot become an enrollment button through preview metadata',async()=>{
  const h=await releaseHarness({handler:anonymous,authHandler:()=>reply(status({providers:[{id:'google',enabled:false}]}))});
  try{
    assert.equal(buttonFor(h,'google').disabled,true);
    assert.doesNotMatch(h.app.innerHTML,/시험 계정 만들기|지정된 운영자/);
    assert.equal(await h.click('auth-login',{provider:'google'}),false);
    assert.equal(h.calls.filter(call=>call.body).length,0);
    assert.equal(h.navigations.length,0);
  }finally{h.restore();}
});

test('after the one-account capability closes, returning users see ordinary login without a second enrollment offer',async()=>{
  let canEnroll=true;
  const h=await releaseHarness({handler:anonymous,authHandler:()=>reply(status({previewEnrollment:{...enrollment,enabled:canEnroll}}))});
  try{
    assert.match(h.app.innerHTML,/시험 계정 만들기/);
    canEnroll=false;
    await h.advance(15000);await h.focus();
    assert.doesNotMatch(h.app.innerHTML,/시험 계정 만들기|지정된 운영자/);
    assert.match(h.app.innerHTML,/이미 연결한 계정으로 로그인할 수 있어요/);
    assert.equal(buttonFor(h,'google').disabled,false);
    assert.equal(h.navigations.length,0);
    assert.equal(h.writes.length,0);
  }finally{h.restore();}
});

test('authenticated accounts keep their game and linking flow even if owner metadata is mistakenly supplied',async()=>{
  const day='2026-10-20',now=Date.parse(day+'T00:00:00Z');
  const snapshot={serverNow:now,today:day,state:{
    playerId:'owner-fixture-player',name:'시험토끼',coins:0,owned:CATALOG.filter(item=>item.cost===0).map(item=>item.id),equipped:{...DEFAULT_EQUIPPED},
    results:[],practiceHistory:[],practiceUsage:{},awards:{},active:null,createdAt:day,todayFields:['logic','math','spatial','language','memory'],
    totals:{dailyCount:0,questionCount:0,correctCount:0,practiceCount:0},ranking:{week:'2026-10-19',rows:[],me:null,rank:null,total:0,participated:false,correct:0,score:0,totalTimeMs:null},
  }};
  const h=await releaseHarness({handler:()=>reply(snapshot),authHandler:call=>{
    if(call.url==='/api/auth/status')return reply(status({authenticated:true,account:{provider:'kakao',linkedProviders:['kakao']}}));
    assert.equal(call.url,'/api/auth/google/start');assert.deepEqual(call.body,{intent:'link'});
    return reply({url:googleURL});
  }});
  try{
    assert.doesNotMatch(h.app.innerHTML,/시험 계정 만들기|지정된 운영자/);
    await h.click('nav',{view:'profile'});
    assert.match(h.app.innerHTML,/시험토끼/);
    await h.click('auth-link',{provider:'google'});
    assert.match(h.modal.innerHTML,/기록을 합칠 수 없어요/);
    assert.equal(h.calls.filter(call=>call.body).length,0);
    await h.click('auth-link-confirm',{provider:'google'},true);
    assert.deepEqual(h.navigations,[{url:googleURL,target:'_top'}]);
    assert.equal(h.writes.length,0);
  }finally{h.restore();}
});
