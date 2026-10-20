import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Local-file export only. This makes no network requests and does not deploy.
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(project,'legacy','v040');
const output=process.argv[2]||path.join(project,'haru-five-playtest.html');
const names=['question-variants','game-core','avatar','state','reminders','attempt-timer','audio','app'];
const modules=[];
for(const name of names){
  let source=fs.readFileSync(path.join(dist,name+'.js'),'utf8');
  const exports=[...source.matchAll(/^export\s+(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(match=>match[1]);
  source=source.replace(/^import\s+\{([^}]+)\}\s+from\s+(['"])([^'"]+)\2;\s*$/gm,(_,bindings,quote,module)=>`const {${bindings}} = modules[${JSON.stringify(path.basename(module,'.js'))}];`);
  source=source.replace(/^export\s+/gm,'');
  if(/^import\s|^export\s/m.test(source))throw new Error('Unexpected module syntax in '+name);
  modules.push(`modules[${JSON.stringify(name)}] = (() => {\n${source}\nreturn {${exports.join(',')}};\n})();`);
}
const favicon='data:image/svg+xml;base64,'+fs.readFileSync(path.join(dist,'favicon.svg')).toString('base64');
const script=('(()=>{\nconst modules=Object.create(null);\n'+modules.join('\n')+'\n})();').replaceAll('./favicon.svg',favicon).replace(/<\/script/gi,'<\\/script');
let html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="./styles.css">','<style>\n'+fs.readFileSync(path.join(dist,'styles.css'),'utf8')+'\n</style>');
html=html.replace('./favicon.svg',favicon);
html=html.replace('<script type="module" src="./app.js"></script>','<script>\n'+script+'\n</script>');
fs.writeFileSync(output,html);
console.log(JSON.stringify({standalone:output,bytes:Buffer.byteLength(html)}));
