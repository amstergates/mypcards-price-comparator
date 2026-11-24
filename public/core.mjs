export const labels = {pending:'Pendente',competitive:'Competitiva',adjust:'Ajustar preço',missing:'Sem referência',partial:'Coleta parcial',failed:'Falha'};
export const clean = value => String(value ?? '').trim();
export const norm = value => clean(value).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ');
export function codeKey(value) {
  return norm(value).replace(/^yugioh[_-]/,'').replace(/_/g,'-').replace(/^(.+)-(?:en|pt)(\d+)$/,'$1-$2');
}
export function language(value) {
  const key = norm(value);
  const aliases = {pt:'PT','pt-br':'PT',br:'PT',portugues:'PT',portuguese:'PT',en:'EN',ingles:'EN',english:'EN','en-us':'EN',es:'ES',espanhol:'ES',spanish:'ES',jp:'JA',ja:'JA',japones:'JA',japanese:'JA'};
  return aliases[key] || clean(value);
}
export function variant(value) {
  const key = norm(value);
  const aliases = {'rara secreta':'secret rare','ultra rara':'ultra rare','rara ultra':'ultra rare','super rara':'super rare','rara super':'super rare',comum:'common',normal:'common',rara:'rare','1ª edicao':'1st','first edition':'1st','edicao ilimitada':'unlimited',ilimitada:'unlimited','platinum secret rares':'platinum secret rare'};
  return aliases[key] || key;
}
export function money(value) {
  const input = clean(value).replace(/^R\$\s*/i,'').replace(/\s/g,'');
  if (!input) return null;
  let normalized = input;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(input)) normalized = input.replaceAll('.','').replace(',','.');
  else if (/^\d+(?:[.,]\d{1,2})?$/.test(input)) normalized = input.replace(',','.');
  else return null;
  const [reais, centavos = ''] = normalized.split('.');
  const cents = Number(reais) * 100 + Number(centavos.padEnd(2,'0'));
  return Number.isSafeInteger(cents) && cents <= 100000000000 ? cents : null;
}
const names = {
  name:['carta','nome','name','card','nome da carta'], code:['codigo','code','card code','numero'], edition:['edicao','edition','set','colecao'],
  condition:['condicao','condition','estado','qualidade'], language:['idioma','language'], price:['meu preco','preco','price','preco unitario','preco da pasta'],
  refPrice:['preco referencia','preco de referencia','referencia','reference price','menor referencia'],
  soldAverage:['media de vendas concluidas','media de vendas realizadas','preco medio de vendas realizadas'],
  source:['fonte','source'], seller:['vendedor','seller','loja'], quantity:['quantidade','qty','quantity','qtd'], url:['url','link','url myp'],
  rarity:['raridade','rarity'], printing:['impressao','printing','tiragem'], productId:['id myp','id do produto','produto id','product id','internal code']
};
const headerKey = value => norm(value).replace(/[_-]+/g,' ').replace(/[()]/g,'').trim();
const aliases = new Map(Object.entries(names).flatMap(([field, values]) => values.map(value => [value, field])));
function records(text, delimiter) {
  const list = [];
  let cells = [], cell = '', quoted = false, startLine = 1, line = 1;
  for (let pos=0; pos<text.length; pos++) {
    const char = text[pos];
    if (char === '"' && (quoted || cell === '')) {
      if (quoted && text[pos+1] === '"') { cell += '"'; pos++; }
      else quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      cells.push(cell); cell = '';
    } else if (char === '\n') {
      if (quoted) cell += '\n';
      else { list.push({cells:[...cells,cell], line:startLine}); cells = []; cell = ''; startLine = line+1; }
      line++;
    } else cell += char;
  }
  if (cell || cells.length || quoted) list.push({cells:[...cells,cell], line:startLine, malformed:quoted});
  return list.filter(row => row.malformed || row.cells.some(clean));
}
export function parseList(source, reference = false) {
  const text = source.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const start = text.split('\n').find(line => line.trim()) || '';
  const delimiter = ['\t',';',','].find(sep => {
    const cells = records(start,sep)[0]?.cells || [];
    return cells.length > 1 && (sep !== ',' || cells.filter(cell => aliases.has(headerKey(cell))).length >= 2 || /^\s*"/.test(start));
  }) || '\0';
  const input = records(text,delimiter);
  if (!input.length) return [];
  const headers = input[0].cells.map(cell => aliases.get(headerKey(cell)));
  const hasHeader = headers.some(x => x === 'name' || x === 'code' || x === 'productId') && (headers.filter(Boolean).length >= 2 || input[0].cells.length === 1);
  const fields = hasHeader ? headers : ['name','code','condition','language',reference?'refPrice':'price',...(reference?['source','seller']:['quantity','edition','rarity','printing'])];
  return input.slice(hasHeader ? 1 : 0).map(({cells,line,malformed}) => {
    const raw = Object.fromEntries(fields.map((field,index) => [field,clean(cells[index])]));
    if (!hasHeader && cells.length === 1 && !reference) {
      const deck = raw.name.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\[([^\]]+)\])?(?:\s+([A-Z0-9_]+-[A-Z]*\d+))?$/i);
      if (deck) Object.assign(raw,{quantity:deck[1],name:deck[2],edition:deck[3],code:deck[4]});
    }
    const rawPrice = reference ? raw.refPrice || raw.price : raw.price;
    const price = money(rawPrice);
    const soldAverage = money(raw.soldAverage);
    const rawQty = clean(raw.quantity);
    const quantity = rawQty === '' ? 1 : Number(rawQty);
    const product = clean(raw.productId) || /^https?:\/\/(?:www\.)?mypcards\.com\/yugioh\/produto\/(\d+)(?:\/|$|[?#])/i.exec(raw.url || '')?.[1] || '';
    let issue = '';
    if (malformed) issue = 'Campo entre aspas ficou sem fechamento.';
    else if ((!hasHeader && delimiter !== '\0' && cells.length > fields.length) || (hasHeader && cells.length > fields.length)) issue = 'Há mais campos que colunas. Coloque os nomes que contêm o separador entre aspas.';
    else if (!raw.name && !raw.code && !product) issue = 'Nome, código ou ID do produto ausente.';
    else if (price === null) issue = rawPrice ? 'Preço inválido. Informe um valor em reais.' : 'Preço ausente.';
    else if (!reference && raw.soldAverage && !(soldAverage>0)) issue = 'Média de vendas concluídas inválida.';
    else if (!Number.isSafeInteger(quantity) || quantity < 1) issue = 'Quantidade inválida.';
    return {...raw, name:clean(raw.name), code:clean(raw.code), edition:clean(raw.edition), condition:clean(raw.condition).toUpperCase(),language:language(raw.language),rarity:clean(raw.rarity),printing:clean(raw.printing),source:clean(raw.source),seller:clean(raw.seller),productId:/^\d{1,10}$/.test(product)?product:'',price,soldAverage,quantity,line,issue};
  });
}
export function identityMatches(card, ref) {
  if (card.productId && ref.productId) return card.productId === ref.productId;
  if (card.code && ref.code) return codeKey(card.code) === codeKey(ref.code) && (!card.edition || !ref.edition || norm(card.edition) === norm(ref.edition));
  return Boolean(card.name && ref.name && card.edition && ref.edition && norm(card.edition) === norm(ref.edition) && [card.name,card.altName].some(name=>norm(name)===norm(ref.name)));
}
export function compatible(card, ref, seller) {
  return (!seller || norm(ref.seller) !== norm(seller)) &&
    norm(card.condition) === norm(ref.condition) && Boolean(card.condition) &&
    norm(language(card.language)) === norm(language(ref.language)) && Boolean(card.language) &&
    (!card.rarity || variant(card.rarity) === variant(ref.rarity)) &&
    (!card.printing || variant(card.printing) === variant(ref.printing)) &&
    (card.origin !== 'store' || variant(card.printing) === variant(ref.printing));
}
export function applyTolerance(result, price, tolerance) {
  const {best} = result;
  const cents = Math.round(tolerance * 100);
  const limit = best === null ? null : Math.floor(best * (10000 + cents) / 10000);
  const delta = best === null ? null : price-best;
  let status = result.status;
  if (status !== 'failed') {
    if (best !== null && price > limit) status = 'adjust';
    else if (result.partial) status = 'partial';
    else status = best === null ? 'missing' : 'competitive';
  }
  return {...result,delta,limit,tolerance,status};
}
export function classify(card, references, tolerance, explanation = '', error = '') {
  const ordered = [...references].sort((a,b)=>a.price-b.price);
  const best = ordered[0]?.price ?? null;
  const average = ordered.length ? Math.round(ordered.reduce((sum,ref)=>sum+ref.price,0)/ordered.length) : null;
  const result = {refs:ordered,best,average,reason:error || explanation,checkedAt:new Date().toISOString(),status:error?'failed':'missing'};
  return applyTolerance(result,card.price,tolerance);
}
export function suggestedPrice(card) {
  const result = card.result;
  if (!card.condition || result?.status==='failed' || !Number.isSafeInteger(result?.best) || !Number.isSafeInteger(result?.average)) return null;
  const sold = card.soldAverage;
  if (Number.isSafeInteger(sold) && sold>0) return Math.round((45*result.best + 30*result.average + 25*sold)/100);
  return Math.round((60*result.best + 40*result.average)/100);
}
export function csv(rows) {
  return '\uFEFF'+rows.map(row=>row.map(value=>{
    const raw = String(value ?? '');
    const safe = typeof value === 'string' && /^\s*[=+\-@\t\r]/.test(raw) && !/^-\d+(?:,\d+)?$/.test(raw) ? "'"+raw : raw;
    return /[;"\r\n]/.test(safe) ? '"'+safe.replaceAll('"','""')+'"' : safe;
  }).join(';')).join('\r\n');
}
export function storefrontSeller(value) {
  try {
    const url = new URL(clean(value));
    if (url.protocol !== 'https:' || !['mypcards.com','www.mypcards.com'].includes(url.hostname) || url.username || url.password || url.port) return '';
    const match = /^\/([\p{L}\p{N}_.-]{2,75})(?:\/yugioh)?\/?$/u.exec(decodeURIComponent(url.pathname));
    return match?.[1] === 'yugioh' ? '' : match?.[1] || '';
  } catch { return ''; }
}
export function mypProductUrl(value) {
  try {
    const url = new URL(clean(value));
    const match = /^\/yugioh\/produto\/(\d{1,10})(?:\/([a-z0-9_-]+))?\/?$/i.exec(url.pathname);
    if (!match || url.protocol!=='https:' || !['mypcards.com','www.mypcards.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
    return {productId:match[1],url:`https://mypcards.com${url.pathname}`};
  } catch { return null; }
}
export function isCompleteOfferCollection(product) {
  return Array.isArray(product?.offers) && product.offers.length===product.expected && !product.warning;
}
export function mergeMypCaptures(previous, update) {
  const products={...previous?.products};
  for (const [id,incoming] of Object.entries(update.products)) {
    const old=products[id];
    if (isCompleteOfferCollection(old) && !isCompleteOfferCollection(incoming)) continue;
    products[id]=incoming.error && Array.isArray(old?.offers)
      ? {...old,warning:`A última atualização falhou. Ofertas anteriores preservadas. ${incoming.error}`}
      : incoming;
  }
  return {...previous,...update,storeRows:update.completeStore?update.storeRows:previous?.storeRows || [],products};
}
