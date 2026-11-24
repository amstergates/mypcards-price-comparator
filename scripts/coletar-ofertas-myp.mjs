import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

// The build includes the same parsing functions used by the comparador.
const seller = storefrontSeller(process.argv[2]);
if (!seller) {
  console.error('Uso: node coletar-ofertas-myp.mjs https://mypcards.com/seu-usuario/yugioh');
  process.exit(1);
}
const target = 'coleta-myp-ofertas.json';
const marketOrigin = 'https://mypcards.com';
let nextRequest = 0;
let blocked = false;
async function readPage(path, attempt = 0) {
  const url = new URL(path,marketOrigin);
  if (url.origin!==marketOrigin) throw new Error('Link fora do MYP Cards.');
  const slot = Math.max(Date.now(),nextRequest);
  nextRequest = slot + 600;
  await delay(Math.max(0,slot-Date.now()));
  if (blocked) throw new Error('Coleta interrompida pelo HTTP 403 do MYP Cards.');
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),18000);
  let response;
  try { response=await fetch(url,{redirect:'manual',signal:controller.signal}); }
  finally { clearTimeout(timeout); }
  if (response.status===403) blocked=true;
  if (response.status===429 && attempt===0) {
    const seconds = Math.max(1,Number(response.headers.get('Retry-After'))||60);
    nextRequest = Math.max(nextRequest,Date.now()+seconds*1000);
    console.log(`Limite do MYP Cards. Aguardando ${seconds} segundos.`);
    return readPage(path,1);
  }
  if (!response.ok) throw new Error(`MYP Cards respondeu HTTP ${response.status}.`);
  return response.text();
}
async function readOffers(card) {
  const first = parseOffers(await readPage(card.url));
  const found = new Map(first.rows.map(offer=>[offer.stockId,offer]));
  let warning = '';
  for (let i=2;i<=Math.max(first.certPages,first.otherPages);i++) {
    const cert = Math.min(i,first.certPages), other = Math.min(i,first.otherPages);
    try {
      const data = parseOffers(await readPage(`${card.url}?estoque-cert-page=${cert}&per-page=10&estoque-outros-page=${other}&dp-1-per-page=10`));
      if (data.count!==first.count) { warning='A contagem mudou durante a consulta.'; break; }
      for (const offer of data.rows) found.set(offer.stockId,offer);
    } catch (error) { warning=error.message; break; }
  }
  return {offers:[...found.values()],expected:Math.max(first.count,found.size),warning,checkedAt:new Date().toISOString()};
}
async function collect() {
  const own = new Map();
  const path = `/${encodeURIComponent(seller)}/yugioh`;
  let pages = 1;
  let total;
  for(let i=1;i<=pages;i++){
    const data = parseStorefront(await readPage(`${path}${i>1?`?page=${i}`:''}`),i);
    if (total!==undefined && total!==data.total) throw new Error('A quantidade de cartas mudou. Rode novamente.');
    pages=data.pages; total=data.total;
    for (const card of data.rows) own.set(card.stockId,card);
    console.log(`Vitrine ${i}/${pages}. ${own.size} cartas.`);
  }
  if (!own.size || own.size!==total) throw new Error('Não foi possível carregar a vitrine inteira.');
  const catalog = [...new Map([...own.values()].filter(card=>card.productId && card.url).map(card=>[card.productId,card])).values()];
  const products = {};
  let index = 0, done = 0, incomplete = 0, failed = 0;
  async function lane() {
    while (index<catalog.length) {
      const {productId,name,altName,edition,code,url} = catalog[index++];
      let result;
      try {
        if (blocked) throw new Error('Coleta interrompida pelo HTTP 403 do MYP Cards.');
        result=await readOffers({url});
        if (result.warning || result.offers.length<result.expected) incomplete++;
      } catch (error) { failed++; result={checkedAt:new Date().toISOString(),error:error.message}; }
      products[productId]={productId,name,altName,edition,code,url,...result};
      console.log(`${++done}/${catalog.length} produtos. ${incomplete} parciais, ${failed} com falha.`);
    }
  }
  await Promise.all(Array.from({length:3},lane));
  await writeFile(target,JSON.stringify({seller,storeRows:[...own.values()],products,generatedAt:new Date().toISOString()}));
  console.log(`Arquivo salvo: ${target}. Importe o JSON no comparador.`);
}
try { await collect(); }
catch (error) { console.error(error.message); process.exitCode=1; }
