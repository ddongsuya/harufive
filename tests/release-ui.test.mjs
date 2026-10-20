import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {releaseHarness,reply} from './helpers/release-controller-harness.mjs';
import {auditMarkup} from './helpers/markup-source.mjs';
import {CATALOG,DEFAULT_EQUIPPED} from '../public/game/state.js';
import {handleGameRequest} from '../server/http.mjs';
import {createSQLiteD1} from './helpers/d1-test-db.mjs';

const NOW=Date.parse('2026-10-20T00:00:00Z'),TODAY='2026-10-20';
function player(overrides={}){return {playerId:'public-player-a',name:'작은토끼',coins:180,owned:CATALOG.filter(i=>i.cost===0).map(i=>i.id),equipped:{...DEFAULT_EQUIPPED},results:[],practiceHistory:[],practiceUsage:{},awards:{},active:null,createdAt:TODAY,todayFields:['logic','math','spatial','language','memory'],totals:{dailyCount:0,questionCount:0,correctCount:0,practiceCount:0},ranking:{week:'2026-10-19',rows:[],me:null,rank:null,total:0,participated:false,correct:0,score:0,totalTimeMs:null},...overrides};}
function active(overrides={}){return {id:'attempt-a',mode:'daily',date:TODAY,index:0,answers:[],questions:[{id:'q-a',field:'logic',level:1,prompt:'첫 번째로 고를 것은?',options:['한 개','두 개','세 개','네 개']},null,null,null,null],currentQuestionId:'q-a',phase:'answering',issuedAt:NOW,memoryUntil:null,expiresAt:NOW+86400000,totalTimeMs:0,timingVersion:2,...overrides};}
const envelope=(state,now=NOW)=>({state:structuredClone(state),serverNow:now,today:TODAY});
const html=h=>h.app.innerHTML;

