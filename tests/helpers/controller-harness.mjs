import {STORAGE_KEY} from '../../legacy/v040/state.js';

// Only controller inputs and template-output sinks are modeled. There is no
// DOM tree construction, canvas rendering, CSS layout, focus or hit testing.
let instance = 0;
export async function controllerHarness({initialState, now:initialNow='2026-10-19T01:00:00Z'}={}) {
  const RealDate = globalThis.Date;
  let now = RealDate.parse(initialNow), timerId = 0;
  class ClockDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const globals = ['document','window','location','history','localStorage','Date','setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','matchMedia'];
  const original = new Map(globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const storage = new Map(), events = new Map(), intervals = new Map(), fields = new Map();
  if(initialState) storage.set(STORAGE_KEY,JSON.stringify(initialState));
  function listen(target,name,fn) { const before=target['on'+name]; target['on'+name]=event=>{before?.(event);fn(event);}; }
  function surface() {
    return {innerHTML:'',textContent:'',dataset:{},style:{},open:false,
      classList:{add(){},remove(){},toggle(){}},
      addEventListener(name,fn){listen(this,name,fn);},querySelectorAll(){return [];},querySelector(){return null;},
      contains(){return false;},setAttribute(){},focus(){},select(){},scrollIntoView(){},
      showModal(){this.open=true;},close(){this.open=false;}};
  }
  const app=surface(),modal=surface(),toast=surface(),main=surface();
  const doc={hidden:false,activeElement:null,title:'',body:{appendChild(){}},
    querySelector(selector){return ({'#app':app,'#modal':modal,'#toast':toast,'#main':main})[selector]||fields.get(selector)||null;},
    querySelectorAll(){return [];},getElementById(){return null;},
    createElement(){return {click(){},remove(){}};},
    addEventListener(name,fn){events.set(name,fn);}};
  const win={innerWidth:1000,scrollTo(){},addEventListener(name,fn){const before=events.get(name);events.set(name,event=>{before?.(event);fn(event);});}};
  const assign=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  assign('Date',ClockDate);assign('document',doc);assign('window',win);assign('location',{hash:''});
  assign('history',{replaceState(a,b,hash){globalThis.location.hash=hash;}});
  assign('localStorage',{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)});
  assign('setTimeout',()=>++timerId);assign('clearTimeout',()=>{});
  assign('setInterval',fn=>{const id=++timerId;intervals.set(id,fn);return id;});assign('clearInterval',id=>intervals.delete(id));
  assign('requestAnimationFrame',fn=>fn());assign('matchMedia',()=>({matches:true}));
  const restore=()=>{for(const [name,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}};
  try { await import(`../../legacy/v040/app.js?screen-structure=${++instance}`); }
  catch(error) { restore();throw error; }
  return {
    app,modal,toast,document:doc,storage,
    readState:()=>JSON.parse(storage.get(STORAGE_KEY)),
    replaceState(value){storage.set(STORAGE_KEY,JSON.stringify(value));events.get('storage')?.({key:STORAGE_KEY});},
    field(selector,value){const field={...surface(),value};fields.set(selector,field);return field;},
    click(action,data={},inModal=false){
      const button={dataset:{action,...data},disabled:false,querySelector(){return null;}};
      (inModal?modal:app).onclick({target:{closest(){return button;}}});
    },
    changeSample(checked){app.onchange({target:{id:'sample-stats',checked}});},
    advance(ms){now+=ms;for(const callback of [...intervals.values()])callback();},
    markup(){return `<div id="app">${app.innerHTML}</div>${modal.innerHTML?`<dialog id="modal" aria-labelledby="modal-title" ${modal.open?'open':''}>${modal.innerHTML}</dialog>`:''}`;},
    restore
  };
}
