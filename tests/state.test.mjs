import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDailySet,scoreAnswers,weekKey,weeklyScore,weeklyPerformance,calculatePerformance,comparePerformance,getFieldStats} from '../legacy/v040/game-core.js';
import {CATALOG,STORAGE_KEY,freshState,normalizeState,commitDaily,settleWeeks,purchaseItem,equipItem,reservePractice,demoLeague,rankSummary} from '../legacy/v040/state.js';

function complete(date,correct=true,totalTimeMs=100000){
  const questions=makeDailySet(date),count=typeof correct==='number'?correct:correct?5:0;
  const part=Math.floor(totalTimeMs/5),times=totalTimeMs===null?[]:[part,part,part,part,totalTimeMs-part*4];
  return {...scoreAnswers(questions,questions.map((q,index)=>index<count?q.answer:(q.answer+1)%4),times),date,mode:'daily',seed:0};
}
function legacyComplete(date){
  const current=complete(date);
  return {date,mode:'daily',seed:0,score:1000,correct:5,total:5,details:current.details.map(({elapsedMs,...detail},index)=>({...detail,points:[100,150,200,250,300][index]}))};
}

test('official completion credits exactly once and preserves the first score',()=>{
  let s=freshState();const start=s.coins;
  s=commitDaily(s,complete('2026-10-19',false)).state;
  const duplicate=commitDaily(s,complete('2026-10-19',true));
  assert.equal(duplicate.added,false);assert.equal(s.coins,start+20);assert.equal(duplicate.state.results.length,1);assert.equal(duplicate.state.results[0].score,0);
});
test('practice never grants daily coins or pollutes official stats',()=>{
  const s=freshState(),practice={...complete('2026-10-19'),mode:'practice'};
  assert.throws(()=>commitDaily(s,practice));assert.equal(weeklyScore([practice],weekKey(practice.date)),0);assert.ok(getFieldStats([practice],practice.date).every(x=>x.total===0));
});
test('weekly settlement grants one award, retains history and starts new score at zero',()=>{
  const s=commitDaily(freshState(),complete('2026-10-18')).state;
  const next=settleWeeks(s,'2026-10-19'),repeat=settleWeeks(next,'2026-10-22');
  const award=next.awards['2026-10-12'];assert.ok(award);assert.equal(next.coins,s.coins+award.coins);assert.deepEqual(repeat,next);assert.equal(next.results.length,1);assert.equal(weeklyScore(next.results,'2026-10-19'),0);
});
test('new week play cannot change a badge already awarded for the previous week',()=>{
  const s=settleWeeks(commitDaily(freshState(),complete('2026-10-18')).state,'2026-10-19');
  const prior={...s.awards['2026-10-12']};const played=commitDaily(s,complete('2026-10-19')).state;
  const next=settleWeeks(played,'2026-10-20');assert.deepEqual(next.awards['2026-10-12'],prior);assert.equal(Object.keys(next.awards).length,1);
});
test('purchase and later equip spend the price only once',()=>{
  const s=purchaseItem(freshState(),'outfit-lilac');assert.equal(s.coins,60);assert.equal(s.equipped.outfit,'lilac');assert.equal(s.owned.filter(x=>x==='outfit-lilac').length,1);
  const changed=equipItem(s,'outfit-mint'),again=purchaseItem(changed,'outfit-lilac');assert.equal(again.coins,60);assert.equal(again.equipped.outfit,'lilac');
  assert.throws(()=>purchaseItem(s,'accessory-bag'));assert.equal(s.coins,60);assert.throws(()=>equipItem(s,'accessory-bag'));
});
test('version one saves gain only the default rabbit while retaining coins, clothes and original game history',()=>{
  const legacy={version:1,name:'나의토끼',coins:87,owned:['outfit-mint','hat-none','accessory-none','background-garden','outfit-lilac','hat-beret','accessory-scarf','background-lavender'],equipped:{outfit:'lilac',hat:'beret',accessory:'scarf',background:'lavender'},results:[legacyComplete('2026-10-18')],practiceHistory:[],practiceUsage:{'2026-10-18':{free:1,ad:0}},awards:{'2026-10-12':{week:'2026-10-12',tierId:'amber',coins:100}},active:null,createdAt:'2026-10-18'};
  const migrated=normalizeState(legacy);
  assert.equal(migrated.version,1);assert.equal(migrated.economyVersion,2);assert.equal(migrated.coins,87);assert.equal(migrated.name,legacy.name);
  assert.deepEqual(migrated.equipped,{character:'rabbit',...legacy.equipped});
  assert.deepEqual(migrated.results,legacy.results);assert.deepEqual(migrated.awards,legacy.awards);assert.deepEqual(migrated.practiceUsage,legacy.practiceUsage);
  assert.ok(legacy.owned.every(id=>migrated.owned.includes(id)));
  assert.equal(migrated.owned.length,legacy.owned.length+1);
  assert.deepEqual(normalizeState(migrated),migrated);
});
test('v0.2 free character grants migrate once, without removing clothes or charging coins',()=>{
  const legacy={...freshState(),coins:1111,owned:[...CATALOG.filter(i=>i.slot==='character'||i.cost===0).map(i=>i.id),'outfit-wizard','hat-crown'],equipped:{character:'fox',outfit:'wizard',hat:'crown',accessory:'none',background:'garden'},results:[legacyComplete('2026-10-18')]};
  delete legacy.economyVersion;
  const migrated=normalizeState(legacy);
  assert.equal(migrated.coins,1111);assert.equal(migrated.equipped.character,'rabbit');
  assert.equal(migrated.equipped.outfit,'wizard');assert.equal(migrated.equipped.hat,'crown');
  assert.deepEqual(migrated.owned.filter(id=>id.startsWith('character-')),['character-rabbit']);
  assert.deepEqual(migrated.results,legacy.results);assert.equal(migrated.playerId,legacy.playerId);
  const purchased=purchaseItem(migrated,'character-fox');
  const reloaded=normalizeState(JSON.parse(JSON.stringify(purchased)));
  assert.deepEqual(reloaded,purchased);assert.equal(reloaded.equipped.character,'fox');assert.equal(reloaded.coins,461);
  assert.equal(purchaseItem(reloaded,'character-fox').coins,461);
});
test('only the rabbit is free and each other character must be bought before equipping',()=>{
  const fresh=freshState();assert.equal(fresh.coins,180);
  assert.deepEqual(CATALOG.filter(i=>i.slot==='character').map(({value,cost})=>[value,cost]),[['rabbit',0],['cat',300],['bear',450],['fox',650],['puppy',500],['penguin',800]]);
  assert.deepEqual(fresh.owned.filter(id=>id.startsWith('character-')),['character-rabbit']);
  for(const character of ['cat','bear','fox','puppy','penguin']) {
    assert.throws(()=>equipItem(fresh,'character-'+character));assert.throws(()=>purchaseItem(fresh,'character-'+character));
    const funded={...fresh,coins:1000,equipped:{...fresh.equipped,outfit:'mint'}};
    const item=CATALOG.find(i=>i.id==='character-'+character),bought=purchaseItem(funded,item.id);
    assert.equal(bought.coins,1000-item.cost);assert.equal(bought.equipped.character,character);
    assert.equal(bought.name,fresh.name);assert.equal(bought.equipped.outfit,'mint');assert.equal(bought.playerId,fresh.playerId);
    const reloaded=normalizeState(JSON.parse(JSON.stringify(bought)));
    assert.equal(reloaded.equipped.character,character);assert.equal(reloaded.owned.filter(id=>id===item.id).length,1);
    assert.deepEqual(purchaseItem(equipItem(reloaded,'character-rabbit'),item.id),reloaded);
  }
  const recovered=normalizeState({...fresh,equipped:{...fresh.equipped,character:'missing-character'}});
  assert.equal(recovered.equipped.character,'rabbit');assert.equal(recovered.coins,180);
});
test('expanded wardrobe purchases survive reloads and character changes without charging twice',()=>{
  let s={...freshState(),coins:2800};
  const selected=['outfit-wizard','hat-crown','accessory-wand','background-cloud'];
  for(const id of selected)s=purchaseItem(s,id);
  assert.equal(s.coins,1360);
  s=normalizeState(JSON.parse(JSON.stringify(s)));
  s=purchaseItem(s,'character-penguin');
  assert.deepEqual(s.equipped,{character:'penguin',outfit:'wizard',hat:'crown',accessory:'wand',background:'cloud'});
  for(const id of selected)s=purchaseItem(s,id);
  assert.equal(s.coins,560);assert.ok(selected.every(id=>s.owned.filter(owned=>owned===id).length===1));
  s=equipItem(equipItem(s,'hat-none'),'accessory-none');
  assert.equal(s.equipped.hat,'none');assert.equal(s.equipped.accessory,'none');assert.equal(s.equipped.outfit,'wizard');
  const ids=CATALOG.map(item=>item.id);assert.equal(new Set(ids).size,ids.length);
});
test('each extra practice channel is limited to one per day and does not change score or coins',()=>{
  const s=freshState(),a=reservePractice(s,'2026-10-19','free'),b=reservePractice(a,'2026-10-19','ad');assert.equal(b.coins,s.coins);assert.deepEqual(b.results,[]);assert.throws(()=>reservePractice(b,'2026-10-19','ad'));assert.throws(()=>reservePractice(b,'2026-10-19','free'));assert.equal(reservePractice(b,'2026-10-20','free').practiceUsage['2026-10-20'].free,1);
});
test('invalid saved dates and incomplete results cannot crash settlement on reload',()=>{
  const valid=complete('2026-10-19');const s=normalizeState({...freshState(),results:[{...valid,date:'invalid'},{...valid,date:'2026-02-31'},{...valid,total:4},valid,valid],active:{mode:'daily',date:'bad',index:0,answers:[]}});
  assert.equal(s.results.length,1);assert.equal(s.active,null);assert.doesNotThrow(()=>settleWeeks(s,'2026-10-26'));
});
test('anonymous identity remains stable through reloads and nickname edits; a fresh game gets a new identity',()=>{
  const first=freshState();assert.ok(first.playerId);assert.equal(STORAGE_KEY,'haru-five-playtest-v1');
  assert.notEqual(freshState().playerId,first.playerId);
  const renamed=normalizeState({...JSON.parse(JSON.stringify(first)),name:'새이름',testRound:6});
  assert.equal(renamed.playerId,first.playerId);assert.equal(renamed.name,'새이름');assert.equal(renamed.testRound,6);
  for(const testRound of [-1,1.5,Infinity,'4',Number.MAX_SAFE_INTEGER+1])assert.equal(normalizeState({...first,testRound}).testRound,0);
  const legacy={...first};delete legacy.playerId;const migrated=normalizeState(legacy);
  assert.ok(migrated.playerId);assert.equal(normalizeState(migrated).playerId,migrated.playerId);
});
test('question snapshots and timing checkpoints survive reload for official and unranked sessions',()=>{
  const questions=makeDailySet('2026-10-19');
  const active={mode:'daily',date:'2026-10-19',index:1,answers:[0],questions,timingVersion:1,timings:[24680],clock:{startedAt:1792364400000,index:1},memory:{0:{until:1792364410000}},seed:0};
  const result={...complete('2026-10-18'),questions:makeDailySet('2026-10-18'),times:[20000,20000,20000,20000,20000]};
  const loaded=normalizeState(JSON.parse(JSON.stringify({...freshState(),active,results:[result]})));
  assert.deepEqual(loaded.active,active);assert.deepEqual(loaded.results,[result]);
  assert.ok(result.score>5000&&result.score<=5099);
  const preview=normalizeState({...loaded,active:{...active,mode:'practice',practiceKind:'preview'}});
  assert.equal(preview.active.mode,'practice');assert.equal(preview.active.practiceKind,'preview');
  assert.throws(()=>commitDaily(preview,{...result,mode:'practice'}));
  const malformedClock={startedAt:'invalid',index:1};
  assert.deepEqual(normalizeState({...loaded,active:{...active,clock:malformedClock}}).active.clock,malformedClock);
});
test('legacy scores remain intact and missing times never receive an invented speed bonus',()=>{
  const old=legacyComplete('2026-10-19'),timed=complete('2026-10-20',4,150000);
  const loaded=normalizeState({...freshState(),results:[old,timed]});
  assert.deepEqual(loaded.results[0],old);assert.equal(loaded.results[0].score,1000);
  const summary=rankSummary(loaded,'2026-10-20');
  assert.equal(summary.correct,9);assert.equal(summary.baseScore,9000);assert.equal(summary.speedBonus,0);
  assert.equal(summary.score,9000);assert.equal(summary.totalTimeMs,null);assert.equal(summary.timingComplete,false);
  assert.equal(summary.playedDays,2);assert.equal(summary.participated,true);
});
test('weekly rank puts accuracy first and uses total measured submission time for equal accuracy',()=>{
  const day='2026-10-19',fast=rankSummary({...freshState(),results:[complete(day,4,60000)]},day),slow=rankSummary({...freshState(),results:[complete(day,4,500000)]},day);
  assert.ok(fast.score>slow.score);assert.ok(fast.rank<slow.rank);
  const accurate=rankSummary({...freshState(),results:[complete(day,4,36000000)]},day),lessAccurate=rankSummary({...freshState(),results:[complete(day,3,1)]},day);
  assert.ok(accurate.score>lessAccurate.score);assert.ok(comparePerformance(accurate,lessAccurate)<0);assert.ok(accurate.rank<=lessAccurate.rank);
  const results=[complete(day,4,100000),complete('2026-10-20',3,200000)];
  const weekly=rankSummary({...freshState(),results},'2026-10-20');
  assert.deepEqual(weeklyPerformance(results,day),{...calculatePerformance(7,300000),playedDays:2});
  assert.equal(weekly.score,weeklyScore(results,day));assert.ok(weekly.score<results.reduce((sum,r)=>sum+r.score,0));
});
test('fictional opponents follow daily and weekly timing rules and share genuine ties',()=>{
  const week='2026-10-19',dayRows=demoLeague(week,week),weekRows=demoLeague(week);
  assert.deepEqual(demoLeague(week,week),dayRows);
  for(const [rows,maximum]of [[dayRows,5],[weekRows,35]])for(let index=0;index<rows.length;index++) {
    const row=rows[index];assert.ok(row.correct>=0&&row.correct<=maximum);assert.ok(row.playedDays>=0&&row.playedDays<=maximum/5);
    assert.equal(row.score,calculatePerformance(row.correct,row.totalTimeMs).score);assert.equal(row.sample,true);
    if(index>0){const order=comparePerformance(rows[index-1],row);assert.ok(order<=0);assert.equal(row.rank,order===0?rows[index-1].rank:index+1);}
  }
  const allWrong=dayRows.filter(row=>row.correct===0);assert.ok(allWrong.length>1);assert.equal(new Set(allWrong.map(row=>row.rank)).size,1);
  const candidate=dayRows.find(row=>row.correct>0&&calculatePerformance(row.correct,row.totalTimeMs+1).score===row.score);
  assert.ok(candidate);
  const tied=rankSummary({...freshState(),results:[complete(week,candidate.correct,candidate.totalTimeMs)]},week);
  assert.equal(tied.score,candidate.score);assert.equal(tied.rank,candidate.rank);
  const slower=rankSummary({...freshState(),results:[complete(week,candidate.correct,candidate.totalTimeMs+1)]},week);
  assert.equal(slower.score,tied.score);assert.ok(slower.rank>tied.rank);
  const noAnswer=rankSummary({...freshState(),results:[complete(week,0,1000)]},week);
  assert.equal(noAnswer.rank,allWrong[0].rank);
});
test('settled legacy awards remain unchanged after the timing scoring update',()=>{
  const award={week:'2026-10-12',score:1000,rank:2,total:1000,tierId:'aurora',tierName:'오로라',coins:600,awardedAt:'2026-10-19'};
  const state=normalizeState({...freshState(),results:[legacyComplete('2026-10-18')],awards:{'2026-10-12':award},coins:900});
  const settled=settleWeeks(state,'2026-10-26');assert.equal(settled.coins,900);assert.deepEqual(settled.awards['2026-10-12'],award);
});