await test('release client uses authenticated server snapshots and real controller actions',async t=>{
  await t.test('sign-in and failed bootstrap never manufacture an account or expose old local records',async()=>{
    const legacy=JSON.stringify({name:'이전비밀이름',coins:99999,results:[{date:TODAY}],owned:[]});
    const h=await releaseHarness({legacy,handler:()=>reply({code:'SIGN_IN_REQUIRED',message:'로그인해 주세요.',signInUrl:'/signin-with-chatgpt?return_to=%2F'},401)});
    try{
      assert.match(html(h),/ChatGPT 계정으로 시작하기/);assert.match(html(h),/href="\/signin-with-chatgpt\?return_to=%2F" target="_top"/);
      assert.doesNotMatch(html(h),/이전비밀이름|99,999|coin-wallet/);assert.equal(h.writes.length,0);
      assert.deepEqual(auditMarkup(h.markup()).issues,[]);
    }finally{h.restore();}
    const failed=await releaseHarness({handler:()=>reply({code:'SERVER_ERROR',message:'서버 연결을 확인해 주세요.'},503)});
    try{assert.match(html(failed),/서버 연결을 확인/);assert.match(html(failed),/data-action="sync"/);assert.doesNotMatch(html(failed),/coin-wallet|서버에 기록이 저장돼요/);}finally{failed.restore();}
  });

  await t.test('a dropped answer response retains selection and replays exactly the same request without local scoring',async()=>{
    let server=player({active:active()}),answerCount=0;
    const h=await releaseHarness({handler(call){
      if(call.url.endsWith('/bootstrap'))return reply(envelope(server));
      assert.equal(call.url,'/api/game/answer');answerCount++;
      if(answerCount===1){server.active=active({index:1,answers:[1],currentQuestionId:'q-b',questions:[null,{id:'q-b',field:'math',level:2,prompt:'두 번째 문제',options:['A','B','C','D']},null,null,null],totalTimeMs:1200});throw new TypeError('Response lost');}
      return reply(envelope(server,NOW+1200));
    }});
    try{
      await h.click('daily');await h.click('select',{option:1});await h.click('answer');
      assert.match(html(h),/첫 번째로 고를 것은/);assert.match(html(h),/같은 요청으로 다시 확인/);
      const selected=h.app.querySelectorAll('[data-action="select"]').find(el=>el.dataset.option==='1');assert.equal(selected.attrs['aria-pressed'],'true');assert.equal(selected.disabled,true);
      assert.doesNotMatch(html(h),/오늘의 기록이 쌓였어요/);assert.equal(h.writes.length,0);
      await h.click('retry-request');assert.match(html(h),/두 번째 문제/);assert.doesNotMatch(html(h),/같은 요청으로 다시 확인/);
      const posts=h.calls.filter(c=>c.body);assert.equal(posts.length,2);assert.deepEqual(posts[0].body,posts[1].body);
      assert.deepEqual(Object.keys(posts[0].body).sort(),['attemptId','index','questionId','requestId','selected']);
      assert.equal(posts[0].body.selected,1);assert.equal(posts[0].options.credentials,'same-origin');assert.equal(posts[0].options.cache,'no-store');
      assert.deepEqual(auditMarkup(h.markup()).issues,[]);
    }finally{h.restore();}
  });

  await t.test('pending start disables duplicate mutation controls until the server responds',async()=>{
    let resolveStart;const h=await releaseHarness({handler(call){if(call.url.endsWith('/bootstrap'))return reply(envelope(player()));return new Promise(resolve=>resolveStart=resolve);}});
    try{
      const request=h.click('daily');await Promise.resolve();assert.equal(h.query('[data-action="daily"]').disabled,true);
      assert.equal(await h.click('daily'),false);assert.equal(h.calls.filter(c=>c.body).length,1);
      resolveStart(reply(envelope(player({active:active()}))));await request;assert.match(html(h),/첫 번째로 고를 것은/);
    }finally{h.restore();}
  });

  await t.test('rate limits keep the request ID and honor the server retry interval',async()=>{
    let posts=0;
    const h=await releaseHarness({handler(call,{now}){
      if(!call.body)return reply(envelope(player()));
      posts++;
      if(posts===1)return reply({code:'RATE_LIMITED',message:'요청이 많아요. 잠시 후 다시 시도해 주세요.'},429,{'Retry-After':'3'});
      return reply(envelope(player({active:active()}),now));
    }});
    try{
      await h.click('daily');assert.equal(h.query('[data-action="retry-request"]').disabled,true);
      await h.focus();assert.equal(posts,1);
      await h.advance(3000);assert.equal(h.query('[data-action="retry-request"]').disabled,false);
      await h.click('retry-request');assert.match(html(h),/첫 번째로 고를 것은/);
      const requests=h.calls.filter(c=>c.body);assert.equal(requests[0].body.requestId,requests[1].body.requestId);
    }finally{h.restore();}
  });

  await t.test('memory stages hide old cells immediately and do not hammer a failed resume endpoint',async()=>{
    const secret=['MEMORY_SECRET_A','MEMORY_SECRET_B','MEMORY_SECRET_C'];let stage='ready',bootstrapCount=0,failExpiry=true;
    let server=player({active:active({phase:'ready',issuedAt:null,questions:[{id:'q-a',field:'memory',level:1,visual:{type:'memory',columns:3,seconds:3}},null,null,null,null]})});
    const h=await releaseHarness({handler(call,{now}){
      if(call.url.endsWith('/memory')){stage='memorizing';server.active.phase='memorizing';server.active.memoryUntil=NOW+3000;server.active.issuedAt=NOW+3000;server.active.questions[0].visual.cells=secret;return reply(envelope(server,now));}
      bootstrapCount++;
      if(stage==='memorizing'&&now>=NOW+3000){if(failExpiry){failExpiry=false;throw new TypeError('offline');}stage='answering';server.active.phase='answering';server.active.questions[0]={id:'q-a',field:'memory',level:1,prompt:'무엇이 있었나요?',options:['기억 하나','기억 둘'],visual:{type:'memory',columns:3,seconds:3}};}
      return reply(envelope(server,now));
    }});
    try{
      await h.click('daily');assert.doesNotMatch(html(h),/MEMORY_SECRET|data-action="select"/);await h.click('memory-start');assert.match(html(h),/MEMORY_SECRET_A/);
      await h.advance(3100);assert.doesNotMatch(html(h),/MEMORY_SECRET/);assert.match(html(h),/배열을 가렸어요/);
      const before=bootstrapCount;await h.advance(10000);assert.equal(bootstrapCount,before,'failed memory refresh must not loop every 200 ms');
      await h.click('sync');assert.match(html(h),/무엇이 있었나요/);assert.match(html(h),/data-action="select"/);assert.doesNotMatch(html(h),/MEMORY_SECRET/);
      assert.deepEqual(auditMarkup(h.markup()).issues,[]);
    }finally{h.restore();}
  });

  await t.test('finishing only uses server results and server-supplied explanations',async()=>{
    const qs=Array.from({length:5},(_,i)=>({id:'q-'+i,field:['logic','math','spatial','language','memory'][i],level:i+1,prompt:'완료된 서버 문항 '+i,options:['서버 정답','다른 답']}));
    const result={id:'completed-a',mode:'daily',date:TODAY,correct:4,total:5,score:4080,baseScore:4000,speedBonus:80,totalTimeMs:27500,timingComplete:true,scoringVersion:2,questions:qs,details:qs.map((q,i)=>({field:q.field,correct:i!==4,answer:0,selected:i===4?1:0,explanation:'서버가 제공한 해설 '+i,elapsedMs:5500}))};
    const initial=player({active:active({index:4,answers:[0,0,0,0],currentQuestionId:'q-4',questions:[null,null,null,null,{...qs[4]}]})});
    const completed=player({coins:200,results:[result],totals:{dailyCount:1},ranking:{score:4080,correct:4,totalTimeMs:27500,rows:[],total:1,rank:1,participated:true}});
    const h=await releaseHarness({handler:call=>reply(envelope(call.body?completed:initial))});
    try{await h.click('daily');assert.doesNotMatch(html(h),/서버가 제공한 해설/);await h.click('select',{option:1});await h.click('answer');assert.match(html(h),/오늘의 기록이 쌓였어요/);assert.match(html(h),/4,080/);assert.doesNotMatch(html(h),/서버가 제공한 해설/);await h.click('review');assert.match(html(h),/서버가 제공한 해설 4/);assert.doesNotMatch(html(h),/보상 흐름 체험|새 문제 테스트/);assert.deepEqual(auditMarkup(h.markup()).issues,[]);}finally{h.restore();}
  });

  await t.test('401 on focus clears personal account, question, result and modal content',async()=>{
    let authenticated=true;const h=await releaseHarness({handler:()=>authenticated?reply(envelope(player({name:'개인비밀이름',coins:4321,active:active()}))):reply({code:'SIGN_IN_REQUIRED',message:'다시 로그인해 주세요.'},401)});
    try{await h.click('nav',{view:'profile'});await h.click('rename');assert.match(h.modal.innerHTML,/개인비밀이름/);authenticated=false;await h.focus();assert.match(html(h),/ChatGPT 계정으로 시작하기/);assert.doesNotMatch(html(h)+h.modal.innerHTML,/개인비밀이름|4,321|첫 번째로 고를 것은/);assert.equal(h.modal.open,false);}finally{h.restore();}
  });

  await t.test('rankings preserve server ranks, escape display names and handle the empty league',async()=>{
    let server=player();const h=await releaseHarness({handler:()=>reply(envelope(server))});
    try{
      await h.click('nav',{view:'ranking'});assert.match(html(h),/아직 이번 주 도전을 마친 사람이 없어요/);assert.doesNotMatch(html(h),/999|가상 데이터/);
      server=player({ranking:{rows:[{id:'b',name:'<script>bad</script>',rank:2,score:4000,correct:4,totalTimeMs:20,equipped:{...DEFAULT_EQUIPPED,character:'cat'}},{id:'c',name:'같은기록',rank:2,score:4000,correct:4,totalTimeMs:20,equipped:{...DEFAULT_EQUIPPED,character:'bear'}}],rank:87,total:102,participated:true,score:1000,correct:1,totalTimeMs:999}});
      await h.focus();assert.match(html(h),/class="place">87</);assert.equal((html(h).match(/class="place">2</g)||[]).length,2);assert.match(html(h),/&lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(html(h),/<script>bad/);
      assert.deepEqual(auditMarkup(h.markup()).issues,[]);
    }finally{h.restore();}
  });

  await t.test('wardrobe purchases await the server and previous local state remains read-only',async()=>{
    const legacy=JSON.stringify({name:'이전토끼',coins:9999,results:[{date:'2026-10-10'}],owned:['character-rabbit','character-cat']});let server=player();
    const h=await releaseHarness({legacy,handler(call){if(call.body){assert.equal(call.url,'/api/game/purchase');assert.equal(call.body.itemId,'hat-sprout');server=player({coins:100,owned:[...server.owned,'hat-sprout'],equipped:{...DEFAULT_EQUIPPED,hat:'sprout'}});}return reply(envelope(server));}});
    try{
      await h.click('nav',{view:'profile'});assert.match(html(h),/이전토끼/);assert.match(html(h),/9,999 테스트 코인/);assert.match(html(h),/합산하지 않아요/);assert.match(html(h),/data-action="auth-logout"/);
      await h.click('nav',{view:'shop'});await h.click('character',{id:'character-cat'});assert.equal(h.modal.querySelector('[data-action="buy-character"]').disabled,true);await h.click('close-modal',{},true);
      await h.click('shop-select',{id:'hat-sprout'});await h.click('buy',{id:'hat-sprout'});assert.match(html(h),/함께하는 중/);assert.match(html(h),/aria-label="보유 코인 100개/);
      await h.click('shop-tab',{tab:'collection'});assert.match(html(h),/준비 중인 스타일/);assert.doesNotMatch(html(h),/₩|가격 검토안/);
      assert.equal(h.storage.get('haru-five-playtest-v1'),legacy);assert.equal(h.writes.filter(w=>w.key==='haru-five-playtest-v1').length,0);
      assert.deepEqual(auditMarkup(h.markup()).issues,[]);
    }finally{h.restore();}
  });

  await t.test('shipped client completes a daily set and free practice through the real HTTP service and SQLite',async()=>{
    const db=createSQLiteD1();let lastPayload;
    const h=await releaseHarness({handler:async(call,{now})=>{
      const origin='https://haru-five.example',headers={...call.options.headers,...(call.body?{Origin:origin}:{})};
      const request=new Request(origin+call.url,{method:call.options.method,headers,...(call.body?{body:call.options.body}:{})});
      const response=await handleGameRequest(request,{action:call.url.split('/').at(-1),userId:'integration-player',db,now:()=>now});
      lastPayload=await response.clone().json();return response;
    }});
    try{
      await h.click('daily');assert.ok(lastPayload.state.active);
      for(let i=0;i<5;i++){
        if(lastPayload.state.active.phase==='ready'){await h.click('memory-start');await h.advance(10000);await h.focus();}
        assert.equal(lastPayload.state.active.phase,'answering');
        await h.advance(500);await h.click('select',{option:0});await h.click('answer');
      }
      assert.equal(lastPayload.state.active,null);assert.equal(lastPayload.state.results.length,1);assert.equal(lastPayload.state.coins,200);
      assert.match(html(h),/오늘의 기록이 쌓였어요/);await h.click('review');assert.match(html(h),/class="explanation"/);
      await h.click('practice');assert.equal(lastPayload.state.active.mode,'practice');
      for(let i=0;i<5;i++){
        if(lastPayload.state.active.phase==='ready'){await h.click('memory-start');await h.advance(10000);await h.focus();}
        await h.advance(500);await h.click('select',{option:0});await h.click('answer');
      }
      assert.equal(lastPayload.state.practiceHistory.length,1);assert.equal(lastPayload.state.results.length,1);assert.equal(lastPayload.state.coins,200);
      await h.click('nav',{view:'home'});await h.click('practice');assert.match(h.modal.innerHTML,/오늘의 연습도 마쳤어요/);
      assert.equal(db.rows("SELECT COUNT(*) AS count FROM game_coin_ledger WHERE user_id = ? AND reason = 'daily'",'integration-player')[0].count,1);
      assert.deepEqual(auditMarkup(h.markup()).issues,[]);
    }finally{h.restore();db.close();}
  });
});

await test('served client imports only public presentation code and authenticated transport',async()=>{
  assert.equal(typeof globalThis.document,'undefined');
  const unloaded=await import('../public/game/app.js?import-has-no-side-effects');
  assert.equal(typeof unloaded.mountGame,'function');
  const app=await readFile(new URL('../public/game/app.js',import.meta.url),'utf8');
  const core=await readFile(new URL('../public/game/game-core.js',import.meta.url),'utf8');
  const state=await readFile(new URL('../public/game/state.js',import.meta.url),'utf8');
  assert.doesNotMatch(app+core+state,/makeDailySet|makePracticeSet|makePreviewSet|QUESTION_BANK|PRACTICE_BANK|scoreAnswers|calculatePerformance|question-variants|demoLeague|purchaseItem|commitDaily|reservePractice/);
  assert.doesNotMatch(app,/localStorage\.setItem\(STORAGE_KEY|reset-confirm|ad-preview-complete|preview-test/);
});
