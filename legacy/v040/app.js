import { FIELDS, TIERS, dateKey, weekKey, addDays, makeDailySet, makePracticeSet, makePreviewSet, scoreAnswers, getFieldStats, comparePerformance } from './game-core.js';
import { drawAvatar, drawItem } from './avatar.js';
import { AUDIO_STORAGE_KEY, normalizeAudioSettings, createAudioController } from './audio.js';
import { ensureQuestionClock, questionElapsed, recordAnswerTime, totalAttemptTime } from './attempt-timer.js';
import { STORAGE_KEY, DAILY_COMPLETION_COINS, CATALOG, COLLECTION, freshState, normalizeState, rankSummary, commitDaily, settleWeeks, purchaseItem, equipItem, reservePractice } from './state.js';
import { REMINDER_STORAGE_KEY, freshReminder, normalizeReminder, validReminderTime, reminderTimeLabel, shouldOfferReminder, createCalendarReminder } from './reminders.js';

const app=document.querySelector('#app');
const modal=document.querySelector('#modal');
const toastEl=document.querySelector('#toast');
const VALID_VIEWS=['home','challenge','result','ranking','profile','shop'];
let storageAvailable=true;
function readState(){try{const text=localStorage.getItem(STORAGE_KEY);return text?normalizeState(JSON.parse(text)):freshState();}catch{storageAvailable=false;return freshState();}}
let state=readState();
function readReminder(){try{const raw=localStorage.getItem(REMINDER_STORAGE_KEY);return raw?normalizeReminder(JSON.parse(raw)):freshReminder();}catch{return freshReminder();}}
let reminder=readReminder();
function saveReminder(){try{localStorage.setItem(REMINDER_STORAGE_KEY,JSON.stringify(reminder));return true;}catch{storageAvailable=false;return false;}}
let today=dateKey();
state=settleWeeks(state,today);
if(state.active?.date!==today)state.active=null;
function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch{storageAvailable=false;}}
save();
const ui={view:VALID_VIEWS.includes(location.hash.slice(1))?location.hash.slice(1):'home',selected:null,result:null,review:false,sampleStats:false,field:'spatial',shopTab:'shop',filter:'all',shopItem:'outfit-lilac',premiumPreview:false,avatarHappy:false};
let memoryTimer=null,elapsedTimer=null,toastTimer=null,celebrationTimer=null,refreshGameModal=null;
let audioStorageAvailable=true;
function readAudioSettings(){try{const raw=localStorage.getItem(AUDIO_STORAGE_KEY);return normalizeAudioSettings(raw?JSON.parse(raw):null);}catch{return normalizeAudioSettings(null);}}
let audioSettings=readAudioSettings(),sound=null;
sound=createAudioController({onStatus:refreshAudioUI});
sound.setSettings(audioSettings);
sound.setHidden(document.hidden);
function saveAudioSettings(){try{localStorage.setItem(AUDIO_STORAGE_KEY,JSON.stringify(audioSettings));audioStorageAvailable=true;}catch{audioStorageAvailable=false;}}
function applyAudioSettings(next){audioSettings=normalizeAudioSettings({...audioSettings,...next});saveAudioSettings();sound.setSettings(audioSettings);refreshAudioUI(sound.getStatus());}
function wakeAudio(){if(audioSettings.enabled&&!sound.getStatus().ready)void sound.unlock().catch(()=>{});}
function playSound(name){
  if(!audioSettings.enabled)return;
  if(sound.getStatus().ready){sound.play(name);return;}
  void sound.unlock().then(ready=>{if(ready&&audioSettings.enabled)sound.play(name);}).catch(()=>{});
}


function escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(value){return Number(value||0).toLocaleString('ko-KR',{maximumFractionDigits:2});}
function duration(value,live=false){
  if(!Number.isFinite(value)||value<0)return '시간 기록 없음';
  const seconds=Math.floor(value/(live?100:10))/(live?10:100),minutes=Math.floor(seconds/60),rest=(seconds%60).toFixed(live?1:2).padStart(live?4:5,'0');
  return minutes>=60?`${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}:${rest}`:`${minutes}:${rest}`;
}
function performanceLine(performance){return `정답 ${fmt(performance.correct)}개 · ${duration(performance.totalTimeMs)}`;}

