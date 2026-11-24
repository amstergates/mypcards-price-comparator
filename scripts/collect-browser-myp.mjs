import {isCompleteOfferCollection, mypProductUrl, storefrontSeller} from '../public/core.mjs';
import {parseOffers, parseStorefront} from '../worker/myp.mjs';

const recentOfferWindow=120000;

export async function collectBrowserMyp({seller,scope,links=[],quick=false}, readPage, progress, signal, checkpoint={}, recentProducts=new Map(), updates={}) {
  const saved=checkpoint.data || {};
  const rows = new Map((saved.store?.rows || []).map(row=>[row.stockId,row]));
  const products = {...saved.products};
  let completeStore = Boolean(saved.store?.complete), interrupted = '', plannedProducts=0,cachedProducts=0,retryAt=0;
  const storeUrl = new URL(`https://mypcards.com/${encodeURIComponent(seller)}/yugioh`);
  const issue = error => signal.aborted ? 'Coleta interrompida.' : error.message || 'Falha na consulta.';
  if (scope !== 'refs' && !completeStore) {
    try {
      let pages=saved.store?.pages || 1, expected=saved.store?.expected;
      for (let page=saved.store?.nextPage || 1;page<=pages;page++) {
        const url=new URL(storeUrl);
        if (page>1) url.searchParams.set('page',page);
        const result=parseStorefront(await readPage(url),page);
        if (expected!==undefined && expected!==result.total) {
          await checkpoint.write?.('store',null);
          throw new Error('A quantidade da vitrine mudou durante a coleta. Reabra a coleta para atualizar a lista de anúncios.');
        }
        pages=result.pages;
        expected=result.total;
        for (const row of result.rows) rows.set(row.stockId,row);
        if (page<pages) await checkpoint.write?.('store',{rows:[...rows.values()],pages,expected,nextPage:page+1});
        progress(`Vitrine · página ${page} de ${Math.max(1,pages)} · ${rows.size} anúncios lidos`);
      }
      completeStore=rows.size===expected;
      if (!completeStore) {
        await checkpoint.write?.('store',null);
        throw new Error('A contagem da vitrine mudou ou houve páginas repetidas.');
      }
      await checkpoint.write?.('store',{rows:[...rows.values()],pages,expected,complete:true});
    } catch (error) { interrupted=issue(error); }
  }
  if (completeStore) updates.inventory?.([...rows.values()]);
  if (scope!=='store' && !interrupted) {
    const targets=new Map([...rows.values()].filter(row=>row.url).map(row=>[row.productId,row]));
    for (const value of links) {
      const link=mypProductUrl(value?.url || value);
      if (link && !targets.has(link.productId)) targets.set(link.productId,typeof value==='object'?{...value,...link}:link);
    }
    plannedProducts=targets.size;
    for (const id of Object.keys(products)) if (!targets.has(id) || !isCompleteOfferCollection(products[id])) delete products[id];
    for (const product of Object.values(products)) updates.product?.(product,true,plannedProducts);
    let attempted=0;
    for (const {productId,name,altName,edition,code,url} of targets.values()) {
      if (Object.hasOwn(products,productId)) {attempted++;continue;}
      const pending=saved.pending?.productId===productId ? saved.pending : null;
      let checkedAt = pending?.checkedAt || new Date().toISOString();
      const identity = {productId,name,altName,edition,code,url};
      progress(`Referências · ${attempted+1} de ${targets.size} · ${name || productId}`);
      try {
        signal.throwIfAborted();
        const cached=recentProducts.get(productId);
        if (cached && (quick || isCompleteOfferCollection(cached)) && Date.now()-Date.parse(cached.checkedAt)<recentOfferWindow) {
          products[productId]={...cached,...identity};
          cachedProducts++;attempted++;
          await checkpoint.write?.(`product:${productId}`,products[productId]);
          updates.product?.(products[productId],true,plannedProducts);
          continue;
        }
        const first=pending?.first || parseOffers(await readPage(new URL(url)));
        if (!pending) checkedAt=new Date().toISOString();
        const offers=new Map((pending?.offers || first.rows).map(row=>[row.stockId,row]));
        let warning=quick && offers.size<first.count?'Consulta individual. Apenas a primeira página foi lida.':'';
        let certPages=pending?.certPages || first.certPages, otherPages=pending?.otherPages || first.otherPages;
        for (let page=pending?.nextPage || 2;!quick && page<=Math.max(certPages,otherPages);page++) {
          await checkpoint.write?.('pending',{productId,first,offers:[...offers.values()],nextPage:page,checkedAt,certPages,otherPages});
          updates.product?.({...identity,checkedAt,expected:first.count,offers:[...offers.values()],warning:'Coleta em andamento.'},false,plannedProducts);
          progress(`Referências · ${attempted+1} de ${plannedProducts} · ${name || productId} · página ${page}`);
          const query=new URL(url);
          for (const [key,max,sizeKey,size] of [['cert',certPages,first.certSizeKey,first.certSize],['outros',otherPages,first.otherSizeKey,first.otherSize]]) {
            if (max>1) query.searchParams.set(`estoque-${key}-page`,Math.min(page,max));
            if (max>1 && sizeKey && size) query.searchParams.set(sizeKey,size);
          }
          try {
            const batch=parseOffers(await readPage(query));
            if (batch.count!==first.count) {warning='A quantidade de ofertas mudou durante a coleta.'; break;}
            certPages=Math.max(certPages,batch.certPages);
            otherPages=Math.max(otherPages,batch.otherPages);
            for (const row of batch.rows) offers.set(row.stockId,row);
          } catch (error) {
            warning=issue(error);
            if (error.stop || signal.aborted) interrupted=warning;
            break;
          }
        }
        if (!warning && offers.size!==first.count) warning='A contagem das ofertas lidas não bate com a do MYP Cards.';
        products[productId]={...identity,checkedAt,expected:first.count,offers:[...offers.values()],warning};
        if (quick || isCompleteOfferCollection(products[productId])) recentProducts.set(productId,products[productId]);
      } catch (error) {
        if (error.retryAt) {retryAt=error.retryAt;interrupted=issue(error);break;}
        products[productId]={...identity,checkedAt,error:issue(error)};
        if (error.stop || signal.aborted) interrupted=issue(error);
      }
      attempted++;
      if (!interrupted) await checkpoint.write?.(`product:${productId}`,products[productId]);
      updates.product?.(products[productId],true,plannedProducts);
      if (interrupted) break;
    }
  }
  return {seller,scope,quick,storeRows:[...rows.values()],completeStore,products,plannedProducts,cachedProducts,retryAt,interrupted,generatedAt:new Date().toISOString()};
}

