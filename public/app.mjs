import {applyTolerance, classify, clean, codeKey, compatible, csv, identityMatches, isCompleteOfferCollection, labels, language, mergeMypCaptures, money, mypProductUrl, norm, parseList, storefrontSeller, suggestedPrice, variant} from './core.mjs';
import {collectMarketPrices, currentMarketPrice, marketTarget, savedMarketPrice} from './market-api.mjs';

const $ = id => document.getElementById(id);
const key = 'comparador-myp-v1';
const marketKey = 'comparador-myp-api-publica-v1';
const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const brl = cents => cents === null || cents === undefined ? '—' : currency.format(cents/100);
const decimal = cents => cents === null || cents === undefined ? '' : (cents/100).toFixed(2).replace('.',',');
const referenceDate = new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
const referenceDay = new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short'});
const referenceTime = new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',timeStyle:'medium'});
const listOf = values => values.filter(Boolean).join(' · ');
const productLink = id => `https://mypcards.com/yugioh/produto/${id}`;
const offerKey = ref => JSON.stringify([norm(ref.seller),ref.price,norm(ref.condition),norm(ref.language),norm(ref.rarity),norm(ref.printing),norm(ref.source),ref.url]);
function element(tag,text,className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function readState() {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
const initial = readState();
const state = {cards:[],refs:[],refIssues:[],seller:'',storeUrl:'',mode:'capture',tolerance:0,example:false,useImported:false,...initial,working:false,importing:false,page:1,sort:0,store:null,controller:null,current:'',waiting:''};
if (!initial.comparisonVersion) {
  if (!state.example && !state.refs.length) state.mode = 'capture';
  for (const card of state.cards) card.result = null;
}
const catalogCache = new Map(), offerCache = new Map();
let capturePromise, bundledCapturePromise, importedCapture, liveUnavailable = '';
let browserSync, browserConnection, pendingCapture, pendingSync, bookmarkSource='';
let referenceRun;
let rowRetryAt=0;
let nextCatalogRequest = 0, activeCard = null, preparedAction = null, renderFrame = 0;
let visibleRows = [];
let marketController;
let marketCache=readMarketCache();
const perPage = 30;
function save() {
  const {cards,refs,refIssues,seller,storeUrl,mode,tolerance,example,useImported} = state;
  try { localStorage.setItem(key,JSON.stringify({comparisonVersion:2,cards,refs,refIssues,seller,storeUrl,mode,tolerance,example,useImported})); }
  catch { notify('O navegador não conseguiu salvar este lote. Você pode exportar o CSV antes de sair.','error'); }
}
function notify(message = '',kind = '') {
  const node = $('notice');
  node.textContent = message;
  node.className = kind ? `notice ${kind}` : 'notice';
  node.hidden = !message;
}
function settingsFromState() {
  $('store-url').value = state.storeUrl || (state.seller ? `https://mypcards.com/${encodeURIComponent(state.seller)}/yugioh` : '');
  $('mode').value = state.mode;
  $('seller').value = state.seller;
  $('tolerance').value = state.tolerance;
}
function setTab(tab,focus = false) {
  for (const button of document.querySelectorAll('[role=tab]')) {
    const selected = tab === button;
    button.setAttribute('aria-selected',selected);
    button.tabIndex = selected ? 0 : -1;
    $(button.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) tab.focus();
}
function highlightNav() {
  const hash = location.hash.slice(1) || 'inicio';
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === hash) link.setAttribute('aria-current','location');
    else link.removeAttribute('aria-current');
  }
}
function locked() { return state.working || state.importing; }
function updateControls() {
  for (const id of ['sample','load-snapshot','store-url','load-store','retry-store','use-partial','paste','load-paste','own-file','reference-paste','load-refs','ref-file','capture-file','mode','seller','tolerance']) $(id).disabled = locked();
  $('review-prices').disabled = locked();
  $('run-market').disabled = locked() || Boolean(marketController) || !state.cards.some(marketTarget);
  $('stop-market').hidden = !marketController;
  $('run').disabled = locked() || !state.cards.length || (state.mode==='live' && Boolean(marketController));
  $('stop').hidden = !state.working;
  $('store-recovery').hidden = !state.store || state.importing;
  $('use-partial').hidden = !state.store?.rows.size;
  const connecting=browserConnection && !browserConnection.ready;
  $('fill-references').disabled = locked() || Boolean(browserSync || pendingCapture || connecting) || !state.cards.some(card=>rowProduct(card) && needsOfferCollection(card));
  const connect=$('connect-myp');
  connect.textContent=connecting ? 'Abrir aba do MYP' : browserConnection ? 'Conectado ao MYP' : 'Conectar ao MYP';
  connect.disabled=Boolean(browserSync || browserConnection?.ready);
  $('start-myp-sync').disabled = locked() || Boolean(browserSync || pendingCapture || connecting);
  $('sync-scope').disabled = Boolean(browserSync);
  $('sync-urls').disabled = Boolean(browserSync);
  $('stop-myp-sync').hidden = !browserSync;
  $('stop-myp-sync').disabled = Boolean(browserSync?.stopping || browserSync?.finishing);
  $('stop-reference-sync').hidden = !browserSync || browserSync.scope==='store';
  $('stop-reference-sync').disabled = Boolean(browserSync?.stopping || browserSync?.finishing);
  $('capture-file').disabled = locked() || Boolean(browserSync || pendingCapture);
  $('apply-myp-sync').hidden = !pendingCapture;
  $('apply-myp-sync').disabled = locked();
  for (const button of document.querySelectorAll('button[data-reference]')) button.disabled=locked() || Boolean(browserSync || pendingCapture || connecting);
}
function replaceCards(cards,{seller,example=false,keepReferences=false} = {}) {
  marketController?.abort();
  state.cards = cards.map((card,index)=>({...card,uid:index+1,result:null}));
  if (seller !== undefined) state.seller = seller;
  if ((!keepReferences && state.example) || example) { state.refs = []; state.refIssues = []; }
  if (state.example && !example) state.mode = 'capture';
  state.example = example;
  state.page = 1;
  state.store = null;
  preparedAction = null;
  resetFilters(false);
  settingsFromState();
}
function resetResults() { for (const card of state.cards) card.result = null; }
function confirmReplace(action) {
  if (state.cards.length && !window.confirm('Substituir a pasta atual e os resultados dela?')) return;
  action();
}
function loadInventory(text,filename='lista colada') {
  if (locked()) return;
  const cards = parseList(text);
  if (!cards.length) { notify('A lista está vazia. Confira os cabeçalhos e inclua pelo menos uma carta.','error'); return; }
  confirmReplace(()=>{
    replaceCards(cards);
    const included = cards.flatMap(card=>{
      const price = money(card.refPrice);
      return price !== null ? [{...card,price,issue:'',source:card.source || 'Lista importada'}] : [];
    });
    if (included.length) { addRefs(included); state.mode='manual'; settingsFromState(); }
    notify(`${cards.length} linhas importadas de ${filename}. Se houver dados inválidos, você verá os motivos durante a análise.`,'success');
    render(); save();
  });
}
function addRefs(refs) {
  const map = new Map(state.refs.map(ref=>[JSON.stringify([codeKey(ref.code),norm(ref.name),norm(ref.edition),ref.productId,offerKey(ref)]),ref]));
  for (const ref of refs) map.set(JSON.stringify([codeKey(ref.code),norm(ref.name),norm(ref.edition),ref.productId,offerKey(ref)]),ref);
  state.refs = [...map.values()];
}
function loadReferences(text) {
  if (locked()) return;
  const rows = parseList(text,true);
  if (!rows.length) { notify('A lista de referências está vazia.','error'); return; }
  const valid = rows.filter(row=>!row.issue && row.condition && row.language && (row.productId || row.code || row.name && row.edition));
  if (state.example && valid.length) { state.refs=[]; state.refIssues=[]; }
  const accepted = new Set(valid);
  state.refIssues = rows.filter(row=>!accepted.has(row)).map(row=>`linha ${row.line}: ${row.issue || 'preencha condição, idioma e código, ID ou nome com edição.'}`);
  addRefs(valid);
  if (valid.length) { preparedAction = {retry:false}; state.mode='manual'; settingsFromState(); resetResults(); }
  const problems = state.refIssues.length ? ` ${state.refIssues.length} linhas inválidas. ${state.refIssues.slice(0,4).join(' ')}` : '';
  notify(`${valid.length} referências válidas importadas.${problems}`, valid.length?'success':'error');
  render(); save();
}
async function fileText(file) {
  if (!file) return null;
  if (file.size > 15*1024*1024) throw new Error('O arquivo ultrapassa 15 MB. Divida a lista em arquivos menores.');
  const bytes = await file.arrayBuffer();
  const view = new Uint8Array(bytes);
  if (view[0] === 255 && view[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (view[0] === 254 && view[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}
function wait(ms,signal) {
  return new Promise((resolve,reject)=>{
    signal.throwIfAborted();
    const abort = ()=>{clearTimeout(timer);reject(signal.reason);};
    const timer = setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
async function request(path,params,signal) {
  const url = new URL(path,location.origin);
  url.search = new URLSearchParams(params);
  const response = await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(26000)]),cache:'no-store'});
  let data;
  try { data = await response.json(); } catch { throw new Error('O Site não recebeu uma resposta utilizável da consulta.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || `Erro HTTP ${response.status}.`),{status:response.status,retryAfter:data.retryAfter,upstreamStatus:data.upstreamStatus});
  return data;
}
async function requestOnceRetried(path,params,signal) {
  try { return await request(path,params,signal); }
  catch (error) {
    if (signal.aborted || error.upstreamStatus===403 || error.status && ![429,502,503,504].includes(error.status)) throw error;
    const delay = error.status === 429 ? Math.min(90,Math.max(1,error.retryAfter || 60)) : 2;
    if (error.status === 429) { state.waiting = `Limite temporário do MYP. Retentativa em ${delay} s.`; renderProgress(); }
    await wait(delay*1000,signal);
    state.waiting = '';
    return request(path,params,signal);
  }
}
function readMarketCache() {
  try {
    const value=JSON.parse(localStorage.getItem(marketKey));
    if (value?.products && !Array.isArray(value.products)) return value;
  } catch {}
  return {products:{},nextAt:0};
}
function saveMarketCache() {
  try {localStorage.setItem(marketKey,JSON.stringify(marketCache));} catch {}
}
function renderMarketTable() {
  const fragment=document.createDocumentFragment();
  let found=false;
  for (const card of visibleRows) {
    const target=marketTarget(card);
    const saved=savedMarketPrice(marketCache,target);
    if (!saved) continue;
    const row=element('tr');
    const offer=saved.product;
    row.append(element('td',listOf([card.name,card.code])),element('td',brl(card.price),'money'),
      element('td',brl(offer?.minimum),'money'),element('td',brl(offer?.average),'money'),
      element('td',listOf([referenceDate.format(saved.at),currentMarketPrice(marketCache,target)?'':'Consulta anterior'])));
    fragment.append(row);
    found=true;
  }
  $('market-rows').replaceChildren(fragment);
  $('market-table').hidden=!found;
}
async function startMarketReview() {
  if (marketController || locked()) return;
  const controller=new AbortController(), {signal}=controller;
  marketController=controller;
  updateControls();
  const progress=$('market-progress');
  const visible=new Set(visibleRows);
  const cards=[...visibleRows,...state.cards.filter(card=>!visible.has(card))];
  let requests=0;
  const run=async ()=>{
    const latest=readMarketCache();
    marketCache={...marketCache,...latest,products:{...marketCache.products,...latest.products},nextAt:Math.max(marketCache.nextAt||0,latest.nextAt||0)};
    const fetchPrices=async params=>{
      const delay=(marketCache.nextAt||0)-Date.now();
      if (delay>0) await wait(delay,signal);
      signal.throwIfAborted();
      marketCache.nextAt=Date.now()+6500;
      saveMarketCache();
      requests++;
      try {return (await request('/api/precos-publicos',params,signal)).products;}
      catch (error) {
        if (error.status===404 && !params.page) return [];
        if (error.status===429) {
          const seconds=Number.isFinite(error.retryAfter)?Math.max(1,error.retryAfter):60;
          marketCache.nextAt=Math.max(marketCache.nextAt,Date.now()+seconds*1000);
          saveMarketCache();
          throw new Error(`O MYP limitou a API. Retome após ${referenceTime.format(marketCache.nextAt)}.`);
        }
        throw error;
      }
    };
    const startAfter=(marketCache.nextAt||0)-Date.now();
    if (startAfter>6500) {
      progress.textContent=`O MYP limitou a API. Retome após ${referenceTime.format(marketCache.nextAt)}.`;
      return;
    }
    await collectMarketPrices(cards,marketCache,{
      query:fetchPrices,save:saveMarketCache,signal,
      progress:({done,total,reused})=>{
        progress.textContent=`${done} de ${total} produtos verificados · ${requests} chamadas nesta sessão${reused?` · ${reused} reaproveitados`:''}.`;
        renderMarketTable();
      }
    });
  };
  try {
    progress.textContent='Consultando as estatísticas do MYP Cards…';
    if (navigator.locks) {
      await navigator.locks.request(marketKey,{ifAvailable:true},lock=>lock?run():void (progress.textContent='A consulta pela API já está rodando em outra aba.'));
    } else await run();
  } catch (error) {progress.textContent=signal.aborted?'Consulta pausada. Os resultados já recebidos estão salvos.':error.message;}
  finally {marketController=null;updateControls();renderMarketTable();}
}
async function checkMyp() {
  const button=$('check-myp'), result=$('myp-connection-result');
  if (marketController) {result.textContent='Pause a consulta pela API antes de testar a conexão.';return;}
  button.disabled=true; result.textContent='Consultando o MYP Cards…';
  try {
    const data=await request('/api/myp-status',{},new AbortController().signal);
    const describe=({status,kind,provider,rateLimit})=>{
      if (kind==='network') return 'sem resposta da rede';
      if (kind==='ok') return `HTTP ${status}${rateLimit?` · limite de ${rateLimit} consultas/min`:''}`;
      if (kind==='challenge' || kind==='edge-denial') return `HTTP ${status} · bloqueio identificado na ${provider}`;
      if (kind==='api-denial') return `HTTP ${status} · acesso recusado pela API`;
      if (kind==='html-denial') return `HTTP ${status} · página de acesso recusado`;
      return `HTTP ${status}${kind==='format'?' · formato inesperado':''}`;
    };
    result.textContent=`API pública (${data.tokenConfigured?'token configurado':'sem token'}) — ${describe(data.catalog)}. Página de ofertas — ${describe(data.offers)}.`;
  } catch (error) { result.textContent=error.message; }
  finally { button.disabled=false; }
}
async function startStore(resume=false) {
  if (locked()) return;
  if (!resume) {
    const seller = storefrontSeller($('store-url').value);
    if (!seller) { notify('Informe o link público da vitrine de Yu-Gi-Oh! no MYP Cards.','error'); return; }
    if (state.cards.length && !window.confirm('Substituir a pasta atual e os resultados dela?')) return;
    state.store = {seller,rows:new Map(),page:1,pages:null,total:0};
  }
  const store = state.store;
  if (!store) return;
  state.importing = true;
  updateControls();
  const signal = new AbortController().signal;
  try {
    while (store.pages === null || store.page <= store.pages) {
      notify(`Importando a vitrine de ${store.seller}. Página ${store.page}${store.pages ? ` de ${store.pages}` : ''} · ${store.rows.size} cartas carregadas.`);
      const data = await requestOnceRetried('/api/store',{seller:store.seller,page:store.page},signal);
      const added = data.rows.filter(row=>!store.rows.has(row.stockId));
      if (store.page > 1 && !added.length) throw new Error('O MYP repetiu a página anterior.');
      if (store.pages !== null && store.total !== data.total) throw new Error('A quantidade na vitrine mudou. Reinicie a importação para atualizar a contagem.');
      store.pages = data.pages; store.total = data.total;
      for (const row of added) store.rows.set(row.stockId,row);
      if (store.page >= store.pages && store.rows.size !== store.total) throw new Error('A contagem da vitrine não bateu com as cartas carregadas.');
      store.page++;
      if (store.page <= store.pages) await wait(350,signal);
    }
    if (store.rows.size) finishStore(false);
    else { state.store=null; notify('A vitrine está sem cartas avulsas disponíveis.','error'); }
  } catch (error) {
    notify(`Importação interrompida na página ${store.page}. ${store.rows.size} cartas carregadas. ${error.message} Você pode retomar ou colar/importar sua lista.`,'error');
  } finally { state.importing=false; state.waiting=''; render(); }
}
async function loadSnapshot() {
  if (locked()) return;
  if (state.cards.length && !window.confirm('Substituir a pasta atual e os resultados dela?')) return;
  state.importing=true; updateControls();
  try {
    const response=await fetch('/vitrine.json');
    if (response.status===404) {
      notify('Carregue um exemplo, importe uma lista ou informe a URL da sua vitrine para começar.');
      return false;
    }
    if (!response.ok) throw new Error('A captura da vitrine não pôde ser carregada.');
    const snapshot=await response.json();
    replaceCards(snapshot.rows,{seller:snapshot.seller});
    state.mode='capture'; settingsFromState();
    notify(`${snapshot.rows.length} cartas da vitrine carregadas. A análise cruza a pasta com as ofertas coletadas no MYP Cards.`,'success');
    save();
    return true;
  } catch (error) { notify(error.message,'error');return false; }
  finally { state.importing=false; render(); }
}
function finishStore(partial) {
  const store = state.store;
  if (!store?.rows.size) return;
  replaceCards([...store.rows.values()],{seller:store.seller});
  state.mode='live';
  state.storeUrl = `https://mypcards.com/${encodeURIComponent(store.seller)}/yugioh`;
  settingsFromState();
  notify(`${store.rows.size} de ${store.total} cartas da vitrine de ${store.seller} importadas.${partial?' A importação está parcial.':''}`,partial?'error':'success');
  render(); save();
}
const sampleCards = `Carta;Código;Edição;Condição;Idioma;Meu preço;Quantidade
Guardião de Exemplo;DEMO-001;DEMO;NM;PT;0,75;4
Arauto da Névoa;DEMO-002;DEMO;NM;PT;1,00;2
Vigia da Aurora;DEMO-003;DEMO;SP;EN;1,00;1
Mapa Esquecido;DEMO-004;DEMO;NM;PT;abc;1
Oráculo das Marés;DEMO-005;DEMO;NM;PT;3,00;1
Eco do Santuário;DEMO-006;DEMO;NM;EN;12,00;2
Selo Celeste;DEMO-007;DEMO;NM;PT;18,00;1
Névoa Dimensional;DEMO-008;DEMO;NM;EN;0,40;3`;
const sampleRefs = `Carta;Código;Edição;Condição;Idioma;Preço referência;Fonte;Vendedor
Guardião de Exemplo;DEMO-001;DEMO;NM;PT;0,85;Exemplo fictício;Loja A
Guardião de Exemplo;DEMO-001;DEMO;NM;PT;0,95;Exemplo fictício;Loja B
Arauto da Névoa;DEMO-002;DEMO;NM;PT;0,65;Exemplo fictício;Loja B
Vigia da Aurora;DEMO-003;DEMO;NM;EN;0,80;Exemplo fictício;Loja A
Oráculo das Marés;DEMO-005;DEMO;NM;PT;3,50;Exemplo fictício;Loja A
Eco do Santuário;DEMO-006;DEMO;NM;EN;9,00;Exemplo fictício;Loja B
Selo Celeste;DEMO-007;DEMO;NM;PT;20,00;Exemplo fictício;Loja A
Névoa Dimensional;DEMO-008;DEMO;NM;EN;0,40;Exemplo fictício;Loja B`;
function loadExample() {
  confirmReplace(()=>{
    replaceCards(parseList(sampleCards),{seller:'',example:true});
    addRefs(parseList(sampleRefs,true));
    state.mode='manual'; state.tolerance=0;
    settingsFromState();
    notify('Exemplo fictício carregado. O lote inclui cartas de até R$ 1, uma referência de condição diferente e um preço inválido.');
    render(); save();
    void analyze();
  });
}

function importedFor(card) {
  return state.refs.filter(ref=>identityMatches(card,ref) && compatible(card,ref,state.seller)).map(ref=>({...ref,source:ref.source || 'Importação manual'}));
}
function matchCatalog(card,candidates) {
  const precise = candidates.filter(candidate=>{
    if (card.edition && norm(card.edition)!==norm(candidate.edition)) return false;
    if (card.code && codeKey(card.code)!==codeKey(candidate.code)) return false;
    return Boolean(card.code || card.edition);
  });
  return precise.length===1 ? precise[0] : null;
}
async function catalogFor(card,signal) {
  const name = card.name || '', code = card.code || '';
  if (!code && !card.edition) return null;
  const key = norm(name) || codeKey(code);
  if (!catalogCache.has(key)) {
    if (nextCatalogRequest>Date.now()) {
      state.waiting = 'Aguardando o intervalo entre chamadas ao catálogo do MYP.';
      renderProgress();
      await wait(nextCatalogRequest-Date.now(),signal);
      state.waiting = '';
    }
    nextCatalogRequest = Date.now()+6300;
    const params = name ? {name} : {code:code.replace(/^yugioh_/i,'')};
    let candidates;
    try { candidates = await requestOnceRetried('/api/catalog',params,signal); }
    catch (error) { if (error.status !== 404) throw error; candidates=[]; }
    catalogCache.set(key,candidates);
  }
  return matchCatalog(card,catalogCache.get(key));
}
async function offersFor(product,signal) {
  const outcomes = new Map();
  const slug = /^https:\/\/(?:www\.)?mypcards\.com\/yugioh\/produto\/\d+\/([a-z0-9_-]+)(?:[/?#]|$)/i.exec(product.url || '')?.[1] || '';
  const first = await requestOnceRetried('/api/offers',{id:product.productId,slug},signal);
  if (first.rows.length > first.count && first.count) throw new Error('A contagem de ofertas mudou durante a consulta.');
  for (const row of first.rows) outcomes.set(row.stockId,row);
  const pages = Math.max(first.certPages,first.otherPages);
  for (let page=2;page<=pages;page++) {
    await wait(350,signal);
    const batch = await requestOnceRetried('/api/offers',{id:product.productId,slug:slug || first.slug || '',cert:Math.min(page,first.certPages),other:Math.min(page,first.otherPages)},signal);
    if (batch.count!==first.count || batch.certPages!==first.certPages || batch.otherPages!==first.otherPages) throw new Error('As ofertas mudaram durante a consulta.');
    for (const row of batch.rows) outcomes.set(row.stockId,row);
  }
  return {offers:[...outcomes.values()],expected:first.count,checkedAt:new Date().toISOString()};
}
function captureStorage(mode,write) {
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open('comparador-myp-coletas',1);
    open.onupgradeneeded=()=>open.result.createObjectStore('dados');
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result;
      const tx=db.transaction('dados',mode);
      const store=tx.objectStore('dados');
      const request=mode==='readwrite'?store.put(write,'myp'):store.get('myp');
      tx.onerror=()=>{db.close();reject(tx.error);};
      tx.onabort=()=>{db.close();reject(tx.error);};
      tx.oncomplete=()=>{db.close();resolve(request.result);};
    };
  });
}
function validProduct(id,product) {
  return /^\d{1,10}$/.test(id) && id===product?.productId && Number.isFinite(Date.parse(product.checkedAt)) &&
    (typeof product.error==='string' && product.error || (Number.isSafeInteger(product.expected) && product.expected>=0 &&
      Array.isArray(product.offers) && product.offers.every(offer=>Number.isSafeInteger(offer?.price) && offer.price>=0 && typeof offer.seller==='string')));
}
function validCapture(data) {
  return Boolean(data?.seller && data?.products && !Array.isArray(data.products) && Array.isArray(data.storeRows) &&
    (data.scope ? ['both','store','refs'].includes(data.scope) : data.storeRows.length) &&
    Object.entries(data.products).every(([id,product])=>validProduct(id,product)));
}
async function setBookmark() {
  const status=$('myp-bookmark-status');
  try {
    const response=await fetch('/coleta-navegador.js.txt',{cache:'no-store'});
    if (!response.ok) throw new Error('Não foi possível abrir o código do favorito.');
    const code=await response.text();
    bookmarkSource=`javascript:${encodeURIComponent(`void(() => {${code}\nvoid runBrowserMyp(${JSON.stringify(location.origin)});})()`)}`;
    $('myp-bookmark').href=bookmarkSource;
    $('myp-bookmark').setAttribute('aria-disabled','false');
    $('copy-myp-bookmark').disabled=false;
  } catch (error) { status.textContent=error.message; }
}
function setSyncStatus(text,sync=browserSync) {
  $('myp-sync-status').textContent=text;
  const rowStatus=$('reference-sync-status');
  rowStatus.textContent=sync?.cardName ? `${sync.cardName} · ${text}` : sync?.fillMissing || sync?.scope && sync.scope!=='store' ? text : '';
  rowStatus.hidden=!rowStatus.textContent;
}
function rowProduct(card) {
  return mypProductUrl(card?.url) || mypProductUrl(card?.result?.productUrl);
}
function needsOfferCollection(card) {
  return !card.result?.refAt || card.result.partial || card.result.status==='failed';
}
function renderReferenceUpdates() {
  const sync=referenceRun;
  const list=$('reference-live-rows');
  $('reference-live').hidden=!sync || sync.scope==='store' || sync!==browserSync && !sync.history.size;
  if ($('reference-live').hidden) return;
  const saved=sync.savedProducts.size;
  $('reference-live-count').textContent=sync.total===undefined ? 'As primeiras ofertas vão aparecer aqui.' :
    `${sync.finishedProducts.size} de ${sync.total} produtos percorridos · ${saved} ${saved===1?'salvo':'salvos'} no comparador.`;
  if (sync.saveFailed) $('reference-live-count').textContent+=' O navegador não salvou a última atualização.';
  const fragment=document.createDocumentFragment();
  for (const {product,result,finished,name} of [...sync.history.values()].reverse()) {
    const row=element('li');
    const coverage=Array.isArray(product.offers) ? `${product.offers.length}/${product.expected} ofertas` : 'Consulta falhou';
    const prices=result?.refs.length ? `Menor ${brl(result.best)} · Média ${brl(result.average)}` : result && finished ? 'Sem oferta equivalente' : '';
    row.append(element('strong',name),element('span',listOf([prices,coverage,finished?'':'Em coleta'])));
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}
function beginReferenceUpdates(sync) {
  sync.targets=new Set(sync.links.map(link=>link.productId));
  sync.history=new Map();
  sync.savedProducts=new Set();
  sync.finishedProducts=new Set();
  referenceRun=sync;
  renderReferenceUpdates();
}
function applyCollectedInventory(data) {
  const saved=new Map(state.cards.map(card=>[card.stockId,card]));
  const inventory=data.storeRows.map(card=>{
    const old=saved.get(card.stockId);
    return old?.condition===card.condition && identityMatches(old,card) && old.soldAverage>0 ? {...card,soldAverage:old.soldAverage} : card;
  });
  replaceCards(inventory,{seller:data.seller});
}
function queueBrowserUpdate(sync,{product,finished,total,rows}) {
  const delta=sync.delta ||= {seller:sync.seller,scope:sync.scope,storeRows:[],products:{}};
  if (rows) {
    delta.storeRows=rows;delta.completeStore=true;
    for (const card of rows) if (rowProduct(card)) sync.targets.add(rowProduct(card).productId);
  } else {
    delta.products[product.productId]=product;
    sync.total=total;
    if (finished) sync.finishedProducts.add(product.productId);
    const card=state.cards.find(card=>rowProduct(card)?.productId===product.productId);
    const result=card?.condition && card.language && !card.issue && Array.isArray(product.offers) ? compareMyp(card,product,product,sync.seller,'Coleta do MYP Cards') : null;
    sync.history.delete(product.productId);
    sync.history.set(product.productId,{product,result,finished,name:card?.name || product.name || product.productId});
    if (sync.history.size>8) sync.history.delete(sync.history.keys().next().value);
  }
  renderReferenceUpdates();
  sync.updateTimer ||= window.setTimeout(()=>void flushBrowserUpdates(sync),120);
}
function flushBrowserUpdates(sync) {
  window.clearTimeout(sync.updateTimer);
  sync.updateTimer=null;
  const data=sync.delta;
  if (!data) return sync.writes || Promise.resolve();
  sync.delta=null;
  sync.writes=(sync.writes || Promise.resolve()).then(async ()=>{
    const previous=await loadMarketCapture().catch(()=>null);
    const merged=mergeMypCaptures(norm(previous?.seller)===norm(sync.seller)?previous:null,data);
    try {
      await captureStorage('readwrite',merged);
      state.useImported=true;
      for (const id of Object.keys(data.products)) sync.savedProducts.add(id);
      sync.saveFailed=false;
    } catch {sync.saveFailed=true;}
    importedCapture=merged;
    capturePromise=Promise.resolve(merged);
    if (data.completeStore && !locked() && !sync.inventoryApplied) {
      applyCollectedInventory(data);sync.inventoryApplied=true;
      state.mode='capture';settingsFromState();
    }
    if (!locked() && (!state.seller || norm(state.seller)===norm(sync.seller))) {
      const signal=new AbortController().signal;
      await Promise.all(state.cards.filter(card=>Object.hasOwn(data.products,rowProduct(card)?.productId || card.productId)).map(async card=>{
        card.result=await inspect(card,signal,'capture',merged);
      }));
    }
    save();render();renderReferenceUpdates();
  }).catch(()=>{
    sync.saveFailed=true;renderReferenceUpdates();
  });
  return sync.writes;
}
function openMypTab(seller,scope) {
  const nonce=crypto.randomUUID();
  const target=new URL(`https://mypcards.com/${encodeURIComponent(seller)}/yugioh`);
  target.hash=new URLSearchParams({'comparador-myp':nonce,scope});
  const popup=window.open(target.href,`myp-coleta-${nonce}`);
  if (!popup) return null;
  const watcher=window.setInterval(()=>{
    const sync=browserSync?.popup===popup?browserSync:null;
    const ownsConnection=browserConnection?.popup===popup;
    if (!sync && !ownsConnection) {window.clearInterval(watcher);return;}
    if (!popup.closed) return;
    if (sync && !sync.finishing) {
      window.clearTimeout(sync.startTimer);
      window.clearTimeout(sync.stopTimer);
      sync.finishing=true;
      void flushBrowserUpdates(sync).then(()=>{
        if (browserSync===sync) browserSync=null;
        updateControls();renderReferenceUpdates();
        const count=sync.savedProducts.size;
        const saved=count ? ` ${count} ${count===1?'produto já salvo':'produtos já salvos'}.` : '';
        setSyncStatus(`A aba do MYP foi fechada.${saved} Reabra a coleta para retomar.`,sync);
      });
    }
    if (ownsConnection) browserConnection=null;
    window.clearInterval(watcher);updateControls();
    if (!sync) setSyncStatus('A aba do MYP foi fechada. Clique em Conectar ao MYP para abrir outra.');
  },1500);
  return {nonce,popup,seller};
}
function connectToMyp() {
  if (browserSync) return;
  if (browserConnection && !browserConnection.popup.closed) {browserConnection.popup.focus();return;}
  const seller=storefrontSeller($('store-url').value);
  if (!seller) {setSyncStatus('Informe o link da vitrine de Yu-Gi-Oh! no MYP Cards.');return;}
  browserConnection=openMypTab(seller,'connect');
  updateControls();
  if (!browserConnection) {setSyncStatus('Permita que o comparador abra a aba do MYP e clique novamente.');return;}
  $('myp-bookmark-setup').open=true;
  setSyncStatus('Na aba do MYP, acione o favorito Conectar comparador MYP.');
}
function startBrowserSync(card=null,{fillMissing=false,complete=false}={}) {
  if (browserSync || pendingCapture || locked()) return;
  const jobOptions=card ? {cardUid:card.uid,cardName:card.name || card.code || 'Carta selecionada',quick:!complete} : {fillMissing};
  const say=text=>setSyncStatus(text,{...jobOptions,scope:card||fillMissing?'refs':$('sync-scope').value});
  if (browserConnection && !browserConnection.ready && !browserConnection.popup.closed) {
    say('Acione o favorito na aba do MYP para concluir a conexão.');return;
  }
  const seller=((card||fillMissing)&&state.seller)||storefrontSeller($('store-url').value);
  if (!seller) {say('Informe o link da vitrine de Yu-Gi-Oh! no MYP Cards.');return;}
  const scope=card||fillMissing?'refs':$('sync-scope').value;
  const lines=$('sync-urls').value.split(/\s+/).filter(Boolean);
  const exact=card?[rowProduct(card)]:scope==='refs' && !fillMissing?lines.map(mypProductUrl):[];
  if (exact.some(link=>!link)) {say('Use somente URLs de cartas de Yu-Gi-Oh! do MYP Cards.');return;}
  const known=new Map(state.cards.flatMap(row=>{
    const link=rowProduct(row);
    return link?[[link.productId,{...row,...link}]]:[];
  }));
  const remaining=fillMissing?new Set(state.cards.filter(needsOfferCollection).map(row=>rowProduct(row)?.productId)):null;
  const links=scope!=='refs'?[]:(exact.length?exact:[...known.values()].filter(row=>!remaining || remaining.has(row.productId))).map(({productId,url})=>{
    const {name,altName,code,edition}=card || known.get(productId) || {};
    return {productId,url,name,altName,code,edition};
  });
  if (scope==='refs' && !links.length) {say('Cole as URLs das cartas ou carregue sua pasta primeiro.');return;}
  if (scope!=='refs' && state.cards.length && state.seller && norm(state.seller)!==norm(seller) && !window.confirm(`Substituir a pasta atual pela vitrine de ${seller}?`)) return;
  if (scope==='refs' && state.cards.length && state.seller && norm(state.seller)!==norm(seller)) {
    say('Use a URL da vitrine correspondente à pasta atual para atualizar apenas suas referências.');return;
  }
  if (jobOptions.quick && Date.now()<rowRetryAt) {void showSavedLookup({...jobOptions,links},rowRetryAt);return;}
  const runId=crypto.randomUUID();
  const storeUrl=`https://mypcards.com/${encodeURIComponent(seller)}/yugioh`;
  const sameTab=browserConnection?.ready && !browserConnection.popup.closed && norm(browserConnection.seller)===norm(seller);
  if (sameTab) {
    const {popup,nonce}=browserConnection;
    const sync={popup,nonce,runId,scope,links,seller,...jobOptions,reused:true};
    browserSync=sync;
    beginReferenceUpdates(sync);
    updateControls();say('Solicitando à aba do MYP que já está conectada…');
    popup.postMessage({channel:'comparador-myp',nonce,event:'run',runId,scope,links,quick:sync.quick,fillMissing},'https://mypcards.com');
    sync.startTimer=window.setTimeout(()=>{
      if (browserSync!==sync) return;
      browserSync=null;browserConnection=null;updateControls();
      renderReferenceUpdates();
      say('A aba do MYP não respondeu. Clique no botão novamente para abrir uma nova conexão.');
    },10000);
    return;
  }
  browserConnection=null;
  const connection=openMypTab(seller,scope);
  if (!connection) {say('Permita a abertura de uma nova aba para o comparador e clique novamente.');return;}
  browserSync={...connection,runId,scope,links,...jobOptions};
  beginReferenceUpdates(browserSync);
  state.storeUrl=storeUrl; save(); updateControls();
  $('myp-bookmark-setup').open=true;
  say('Na aba do MYP, acione o favorito Conectar comparador MYP. Mantenha as duas abas abertas.');
}
function stopBrowserSync() {
  if (!browserSync || browserSync.stopping || browserSync.finishing) return;
  const sync=browserSync;
  const {popup,nonce,runId}=sync;
  sync.stopping=true;
  window.clearTimeout(sync.startTimer);
  popup.postMessage({channel:'comparador-myp',nonce,runId,event:'stop'},'https://mypcards.com');
  updateControls();
  setSyncStatus('Encerrando a coleta. Aguardando os resultados já lidos…',sync);
  sync.stopTimer=window.setTimeout(()=>{
    if (browserSync!==sync) return;
    sync.finishing=true;
    void flushBrowserUpdates(sync).then(()=>{
      browserSync=null;browserConnection=null;updateControls();renderReferenceUpdates();
      if (sync.retryAt) {void showSavedLookup(sync,sync.retryAt);return;}
      setSyncStatus(sync.savedProducts.size?'Coleta encerrada. As referências já recebidas estão salvas.':'Coleta encerrada. Confira se há um backup na aba do MYP.',sync);
    });
  },6000);
}
async function showSavedLookup(sync,retryAt) {
  const limit=`O MYP limitou novas consultas até ${referenceTime.format(retryAt)}.`;
  const card=state.cards.find(row=>row.uid===sync.cardUid && rowProduct(row)?.productId===sync.links[0]?.productId);
  if (!card) {setSyncStatus(limit,sync);return;}
  state.importing=true;updateControls();
  try {
    if (!card.result?.refAt || !card.result.refs?.length) {
      const saved=await inspect(card,new AbortController().signal,'capture').catch(()=>null);
      if (saved?.refAt && saved.refs.length) {card.result=saved;save();}
    }
    const savedAt=card.result?.refs?.length && Date.parse(card.result.refAt);
    const status=Number.isFinite(savedAt) ? `Exibindo ofertas salvas em ${referenceDate.format(savedAt)}.` : 'Nenhuma oferta equivalente salva do MYP para esta carta.';
    setSyncStatus(`${limit} ${status}`,sync);
  } finally {state.importing=false;render();}
}
const resumeNotice = data => data.resumeAvailable ? 'Reabra a coleta com as mesmas opções para continuar do progresso salvo.' : '';
async function applyBrowserCapture() {
  const data=pendingCapture;
  const sync=pendingSync;
  if (!data || locked()) return;
  const rowQuery=sync?.cardUid!==undefined;
  const retryAt=sync?.quick ? Math.max(sync.retryAt || 0,Number.isSafeInteger(data.retryAt) && data.retryAt<=8.64e15 ? data.retryAt : 0) : 0;
  if (retryAt) {
    rowRetryAt=Math.max(rowRetryAt,retryAt);
    if (!Object.values(data.products).some(product=>Array.isArray(product.offers))) {
      pendingCapture=null;pendingSync=null;
      await showSavedLookup(sync,retryAt);return;
    }
  }
  if (!data.completeStore && !Object.keys(data.products).length) {
    pendingCapture=null;pendingSync=null;updateControls();
    setSyncStatus([data.interrupted || 'A coleta não trouxe dados utilizáveis.',resumeNotice(data)].filter(Boolean).join(' '),sync);return;
  }
  const usedStreamInventory=Boolean(sync?.inventoryApplied);
  const selective=usedStreamInventory || data.scope==='refs' && (rowQuery || sync?.fillMissing || state.mode==='capture' && norm(state.seller)===norm(data.seller));
  state.importing=true; updateControls();
  try {
    const previous=await loadMarketCapture().catch(()=>null);
    const sameSeller=previous && norm(previous.seller)===norm(data.seller);
    const merged=mergeMypCaptures(sameSeller?previous:null,data);
    await captureStorage('readwrite',merged);
    importedCapture=merged; state.useImported=true; capturePromise=undefined;
    if (data.completeStore && !usedStreamInventory) {
      applyCollectedInventory(data);
    } else if (selective) {
      const signal=new AbortController().signal;
      const affected=state.cards.filter(card=>Object.hasOwn(data.products,rowProduct(card)?.productId || card.productId));
      await Promise.all(affected.map(async card=>{card.result=await inspect(card,signal,'capture',merged);}));
    } else {
      state.seller ||= data.seller;
      resetResults();
    }
    if (!rowQuery) {state.mode='capture';settingsFromState();}
    pendingCapture=null;pendingSync=null;
    const results=Object.values(data.products);
    const complete=results.filter(isCompleteOfferCollection).length;
    const partial=results.filter(p=>Array.isArray(p.offers)).length-complete;
    const first=results[0];
    const keptComplete=rowQuery && first && !isCompleteOfferCollection(first) && isCompleteOfferCollection(merged.products[first.productId]);
    let references='';
    if (keptComplete) references='As referências da última coleta completa continuam na tabela.';
    else if (rowQuery && first?.offers && partial) references=`Resultado parcial · ${first.offers.length} de ${first.expected} ofertas do produto lidas.`;
    else if (rowQuery && complete) references=`Coleta completa · ${first.offers.length} ofertas do produto lidas. Cada raridade foi comparada separadamente.`;
    else if (data.scope!=='store') references=`${results.length} de ${data.plannedProducts ?? results.length} produtos percorridos. ${complete} completos, ${partial} parciais e ${results.length-complete-partial} com falha.`;
    const recent=Number.isSafeInteger(data.cachedProducts) && data.cachedProducts>0?'Resultado dos últimos 2 minutos reaproveitado.':'';
    const issue=retryAt?`O MYP limitou novas consultas até ${referenceTime.format(retryAt)}.`:data.interrupted;
    setSyncStatus([data.completeStore?`${data.storeRows.length} anúncios atualizados.`:'',references,recent,issue,resumeNotice(data)].filter(Boolean).join(' '),sync);
    save();
  } catch (error) { setSyncStatus(error.message || 'Não foi possível aplicar os dados da coleta.',sync); }
  finally {state.importing=false;render();}
  if (!pendingCapture && !selective) void analyze();
}
function receiveBrowserSync(event) {
  const sync=browserSync, msg=event.data;
  if (event.origin!=='https://mypcards.com' || msg?.channel!=='comparador-myp') return;
  const connection=browserConnection;
  if (connection && event.source===connection.popup && msg.nonce===connection.nonce) {
    if (msg.event==='closed') {
      browserConnection=null;updateControls();setSyncStatus('MYP desconectado.');return;
    }
    if (!connection.ready && msg.event==='ready') {
      // Older bookmarks must receive an empty references job so connecting never starts a batch.
      const config=msg.supportsConnect===true ? {scope:'connect'} : {scope:'refs',links:[]};
      connection.popup.postMessage({channel:'comparador-myp',nonce:connection.nonce,event:'config',...config},event.origin);
      if (config.scope==='refs') {
        browserConnection=null;updateControls();
        setSyncStatus('Substitua o favorito antigo pelo atual e clique em Conectar ao MYP novamente.');
      }
      return;
    }
    if (!connection.ready && msg.event==='connected') {
      connection.ready=true;updateControls();
      setSyncStatus('MYP conectado. Use Consultar referência ao lado da carta desejada.');return;
    }
  }
  if (!sync || event.source!==sync.popup || msg.nonce!==sync.nonce) return;
  if (msg.event==='ready' && !sync.reused) {
    sync.popup.postMessage({channel:'comparador-myp',nonce:sync.nonce,event:'config',runId:sync.runId,scope:sync.scope,links:sync.links,quick:sync.quick,fillMissing:sync.fillMissing},event.origin);
    return;
  }
  if ((msg.runId || sync.reused) && msg.runId!==sync.runId) return;
  if (sync.finishing) return;
  if (msg.event==='started') {
    window.clearTimeout(sync.startTimer);
    sync.streaming=msg.streaming===true;
  }
  if (msg.runId===sync.runId && sync.streaming) {
    if (msg.event==='inventory' && sync.scope==='both' && Array.isArray(msg.rows) && msg.rows.every(row=>row && typeof row.stockId==='string')) {
      queueBrowserUpdate(sync,{rows:msg.rows});return;
    }
    if (msg.event==='product' && sync.scope!=='store' && sync.targets.has(msg.product?.productId) &&
        validProduct(msg.product.productId,msg.product) && Number.isSafeInteger(msg.total) && msg.total>0) {
      queueBrowserUpdate(sync,{product:msg.product,finished:msg.finished===true,total:msg.total});return;
    }
  }
  if (!sync.stopping && msg.event==='progress' && typeof msg.text==='string') {
    const waiting=sync.quick && /Limite do MYP Cards · retomada em (\d{1,5}):([0-5]\d)/.exec(msg.text.slice(0,300));
    if (waiting) {
      // An older bookmark still waits for 429s. Stop that individual job while preserving its cooldown.
      sync.retryAt=Date.now()+1000*(60*Number(waiting[1])+Number(waiting[2]));
      rowRetryAt=Math.max(rowRetryAt,sync.retryAt);
      stopBrowserSync();
    } else setSyncStatus([msg.text.slice(0,300),sync.streaming===false && sync.scope!=='store'?'Atualize o favorito para ver os preços durante a coleta.':''].filter(Boolean).join(' '),sync);
  }
  if (msg.event==='complete' && validCapture(msg.data) && norm(msg.data.seller)===norm(sync.seller) && msg.data.scope===sync.scope) {
    window.clearTimeout(sync.startTimer);
    window.clearTimeout(sync.stopTimer);
    sync.finishing=true;
    void flushBrowserUpdates(sync).then(()=>{
      browserConnection=msg.reusable && !sync.popup.closed?{popup:sync.popup,nonce:sync.nonce,seller:sync.seller,ready:true}:null;
      browserSync=null;pendingCapture=msg.data;pendingSync=sync;updateControls();renderReferenceUpdates();
      if (locked()) setSyncStatus('Coleta recebida. Aplique os dados quando o lote atual terminar.',sync);
      else void applyBrowserCapture();
    });
  }
}
async function importMarketCapture(event) {
  const input=event.currentTarget;
  const file=input.files[0];
  input.value='';
  if (!file || locked() || browserSync || pendingCapture) return;
  state.importing=true; updateControls();
  try {
    const capture=JSON.parse(await fileText(file));
    if (!validCapture(capture)) throw new Error('Selecione o JSON gerado pelo coletor do MYP Cards.');
    if (capture.scope) {
      if (state.cards.length && state.seller && norm(state.seller)!==norm(capture.seller) && !window.confirm(`Usar a coleta de ${capture.seller}?`)) return;
      pendingCapture=capture;
      pendingSync=null;
      state.importing=false;
      await applyBrowserCapture();
      return;
    }
    if (state.cards.length && !window.confirm('Substituir a pasta atual pela vitrine do arquivo e usar as ofertas dessa coleta?')) return;
    await captureStorage('readwrite',capture);
    importedCapture=capture;
    state.useImported=true;
    capturePromise=undefined;
    replaceCards(capture.storeRows,{seller:capture.seller});
    state.mode='capture'; settingsFromState();
    notify(`${capture.storeRows.length} cartas e ofertas pesquisadas no MYP importadas. Clique em Analisar lista.`,'success');
    save();
  } catch (error) { notify(error.message || 'Falha ao importar a coleta.','error'); }
  finally { state.importing=false; render(); }
}
function loadBundledCapture() {
  return bundledCapturePromise ||= fetch('/ofertas-myp.json').then(response=>{
    if (!response.ok) throw new Error('A coleta de ofertas do MYP não pôde ser aberta.');
    return response.json();
  }).catch(error=>{ bundledCapturePromise=undefined; throw error; });
}
function loadMarketCapture() {
  const local=()=>state.useImported ? importedCapture || captureStorage('readonly').catch(()=>null) : null;
  return capturePromise ||= Promise.resolve().then(local).then(capture=>capture || loadBundledCapture()).catch(error=>{ capturePromise=undefined; throw error; });
}
async function loadReviewCapture() {
  const capture=await loadMarketCapture();
  if (!state.useImported) return capture;
  const baseline=await loadBundledCapture().catch(()=>null);
  return baseline && baseline!==capture ? mergeMypCaptures(baseline,capture) : capture;
}
function compareMyp(card,product,market,seller,refSource,note='') {
  const url = product.url || productLink(product.productId);
  const {offers,expected,checkedAt} = market;
  const refs = offers.filter(ref=>ref.stockId!==card.stockId && compatible(card,ref,seller)).map(ref=>({...ref,source:'MYP Cards',url}));
  const variants = new Set(refs.map(ref=>JSON.stringify([variant(ref.rarity),variant(ref.printing)])));
  const unresolved = variants.size>1 && (!card.rarity || !card.printing && card.origin!=='store');
  const reason = unresolved ? 'Há ofertas de variantes diferentes. Informe a raridade e a impressão da sua carta.' : refs.length ? '' : 'Entre as ofertas coletadas, nenhuma é de outro vendedor com a mesma variante, condição e idioma.';
  const partial=!isCompleteOfferCollection(market);
  const coverage=partial?`${offers.length} de ${expected} ofertas do produto foram coletadas, somando todas as raridades. Os preços usam somente ofertas equivalentes à sua carta.`:'';
  const result = classify(card,unresolved?[]:refs,state.tolerance,listOf([note,coverage,market.warning,reason]));
  return applyTolerance({...result,partial,offerCoverage:{read:offers.length,expected},productUrl:url,refAt:checkedAt,refSource},card.price,state.tolerance);
}
async function inspectCapture(card,signal,note='',currentCapture=null) {
  const capture = currentCapture || await loadMarketCapture();
  signal.throwIfAborted();
  const productId = rowProduct(card)?.productId || card.productId;
  const direct = productId ? capture.products[productId] : null;
  const candidates = productId ? [] : Object.values(capture.products).filter(product=>identityMatches(card,product) || identityMatches(card,{...product,name:product.altName}));
  const product = direct || (candidates.length===1 ? candidates[0] : null);
  if (!product) {
    const reason = candidates.length>1 ? 'Mais de um produto tem esse código. Informe a edição exata ou o link do produto no MYP.' : 'Esta versão não está na coleta de ofertas do MYP.';
    return classify(card,[],state.tolerance,listOf([note,reason]));
  }
  if (product.error) {
    return {...classify(card,[],state.tolerance,'',listOf([note,`A consulta ao MYP falhou na coleta. ${product.error}`])),productUrl:product.url,refAt:product.checkedAt,refSource:'Coleta do MYP Cards'};
  }
  return compareMyp(card,product,product,state.seller || capture.seller,'Coleta do MYP Cards',note);
}
async function inspect(card,signal,mode=state.mode,currentCapture=null) {
  if (card.issue) return classify(card,[],state.tolerance,'',card.issue);
  const reason = !card.condition || !card.language ? 'Preencha a condição e o idioma para encontrar ofertas equivalentes.' :
    !card.code && !card.edition && !card.productId ? 'Preencha o código ou a edição para identificar a versão correta.' : 'Nenhuma oferta comparável encontrada.';
  if (!card.condition || !card.language) return classify(card,[],state.tolerance,reason);
  if (mode === 'manual') {
    const local = importedFor(card);
    return classify(card,local,state.tolerance,local.length?'':state.refs.length?reason:'Importe preços de referência para comparar esta carta.');
  }
  if (mode === 'capture' || liveUnavailable) return inspectCapture(card,signal,liveUnavailable,currentCapture);
  if (!state.seller && !card.stockId) return classify(card,[],state.tolerance,'Informe seu vendedor para excluir seus próprios anúncios da comparação.');
  let product = card.productId ? card : null;
  try {
    product ||= await catalogFor(card,signal);
    if (!product) return classify(card,[],state.tolerance,'O catálogo não identificou uma única versão. Informe o código, o link ou a edição.');
    if (!offerCache.has(product.productId)) offerCache.set(product.productId,await offersFor(product,signal));
    return compareMyp(card,product,offerCache.get(product.productId),state.seller,'Consulta ao vivo ao MYP Cards');
  } catch (error) {
    if (signal.aborted) throw error;
    if (error.upstreamStatus===403) {
      liveUnavailable='Consulta ao vivo indisponível (HTTP 403). Usando a coleta do MYP.';
      notify(liveUnavailable);
      return inspectCapture(card,signal,liveUnavailable);
    }
    return {...classify(card,[],state.tolerance,'',error.message || 'Falha de consulta.'),productUrl:product?.url};
  }
}
async function reviewPrices() {
  if (locked() || !state.cards.length && !await loadSnapshot()) return;
  if (state.mode!=='manual') state.mode='capture';
  settingsFromState();
  resetFilters(false);
  state.sort='review';
  if (await analyze(false,{review:true})) $('results-title').focus();
}
async function analyze(retry=false,{review=false}={}) {
  if (locked() || !state.cards.length || state.mode==='live' && marketController) return;
  const pending = state.cards.some(card=>!card.result);
  const selected = state.cards.filter(card=>retry ? card.result?.status==='failed' : review || !pending || !card.result);
  if (!selected.length) return;
  const run = {retry};
  preparedAction = run;
  if (!review && !retry && !pending) { resetResults(); offerCache.clear(); catalogCache.clear(); }
  liveUnavailable='';
  const controller = new AbortController();
  const {signal} = controller;
  state.controller=controller; state.working=true; state.waiting='';
  render();
  try {
    const capture=review && state.mode==='capture' ? await loadReviewCapture() : null;
    for (let index=0;index<selected.length;index++) {
      const card = selected[index];
      signal.throwIfAborted();
      state.current=card.name || card.code || `Linha ${card.line || card.uid}`;
      if (review ? index>0 && index%200===0 : state.example || index%25===0) {
        renderProgress();
        await wait(review?0:state.example?72:16,signal);
      }
      try { card.result=await inspect(card,signal,state.mode,capture); }
      catch (error) {
        if (signal.aborted) throw error;
        card.result=classify(card,[],state.tolerance,'',error.message || 'Falha inesperada.');
      }
      if (!review) {
        renderProgress();
        queueRender();
        if ((index+1)%15===0) save();
      }
      if (state.mode==='live' && index+1<selected.length) await wait(120,signal);
    }
    preparedAction=null;
    return true;
  } catch (error) {
    if (!signal.aborted) notify(error.message || 'A análise foi interrompida.','error');
  } finally {
    state.working=false; state.controller=null; state.current=''; state.waiting='';
    save(); render();
  }
}
function totals() {
  const counts = {pending:0,competitive:0,adjust:0,missing:0,partial:0,failed:0};
  for (const card of state.cards) counts[card.result?.status || 'pending']++;
  const checked = counts.competitive+counts.adjust+counts.missing+counts.partial;
  return {...counts,checked,processed:checked+counts.failed,total:state.cards.length};
}
function renderProgress(counts=totals()) {
  const {processed,total,failed,pending}=counts;
  $('progress').max=total || 1;
  $('progress').value=processed;
  $('percent').textContent=`${total ? Math.round(processed/total*100) : 0}%`;
  $('processed').textContent=`${processed} de ${total} cartas processadas`;
  $('progress-caption').textContent=state.working ? (state.current ? `Verificando ${state.current}` : 'Iniciando análise…') : !total ? 'Importe uma lista ou carregue o exemplo para começar.' : !pending ? 'Lote concluído' : processed ? `${pending} cartas pendentes. A análise pode continuar.` : 'Lista pronta para análise.';
  $('retry').hidden=!failed || locked();
  $('run').textContent=processed && pending ? 'Continuar análise' : total && !pending ? 'Reanalisar lista' : 'Analisar lista';
  $('run-note').textContent=state.waiting || (state.working && state.mode==='live' && !liveUnavailable?'Mantenha esta aba aberta enquanto o lote consulta o MYP Cards.':'');
  $('run-note').hidden=!$('run-note').textContent;
}
function valueBounds() {
  const low=$('minimum').value.trim(), high=$('maximum').value.trim();
  const min=money(low), max=money(high);
  const valid=(!low||min!==null)&&(!high||max!==null)&&(min===null||max===null||min<=max);
  return {min,max,valid};
}
function resetFilters(draw=true) {
  $('search').value=''; $('status').value='all'; $('minimum').value=''; $('maximum').value='';
  state.page=1; state.sort=0;
  if (draw) renderTable();
}
function renderTable() {
  const {min,max,valid}=valueBounds(), query=norm($('search').value), status=$('status').value;
  $('filter-error').hidden=valid;
  $('one-real').setAttribute('aria-pressed',String(valid && max===100 && (min===null||min===0)));
  $('sort-price').closest('th').setAttribute('aria-sort',state.sort===1?'ascending':state.sort===-1?'descending':'none');
  $('sort-price').querySelector('span').textContent=state.sort===1?'↑':state.sort===-1?'↓':'↕';
  for (const filter of document.querySelectorAll('[data-status-filter]')) filter.setAttribute('aria-pressed',String(filter.dataset.statusFilter===status));
  visibleRows=valid ? state.cards.filter(card=>{
    if (query && !norm(listOf([card.name,card.altName,card.code,card.edition])).includes(query)) return false;
    const result=card.result?.status || 'pending';
    if (status==='unavailable' ? result!=='missing' && result!=='failed' : status!=='all' && result!==status) return false;
    if (min!==null && (card.price===null||card.price<min)) return false;
    return max===null || card.price!==null && card.price<=max;
  }) : [];
  if (state.sort==='review') {
    const excess=card=>card.result?.status==='adjust' ? card.price-card.result.limit : 0;
    visibleRows.sort((a,b)=>excess(b)-excess(a));
  } else if (state.sort) visibleRows.sort((a,b)=>{
    if (a.price===null) return b.price===null?0:1;
    if (b.price===null) return -1;
    return (a.price-b.price)*state.sort;
  });
  const pages=Math.max(1,Math.ceil(visibleRows.length/perPage));
  state.page=Math.min(state.page,pages);
  const start=(state.page-1)*perPage;
  const tbody=$('rows');
  const fragment=document.createDocumentFragment();
  for (const card of visibleRows.slice(start,start+perPage)) {
    const row=element('tr');
    const cell=element('td');
    cell.append(element('strong',card.name || card.code || `Linha ${card.line || card.uid}`),element('small',listOf([card.code,card.edition,card.rarity,card.printing,`${card.quantity || '—'} un.`])));
    const quality=element('td',card.condition || '—');
    if (card.language) quality.append(element('small',card.language));
    const ref=element('td',brl(card.result?.best),'money');
    if (card.result?.refs.length) {
      const date=Date.parse(card.result.refAt);
      const amount=`${card.result.refs.length} ${card.result.refs.length===1?'oferta comparável':'ofertas comparáveis'}`;
      ref.append(element('small',listOf([amount,Number.isFinite(date)?referenceDay.format(date):''])));
    }
    if (card.result?.partial) {
      const coverage=card.result.offerCoverage;
      if (coverage) ref.append(element('small',`${coverage.read} de ${coverage.expected} do produto`));
      else if (card.result.status==='adjust') ref.append(element('small','Coleta parcial'));
    }
    const delta=card.result?.delta;
    const badge=element('td');
    const value=card.result?.status || 'pending';
    badge.append(element('span',labels[value],`badge ${value}`));
    if (card.result?.reason) badge.title=card.result.reason;
    const suggestion=suggestedPrice(card);
    const proposed=element('td',brl(suggestion),'money suggested');
    if (suggestion!==null && card.result.partial) proposed.append(element('small','Provisório'));
    const action=element('td');
    if (suggestion!==null && suggestion!==card.price) {
      const prepare=element('button','Preparar atualização','text-button prepare-price');
      prepare.type='button'; prepare.dataset.prepare=card.uid;
      prepare.setAttribute('aria-label',`Preparar atualização de ${card.name || card.code}`);
      action.append(prepare);
    }
    const rowActions=element('div',undefined,'reference-actions');
    const button=element('button','Detalhes','text-button');
    button.type='button'; button.dataset.card=card.uid;
    button.setAttribute('aria-label',`Detalhes de ${card.name || card.code || `linha ${card.line || card.uid}`}`);
    rowActions.append(button);
    if (rowProduct(card)) {
      const query=element('button','Consultar referência','text-button');
      query.type='button';query.dataset.reference=card.uid;
      query.title='Consulta a primeira página de ofertas e usa referências salvas se o MYP limitar a consulta.';
      query.disabled=locked()||Boolean(browserSync || pendingCapture || browserConnection && !browserConnection.ready);
      query.setAttribute('aria-label',`Consultar referência de ${card.name || card.code || `linha ${card.uid}`}`);
      rowActions.append(query);
      if (needsOfferCollection(card)) {
        const full=element('button','Completar carta','text-button');
        full.type='button';full.dataset.reference=card.uid;full.dataset.complete='true';
        full.title='Lê todas as páginas do produto e atualiza as raridades cadastradas na pasta.';
        full.disabled=query.disabled;
        full.setAttribute('aria-label',`Completar coleta de ${card.name || card.code || card.uid}`);
        rowActions.append(full);
      }
    }
    action.append(rowActions);
    row.append(cell,quality,element('td',brl(card.price),'money'),ref,element('td',brl(card.result?.average),'money'),element('td',brl(card.result?.limit),'money'),element('td',delta>0?`+${brl(delta)}`:brl(delta),'money'),badge,proposed,action);
    fragment.append(row);
  }
  tbody.replaceChildren(fragment);
  $('empty').hidden=visibleRows.length>0;
  $('empty').querySelector('strong').textContent=state.cards.length?'Nenhum resultado nesta seleção':'Sua lista aparece aqui';
  $('empty').querySelector('p').textContent=state.cards.length?'Ajuste os filtros para voltar a ver suas cartas.':'Importe sua pasta ou carregue o exemplo para explorar.';
  $('shown').textContent=visibleRows.length?`${start+1}–${Math.min(start+perPage,visibleRows.length)} de ${visibleRows.length} itens${visibleRows.length!==state.cards.length?` · ${state.cards.length} na pasta`:''}`:'0 itens';
  $('pagination').hidden=pages<=1;
  $('page-number').textContent=`${state.page} de ${pages}`;
  $('previous').disabled=state.page<=1; $('next').disabled=state.page>=pages;
  $('export').disabled=!visibleRows.length;
  $('export').title='Baixa todos os resultados da seleção atual.';
  if ($('market-panel').open) renderMarketTable();
}
function render() {
  const count=totals();
  updateControls(); renderProgress(count); renderTable();
  for (const [id,value] of Object.entries({total:count.total,good:count.competitive,adjust:count.adjust,'no-ref':count.missing+count.failed,partial:count.partial})) $(`stat-${id}`).textContent=value;
  const withRefs=state.cards.filter(card=>card.result?.refs.length);
  const dates=withRefs.map(card=>Date.parse(card.result.refAt)).filter(Number.isFinite);
  const referencePeriod=dates.length ? `Ofertas do MYP coletadas em ${referenceDay.formatRange(Math.min(...dates),Math.max(...dates))}` : '';
  $('result-summary').textContent=count.total ? listOf([`${withRefs.length} com referência`,count.pending?`${count.pending} pendentes`:'',state.example?'Exemplo fictício':referencePeriod,state.sort==='review' && count.adjust?'Maiores excessos sobre o teto primeiro':'']) : 'O resumo da análise aparece aqui.';
  $('import-meta').textContent=`${state.cards.length} cartas na pasta · ${state.refs.length} referências importadas${state.refIssues.length?` · ${state.refIssues.length} referências inválidas`:''}`;
}
function queueRender() {
  if (renderFrame) return;
  renderFrame=requestAnimationFrame(()=>{renderFrame=0;render();});
}

function copyCsv(filename,rows) {
  const blob = new Blob([csv(rows)],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href=url; anchor.download=filename;
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function exportResults() {
  copyCsv('comparador-myp-resultados.csv',[
    ['Carta','Código','Edição','Condição','Idioma','Raridade','Impressão','Quantidade','Meu preço','Menor referência','Média das ofertas','Média de vendas concluídas','Preço sugerido','Sugestão provisória','Teto com tolerância','Tolerância (%)','Diferença para o menor','Situação','Motivo','Total de ofertas','Referências (fonte, vendedor e preço)','Origem da consulta','Ofertas pesquisadas em','Analisado em','URL','ID MYP'],
    ...visibleRows.map(card=>{
      const result=card.result;
      const suggestion=suggestedPrice(card);
      return [card.name,card.code,card.edition,card.condition,card.language,card.rarity,card.printing,card.quantity,decimal(card.price),decimal(result?.best),decimal(result?.average),decimal(card.soldAverage),decimal(suggestion),suggestion!==null && result.partial?'Sim':'',decimal(result?.limit),result ? String(result.tolerance).replace('.',',') : '',decimal(result?.delta),labels[result?.status || 'pending'],result?.reason,result?.refs.length,result?.refs.map(ref=>`${listOf([ref.source,ref.seller])} ${brl(ref.price)}`).join(' | '),result?.refSource,result?.refAt,result?.checkedAt,result?.productUrl || card.url,card.productId];
    })
  ]);
}
function templateOwn() {
  copyCsv('modelo-pasta-myp.csv',[
    ['Carta','Código','Edição','Condição','Idioma','Meu preço','Quantidade','Raridade','Impressão','URL','ID MYP','Média de vendas concluídas'],
    ['Guardião de Exemplo','DEMO-001','DEMO','NM','PT','0,75','1','Common','1st','','','']
  ]);
}
function templateRef() {
  copyCsv('modelo-referencias-myp.csv',[
    ['Carta','Código','Edição','Condição','Idioma','Preço referência','Fonte','Vendedor','Raridade','Impressão','URL','ID MYP'],
    ['Guardião de Exemplo','DEMO-001','DEMO','NM','PT','0,95','MYP Cards','outra-loja','Common','1st','','']
  ]);
}
function safeLink(url) {
  try {
    const target = new URL(url);
    return ['http:','https:'].includes(target.protocol) && !target.username && !target.password ? target.href : '';
  } catch { return ''; }
}
function openPricePreparation(card) {
  const suggestion=suggestedPrice(card);
  if (suggestion===null) return;
  $('prepare-name').textContent=card.name || card.code;
  $('prepare-variant').textContent=listOf([card.code,card.edition,card.condition,card.language,card.rarity,card.printing,card.stockId ? `Anúncio ${card.stockId}`:'']);
  $('prepare-current').textContent=brl(card.price);
  $('prepare-suggestion').textContent=brl(suggestion);
  $('prepare-money').value=decimal(suggestion);
  $('prepare-copy-status').textContent='';
  $('prepare-partial').hidden=!card.result.partial;
  const limit=$('prepare-limit');
  limit.hidden=!(suggestion>card.result.limit);
  limit.textContent=limit.hidden?'':`A sugestão está acima do teto de ${brl(card.result.limit)} com a tolerância atual.`;
  const url=safeLink(card.result.productUrl || card.url);
  const linkId=url && /^https:\/\/(?:www\.)?mypcards\.com\/yugioh\/produto\/(\d+)(?:[/?#]|$)/i.exec(url)?.[1];
  const isMypProduct=linkId && (!card.productId || card.productId===linkId);
  $('prepare-myp').href=isMypProduct ? url : 'https://mypcards.com/cadastromultiplo';
  $('prepare-myp').textContent=isMypProduct ? 'Abrir carta no MYP Cards' : 'Abrir cadastro no MYP Cards';
  $('price-preparation').showModal();
}
async function copySuggestion() {
  const field=$('prepare-money');
  try {
    await navigator.clipboard.writeText(field.value);
    $('prepare-copy-status').textContent='Valor copiado. Cole no campo de preço no MYP Cards.';
  } catch {
    field.focus(); field.select();
    $('prepare-copy-status').textContent='Valor selecionado. Pressione Ctrl+C para copiar.';
  }
}
function openDetail(card) {
  activeCard=card;
  $('detail-title').textContent=card.name || card.code || `Linha ${card.line || card.uid}`;
  $('detail-subtitle').textContent=listOf([card.code,card.edition,card.condition,card.language]);
  const message=$('detail-message');
  const result=card.result;
  message.textContent=listOf([labels[result?.status||'pending'],result?.reason || card.issue]);
  if (result?.refAt) message.append(element('br'),document.createTextNode(listOf([result.refSource,referenceDate.format(new Date(result.refAt))])));
  const url=safeLink(result?.productUrl || card.url);
  if (url) {
    const link=element('a','Ver carta no MYP Cards'); link.href=url; link.target='_blank'; link.rel='noopener noreferrer';
    message.append(element('br'),link);
  }
  const refs=$('detail-refs');
  refs.replaceChildren();
  if (result?.refs.length) {
    refs.append(element('p',listOf([`Menor ${brl(result.best)}`,`Média das ofertas ${brl(result.average)}`,`Teto ${brl(result.limit)} (${result.tolerance}%)`,`Sugestão ${brl(suggestedPrice(card))}`]),'detail-totals'));
    refs.append(element('strong',`Referências encontradas (${result.refs.length})`));
    const list=element('ul');
    for (const ref of result.refs) {
      const item=element('li',listOf([brl(ref.price),ref.seller,ref.source,ref.condition,ref.language,ref.rarity,ref.printing]),'detail-reference');
      const target=safeLink(ref.url);
      if (target) {
        const link=element('a','Ver fonte');link.href=target;link.target='_blank';link.rel='noopener noreferrer';
        item.append(' · ',link);
      }
      list.append(item);
    }
    refs.append(list);
  }
  const form=$('detail-form');
  for (const field of ['code','edition','condition','language','rarity','printing']) form.elements[field].value=card[field] || '';
  form.elements.price.value=decimal(card.price);
  form.elements.soldAverage.value=decimal(card.soldAverage);
  form.elements.quantity.value=card.quantity || 1;
  form.querySelector('fieldset').disabled=locked();
  form.querySelector('[type=submit]').disabled=locked();
  $('detail-error').textContent='Informe um preço válido em reais.';
  $('detail-error').hidden=true;
  $('detail').showModal();
}
function saveDetail(event) {
  event.preventDefault();
  if (!activeCard || locked()) return;
  const form=event.currentTarget, data=new FormData(form);
  const price=money(data.get('price'));
  const rawSold=clean(data.get('soldAverage')), soldAverage=money(rawSold);
  if (price===null || rawSold && !(soldAverage>0)) {
    $('detail-error').textContent=price===null?'Informe um preço válido em reais.':'Informe uma média de vendas concluídas válida e maior que zero.';
    $('detail-error').hidden=false; return;
  }
  const edits=Object.fromEntries(['code','edition','condition','language','rarity','printing'].map(field=>[field,clean(data.get(field))]));
  if (!activeCard.name && !edits.code && !activeCard.productId) {
    $('detail-error').textContent='Informe o código da carta.'; $('detail-error').hidden=false; return;
  }
  $('detail-error').textContent='Informe um preço válido em reais.';
  edits.condition=edits.condition.toUpperCase(); edits.language=language(edits.language);
  const sameReference=Object.keys(edits).every(field=>edits[field]===(activeCard[field]||''));
  const result=sameReference && !activeCard.issue && activeCard.result ? applyTolerance(activeCard.result,price,state.tolerance) : null;
  Object.assign(activeCard,{...edits,price,soldAverage,quantity:Number(data.get('quantity')) || 1,issue:'',result});
  preparedAction=null;
  $('detail').close();
  render(); save();
  notify(result?'Dados salvos e comparação recalculada.':'Dados salvos. Continue a análise para recalcular essa carta.','success');
}
function changeSettings() {
  if (locked()) return;
  const tolerance=Math.max(0,Math.min(100,Number($('tolerance').value) || 0));
  const seller=$('seller').value.trim(), mode=$('mode').value;
  $('tolerance').value=tolerance;
  if (state.tolerance===tolerance && seller===state.seller && mode===state.mode) return;
  const changedSource = seller!==state.seller || mode!==state.mode;
  state.tolerance=tolerance; state.seller=seller; state.mode=mode;
  if (changedSource) {
    preparedAction=null;
    liveUnavailable='';
    resetResults();
  } else {
    for (const card of state.cards) if (card.result) card.result=applyTolerance(card.result,card.price,tolerance);
  }
  render(); save();
}
for (const tab of document.querySelectorAll('[role=tab]')) {
  tab.addEventListener('click',()=>setTab(tab));
  tab.addEventListener('keydown',event=>{
    const tabs=[...document.querySelectorAll('[role=tab]')];
    const index=tabs.indexOf(tab);
    const keys={Home:0,End:tabs.length-1,ArrowLeft:(index+tabs.length-1)%tabs.length,ArrowRight:(index+1)%tabs.length};
    if (!Object.hasOwn(keys,event.key)) return;
    event.preventDefault(); setTab(tabs[keys[event.key]],true);
  });
}
for (const [id,action] of Object.entries({'load-store':()=>startStore(),'load-snapshot':loadSnapshot,'retry-store':()=>startStore(true),'use-partial':()=>finishStore(true),sample:loadExample,'load-paste':()=>loadInventory($('paste').value),'load-refs':()=>loadReferences($('reference-paste').value),run:()=>analyze(preparedAction?.retry || false),retry:()=>analyze(true),stop:()=>state.controller?.abort(),'template-own':templateOwn,'template-file':templateOwn,'template-ref':templateRef,export:exportResults,'reset-filters':()=>resetFilters(),'close-detail':()=>$('detail').close()})) $(id).addEventListener('click',action);
for (const [id,action] of [['own-file',loadInventory],['ref-file',loadReferences]]) $(id).addEventListener('change',async event=>{
  const file=event.target.files[0];
  try { const text=await fileText(file); if (text!==null) action(text,file.name); }
  catch (error) { notify(error.message || 'Não foi possível ler o arquivo.','error'); }
  finally { event.target.value=''; }
});
for (const id of ['mode','seller','tolerance']) $(id).addEventListener('change',changeSettings);
for (const id of ['search','minimum','maximum','status']) $(id).addEventListener('input',()=>{state.page=1;renderTable();});
for (const filter of document.querySelectorAll('[data-status-filter]')) filter.addEventListener('click',()=>{
  $('status').value=filter.dataset.statusFilter;state.page=1;renderTable();
});
$('review-prices').addEventListener('click',reviewPrices);
$('one-real').addEventListener('click',()=>{
  const active=$('one-real').getAttribute('aria-pressed')==='true';
  $('minimum').value=''; $('maximum').value=active?'':'1,00';
  state.page=1; renderTable();
});
$('sort-price').addEventListener('click',()=>{state.sort=state.sort===1?-1:1;state.page=1;renderTable();});
$('previous').addEventListener('click',()=>{state.page--;renderTable();});
$('next').addEventListener('click',()=>{state.page++;renderTable();});
$('rows').addEventListener('click',event=>{
  const query=event.target.closest('button[data-reference]');
  if (query) {
    const card=state.cards.find(card=>card.uid===Number(query.dataset.reference));
    if (card) startBrowserSync(card,{complete:query.dataset.complete==='true'});
    return;
  }
  const prepare=event.target.closest('button[data-prepare]');
  if (prepare) { openPricePreparation(state.cards.find(card=>card.uid===Number(prepare.dataset.prepare))); return; }
  const button=event.target.closest('button[data-card]');
  if (button) openDetail(state.cards.find(card=>card.uid===Number(button.dataset.card)));
});
$('detail-form').addEventListener('submit',saveDetail);
$('detail').addEventListener('close',()=>{activeCard=null;});
$('capture-file').addEventListener('change',importMarketCapture);
$('sync-scope').addEventListener('change',()=>{$('sync-url-panel').hidden=$('sync-scope').value!=='refs';});
$('connect-myp').addEventListener('click',connectToMyp);
$('start-myp-sync').addEventListener('click',()=>startBrowserSync());
$('fill-references').addEventListener('click',()=>startBrowserSync(null,{fillMissing:true}));
$('market-panel').addEventListener('toggle',()=>{if ($('market-panel').open) renderMarketTable();});
$('run-market').addEventListener('click',startMarketReview);
$('stop-market').addEventListener('click',()=>marketController?.abort());
$('stop-myp-sync').addEventListener('click',stopBrowserSync);
$('stop-reference-sync').addEventListener('click',stopBrowserSync);
$('apply-myp-sync').addEventListener('click',applyBrowserCapture);
$('myp-bookmark-setup').addEventListener('toggle',()=>{if ($('myp-bookmark-setup').open && !bookmarkSource) void setBookmark();});
$('myp-bookmark').addEventListener('click',event=>{
  event.preventDefault();
  $('myp-bookmark-status').textContent='Arraste o favorito para a barra do Chrome e clique nele somente na aba da vitrine do MYP.';
});
$('copy-myp-bookmark').addEventListener('click',async()=>{
  const status=$('myp-bookmark-status');
  try {
    await navigator.clipboard.writeText(bookmarkSource);
    status.textContent='Endereço copiado. Cole no campo URL de um novo favorito do Chrome.';
  } catch {status.textContent='A área de transferência não está disponível. Arraste o link para a barra de favoritos.';}
});
window.addEventListener('message',receiveBrowserSync);
$('check-myp').addEventListener('click',checkMyp);
$('prepare-copy').addEventListener('click',copySuggestion);
window.addEventListener('hashchange',highlightNav);
window.addEventListener('pagehide',save);
settingsFromState(); highlightNav(); render();