function icon(name,small=false){const paths={sound:'<path d="m11 5-6 4H2v6h3l6 4z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',muted:'<path d="m11 5-6 4H2v6h3l6 4z"/><path d="m16 9 6 6m0-6-6 6"/>',home:'<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',spark:'<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"/>',cup:'<path d="M8 3h8v7a4 4 0 0 1-8 0zM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v5m-4 2h8"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',shirt:'<path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4a4 4 0 0 1-8 0z"/>',arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',left:'<path d="m14 5-7 7 7 7"/>',down:'<path d="m6 9 6 6 6-6"/>',check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',play:'<path d="m9 5 11 7-11 7z"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',edit:'<path d="m15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-3-3L5 16z"/>',repeat:'<path d="M3 10a9 9 0 0 1 16-5l2 3m0-5v5h-5M21 14a9 9 0 0 1-16 5l-2-3m0 5v-5h5"/>',book:'<path d="M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z"/>',gift:'<path d="M3 8h18v5H3zm2 5v8h14v-8M12 8v13"/><path d="M12 8H7a3 3 0 1 1 3-3zm0 0h5a3 3 0 1 0-3-3z"/>',shield:'<path d="m12 3 8 4v6c0 5-8 9-8 9s-8-4-8-9V7z"/><path d="m8 12 3 3 5-6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'};return `<svg class="icon${small?' sm':''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.spark}</svg>`;}
function coins(value){return `<span class="coin"><span class="coin-dot" aria-hidden="true">H</span>${fmt(value)}<span class="sr-only"> 코인</span></span>`;}
function characterName(value=state.equipped.character){return CATALOG.find(item=>item.slot==='character'&&item.value===value)?.name||'구름토끼';}
function avatar(options={},className='',label=''){return `<canvas class="${className}" width="192" height="192" data-avatar="${escape(JSON.stringify(options))}" role="img" aria-label="${escape(label||characterName(options.character||state.equipped.character)+' 도트 캐릭터')}"></canvas>`;}
function itemCanvas(item){return `<canvas width="192" height="192" data-item="${escape(item.id)}" role="img" aria-label="${escape(item.name)} 착용 모습"></canvas>`;}
function tierTextColor(tier){return {amber:'#8c5e19',jade:'#306e55',sapphire:'#396aa7',ruby:'#ae446b',diamond:'#64589f',aurora:'#2b706f'}[tier?.id]||'#6d5b7b';}
function fieldTextColor(id){return {logic:'#7260b1',math:'#946224',spatial:'#376fa1',language:'#a24868',memory:'#317860',observation:'#8455a0'}[id]||'#78628f';}
function fixedTier(){const last=addDays(weekKey(today),-7);const award=state.awards[last];return award?TIERS.find(t=>t.id===award.tierId):null;}
function emptyTierName(){return state.results.some(r=>r.date<weekKey(today))||Object.keys(state.awards).length?'전주 기록 없음':'첫 도전';}
function tierPill(tier=fixedTier()){return tier?`<span class="tier-pill" style="color:${escape(tierTextColor(tier))};background:${escape(tier.color)}1f"><i class="tier-gem" aria-hidden="true"></i>${escape(tier.name)}</span>`:'<span class="tier-pill first"><i class="tier-gem" aria-hidden="true"></i>'+emptyTierName()+'</span>';}
function dailyResult(){return state.results.find(r=>r.mode==='daily'&&r.date===today)||null;}
function currentSet(active=state.active){
  if(Array.isArray(active?.questions)&&active.questions.length===5)return active.questions;
  // Older attempts must retain their original bank and answer explanations.
  return active?.mode==='practice'?makePracticeSet(active.date,active.seed):makeDailySet(active?.date||today);
}
function dateLabel(key=today){return new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Seoul'}).format(new Date(key+'T00:00:00+09:00'));}
function weekLabel(week=weekKey(today)){return `${week.slice(5).replace('-','.')} — ${addDays(week,6).slice(5).replace('-','.')}`;}
function navActive(view){return view===ui.view||(view==='home'&&ui.view==='result');}
const NAV=[['home','home','홈'],['challenge','spark','오늘의 도전'],['ranking','cup','랭킹'],['profile','user','내 정보'],['shop','shirt','꾸미기']];
function brand(){return '<button class="brand" data-action="nav" data-view="home" aria-label="하루다섯 홈"><img class="brand-mark" src="./favicon.svg" alt=""><div><div class="brand-name">하루다섯</div><div class="brand-caption">FIVE LITTLE MOMENTS</div></div></button>';}
function heading(title,description,extra=''){return `<div class="page-heading${extra?' ranking-heading':''}"><div><h1>${title}</h1><p>${description}</p></div>${extra}</div>`;}
function shell(content){return `<div class="shell"><aside class="sidebar">${brand()}<nav class="sidebar-nav" aria-label="메인 메뉴">${NAV.map(([view,ico,label])=>`<button class="nav-item ${navActive(view)?'active':''}" data-action="nav" data-view="${view}" ${navActive(view)?'aria-current="page"':''}>${icon(ico)}<span class="nav-label">${label}</span>${navActive(view)?'<i class="nav-pip"></i>':''}</button>`).join('')}</nav><div class="sidebar-note"><div class="tiny-stars" aria-hidden="true">· ✧ ·</div><strong>하루의 작은 성취가 쌓이는 곳</strong><p>오늘도, 나의 속도로.<br>다섯 문제에서 만나요.</p></div></aside><div class="workspace"><header class="topbar"><div class="top-date">${dateLabel()} <span aria-hidden="true">·</span> 오늘의 작은 도전</div><div class="mobile-brand">${brand()}</div><div class="top-actions"><span class="tag neutral">PLAY TEST · 0.4.0</span>${audioButton()}<button class="coin-wallet" data-action="wallet" aria-label="보유 코인 ${state.coins}개, 코인 안내">${coins(state.coins)}</button><button class="mini-avatar" data-action="nav" data-view="profile" aria-label="내 정보 보기">${avatar({background:'transparent'})}</button></div></header><main id="main" tabindex="-1" class="view-enter">${content}</main><footer class="footer"><span>하루다섯 · v0.4.0 플레이 테스트${storageAvailable?' · 기록은 이 브라우저에 저장돼요.':' · 저장할 수 없는 환경이에요. 창을 닫으면 기록이 사라져요.'}</span><button data-action="about">이 버전 안내 ${icon('info',true)}</button></footer></div><nav class="bottom-nav" aria-label="모바일 메인 메뉴">${NAV.map(([view,ico,label])=>`<button class="${navActive(view)?'active':''}" data-action="nav" data-view="${view}" ${navActive(view)?'aria-current="page"':''}>${icon(ico)}<span>${view==='challenge'?'도전':label}</span></button>`).join('')}</nav></div>`;}

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
  const result=dailyResult();const summary=rankSummary(state,today);const done=result?5:state.active?.mode==='daily'?state.active.answers.length:0;
  const presentFields=makeDailySet(today,state.playerId).map(q=>q.field);const week=weekKey(today);
  return `${heading(`${escape(state.name)}님, 반가워요.`,result?'오늘의 다섯 문제를 마쳤어요. 이제 가볍게 둘러볼까요?':'오늘은 어떤 발견이 기다리고 있을까요?')}<section class="home-grid" aria-label="오늘의 도전과 주간 기록"><div class="daily-hero"><div class="hero-cloud" aria-hidden="true"></div><span class="hero-flower" aria-hidden="true">✧</span><div class="hero-copy"><span class="tag">${result?'오늘의 도전 완료':'TODAY’S CHALLENGE'}</span><h2>${result?'오늘의 도전,<br>모두 마쳤어요.':'다섯 문제,<br>가볍게 시작해요.'}</h2><p>${result?'오늘 쌓은 기록을 확인하고<br>나에게 어울리는 옷을 골라봐요.':'나에게 배정된 다섯 문제.<br>정답 개수와 풀이 시간을 기록해요.'}</p><button class="btn" data-action="daily">${result?'오늘의 결과 보기':done?'이어서 풀기':'오늘의 도전 시작'} ${icon('arrow',true)}</button><div class="hero-progress" aria-label="${done} / 5문제 완료">${Array.from({length:5},(_,i)=>`<span class="${i<done?'done':''}"></span>`).join('')}</div></div><button class="hero-avatar" data-action="greet" aria-label="캐릭터에게 인사하기">${avatar({pose:ui.avatarHappy?'happy':'idle',background:'garden'})}</button></div><div class="weekly-card"><div class="week-head"><div class="eyebrow">MY WEEK · ${weekLabel()}</div><h3>이번 주 랭킹 점수</h3><div class="week-score">${fmt(summary.score)}<span>점</span></div><div class="week-rank">${summary.participated?`체험 리그 ${fmt(summary.rank)}위 / ${fmt(summary.total)}명`:'첫 도전을 마치면 순위가 생겨요.'}</div></div><div class="week-dots" aria-label="이번 주 도전 기록">${['월','화','수','목','금','토','일'].map((label,i)=>{const key=addDays(week,i),complete=state.results.some(r=>r.date===key);return `<div class="day-dot"><i class="${key===today?'today ':''}${complete?'complete':''}">${complete?'✓':'·'}</i><span>${label}</span></div>`;}).join('')}</div><div class="divider"></div><div class="week-bottom">${tierPill()}<p class="badge-note">${fixedTier()?'지난주 성적으로 얻은 이번 주 배지':'월요일에 새로운 주간 등급을 만나요.'}</p></div></div></section><section class="home-under"><div class="card field-preview"><div class="between"><h3>오늘 만나는 분야</h3><span class="tag neutral">매일 5개 분야</span></div><div class="field-bubbles">${FIELDS.map((f,i)=>`<button class="field-bubble ${presentFields.includes(f.id)?'':'rest'}" data-action="field-about" data-field="${f.id}" aria-label="${f.label}${presentFields.includes(f.id)?' 분야 안내':' 오늘은 쉬는 분야'}"><i style="--field-bg:${['#efe8f9','#faead8','#e4eff8','#fae4e6','#e9eefb','#e5f0e4'][i]};--field-color:${escape(fieldTextColor(f.id))}">${['◇','＋','▱','가','▦','◎'][i]}</i><span>${escape(f.label)}</span></button>`).join('')}</div></div><div class="card practice-tile"><div class="practice-copy"><h3>조금 더 풀고 싶은 날엔</h3><p>${result?'정답 부담 없이, 연습 5문제를 더 풀어요.':'오늘의 도전을 마치면 연습이 열려요.'}</p></div><div class="practice-actions"><button class="text-link" data-action="practice">${state.active?.mode==='practice'?'연습 이어하기':'추가 연습'} ${icon('arrow',true)}</button>${result?'<button class="text-link preview-link" data-action="preview-test">새 문제 테스트 · 랭킹 미반영</button>':''}</div></div></section><div class="section-title"><div><h2>나를 닮은 작은 취향</h2><p>도전으로 모은 코인으로 꾸며보세요.</p></div><button class="text-link" data-action="nav" data-view="shop">상점 둘러보기 ${icon('arrow',true)}</button></div><div class="shop-teasers">${['outfit-raincoat','hat-sprout','accessory-camera'].map(id=>{const item=CATALOG.find(i=>i.id===id);return `<button class="teaser" data-action="teaser" data-id="${id}"><div class="teaser-art" style="background:${item.color}">${itemCanvas(item)}</div><div><strong>${item.name}</strong>${coins(item.cost)}<div class="teaser-sub">미리 입어보기</div></div></button>`;}).join('')}</div>`;
}

