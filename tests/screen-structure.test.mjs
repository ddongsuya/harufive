import test from 'node:test';
import assert from 'node:assert/strict';
import {controllerHarness} from './helpers/controller-harness.mjs';
import {auditMarkup,hasClass,isWithin} from './helpers/markup-source.mjs';
import {CATALOG,freshState} from '../legacy/v040/state.js';
import {FIELDS,makeDailySet,addDays,weekKey} from '../legacy/v040/game-core.js';

test('source audit catches malformed nesting, duplicated IDs and missing labels',()=>{
  assert.deepEqual(auditMarkup('<label for="volume">음량</label><input id="volume"><button><svg><path d="M1 2"/></svg>소리</button>').issues,[]);
  for(const [source,expected] of [
    ['<div id="same"></div><span id="same"></span>',/Duplicate id/],
    ['<button>카드<a href="#details">자세히</a></button>',/nested inside/],
    ['<div><strong>제목</div>',/mismatches/],
    ['<label for="missing">이름</label>',/missing #missing/],
    ['<div aria-describedby="missing"></div>',/missing #missing/]
  ])assert.match(auditMarkup(source).issues.join('\n'),expected);
});

// Actual controller-generated HTML is audited at each state. These checks do
// not render fonts, compute geometry, detect text overlap or verify browsers.
test('screen templates remain well formed and selected menus match their content',async t=>{
  const initial=freshState();initial.playerId='structure-check-player';
  const day=Array.from({length:7},(_,index)=>addDays('2026-10-19',index)).find(key=>makeDailySet(key,initial.playerId).some(question=>question.visual?.type==='memory'));
  assert.ok(day,'a daily fixture includes a memory question');
  const h=await controllerHarness({initialState:initial,now:`${day}T01:00:00Z`});
  let checked=0;
  function screen(name,view) {
    const result=auditMarkup(h.markup());checked++;
    assert.deepEqual(result.issues,[],name);
    assert.equal(result.nodes.filter(node=>node.tag==='main').length,1,`${name}: one main region`);
    assert.equal(result.nodes.filter(node=>node.tag==='h1').length,1,`${name}: one page heading`);
    const current=result.nodes.filter(node=>node.attrs['aria-current']==='page');
    assert.equal(current.length,2,`${name}: desktop and mobile current page`);
    assert.ok(current.every(node=>node.attrs['data-view']===view),`${name}: current navigation matches displayed view`);
    if(h.modal.open)assert.ok(result.ids.get('modal-title')?.text.trim(),`${name}: dialog has a title`);
    return result;
  }
  function nav(view){h.click('nav',{view});return screen(view,view);}
  function modal(action,name,view,data={}){h.click(action,data);const result=screen(name,view);assert.equal(h.modal.open,true,name);h.click('close-modal',{},true);return result;}
  function verifyShop(tab,filter='all') {
    const result=screen(`shop ${tab}/${filter}`,'shop');
    const tabs=result.nodes.filter(node=>node.attrs['data-action']==='shop-tab'&&node.attrs['aria-pressed']==='true');
    assert.deepEqual(tabs.map(node=>node.attrs['data-tab']),[tab],'selected shop tab matches requested content');
    const collection=result.nodes.some(node=>hasClass(node,'collection-card'));
    assert.equal(collection,tab==='collection','collection panel matches selected menu');
    if(tab==='collection')return result;
    const filters=result.nodes.filter(node=>node.attrs['data-action']==='filter'&&node.attrs['aria-pressed']==='true');
    assert.deepEqual(filters.map(node=>node.attrs['data-filter']),[filter],'selected item category matches filter');
    const cards=result.nodes.filter(node=>node.attrs['data-action']==='shop-select');
    const state=h.readState();
    for(const card of cards){const item=CATALOG.find(entry=>entry.id===card.attrs['data-id']);assert.ok(item);assert.ok(filter==='all'||item.slot===filter,'listed item belongs to current filter');if(tab==='closet')assert.ok(state.owned.includes(item.id),'closet lists owned items only');}
    if(cards.length){
      const selected=cards.filter(node=>hasClass(node,'active'));
      assert.equal(selected.length,1,'one selected item belongs to the visible inventory');
      const item=CATALOG.find(entry=>entry.id===selected[0].attrs['data-id']);
      const fitting=result.nodes.find(node=>hasClass(node,'fitting-copy'));
      const title=result.nodes.find(node=>node.tag==='h3'&&isWithin(node,fitting,result.nodes));
      assert.equal(title?.text,item.name,'fitting room matches the selected visible item');
    }
    return result;
  }
  function finish(label,wrongFirst=false){
    while(h.readState().active){
      const active=h.readState().active,question=active.questions[active.index];
      screen(`${label} question ${active.index+1}`,'challenge');
      if(question.visual?.type==='memory'){
        assert.match(h.app.innerHTML,/data-action="memory-start"/);h.click('memory-start');
        const exposed=screen(`${label} memory exposed`,'challenge');
        assert.equal(exposed.nodes.filter(node=>node.attrs['data-action']==='select').length,0,'memory answers stay hidden during exposure');
        assert.ok(exposed.ids.has('memory-seconds'));
        h.advance((question.visual.seconds+1)*1000);
        const hidden=screen(`${label} memory hidden`,'challenge');
        assert.equal(hidden.nodes.filter(node=>node.attrs['data-action']==='select').length,question.options.length);
        assert.equal(hidden.nodes.some(node=>hasClass(node,'memory-grid')),false,'answer screen no longer contains the exposed array');
      }
      h.advance(12000);h.click('select',{option:String(wrongFirst&&active.index===0?(question.answer+1)%question.options.length:question.answer)});h.click('answer');
    }
    return screen(`${label} result`,'home');
  }
  try {
    screen('home before playing','home');
    for(const action of ['wallet','about','sound'])modal(action,`${action} dialog`,'home');
    for(const field of FIELDS)modal('field-about',`${field.id} explanation dialog`,'home',{field:field.id});
    nav('ranking');modal('rules','ranking rules','ranking');modal('settlement-preview','settlement preview','ranking');
    nav('profile');modal('rename','nickname form','profile');
    h.changeSample(true);screen('profile sample records','profile');
    for(const field of FIELDS){h.click('stat-field',{field:field.id});const result=screen(`profile field ${field.id}`,'profile');const selected=result.nodes.filter(node=>node.attrs['data-action']==='stat-field'&&node.attrs['aria-pressed']==='true');assert.deepEqual(selected.map(node=>node.attrs['data-field']),[field.id]);assert.match(result.nodes.find(node=>hasClass(node,'radar-detail')).text,new RegExp(field.label));}
    h.changeSample(false);
    h.click('reminder-open');screen('reminder new form','profile');h.field('#reminder-time','20:00');h.click('reminder-manual',{},true);screen('reminder manual steps','profile');h.click('reminder-confirm',{},true);screen('reminder confirmed profile','profile');modal('reminder-open','reminder management','profile');
    nav('shop');verifyShop('shop');
    const unaffordable=CATALOG.find(item=>item.slot!=='character'&&item.cost>h.readState().coins);
    assert.ok(unaffordable,'cosmetic fixture exceeds the starter wallet');
    h.click('filter',{filter:unaffordable.slot});h.click('shop-select',{id:unaffordable.id});
    const budgetScreen=verifyShop('shop',unaffordable.slot);
    const buyButton=budgetScreen.nodes.find(node=>node.attrs['data-action']==='buy'&&node.attrs['data-id']===unaffordable.id);
    assert.ok(buyButton&&'disabled' in buyButton.attrs,'unaffordable cosmetic is disabled before purchase');
    for(const filter of ['outfit','hat','accessory','background','all']){h.click('filter',{filter});verifyShop('shop',filter);}
    h.click('shop-tab',{tab:'closet'});verifyShop('closet');
    for(const filter of ['outfit','hat','accessory','background','all']){h.click('filter',{filter});verifyShop('closet',filter);}
    // Basic hat-none belongs to the closet but is absent from the coin shop.
    h.click('filter',{filter:'hat'});verifyShop('closet','hat');
    h.click('shop-tab',{tab:'shop'});verifyShop('shop','hat');
    nav('home');h.click('teaser',{id:'outfit-raincoat'});
    const teaserFilter=auditMarkup(h.markup()).nodes.find(node=>node.attrs['data-action']==='filter'&&node.attrs['aria-pressed']==='true');
    const teaser=verifyShop('shop',teaserFilter.attrs['data-filter']);
    assert.equal(teaser.nodes.find(node=>node.attrs['data-action']==='shop-select'&&hasClass(node,'active')).attrs['data-id'],'outfit-raincoat','home teaser selects its item in the visible inventory');
    modal('character','unaffordable character purchase dialog','shop',{id:'character-cat'});
    h.replaceState({...h.readState(),coins:10000});
    for(const [slot,id] of [['hat','hat-beret'],['accessory','accessory-camera']]){
      h.click('shop-tab',{tab:'shop'});h.click('filter',{filter:slot});h.click('shop-select',{id});h.click('buy',{id});verifyShop('shop',slot);
      h.click('filter',{filter:'outfit'});h.click('equip',{id:`${slot}-none`});
      const released=verifyShop('closet',slot);
      assert.equal(h.readState().equipped[slot],'none','quick removal updates equipped appearance');
      assert.equal(released.nodes.find(node=>node.attrs['data-action']==='shop-select'&&hasClass(node,'active')).attrs['data-id'],`${slot}-none`,'released item is visible and selected in the closet');
    }
    h.click('shop-tab',{tab:'collection'});verifyShop('collection');
    h.click('try-premium');screen('collection fitting preview','shop');h.click('end-premium');
    modal('character','unowned character purchase dialog','shop',{id:'character-cat'});
    nav('home');h.click('daily');screen('daily first question','challenge');
    modal('preview-test','active attempt warning','challenge');finish('official',true);
    h.click('review');let reviewed=screen('official answer review','home');assert.equal(reviewed.nodes.filter(node=>node.tag==='details').length,5);assert.ok(reviewed.nodes.some(node=>hasClass(node,'review-yours')),'wrong answer explanation is present');
    nav('home');assert.match(h.app.innerHTML,/오늘의 결과 보기/);nav('ranking');nav('profile');
    h.click('daily');h.click('practice');finish('free practice');h.click('review');screen('practice answer review','home');
    h.click('practice');screen('rewarded practice offer','home');assert.equal(h.modal.open,true);h.click('ad-preview-complete',{},true);finish('rewarded practice');
    modal('practice','practice exhausted dialog','home');
    h.click('preview-test');finish('new question test');h.click('review');screen('test answer review','home');
    // Existing records with long names, large wallets and a previous-week badge.
    const enriched=h.readState(),priorWeek=addDays(weekKey(day),-7);
    enriched.name='차곡차곡쌓아가는구름토끼';enriched.coins=123456789;
    enriched.awards[priorWeek]={week:priorWeek,tierId:'ruby',tierName:'루비',rank:80,score:35000};
    h.replaceState(enriched);nav('home');nav('ranking');nav('profile');nav('shop');
    // Another tab can reset ownership while the closet keeps a purchased item selected.
    h.replaceState({...freshState(),coins:1000});h.click('shop-tab',{tab:'shop'});h.click('filter',{filter:'hat'});h.click('shop-select',{id:'hat-beret'});h.click('buy',{id:'hat-beret'});h.click('shop-tab',{tab:'closet'});
    const beforeReset=verifyShop('closet','hat');assert.equal(beforeReset.nodes.find(node=>node.attrs['data-action']==='shop-select'&&hasClass(node,'active')).attrs['data-id'],'hat-beret');
    h.replaceState(freshState());const resetCloset=verifyShop('closet','hat');
    assert.deepEqual(resetCloset.nodes.filter(node=>node.attrs['data-action']==='shop-select').map(node=>node.attrs['data-id']),['hat-none']);assert.equal(resetCloset.nodes.find(node=>node.attrs['data-action']==='shop-select'&&hasClass(node,'active')).attrs['data-id'],'hat-none');assert.equal(h.readState().equipped.hat,'none');assert.equal(h.readState().coins,180);
    t.diagnostic(`Audited ${checked} actual controller template states; no browser rendering or overlap measurement.`);
  } finally {h.restore();}
});
