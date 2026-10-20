import { dateKey, weekKey, addDays, calculatePerformance, weeklyPerformance, comparePerformance, rankTier } from './game-core.js';

export const STORAGE_KEY = 'haru-five-playtest-v1';
export const DAILY_COMPLETION_COINS = 20;
export const CATALOG = [
  { id:'character-rabbit',slot:'character',value:'rabbit',name:'구름토끼',cost:0,description:'쫑긋한 두 귀로 하루를 맞이해요.',color:'#f6e9dc' },
  { id:'character-cat',slot:'character',value:'cat',name:'달빛고양이',cost:300,description:'호기심 가득한 눈으로 새로운 걸 찾아요.',color:'#e8e2f2' },
  { id:'character-bear',slot:'character',value:'bear',name:'꿀잠곰',cost:450,description:'느긋한 걸음에도 반짝이는 생각이 가득.',color:'#ead8bf' },
  { id:'character-fox',slot:'character',value:'fox',name:'단풍여우',cost:650,description:'폭신한 꼬리를 살랑이며 함께 풀어요.',color:'#f6d9c1' },
  { id:'character-puppy',slot:'character',value:'puppy',name:'밀크강아지',cost:500,description:'작은 발견에도 신나게 꼬리를 흔들어요.',color:'#efe6d6' },
  { id:'character-penguin',slot:'character',value:'penguin',name:'꼬마펭귄',cost:800,description:'뒤뚱뒤뚱, 오늘의 도전까지 한 걸음.',color:'#dce9ef' },
  { id:'outfit-mint',slot:'outfit',value:'mint',name:'민트 산책복',cost:0,description:'처음 만난 날의 산뜻한 민트.',color:'#d6ecdd' },
  { id:'outfit-lilac',slot:'outfit',value:'lilac',name:'라일락 니트',cost:120,description:'보송보송, 구름처럼 가벼운 니트.',color:'#e9dff7' },
  { id:'outfit-peach',slot:'outfit',value:'peach',name:'복숭아 가디건',cost:140,description:'햇살 좋은 날 꺼내 입어요.',color:'#f9e1d3' },
  { id:'outfit-sky',slot:'outfit',value:'sky',name:'소다 멜빵',cost:160,description:'맑은 하늘을 닮은 멜빵옷.',color:'#dbeaf7' },
  { id:'outfit-lemon',slot:'outfit',value:'lemon',name:'레몬 줄무늬',cost:120,description:'상큼한 노랑 줄무늬를 한 줄씩.',color:'#f5edbd' },
  { id:'outfit-rose',slot:'outfit',value:'rose',name:'장미 리본 원피스',cost:160,description:'분홍빛 옷자락에 작은 리본 하나.',color:'#f2d8e0' },
  { id:'outfit-cocoa',slot:'outfit',value:'cocoa',name:'코코아 조끼',cost:180,description:'따뜻한 코코아가 생각나는 날.',color:'#e7d5c7' },
  { id:'outfit-sailor',slot:'outfit',value:'sailor',name:'바다 세일러복',cost:220,description:'파란 옷깃을 펴고 모험을 떠나요.',color:'#dbe7ee' },
  { id:'outfit-raincoat',slot:'outfit',value:'raincoat',name:'노랑 비옷',cost:240,description:'빗방울이 톡톡, 산책은 계속돼요.',color:'#f4e6ae' },
  { id:'outfit-overalls',slot:'outfit',value:'overalls',name:'주머니 작업복',cost:200,description:'큼직한 주머니에 오늘의 발견을 담아요.',color:'#d8e2ed' },
  { id:'outfit-wizard',slot:'outfit',value:'wizard',name:'별 수놓은 망토',cost:360,description:'작은 마법사를 위한 반짝이는 망토.',color:'#e1d9ef' },
  { id:'outfit-strawberry',slot:'outfit',value:'strawberry',name:'딸기 케이프',cost:320,description:'달콤한 딸기 한 알처럼 동글동글.',color:'#f5d9dc' },
  { id:'hat-none',slot:'hat',value:'none',name:'모자 벗기',cost:0,description:'오늘은 가볍게, 맨머리로 산책해요.',color:'#f0eee8' },
  { id:'hat-beret',slot:'hat',value:'beret',name:'동그란 베레모',cost:140,description:'오늘은 작은 화가처럼.',color:'#e8def2' },
  { id:'hat-flower',slot:'hat',value:'flower',name:'데이지 꽃핀',cost:100,description:'귀 끝에 핀 작은 봄.',color:'#f5ecd0' },
  { id:'hat-star',slot:'hat',value:'star',name:'별빛 머리핀',cost:220,description:'한 알의 반짝임을 달아요.',color:'#f3e8c7' },
  { id:'hat-crown',slot:'hat',value:'crown',name:'조그만 왕관',cost:400,description:'오늘의 주인공에게 꼭 맞는 왕관.',color:'#f1e3ad' },
  { id:'hat-straw',slot:'hat',value:'straw',name:'피크닉 밀짚모자',cost:180,description:'햇살을 살짝 가려 주는 넓은 챙.',color:'#eee0ba' },
  { id:'hat-beanie',slot:'hat',value:'beanie',name:'방울 비니',cost:160,description:'폭신한 털방울이 걸음마다 살랑.',color:'#e1dcec' },
  { id:'hat-sprout',slot:'hat',value:'sprout',name:'새싹 머리띠',cost:80,description:'머리 위에서 자라는 작은 초록.',color:'#dce9cf' },
  { id:'hat-mushroom',slot:'hat',value:'mushroom',name:'숲속 버섯모자',cost:220,description:'동그란 점무늬 아래 숲의 친구가 돼요.',color:'#efd5cd' },
  { id:'hat-ribbon',slot:'hat',value:'ribbon',name:'체리 리본',cost:120,description:'톡 묶어 올린 발그레한 포인트.',color:'#f2d9df' },
  { id:'hat-headphones',slot:'hat',value:'headphones',name:'산책 헤드폰',cost:280,description:'좋아하는 노래와 발맞춰 걸어요.',color:'#dcddee' },
  { id:'accessory-none',slot:'accessory',value:'none',name:'소품 내려놓기',cost:0,description:'가볍게 떠나는 하루.',color:'#f0eee8' },
  { id:'accessory-scarf',slot:'accessory',value:'scarf',name:'포근한 목도리',cost:160,description:'선선한 바람이 불어도 따뜻하게.',color:'#ece0f1' },
  { id:'accessory-bag',slot:'accessory',value:'bag',name:'도토리 크로스백',cost:180,description:'작은 발견을 차곡차곡 담아요.',color:'#e9d9c4' },
  { id:'accessory-bell',slot:'accessory',value:'bell',name:'금빛 방울',cost:80,description:'걸음마다 딸랑, 기분 좋은 소리.',color:'#f0e3b4' },
  { id:'accessory-glasses',slot:'accessory',value:'glasses',name:'동글 안경',cost:180,description:'궁금한 세상을 조금 더 가까이.',color:'#e0dee8' },
  { id:'accessory-book',slot:'accessory',value:'book',name:'비밀 수첩',cost:160,description:'떠오른 생각을 한 장씩 모아요.',color:'#d7e5e0' },
  { id:'accessory-balloon',slot:'accessory',value:'balloon',name:'복숭아 풍선',cost:140,description:'하늘로 둥실, 손끝에 매달린 설렘.',color:'#f3d9d5' },
  { id:'accessory-wand',slot:'accessory',value:'wand',name:'별사탕 지팡이',cost:320,description:'톡, 오늘도 좋은 일이 생길 거예요.',color:'#ece1f2' },
  { id:'accessory-camera',slot:'accessory',value:'camera',name:'찰칵 필름 카메라',cost:360,description:'잊고 싶지 않은 순간을 담아요.',color:'#dbdfe6' },
  { id:'accessory-flowerbasket',slot:'accessory',value:'flowerbasket',name:'들꽃 바구니',cost:240,description:'산책길의 작은 꽃들을 한아름.',color:'#e9e2c9' },
  { id:'accessory-lantern',slot:'accessory',value:'lantern',name:'반딧불 랜턴',cost:260,description:'해가 져도 포근하게 비추는 불빛.',color:'#eee3c2' },
  { id:'background-garden',slot:'background',value:'garden',name:'햇살 정원',cost:0,description:'꽃이 피어 있는 나만의 정원.',color:'#dcebdc' },
  { id:'background-lavender',slot:'background',value:'lavender',name:'라벤더 오후',cost:240,description:'느긋하게 머물고 싶은 오후.',color:'#e8dff1' },
  { id:'background-beach',slot:'background',value:'beach',name:'조개빛 해변',cost:280,description:'잔잔한 파도와 모래 위 작은 발자국.',color:'#d8eaf0' },
  { id:'background-forest',slot:'background',value:'forest',name:'도토리 숲길',cost:220,description:'나뭇잎 사이로 햇빛이 내려앉아요.',color:'#d4e4cf' },
  { id:'background-sunset',slot:'background',value:'sunset',name:'살구빛 노을',cost:320,description:'하루 끝에 만나는 따뜻한 하늘.',color:'#f1d8cc' },
  { id:'background-snow',slot:'background',value:'snow',name:'첫눈 내린 마을',cost:260,description:'소복한 눈밭에 나만의 발자국을.',color:'#e2eaf0' },
  { id:'background-cloud',slot:'background',value:'cloud',name:'구름 위 쉼터',cost:360,description:'폭신한 구름에 잠시 앉아 쉬어요.',color:'#e1e4f4' },
  { id:'background-cafe',slot:'background',value:'cafe',name:'작은 창가 카페',cost:440,description:'따뜻한 한 잔과 나른한 햇살.',color:'#e9ddcf' },
];
export const COLLECTION = {name:'별을 모으는 밤',price:4900,description:'밤하늘 의상 · 별 머리핀 · 작은 날개 · 별빛 배경',outfit:{outfit:'navy',hat:'star',accessory:'wings',background:'night'}};

