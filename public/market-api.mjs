import {codeKey, mypProductUrl, norm} from './core.mjs';

const marketLifetime=60*60*1000;
const textCode=/^[A-Za-z0-9_-]{1,100}$/;
const targetKey=({id,code,edition})=>id?`id:${id}`:`codigo:${codeKey(code)}:${norm(edition)}`;

export function marketTarget(card) {
  const id=mypProductUrl(card.url)?.productId || mypProductUrl(card.result?.productUrl)?.productId || card.productId;
  const code=textCode.test(card.code || '')?card.code:'';
  if (!/^\d{1,10}$/.test(id || '') && !code) return null;
  return {id:/^\d{1,10}$/.test(id || '')?String(id):'',code,edition:card.edition};
}

export function savedMarketPrice(cache,target) {
  return target && cache.products[targetKey(target)];
}

export function currentMarketPrice(cache,target,now=Date.now()) {
  const saved=savedMarketPrice(cache,target);
  return saved && now-saved.at<marketLifetime ? saved : null;
}

function matches(target,product) {
  return target.id ? target.id===product.id
    : codeKey(target.code)===codeKey(product.code) && (!target.edition || norm(target.edition)===norm(product.edition));
}

export async function collectMarketPrices(cards,cache,{query,save,progress,signal,now=Date.now}) {
  const targets=new Map();
  for (const card of cards) {
    const target=marketTarget(card);
    if (target) targets.set(targetKey(target),target);
  }
  const pending=new Map([...targets].filter(([,target])=>!currentMarketPrice(cache,target,now())));
  const initial=pending.size;
  const key=[...targets.keys()].sort().join('|');
  if (cache.scan?.key!==key || now()-cache.scan.at>=marketLifetime) cache.scan={key,page:1,active:true,at:now()};
  const report=()=>progress({total:targets.size,done:targets.size-pending.size,reused:targets.size-initial});
  const keep=(id,product)=>{cache.products[id]={product,at:now()};pending.delete(id);};
  report();
  while (pending.size>1 && cache.scan.active) {
    signal.throwIfAborted();
    const products=await query({page:cache.scan.page});
    let hits=0;
    for (const [id,target] of pending) {
      const found=products.filter(product=>matches(target,product));
      if (found.length!==1) continue;
      keep(id,found[0]);
      hits++;
    }
    cache.scan.page++;
    cache.scan.active=hits>=2;
    save();
    report();
  }
  for (const [id,target] of pending) {
    signal.throwIfAborted();
    const items=await query(target.id?{id:target.id}:{code:target.code});
    keep(id,items.find(product=>matches(target,product)) || null);
    save();
    report();
  }
}
