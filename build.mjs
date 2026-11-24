import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';

await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});
const files = [['/','index.html','text/html'],['/styles.css','styles.css','text/css'],['/app.mjs','app.mjs','text/javascript'],['/core.mjs','core.mjs','text/javascript'],['/market-api.mjs','market-api.mjs','text/javascript']];
const assets = Object.fromEntries(await Promise.all(files.map(async ([path,file,type])=>[path,{type:`${type}; charset=utf-8`,body:await readFile(`public/${file}`,'utf8')}])));
for (const [path,file,fallback] of [
  ['/vitrine.json','data/vitrine.json',null],
  ['/ofertas-myp.json','data/ofertas-myp.json',JSON.stringify({seller:'',products:{},storeRows:[]})]
]) {
  const body=await readFile(file,'utf8').catch(error=>{
    if (error.code!=='ENOENT') throw error;
    return fallback;
  });
  if (body!==null) assets[path]={type:'application/json; charset=utf-8',body};
}
const sources = await Promise.all(['public/core.mjs','worker/myp.mjs','worker/index.mjs'].map(path=>readFile(path,'utf8')));
// The Worker deployment has one entry point. Browser modules remain separate assets.
const modules = sources.map(source=>source.replace(/^import .*;\n/gm,'').replace(/^export (?=(?:async )?function |const )/gm,''));
const collector = await readFile('scripts/coletar-ofertas-myp.mjs','utf8');
assets['/coletar-ofertas-myp.mjs'] = {type:'text/javascript; charset=utf-8',body:[modules[0],modules[1].split('const reply =')[0],collector].join('\n')};
const browserCollector = (await readFile('scripts/collect-browser-myp.mjs','utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
assets['/coleta-navegador.js.txt'] = {type:'text/plain; charset=utf-8',body:[modules[0],modules[1].split('const reply =')[0],browserCollector].join('\n')};
await writeFile('dist/server/index.js',`const assets = ${JSON.stringify(assets)};\n${modules.join('\n')}`);
