import {auditMarkup} from './markup-source.mjs';

// Run the shipped controller against an in-memory DOM surface and real fetch
// response objects. This exercises controller wiring, not browser layout/canvas.
let instance=0;
const decode=text=>String(text).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
export async function releaseHarness({handler,authHandler=null,privacyHandler=null,legacy=null,hash='',search='',now=Date.parse('2026-10-20T00:00:00Z')}={}) {
  const keys=['document','window','location','history','localStorage','fetch','performance','setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','matchMedia'];
  const originals=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let timerId=0,elapsed=0;
  const intervals=new Map(),calls=[],writes=[],navigations=[],downloads=[],storage=new Map(legacy?[['haru-five-playtest-v1',legacy]]:[]);
  const eventful=target=>Object.assign(target,{events:new Map(),addEventListener(name,fn){const list=this.events.get(name)||[];list.push(fn);this.events.set(name,list);},removeEventListener(name,fn){this.events.set(name,(this.events.get(name)||[]).filter(x=>x!==fn));},async fire(name,event={}){for(const fn of this.events.get(name)||[])await fn(event);}});
  class Element {
    constructor(tag='div',attrs={}){
      eventful(this);this.tagName=tag.toUpperCase();this.attrs=attrs;this.nodes=[];this.dataset={};this.style={};this.open=false;this.disabled='disabled' in attrs;this.value=decode(attrs.value||'');this.id=attrs.id||'';this._text='';this._html='';
      for(const [key,value] of Object.entries(attrs))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=decode(value);
      this.classList={add:token=>this.changeClass(token,true),remove:token=>this.changeClass(token,false),toggle:(token,on)=>this.changeClass(token,on)};
    }
    changeClass(token,on){const list=new Set((this.attrs.class||'').split(/\s+/));if(on===undefined)on=!list.has(token);if(on)list.add(token);else list.delete(token);this.attrs.class=[...list].join(' ');}
    set innerHTML(source){this._html=source;const parsed=auditMarkup(source);this.nodes=parsed.nodes.map(node=>{const el=new Element(node.tag,{...node.attrs});el._text=decode(node.text);return el;});parsed.nodes.forEach((node,i)=>this.nodes[i].parentElement=node.parent===null?this:this.nodes[node.parent]);}
    get innerHTML(){return this._html;}
    set textContent(value){this._text=String(value);this.nodes=[];this._html=String(value);}
    get textContent(){return this._text;}
    matches(selector){
      const match=selector.match(/^(?<tag>[a-z][\w-]*)?(?:#(?<id>[\w-]+))?(?:\.(?<cls>[\w-]+))?(?:\[(?<attr>[\w-]+)(?:="(?<value>[^"]*)")?\])?$/i);
      if(!match)return false;const {tag,id,cls,attr,value}=match.groups;
      if(tag&&tag.toUpperCase()!==this.tagName)return false;if(id&&id!==this.id)return false;if(cls&&!(this.attrs.class||'').split(/\s+/).includes(cls))return false;
      if(attr){let actual=attr.startsWith('data-')?this.dataset[attr.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]:this.attrs[attr];if(actual===undefined)return false;if(value!==undefined&&decode(actual)!==value)return false;}
      return true;
    }
    contains(el){for(let item=el;item;item=item.parentElement)if(item===this)return true;return false;}
    descendants(){return this.nodes.flatMap(node=>[node,...node.nodes]);}
    querySelectorAll(selector){if(selector.startsWith('canvas'))return [];return this.descendants().filter(node=>node.matches(selector));}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
    setAttribute(name,value){this.attrs[name]=String(value);}
    focus(){doc.activeElement=this;}
    select(){} scrollIntoView(){} showModal(){this.open=true;} close(){this.open=false;}
    getBoundingClientRect(){return {left:0,right:500,top:0,bottom:500};}
    click(){if(this.tagName!=='A')return;const url=this.href||this.attrs.href;if(!url)return;if(this.download!==undefined||'download' in this.attrs)downloads.push({url:decode(url),filename:this.download??this.attrs.download});else navigations.push({url:decode(url),target:this.target||this.attrs.target});} remove(){} appendChild(){}
  }
  const app=new Element('div',{id:'app'}),modal=new Element('dialog',{id:'modal'}),toast=new Element('div',{id:'toast'});
  const doc=eventful({hidden:false,activeElement:null,title:'',body:new Element('body'),
    querySelector(selector){return [app,modal,toast].find(el=>el.matches(selector))||[app,modal,toast].flatMap(el=>el.querySelectorAll(selector))[0]||null;},
    querySelectorAll(selector){return [app,modal,toast].flatMap(el=>el.querySelectorAll(selector));},
    getElementById(id){return this.querySelector('#'+id);},createElement:tag=>new Element(tag)});
  const win=eventful({innerWidth:1000,scrollTo(){}});
  const assign=(key,value)=>Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const mockLocation=new URL('https://haru-five.limjm900202.chatgpt.site/'+search+hash);
  assign('document',doc);assign('window',win);assign('location',mockLocation);assign('history',{replaceState(a,b,url){mockLocation.href=new URL(url,mockLocation.href).href;}});
  assign('localStorage',{getItem:key=>storage.get(key)||null,setItem(key,value){writes.push({key,value});storage.set(key,value);}});
  assign('performance',new Proxy(globalThis.performance,{get(target,key){if(key==='now')return ()=>elapsed;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}));assign('setTimeout',()=>++timerId);assign('clearTimeout',()=>{});
  assign('setInterval',fn=>{const id=++timerId;intervals.set(id,fn);return id;});assign('clearInterval',id=>intervals.delete(id));
  assign('requestAnimationFrame',fn=>fn());assign('matchMedia',()=>({matches:true}));
  assign('fetch',async(url,options)=>{
    const call={url,options,body:options.body?JSON.parse(options.body):null};calls.push(call);
    if(url.startsWith('/api/auth/'))return authHandler?authHandler(call,{now:now+elapsed}):reply({authenticated:true,sites:{enabled:true},account:{provider:'chatgpt',linkedProviders:[]},providers:['kakao','google','naver'].map(id=>({id,enabled:false,reason:'not_configured'})),registration:{open:false}});
    if(privacyHandler&&(url.startsWith('/api/privacy/')||url.startsWith('/api/guardian/')))return privacyHandler(call,{now:now+elapsed});
    return handler(call,{now:now+elapsed});
  });
  let module;
  function restore(){module?.destroy();for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
  try{const imported=await import(`../../public/game/app.js?release-test=${++instance}`);module=imported.mountGame();await module.ready;}catch(error){restore();throw error;}
  return {app,modal,toast,document:doc,window:win,calls,writes,navigations,downloads,storage,
    query:selector=>doc.querySelector(selector),
    async click(action,data={},inModal=false){const root=inModal?modal:app;const button=root.querySelectorAll('[data-action]').find(el=>el.dataset.action===action&&Object.entries(data).every(([key,value])=>el.dataset[key]===String(value)));if(!button)throw new Error(`Missing button ${action} ${JSON.stringify(data)}`);if(button.disabled)return false;await root.fire('click',{target:button});return true;},
    async focus(){await win.fire('focus');for(let i=0;i<16;i++)await Promise.resolve();},
    async advance(ms){elapsed+=ms;for(const fn of [...intervals.values()])fn();for(let i=0;i<12;i++)await Promise.resolve();},
    markup(){return `<div id="app">${app.innerHTML}</div>${modal.open?`<dialog id="modal" aria-labelledby="modal-title">${modal.innerHTML}</dialog>`:''}`;},
    restore
  };
}
export function reply(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});}