function challengeView(){
  let active=state.active;
  if(!active){ui.view=dailyResult()?'result':'home';return ui.view==='result'?resultView():homeView();}
  const questions=currentSet(active),q=questions[active.index];
  if(!q){state.active=null;save();ui.view='home';return homeView();}
  const clocked=ensureQuestionClock(active,q);if(clocked!==active){state.active=clocked;active=clocked;save();}
  const field=FIELDS.find(f=>f.id===q.field);const practice=active.mode==='practice',preview=active.practiceKind==='preview';
  const elapsed=questionElapsed(active,q),total=totalAttemptTime(active,q);
  let memoryBlock='',showOptions=true;
  if(q.visual?.type==='memory'){
    const memory=active.memory?.[active.index];
    if(!memory){showOptions=false;memoryBlock=`<div class="memory-stage"><span class="memory-preview-symbol" aria-hidden="true">▦</span><p class="muted" style="font-size:12px">${q.visual.seconds}초 동안 배열을 기억해 주세요.</p><button class="btn secondary" data-action="memory-start">준비됐어요 ${icon('play',true)}</button></div>`;}
    else if(Date.now()<memory.until){showOptions=false;memoryBlock=`<div class="memory-stage"><div class="memory-grid" style="--columns:${q.visual.columns}">${q.visual.cells.map(c=>`<div class="memory-cell">${escape(c||'·')}</div>`).join('')}</div><p class="memory-timer"><span id="memory-seconds">${Math.max(1,Math.ceil((memory.until-Date.now())/1000))}</span>초 뒤 배열이 가려져요.</p></div>`;}
    else memoryBlock='<div class="memory-stage" style="min-height:auto"><div class="memory-note">배열을 가렸어요. 기억한 내용을 떠올려 보세요.</div></div>';
  }
  return `<div class="challenge-wrap"><div class="challenge-top between"><button class="text-link" data-action="nav" data-view="home">${icon('left',true)} 나가기 · 시간은 계속돼요</button><span class="question-top-label muted" style="font-size:12px">${preview?'새 문제 테스트':practice?'추가 연습':'오늘의 도전'} <strong class="purple">${active.index+1} / 5</strong></span></div><div class="question-progress" aria-label="5문제 중 ${active.index+1}번째">${questions.map((_,i)=>`<span class="${i<active.index?'done':i===active.index?'current':''}"></span>`).join('')}</div><section class="card question-card"><div class="question-kicker"><span class="tag" style="color:${escape(fieldTextColor(field?.id))}">${escape(field?.label||q.field)} ${practice?'연습':'도전'}</span><div class="difficulty" aria-label="난이도 ${q.level}">${Array.from({length:5},(_,i)=>`<i class="${i<q.level?'on':''}"></i>`).join('')}<span>${practice?'순위 미반영':'정답 1,000점'}</span></div></div><div class="answer-clock">${icon('clock',true)}<span>이번 문제 <strong id="question-elapsed">${duration(elapsed.elapsedMs,true)}</strong></span><span>합계 <strong id="attempt-elapsed">${duration(total,true)}</strong></span></div><h1 class="question-title">${escape(q.visual?.type==='memory'&&!showOptions?'잠깐 나타나는 배열을 기억해 주세요.':q.prompt)}</h1>${memoryBlock}${showOptions?`<div class="options" role="group" aria-label="답 선택">${q.options.map((option,i)=>`<button class="option ${ui.selected===i?'selected':''}" aria-pressed="${ui.selected===i}" data-action="select" data-option="${i}"><span class="option-num">${i+1}</span><span>${escape(option)}</span></button>`).join('')}</div><div class="question-actions"><p>정답과 해설은<br>다섯 문제를 마친 뒤에 알려드려요.</p><button class="btn" data-action="answer" ${ui.selected===null?'disabled':''}>${active.index===4?'결과 확인하기':'답 확정하고 다음'} ${icon('arrow',true)}</button></div>`:''}</section><div class="question-foot">${avatar({background:'transparent',pose:'happy'})}<span>${active.timingVersion!==1?'이전 버전에서 시작한 도전이에요. 시간 보너스 없이 정답 개수만 반영해요.':practice?'연습·테스트는 랭킹, 코인, 분야별 기록에 반영되지 않아요.':'정답 개수가 우선이에요. 같은 개수를 맞히면 전체 답 제출 시간이 짧을수록 높아요.'}<small>문제를 연 순간부터 시간을 재요. 메뉴 이동·새로고침 중에도 계속되며, 기억 배열의 고정 노출 시간은 제외해요.</small></span></div></div>`;
}

function resultView(){
  const result=ui.result||dailyResult();
  if(!result){ui.view='home';return homeView();}
  const practice=result.mode==='practice',preview=result.practiceKind==='preview',legacy=result.scoringVersion!==2;const summary=rankSummary(state,today);const questions=currentSet(result);
  return `<div class="challenge-wrap">${heading(preview?'새 문제 테스트 완료!':practice?'가볍게 한 번 더, 완료!':'오늘의 기록이 쌓였어요.',practice?'연습에서 발견한 풀이를 다음 도전에 활용해 보세요.':dateLabel(result.date)+' · 다섯 문제를 끝까지 풀었어요.')}<section class="card result-card"><div class="result-hero">${avatar({background:'transparent',pose:'happy'},'result-avatar')}<h2>${result.correct===5?'다섯 문제 모두 맞혔어요!':result.correct>=3?'차근차근 잘 풀었어요.':'끝까지 도전한 오늘도 소중해요.'}</h2><div class="result-number">${result.correct}<small> / 5문제 정답</small></div><p>${practice?'연습 결과 · 공식 기록에 포함되지 않아요.':'오늘 한 번의 도전이 나만의 기록으로 남았어요.'}</p></div><div class="result-body"><div class="result-stats"><div><small>${legacy?'이전 버전 점수':practice?'연습 점수':'오늘의 도전 점수'}</small><strong>${fmt(result.score)}<small> 점</small></strong></div><div><small>${practice?'공식 랭킹':'이번 주 랭킹 점수'}</small><strong>${practice?'미반영':fmt(summary.score)}${practice?'':'<small> 점</small>'}</strong></div><div><small>${practice?'꾸미기 보상':'완주 보상'}</small><strong>${practice?'없음':coins(DAILY_COMPLETION_COINS)}</strong></div></div><div class="score-breakdown">${legacy?'<p>이전 버전 기록이에요. 당시 점수와 해설은 유지하며, 주간 순위에는 정답 개수를 새 기준으로 반영해요.</p>':`<span>정답 점수 <strong>${fmt(result.baseScore)}</strong></span><span>시간 보너스 <strong>+${fmt(result.speedBonus)}</strong></span>`}<span>답 제출 시간 <strong>${duration(result.totalTimeMs)}</strong></span></div>${!result.timingComplete?'<p class="timing-note">기록된 시간이 없는 도전에는 시간 보너스를 붙이지 않아요.</p>':''}<div class="result-actions"><button class="btn" data-action="review">${icon('book',true)} 정답과 해설 보기</button><button class="btn secondary" data-action="nav" data-view="profile">${icon('user',true)} 내 기록 보기</button></div></div></section><section class="ad-cta"><div><h3>조금 더 풀고 싶나요?</h3><p>${practice?'오늘 남은 연습 기회를 확인해 보세요.':'무료 연습 1회 · 이후 광고 보상 흐름을 체험할 수 있어요.'}</p></div><button class="btn small secondary" data-action="practice">연습 더 하기 ${icon('arrow',true)}</button></section><section class="preview-test-card"><div><span class="tag neutral">추가 문제 · 랭킹 미반영</span><p>새로 생성한 문제로 출제와 시간 점수를 확인해 보세요. 기록·코인·연습 횟수는 바뀌지 않아요.</p></div><button class="btn secondary small" data-action="preview-test">${preview?'다른 문제로 다시 테스트':'새 문제 테스트'} ${icon('repeat',true)}</button></section>${ui.review?`<section class="answer-review" id="answer-review"><div class="section-title"><h2>오늘의 풀이 노트</h2><span class="tag neutral">${practice?'연습':'공식 도전'}</span></div>${result.details.map((detail,i)=>{const q=questions[i],field=FIELDS.find(f=>f.id===detail.field);return `<details class="review-item" ${i===0?'open':''}><summary><span class="review-mark ${detail.correct?'':'wrong'}">${detail.correct?'✓':'·'}</span><strong>${i+1}번째 문제</strong><span class="muted">${escape(field?.label)}</span><span class="muted">${detail.correct?'정답':'다시 살펴보기'}</span>${icon('down',true)}</summary><div class="review-content"><p class="review-prompt">${escape(q?.prompt)}</p>${q?.visual?.type==='memory'?`<div class="memory-grid" style="--columns:${q.visual.columns};width:190px;margin:15px auto">${q.visual.cells.map(c=>`<div class="memory-cell">${escape(c||'·')}</div>`).join('')}</div>`:''}<div class="review-answer">정답: <strong>${escape(q?.options[detail.answer])}</strong></div>${!detail.correct?`<p class="review-yours">내가 고른 답: ${escape(q?.options[detail.selected]??'선택하지 않음')}</p>`:''}<p class="explanation">${escape(detail.explanation)}</p><p class="review-time">답 제출까지 ${duration(detail.elapsedMs)}</p></div></details>`;}).join('')}</section>`:''}${!practice&&ui.review?reminderCard():''}</div>`;
}