export function retryAfterMs(header, consecutive, now=Date.now()) {
  const value=String(header || '').trim();
  if (/^\d+$/.test(value)) {
    const seconds=Number(value);
    if (Number.isSafeInteger(seconds) && Number.isSafeInteger(seconds*1000)) return Math.max(1000,seconds*1000);
  }
  if (/^[A-Za-z]/.test(value)) {
    const timestamp=Date.parse(value);
    if (Number.isFinite(timestamp)) return Math.max(1000,timestamp-now);
  }
  return Math.min(300,60*2**Math.min(3,consecutive-1))*1000;
}

export function createMypPageReader({browserOrigin, fetchPage, signal, wait, waitIfPaused, report, getRate, setRate, quick=false, now=Date.now}) {
  const baseInterval=2500;
  let lastSent=-Infinity;
  return async url=>{
    if (url.origin!==browserOrigin) throw new Error('Endereço fora do MYP Cards.');
    let consecutive=0, showedCountdown=false;
    while (true) {
      await waitIfPaused();
      signal.throwIfAborted();
      const saved=getRate();
      const until=saved.until || 0;
      const interval=Math.max(baseInterval,saved.interval || 0);
      const allowedAt=Math.max(until,Math.max(lastSent,saved.lastSentAt ?? -Infinity)+interval);
      const current=now();
      if (current<allowedAt) {
        if (current<until) {
          if (quick) throw Object.assign(new Error('O MYP limitou novas consultas.'),{retryAt:until});
          const seconds=Math.ceil((until-current)/1000);
          report(`Limite do MYP Cards · retomada em ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`);
          showedCountdown=true;
        }
        await wait(Math.min(1000,allowedAt-current));
        continue;
      }
      if (showedCountdown) report('Retomando a mesma página com um intervalo maior entre consultas.');
      lastSent=now();
      setRate({...saved,until,interval,lastSentAt:lastSent});
      const response=await fetchPage(url,{method:'GET',credentials:'same-origin',mode:'same-origin',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(quick?10000:20000)])});
      if (response.status===403 || response.status===401 || response.headers.get('cf-mitigated')==='challenge') {
        void response.body?.cancel().catch(()=>{});
        throw Object.assign(new Error(`O MYP bloqueou a coleta (HTTP ${response.status}).`),{stop:true});
      }
      if (response.status===429) {
        const currentRate=getRate();
        const limitedAt=now();
        setRate({
          until:Math.max(limitedAt+retryAfterMs(response.headers.get('retry-after'),++consecutive,limitedAt),currentRate.until || 0),
          interval:Math.min(20000,Math.max(interval,currentRate.interval || 0)*2),
          limitedAt,lastSentAt:Math.max(lastSent,currentRate.lastSentAt || 0),successes:0
        });
        void response.body?.cancel().catch(()=>{});
        continue;
      }
      if (!response.ok) throw new Error(`MYP Cards respondeu HTTP ${response.status}.`);
      const latest=getRate();
      if (interval>baseInterval && latest.lastSentAt===lastSent && latest.interval===interval && now()>=latest.until) {
        const successes=(latest.successes || 0)+1;
        const recovered=successes>=8 && now()-Math.max(latest.until,latest.recoveredAt || 0)>=120000;
        setRate({...latest,interval:recovered?Math.max(baseInterval,Math.round(interval*0.8)):interval,
          successes:recovered?0:successes,recoveredAt:recovered?now():latest.recoveredAt});
      }
      return response.text();
    }
  };
}

