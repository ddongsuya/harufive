// A deliberately limited source-markup audit for our fully closed templates.
// It preserves malformed source nesting rather than silently repairing it as a
// browser HTML parser would. It is not a DOM, accessibility or layout engine.
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const LABELABLE = new Set(['button','input','meter','output','progress','select','textarea']);
const interactive = node=>['button','input','select','textarea'].includes(node.tag)||(node.tag==='a'&&'href' in node.attrs);
export const hasClass = (node,name)=>(node.attrs.class||'').split(/\s+/).includes(name);
export function isWithin(node,ancestor,nodes) {
  for(let index=node.parent;index!==null;index=nodes[index].parent) if(nodes[index]===ancestor)return true;
  return false;
}
export function auditMarkup(source) {
  const nodes=[],stack=[],issues=[];let position=0;
  const addText=text=>{for(const index of stack)nodes[index].text+=text;};
  while(position<source.length) {
    const start=source.indexOf('<',position);
    if(start<0){addText(source.slice(position));break;}
    addText(source.slice(position,start));
    if(source.startsWith('<!--',start)) {
      const end=source.indexOf('-->',start+4);
      if(end<0){issues.push('Unclosed comment');break;}
      position=end+3;continue;
    }
    let end=start+1,quote=null;
    for(;end<source.length;end++) {
      const char=source[end];
      if(quote){if(char===quote)quote=null;}
      else if(char==='"'||char==="'")quote=char;
      else if(char==='>')break;
    }
    if(end===source.length){issues.push('Unclosed tag or attribute quote');break;}
    const token=source.slice(start+1,end);position=end+1;
    if(token.startsWith('!'))continue;
    const match=token.match(/^(\/?)\s*([a-z][\w:-]*)([\s\S]*)$/i);
    if(!match){issues.push(`Unrecognized markup: <${token}>`);continue;}
    const [,closing,rawTag,rest]=match,tag=rawTag.toLowerCase();
    if(closing) {
      const last=stack.pop();
      if(last===undefined)issues.push(`Unexpected closing </${tag}>`);
      else if(nodes[last].tag!==tag)issues.push(`Closing </${tag}> mismatches <${nodes[last].tag}>`);
      continue;
    }
    const attrs={},selfClosing=/\/\s*$/.test(rest),attributeSource=selfClosing?rest.replace(/\/\s*$/,''):rest;
    const attributePattern=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for(const attribute of attributeSource.matchAll(attributePattern)) {
      const name=attribute[1].toLowerCase();
      if(name in attrs)issues.push(`Duplicate attribute ${name} on <${tag}>`);
      attrs[name]=attribute[2]??attribute[3]??attribute[4]??'';
    }
    const node={tag,attrs,text:'',parent:stack.at(-1)??null};
    const ancestors=stack.map(index=>nodes[index]);
    if(interactive(node)&&ancestors.some(item=>item.tag==='button'||(item.tag==='a'&&'href' in item.attrs)))issues.push(`Interactive <${tag}> is nested inside a button or link`);
    if(/^h[1-6]$/.test(tag)&&ancestors.some(item=>/^h[1-6]$/.test(item.tag)))issues.push(`Heading <${tag}> is nested inside another heading`);
    nodes.push(node);
    if(!VOID.has(tag)&&!selfClosing)stack.push(nodes.length-1);
  }
  for(const index of stack)issues.push(`Unclosed <${nodes[index].tag}>`);
  const ids=new Map();
  for(const node of nodes)if(node.attrs.id){
    if(ids.has(node.attrs.id))issues.push(`Duplicate id: ${node.attrs.id}`);
    else ids.set(node.attrs.id,node);
  }
  for(const node of nodes) {
    for(const attribute of ['aria-labelledby','aria-describedby','aria-controls','aria-owns']) {
      for(const id of (node.attrs[attribute]||'').split(/\s+/).filter(Boolean))if(!ids.has(id))issues.push(`${attribute} references missing #${id}`);
    }
    if(node.tag==='label'&&node.attrs.for) {
      const target=ids.get(node.attrs.for);
      if(!target)issues.push(`Label references missing #${node.attrs.for}`);
      else if(!LABELABLE.has(target.tag)||target.attrs.type==='hidden')issues.push(`Label target #${node.attrs.for} cannot be labeled`);
    }
    if(['input','select','textarea'].includes(node.tag)&&node.attrs.type!=='hidden') {
      const explicit=node.attrs.id&&nodes.some(label=>label.tag==='label'&&label.attrs.for===node.attrs.id);
      const implicit=nodes.some(label=>label.tag==='label'&&isWithin(node,label,nodes));
      if(!explicit&&!implicit&&!node.attrs['aria-label']&&!node.attrs['aria-labelledby'])issues.push(`Unlabeled control: ${node.attrs.id||node.tag}`);
    }
    if(node.tag==='button'&&!node.text.trim()&&!node.attrs['aria-label']&&!node.attrs['aria-labelledby'])issues.push(`Button has no text or accessible name: ${node.attrs['data-action']||''}`);
  }
  return {nodes,issues,ids};
}