const SAMPLE_STATS=[['logic',21,24],['math',18,23],['spatial',22,24],['language',16,23],['memory',14,23],['observation',20,23]];
function profileStats(){return ui.sampleStats?FIELDS.map(f=>{const a=SAMPLE_STATS.find(x=>x[0]===f.id)||[f.id,0,0];return {field:f.id,label:f.label,correct:a[1],total:a[2],accuracy:a[2]?a[1]/a[2]*100:null};}):getFieldStats(state.results,today).map(s=>({...s,accuracy:s.total?s.correct/s.total*100:null}));}
function radar(stats){const cx=180,cy=157,radius=98;const point=(index,r)=>{const a=-Math.PI/2+index*Math.PI/3;return [cx+Math.cos(a)*r,cy+Math.sin(a)*r];};const all=stats.every(f=>f.total>0);const rings=[.25,.5,.75,1].map(r=>`<polygon points="${stats.map((_,i)=>point(i,radius*r).join(',')).join(' ')}" fill="${r===1?'#faf8fc':'none'}" stroke="#e8dfed" stroke-width="1"/>`).reverse().join('');return `<svg class="radar-chart" viewBox="0 0 360 320" role="img" aria-label="분야별 최근 28일 첫 도전 정답률. ${stats.map(s=>`${s.label} ${s.total?Math.round(s.accuracy)+'퍼센트':'기록 없음'}`).join(', ')}"><g>${rings}${stats.map((s,i)=>{const p=point(i,radius);return `<path d="M${cx} ${cy}L${p.join(' ')}" fill="none" stroke="#e8dfed" stroke-dasharray="${s.total?'none':'3 4'}"/>`;}).join('')}${all?`<polygon class="radar-zone" points="${stats.map((s,i)=>point(i,radius*s.accuracy/100).join(',')).join(' ')}"/>`:''}${stats.map((s,i)=>{const p=point(i,radius*(s.accuracy??0)/100),label=point(i,radius+30);const anchor=i===0||i===3?'middle':i<3?'start':'end';return `${s.total?`<circle cx="${p[0]}" cy="${p[1]}" r="${ui.field===s.field?5:3.5}" fill="#aa87c4" stroke="#fff" stroke-width="2"/>`:''}<text class="axis-label" x="${label[0]}" y="${label[1]-5}" text-anchor="${anchor}">${escape(s.label)}</text><text class="axis-score" x="${label[0]}" y="${label[1]+17}" text-anchor="${anchor}">${s.total?Math.round(s.accuracy)+'%':'—'}</text>`;}).join('')}<text class="tick-label" x="185" y="154">0</text><text class="tick-label" x="185" y="${cy-radius*.5-4}">50</text><text class="tick-label" x="185" y="${cy-radius-4}">100</text></g></svg>`;}
function profileView(){const stats=profileStats(),selected=stats.find(f=>f.field===ui.field)||stats[0];const summary=rankSummary(state,today);return `${heading('차곡차곡, 나의 기록','좋아하는 분야도, 새롭게 발견한 분야도 모아봐요.')}<section class="profile-grid"><div class="card identity-card"><div class="identity-scene">${avatar()}</div><div class="identity-content"><div class="identity-name"><span class="nickname">${escape(state.name)}</span><button class="icon-button" data-action="rename" aria-label="닉네임 바꾸기">${icon('edit',true)}</button></div>${tierPill()}<p>${fixedTier()?'지난주 성적으로 획득 · 이번 주 표시':emptyTierName()==='전주 기록 없음'?'지난주에는 도전 기록이 없어요.':'첫 주간 정산을 기다리고 있어요.'}</p><div class="profile-summary"><div><small>함께한 도전</small><strong>${state.results.length}<small> 일</small></strong></div><div><small>주간 랭킹 점수</small><strong>${fmt(summary.score)}</strong></div></div><button class="btn secondary full" data-action="nav" data-view="shop">${icon('shirt',true)} 캐릭터 꾸미기</button></div></div><div class="card radar-card"><div class="radar-header"><div><h2>분야별 도전 기록</h2><p>최근 28일 · 첫 도전 정답률</p></div><label class="sample-toggle"><input type="checkbox" id="sample-stats" ${ui.sampleStats?'checked':''}>샘플 기록 보기</label></div><div class="radar-wrap">${radar(stats)}</div><div class="radar-fields">${stats.map(s=>`<button class="radar-field ${ui.field===s.field?'active':''}" aria-pressed="${ui.field===s.field}" data-action="stat-field" data-field="${s.field}"><span>${escape(s.label)}</span><strong>${s.total?Math.round(s.accuracy)+'%':'—'}</strong></button>`).join('')}</div><p class="radar-detail" aria-live="polite">${selected.total?`${escape(selected.label)} · 정답 ${selected.correct} / ${selected.total}문제${selected.total<10?' · 기록 쌓는 중':''}`:`${escape(selected.label)} 분야의 첫 기록을 기다리고 있어요.`}</p><div class="record-note">${ui.sampleStats?'가상 기록 예시예요. 실제 내 기록과 합쳐지지 않아요.':stats.some(s=>!s.total)?'여섯 분야에 기록이 생기면 육각형이 연결돼요. 아직 풀지 않은 분야는 —로 표시해요.':'매주 초기화되지 않아요. 최근 28일 동안 공식 도전에서 푼 문제만 모아요.'} 게임 속 문제풀이 기록이며 IQ 점수는 아니에요.</div></div></section>${reminderCard('profile')}<section class="card record-history"><div class="between"><h3>최근 도전</h3><span class="tag neutral">${state.results.length}개의 하루</span></div>${state.results.length?state.results.slice(-7).reverse().map(r=>`<div class="history-row"><div><strong>${dateLabel(r.date)}</strong><br><span>${r.correct} / 5문제 정답 · ${r.scoringVersion===2?duration(r.totalTimeMs):'이전 버전 기록'}</span></div><strong class="purple">${fmt(r.score)}점</strong></div>`).join(''):'<p class="history-empty">오늘의 다섯 문제로 첫 기록을 만들어 보세요.</p>'}</section><section class="card record-history"><div class="between"><h3>나의 주간 배지</h3><button class="text-link" data-action="settlement-preview">정산 미리보기 ${icon('arrow',true)}</button></div>${Object.values(state.awards).length?Object.values(state.awards).sort((a,b)=>b.week.localeCompare(a.week)).slice(0,6).map(a=>`<div class="history-row"><div><strong>${weekLabel(a.week)}</strong><br><span>체험 리그 ${fmt(a.rank)}위 · ${fmt(a.score)}점</span></div><span>${tierPill(TIERS.find(t=>t.id===a.tierId))}</span></div>`).join(''):'<p class="history-empty">첫 주를 마치면 이곳에 배지가 남아요.<br>구매한 옷과 이전 배지 기록은 계속 간직해요.</p>'}</section>`;}