async function openMypCheckpoint(win,{seller,scope,links,fillMissing}) {
  const key=JSON.stringify([seller.toLowerCase(),scope,fillMissing?'referencias-incompletas':[...new Set(links.map(link=>mypProductUrl(link?.url || link)?.productId).filter(Boolean))].sort()]);
  let database;
  try {
    if (!win.indexedDB || !win.IDBKeyRange) return null;
    database=await new Promise((resolve,reject)=>{
      const request=win.indexedDB.open('comparador-myp-progresso',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('progresso');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    const range=win.IDBKeyRange.bound([key],[key,'\uffff']);
    const data=await new Promise((resolve,reject)=>{
      const request=database.transaction('progresso').objectStore('progresso').getAll(range);
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const result={products:{}};
        for (const {name,value} of request.result) {
          if (name.startsWith('product:')) result.products[name.slice(8)]=value;
          else result[name]=value;
        }
        resolve(result);
      };
    });
    const change=operation=>new Promise((resolve,reject)=>{
      const tx=database.transaction('progresso','readwrite');
      tx.oncomplete=resolve;
      tx.onabort=()=>reject(tx.error);
      operation(tx.objectStore('progresso'));
    });
    return {data,write:(name,value)=>change(store=>store.put({name,value},[key,name])),clear:()=>change(store=>store.delete(range)),close:()=>database.close()};
  } catch { database?.close(); return null; }
}

export async function runBrowserMyp(appOrigin, win=window, doc=document) {
  const seller=storefrontSeller(win.location.href);
  if (win.location.origin!=='https://mypcards.com' || !seller) {
    win.alert('Abra a vitrine de Yu-Gi-Oh! no MYP Cards a partir do comparador e clique neste favorito.');
    return;
  }
  const launchParams=new URLSearchParams(win.location.hash.slice(1));
  const nonce=launchParams.get('comparador-myp');
  const scope=launchParams.get('scope');
  const parent=win.opener;
  const speak=(event,payload={})=>{
    if (nonce && parent) parent.postMessage({channel:'comparador-myp',nonce,event,...payload},appOrigin);
  };
  const tag='comparador-myp-coleta';
  if (doc.getElementById(tag)) return;
  const box=doc.createElement('section');
  box.id=tag;
  Object.assign(box.style,{position:'fixed',top:'16px',right:'16px',zIndex:'2147483647',width:'min(380px,calc(100% - 32px))',padding:'16px',background:'#fff',color:'#17223b',border:'1px solid #c4b5fd',borderRadius:'12px',boxShadow:'0 8px 36px #17152a29',font:'15px system-ui'});
  doc.body.append(box);
  const validMessage=event=>nonce && parent && event.origin===appOrigin && event.source===parent && event.data?.channel==='comparador-myp' && event.data.nonce===nonce;
  const configFrom=data=>{
    if (!['both','store','refs'].includes(data.scope)) return null;
    const links=Array.isArray(data.links)?data.links:[];
    return {seller,scope:data.scope,links,runId:data.runId,quick:data.quick===true && data.scope==='refs' && links.length===1,fillMissing:data.fillMissing===true && data.scope==='refs'};
  };
  const rateKey='comparador-myp-limite-de-consultas';
  let memoryRate={};
  const getRate=()=>{
    try {
      const rate=JSON.parse(win.localStorage.getItem(rateKey));
      if (rate && (rate.until>Date.now() || Date.now()-Math.max(rate.limitedAt || 0,rate.lastSentAt || 0)<30*60*1000)) {
        return {...rate,until:Math.max(rate.until || 0,memoryRate.until || 0),lastSentAt:Math.max(rate.lastSentAt || 0,memoryRate.lastSentAt || 0)};
      }
    } catch { /* The connection still honors the limit in memory. */ }
    return memoryRate.until>Date.now() || Date.now()-(memoryRate.lastSentAt || 0)<30*60*1000 ? memoryRate : {};
  };
  const setRate=rate=>{
    memoryRate=rate;
    try {win.localStorage.setItem(rateKey,JSON.stringify(rate));} catch { /* The deadline is also held in memory. */ }
  };
  let busy=false,canReuse=false,stopCurrent=null;
  const recentProducts=new Map();
  const onCommand=event=>{
    if (!validMessage(event)) return;
    const {data}=event;
    if (data.event==='run' && canReuse && !busy && typeof data.runId==='string') {
      const config=configFrom(data);
      if (config) void runJob(config);
    } else if (data.event==='stop') stopCurrent?.(data.runId);
  };
  const close=()=>{win.removeEventListener('message',onCommand);speak('closed');box.remove();};
  win.addEventListener('message',onCommand);
  async function runJob(config) {
    busy=true;
    const {runId}=config;
    speak('started',{runId,streaming:true});
    const title=doc.createElement('strong'); title.textContent='Comparador MYP Cards';
    const status=doc.createElement('p'); status.setAttribute('role','status');
    const detail=doc.createElement('p'); detail.setAttribute('aria-live','off');detail.hidden=true;
    const button=doc.createElement('button'); button.type='button';button.textContent='Parar coleta';
    const pause=doc.createElement('button'); pause.type='button';pause.textContent='Pausar';pause.style.marginRight='8px';
    box.replaceChildren(title,status,detail,pause,button);
    const abort=new AbortController(), signal=abort.signal;
    let waitForResume,releasePause,progressText='Preparando a coleta no MYP Cards…',waitText='';
    const render=()=>{
      const message=waitForResume?'Coleta pausada. Clique em Retomar quando quiser continuar.':waitText;
      status.textContent=progressText;detail.textContent=message;detail.hidden=!message;
      speak('progress',{runId,text:[progressText,message].filter(Boolean).join(' · ')});
    };
    const stop=()=>{abort.abort();releasePause?.();};
    stopCurrent=id=>{if (!id || id===runId) stop();};
    button.onclick=stop;
    pause.onclick=()=>{
      if (waitForResume) {
        waitForResume=null;releasePause();releasePause=null;pause.textContent='Pausar';
      } else {
        waitForResume=new Promise(resolve=>{releasePause=resolve;});pause.textContent='Retomar';
      }
      render();
    };
    const sleep=ms=>new Promise((resolve,reject)=>{
      if (signal.aborted) {reject(signal.reason);return;}
      const cancel=()=>{win.clearTimeout(id);reject(signal.reason);};
      const id=win.setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);
      signal.addEventListener('abort',cancel,{once:true});
    });
    const readPage=createMypPageReader({browserOrigin:win.location.origin,fetchPage:(...args)=>win.fetch(...args),signal,wait:sleep,waitIfPaused:()=>waitForResume,report:text=>{waitText=text;render();},getRate,setRate,quick:config.quick});
    render();
    const storage=config.quick?null:await openMypCheckpoint(win,config);
    let canSave=Boolean(storage);
    const savedCount=Object.keys(storage?.data.products || {}).length;
    let hasSavedProgress=Boolean(storage?.data.store || storage?.data.pending || savedCount);
    const checkpoint={data:storage?.data,write:async (...args)=>{
      if (!canSave) return;
      try {await storage.write(...args);hasSavedProgress ||= Boolean(args[1]);} catch {canSave=false;}
    }};
    if (savedCount) progressText=`Retomando a coleta · ${savedCount} produtos carregados do progresso salvo.`;
    for (const [id,product] of recentProducts) {
      if (Date.now()-Date.parse(product.checkedAt)>=recentOfferWindow) recentProducts.delete(id);
    }
    const data=await collectBrowserMyp(config,readPage,text=>{progressText=text;waitText='';render();},signal,checkpoint,recentProducts,{
      inventory:rows=>speak('inventory',{runId,rows}),
      product:(product,finished,total)=>speak('product',{runId,product,finished,total})
    });
    if (config.scope==='refs' && !config.links.length) data.interrupted='A outra aba não enviou as URLs. Reabra o MYP pelo comparador para atualizar somente referências.';
    if (!data.interrupted) await storage?.clear().catch(()=>{});
    storage?.close();
    data.resumeAvailable=Boolean(data.interrupted && canSave && hasSavedProgress);
    const count=Object.keys(data.products).length;
    status.textContent=[`${data.storeRows.length} anúncios lidos. ${count} de ${data.plannedProducts} produtos percorridos.`,data.interrupted,data.resumeAvailable?'Progresso salvo. Inicie novamente com as mesmas opções para retomar.':''].filter(Boolean).join(' ');
    detail.textContent=canReuse?'Aba conectada. As próximas consultas podem ser iniciadas no comparador.':'';
    detail.hidden=!detail.textContent;
    pause.remove();
    button.textContent=canReuse?'Desconectar':'Fechar';button.onclick=close;
    if (data.storeRows.length || count || data.completeStore) {
      const download=doc.createElement('button'); download.type='button';download.textContent='Baixar backup JSON';download.style.marginLeft='8px';
      download.onclick=()=>{
        const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
        const link=doc.createElement('a');link.href=url;link.download='coleta-myp-ofertas.json';link.click();
        win.setTimeout(()=>URL.revokeObjectURL(url),1000);
      };
      box.append(download);
    }
    busy=false;stopCurrent=null;
    speak('complete',{runId,data,reusable:canReuse});
  }
  const fallback={seller,scope:['connect','store','refs'].includes(scope)?scope:'both',links:[]};
  let initial=fallback;
  if (nonce && parent) {
    const loading=doc.createElement('p'); loading.textContent='Conectando à aba do comparador…'; box.append(loading);
    initial=await new Promise(resolve=>{
      const finish=value=>{win.removeEventListener('message',onConfig);win.clearTimeout(timer);resolve(value);};
      const onConfig=event=>{
        if (!validMessage(event) || event.data.event!=='config') return;
        if (scope==='connect' && event.data.scope==='connect') {canReuse=true;finish(fallback);return;}
        const config=configFrom(event.data);
        if (scope!=='connect' && config) {canReuse=typeof config.runId==='string';finish(config);}
      };
      win.addEventListener('message',onConfig);
      const timer=win.setTimeout(()=>finish(fallback),2400);
      speak('ready',{supportsConnect:true});
    });
  }
  if (initial.scope==='connect') {
    const title=doc.createElement('strong');title.textContent='Comparador MYP Cards';
    const status=doc.createElement('p');status.setAttribute('role','status');
    status.textContent=canReuse?'Conectado. Use Consultar referência no comparador.':'A conexão não foi confirmada. Reabra esta aba pelo botão Conectar ao MYP.';
    const button=doc.createElement('button');button.type='button';button.textContent=canReuse?'Desconectar':'Fechar';button.onclick=close;
    box.replaceChildren(title,status,button);
    if (canReuse) speak('connected');
    return;
  }
  await runJob(initial);
}
