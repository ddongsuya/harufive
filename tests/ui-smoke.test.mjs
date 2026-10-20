import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {makeDailySet,weeklyScore,weekKey,getFieldStats} from '../legacy/v040/game-core.js';
import {STORAGE_KEY,freshState} from '../legacy/v040/state.js';
import {REMINDER_STORAGE_KEY} from '../legacy/v040/reminders.js';
import {AUDIO_STORAGE_KEY} from '../legacy/v040/audio.js';

// Executes the real controller with minimal DOM surfaces. This is deliberately
// a browser-independent integration check, not a layout or real-browser test.
test('controller connects personalized timed play, unranked previews, calendar opt-in and purchased friends',async()=>{
  const realDate=globalThis.Date;
  let now=realDate.parse('2026-10-19T01:00:00Z');
  class ClockDate extends realDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const saved={};const names=['document','window','location','history','localStorage','Date','setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','matchMedia','URL'];
  for(const name of names)saved[name]=Object.getOwnPropertyDescriptor(globalThis,name);
  const events={},intervals=new Map(),storage=new Map(),fields=new Map(),downloads=[];let timerId=0,calendarStorageFails=false,fileExportFails=false;
  function surface(){return {innerHTML:'',dataset:{},classList:{add(){},remove(){}},open:false,style:{},textContent:'',addEventListener(name,fn){const prior=this['on'+name];this['on'+name]=event=>{prior?.(event);fn(event);};},querySelectorAll(){return[];},querySelector(){return null;},contains(){return false;},showModal(){this.open=true;},close(){this.open=false;},focus(){},setAttribute(){},scrollIntoView(){}};}
  const app=surface(),modal=surface(),toast=surface(),main=surface();
  const doc={activeElement:null,hidden:false,title:'',body:{appendChild(){}},createElement(){return {href:'',download:'',click(){},remove(){}};},querySelector(selector){return selector==='#app'?app:selector==='#modal'?modal:selector==='#toast'?toast:selector==='#main'?main:fields.get(selector)||null;},querySelectorAll(){return[];},getElementById(){return null;},addEventListener(name,fn){events[name]=fn;}};
  const assign=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  const NativeURL=globalThis.URL;assign('URL',class extends NativeURL{static createObjectURL(blob){if(fileExportFails)throw new Error('blocked');downloads.push(blob);return 'blob:controller-test';}static revokeObjectURL(){}});
  assign('Date',ClockDate);assign('document',doc);assign('window',{innerWidth:1000,scrollTo(){},addEventListener(name,fn){const prior=events[name];events[name]=event=>{prior?.(event);fn(event);};}});assign('location',{hash:''});assign('history',{replaceState(a,b,hash){location.hash=hash;}});assign('localStorage',{getItem(key){return storage.get(key)||null;},setItem(key,value){if(key===REMINDER_STORAGE_KEY&&calendarStorageFails)throw new Error('storage blocked');storage.set(key,value);}});
  assign('setTimeout',()=>++timerId);assign('clearTimeout',()=>{});assign('setInterval',fn=>{const id=++timerId;intervals.set(id,fn);return id;});assign('clearInterval',id=>intervals.delete(id));assign('requestAnimationFrame',fn=>fn());assign('matchMedia',()=>({matches:true}));
  function click(action,data={},inModal=false){const button={dataset:{action,...data},disabled:false,querySelector(){return null;}};(inModal?modal:app).onclick({target:{closest(){return button;}}});}
  function read(){return JSON.parse(storage.get(STORAGE_KEY));}
  function finish(questions=read().active.questions){for(const q of questions){if(q.visual?.type==='memory'){assert.match(app.innerHTML,/배열을 기억해 주세요/);click('memory-start');assert.match(app.innerHTML,/memory-grid/);const before=read().active.index;click('select',{option:String(q.answer)});click('answer');assert.equal(read().active.index,before,'submission during fixed exposure is blocked');now+=(q.visual.seconds+1)*1000;for(const fn of [...intervals.values()])fn();assert.match(app.innerHTML,/memory-note/);}now+=12000;click('select',{option:String(q.answer)});click('answer');}}
  try{
    if(process.env.HARU_TEST_BUNDLE_PATH){
      const html=fs.readFileSync(process.env.HARU_TEST_BUNDLE_PATH,'utf8');
      const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
      assert.ok(script,'standalone script exists');vm.runInThisContext(script,{filename:'standalone-game.js'});
    }else await import('../legacy/v040/app.js?integration');
    assert.match(app.innerHTML,/오늘의 도전 시작/);assert.equal(read().coins,180);
    assert.match(app.innerHTML,/data-action="sound"/);assert.equal(storage.has(AUDIO_STORAGE_KEY),false,'sound is opt-in');
    const beforeSound=read();click('sound');assert.equal(JSON.parse(storage.get(AUDIO_STORAGE_KEY)).enabled,true);assert.match(modal.innerHTML,/하루다섯의 소리/);assert.match(modal.innerHTML,/이 브라우저에서는 소리를 재생할 수 없어요/);
    modal.oninput({target:{dataset:{audioVolume:'musicVolume'},value:'12'}});modal.oninput({target:{dataset:{audioVolume:'effectsVolume'},value:'70'}});assert.equal(JSON.parse(storage.get(AUDIO_STORAGE_KEY)).musicVolume,.12);assert.equal(JSON.parse(storage.get(AUDIO_STORAGE_KEY)).effectsVolume,.7);assert.deepEqual(read(),beforeSound,'audio settings do not alter game records');
    const soundFields={'#audio-musicVolume':{value:'12'},'#audio-effectsVolume':{value:'70'},'#audio-musicVolume-value':surface(),'#audio-effectsVolume-value':surface()};
    for(const [selector,field] of Object.entries(soundFields))fields.set(selector,field);
    storage.set(AUDIO_STORAGE_KEY,JSON.stringify({enabled:true,musicVolume:.3,effectsVolume:.8}));events.storage({key:AUDIO_STORAGE_KEY});
    assert.equal(soundFields['#audio-musicVolume'].value,'30');assert.equal(soundFields['#audio-effectsVolume'].value,'80');assert.equal(soundFields['#audio-musicVolume-value'].textContent,'30%');assert.equal(soundFields['#audio-effectsVolume-value'].textContent,'80%');assert.deepEqual(read(),beforeSound,'synchronizing sound controls preserves game progress');
    for(const selector of Object.keys(soundFields))fields.delete(selector);
    click('audio-preview',{effect:'purchase'},true);await Promise.resolve();click('audio-toggle',{},true);assert.equal(JSON.parse(storage.get(AUDIO_STORAGE_KEY)).enabled,false);click('audio-toggle',{},true);assert.equal(JSON.parse(storage.get(AUDIO_STORAGE_KEY)).enabled,true);click('close-modal',{},true);
    assert.deepEqual(read().owned.filter(id=>id.startsWith('character-')),['character-rabbit']);
    click('daily');const officialQuestions=read().active.questions,playerId=read().playerId;
    assert.deepEqual(officialQuestions,makeDailySet('2026-10-19',playerId));
    click('preview-test');assert.match(modal.innerHTML,/진행 중인 문제가 있어요/);assert.deepEqual(read().active.questions,officialQuestions);click('close-modal',{},true);
    const originalClock=read().active.clock;click('nav',{view:'home'});now+=4000;click('daily');assert.deepEqual(read().active.clock,originalClock,'menu return preserves the start timestamp');
    doc.hidden=true;events.visibilitychange();now+=2500;doc.hidden=false;events.visibilitychange();assert.deepEqual(read().active.clock,originalClock,'audio visibility changes do not pause the question clock');
    finish(officialQuestions);
    assert.match(app.innerHTML,/다섯 문제 모두 맞혔어요/);assert.match(app.innerHTML,/시간 보너스/);assert.equal(read().results.length,1);assert.equal(read().results[0].baseScore,5000);assert.ok(read().results[0].score>5000&&read().results[0].score<=5099);assert.ok(read().results[0].totalTimeMs>=60000);assert.equal(read().results[0].timingComplete,true);assert.equal(read().coins,200);assert.deepEqual(read().results[0].questions,officialQuestions);
    const officialScore=read().results[0].score;
    // A reset in another tab must retire the displayed result as well as storage.
    const beforeOtherTabReset=read();storage.set(STORAGE_KEY,JSON.stringify(freshState()));events.storage({key:STORAGE_KEY});
    assert.equal(read().results.length,0);assert.doesNotMatch(app.innerHTML,/오늘의 기록이 쌓였어요/);assert.doesNotMatch(app.innerHTML,/완주 보상/);assert.match(app.innerHTML,/오늘의 도전 시작/);assert.equal(location.hash,'#home');
    storage.set(STORAGE_KEY,JSON.stringify(beforeOtherTabReset));events.storage({key:STORAGE_KEY});
    click('daily');assert.equal(read().results.length,1);assert.equal(read().coins,200);assert.equal(read().active,null);
    click('review');assert.match(app.innerHTML,/오늘의 풀이 노트/);
    assert.match(app.innerHTML,/내일도 도전할 수 있게 알림을 보내드릴까요/);
    click('reminder-later');assert.equal(JSON.parse(storage.get(REMINDER_STORAGE_KEY)).dismissedOn,'2026-10-19');
    assert.doesNotMatch(app.innerHTML,/data-action="reminder-later"/);
    click('nav',{view:'profile'});const beforeReminder=now;now=realDate.parse('2026-10-19T14:59:00Z');click('reminder-open');assert.match(modal.innerHTML,/캘린더 일정 파일 받기/);now=realDate.parse('2026-10-19T15:01:00Z');
    fields.set('#reminder-time',{value:'20:00'});click('reminder-time',{time:'08:00'},true);assert.equal(fields.get('#reminder-time').value,'08:00');
    click('reminder-file',{},true);assert.equal(downloads.length,1);assert.match(await downloads[0].text(),/DTSTART:20261019T230000Z/);now=beforeReminder;
    assert.equal(JSON.parse(storage.get(REMINDER_STORAGE_KEY)).status,'prepared');assert.match(modal.innerHTML,/캘린더에서 저장하면 준비 끝/);
    click('close-modal',{},true);click('reminder-open');assert.match(modal.innerHTML,/캘린더에 추가했어요/);
    click('reminder-confirm',{},true);assert.equal(JSON.parse(storage.get(REMINDER_STORAGE_KEY)).status,'confirmed');
    assert.match(app.innerHTML,/캘린더 등록 확인/);assert.equal(read().coins,200);assert.equal(read().results.length,1);
    click('reminder-open');click('reminder-instructions',{},true);click('reminder-new',{},true);fields.get('#reminder-time').value='22:00';
    fileExportFails=true;click('reminder-file',{},true);await Promise.resolve();fileExportFails=false;
    assert.equal(JSON.parse(storage.get(REMINDER_STORAGE_KEY)).status,'confirmed');assert.equal(JSON.parse(storage.get(REMINDER_STORAGE_KEY)).time,'08:00');
    assert.match(modal.innerHTML,/직접 등록 방법 보기/);
    click('reminder-manual',{},true);await Promise.resolve();assert.equal(JSON.parse(storage.get(REMINDER_STORAGE_KEY)).status,'prepared');
    calendarStorageFails=true;click('reminder-confirm',{},true);assert.match(toast.textContent,/확인 표시를 저장하지 못했어요/);calendarStorageFails=false;
    assert.equal(JSON.parse(storage.get(REMINDER_STORAGE_KEY)).status,'prepared');

    click('practice');finish();assert.equal(read().practiceHistory.length,1);assert.equal(read().results.length,1);assert.equal(read().coins,200);
    click('practice');assert.equal(modal.open,true);assert.match(modal.innerHTML,/실제 광고 재생이나 광고 수익은 발생하지 않아요/);
    click('close-modal',{},true);assert.equal(read().practiceUsage['2026-10-19'].ad,0);
    click('practice');click('ad-preview-complete',{},true);finish();
    assert.equal(read().practiceHistory.length,2);assert.equal(read().coins,200);assert.equal(weeklyScore(read().results,weekKey('2026-10-19')),officialScore);assert.equal(getFieldStats(read().results,'2026-10-19').reduce((sum,s)=>sum+s.total,0),5);
    click('practice');assert.match(modal.innerHTML,/모두 마쳤어요/);click('close-modal',{},true);
    const beforePreview=read();click('preview-test');const previewQuestions=read().active.questions;
    assert.equal(read().active.practiceKind,'preview');assert.notDeepEqual(previewQuestions.map(q=>q.prompt),officialQuestions.map(q=>q.prompt));finish(previewQuestions);assert.match(app.innerHTML,/새 문제 테스트 완료/);
    click('preview-test');assert.notDeepEqual(read().active.questions.map(q=>q.prompt),previewQuestions.map(q=>q.prompt));finish();
    const afterPreview=read();assert.equal(afterPreview.testRound,2);assert.equal(afterPreview.playerId,playerId);assert.equal(afterPreview.coins,beforePreview.coins);assert.deepEqual(afterPreview.results,beforePreview.results);assert.deepEqual(afterPreview.practiceHistory,beforePreview.practiceHistory);assert.deepEqual(afterPreview.practiceUsage,beforePreview.practiceUsage);
    click('nav',{view:'ranking'});assert.match(app.innerHTML,/가상 데이터/);
    click('nav',{view:'profile'});assert.match(app.innerHTML,/radar-chart/);
    click('nav',{view:'shop'});click('buy',{id:'outfit-lilac'});assert.equal(read().coins,80);assert.equal(read().equipped.outfit,'lilac');
    click('shop-select',{id:'outfit-peach'});assert.match(app.innerHTML,/data-action="buy" data-id="outfit-peach"[^>]*disabled/);assert.match(app.innerHTML,/60코인 더 모으면 구매할 수 있어요/);assert.equal(read().coins,80);assert.equal(read().equipped.outfit,'lilac');click('shop-select',{id:'outfit-lilac'});
    click('character',{id:'character-cat'});assert.equal(read().equipped.character,'rabbit');assert.match(modal.innerHTML,/220코인을 더 모으면/);assert.match(modal.innerHTML,/data-action="buy-character"[^>]*disabled/);assert.equal(read().coins,80);click('close-modal',{},true);
    assert.match(app.innerHTML,/1 \/ 6 친구 수집/);assert.equal((app.innerHTML.match(/data-action="character"/g)||[]).length,6);
    click('buy',{id:'outfit-lilac'});assert.equal(read().coins,80);
    click('try-premium');assert.match(app.innerHTML,/실제 구매 없이/);assert.equal(read().equipped.outfit,'lilac');assert.equal(read().coins,80);
    click('settlement-preview');assert.match(modal.innerHTML,/현재 내 등급이나 코인은 바뀌지 않아요/);assert.equal(read().coins,80);
    // Keep an unaffordable purchase open while another tab changes its balance.
    click('close-modal',{},true);click('shop-select',{id:'outfit-peach'});click('character',{id:'character-cat'});assert.match(modal.innerHTML,/220코인을 더 모으면/);assert.match(modal.innerHTML,/data-action="buy-character"[^>]*disabled/);
    // Fund only this in-memory test fixture to exercise purchase and reload.
    const funded={...read(),coins:1000};storage.set(STORAGE_KEY,JSON.stringify(funded));events.storage({key:STORAGE_KEY});
    assert.equal(modal.open,true);assert.doesNotMatch(modal.innerHTML,/220코인을 더 모으면/);assert.doesNotMatch(modal.innerHTML,/data-action="buy-character"[^>]*disabled/);assert.match(modal.innerHTML,/1,000/);
    assert.doesNotMatch(app.innerHTML,/data-action="buy" data-id="outfit-peach"[^>]*disabled/);assert.doesNotMatch(app.innerHTML,/60코인 더 모으면 구매할 수 있어요/);
    assert.equal(read().equipped.character,'rabbit');assert.equal(read().coins,1000);click('buy-character',{id:'character-cat'},true);assert.equal(read().coins,700);assert.equal(read().equipped.character,'cat');assert.equal(read().equipped.outfit,'lilac');assert.match(app.innerHTML,/2 \/ 6 친구 수집/);
    click('buy-character',{id:'character-cat'},true);assert.equal(read().coins,700,'duplicate confirmation never charges twice');events.storage({key:STORAGE_KEY});assert.ok(read().owned.includes('character-cat'));click('character',{id:'character-rabbit'});click('character',{id:'character-cat'});assert.equal(read().equipped.character,'cat');assert.equal(read().coins,700);

    // Foreground navigation and direct hash changes also cross calendar boundaries.
    const beforeNextDay=read();now=realDate.parse('2026-10-20T01:00:00Z');click('nav',{view:'ranking'});
    assert.match(app.innerHTML,/10월 20일/);assert.doesNotMatch(app.innerHTML,/10월 19일/);assert.equal(location.hash,'#ranking');assert.deepEqual(read().results,beforeNextDay.results);assert.deepEqual(read().owned,beforeNextDay.owned);assert.equal(read().coins,beforeNextDay.coins);
    now=realDate.parse('2026-10-26T01:00:00Z');location.hash='#profile';events.hashchange();
    assert.match(app.innerHTML,/10월 26일/);assert.equal(location.hash,'#profile');assert.ok(read().awards['2026-10-19']);assert.equal(read().coins,beforeNextDay.coins+read().awards['2026-10-19'].coins);assert.deepEqual(read().results,beforeNextDay.results);
    const afterSettlement=read();events.hashchange();assert.equal(read().coins,afterSettlement.coins,'revisiting the new week never awards twice');

    // A newer tab may already have started today's attempt before this tab wakes.
    now=realDate.parse('2026-10-27T01:00:00Z');const remoteQuestions=makeDailySet('2026-10-27',playerId),remoteStart=now-5000;
    const remoteActive={mode:'daily',date:'2026-10-27',index:0,answers:[],memory:remoteQuestions[0].visual?.type==='memory'?{0:{until:remoteStart}}:{},seed:0,questions:remoteQuestions,questionVersion:2,timingVersion:1,timings:[],clock:{index:0,startedAt:remoteStart}};
    storage.set(STORAGE_KEY,JSON.stringify({...afterSettlement,active:remoteActive}));events.storage({key:STORAGE_KEY});
    assert.deepEqual(read().active,remoteActive,'calendar sync preserves the other tab’s current-day attempt');click('nav',{view:'challenge'});assert.deepEqual(read().active.clock,remoteActive.clock,'resuming a synced attempt retains its original clock');
    now=realDate.parse('2026-10-28T01:00:00Z');events.pageshow();assert.match(app.innerHTML,/10월 28일/);assert.equal(read().active,null);assert.equal(location.hash,'#home');assert.deepEqual(read().results,beforeNextDay.results);assert.equal(read().coins,afterSettlement.coins);
  }finally{for(const name of names){if(saved[name])Object.defineProperty(globalThis,name,saved[name]);else delete globalThis[name];}}
});
