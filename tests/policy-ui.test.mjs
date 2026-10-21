import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseHarness, reply } from './helpers/release-controller-harness.mjs';
import { auditMarkup } from './helpers/markup-source.mjs';
import { policyDialog } from '../public/game/policy-views.js';
import { CATALOG, DEFAULT_EQUIPPED } from '../public/game/state.js';

const NOW = Date.parse('2026-10-20T00:00:00Z'), TODAY = '2026-10-20';
const player = () => ({
  playerId:'policy-fixture-player',name:'안내검수토끼',coins:180,
  owned:CATALOG.filter(item=>item.cost===0).map(item=>item.id),equipped:{...DEFAULT_EQUIPPED},
  results:[],practiceHistory:[],practiceUsage:{},awards:{},active:null,createdAt:TODAY,
  todayFields:['logic','math','spatial','language','memory'],
  totals:{dailyCount:0,questionCount:0,correctCount:0,practiceCount:0},
  ranking:{week:'2026-10-19',rows:[],me:null,rank:null,total:0,participated:false,correct:0,score:0,totalTimeMs:null},
});
const auth = authenticated => reply({
  authenticated,sites:{enabled:false},account:authenticated?{provider:'kakao',linkedProviders:['kakao']}:null,
  providers:['kakao','google','naver'].map(id=>({id,enabled:false,reason:'not_configured'})),
  registration:{open:false},
});

test('public service notices work without login, API submission or policy acceptance', async () => {
  const h=await releaseHarness({
    handler:()=>reply({code:'SIGN_IN_REQUIRED',message:'로그인이 필요해요.'},401),
    authHandler:()=>auth(false),
  });
  try {
    assert.equal(h.query('#main').attrs.tabindex,'-1');
    for (const kind of ['terms','privacy','data']) {
      const calls=h.calls.length, writes=h.writes.length;
      assert.equal(await h.click('policy-open',{kind}),true);
      assert.equal(h.modal.open,true);
      assert.equal(h.modal.querySelector('#modal-title').textContent,policyDialog(kind).title);
      assert.equal(h.calls.length,calls);
      assert.equal(h.writes.length,writes);
      assert.equal(h.modal.querySelectorAll('input').length,0);
      assert.deepEqual(auditMarkup(h.markup()).issues,[]);
      await h.modal.fire('cancel',{preventDefault(){}});
      assert.equal(h.modal.open,false);
      assert.equal(h.modal.innerHTML,'');
    }
    await h.click('privacy-open');
    assert.equal(h.query('[data-action="privacy-export"]').disabled,true);
    await h.click('policy-open',{kind:'privacy'});
    assert.equal(h.modal.open,true);
    await h.click('close-modal',{},true);
    await h.click('privacy-back');
    assert.equal(h.document.activeElement.id,'main');
  } finally {h.restore();}
});

test('profile and rights screens expose the same read-only notices without mutation', async () => {
  const h=await releaseHarness({
    handler:()=>reply({state:player(),serverNow:NOW,today:TODAY}),
    authHandler:()=>auth(true),
    privacyHandler:()=>reply({code:'REAUTH_REQUIRED',message:'최근 본인 확인이 필요해요.'},403),
  });
  try {
    await h.click('nav',{view:'profile'});
    for (const kind of ['terms','privacy','data']) {
      const calls=h.calls.length;
      await h.click('policy-open',{kind});
      assert.equal(h.modal.querySelector('#modal-title').textContent,policyDialog(kind).title);
      assert.equal(h.calls.length,calls);
      await h.click('close-modal',{},true);
    }
    await h.click('privacy-open');
    const calls=h.calls.length;
    await h.click('policy-open',{kind:'data'});
    assert.equal(h.modal.querySelector('#modal-title').textContent,policyDialog('data').title);
    assert.equal(h.calls.length,calls);
    assert.equal(h.calls.filter(call=>call.options.method==='POST').length,0);
    assert.deepEqual(auditMarkup(h.markup()).issues,[]);
  } finally {h.restore();}
});