function rankingView(){const s=rankSummary(state,today);let rows=[...s.opponents];if(s.participated)rows.push({id:'me',name:state.name,score:s.score,correct:s.correct,totalTimeMs:s.totalTimeMs,timingComplete:s.timingComplete,sample:false});rows.sort((a,b)=>comparePerformance(a,b)||a.id.localeCompare(b.id));rows=rows.map(r=>({...r,rank:rows.findIndex(a=>comparePerformance(a,r)===0)+1}));const leaders=[rows[1],rows[0],rows[2]].filter(Boolean);const award=state.awards[addDays(weekKey(today),-7)];return `${heading('이번 주, 함께 도전해요.',weekLabel()+' · 매주 월요일 00:00 한국시간 정산',`<button class="btn ghost small" data-action="rules">등급 안내 ${icon('info',true)}</button>`)}<p class="league-explainer">${icon('info',true)}체험 리그예요. 다른 참가자 ${fmt(s.total-1)}명은 가상 데이터이며, 내 점수만 실제 플레이 결과예요.</p><div class="ranking-layout"><section class="card"><div class="podium" aria-label="체험 리그 선두">${leaders.map((r,i)=>`<div class="podium-player">${avatar(r.sample?{character:r.character,outfit:r.outfit,background:'transparent',hat:i===1?'crown':'none'}:{background:'transparent'},'podium-avatar')}<div class="podium-base"><span class="podium-place">${r.rank}위${rows.filter(x=>comparePerformance(x,r)===0).length>1?' · 공동':''}</span><strong class="podium-name">${escape(r.name)}</strong><span class="podium-score">${fmt(r.score)}점</span></div></div>`).join('')}</div><div class="ranking-table"><div class="rank-row header"><span class="place">순위</span><span>도전자</span><span style="text-align:right">주간 점수</span></div>${rows.slice(0,10).map(r=>`<div class="rank-row"><span class="place">${r.rank}</span><div class="rank-person">${avatar(r.sample?{character:r.character,outfit:r.outfit,background:'transparent'}:{background:'transparent'})}<span>${escape(r.name)}${r.id==='me'?' <span class="tag">나</span>':''}<small class="rank-detail">${performanceLine(r)}</small></span></div><span class="score">${fmt(r.score)}</span></div>`).join('')}<div class="rank-row me"><span class="place">${s.participated?fmt(s.rank):'—'}</span><div class="rank-person">${avatar({background:'transparent'})}<span>${escape(state.name)} <span class="tag">나</span><small class="rank-detail">${performanceLine(s)}</small></span></div><span class="score">${fmt(s.score)}</span></div><p class="muted" style="font-size:10px;text-align:center;padding:9px 0 13px">${s.participated?'정답 개수 우선 · 같은 개수는 짧은 시간 우선 · 두 값이 같으면 공동 순위예요.':'오늘의 도전을 마치면 체험 리그에 참여해요.'}</p></div></section><aside class="ranking-aside"><section class="card rank-badge-card"><span class="eyebrow">THIS WEEK’S BADGE</span><div class="big-gem" style="--gem-color:${escape(fixedTier()?.color||'#b59bc8')};--gem-shadow:${escape(tierTextColor(fixedTier()))}" aria-hidden="true"></div><h3>${award?escape(award.tierName)+' 등급':'한 주의 성취를 배지로'}</h3><p>${award?'지난주 '+fmt(award.rank)+'위로 획득했어요.<br>이번 주 내내 캐릭터 옆에 표시돼요.':'지난주 최종 성적이<br>다음 주의 등급이 돼요.'}</p><button class="btn secondary full" data-action="settlement-preview">정산 장면 미리보기</button></section><section class="card tier-guide"><h3>여섯 가지 주간 등급</h3>${[...TIERS].reverse().map(t=>`<div class="tier-guide-row"><div class="row" style="color:${escape(tierTextColor(t))}"><i class="tier-gem" aria-hidden="true"></i><strong>${escape(t.name)}</strong></div><small>${t.id==='amber'?'기본 등급':'상위 '+t.ceiling+'% 이내'}</small></div>`).join('')}<p class="tier-guide-note">등급명·구간·코인 보상은 테스트 기준이에요. 주간 배지는 상점에서 판매하지 않아요.</p></section></aside></div>`;}

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
      ${ui.premiumPreview?`<button class="btn secondary full" data-action="end-premium">원래 모습으로 돌아가기</button><p class="purchase-hint">실제 구매 없이 미리 입어보는 중이에요.</p>`:owned?`<button class="btn ${equipped?'secondary':''} full" data-action="equip" data-id="${selected.id}" ${equipped?'disabled':''}>${equipped?icon('check',true)+' 착용 중':'이 모습으로 입기'}</button><p class="purchase-hint">내 옷장에서 언제든 다시 입을 수 있어요.</p>`:`<button class="btn full" data-action="buy" data-id="${selected.id}" aria-describedby="cosmetic-purchase-hint" ${missingCoins?'disabled':''}>${coins(selected.cost)}으로 구매 · 착용</button><p class="purchase-hint" id="cosmetic-purchase-hint">보유 ${fmt(state.coins)} 코인 · ${missingCoins?`${fmt(missingCoins)}코인 더 모으면 구매할 수 있어요.`:'게임에서 모은 코인 사용'}</p>`}
      ${!ui.premiumPreview?`<div class="quick-unequip">${state.equipped.hat!=='none'?'<button class="text-link" data-action="equip" data-id="hat-none">모자 벗기</button>':''}${state.equipped.accessory!=='none'?'<button class="text-link" data-action="equip" data-id="accessory-none">소품 내려놓기</button>':''}</div>`:''}</div></div>
      <div class="shop-inventory"><div class="shop-tabs" role="group" aria-label="꾸미기 메뉴">${[['shop','코인 상점'],['closet','내 옷장'],['collection','컬렉션']].map(([id,label])=>`<button class="shop-tab ${ui.shopTab===id?'active':''}" aria-pressed="${ui.shopTab===id}" data-action="shop-tab" data-tab="${id}">${label}</button>`).join('')}</div>
      ${ui.shopTab==='collection'?`<section class="collection-card"><div class="collection-scene"><span class="collection-badge">FIRST COLLECTION · 기획안</span>${avatar(COLLECTION.outfit)}</div><div class="collection-copy"><span class="eyebrow">A LITTLE STARDUST</span><h2 style="margin-top:7px">${COLLECTION.name}</h2><p>${COLLECTION.description}</p><div class="collection-price">₩${fmt(COLLECTION.price)}<small>가격 검토안</small></div><button class="btn full" data-action="try-premium">무료로 미리 입어보기 ${icon('spark',true)}</button><p class="collection-foot">유료 외형 상품의 미리보기예요. 이 버전에서는 실제 결제가 진행되지 않아요. 의상은 점수나 등급에 영향을 주지 않아요.</p></div></section>`:`<div class="shop-filters" role="group" aria-label="아이템 종류">${[['all','전체'],['outfit','의상'],['hat','모자'],['accessory','소품'],['background','배경']].map(([id,label])=>`<button class="filter ${ui.filter===id?'active':''}" aria-pressed="${ui.filter===id}" data-action="filter" data-filter="${id}">${label}<span class="filter-count">${id==='all'?pool.length:pool.filter(item=>item.slot===id).length}</span></button>`).join('')}</div><div class="shop-grid">${visible.length?visible.map(item=>`<button class="shop-item ${selected.id===item.id&&!ui.premiumPreview?'active':''}" data-action="shop-select" data-id="${item.id}" aria-label="${escape(item.name)} ${state.owned.includes(item.id)?'보유 중':item.cost+' 코인'}, 미리 입기"><div class="shop-item-art" style="background:${item.color}">${itemCanvas(item)}${state.owned.includes(item.id)?'<span class="owned-mark">보유</span>':''}</div><div class="shop-item-info"><strong>${escape(item.name)}</strong>${state.equipped[item.slot]===item.value?'<span class="equipped-text">✓ 착용 중</span>':item.cost===0?'<span class="equipped-text">기본 아이템</span>':coins(item.cost)}</div></button>`).join(''):'<div class="empty-state">아직 이 종류의 아이템이 없어요.</div>'}</div>`}</div></section>`;
}

function drawCanvases(root=document){
  const surfaces={garden:'#eaf2df',lavender:'#eee7f7',night:'#293849',beach:'#d8eff0',forest:'#d5e6d5',sunset:'#f8d3ca',snow:'#e2edf4',cloud:'#e2eafa',cafe:'#f2e7d3',transparent:'transparent'};
  root.querySelectorAll('canvas[data-avatar]').forEach(canvas=>{try{const options={...state.equipped,...JSON.parse(canvas.dataset.avatar),scale:2};drawAvatar(canvas,options);const parent=canvas.parentElement;if(parent?.matches('.identity-scene,.fitting-scene,.collection-scene'))parent.style.background=surfaces[options.background]||'#eaf2df';}catch{canvas.setAttribute('aria-label','도트 캐릭터');}});
  root.querySelectorAll('canvas[data-item]').forEach(canvas=>{const item=CATALOG.find(i=>i.id===canvas.dataset.item);if(item)drawItem(canvas,{...item,equipped:state.equipped,scale:2});});
}

function captureFocus(){const el=document.activeElement;if(!el||!app.contains(el))return null;return {id:el.id||null,data:{...el.dataset}};}
function restoreFocus(saved){if(!saved)return;let target=saved.id?document.getElementById(saved.id):null;if(!target&&saved.data.action){target=[...app.querySelectorAll('[data-action]')].find(el=>Object.entries(saved.data).every(([key,value])=>el.dataset[key]===value));}target?.focus({preventScroll:true});}
function render(){const focused=captureFocus();if(memoryTimer){clearInterval(memoryTimer);memoryTimer=null;}if(elapsedTimer){clearInterval(elapsedTimer);elapsedTimer=null;}const views={home:homeView,challenge:challengeView,result:resultView,ranking:rankingView,profile:profileView,shop:shopView};app.innerHTML=shell((views[ui.view]||homeView)());drawCanvases(app);sound.setScene(ui.view==='challenge'?'challenge':ui.view==='result'?'result':ui.view==='shop'?'shop':'home');armMemoryTimer();armElapsedTimer();restoreFocus(focused);document.title=(ui.view==='home'?'하루다섯':{challenge:'오늘의 도전',result:'도전 결과',ranking:'주간 랭킹',profile:'내 정보',shop:'캐릭터 꾸미기'}[ui.view])+' · 하루다섯';}
function go(view){checkDate(false);if(view==='challenge'){startDaily();return;}ui.view=VALID_VIEWS.includes(view)?view:'home';render();history.replaceState(null,'','#'+ui.view);window.scrollTo({top:0,behavior:'instant'});document.querySelector('#main')?.focus({preventScroll:true});}
function toast(message){clearTimeout(toastTimer);toastEl.textContent=message;toastEl.classList.add('show');toastTimer=setTimeout(()=>toastEl.classList.remove('show'),3500);}
function checkDate(renderOnChange=true){const next=dateKey();if(next===today)return true;today=next;if(state.active?.date!==today)state.active=null;state=settleWeeks(state,today);save();ui.selected=null;ui.result=null;ui.review=false;ui.view='home';modal.close();refreshGameModal=null;history.replaceState(null,'','#home');if(renderOnChange)render();toast('새로운 하루가 시작됐어요. 오늘의 문제를 만나보세요.');return false;}
function newAttempt(mode,questions,extra={}){return {mode,date:today,index:0,answers:[],memory:{},seed:0,questions,questionVersion:2,timingVersion:1,timings:[],clock:null,...extra};}
function showAttempt(){ui.view='challenge';ui.selected=null;ui.result=null;ui.review=false;modal.close();history.replaceState(null,'','#challenge');render();window.scrollTo({top:0,behavior:'instant'});}
function startDaily(){
  if(!checkDate())return;
  if(dailyResult()){ui.result=dailyResult();ui.review=false;go('result');return;}
  if(state.active?.mode==='practice'){showModal('진행 중인 연습이 있어요.','연습이나 테스트를 마친 뒤 오늘의 도전으로 돌아올 수 있어요.',`<button class="btn full" data-action="resume-active">이어서 풀기</button>`);return;}
  if(!state.active){state.active=newAttempt('daily',makeDailySet(today,state.playerId));save();}
  showAttempt();
}
function startPractice(source){
  if(!checkDate())return;
  if(state.active){showAttempt();return;}
  try{state=reservePractice(state,today,source);const seed=source==='free'?0:1;state.active=newAttempt('practice',makePracticeSet(today,seed),{source,seed});save();showAttempt();}catch(error){toast(error.message);}
}
function startPreview(){
  if(!checkDate())return;
  if(state.active){showModal('진행 중인 문제가 있어요.','먼저 현재 도전을 마쳐 주세요. 새 문제 테스트는 공식 기록과 연습 횟수에 영향을 주지 않아요.',`<button class="btn full" data-action="resume-active">진행 중인 문제 이어하기</button>`);return;}
  if(!dailyResult()){modal.close();toast('오늘의 공식 도전을 마치면 새 문제 테스트를 할 수 있어요.');return;}
  state.testRound+=1;
  state.active=newAttempt('practice',makePreviewSet(today,state.playerId,state.testRound),{practiceKind:'preview',source:'preview',seed:state.testRound});
  save();showAttempt();
}
function practiceOffer(){if(!checkDate())return;if(!dailyResult()){toast('오늘의 도전을 마치면 추가 연습이 열려요.');return;}if(state.active?.mode==='practice'){showAttempt();return;}const usage={free:0,ad:0,...state.practiceUsage[today]};if(!usage.free){startPractice('free');return;}if(!usage.ad){adDialog();return;}showModal('오늘의 연습도 모두 마쳤어요.','공식 도전 5문제와 무료 연습, 보상 연습을 모두 즐겼어요. 내일 새로운 도전에서 만나요.',`<button class="btn secondary full" data-action="modal-shop">캐릭터 꾸미러 가기</button>`);}
function armMemoryTimer(){if(ui.view!=='challenge'||!state.active)return;const active=state.active,q=currentSet(active)[active.index],memory=active.memory?.[active.index];if(q?.visual?.type!=='memory'||!memory||Date.now()>=memory.until)return;memoryTimer=setInterval(()=>{if(Date.now()>=memory.until){clearInterval(memoryTimer);memoryTimer=null;render();document.querySelector('.option')?.focus({preventScroll:true});}else{const el=document.querySelector('#memory-seconds');if(el)el.textContent=String(Math.max(1,Math.ceil((memory.until-Date.now())/1000)));}},200);}
function armElapsedTimer(){
  if(ui.view!=='challenge'||!state.active)return;
  elapsedTimer=setInterval(()=>{
    if(ui.view!=='challenge'||!state.active)return;
    const active=state.active,q=currentSet(active)[active.index];if(!q)return;
    const current=document.querySelector('#question-elapsed'),total=document.querySelector('#attempt-elapsed');
    if(current)current.textContent=duration(questionElapsed(active,q).elapsedMs,true);
    if(total)total.textContent=duration(totalAttemptTime(active,q),true);
  },100);
}
function answer(){
  if(!checkDate()||!state.active||ui.selected===null)return;
  let active=state.active;const questions=currentSet(active),q=questions[active.index];
  if(!q||!Number.isInteger(ui.selected)||ui.selected<0||ui.selected>=q.options.length)return;
  try{active=recordAnswerTime(active,q).active;}catch{toast('배열을 모두 본 다음 답을 골라 주세요.');return;}
  active.answers[active.index]=ui.selected;state.active=active;ui.selected=null;
  if(active.index<4){active.index++;save();render();playSound('submit');window.scrollTo({top:0,behavior:'instant'});document.querySelector('.question-title')?.setAttribute('tabindex','-1');document.querySelector('.question-title')?.focus({preventScroll:true});return;}
  const result={...scoreAnswers(questions,active.answers,active.timings),date:active.date,mode:active.mode,seed:active.seed,questions,questionVersion:active.questionVersion,practiceKind:active.practiceKind};
  let completedNow=true;
  if(active.mode==='daily'){
    const committed=commitDaily(state,result);state=committed.state;state.active=null;ui.result=committed.added?result:dailyResult();completedNow=committed.added;
  }else{
    if(active.practiceKind!=='preview')state.practiceHistory=[...state.practiceHistory,result];
    state.active=null;ui.result=result;
  }
  save();ui.review=false;go('result');if(completedNow)playSound(result.correct===5?'perfect':'complete');
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

function showModal(title,text,actions='',body='',onGameChange=null){refreshGameModal=onGameChange;modal.innerHTML=`<div class="modal-content"><div class="modal-top"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="close-modal" aria-label="닫기">${icon('close')}</button></div>${text?`<p>${text}</p>`:''}${body}${actions?`<div class="modal-actions">${actions}</div>`:''}</div>`;if(!modal.open)modal.showModal();drawCanvases(modal);}
function adDialog(){showModal('광고를 보고 연습 5문제 열기','광고를 선택하면 오늘 한 번 더 연습할 수 있어요. 연습은 랭킹과 분야별 기록에 반영되지 않아요.',`<button class="btn ghost" data-action="close-modal">다음에 할게요</button><button class="btn" data-action="ad-preview-complete">보상 흐름 체험</button>`,`<div class="modal-ad">${icon('play')}<strong>광고 연결 전 · 미리보기</strong><span>실제 광고 재생이나 광고 수익은 발생하지 않아요.</span></div><div class="modal-note">이 버튼은 개발용 체험이에요. 실제 서비스에서는 광고 제공사의 보상 완료 신호를 받은 뒤 연습이 열려요.</div>`);}
function settlementPreview(){const tier=TIERS.find(t=>t.id==='ruby')||TIERS[3];showModal('지난주, 수고했어요.','한 주의 도전이 다음 주의 배지가 되는 순간이에요.',`<button class="btn full" data-action="close-modal">미리보기 마치기</button>`,`<div class="modal-badge"><span class="tag neutral">가상 기록으로 보는 정산 예시</span>${avatar({pose:'happy',hat:'star',background:'transparent'})}<h3>${escape(tier.name)} 등급 획득!</h3><p>80위 / 1,000명 · 상위 8%<br>이번 주 내내 캐릭터 옆에 표시돼요.</p></div><div class="modal-coins"><small>주간 정산 보상 예시</small><strong>+ ${coins(tier.reward)}</strong></div><p class="settlement-note">연출 미리보기예요. 현재 내 등급이나 코인은 바뀌지 않아요. 실제 테스트 기록의 정산 보상은 다음 주 첫 접속에 한 번 지급돼요.</p>`);}
function rulesDialog(){showModal('정답을 먼저, 시간은 그다음.','한 주의 정답 개수와 전체 풀이 시간으로 순위를 매기고, 다음 주에 그 결과로 얻은 배지를 달아요.',`<button class="btn full" data-action="close-modal">확인했어요</button>`,`<ul class="rules-list"><li>정답 1개당 1,000점, 시간 보너스는 최대 99점이에요. 5개 정답은 언제나 4개 정답보다 높아요.</li><li>시간 보너스 = 99 × 120 ÷ (120 + 전체 답 제출 초). 소수 둘째 자리 아래는 버려요. 정답이 0개면 보너스도 0점이에요.</li><li>주간 점수는 한국시간 월요일부터 일요일까지의 정답을 합산하고, 전체 풀이 시간으로 시간 보너스를 한 번 계산해요. 일일 보너스를 더하지 않아요.</li><li>같은 개수를 맞힌 이용자끼리는 답 제출 시간이 짧을수록 높아요. 표시 점수가 같아도 실제 시간으로 비교하며, 두 값이 같으면 공동 순위예요.</li><li>문제를 연 순간부터 제출까지 시간을 재요. 메뉴 이동·새로고침 중에도 계속되며, 기억 배열의 고정 노출 시간은 제외해요.</li><li>하루 첫 공식 도전만 반영해요. 연습·새 문제 테스트·광고·캐릭터 구매는 랭킹 점수와 무관해요.</li><li>이전 버전의 시간 없는 기록은 정답만 반영해요. 이번 주에 미측정 기록이 하나라도 있으면 주간 시간 보너스는 없어요.</li><li>이번 주 배지는 지난주 최종 결과로 정해져요. 코인, 모은 친구와 옷, 이전 배지는 주가 바뀌어도 남아요.</li></ul><div class="modal-note">다른 참가자는 가상 데이터예요. 문제 난이도와 시간 보너스 비율은 테스트하며 조정할 예정이에요.</div>`);}
function aboutDialog(){showModal('하루다섯 플레이 테스트','새로 그린 여섯 도트 친구와 하루 5문제, 시간 랭킹을 즐기는 0.4.0 플레이 테스트예요.',`<button class="btn full" data-action="close-modal">계속 즐기기</button>`,`<div class="info-lines"><div><strong>실제로 즐길 수 있어요</strong>하루 5문제, 채점·해설, 풀이 시간, 최근 28일 육각형을 이용할 수 있어요. 구름토끼만 기본 제공하며 나머지 친구 5종과 꾸미기 아이템은 코인으로 모아요.</div><div><strong>같은 날, 나에게 배정된 문제를 유지해요</strong>브라우저별 이용자 식별값으로 숫자·조건·배열이 다른 문제를 생성해요. 같은 날 재접속하면 내 문제는 유지돼요. 유형과 난이도 단계는 같지만 모든 문제의 실제 난이도가 검증된 것은 아니에요.</div><div><strong>이 브라우저에 기록해요</strong>가입 없이 저장해요. 브라우저 데이터 삭제나 다른 기기 사용 시 기록이 연결되지 않아요. 체험 리그의 다른 참가자는 가상 데이터예요. 정식 경쟁을 위한 계정 연결과 서버 출제·시간 검증은 아직 없어요.</div><div><strong>소리와 함께 즐길 수 있어요</strong>위쪽 스피커를 눌러 배경음과 효과음을 켤 수 있어요. 두 음량을 따로 조절하고, 문제를 풀 때는 배경음이 더 작아져요.</div><div><strong>알림은 캘린더로 등록해요</strong>해설 아래 또는 내 정보에서 시간을 골라 매일 반복 일정을 만들 수 있어요. 캘린더에 저장하고 알림을 켜주세요. 웹 푸시는 아직 연결되어 있지 않아요.</div><div><strong>광고와 결제는 미리보기예요</strong>광고 SDK와 실제 결제는 연결되어 있지 않아요. 코인은 테스트용이며 실제 금액이 청구되지 않아요.</div><div><strong>문제와 등급은 첫 기획안이에요</strong>점수는 IQ 검사 결과가 아니에요. 문제·난이도·등급 경계·보상은 테스트하면서 다듬어갈 예정이에요.</div></div><button class="btn secondary full" data-action="preview-test">새 문제 테스트 · 랭킹 미반영</button><button class="danger-link" data-action="reset-ask">이 브라우저의 테스트 기록 초기화</button>`);}
function characterDialog(item){
  const missing=Math.max(0,item.cost-state.coins);
  showModal(`${escape(item.name)}와 함께할까요?`,escape(item.description),`<button class="btn full" data-action="buy-character" data-id="${item.id}" ${missing?'disabled':''}>${coins(item.cost)}으로 영입하기</button>`,`<div class="character-modal-art" style="background:${item.color}">${avatar({...state.equipped,character:item.value,background:'transparent',pose:'happy'})}</div><div class="character-purchase-summary"><span>보유 코인</span><strong>${coins(state.coins)}</strong></div><p class="purchase-hint">${missing?`${fmt(missing)}코인을 더 모으면 만날 수 있어요.`:'한 번 영입하면 내 친구로 계속 남아요.'}<br>지금 모은 옷과 소품을 함께 사용할 수 있어요.</p>`,()=>{if(state.owned.includes(item.id))modal.close();else characterDialog(item);});
}
function renameDialog(){showModal('어떤 이름으로 불러드릴까요?','한글·영문·숫자와 공백으로 2~12글자를 입력해 주세요.',`<button class="btn ghost" data-action="close-modal">취소</button><button class="btn" data-action="save-name">이름 저장</button>`,`<label class="form-label" for="nickname">닉네임</label><input id="nickname" class="field-input" maxlength="12" autocomplete="off" value="${escape(state.name)}"><div class="form-error" id="name-error" role="alert"></div>`);setTimeout(()=>document.querySelector('#nickname')?.focus(),50);}

function handleAction(event){const button=event.target.closest('[data-action]');if(!button||button.disabled)return;const a=button.dataset.action;
  if(a==='sound'){if(!audioSettings.enabled)applyAudioSettings({enabled:true});wakeAudio();audioDialog();return;}
  if(a==='audio-toggle'){applyAudioSettings({enabled:!audioSettings.enabled});if(audioSettings.enabled)wakeAudio();return;}
  if(a==='audio-retry'){if(!audioSettings.enabled)applyAudioSettings({enabled:true});wakeAudio();return;}
  if(a==='audio-preview'){if(!['complete','purchase'].includes(button.dataset.effect))return;if(!audioSettings.enabled)applyAudioSettings({enabled:true});playSound(button.dataset.effect);return;}
  // Submission records time before any audio initialization or Promise work.
  if(a!=='answer')wakeAudio();
  if(a==='reminder-open'){reminderDialog();return;}
  if(a==='reminder-new'){reminderDialog(true);return;}
  if(a==='reminder-instructions'){reminderSteps();return;}
  if(a==='reminder-later'){reminder={...reminder,dismissedOn:today};saveReminder();render();toast('내 정보에서 언제든 알림을 설정할 수 있어요.');return;}
  if(a==='reminder-time'){const input=document.querySelector('#reminder-time');if(input&&validReminderTime(button.dataset.time))input.value=button.dataset.time;return;}
  if(a==='reminder-file'||a==='reminder-manual'){prepareReminder(a==='reminder-file'?'file':'manual');return;}
  if(a==='reminder-copy'){copyReminderDetails();return;}
  if(a==='reminder-confirm'){if(!['prepared','confirmed'].includes(reminder.status))return;reminder={...reminder,status:'confirmed',confirmedAt:new Date().toISOString()};const saved=saveReminder();modal.close();render();toast(saved?'캘린더 등록 확인을 저장했어요. 내일도 만나요!':'캘린더 일정은 유지돼요. 이 브라우저에는 확인 표시를 저장하지 못했어요.');return;}
  if(a==='reminder-removed'){reminder={...freshReminder(),time:reminder.time,dismissedOn:today};const saved=saveReminder();modal.close();render();toast(saved?'이 브라우저의 알림 등록 표시를 초기화했어요.':'브라우저에 표시 변경을 저장하지 못했어요. 캘린더의 삭제 상태에는 영향을 주지 않아요.');return;}
  if(a==='character'){try{const item=CATALOG.find(i=>i.id===button.dataset.id&&i.slot==='character');if(!item)return;if(!state.owned.includes(item.id)){characterDialog(item);return;}state=equipItem(state,item.id);save();render();playSound('equip');toast(`${item.name}, 이제 함께 도전해요. 옷과 소품도 그대로 입었어요.`);}catch(error){toast(error.message);}return;}
  if(a==='buy-character'){try{const item=CATALOG.find(i=>i.id===button.dataset.id&&i.slot==='character');if(!item)return;const alreadyOwned=state.owned.includes(item.id);state=purchaseItem(state,item.id);save();modal.close();render();playSound(alreadyOwned?'equip':'purchase');toast(alreadyOwned?`${item.name}와 다시 함께해요.`:`${item.name}가 새 친구가 되었어요!`);}catch(error){toast(error.message);}return;}
  if(a==='preview-test'){startPreview();return;}
  if(a==='nav'){go(button.dataset.view);playSound('tap');return;}
  if(a==='daily'){startDaily();return;}
  if(a==='select'){ui.selected=Number(button.dataset.option);document.querySelectorAll('.option').forEach(el=>{const selected=Number(el.dataset.option)===ui.selected;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));});const next=document.querySelector('[data-action="answer"]');if(next)next.disabled=false;playSound('tap');return;}
  if(a==='answer'){answer();return;}
  if(a==='memory-start'){if(!state.active||!checkDate())return;const q=currentSet()[state.active.index];if(q?.visual?.type==='memory'&&!state.active.memory[state.active.index]){state.active.memory[state.active.index]={until:Date.now()+q.visual.seconds*1000};save();render();playSound('tap');}return;}
  if(a==='practice'){practiceOffer();return;}
  if(a==='ad-preview-complete'){startPractice('ad');return;}
  if(a==='resume-active'){if(checkDate())showAttempt();return;}
  if(a==='close-modal'){modal.close();return;}
  if(a==='modal-shop'){modal.close();go('shop');return;}
  if(a==='greet'){clearTimeout(celebrationTimer);ui.avatarHappy=true;const canvas=button.querySelector('canvas');if(canvas)drawAvatar(canvas,{...state.equipped,background:'garden',pose:'happy',scale:2});toast('반가워요! 오늘도 함께 다섯 문제.');playSound('greet');celebrationTimer=setTimeout(()=>{ui.avatarHappy=false;if(ui.view==='home')render();},1500);return;}
  if(a==='review'){ui.review=true;render();requestAnimationFrame(()=>document.querySelector('#answer-review')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}));return;}
  if(a==='stat-field'){ui.field=button.dataset.field;render();return;}
  if(a==='field-about'){const field=FIELDS.find(f=>f.id===button.dataset.field);if(field)showModal(escape(field.label)+' 분야',escape(field.description),`<button class="btn secondary full" data-action="close-modal">확인했어요</button>`);return;}
  if(a==='teaser'){const item=CATALOG.find(i=>i.id===button.dataset.id&&i.slot!=='character');if(!item)return;ui.shopItem=item.id;ui.shopTab='shop';ui.filter=item.slot;ui.premiumPreview=false;go('shop');return;}
  if(a==='shop-select'){ui.shopItem=button.dataset.id;ui.premiumPreview=false;render();if(window.innerWidth<620)document.querySelector('.fitting-room')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});return;}
  if(a==='shop-tab'){ui.shopTab=button.dataset.tab;ui.premiumPreview=false;if(ui.shopTab!=='collection'){const items=CATALOG.filter(i=>i.slot!=='character'&&(ui.filter==='all'||i.slot===ui.filter)&&(ui.shopTab==='closet'?state.owned.includes(i.id):i.value!=='none'));if(!items.some(i=>i.id===ui.shopItem))ui.shopItem=items[0]?.id||'outfit-mint';}render();return;}
  if(a==='filter'){ui.filter=button.dataset.filter;ui.premiumPreview=false;const items=CATALOG.filter(i=>i.slot!=='character'&&(ui.filter==='all'||i.slot===ui.filter)&&(ui.shopTab==='closet'?state.owned.includes(i.id):i.value!=='none'));if(!items.some(i=>i.id===ui.shopItem)&&items.length)ui.shopItem=items[0].id;render();return;}
  if(a==='buy'||a==='equip'){try{const wasOwned=state.owned.includes(button.dataset.id);state=a==='buy'?purchaseItem(state,button.dataset.id):equipItem(state,button.dataset.id);ui.shopItem=button.dataset.id;const item=CATALOG.find(i=>i.id===ui.shopItem);if(item?.value==='none'){ui.shopTab='closet';ui.filter=item.slot;}ui.premiumPreview=false;save();render();playSound(a==='buy'&&!wasOwned?'purchase':'equip');toast(a==='buy'?'새 아이템을 옷장에 담고 입었어요.':'이 모습으로 갈아입었어요.');}catch(error){toast(error.message);}return;}
  if(a==='try-premium'){ui.premiumPreview=true;render();document.querySelector('.fitting-room')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});return;}
  if(a==='end-premium'){ui.premiumPreview=false;render();return;}
  if(a==='wallet'){showModal('도전으로 모으는 꾸미기 코인',`지금 ${fmt(state.coins)} 코인을 가지고 있어요.`, `<button class="btn full" data-action="modal-shop">꾸미기 상점으로</button>`,`<div class="modal-note">첫 체험 코인 180개로 시작해요.<br>오늘의 공식 5문제를 완료하면 +${DAILY_COMPLETION_COINS} 코인.<br>주간 정산에서는 등급에 따른 코인을 더 받아요.<br>연습이나 광고 체험으로 랭킹 점수·코인이 추가되지 않아요.</div>`);return;}
  if(a==='settlement-preview'){settlementPreview();return;}
  if(a==='rules'){rulesDialog();return;}
  if(a==='about'){aboutDialog();return;}
  if(a==='rename'){renameDialog();return;}
  if(a==='save-name'){const input=document.querySelector('#nickname');const name=input?.value.trim().replace(/\s+/g,' ')||'';if(!/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]{2,12}$/.test(name)){document.querySelector('#name-error').textContent='한글·영문·숫자와 공백으로 2~12글자를 입력해 주세요.';return;}state.name=name;save();modal.close();render();toast('새 이름을 저장했어요.');return;}
  if(a==='reset-ask'){showModal('테스트 기록을 초기화할까요?','이 브라우저의 도전 기록, 코인, 옷장과 닉네임을 처음 상태로 되돌려요. 초기화한 기록은 되돌릴 수 없어요.',`<button class="btn ghost" data-action="close-modal">유지할게요</button><button class="btn" data-action="reset-confirm">초기화하기</button>`);return;}
  if(a==='reset-confirm'){state=freshState();today=dateKey();save();ui.result=null;ui.selected=null;ui.sampleStats=false;ui.premiumPreview=false;modal.close();go('home');toast('처음 상태로 돌아왔어요.');}
}
app.addEventListener('click',handleAction);modal.addEventListener('click',handleAction);
modal.addEventListener('input',event=>{const kind=event.target.dataset?.audioVolume;if(!['musicVolume','effectsVolume'].includes(kind))return;const percent=Number(event.target.value);if(!Number.isFinite(percent))return;applyAudioSettings({[kind]:Math.max(0,Math.min(100,percent))/100});if(audioSettings.enabled)wakeAudio();});
app.addEventListener('change',event=>{if(event.target.id==='sample-stats'){ui.sampleStats=event.target.checked;render();}});
modal.addEventListener('click',event=>{if(event.target===modal){const rect=modal.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)modal.close();}});
window.addEventListener('hashchange',()=>{const view=location.hash.slice(1);if(VALID_VIEWS.includes(view))go(view);});
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY){
  const previousPlayerId=state.playerId;
  state=readState();checkDate(false);state=settleWeeks(state,today);
  if(state.active?.date!==today)state.active=null;
  if(state.playerId!==previousPlayerId){ui.result=null;ui.review=false;modal.close();refreshGameModal=null;}
  else if(ui.result?.mode==='daily')ui.result=state.results.find(result=>result.mode==='daily'&&result.date===ui.result.date)||null;
  else if(ui.result?.mode==='practice'&&ui.result.practiceKind!=='preview')ui.result=state.practiceHistory.find(result=>result.date===ui.result.date&&result.seed===ui.result.seed)||null;
  ui.selected=null;render();history.replaceState(null,'','#'+ui.view);
  if(modal.open&&refreshGameModal)refreshGameModal();
  toast('다른 창에서 변경한 기록을 반영했어요.');
}});
window.addEventListener('storage',event=>{if(event.key===REMINDER_STORAGE_KEY){reminder=readReminder();render();}});
document.addEventListener('visibilitychange',()=>{sound.setHidden(document.hidden);if(!document.hidden){if(checkDate()&&ui.view==='challenge')render();}});
window.addEventListener('pagehide',()=>sound.setHidden(true));
window.addEventListener('pageshow',()=>{sound.setHidden(document.hidden);if(checkDate()&&ui.view==='challenge')render();});
window.addEventListener('storage',event=>{if(event.key===AUDIO_STORAGE_KEY){audioSettings=readAudioSettings();sound.setSettings(audioSettings);refreshAudioUI(sound.getStatus());}});
if(ui.view==='challenge'&&!state.active)ui.view=dailyResult()?'result':'home';
render();
