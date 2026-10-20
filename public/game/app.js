import { FIELDS, TIERS, dateKey, weekKey, addDays, getFieldStats } from './game-core.js';
import { drawAvatar, drawItem } from './avatar.js';
import { AUDIO_STORAGE_KEY, normalizeAudioSettings, createAudioController } from './audio.js';
import { STORAGE_KEY, DAILY_COMPLETION_COINS, DEFAULT_EQUIPPED, CATALOG, COLLECTION, rankSummary, readLegacyRecord } from './state.js';
import { REMINDER_STORAGE_KEY, freshReminder, normalizeReminder, validReminderTime, reminderTimeLabel, shouldOfferReminder, createCalendarReminder } from './reminders.js';
import { createGameApi, createRequestId } from './api.js';
import { SOCIAL_PROVIDERS, SITES_SIGN_IN, providerName, callbackNotice, createAuthApi } from './auth.js';

import { createPrivacyApi } from './privacy.js';
import { privacyPage, guardianPage } from './privacy-views.js';

const SUPPORT_EMAIL = 'limjm900202@gmail.com';

/** Start a game surface only after its React host confirms the mount is current. */
export function mountGame(){
const app=document.querySelector('#app'),modal=document.querySelector('#modal'),toastEl=document.querySelector('#toast');
const VALID_VIEWS=['home','challenge','result','ranking','profile','shop','privacy','guardian'];
const MUTATION_ACTIONS=['daily','practice','answer','memory-start','buy','equip','character','buy-character','save-name','select'];
let state=null,today=dateKey(),storageAvailable=true,connection='loading',connectionError='',signInUrl='/signin-with-chatgpt?return_to=%2F';
const api=createGameApi();
const authApi=createAuthApi();
let privacyApi=createPrivacyApi(),privacyEpoch=0,privacyConfirmation=null,privacyModal=false;
let privacy={loading:false,busy:false,status:null,children:[],hasMore:false,selected:null,error:'',notice:'',uncertain:false};
let authStatus=null,authError='',authBusy=false,authPromise=null,logoutUnconfirmed=false,authNotice=callbackNotice(location.search||'');
if(location.href&&location.search){
  const clean=new URL(location.href);
  if(clean.searchParams.has('auth')||clean.searchParams.has('auth_error')){
    clean.searchParams.delete('auth');clean.searchParams.delete('auth_error');
    history.replaceState(null,'',clean.pathname+clean.search+clean.hash);
  }
}
let syncPromise=null,syncing=false,transaction=null,pending=false,syncAfter=false,disposed=false;
const hiddenMemories=new Set(),memorySyncRequested=new Set();
function readLegacy(){try{return readLegacyRecord(localStorage.getItem(STORAGE_KEY));}catch{return null;}}
let legacyRecord=readLegacy();
function readReminder(){try{const raw=localStorage.getItem(REMINDER_STORAGE_KEY);return raw?normalizeReminder(JSON.parse(raw)):freshReminder();}catch{return freshReminder();}}
let reminder=readReminder();
function saveReminder(){try{localStorage.setItem(REMINDER_STORAGE_KEY,JSON.stringify(reminder));return true;}catch{storageAvailable=false;return false;}}
const ui={view:VALID_VIEWS.includes(location.hash.slice(1))?location.hash.slice(1):'home',selected:null,result:null,review:false,field:'spatial',shopTab:'shop',filter:'all',shopItem:'outfit-lilac',premiumPreview:false,avatarHappy:false};
let memoryTimer=null,elapsedTimer=null,toastTimer=null,celebrationTimer=null,refreshGameModal=null;
let audioStorageAvailable=true;
function readAudioSettings(){try{const raw=localStorage.getItem(AUDIO_STORAGE_KEY);return normalizeAudioSettings(raw?JSON.parse(raw):null);}catch{return normalizeAudioSettings(null);}}
let audioSettings=readAudioSettings(),sound=null;
sound=createAudioController({onStatus:refreshAudioUI});
sound.setSettings(audioSettings);sound.setHidden(document.hidden);
function saveAudioSettings(){try{localStorage.setItem(AUDIO_STORAGE_KEY,JSON.stringify(audioSettings));audioStorageAvailable=true;}catch{audioStorageAvailable=false;}}
function applyAudioSettings(next){audioSettings=normalizeAudioSettings({...audioSettings,...next});saveAudioSettings();sound.setSettings(audioSettings);refreshAudioUI(sound.getStatus());}
function wakeAudio(){if(audioSettings.enabled&&!sound.getStatus().ready)void sound.unlock().catch(()=>{});}
function playSound(name){
  if(!audioSettings.enabled)return;
  if(sound.getStatus().ready){sound.play(name);return;}
  void sound.unlock().then(ready=>{if(ready&&audioSettings.enabled)sound.play(name);}).catch(()=>{});
}

function escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function supportContact(){return `<a class="text-link support-contact" href="mailto:${escape(SUPPORT_EMAIL)}"><span>운영 문의</span><span>${escape(SUPPORT_EMAIL)}</span></a>`;}
function fmt(value){return Number(value||0).toLocaleString('ko-KR',{maximumFractionDigits:2});}
function duration(value,live=false){
  if(!Number.isFinite(value)||value<0)return '시간 기록 없음';
  const seconds=Math.floor(value/(live?100:10))/(live?10:100),minutes=Math.floor(seconds/60),rest=(seconds%60).toFixed(live?1:2).padStart(live?4:5,'0');
  return minutes>=60?`${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}:${rest}`:`${minutes}:${rest}`;
}
function performanceLine(performance){return `정답 ${fmt(performance.correct)}개 · ${duration(performance.totalTimeMs)}`;}

function icon(name,small=false){const paths={sound:'<path d="m11 5-6 4H2v6h3l6 4z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',muted:'<path d="m11 5-6 4H2v6h3l6 4z"/><path d="m16 9 6 6m0-6-6 6"/>',home:'<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',spark:'<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"/>',cup:'<path d="M8 3h8v7a4 4 0 0 1-8 0zM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v5m-4 2h8"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',shirt:'<path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4a4 4 0 0 1-8 0z"/>',arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',left:'<path d="m14 5-7 7 7 7"/>',down:'<path d="m6 9 6 6 6-6"/>',check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',play:'<path d="m9 5 11 7-11 7z"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',edit:'<path d="m15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-3-3L5 16z"/>',repeat:'<path d="M3 10a9 9 0 0 1 16-5l2 3m0-5v5h-5M21 14a9 9 0 0 1-16 5l-2-3m0 5v-5h5"/>',book:'<path d="M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z"/>',gift:'<path d="M3 8h18v5H3zm2 5v8h14v-8M12 8v13"/><path d="M12 8H7a3 3 0 1 1 3-3zm0 0h5a3 3 0 1 0-3-3z"/>',shield:'<path d="m12 3 8 4v6c0 5-8 9-8 9s-8-4-8-9V7z"/><path d="m8 12 3 3 5-6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'};return `<svg class="icon${small?' sm':''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.spark}</svg>`;}
function coins(value){return `<span class="coin"><span class="coin-dot" aria-hidden="true">H</span>${fmt(value)}<span class="sr-only"> 코인</span></span>`;}
function characterName(value=state?.equipped?.character||'rabbit'){return CATALOG.find(item=>item.slot==='character'&&item.value===value)?.name||'구름토끼';}
function avatar(options={},className='',label=''){return `<canvas class="${className}" width="192" height="192" data-avatar="${escape(JSON.stringify(options))}" role="img" aria-label="${escape(label||characterName(options.character||state?.equipped?.character||'rabbit')+' 도트 캐릭터')}"></canvas>`;}
function itemCanvas(item){return `<canvas width="192" height="192" data-item="${escape(item.id)}" role="img" aria-label="${escape(item.name)} 착용 모습"></canvas>`;}
function tierTextColor(tier){return {amber:'#8c5e19',jade:'#306e55',sapphire:'#396aa7',ruby:'#ae446b',diamond:'#64589f',aurora:'#2b706f'}[tier?.id]||'#6d5b7b';}
function fieldTextColor(id){return {logic:'#7260b1',math:'#946224',spatial:'#376fa1',language:'#a24868',memory:'#317860',observation:'#8455a0'}[id]||'#78628f';}
function fixedTier(){const last=addDays(weekKey(today),-7);const award=state.awards[last];return award?TIERS.find(t=>t.id===award.tierId):null;}
function emptyTierName(){return state.results.some(r=>r.date<weekKey(today))||Object.keys(state.awards).length?'전주 기록 없음':'첫 도전';}
function tierPill(tier=fixedTier()){return tier?`<span class="tier-pill" style="color:${escape(tierTextColor(tier))};background:${escape(tier.color)}1f"><i class="tier-gem" aria-hidden="true"></i>${escape(tier.name)}</span>`:'<span class="tier-pill first"><i class="tier-gem" aria-hidden="true"></i>'+emptyTierName()+'</span>';}
function dailyResult(){return state.results.find(r=>r.mode==='daily'&&r.date===today)||null;}
function currentSet(active=state?.active){return Array.isArray(active?.questions)?active.questions:[];}

function dateLabel(key=today){return new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Seoul'}).format(new Date(key+'T00:00:00+09:00'));}
function weekLabel(week=weekKey(today)){return `${week.slice(5).replace('-','.')} — ${addDays(week,6).slice(5).replace('-','.')}`;}
function navActive(view){return view===ui.view||(view==='home'&&ui.view==='result');}
const NAV=[['home','home','홈'],['challenge','spark','오늘의 도전'],['ranking','cup','랭킹'],['profile','user','내 정보'],['shop','shirt','꾸미기']];
function brand(){return '<button class="brand" data-action="nav" data-view="home" aria-label="하루다섯 홈"><img class="brand-mark" src="/game/favicon.svg" alt=""><div><div class="brand-name">하루다섯</div><div class="brand-caption">FIVE LITTLE MOMENTS</div></div></button>';}
function heading(title,description,extra=''){return `<div class="page-heading${extra?' ranking-heading':''}"><div><h1>${title}</h1><p>${description}</p></div>${extra}</div>`;}
function shell(content){return `<div class="shell"><aside class="sidebar">${brand()}<nav class="sidebar-nav" aria-label="메인 메뉴">${NAV.map(([view,ico,label])=>`<button class="nav-item ${navActive(view)?'active':''}" data-action="nav" data-view="${view}" ${navActive(view)?'aria-current="page"':''}>${icon(ico)}<span class="nav-label">${label}</span>${navActive(view)?'<i class="nav-pip"></i>':''}</button>`).join('')}</nav><div class="sidebar-note"><div class="tiny-stars" aria-hidden="true">· ✧ ·</div><strong>하루의 작은 성취가 쌓이는 곳</strong><p>오늘도, 나의 속도로.<br>다섯 문제에서 만나요.</p></div></aside><div class="workspace"><header class="topbar"><div class="top-date">${dateLabel()} <span aria-hidden="true">·</span> 오늘의 작은 도전</div><div class="mobile-brand">${brand()}</div><div class="top-actions"><span class="tag neutral">출시 준비 · 0.5.1</span>${audioButton()}<button class="coin-wallet" data-action="wallet" aria-label="보유 코인 ${state.coins}개, 코인 안내">${coins(state.coins)}</button><button class="mini-avatar" data-action="nav" data-view="profile" aria-label="내 정보 보기">${avatar({background:'transparent'})}</button></div></header>${connectionBanner()}<main id="main" tabindex="-1" class="view-enter" aria-busy="${pending||syncing||authBusy}">${authFeedback()}${content}</main><footer class="footer"><span>하루다섯 · 출시 준비 0.5.1 · 서버에 기록이 저장돼요</span><button data-action="about">이 버전 안내 ${icon('info',true)}</button></footer></div><nav class="bottom-nav" aria-label="모바일 메인 메뉴">${NAV.map(([view,ico,label])=>`<button class="${navActive(view)?'active':''}" data-action="nav" data-view="${view}" ${navActive(view)?'aria-current="page"':''}>${icon(ico)}<span>${view==='challenge'?'도전':label}</span></button>`).join('')}</nav></div>`;}

function audioStatusText(status=sound?.getStatus()){
  if(status?.supported===false)return '이 브라우저에서는 소리를 재생할 수 없어요. 게임은 그대로 즐길 수 있어요.';
  if(!audioSettings.enabled)return '소리가 꺼져 있어요. 원할 때 켜서 함께 들어요.';
  if(status?.state==='paused')return '다른 화면을 보고 있는 동안 소리를 잠시 쉬어요.';
  if(status?.ready)return '배경음과 효과음을 재생할 수 있어요. 문제를 풀 때는 배경음이 더 작아져요.';
  return '재생 버튼을 눌러 소리를 시작해 주세요.';
}
function audioButtonContents(status=sound?.getStatus()){
  const playing=!!status?.ready&&audioSettings.enabled;
  return `${icon(playing?'sound':'muted',true)}<span class="sound-button-label">${status?.supported===false?'소리 설정':playing?'소리 켜짐':'소리 켜기'}</span>`;
}
function audioButton(){const status=sound.getStatus();return `<button class="sound-button ${status.ready?'active':''}" data-action="sound" aria-label="소리 설정, ${status.ready?'켜짐':'꺼짐 또는 재생 대기'}">${audioButtonContents(status)}</button>`;}
function refreshAudioUI(status=sound?.getStatus()){
  if(disposed)return;
  document.querySelectorAll('[data-action="sound"]').forEach(button=>{button.innerHTML=audioButtonContents(status);button.classList.toggle('active',!!status?.ready);button.setAttribute('aria-label',`소리 설정, ${status?.ready?'켜짐':'꺼짐 또는 재생 대기'}`);});
  const message=document.querySelector('#sound-status');if(message)message.textContent=audioStatusText(status);
  const toggle=document.querySelector('#sound-master');if(toggle){toggle.textContent=audioSettings.enabled?'모든 소리 끄기':'소리 켜기';toggle.setAttribute('aria-pressed',String(audioSettings.enabled));}
  const retry=document.querySelector('#sound-retry');if(retry)retry.hidden=!audioSettings.enabled||!!status?.ready||status?.supported===false;
  const saved=document.querySelector('#sound-save-note');if(saved)saved.textContent=audioStorageAvailable?'설정은 이 브라우저에 저장해요.':'소리 설정을 저장하지 못했어요. 이번 방문에는 선택한 음량을 사용해요.';
  for(const kind of ['musicVolume','effectsVolume']){const percent=Math.round(audioSettings[kind]*100);const output=document.querySelector('#audio-'+kind+'-value');if(output)output.textContent=percent===0?'꺼짐':percent+'%';const input=document.querySelector('#audio-'+kind);if(input&&Number(input.value)!==percent)input.value=String(percent);}
}
function audioDialog(){
  const status=sound.getStatus();
  showModal('하루다섯의 소리','잔잔한 마을 음악과 가벼운 효과음으로 함께해요.',`<button class="btn full" id="sound-master" data-action="audio-toggle" aria-pressed="${audioSettings.enabled}">${audioSettings.enabled?'모든 소리 끄기':'소리 켜기'}</button><button class="btn secondary full" id="sound-retry" data-action="audio-retry" ${!audioSettings.enabled||status.ready||!status.supported?'hidden':''}>${icon('play',true)} 소리 재생하기</button>`,`<div class="sound-status" id="sound-status" role="status">${audioStatusText(status)}</div><div class="sound-sliders">${[['musicVolume','배경음'],['effectsVolume','효과음']].map(([kind,label])=>`<div class="sound-volume"><label for="audio-${kind}">${label}<output id="audio-${kind}-value">${audioSettings[kind]===0?'꺼짐':Math.round(audioSettings[kind]*100)+'%'}</output></label><input id="audio-${kind}" data-audio-volume="${kind}" type="range" min="0" max="100" step="1" value="${Math.round(audioSettings[kind]*100)}"><small>0으로 내리면 ${label}만 꺼져요.</small></div>`).join('')}</div><div class="sound-samples"><button class="btn small secondary" data-action="audio-preview" data-effect="complete">${icon('play',true)} 완주음 듣기</button><button class="btn small secondary" data-action="audio-preview" data-effect="purchase">${icon('play',true)} 영입음 듣기</button></div><p class="modal-note" id="sound-save-note">${audioStorageAvailable?'설정은 이 브라우저에 저장해요.':'소리 설정을 저장하지 못했어요. 이번 방문에는 선택한 음량을 사용해요.'}</p>`);
}

function homeView(){
  const result=dailyResult();const summary=rankSummary(state,today);const done=result?5:state.active?.mode==='daily'?state.active.index:0;
  const presentFields=(state.todayFields||[]).map(field=>typeof field==='string'?field:field.id||field.field);const week=weekKey(today);
  return `${heading(`${escape(state.name)}님, 반가워요.`,result?'오늘의 다섯 문제를 마쳤어요. 이제 가볍게 둘러볼까요?':'오늘은 어떤 발견이 기다리고 있을까요?')}<section class="home-grid" aria-label="오늘의 도전과 주간 기록"><div class="daily-hero"><div class="hero-cloud" aria-hidden="true"></div><span class="hero-flower" aria-hidden="true">✧</span><div class="hero-copy"><span class="tag">${result?'오늘의 도전 완료':'TODAY’S CHALLENGE'}</span><h2>${result?'오늘의 도전,<br>모두 마쳤어요.':'다섯 문제,<br>가볍게 시작해요.'}</h2><p>${result?'오늘 쌓은 기록을 확인하고<br>나에게 어울리는 옷을 골라봐요.':'나에게 배정된 다섯 문제.<br>정답 개수와 풀이 시간을 기록해요.'}</p><button class="btn" data-action="daily">${result?'오늘의 결과 보기':done?'이어서 풀기':'오늘의 도전 시작'} ${icon('arrow',true)}</button><div class="hero-progress" aria-label="${done} / 5문제 완료">${Array.from({length:5},(_,i)=>`<span class="${i<done?'done':''}"></span>`).join('')}</div></div><button class="hero-avatar" data-action="greet" aria-label="캐릭터에게 인사하기">${avatar({pose:ui.avatarHappy?'happy':'idle',background:'garden'})}</button></div><div class="weekly-card"><div class="week-head"><div class="eyebrow">MY WEEK · ${weekLabel()}</div><h3>이번 주 랭킹 점수</h3><div class="week-score">${fmt(summary.score)}<span>점</span></div><div class="week-rank">${summary.participated?`${fmt(summary.rank)}위 / ${fmt(summary.total)}명`:'첫 도전을 마치면 순위가 생겨요.'}</div></div><div class="week-dots" aria-label="이번 주 도전 기록">${['월','화','수','목','금','토','일'].map((label,i)=>{const key=addDays(week,i),complete=state.results.some(r=>r.date===key);return `<div class="day-dot"><i class="${key===today?'today ':''}${complete?'complete':''}">${complete?'✓':'·'}</i><span>${label}</span></div>`;}).join('')}</div><div class="divider"></div><div class="week-bottom">${tierPill()}<p class="badge-note">${fixedTier()?'지난주 성적으로 얻은 이번 주 배지':'월요일에 새로운 주간 등급을 만나요.'}</p></div></div></section><section class="home-under"><div class="card field-preview"><div class="between"><h3>오늘 만나는 분야</h3><span class="tag neutral">매일 5개 분야</span></div><div class="field-bubbles">${FIELDS.map((f,i)=>`<button class="field-bubble ${presentFields.includes(f.id)?'':'rest'}" data-action="field-about" data-field="${f.id}" aria-label="${f.label}${presentFields.includes(f.id)?' 분야 안내':' 오늘은 쉬는 분야'}"><i style="--field-bg:${['#efe8f9','#faead8','#e4eff8','#fae4e6','#e9eefb','#e5f0e4'][i]};--field-color:${escape(fieldTextColor(f.id))}">${['◇','＋','▱','가','▦','◎'][i]}</i><span>${escape(f.label)}</span></button>`).join('')}</div></div><div class="card practice-tile"><div class="practice-copy"><h3>조금 더 풀고 싶은 날엔</h3><p>${result?'정답 부담 없이, 연습 5문제를 더 풀어요.':'오늘의 도전을 마치면 연습이 열려요.'}</p></div><div class="practice-actions"><button class="text-link" data-action="practice">${state.active?.mode==='practice'?'연습 이어하기':'추가 연습'} ${icon('arrow',true)}</button></div></div></section><div class="section-title"><div><h2>나를 닮은 작은 취향</h2><p>도전으로 모은 코인으로 꾸며보세요.</p></div><button class="text-link" data-action="nav" data-view="shop">상점 둘러보기 ${icon('arrow',true)}</button></div><div class="shop-teasers">${['outfit-raincoat','hat-sprout','accessory-camera'].map(id=>{const item=CATALOG.find(i=>i.id===id);return `<button class="teaser" data-action="teaser" data-id="${id}"><div class="teaser-art" style="background:${item.color}">${itemCanvas(item)}</div><div><strong>${item.name}</strong>${coins(item.cost)}<div class="teaser-sub">미리 입어보기</div></div></button>`;}).join('')}</div>`;
}

function challengeView(){
  const active=state.active;
  if(!active){ui.view=dailyResult()?'result':'home';return ui.view==='result'?resultView():homeView();}
  const q=currentSet(active)[active.index];
  if(!q)return `<section class="card release-empty"><h1>문제를 불러오는 중이에요.</h1><p>진행 상황을 서버에서 다시 확인해 주세요.</p><button class="btn" data-action="sync">다시 연결하기</button></section>`;
  const field=FIELDS.find(f=>f.id===q.field),practice=active.mode==='practice';
  const memory=q.visual?.type==='memory',stamp=memoryKey(active),until=timestamp(active.memoryUntil);
  const exposure=Math.max(1,Math.round((q.exposureMs||q.visual?.exposureMs||q.visual?.seconds*1000||3000)/1000));
  const showing=memory&&active.phase==='memorizing'&&!syncing&&!hiddenMemories.has(stamp)&&api.now()<until;
  const ready=memory&&active.phase==='ready',answering=active.phase==='answering'&&Array.isArray(q.options);
  let memoryBlock='';
  if(ready)memoryBlock=`<div class="memory-stage"><span class="memory-preview-symbol" aria-hidden="true">▦</span><p class="muted">${exposure}초 동안 배열을 기억해 주세요.</p><button class="btn secondary" data-action="memory-start">준비됐어요 ${icon('play',true)}</button></div>`;
  else if(showing)memoryBlock=`<div class="memory-stage"><div class="memory-grid" style="--columns:${Math.max(1,Math.min(6,Number(q.visual.columns)||3))}">${(q.visual.cells||[]).map(c=>`<div class="memory-cell">${escape(c||'·')}</div>`).join('')}</div><p class="memory-timer"><span id="memory-seconds">${Math.max(1,Math.ceil((until-api.now())/1000))}</span>초 뒤 배열이 가려져요.</p></div>`;
  else if(memory)memoryBlock=`<div class="memory-stage compact"><div class="memory-note">${answering?'배열을 가렸어요. 기억한 내용을 떠올려 보세요.':'배열을 가렸어요. 답 선택 화면을 연결하고 있어요.'}</div>${!answering&&!syncing?'<button class="text-link" data-action="sync">답 선택 화면 다시 불러오기</button>':''}</div>`;
  return `<div class="challenge-wrap"><div class="challenge-top between"><button class="text-link" data-action="nav" data-view="home">${icon('left',true)} 나가기 · 시간은 계속돼요</button><span class="question-top-label muted">${practice?'추가 연습':'오늘의 도전'} <strong class="purple">${active.index+1} / 5</strong></span></div><div class="question-progress" aria-label="5문제 중 ${active.index+1}번째">${Array.from({length:5},(_,i)=>`<span class="${i<active.index?'done':i===active.index?'current':''}"></span>`).join('')}</div><section class="card question-card"><div class="question-kicker"><span class="tag" style="color:${escape(fieldTextColor(field?.id))}">${escape(field?.label||q.field)} ${practice?'연습':'도전'}</span><div class="difficulty" aria-label="난이도 ${q.level}">${Array.from({length:5},(_,i)=>`<i class="${i<q.level?'on':''}"></i>`).join('')}<span>${practice?'순위 미반영':'정답 1,000점'}</span></div></div><div class="answer-clock">${icon('clock',true)}<span>이번 문제 <strong id="question-elapsed">${duration(currentElapsed(active),true)}</strong></span><span>합계 <strong id="attempt-elapsed">${duration((active.totalTimeMs||0)+currentElapsed(active),true)}</strong></span></div><h1 class="question-title">${escape(memory&&!answering?'잠깐 나타나는 배열을 기억해 주세요.':q.prompt)}</h1>${memoryBlock}${answering?`<div class="options" role="group" aria-label="답 선택">${q.options.map((option,i)=>`<button class="option ${ui.selected===i?'selected':''}" aria-pressed="${ui.selected===i}" data-action="select" data-option="${i}"><span class="option-num">${i+1}</span><span>${escape(option)}</span></button>`).join('')}</div><div class="question-actions"><p>정답과 해설은<br>다섯 문제를 마친 뒤에 알려드려요.</p><button class="btn" data-action="answer" ${ui.selected===null?'disabled':''}>${pending?'답을 보내고 있어요':active.index===4?'결과 확인하기':'답 확정하고 다음'} ${icon('arrow',true)}</button></div>`:''}</section><div class="question-foot">${avatar({background:'transparent',pose:'happy'})}<span>${practice?'무료 연습은 랭킹, 코인, 분야별 기록에 반영되지 않아요.':'정답 개수가 우선이에요. 같은 개수를 맞히면 전체 답 제출 시간이 짧을수록 높아요.'}<small>서버에서 문제를 연 순간부터 제출까지 기록해요. 메뉴 이동·새로고침 중에도 시간이 계속되며, 기억 배열의 고정 노출 시간은 제외해요.</small></span></div></div>`;
}

function resultView(){
  const result=ui.result||dailyResult();
  if(!result){ui.view='home';return homeView();}
  const practice=result.mode==='practice',summary=rankSummary(state),questions=currentSet(result);
  return `<div class="challenge-wrap">${heading(practice?'가볍게 한 번 더, 완료!':'오늘의 기록이 쌓였어요.',practice?'연습에서 발견한 풀이를 다음 도전에 활용해 보세요.':dateLabel(result.date)+' · 다섯 문제를 끝까지 풀었어요.')}<section class="card result-card"><div class="result-hero">${avatar({background:'transparent',pose:'happy'},'result-avatar')}<h2>${result.correct===5?'다섯 문제 모두 맞혔어요!':result.correct>=3?'차근차근 잘 풀었어요.':'끝까지 도전한 오늘도 소중해요.'}</h2><div class="result-number">${result.correct}<small> / 5문제 정답</small></div><p>${practice?'연습 결과 · 공식 기록에 포함되지 않아요.':'서버에 저장된 오늘의 도전 결과예요.'}</p></div><div class="result-body"><div class="result-stats"><div><small>${practice?'연습 점수':'오늘의 도전 점수'}</small><strong>${fmt(result.score)}<small> 점</small></strong></div><div><small>${practice?'공식 랭킹':'이번 주 랭킹 점수'}</small><strong>${practice?'미반영':fmt(summary.score)}${practice?'':'<small> 점</small>'}</strong></div><div><small>${practice?'꾸미기 보상':'완주 보상'}</small><strong>${practice?'없음':coins(DAILY_COMPLETION_COINS)}</strong></div></div><div class="score-breakdown"><span>정답 점수 <strong>${fmt(result.baseScore)}</strong></span><span>시간 보너스 <strong>+${fmt(result.speedBonus)}</strong></span><span>답 제출 시간 <strong>${duration(result.totalTimeMs)}</strong></span></div><div class="result-actions"><button class="btn" data-action="review">${icon('book',true)} 정답과 해설 보기</button><button class="btn secondary" data-action="nav" data-view="profile">${icon('user',true)} 내 기록 보기</button></div></div></section><section class="ad-cta"><div><h3>${practice?'오늘의 연습도 마쳤어요.':'조금 더 풀고 싶나요?'}</h3><p>${practice?'내일 새로운 다섯 문제에서 만나요.':'오늘의 도전 후 무료 연습 1세트를 더 풀 수 있어요.'}</p></div>${practice?'<button class="btn small secondary" data-action="nav" data-view="shop">캐릭터 꾸미기</button>':`<button class="btn small secondary" data-action="practice">무료 연습 ${icon('arrow',true)}</button>`}</section>${ui.review?`<section class="answer-review" id="answer-review"><div class="section-title"><h2>오늘의 풀이 노트</h2><span class="tag neutral">${practice?'연습':'공식 도전'}</span></div>${(result.details||[]).map((detail,i)=>{const q=questions[i],field=FIELDS.find(f=>f.id===detail.field);return `<details class="review-item" ${i===0?'open':''}><summary><span class="review-mark ${detail.correct?'':'wrong'}">${detail.correct?'✓':'·'}</span><strong>${i+1}번째 문제</strong><span class="muted">${escape(field?.label)}</span><span class="muted">${detail.correct?'정답':'다시 살펴보기'}</span>${icon('down',true)}</summary><div class="review-content"><p class="review-prompt">${escape(q?.prompt)}</p>${q?.visual?.type==='memory'&&Array.isArray(q.visual.cells)?`<div class="memory-grid review-memory-grid" style="--columns:${Math.max(1,Math.min(6,Number(q.visual.columns)||3))}">${q.visual.cells.map(c=>`<div class="memory-cell">${escape(c||'·')}</div>`).join('')}</div>`:''}<div class="review-answer">정답: <strong>${escape(q?.options?.[detail.answer])}</strong></div>${!detail.correct?`<p class="review-yours">내가 고른 답: ${escape(q?.options?.[detail.selected]??'선택하지 않음')}</p>`:''}<p class="explanation">${escape(detail.explanation)}</p><p class="review-time">답 제출까지 ${duration(detail.elapsedMs)}</p></div></details>`;}).join('')}</section>`:''}${!practice&&ui.review?reminderCard():''}</div>`;
}

function profileStats(){return getFieldStats(state.results,today).map(s=>({...s,accuracy:s.total?s.correct/s.total*100:null}));}

function radar(stats){const cx=180,cy=157,radius=98;const point=(index,r)=>{const a=-Math.PI/2+index*Math.PI/3;return [cx+Math.cos(a)*r,cy+Math.sin(a)*r];};const all=stats.every(f=>f.total>0);const rings=[.25,.5,.75,1].map(r=>`<polygon points="${stats.map((_,i)=>point(i,radius*r).join(',')).join(' ')}" fill="${r===1?'#faf8fc':'none'}" stroke="#e8dfed" stroke-width="1"/>`).reverse().join('');return `<svg class="radar-chart" viewBox="0 0 360 320" role="img" aria-label="분야별 최근 28일 첫 도전 정답률. ${stats.map(s=>`${s.label} ${s.total?Math.round(s.accuracy)+'퍼센트':'기록 없음'}`).join(', ')}"><g>${rings}${stats.map((s,i)=>{const p=point(i,radius);return `<path d="M${cx} ${cy}L${p.join(' ')}" fill="none" stroke="#e8dfed" stroke-dasharray="${s.total?'none':'3 4'}"/>`;}).join('')}${all?`<polygon class="radar-zone" points="${stats.map((s,i)=>point(i,radius*s.accuracy/100).join(',')).join(' ')}"/>`:''}${stats.map((s,i)=>{const p=point(i,radius*(s.accuracy??0)/100),label=point(i,radius+30);const anchor=i===0||i===3?'middle':i<3?'start':'end';return `${s.total?`<circle cx="${p[0]}" cy="${p[1]}" r="${ui.field===s.field?5:3.5}" fill="#aa87c4" stroke="#fff" stroke-width="2"/>`:''}<text class="axis-label" x="${label[0]}" y="${label[1]-5}" text-anchor="${anchor}">${escape(s.label)}</text><text class="axis-score" x="${label[0]}" y="${label[1]+17}" text-anchor="${anchor}">${s.total?Math.round(s.accuracy)+'%':'—'}</text>`;}).join('')}<text class="tick-label" x="185" y="154">0</text><text class="tick-label" x="185" y="${cy-radius*.5-4}">50</text><text class="tick-label" x="185" y="${cy-radius-4}">100</text></g></svg>`;}
function profileView(){const stats=profileStats(),selected=stats.find(f=>f.field===ui.field)||stats[0];const summary=rankSummary(state,today);return `${heading('차곡차곡, 나의 기록','좋아하는 분야도, 새롭게 발견한 분야도 모아봐요.')}<section class="profile-grid"><div class="card identity-card"><div class="identity-scene">${avatar()}</div><div class="identity-content"><div class="identity-name"><span class="nickname">${escape(state.name)}</span><button class="icon-button" data-action="rename" aria-label="닉네임 바꾸기">${icon('edit',true)}</button></div>${tierPill()}<p>${fixedTier()?'지난주 성적으로 획득 · 이번 주 표시':emptyTierName()==='전주 기록 없음'?'지난주에는 도전 기록이 없어요.':'첫 주간 정산을 기다리고 있어요.'}</p><div class="profile-summary"><div><small>함께한 도전</small><strong>${fmt(state.totals?.dailyCount??state.results.length)}<small> 일</small></strong></div><div><small>주간 랭킹 점수</small><strong>${fmt(summary.score)}</strong></div></div><button class="btn secondary full" data-action="nav" data-view="shop">${icon('shirt',true)} 캐릭터 꾸미기</button></div></div><div class="card radar-card"><div class="radar-header"><div><h2>분야별 도전 기록</h2><p>최근 28일 · 첫 도전 정답률</p></div><span class="tag neutral">나의 공식 기록</span></div><div class="radar-wrap">${radar(stats)}</div><div class="radar-fields">${stats.map(s=>`<button class="radar-field ${ui.field===s.field?'active':''}" aria-pressed="${ui.field===s.field}" data-action="stat-field" data-field="${s.field}"><span>${escape(s.label)}</span><strong>${s.total?Math.round(s.accuracy)+'%':'—'}</strong></button>`).join('')}</div><p class="radar-detail" aria-live="polite">${selected.total?`${escape(selected.label)} · 정답 ${selected.correct} / ${selected.total}문제${selected.total<10?' · 기록 쌓는 중':''}`:`${escape(selected.label)} 분야의 첫 기록을 기다리고 있어요.`}</p><div class="record-note">${stats.some(s=>!s.total)?'여섯 분야에 기록이 생기면 육각형이 연결돼요. 아직 풀지 않은 분야는 —로 표시해요.':'매주 초기화되지 않아요. 최근 28일 동안 공식 도전에서 푼 문제만 모아요.'} 게임 속 문제풀이 기록이며 IQ 점수는 아니에요.</div></div></section>${reminderCard('profile')}<section class="card record-history"><div class="between"><h3>최근 도전</h3><span class="tag neutral">${state.results.length}개의 하루</span></div>${state.results.length?state.results.slice(-7).reverse().map(r=>`<div class="history-row"><div><strong>${dateLabel(r.date)}</strong><br><span>${r.correct} / 5문제 정답 · ${duration(r.totalTimeMs)}</span></div><strong class="purple">${fmt(r.score)}점</strong></div>`).join(''):'<p class="history-empty">오늘의 다섯 문제로 첫 기록을 만들어 보세요.</p>'}</section><section class="card record-history"><div class="between"><h3>나의 주간 배지</h3><button class="text-link" data-action="settlement-preview">지난주 정산 보기 ${icon('arrow',true)}</button></div>${Object.values(state.awards).length?Object.values(state.awards).sort((a,b)=>b.week.localeCompare(a.week)).slice(0,6).map(a=>`<div class="history-row"><div><strong>${weekLabel(a.week)}</strong><br><span>${fmt(a.rank)}위 · ${fmt(a.score)}점</span></div><span>${tierPill(TIERS.find(t=>t.id===a.tierId))}</span></div>`).join(''):'<p class="history-empty">첫 주를 마치면 이곳에 배지가 남아요.<br>구매한 옷과 이전 배지 기록은 계속 간직해요.</p>'}</section>${accountCard()}`;}

function rankingView(){
  const s=rankSummary(state),rows=s.rows,leaders=[rows[1],rows[0],rows[2]].filter(Boolean),award=state.awards[addDays(weekKey(today),-7)];
  const rowAvatar=r=>({...DEFAULT_EQUIPPED,...r.equipped,character:r.equipped?.character||r.character||'rabbit',outfit:r.equipped?.outfit||r.outfit||'mint',background:'transparent'});
  const mine=r=>r.isMe||r.id===state.playerId;
  return `${heading('이번 주, 함께 도전해요.',weekLabel()+' · 매주 월요일 00:00 한국시간 정산',`<button class="btn ghost small" data-action="rules">등급 안내 ${icon('info',true)}</button>`)}<p class="league-explainer">${icon('info',true)}${s.total?`이번 주 공식 도전을 마친 ${fmt(s.total)}명이 함께하고 있어요. 상위 100명과 내 순위를 보여드려요.`:'아직 이번 주 도전을 마친 사람이 없어요. 첫 번째 기록을 만들어 보세요.'}</p><div class="ranking-layout"><section class="card">${rows.length?`<div class="podium" aria-label="주간 랭킹 선두">${leaders.map(r=>`<div class="podium-player">${avatar(rowAvatar(r),'podium-avatar')}<div class="podium-base"><span class="podium-place">${fmt(r.rank)}위</span><strong class="podium-name">${escape(r.name)}</strong><span class="podium-score">${fmt(r.score)}점</span></div></div>`).join('')}</div>`:'<div class="release-empty">'+avatar({background:'transparent',pose:'happy'},'empty-avatar')+'<h3>우리의 첫 주가 시작돼요.</h3><p>오늘의 다섯 문제를 마치면 이곳에 기록이 올라와요.</p><button class="btn secondary" data-action="daily">오늘의 도전 시작</button></div>'}<div class="ranking-table"><div class="rank-row header"><span class="place">순위</span><span>도전자</span><span class="rank-score-heading">주간 점수</span></div>${rows.map(r=>`<div class="rank-row ${mine(r)?'me':''}"><span class="place">${fmt(r.rank)}</span><div class="rank-person">${avatar(rowAvatar(r))}<span>${escape(r.name)}${mine(r)?' <span class="tag">나</span>':''}<small class="rank-detail">${performanceLine(r)}</small></span></div><span class="score">${fmt(r.score)}</span></div>`).join('')}${!rows.some(mine)?`<div class="rank-row me"><span class="place">${s.participated?fmt(s.rank):'—'}</span><div class="rank-person">${avatar({background:'transparent'})}<span>${escape(state.name)} <span class="tag">나</span><small class="rank-detail">${s.participated?performanceLine(s):'첫 도전을 기다리고 있어요.'}</small></span></div><span class="score">${fmt(s.score)}</span></div>`:''}<p class="rank-table-note">정답 개수 우선 · 같은 개수는 짧은 시간 우선 · 두 값이 같으면 공동 순위예요.</p></div></section><aside class="ranking-aside"><section class="card rank-badge-card"><span class="eyebrow">THIS WEEK’S BADGE</span><div class="big-gem" style="--gem-color:${escape(fixedTier()?.color||'#b59bc8')};--gem-shadow:${escape(tierTextColor(fixedTier()))}" aria-hidden="true"></div><h3>${award?escape(award.tierName)+' 등급':'한 주의 성취를 배지로'}</h3><p>${award?'지난주 '+fmt(award.rank)+'위로 획득했어요.<br>이번 주 내내 캐릭터 옆에 표시돼요.':'지난주 최종 성적이<br>다음 주의 등급이 돼요.'}</p><button class="btn secondary full" data-action="settlement-preview">지난주 정산 보기</button></section><section class="card tier-guide"><h3>여섯 가지 주간 등급</h3>${[...TIERS].reverse().map(t=>`<div class="tier-guide-row"><div class="row" style="color:${escape(tierTextColor(t))}"><i class="tier-gem" aria-hidden="true"></i><strong>${escape(t.name)}</strong></div><small>${t.id==='amber'?'기본 등급':'상위 '+t.ceiling+'% 이내'}</small></div>`).join('')}<p class="tier-guide-note">주간 배지는 지난주 참가자들의 최종 기록으로 정해져요. 상점에서 판매하지 않아요.</p></section></aside></div>`;
}

function shopView(){
  const characters=CATALOG.filter(item=>item.slot==='character');
  const ownedCharacters=characters.filter(item=>state.owned.includes(item.id));
  const nextFriend=characters.filter(item=>!state.owned.includes(item.id)).sort((a,b)=>a.cost-b.cost)[0];
  const cosmetics=CATALOG.filter(item=>item.slot!=='character');
  const pool=ui.shopTab==='closet'?cosmetics.filter(item=>state.owned.includes(item.id)):cosmetics.filter(item=>item.value!=='none');
  const visible=ui.filter==='all'?pool:pool.filter(item=>item.slot===ui.filter);
  // Storage updates can remove a selected item without a tab/filter action.
  if(ui.shopTab!=='collection'&&visible.length&&!visible.some(item=>item.id===ui.shopItem))ui.shopItem=visible[0].id;
  const selected=cosmetics.find(item=>item.id===ui.shopItem)||cosmetics.find(item=>item.id==='outfit-lilac');
  const owned=state.owned.includes(selected.id),equipped=state.equipped[selected.slot]===selected.value;
  const missingCoins=Math.max(0,selected.cost-state.coins);
  const fitting=ui.premiumPreview?{...state.equipped,...COLLECTION.outfit}:{...state.equipped,[selected.slot]:selected.value};
  const wardrobeTotal=cosmetics.filter(item=>item.value!=='none').length;
  return `${heading('오늘은 어떤 모습일까요?',`여섯 친구와 ${wardrobeTotal}가지 취향으로, 나만의 모습을 만들어봐요.`)}
    <section class="character-section card" aria-labelledby="character-title">
      <div class="character-section-head"><div><span class="eyebrow">MEET YOUR LITTLE FRIEND</span><h2 id="character-title">조금씩 모으는 나의 친구들</h2></div><span class="tag mint">${ownedCharacters.length} / ${characters.length} 친구 수집</span></div>
      <div class="character-grid">${characters.map(item=>{const isOwned=state.owned.includes(item.id),isEquipped=state.equipped.character===item.value;return `<button class="character-choice ${isEquipped?'active':''} ${isOwned?'':'locked'}" data-action="character" data-id="${item.id}" aria-pressed="${isEquipped}" aria-label="${escape(item.name)} ${isOwned?'보유 중, 선택':item.cost+' 코인, 구매 전 미리보기'}"><div class="character-portrait" style="background:${item.color}">${avatar({...state.equipped,character:item.value,background:'transparent'})}${isEquipped?'<span class="character-check" aria-hidden="true">✓</span>':!isOwned?'<span class="character-lock">미보유</span>':''}</div><strong>${escape(item.name)}</strong>${isEquipped?'<span>함께하는 중</span>':isOwned?'<span>내 친구 · 선택하기</span>':coins(item.cost)}</button>`;}).join('')}</div>
      ${nextFriend?`<div class="collection-progress"><div><strong>다음 친구, ${escape(nextFriend.name)}</strong><span>${state.coins>=nextFriend.cost?'지금 모은 코인으로 영입할 수 있어요.':`${fmt(nextFriend.cost-state.coins)}코인 더 모으면 만날 수 있어요.`}</span></div><progress max="${nextFriend.cost}" value="${Math.min(state.coins,nextFriend.cost)}" aria-label="${escape(nextFriend.name)} 구매에 필요한 코인 진행도"></progress></div>`:'<div class="collection-progress complete">여섯 친구를 모두 모았어요. 오늘은 누구와 도전할까요?</div>'}
      <p class="character-note">구름토끼는 기본으로 함께해요. 다른 친구들은 코인으로 구매하며, 모은 옷과 소품은 모든 친구가 함께 사용해요.</p>
    </section>
    <section class="shop-layout">
      <div class="card fitting-room"><div class="fitting-scene"><span class="fitting-tag">${ui.premiumPreview?'컬렉션 미리보기':'미리 입어보기'}</span>${avatar(fitting)}</div><div class="fitting-copy"><span class="fitting-friend">${escape(characterName())}의 오늘</span><h3>${ui.premiumPreview?COLLECTION.name:escape(selected.name)}</h3><p>${ui.premiumPreview?COLLECTION.description:escape(selected.description)}</p>
      ${ui.premiumPreview?`<button class="btn secondary full" data-action="end-premium">원래 모습으로 돌아가기</button><p class="purchase-hint">준비 중인 스타일이에요. 미리보기만 가능해요.</p>`:owned?`<button class="btn ${equipped?'secondary':''} full" data-action="equip" data-id="${selected.id}" ${equipped?'disabled':''}>${equipped?icon('check',true)+' 착용 중':'이 모습으로 입기'}</button><p class="purchase-hint">내 옷장에서 언제든 다시 입을 수 있어요.</p>`:`<button class="btn full" data-action="buy" data-id="${selected.id}" aria-describedby="cosmetic-purchase-hint" ${missingCoins?'disabled':''}>${coins(selected.cost)}으로 구매 · 착용</button><p class="purchase-hint" id="cosmetic-purchase-hint">보유 ${fmt(state.coins)} 코인 · ${missingCoins?`${fmt(missingCoins)}코인 더 모으면 구매할 수 있어요.`:'게임에서 모은 코인 사용'}</p>`}
      ${!ui.premiumPreview?`<div class="quick-unequip">${state.equipped.hat!=='none'?'<button class="text-link" data-action="equip" data-id="hat-none">모자 벗기</button>':''}${state.equipped.accessory!=='none'?'<button class="text-link" data-action="equip" data-id="accessory-none">소품 내려놓기</button>':''}</div>`:''}</div></div>
      <div class="shop-inventory"><div class="shop-tabs" role="group" aria-label="꾸미기 메뉴">${[['shop','코인 상점'],['closet','내 옷장'],['collection','컬렉션']].map(([id,label])=>`<button class="shop-tab ${ui.shopTab===id?'active':''}" aria-pressed="${ui.shopTab===id}" data-action="shop-tab" data-tab="${id}">${label}</button>`).join('')}</div>
      ${ui.shopTab==='collection'?`<section class="collection-card"><div class="collection-scene"><span class="collection-badge">COMING SOON · 스타일 미리보기</span>${avatar(COLLECTION.outfit)}</div><div class="collection-copy"><span class="eyebrow">A LITTLE STARDUST</span><h2 style="margin-top:7px">${COLLECTION.name}</h2><p>${COLLECTION.description}</p><p class="collection-price"><small>준비 중인 스타일</small></p><button class="btn full" data-action="try-premium">스타일 미리 입어보기 ${icon('spark',true)}</button><p class="collection-foot">준비 중인 스타일을 잠깐 입어볼 수 있어요. 아직 구매할 수 없고 내 옷장에 저장되지 않아요.</p></div></section>`:`<div class="shop-filters" role="group" aria-label="아이템 종류">${[['all','전체'],['outfit','의상'],['hat','모자'],['accessory','소품'],['background','배경']].map(([id,label])=>`<button class="filter ${ui.filter===id?'active':''}" aria-pressed="${ui.filter===id}" data-action="filter" data-filter="${id}">${label}<span class="filter-count">${id==='all'?pool.length:pool.filter(item=>item.slot===id).length}</span></button>`).join('')}</div><div class="shop-grid">${visible.length?visible.map(item=>`<button class="shop-item ${selected.id===item.id&&!ui.premiumPreview?'active':''}" data-action="shop-select" data-id="${item.id}" aria-label="${escape(item.name)} ${state.owned.includes(item.id)?'보유 중':item.cost+' 코인'}, 미리 입기"><div class="shop-item-art" style="background:${item.color}">${itemCanvas(item)}${state.owned.includes(item.id)?'<span class="owned-mark">보유</span>':''}</div><div class="shop-item-info"><strong>${escape(item.name)}</strong>${state.equipped[item.slot]===item.value?'<span class="equipped-text">✓ 착용 중</span>':item.cost===0?'<span class="equipped-text">기본 아이템</span>':coins(item.cost)}</div></button>`).join(''):'<div class="empty-state">아직 이 종류의 아이템이 없어요.</div>'}</div>`}</div></section>`;
}

function drawCanvases(root=document){
  const surfaces={garden:'#eaf2df',lavender:'#eee7f7',night:'#293849',beach:'#d8eff0',forest:'#d5e6d5',sunset:'#f8d3ca',snow:'#e2edf4',cloud:'#e2eafa',cafe:'#f2e7d3',transparent:'transparent'};
  root.querySelectorAll('canvas[data-avatar]').forEach(canvas=>{try{const options={...DEFAULT_EQUIPPED,...state?.equipped,...JSON.parse(canvas.dataset.avatar),scale:2};drawAvatar(canvas,options);const parent=canvas.parentElement;if(parent?.matches('.identity-scene,.fitting-scene,.collection-scene'))parent.style.background=surfaces[options.background]||'#eaf2df';}catch{canvas.setAttribute('aria-label','도트 캐릭터');}});
  root.querySelectorAll('canvas[data-item]').forEach(canvas=>{const item=CATALOG.find(i=>i.id===canvas.dataset.item);if(item)drawItem(canvas,{...item,equipped:state?.equipped||DEFAULT_EQUIPPED,scale:2});});
}

function captureFocus(){const el=document.activeElement;if(!el||!app.contains(el))return null;return {id:el.id||null,data:{...el.dataset}};}
function restoreFocus(saved){if(!saved)return;let target=saved.id?document.getElementById(saved.id):null;if(!target&&saved.data.action){target=[...app.querySelectorAll('[data-action]')].find(el=>Object.entries(saved.data).every(([key,value])=>el.dataset[key]===value));}target?.focus({preventScroll:true});}
function timestamp(value){const ms=typeof value==='number'?value:Date.parse(value);return Number.isFinite(ms)?ms:0;}
function memoryKey(active=state?.active){return active?`${active.id}:${active.currentQuestionId}`:'';}
function currentElapsed(active=state?.active){return active&&active.phase==='answering'?Math.max(0,api.now()-timestamp(active.issuedAt)):0;}
function redactExpiredMemory(){
  const active=state?.active;if(!active||active.phase!=='memorizing')return false;
  if(api.now()<timestamp(active.memoryUntil))return false;
  hiddenMemories.add(memoryKey(active));
  const q=currentSet(active)[active.index];
  if(q?.visual?.cells){const {cells,...visual}=q.visual;active.questions[active.index]={...q,visual};}
  return true;
}
function connectionBanner(){
  if(pending)return '<div class="connection-banner" role="status">서버에서 요청을 확인하고 있어요. 잠시만 기다려 주세요.</div>';
  if(transaction)return `<div class="connection-banner error" role="alert"><span>${escape(connectionError||'처리 결과를 아직 확인하지 못했어요. 선택한 답과 요청을 유지하고 있어요.')}</span><button class="btn small secondary" data-action="retry-request">같은 요청으로 다시 확인</button></div>`;
  if(connectionError)return `<div class="connection-banner error" role="alert"><span>${escape(connectionError)}</span><button class="btn small secondary" data-action="sync">다시 연결하기</button></div>`;
  if(syncing)return '<div class="connection-banner" role="status">서버의 최신 기록을 확인하고 있어요.</div>';
  return '';
}
function entryView(){
  const login=connection==='signin';
  return `<main class="release-entry" id="main"><div class="release-entry-brand">${brand()}</div><section class="card release-entry-card">${avatar({...DEFAULT_EQUIPPED,background:'transparent',pose:'happy'},'entry-avatar')}<span class="tag neutral">출시 준비 · 0.5.1</span><h1>${login?'작은 도전, 나만의 친구와.':connection==='error'?'잠깐, 연결을 확인해 주세요.':'나의 정원을 여는 중이에요.'}</h1><p>${login?'하루 다섯 문제를 풀고, 나의 기록과 도트 친구들을 모아요. 로그인하면 계정에 기록을 간직할 수 있어요.':connection==='error'?escape(connectionError):'로그인 상태와 저장된 기록을 확인하고 있어요.'}</p>${login?`${authFeedback()}${socialLoginOptions()}${authStatus?.sites.enabled?`<div class="login-divider"><span>개발 중인 게임 이어가기</span></div><a class="btn secondary full" data-action="auth-sites" href="${escape(SITES_SIGN_IN)}" target="_top" ${authBusy?'aria-disabled="true"':''}>ChatGPT 계정으로 시작하기 ${icon('arrow',true)}</a>`:''}<small>게임 이용은 무료예요. 구름토끼부터 함께해요.</small><button class="text-link" data-action="release-info">로그인 · 출시 준비 안내</button>`:connection==='error'?'<button class="btn full" data-action="sync">다시 연결하기</button>':'<div class="entry-loading" role="status">기록을 불러오고 있어요…</div>'}</section><p class="release-entry-foot">매일 5문제 · 주간 랭킹 · 나만의 도트 친구</p><nav class="privacy-entry-links" aria-label="보호자와 정보 관리"><button class="text-link" data-action="guardian-open">보호자 동의 안내</button><button class="text-link" data-action="privacy-open">나의 정보 관리</button></nav><div class="release-entry-contact">${supportContact()}</div></main>`;
}
function authFeedback(){
  const notice=authError?{kind:'error',text:authError}:authNotice;
  return notice?`<div class="auth-feedback ${notice.kind==='error'?'error':''}" role="${notice.kind==='error'?'alert':'status'}"><p>${escape(notice.text)}</p>${logoutUnconfirmed?`<button class="text-link" data-action="auth-logout" ${authBusy?'disabled':''}>로그아웃 다시 확인</button>`:'<button class="text-link" data-action="auth-dismiss">닫기</button>'}</div>`:'';
}
function socialLoginOptions(){
  return `<div class="social-login-options" aria-label="간편 로그인">${SOCIAL_PROVIDERS.map(provider=>{
    const configured=authStatus?.providers.find(item=>item.id===provider.id)?.enabled===true;
    const status=configured?'계속하기':authError?'연결 확인 필요':authStatus?'연결 준비 중':'확인 중';
    return `<button class="social-login-choice provider-${provider.id}" data-action="auth-login" data-provider="${provider.id}" ${!configured||authBusy?'disabled':''}><strong>${provider.name}</strong><span>${authBusy&&configured?'로그인 준비 중…':status}</span>${icon('arrow',true)}</button>`;
  }).join('')}</div><p class="login-availability">${authStatus?.providers.some(provider=>provider.enabled)?authStatus.registration.open?'사용하던 로그인 수단을 선택해 주세요.':'새 계정 가입은 준비 중이에요. 이미 연결한 계정으로 로그인할 수 있어요.':'세 가지 간편 로그인을 연결하고 있어요. 준비가 끝나면 이곳에서 시작할 수 있어요.'}</p>${authError?'<button class="text-link" data-action="auth-refresh">로그인 연결 다시 확인</button>':''}`;
}
async function syncAuth(){
  if(disposed||authBusy||logoutUnconfirmed)return;
  if(authPromise)return authPromise;
  authPromise=(async()=>{
    try{
      const status=await authApi.status();if(disposed)return;authStatus=status;authError='';if(!status.authenticated)resetPrivacy();
      if(authNotice?.kind==='success'&&!status.authenticated)authNotice=null;
    }catch(error){if(!disposed)authError=error.message||'로그인 연결 상태를 확인하지 못했어요.';}
    finally{authPromise=null;if(!disposed)render();}
  })();
  return authPromise;
}
async function beginLogin(provider,intent='login'){
  if(authBusy||disposed)return;
  if(logoutUnconfirmed){toast('먼저 로그아웃 처리 결과를 다시 확인해 주세요.');return;}
  if(pending||transaction||syncing){toast('먼저 진행 중인 요청의 결과를 확인해 주세요.');return;}
  if(provider==='chatgpt'&&!authStatus?.sites.enabled)return;
  if(provider!=='chatgpt'&&!authStatus?.providers.find(item=>item.id===provider)?.enabled)return;
  if(intent==='link'&&!state)return;
  authBusy=true;authError='';authNotice=null;render();setRequestControls();
  try{
    const url=provider==='chatgpt'?await authApi.sitesStart():await authApi.start(provider,intent);
    if(disposed)return;
    showModal(`${escape(providerName(provider))} 로그인으로 이동해요.`,intent==='link'?'연결할 계정으로 로그인하면 지금의 캐릭터와 기록에 로그인 수단이 추가돼요.':'로그인을 마치면 하루다섯으로 돌아와요.',`<a class="btn full" data-auth-continue href="${escape(url)}" target="_top">로그인 화면 열기 ${icon('arrow',true)}</a>`,`<p class="account-caption">새 화면이 열리지 않으면 위 버튼을 눌러 주세요.</p>`);
    // A normal top-level anchor also leaves a usable fallback when embedded navigation is blocked.
    modal.querySelector('[data-auth-continue]')?.click();
  }catch(error){if(!disposed){authError=error.message||'로그인을 시작하지 못했어요.';modal.close();refreshGameModal=null;}}
  finally{authBusy=false;if(!disposed){render();setRequestControls();}}
}
function linkLoginDialog(provider){
  if(!state||!authStatus?.providers.find(item=>item.id===provider)?.enabled||authStatus.account?.linkedProviders.includes(provider))return;
  showModal(`${escape(providerName(provider))} 로그인을 연결할까요?`,'로그인 수단을 추가하면 같은 캐릭터와 기록으로 이어서 이용할 수 있어요.',`<button class="btn ghost" data-action="close-modal">취소</button><button class="btn" data-action="auth-link-confirm" data-provider="${escape(provider)}">로그인하고 연결하기</button>`,`<div class="modal-note">이미 다른 하루다섯 계정에 연결된 로그인은 여기로 옮기거나 기록을 합칠 수 없어요.${state.active?'<br>진행 중인 도전의 풀이 시간은 로그인하는 동안에도 계속돼요.':''}</div>`);
}
async function signOut(){
  if(authBusy||pending||transaction||syncing||disposed)return;
  authBusy=true;logoutUnconfirmed=true;authError='';authNotice=null;
  clearPersonalState();render();setRequestControls();
  try{
    await authApi.logout();if(disposed)return;
    logoutUnconfirmed=false;authStatus=null;authNotice={kind:'success',text:'로그아웃했어요. 기록은 계정에 안전하게 보관돼요.'};
  }catch(error){if(!disposed)authError='화면의 개인 기록을 가렸어요. 서버의 로그아웃 처리 결과를 확인하지 못했으니 연결 후 다시 확인해 주세요.';}
  finally{authBusy=false;if(!disposed){render();setRequestControls();await syncAuth();}}
}
function releaseInfoDialog(){
  showModal('새 친구들을 맞이할 준비 중이에요.','간편 로그인과 정식 운영을 준비하고 있어요.',`<button class="btn full" data-action="close-modal">확인했어요</button>`,`<div class="info-lines"><div><strong>카카오 · Google · 네이버</strong>내 정보에서 로그인 수단을 연결하면 같은 게임 계정으로 이어서 이용할 수 있어요. 현재 연결 준비 중인 버튼은 아직 사용할 수 없어요.</div><div><strong>전체이용가를 목표로 해요</strong>게임물 등급이 확정되었다는 뜻은 아니에요. 만 14세 미만 어린이도 함께할 수 있도록 보호자 동의 절차를 준비하고 있어요.</div><div><strong>새 계정 가입은 준비 중이에요</strong>보호자 동의, 이용약관과 개인정보 안내, 탈퇴·삭제 절차를 갖춘 뒤 새 계정 가입을 열게요. 광고와 현금 결제는 아직 제공하지 않아요.</div><div><strong>기존 계정을 먼저 확인해 주세요</strong>다른 로그인으로 새 계정을 만들면 기록이 따로 생길 수 있어요. 사용하던 계정의 내 정보에서 로그인을 연결해 주세요.</div><div><strong>도움이 필요할 때</strong>게임 이용과 내 정보에 관한 문의는 아래 주소로 보내 주세요.${supportContact()}</div></div>`);
}
function clearPersonalState(error){
  resetPrivacy();
  const retainedView=['privacy','guardian'].includes(ui.view)?ui.view:'home';
  state=null;connection='signin';connectionError='';transaction=null;pending=false;
  ui.selected=null;ui.result=null;ui.review=false;ui.view=retainedView;ui.premiumPreview=false;
  hiddenMemories.clear();memorySyncRequested.clear();modal.close();modal.innerHTML='';refreshGameModal=null;
  if(authStatus)authStatus={...authStatus,authenticated:false,account:null};
  const supplied=error?.signInUrl;
  signInUrl=typeof supplied==='string'&&supplied.startsWith('/signin-with-chatgpt?')?supplied:'/signin-with-chatgpt?return_to=%2F';
  history.replaceState(null,'','#'+ui.view);sound.setScene('home');
}
function applySnapshot(payload){
  const next=payload.state;
  if(!next||typeof next.playerId!=='string'||!Array.isArray(next.results)||!Array.isArray(next.owned))throw new Error('서버 기록의 형식을 확인하지 못했어요.');
  const oldId=state?.playerId,oldActive=state?.active,oldQuestion=oldActive?`${oldActive.id}:${oldActive.currentQuestionId}`:'',previousDay=today;
  state={...next,equipped:{...DEFAULT_EQUIPPED,...next.equipped},practiceHistory:next.practiceHistory||[],practiceUsage:next.practiceUsage||{},awards:next.awards||{}};
  today=payload.today;connection='ready';
  if(oldId&&oldId!==state.playerId){resetPrivacy();ui.selected=null;ui.result=null;ui.review=false;ui.view='home';ui.premiumPreview=false;hiddenMemories.clear();modal.close();modal.innerHTML='';refreshGameModal=null;transaction=null;}
  if(oldQuestion!==memoryKey())ui.selected=null;
  if(previousDay!==today){resetPrivacy();ui.selected=null;ui.result=null;ui.review=false;ui.view='home';modal.close();refreshGameModal=null;}
  if(ui.result?.mode==='daily')ui.result=state.results.find(r=>r.date===ui.result.date)||null;
  if(ui.result?.mode==='practice')ui.result=state.practiceHistory.find(r=>r.id===ui.result.id&&r.date===ui.result.date)||state.practiceHistory.find(r=>r.date===ui.result.date)||null;
  if(ui.view==='challenge'&&!state.active){const finished=oldActive?.mode==='practice'?state.practiceHistory.find(r=>r.date===oldActive.date):dailyResult();ui.result=finished||null;ui.view=finished?'result':'home';}
  redactExpiredMemory();
}
async function syncState(){
  if(disposed)return;
  if(logoutUnconfirmed)return signOut();
  if(authBusy)return;
  if(pending){syncAfter=true;return;}
  if(transaction)return runTransaction(transaction);
  if(syncPromise)return syncPromise;
  syncing=true;connectionError='';render();
  syncPromise=(async()=>{
    try{const data=await api.bootstrap();if(disposed)return;applySnapshot(data);connectionError='';if(modal.open&&refreshGameModal)refreshGameModal();}
    catch(error){if(disposed)return;if(error.status===401||error.code==='SIGN_IN_REQUIRED')clearPersonalState(error);else{connectionError=error.message||'기록을 불러오지 못했어요.';if(!state)connection='error';}}
    finally{syncing=false;syncPromise=null;if(!disposed){render();history.replaceState(null,'','#'+ui.view);}}
  })();
  return syncPromise;
}
function setRequestControls(){
  const locked=pending||!!transaction||syncing||authBusy;
  for(const root of [app,modal])root.querySelectorAll('[data-action]').forEach(button=>{
    if(!MUTATION_ACTIONS.includes(button.dataset.action)&&!['auth-link','auth-link-confirm','auth-logout'].includes(button.dataset.action))return;
    if(locked){if(button.dataset.serverDisabled===undefined)button.dataset.serverDisabled=String(!!button.disabled);button.disabled=true;}
    else if(button.dataset.serverDisabled!==undefined){button.disabled=button.dataset.serverDisabled==='true';delete button.dataset.serverDisabled;}
  });
  const input=document.querySelector('#nickname');if(input)input.disabled=locked;
  refreshRetryControls();
}
function refreshRetryControls(){
  const left=api.retryIn();
  app.querySelectorAll('[data-action]').forEach(button=>{
    if(!['sync','retry-request'].includes(button.dataset.action))return;
    if(left){if(!button.dataset.retryLabel)button.dataset.retryLabel=button.textContent;button.textContent=`${left}초 후 다시 연결`;button.disabled=true;}
    else if(button.dataset.retryLabel){button.textContent=button.dataset.retryLabel;delete button.dataset.retryLabel;button.disabled=false;}
  });
}
function render(){
  if(disposed)return;
  const focused=captureFocus();clearInterval(memoryTimer);clearInterval(elapsedTimer);memoryTimer=null;elapsedTimer=null;
  if(!state){app.innerHTML=['privacy','guardian'].includes(ui.view)?publicPrivacyShell(ui.view==='guardian'?guardianPage():privacySurface()):entryView();drawCanvases(app);refreshRetryControls();document.title='하루다섯 · 매일 다섯 문제';return;}
  redactExpiredMemory();
  const views={home:homeView,challenge:challengeView,result:resultView,ranking:rankingView,profile:profileView,shop:shopView,privacy:privacySurface,guardian:guardianPage};
  app.innerHTML=shell((views[ui.view]||homeView)());drawCanvases(app);setRequestControls();
  sound.setScene(ui.view==='challenge'?'challenge':ui.view==='result'?'result':ui.view==='shop'?'shop':'home');
  armMemoryTimer();armElapsedTimer();restoreFocus(focused);
  document.title=(ui.view==='home'?'매일 다섯 문제':{challenge:'오늘의 도전',result:'도전 결과',ranking:'주간 랭킹',profile:'내 정보',shop:'캐릭터 꾸미기',privacy:'나의 정보 관리',guardian:'보호자 동의 안내'}[ui.view])+' · 하루다섯';
}
function go(view){
  const next=VALID_VIEWS.includes(view)?view:'home';
  if(ui.view!==next){resetPrivacy();}
  if(view==='challenge'&&state){void startDaily();return;}
  ui.view=!state&&!['privacy','guardian'].includes(next)?'home':next;render();history.replaceState(null,'','#'+ui.view);
  window.scrollTo({top:0,behavior:'instant'});document.querySelector('#main')?.focus({preventScroll:true});
}
function toast(message){if(disposed)return;clearTimeout(toastTimer);toastEl.textContent=message;toastEl.classList.add('show');toastTimer=setTimeout(()=>toastEl.classList.remove('show'),3500);}
async function transact(action,payload,onSuccess){
  if(pending||syncing||!state)return;
  if(transaction){toast('먼저 이전 요청의 처리 결과를 다시 확인해 주세요.');return;}
  try{transaction={action,playerId:state.playerId,body:{...payload,requestId:createRequestId()},onSuccess};}
  catch(error){toast(error.message);return;}
  return runTransaction(transaction);
}
async function runTransaction(request){
  if(pending||disposed)return;
  pending=true;connectionError='';render();setRequestControls();
  try{
    const data=await api.mutate(request.action,request.body);
    if(disposed)return;
    applySnapshot(data);transaction=null;connectionError='';
    if(state.playerId===request.playerId)request.onSuccess?.(data);
    else toast('현재 로그인한 계정의 기록으로 바뀌었어요.');
  }catch(error){
    if(disposed)return;
    if(error.status===401||error.code==='SIGN_IN_REQUIRED')clearPersonalState(error);
    else if(error.retryable!==false){transaction=request;connectionError=error.message;}
    else{transaction=null;connectionError=error.message;toast(error.message);if(['ACCOUNT_CHANGED','QUESTION_CHANGED','QUESTION_ORDER','QUESTION_NOT_READY','ANSWER_ALREADY_LOCKED','ATTEMPT_NOT_FOUND','ATTEMPT_EXPIRED','ATTEMPT_CHANGED','WEEK_CLOSED','INSUFFICIENT_COINS','ITEM_NOT_OWNED','PRACTICE_USED','DAILY_REQUIRED'].includes(error.code))syncAfter=true;}
  }finally{
    pending=false;if(!disposed){render();setRequestControls();if(modal.open&&refreshGameModal)refreshGameModal();}
    if(syncAfter&&!transaction&&!disposed){syncAfter=false;await syncState();}
  }
}
function showAttempt(){ui.view='challenge';ui.result=null;ui.review=false;modal.close();history.replaceState(null,'','#challenge');render();window.scrollTo({top:0,behavior:'instant'});}
async function startDaily(){
  if(!state)return;
  if(dailyResult()){ui.result=dailyResult();ui.review=false;go('result');return;}
  if(state.active){showAttempt();return;}
  return transact('start',{mode:'daily'},()=>{if(state.active)showAttempt();else if(dailyResult()){ui.result=dailyResult();go('result');}});
}
async function practiceOffer(){
  if(!dailyResult()){toast('오늘의 도전을 마치면 무료 연습이 열려요.');return;}
  if(state.active){showAttempt();return;}
  if(state.practiceUsage[today]?.free){showModal('오늘의 연습도 마쳤어요.','공식 도전 5문제와 무료 연습을 모두 즐겼어요. 내일 새로운 도전에서 만나요.',`<button class="btn secondary full" data-action="modal-shop">캐릭터 꾸미러 가기</button>`);return;}
  return transact('start',{mode:'practice'},()=>{if(state.active)showAttempt();});
}
function armMemoryTimer(){
  if(ui.view!=='challenge'||state?.active?.phase!=='memorizing'||syncing)return;
  const key=memoryKey();
  if(api.now()>=timestamp(state.active.memoryUntil)){
    if(!memorySyncRequested.has(key)){memorySyncRequested.add(key);queueMicrotask(()=>void syncState());}
    return;
  }
  const tick=()=>{
    if(ui.view!=='challenge'||state?.active?.phase!=='memorizing')return;
    if(redactExpiredMemory()){clearInterval(memoryTimer);memoryTimer=null;render();}
    else{const el=document.querySelector('#memory-seconds');if(el)el.textContent=String(Math.max(1,Math.ceil((timestamp(state.active.memoryUntil)-api.now())/1000)));}
  };
  memoryTimer=setInterval(tick,200);
}
function armElapsedTimer(){
  if(ui.view!=='challenge'||!state?.active)return;
  elapsedTimer=setInterval(()=>{
    if(ui.view!=='challenge'||!state?.active)return;
    const current=document.querySelector('#question-elapsed'),total=document.querySelector('#attempt-elapsed'),ms=currentElapsed();
    if(current)current.textContent=duration(ms,true);
    if(total)total.textContent=duration((state.active.totalTimeMs||0)+ms,true);
  },100);
}
async function answer(){
  const active=state?.active,q=currentSet(active)[active?.index];
  if(!active||active.phase!=='answering'||!Number.isInteger(ui.selected)||ui.selected<0||ui.selected>=(q?.options?.length||0))return;
  const selected=ui.selected,mode=active.mode,day=active.date;
  return transact('answer',{attemptId:active.id,questionId:active.currentQuestionId,index:active.index,selected},()=>{
    ui.selected=null;
    if(state.active){ui.view='challenge';playSound('submit');}
    else{
      const result=(mode==='daily'?state.results:state.practiceHistory).find(r=>r.date===day);
      if(result){ui.result=result;ui.review=false;ui.view='result';playSound(result.correct===5?'perfect':'complete');}
      else{ui.view='home';toast('진행 상황을 서버에서 새로 확인했어요.');}
    }
    history.replaceState(null,'','#'+ui.view);window.scrollTo({top:0,behavior:'instant'});
  });
}
async function startMemory(){
  const active=state?.active;if(!active||active.phase!=='ready')return;
  return transact('memory',{attemptId:active.id,questionId:active.currentQuestionId},()=>playSound('tap'));
}
async function changeItem(action,itemId){
  const item=CATALOG.find(i=>i.id===itemId);if(!item)return;
  const wasOwned=state.owned.includes(itemId);
  return transact(action,{itemId},()=>{
    if(item.slot!=='character'){ui.shopItem=itemId;if(item.value==='none'){ui.shopTab='closet';ui.filter=item.slot;}}
    ui.premiumPreview=false;modal.close();refreshGameModal=null;
    playSound(action==='purchase'&&!wasOwned?'purchase':'equip');
    toast(item.slot==='character'?`${item.name}와 함께해요.`:action==='purchase'&&!wasOwned?'새 아이템을 옷장에 담고 입었어요.':'이 모습으로 갈아입었어요.');
  });
}
function accountCard(){
  const linked=authStatus?.account?.linkedProviders||[];
  const current=authStatus?.account?.provider;
  return `<section class="card record-history account-records"><div class="between"><div><h3>계정과 저장된 기록</h3><p class="account-caption">같은 계정으로 다른 기기에서도 이어서 이용해요.</p></div><button class="text-link" data-action="auth-logout" ${authBusy?'disabled':''}>로그아웃</button></div><div class="account-login-heading"><strong>로그인 연결</strong><span class="tag neutral">${current?escape(providerName(current))+'로 이용 중':'연결 확인 중'}</span></div><p class="account-caption">자주 쓰는 로그인을 추가하고 같은 친구와 기록을 만나요.</p><div class="account-login-list">${SOCIAL_PROVIDERS.map(provider=>{
    const isLinked=linked.includes(provider.id),enabled=authStatus?.providers.find(item=>item.id===provider.id)?.enabled===true;
    return `<div class="account-login-row"><div><strong>${provider.name}</strong><small>${isLinked?'이 게임 계정에 연결했어요.':enabled?'지금의 게임 계정에 추가할 수 있어요.':authError?'연결 상태를 다시 확인해 주세요.':'간편 로그인 연결을 준비하고 있어요.'}</small></div><button class="btn secondary small" data-action="auth-link" data-provider="${provider.id}" ${isLinked||!enabled||authBusy?'disabled':''}>${isLinked?'연결됨':enabled?'연결하기':authStatus?'준비 중':'확인 중'}</button></div>`;
  }).join('')}</div><p class="account-caption">다른 계정에 연결된 로그인은 자동으로 합쳐지지 않아요. 사용하던 계정에서 연결해 주세요.</p><div class="account-login-actions">${authError?'<button class="text-link" data-action="auth-refresh">연결 다시 확인</button>':''}<button class="text-link" data-action="release-info">로그인 · 출시 준비 안내</button>${supportContact()}</div><div class="privacy-account-links"><button class="btn secondary" data-action="privacy-open">${icon('shield',true)} 나의 정보 관리</button><button class="text-link" data-action="guardian-open">보호자 동의 안내</button></div><div class="account-data-download"><button class="btn secondary" data-action="export-server">${icon('book',true)} 내 서비스 기록 다운로드</button><p class="account-caption">서비스 기록 파일에는 나의 게임 정보가 담겨 있어요. 다운로드한 파일은 안전하게 보관해 주세요.</p></div>${legacyRecord?`<div class="legacy-record"><strong>이 브라우저의 이전 테스트 기록</strong><p>${escape(legacyRecord.name)} · 공식 도전 ${fmt(legacyRecord.dailyCount)}일 · ${fmt(legacyRecord.coins)} 테스트 코인 · 친구 ${fmt(legacyRecord.friends)}종</p><p>이전 파일을 그대로 보관하고 있어요. 계정의 점수·코인과 합산하지 않아요.</p><button class="text-link" data-action="export-legacy">이전 테스트 기록 JSON 받기 ${icon('arrow',true)}</button></div>`:''}</section>`;
}
function resetPrivacy(){
  privacyApi.destroy();privacyApi=createPrivacyApi();privacyEpoch++;
  privacy={loading:false,busy:false,status:null,children:[],hasMore:false,selected:null,error:'',notice:'',uncertain:false};
  privacyConfirmation=null;
  if(privacyModal){modal.close();modal.innerHTML='';refreshGameModal=null;privacyModal=false;}
}
function privacyCurrent(epoch,owner){return !disposed&&epoch===privacyEpoch&&ui.view==='privacy'&&state?.playerId===owner&&authStatus?.authenticated!==false&&!logoutUnconfirmed;}
function privacyMessage(error){
  if(error.code==='REAUTH_REQUIRED')return '정보 관리를 위해 다시 로그인해 주세요. 로그인 연결이 준비 중이면 운영 문의를 이용해 주세요.';
  if(error.code==='ACCOUNT_CHANGED'||error.code==='STALE_PRIVACY_RESPONSE')return '로그인한 계정이 바뀌었어요. 현재 계정을 확인한 뒤 화면을 다시 열어 주세요.';
  if(error.status===404||error.status===503||error.code==='AUTH_NOT_CONFIGURED')return '이 환경의 정보 관리 연결을 준비하고 있어요. 도움이 필요하면 운영 문의를 이용해 주세요.';
  if(error.status===403)return '현재 계정의 정보 관리 권한을 다시 확인해 주세요.';
  return error.message||'정보를 확인하지 못했어요. 연결 후 다시 확인해 주세요.';
}
function privacyFailure(error,{uncertain=false}={}){
  const message=privacyMessage(error);
  if(error.status===401&&error.code!=='REAUTH_REQUIRED'){clearPersonalState(error);ui.view='privacy';history.replaceState(null,'','#privacy');privacy.error=message;return;}
  const keep=uncertain&&privacy.selected?privacy.children.find(child=>child.childAccountId===privacy.selected):null;
  resetPrivacy();privacy.error=message;privacy.uncertain=uncertain;
  if(keep){privacy.children=[keep];privacy.selected=keep.childAccountId;}
}
async function openPrivacy(){
  modal.close();refreshGameModal=null;go('privacy');await loadPrivacy();
}
async function loadPrivacy(){
  if(disposed||ui.view!=='privacy'||!state||authBusy||logoutUnconfirmed)return;
  const selected=privacy.selected;
  resetPrivacy();privacy.loading=true;
  const epoch=privacyEpoch,owner=state.playerId;
  render();
  try{
    const status=await privacyApi.status();if(!privacyCurrent(epoch,owner))return;
    if(status.playerId!==owner)throw Object.assign(new Error('계정이 바뀌었어요.'),{code:'ACCOUNT_CHANGED',status:409});
    const children=status.capabilities.childManagement?await privacyApi.children():{children:[],hasMore:false};
    if(!privacyCurrent(epoch,owner))return;
    privacy.status=status;privacy.children=children.children;privacy.hasMore=children.hasMore;
    privacy.selected=children.children.some(child=>child.childAccountId===selected)?selected:null;
  }catch(error){if(privacyCurrent(epoch,owner)){privacyFailure(error);render();}}
  finally{if(privacyCurrent(epoch,owner)){privacy.loading=false;render();}}
}
function selectedPrivacyChild(){return privacy.children.find(child=>child.childAccountId===privacy.selected)||null;}
async function refreshPrivacyContext(context,epoch,owner){
  const status=await privacyApi.status();
  if(!privacyCurrent(epoch,owner))return false;
  if(status.accountContext!==context||status.playerId!==owner)throw Object.assign(new Error('계정이 바뀌었어요.'),{code:'ACCOUNT_CHANGED',status:409});
  const children=status.capabilities.childManagement?await privacyApi.children():{children:[],hasMore:false};
  if(!privacyCurrent(epoch,owner))return false;
  privacy.status=status;privacy.children=children.children;privacy.hasMore=children.hasMore;
  if(!children.children.some(child=>child.childAccountId===privacy.selected))privacy.selected=null;
  return true;
}
async function exportPrivacy(target){
  if(!state||privacy.busy||privacy.loading||privacy.uncertain||!privacy.status||authBusy||!['self','child'].includes(target))return;
  const child=target==='child'?selectedPrivacyChild():null;
  if(target==='child'&&(!child||!privacy.status.capabilities.childManagement))return;
  if(target==='self'&&!privacy.status.capabilities.selfExport)return;
  const context=privacy.status.accountContext,epoch=privacyEpoch,owner=state.playerId,selection=privacy.selected;
  privacy.busy=true;privacy.error='';render();
  try{
    const data=await privacyApi.exportData({accountContext:context,...(child?{childAccountId:child.childAccountId}:{})});
    if(!privacyCurrent(epoch,owner)||selection!==privacy.selected)return;
    if(!await refreshPrivacyContext(context,epoch,owner))return;
    if(child&&!privacy.children.some(item=>item.childAccountId===child.childAccountId))return;
    downloadJson(data,`haru-five-${child?'child-':'my-'}records-${today}.json`);
    privacy.notice='기록 파일을 준비했어요. 받은 파일은 안전하게 보관해 주세요.';
  }catch(error){if(privacyCurrent(epoch,owner)){privacyFailure(error);render();}}
  finally{if(privacyCurrent(epoch,owner)){privacy.busy=false;render();}}
}
function confirmPrivacy(operation){
  const child=selectedPrivacyChild();
  if(!state||!child||privacy.busy||privacy.loading||privacy.uncertain||!privacy.status?.capabilities.childManagement)return;
  if(operation==='withdraw'&&child.state!=='active')return;
  if(operation==='delete'&&!['active','withdrawn'].includes(child.state))return;
  if(!['withdraw','delete'].includes(operation))return;
  privacyConfirmation={operation,childAccountId:child.childAccountId,context:privacy.status.accountContext,epoch:privacyEpoch,owner:state.playerId};
  privacyModal=true;
  const deleting=operation==='delete';
  showModal(deleting?'어린이의 기록 삭제를 요청할까요?':'어린이의 동의를 철회할까요?',
    `<strong>${escape(child.label)}</strong> 계정에 적용돼요.`,
    `<button class="btn ghost" data-action="close-modal">취소</button><button class="btn privacy-danger" data-action="privacy-confirm" data-operation="${operation}">${deleting?'삭제 요청 접수':'동의 철회하기'}</button>`,
    `<div class="privacy-notice warning"><p>${deleting?'게임 이용을 중단하고 기록 삭제를 요청해요. 접수 즉시 모든 자료가 삭제되는 것은 아니며 처리 상태를 따로 확인해야 해요.':'게임 이용과 새 기록 저장이 중단돼요. 보호자는 기록을 내려받거나 삭제를 요청할 수 있어요.'}</p><p>진행 전에 필요한 기록을 다운로드해 주세요. 현재 화면에서 취소하거나 이용을 다시 시작할 수는 없어요.</p></div>`);
}
async function commitPrivacy(operation){
  const proof=privacyConfirmation;
  if(!proof||proof.operation!==operation||!privacyCurrent(proof.epoch,proof.owner)||privacy.busy||privacy.selected!==proof.childAccountId||privacy.status?.accountContext!==proof.context)return;
  privacyConfirmation=null;privacyModal=false;modal.close();modal.innerHTML='';refreshGameModal=null;
  privacy.busy=true;privacy.error='';privacy.notice='';render();
  try{
    const input={accountContext:proof.context,childAccountId:proof.childAccountId};
    const result=operation==='delete'?await privacyApi.requestDeletion(input):await privacyApi.withdraw(input);
    if(!privacyCurrent(proof.epoch,proof.owner))return;
    if(!await refreshPrivacyContext(proof.context,proof.epoch,proof.owner))return;
    privacy.notice=operation==='delete'?'삭제 요청을 접수했어요. 자료 삭제가 완료된 상태는 아니에요.':'동의를 철회했어요. 게임 이용이 중단됐으며 보호자는 기록을 계속 관리할 수 있어요.';
    if(result.state==='deleted')privacy.notice='현재 서비스 자료의 삭제 상태를 확인했어요. 백업 등 나머지 처리 범위는 운영 문의로 확인해 주세요.';
  }catch(error){if(privacyCurrent(proof.epoch,proof.owner))privacyFailure(error,{uncertain:error.status===0||error.status>=500||['PRIVACY_TIMEOUT','PRIVACY_NETWORK_ERROR','INVALID_PRIVACY_RESPONSE'].includes(error.code)});}
  finally{if(privacyCurrent(proof.epoch,proof.owner)){privacy.busy=false;render();}else if(!disposed&&ui.view==='privacy')render();}
}
function privacySurface(){
  return privacyPage({signedIn:!!state&&authStatus?.authenticated!==false,...privacy});
}
function publicPrivacyShell(content){
  return `<main id="main" class="privacy-public" tabindex="-1"><div class="privacy-public-brand">${brand()}</div>${content}</main>`;
}
async function refreshFocusedSession(){
  if(document.hidden||disposed)return;
  if(ui.view==='privacy'){resetPrivacy();render();}
  await Promise.allSettled([syncState(),syncAuth()]);
  if(ui.view==='privacy'&&state)await loadPrivacy();
}

function downloadJson(data,filename,raw=false){
  const blob=new Blob([raw?data:JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function exportServer(){
  if(ui.exporting)return;ui.exporting=true;const owner=state?.playerId,epoch=privacyEpoch;
  const button=document.querySelector('[data-action="export-server"]');if(button){button.disabled=true;button.textContent='기록을 준비하고 있어요…';}
  try{const data=await api.export();if(!disposed&&state?.playerId===owner&&epoch===privacyEpoch&&!logoutUnconfirmed){if(!data.export)throw new Error('내보낼 기록을 확인하지 못했어요. 다시 시도해 주세요.');downloadJson(data.export,`haru-five-records-${today}.json`);}}
  catch(error){if(!disposed&&epoch===privacyEpoch){if(error.status===401)clearPersonalState(error);else toast(error.message);}}
  finally{ui.exporting=false;render();}
}


function reminderCard(context='result') {
  if(context==='result' && reminder.status==='none' && !shouldOfferReminder(reminder,today))return '';
  const confirmed=reminder.status==='confirmed',prepared=reminder.status==='prepared';
  const title=confirmed?'다음 도전도, 나의 시간에':prepared?'캘린더 등록을 마무리해 주세요.':context==='result'?'내일도 다섯 문제, 함께 풀까요?':'내일의 도전 알림';
  const text=confirmed?`매일 ${reminderTimeLabel(reminder.time)} · 한국 시간 · 캘린더 등록 확인`:prepared?`매일 ${reminderTimeLabel(reminder.time)} 알림을 준비했어요. 캘린더에 저장하면 마무리돼요.`:'내일도 도전할 수 있게 알림을 보내드릴까요? 원하는 시간에 캘린더 알림을 설정할 수 있어요.';
  return `<section class="reminder-card ${context==='profile'?'reminder-profile':''}" aria-label="내일의 도전 알림"><div class="reminder-art">${avatar({background:'transparent',pose:'happy'})}<span aria-hidden="true">✦</span></div><div class="reminder-copy"><span class="eyebrow">SEE YOU TOMORROW</span><h3>${title}</h3><p>${text}</p><div class="reminder-actions"><button class="btn small" data-action="reminder-open">${icon('clock',true)} ${confirmed?'알림 관리':prepared?'등록 방법 보기':'알림 설정하기'}</button>${context==='result'&&reminder.status==='none'?'<button class="text-link" data-action="reminder-later">나중에 할게요</button>':''}</div></div></section>`;
}

function reminderDialog(forceNew=false) {
  if(!forceNew && reminder.status==='prepared'){reminderSteps();return;}
  if(!forceNew && reminder.status==='confirmed'){
    showModal('캘린더 알림 관리','캘린더에 추가했다고 확인한 설정이에요. 시간 변경과 알림 해제는 등록한 캘린더에서 할 수 있어요.',`<button class="btn secondary full" data-action="close-modal">확인했어요</button>`,`<div class="reminder-summary"><strong>매일 ${reminderTimeLabel(reminder.time)}</strong><span>한국 시간 · 하루다섯 오늘의 5문제</span></div><div class="modal-note">시간을 바꾸려면 캘린더의 반복 일정을 수정해 주세요.<br>알림을 멈추려면 해당 일정의 모든 반복을 삭제해 주세요.</div><div class="reminder-manage"><button class="text-link" data-action="reminder-instructions">등록 방법 다시 보기</button><button class="text-link" data-action="reminder-removed">캘린더에서 삭제했어요</button></div>`);
    return;
  }
  ui.reminderDraftTime=reminder.time;
  ui.reminderDraftCreatedAt=new Date().toISOString();
  const firstDay=addDays(dateKey(new Date(ui.reminderDraftCreatedAt)),1);
  showModal('내일의 도전 알림','캘린더에 매일 반복되는 도전 일정을 추가해요. 다시 만나고 싶은 시간을 골라주세요.',`<button class="btn full" data-action="reminder-file">${icon('clock',true)} 캘린더 일정 파일 받기</button>`,`<div class="reminder-time-row"><label class="form-label" for="reminder-time">알림 받을 시간</label><input class="field-input" type="time" id="reminder-time" value="${escape(reminder.time)}" required step="60"></div><div class="time-presets" role="group" aria-label="자주 고르는 시간">${[['08:00','아침 8시'],['12:30','점심 12시 30분'],['20:00','저녁 8시']].map(([value,label])=>`<button class="filter" data-action="reminder-time" data-time="${value}">${label}</button>`).join('')}</div><div class="reminder-summary"><strong>${dateLabel(firstDay)}부터 매일</strong><span>한국 시간 · 일정 시작 시각에 알림</span></div><div id="reminder-error" class="form-error" role="alert"></div><p class="modal-note">받은 일정을 캘린더에 저장하고 알림을 켜주세요. 파일이 바로 열리지 않으면 직접 등록할 수도 있어요.</p><button class="text-link reminder-manual-button" data-action="reminder-manual">캘린더에 직접 등록할게요 ${icon('arrow',true)}</button>${reminder.status!=='none'?'<p class="modal-note">기존 일정은 자동으로 바뀌지 않아요. 이미 등록했다면 캘린더에서 수정해 중복을 피해주세요.</p>':''}`);
}

function reminderEvent(time=reminder.time,usePreparedDate=false) {
  const uid=reminder.uid||`haru-five-${globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}@daily.local`;
  const createdAt=usePreparedDate?reminder.preparedAt:ui.reminderDraftCreatedAt;
  return createCalendarReminder({time,now:createdAt?new Date(createdAt):new Date(),uid});
}

async function prepareReminder(route) {
  if(ui.reminderPreparing)return;
  ui.reminderPreparing=true;
  try{await prepareCalendarReminder(route);}finally{ui.reminderPreparing=false;}
}

async function prepareCalendarReminder(route) {
  const time=document.querySelector('#reminder-time')?.value||ui.reminderDraftTime||reminder.time;
  if(!validReminderTime(time)){
    const error=document.querySelector('#reminder-error');if(error)error.textContent='알림 시간을 선택해 주세요.';
    return;
  }
  const event=reminderEvent(time);
  if(route==='file'){
    try{
      const blob=new Blob([event.content],{type:'text/calendar;charset=utf-8'});
      const file=typeof File==='function'?new File([blob],event.filename,{type:'text/calendar'}):null;
      const nav=globalThis.navigator;
      if(file&&nav?.share&&nav.canShare?.({files:[file]})){
        await nav.share({files:[file],title:'하루다섯 도전 알림'});
      }else{
        const url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download=event.filename;document.body.appendChild(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),30000);
      }
    }catch(error){
      if(error?.name==='AbortError'){toast('파일 공유를 취소했어요. 원할 때 다시 설정해 주세요.');return;}
      showModal('캘린더에 직접 등록할 수 있어요.','이 브라우저에서는 일정 파일을 열지 못했어요. 시간과 일정 내용을 보고 캘린더에 직접 추가해 주세요.',`<button class="btn full" data-action="reminder-manual">직접 등록 방법 보기</button>`);
      // A failed export must not overwrite an already confirmed calendar time.
      ui.reminderDraftTime=time;return;
    }
  }
  reminder={...reminder,time,uid:event.uid,status:'prepared',preparedAt:event.createdAt,confirmedAt:null};
  saveReminder();render();reminderSteps();
}

function reminderSteps() {
  const event=reminderEvent(reminder.time,true);
  showModal('캘린더에서 저장하면 준비 끝!','아래 내용을 캘린더에 추가하고, 일정의 알림이 켜져 있는지 확인해 주세요.',`<button class="btn full" data-action="reminder-confirm">${icon('check',true)} 캘린더에 추가했어요</button>`,`<ol class="reminder-steps"><li>받은 일정 파일을 캘린더로 열거나, 캘린더에서 새 일정을 만들어요.</li><li><strong>${dateLabel(event.firstDay)}, ${reminderTimeLabel(event.time)}</strong>부터 <strong>매일 반복</strong>으로 설정해요.</li><li>알림을 <strong>일정 시작 시각</strong>으로 선택하고 저장해요.</li></ol><label class="form-label" for="reminder-copy">직접 등록할 때 사용할 내용</label><textarea id="reminder-copy" class="reminder-copy-field" readonly rows="7">${escape(event.manualText)}</textarea><div class="reminder-help-actions"><button class="text-link" data-action="reminder-copy">일정 내용 복사 ${icon('book',true)}</button><button class="text-link" data-action="reminder-new">다른 시간으로 만들기</button></div><p class="modal-note">아이폰에서 파일이 캘린더로 열리지 않으면 위 내용으로 새 일정을 만들어 주세요. 이 게임에서는 캘린더의 실제 등록 여부를 확인할 수 없어요.</p>`);
}

async function copyReminderDetails() {
  const field=document.querySelector('#reminder-copy');if(!field)return;
  try{if(!globalThis.navigator?.clipboard?.writeText)throw new Error('unavailable');await navigator.clipboard.writeText(field.value);toast('일정 내용을 복사했어요. 캘린더에 붙여넣어 주세요.');}
  catch{field.focus();field.select();toast('선택한 내용을 복사해서 캘린더에 추가해 주세요.');}
}

function showModal(title,text,actions='',body='',onGameChange=null){if(disposed)return;refreshGameModal=onGameChange;modal.innerHTML=`<div class="modal-content"><div class="modal-top"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="close-modal" aria-label="닫기">${icon('close')}</button></div>${text?`<p>${text}</p>`:''}${body}${actions?`<div class="modal-actions">${actions}</div>`:''}</div>`;if(!modal.open)modal.showModal();drawCanvases(modal);setRequestControls();}
function settlementPreview(){
  const award=state.awards[addDays(weekKey(today),-7)],tier=award?TIERS.find(t=>t.id===award.tierId):null;
  if(!award){showModal('한 주를 마치면 배지를 만나요.','한국시간 월요일 00시에 마감된 공식 기록으로 지난주의 순위와 등급을 정해요.',`<button class="btn full" data-action="close-modal">확인했어요</button>`,`<p class="modal-note">주간 보상은 해당 주의 최종 기록에 따라 한 번 지급돼요. 이번 주 기록은 월요일부터 새로 쌓고, 모은 친구와 코인은 계속 간직해요.</p>`);return;}
  showModal('지난주의 기록을 모았어요.',weekLabel(award.week)+` · ${fmt(award.rank)}위 / ${fmt(award.total)}명`,`<button class="btn full" data-action="close-modal">확인했어요</button>`,`<div class="modal-badge">${avatar({pose:'happy',background:'transparent'})}<h3>${escape(award.tierName||tier?.name)} 등급</h3><p>이번 주에 표시되는 나의 배지예요.</p></div><div class="modal-coins"><small>서버에 지급 기록이 남은 주간 보상</small><strong>+ ${coins(award.coins??tier?.reward??0)}</strong></div>`);
}

function rulesDialog(){showModal('정답을 먼저, 시간은 그다음.','한 주의 정답 개수와 전체 풀이 시간으로 순위를 매기고, 다음 주에 그 결과로 얻은 배지를 달아요.',`<button class="btn full" data-action="close-modal">확인했어요</button>`,`<ul class="rules-list"><li>정답 1개당 1,000점, 시간 보너스는 최대 99점이에요. 정답 개수가 항상 우선이에요.</li><li>주간 점수는 한국시간 월요일부터 일요일까지의 정답을 합산하고 전체 풀이 시간으로 보너스를 한 번 계산해요.</li><li>같은 정답 개수끼리는 서버에 기록된 답 제출 시간이 짧을수록 높아요. 표시 점수가 같아도 실제 시간으로 비교하고, 두 값이 같으면 공동 순위예요.</li><li>메뉴 이동·새로고침·연결이 끊어진 동안에도 시간이 계속돼요. 기억 배열의 정해진 노출 시간은 제외해요.</li><li>하루 첫 공식 도전만 랭킹과 분야별 기록에 반영해요. 무료 연습과 캐릭터 구매는 점수에 영향을 주지 않아요.</li><li>이번 주 배지는 지난주 최종 결과로 정해져요. 코인, 친구와 옷, 이전 배지 기록은 주가 바뀌어도 남아요.</li></ul><div class="modal-note">문제·난이도·보상은 출시를 준비하며 검증 중이에요. 이 게임의 기록은 IQ 검사 점수가 아니에요.</div>`);}

function aboutDialog(){showModal('하루다섯 · 출시 준비 0.5.1','여섯 도트 친구와 매일 다섯 문제를 만나고, 한 주의 성취를 모아요.',`<button class="btn full" data-action="close-modal">계속 즐기기</button>`,`<div class="info-lines"><div><strong>계정에 연결된 나의 기록</strong>로그인한 계정으로 도전 기록, 코인과 옷장을 서버에 저장해요. 다른 기기에서도 같은 계정으로 이어서 이용할 수 있어요.</div><div><strong>서버가 문제와 결과를 관리해요</strong>문제는 한 번에 한 문항씩 받아요. 정답과 해설은 다섯 문제를 마친 뒤 확인하고, 풀이 시간과 점수는 서버에서 기록해요.</div><div><strong>첫 토끼부터 모으는 친구들</strong>구름토끼와 시작 코인 180개로 출발해요. 다른 친구 5종과 아이템은 도전으로 얻은 코인으로 모아요. 현재 게임 이용과 하루 한 번의 추가 연습은 무료예요.</div><div><strong>나의 작은 취향</strong>스피커 버튼으로 소리를 켜고 배경음·효과음 음량을 조절해요. 알림은 캘린더 반복 일정으로 등록하며 소리와 알림 설정은 이 브라우저에 보관해요.</div><div><strong>이전 테스트 기록은 보관해요</strong>이 브라우저에 남아 있는 이전 기록은 내 정보에서 확인하고 파일로 받을 수 있어요. 계정의 공식 점수나 코인과 합산하지 않아요.</div><div><strong>출시를 준비하고 있어요</strong>실제 광고와 결제는 아직 연결하지 않았어요. 문제와 난이도를 검증하고 있어요. 게임의 분야별 기록은 IQ 검사 점수가 아니에요.</div></div>`);}

function characterDialog(item){
  const missing=Math.max(0,item.cost-state.coins);
  showModal(`${escape(item.name)}와 함께할까요?`,escape(item.description),`<button class="btn full" data-action="buy-character" data-id="${item.id}" ${missing?'disabled':''}>${coins(item.cost)}으로 영입하기</button>`,`<div class="character-modal-art" style="background:${item.color}">${avatar({...state.equipped,character:item.value,background:'transparent',pose:'happy'})}</div><div class="character-purchase-summary"><span>보유 코인</span><strong>${coins(state.coins)}</strong></div><p class="purchase-hint">${missing?`${fmt(missing)}코인을 더 모으면 만날 수 있어요.`:'한 번 영입하면 내 친구로 계속 남아요.'}<br>지금 모은 옷과 소품을 함께 사용할 수 있어요.</p>`,()=>{if(state.owned.includes(item.id))modal.close();else characterDialog(item);});
}
function renameDialog(){showModal('어떤 이름으로 불러드릴까요?','한글·영문·숫자와 공백으로 2~12글자를 입력해 주세요.',`<button class="btn ghost" data-action="close-modal">취소</button><button class="btn" data-action="save-name">이름 저장</button>`,`<label class="form-label" for="nickname">닉네임</label><input id="nickname" class="field-input" maxlength="12" autocomplete="off" value="${escape(state.name)}"><div class="form-error" id="name-error" role="alert"></div>`);setTimeout(()=>document.querySelector('#nickname')?.focus(),50);}

async function handleAction(event){
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;const a=button.dataset.action;
  if(a==='auth-sites'){event.preventDefault?.();await beginLogin('chatgpt');return;}
  if(a==='auth-login'){await beginLogin(button.dataset.provider);return;}
  if(a==='auth-logout'){await signOut();return;}
  if(a==='auth-refresh'){await syncAuth();return;}
  if(a==='auth-dismiss'){authError='';authNotice=null;render();return;}
  if(a==='release-info'){releaseInfoDialog();return;}
  if(a==='privacy-open'){await openPrivacy();return;}
  if(a==='guardian-open'){modal.close();refreshGameModal=null;go('guardian');return;}
  if(a==='privacy-back'){go(state?'profile':'home');return;}
  if(a==='privacy-refresh'){if(!privacy.busy)await loadPrivacy();return;}
  if(a==='privacy-child'){if(!privacy.busy&&privacy.children.some(child=>child.childAccountId===button.dataset.child)){privacy.selected=button.dataset.child;privacy.notice='';render();}return;}
  if(a==='privacy-export'){await exportPrivacy(button.dataset.target);return;}
  if(a==='privacy-withdraw'||a==='privacy-delete'){confirmPrivacy(a==='privacy-delete'?'delete':'withdraw');return;}
  if(a==='privacy-confirm'){await commitPrivacy(button.dataset.operation);return;}
  if(a==='nav'&&!state){go(button.dataset.view);return;}
  if(a==='close-modal'){privacyConfirmation=null;privacyModal=false;modal.close();modal.innerHTML='';refreshGameModal=null;return;}
  if(a==='sync'){await syncState();return;}
  if(a==='retry-request'){if(transaction)await runTransaction(transaction);return;}
  if(a==='sound'){if(!audioSettings.enabled)applyAudioSettings({enabled:true});wakeAudio();audioDialog();return;}
  if(a==='audio-toggle'){applyAudioSettings({enabled:!audioSettings.enabled});if(audioSettings.enabled)wakeAudio();return;}
  if(a==='audio-retry'){if(!audioSettings.enabled)applyAudioSettings({enabled:true});wakeAudio();return;}
  if(a==='audio-preview'){if(!['complete','purchase'].includes(button.dataset.effect))return;if(!audioSettings.enabled)applyAudioSettings({enabled:true});playSound(button.dataset.effect);return;}
  if(!state)return;
  if(MUTATION_ACTIONS.includes(a)&&(pending||transaction||syncing||authBusy))return;
  if(a==='auth-link'){linkLoginDialog(button.dataset.provider);return;}
  if(a==='auth-link-confirm'){await beginLogin(button.dataset.provider,'link');return;}
  if(a==='auth-logout'){await signOut();return;}
  if(a==='answer'){await answer();return;}
  wakeAudio();
  if(a==='reminder-open'){reminderDialog();return;}
  if(a==='reminder-new'){reminderDialog(true);return;}
  if(a==='reminder-instructions'){reminderSteps();return;}
  if(a==='reminder-later'){reminder={...reminder,dismissedOn:today};saveReminder();render();toast('내 정보에서 언제든 알림을 설정할 수 있어요.');return;}
  if(a==='reminder-time'){const input=document.querySelector('#reminder-time');if(input&&validReminderTime(button.dataset.time))input.value=button.dataset.time;return;}
  if(a==='reminder-file'||a==='reminder-manual'){await prepareReminder(a==='reminder-file'?'file':'manual');return;}
  if(a==='reminder-copy'){await copyReminderDetails();return;}
  if(a==='reminder-confirm'){if(!['prepared','confirmed'].includes(reminder.status))return;reminder={...reminder,status:'confirmed',confirmedAt:new Date().toISOString()};const saved=saveReminder();modal.close();render();toast(saved?'캘린더 등록 확인을 저장했어요. 내일도 만나요!':'캘린더 일정은 유지돼요. 이 브라우저에는 확인 표시를 저장하지 못했어요.');return;}
  if(a==='reminder-removed'){reminder={...freshReminder(),time:reminder.time,dismissedOn:today};const saved=saveReminder();modal.close();render();toast(saved?'이 브라우저의 알림 등록 표시를 초기화했어요.':'브라우저에 표시 변경을 저장하지 못했어요. 캘린더의 삭제 상태에는 영향을 주지 않아요.');return;}
  if(a==='character'){const item=CATALOG.find(i=>i.id===button.dataset.id&&i.slot==='character');if(!item)return;if(!state.owned.includes(item.id)){characterDialog(item);return;}await changeItem('equip',item.id);return;}
  if(a==='buy-character'){await changeItem('purchase',button.dataset.id);return;}
  if(a==='nav'){go(button.dataset.view);playSound('tap');return;}
  if(a==='daily'){await startDaily();return;}
  if(a==='select'){
    const selected=Number(button.dataset.option),q=currentSet()[state.active?.index];
    if(state.active?.phase!=='answering'||!Number.isInteger(selected)||selected<0||selected>=(q?.options?.length||0))return;
    ui.selected=selected;document.querySelectorAll('.option').forEach(el=>{const chosen=Number(el.dataset.option)===ui.selected;el.classList.toggle('selected',chosen);el.setAttribute('aria-pressed',String(chosen));});
    const next=document.querySelector('[data-action="answer"]');if(next)next.disabled=false;playSound('tap');return;
  }
  if(a==='memory-start'){await startMemory();return;}
  if(a==='practice'){await practiceOffer();return;}
  if(a==='resume-active'){if(state.active)showAttempt();return;}
  if(a==='close-modal'){privacyConfirmation=null;privacyModal=false;modal.close();modal.innerHTML='';refreshGameModal=null;return;}
  if(a==='modal-shop'){modal.close();go('shop');return;}
  if(a==='greet'){clearTimeout(celebrationTimer);ui.avatarHappy=true;const canvas=button.querySelector('canvas');if(canvas)drawAvatar(canvas,{...state.equipped,background:'garden',pose:'happy',scale:2});toast('반가워요! 오늘도 함께 다섯 문제.');playSound('greet');celebrationTimer=setTimeout(()=>{ui.avatarHappy=false;if(ui.view==='home')render();},1500);return;}
  if(a==='review'){ui.review=true;render();requestAnimationFrame(()=>document.querySelector('#answer-review')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}));return;}
  if(a==='stat-field'){ui.field=button.dataset.field;render();return;}
  if(a==='field-about'){const field=FIELDS.find(f=>f.id===button.dataset.field);if(field)showModal(escape(field.label)+' 분야',escape(field.description),`<button class="btn secondary full" data-action="close-modal">확인했어요</button>`);return;}
  if(a==='teaser'){const item=CATALOG.find(i=>i.id===button.dataset.id&&i.slot!=='character');if(!item)return;ui.shopItem=item.id;ui.shopTab='shop';ui.filter=item.slot;ui.premiumPreview=false;go('shop');return;}
  if(a==='shop-select'){ui.shopItem=button.dataset.id;ui.premiumPreview=false;render();if(window.innerWidth<620)document.querySelector('.fitting-room')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});return;}
  if(a==='shop-tab'){if(!['shop','closet','collection'].includes(button.dataset.tab))return;ui.shopTab=button.dataset.tab;ui.premiumPreview=false;if(ui.shopTab!=='collection'){const items=CATALOG.filter(i=>i.slot!=='character'&&(ui.filter==='all'||i.slot===ui.filter)&&(ui.shopTab==='closet'?state.owned.includes(i.id):i.value!=='none'));if(!items.some(i=>i.id===ui.shopItem))ui.shopItem=items[0]?.id||'outfit-mint';}render();return;}
  if(a==='filter'){if(!['all','outfit','hat','accessory','background'].includes(button.dataset.filter))return;ui.filter=button.dataset.filter;ui.premiumPreview=false;const items=CATALOG.filter(i=>i.slot!=='character'&&(ui.filter==='all'||i.slot===ui.filter)&&(ui.shopTab==='closet'?state.owned.includes(i.id):i.value!=='none'));if(!items.some(i=>i.id===ui.shopItem)&&items.length)ui.shopItem=items[0].id;render();return;}
  if(a==='buy'||a==='equip'){await changeItem(a==='buy'?'purchase':'equip',button.dataset.id);return;}
  if(a==='try-premium'){ui.premiumPreview=true;render();document.querySelector('.fitting-room')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});return;}
  if(a==='end-premium'){ui.premiumPreview=false;render();return;}
  if(a==='wallet'){showModal('도전으로 모으는 꾸미기 코인',`지금 ${fmt(state.coins)} 코인을 가지고 있어요.`,`<button class="btn full" data-action="modal-shop">꾸미기 상점으로</button>`,`<div class="modal-note">처음 가입하면 시작 코인 180개를 받아요.<br>오늘의 공식 5문제를 완료하면 +${DAILY_COMPLETION_COINS} 코인.<br>주간 정산에서는 등급에 따른 코인을 더 받아요.<br>무료 연습은 랭킹 점수와 코인에 영향을 주지 않아요.</div>`);return;}
  if(a==='settlement-preview'){settlementPreview();return;}
  if(a==='rules'){rulesDialog();return;}
  if(a==='about'){aboutDialog();return;}
  if(a==='rename'){renameDialog();return;}
  if(a==='save-name'){
    const name=document.querySelector('#nickname')?.value.trim().replace(/\s+/g,' ')||'';
    if(!/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]{2,12}$/.test(name)){const error=document.querySelector('#name-error');if(error)error.textContent='한글·영문·숫자와 공백으로 2~12글자를 입력해 주세요.';return;}
    await transact('rename',{name},()=>{modal.close();toast('새 이름을 서버에 저장했어요.');});return;
  }
  if(a==='export-server'){await exportServer();return;}
  if(a==='export-legacy'){if(legacyRecord)downloadJson(legacyRecord.raw,`haru-five-previous-playtest-${today}.json`,true);return;}
}
const listeners=[];
function listen(target,event,handler){target.addEventListener(event,handler);listeners.push(()=>target.removeEventListener(event,handler));}
listen(app,'click',handleAction);listen(modal,'click',handleAction);
listen(modal,'input',event=>{const kind=event.target.dataset?.audioVolume;if(!['musicVolume','effectsVolume'].includes(kind))return;const percent=Number(event.target.value);if(!Number.isFinite(percent))return;applyAudioSettings({[kind]:Math.max(0,Math.min(100,percent))/100});if(audioSettings.enabled)wakeAudio();});
function dismissModal(){privacyConfirmation=null;privacyModal=false;modal.close();modal.innerHTML='';refreshGameModal=null;}
listen(modal,'cancel',event=>{event.preventDefault();dismissModal();});
listen(modal,'click',event=>{if(event.target===modal){const rect=modal.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dismissModal();}});
listen(window,'hashchange',()=>{const view=location.hash.slice(1);if(VALID_VIEWS.includes(view)){go(view);if(view==='privacy')void loadPrivacy();}});
listen(window,'storage',event=>{
  if(event.key===STORAGE_KEY){legacyRecord=readLegacy();if(ui.view==='profile')render();}
  if(event.key===REMINDER_STORAGE_KEY){reminder=readReminder();render();}
  if(event.key===AUDIO_STORAGE_KEY){audioSettings=readAudioSettings();sound.setSettings(audioSettings);refreshAudioUI(sound.getStatus());}
});
listen(document,'visibilitychange',()=>{sound.setHidden(document.hidden);if(!document.hidden)return refreshFocusedSession();else{resetPrivacy();if(ui.view==='privacy')render();redactExpiredMemory();}});
listen(window,'focus',refreshFocusedSession);
listen(window,'pagehide',()=>{sound.setHidden(true);resetPrivacy();if(ui.view==='privacy')render();});
listen(window,'pageshow',()=>{sound.setHidden(document.hidden);return refreshFocusedSession();});
const dateTimer=setInterval(()=>{if(state&&!document.hidden&&dateKey(new Date(api.now()))!==today)void syncState();},30000);
const retryTimer=setInterval(refreshRetryControls,1000);
function destroy(){
  if(disposed)return;
  disposed=true;for(const remove of listeners)remove();
  for(const timer of [memoryTimer,elapsedTimer,dateTimer,retryTimer])clearInterval(timer);
  for(const timer of [toastTimer,celebrationTimer])clearTimeout(timer);
  sound.setHidden(true);sound.dispose();authApi.destroy();privacyApi.destroy();privacyEpoch++;privacyConfirmation=null;state=null;transaction=null;modal.close();
}
render();
const ready=Promise.allSettled([syncState(),syncAuth()]).then(async()=>{if(!disposed&&ui.view==='privacy'&&state)await loadPrivacy();});
return {destroy,ready};


}