function newPlayerId() {
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  if(globalThis.crypto?.getRandomValues) {
    const parts=globalThis.crypto.getRandomValues(new Uint32Array(4));
    return Array.from(parts,part=>part.toString(16).padStart(8,'0')).join('');
  }
  return 'player-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
}
export function freshState() {
  return {version:1,economyVersion:2,playerId:newPlayerId(),testRound:0,name:'구름토끼',coins:180,owned:CATALOG.filter(i=>i.cost===0).map(i=>i.id),equipped:{character:'rabbit',outfit:'mint',hat:'none',accessory:'none',background:'garden'},results:[],practiceHistory:[],practiceUsage:{},awards:{},active:null,createdAt:dateKey()};
}
function validDay(key) {
  if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key))return false;
  try{return new Date(key+'T00:00:00Z').toISOString().slice(0,10)===key;}catch{return false;}
}
function validResult(r) {
  return !!r&&r.mode==='daily'&&validDay(r.date)&&Number.isFinite(r.score)&&r.score>=0&&r.score<=5099&&Number.isInteger(r.correct)&&r.correct>=0&&r.correct<=5&&r.total===5&&Array.isArray(r.details)&&r.details.length===5;
}
export function normalizeState(value) {
  const initial=freshState();
  if (!value || value.version!==1 || !Array.isArray(value.results)) return initial;
  // v0.2 granted every character for free. Retire that grant once; preserve paid
  // character purchases from this economy version and all existing cosmetics.
  const retainedOwned=(Array.isArray(value.owned)?value.owned:[]).filter(id=>{
    const item=CATALOG.find(i=>i.id===id);
    return !!item&&(value.economyVersion===2||item.slot!=='character'||item.value==='rabbit');
  });
  const owned=[...new Set([...initial.owned,...retainedOwned])];
  const equipped={...initial.equipped};
  for (const item of CATALOG) if(owned.includes(item.id)&&value.equipped?.[item.slot]===item.value) equipped[item.slot]=item.value;
  const dates=new Set();
  const results=value.results.filter(r=>{if(!validResult(r)||dates.has(r.date))return false;dates.add(r.date);return true;});
  const awards=Object.fromEntries(Object.entries(value.awards&&typeof value.awards==='object'?value.awards:{}).filter(([key,a])=>validDay(key)&&a&&a.week===key&&typeof a.tierId==='string'));
  const source=value.active;
  const active=source&&['daily','practice'].includes(source.mode)&&validDay(source.date)&&Number.isInteger(source.index)&&source.index>=0&&source.index<5&&Array.isArray(source.answers)&&source.answers.length<=5?{...source,memory:source.memory&&typeof source.memory==='object'?source.memory:{},seed:Number.isSafeInteger(source.seed)&&source.seed>=0?source.seed:0}:null;
  const playerId=typeof value.playerId==='string'&&value.playerId.trim().length>0&&value.playerId.length<=128?value.playerId:initial.playerId;
  const testRound=Number.isSafeInteger(value.testRound)&&value.testRound>=0?value.testRound:0;
  return {...initial,...value,economyVersion:2,playerId,testRound,name:typeof value.name==='string'?value.name.slice(0,12):initial.name,coins:Number.isFinite(value.coins)?Math.max(0,Math.floor(value.coins)):initial.coins,owned,equipped,results,practiceHistory:Array.isArray(value.practiceHistory)?value.practiceHistory:[],practiceUsage:value.practiceUsage&&typeof value.practiceUsage==='object'?value.practiceUsage:{},awards,active};
}
function hash(input) {let h=2166136261;for(const c of input){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
const NAMES=['밤하늘고양이','산책하는곰','새벽여우','달빛토끼','도토리다람쥐','말랑오리','구름수달','복숭아펭귄','느긋한판다','초록참새','별빛고슴도치','라일락사슴'];
const CHARACTER_VALUES=CATALOG.filter(item=>item.slot==='character').map(item=>item.value);

// All opponents are explicitly labeled fictional in the product. No network leaderboard is implied.
export function demoLeague(week,throughDate=addDays(week,6)) {
  const days=Math.max(0,Math.min(7,Math.floor((Date.parse(throughDate+'T00:00:00Z')-Date.parse(week+'T00:00:00Z'))/86400000)+1));
  const rows=Array.from({length:999},(_,i)=>{
    let correct=0,totalTimeMs=0,playedDays=0;
    for(let d=0;d<days;d++) {
      const h=hash(week+':'+i+':'+d);
      if(h%11===0)continue;
      playedDays++;
      for(let index=0;index<5;index++) {
        correct+=(h>>>(index+5))&1;
        totalTimeMs+=10000+index*4000+(hash(week+':'+i+':'+d+':'+index+':time')%65001);
      }
    }
    const performance=calculatePerformance(correct,playedDays?totalTimeMs:null);
    return {id:'sample-'+i,name:NAMES[i%NAMES.length]+(i<NAMES.length?'':String(i+1)),...performance,playedDays,character:CHARACTER_VALUES[i%CHARACTER_VALUES.length],outfit:['mint','lilac','peach','sky'][i%4],sample:true};
  }).sort((a,b)=>comparePerformance(a,b)||a.id.localeCompare(b.id));
  let rank=1;
  return rows.map((row,index)=>{
    if(index===0||comparePerformance(rows[index-1],row)!==0)rank=index+1;
    return {...row,rank};
  });
}
export function rankSummary(state,today=dateKey(),week=weekKey(today)) {
  const performance=weeklyPerformance(state.results,week);
  const opponents=demoLeague(week,today);
  const rank=opponents.filter(r=>comparePerformance(r,performance)<0).length+1;
  const total=opponents.length+1;
  const participated=performance.playedDays>0;
  return {...performance,rank,total,participated,tier:rankTier(rank,total),opponents};
}
export function commitDaily(state,result) {
  if(!validResult(result)) throw new Error('올바른 오늘의 도전 결과가 아니에요.');
  if(state.results.some(r=>r.mode==='daily'&&r.date===result.date)) return {state,added:false};
  return {state:{...state,results:[...state.results,result],coins:state.coins+DAILY_COMPLETION_COINS,active:null},added:true};
}
export function settleWeeks(state,today=dateKey()) {
  const current=weekKey(today);
  let next={...state,awards:{...state.awards}};
  for(const week of [...new Set(state.results.filter(r=>r.mode==='daily').map(r=>weekKey(r.date)))].filter(w=>w<current).sort()) {
    if(next.awards[week])continue;
    const summary=rankSummary(next,addDays(week,6),week);
    const amount=summary.tier.reward;
    next.awards[week]={week,score:summary.score,correct:summary.correct,totalTimeMs:summary.totalTimeMs,timingComplete:summary.timingComplete,playedDays:summary.playedDays,rank:summary.rank,total:summary.total,tierId:summary.tier.id,tierName:summary.tier.name,coins:amount,awardedAt:today};
    next.coins+=amount;
  }
  return next;
}
export function purchaseItem(state,id) {
  const item=CATALOG.find(i=>i.id===id);
  if(!item)throw new Error('상품을 찾을 수 없어요.');
  if(state.owned.includes(id))return equipItem(state,id);
  if(state.coins<item.cost)throw new Error('코인이 조금 더 필요해요. 오늘의 도전을 완료해 보세요.');
  return {...state,coins:state.coins-item.cost,owned:[...state.owned,id],equipped:{...state.equipped,[item.slot]:item.value}};
}
export function equipItem(state,id) {
  const item=CATALOG.find(i=>i.id===id);
  if(!item||!state.owned.includes(id))throw new Error('아직 가지고 있지 않은 아이템이에요.');
  return {...state,equipped:{...state.equipped,[item.slot]:item.value}};
}
export function reservePractice(state,today,source='free') {
  const usage={free:0,ad:0,...state.practiceUsage[today]};
  if(!['free','ad'].includes(source)||usage[source]>=1)throw new Error('오늘의 추가 연습을 모두 즐겼어요. 내일 다시 만나요.');
  usage[source]+=1;
  return {...state,practiceUsage:{...state.practiceUsage,[today]:usage}};
}
