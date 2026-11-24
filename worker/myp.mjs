import {clean, language, money, storefrontSeller} from '../public/core.mjs';

const origin = 'https://mypcards.com';
const entities = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—'};
function decode(value = '') {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole,key) => {
    if (!key.startsWith('#')) return entities[key] || whole;
    const number = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
  });
}
const plain = value => decode((value || '').replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim();
function attr(html, key) {
  return decode(html.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`,'i'))?.[1]);
}
function content(html, tag, className) {
  return html.match(new RegExp(`<${tag}\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'))?.[1] || '';
}
function languageFrom(fragment) {
  const marker = fragment.match(/<span\b[^>]*class=["'][^"']*\bflag-icon\b[^"']*["'][^>]*>/i)?.[0] || '';
  return language(attr(marker,'title'));
}
const conditionFrom = fragment => fragment.match(/\b(NM|SP|MP|HP|DM)\s+-/i)?.[1]?.toUpperCase() || '';
const shownPrice = html => money(plain(html).match(/R\$\s*[\d.,]+/gi)?.at(-1));

export function parseStorefront(html, page = 1) {
  const list = html.match(/<ul\b[^>]*id=["']produtos-lista-principal["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1];
  const pagination = html.match(/new ProdutoScrollInfinito\([^,]+,\s*\{[^}]*\},\s*(\d+)\s*,\s*(\d+)\)/);
  const summary = html.match(/<strong>([\d.]+)<\/strong>\s*itens? encontrados?/i)?.[1];
  const heading = /id=["']titulo-cards["']/.test(html);
  const total = pagination ? Number(pagination[1]) : summary ? Number(summary.replaceAll('.','')) : list === '' || heading && /nenhum (item|produto) encontrado/i.test(plain(html)) ? 0 : null;
  const size = pagination ? Number(pagination[2]) : 30;
  if (total === null || !size || !heading || (total > 0 && list === undefined)) throw new Error('O formato da vitrine pública não pôde ser reconhecido.');
  const rows = [...(list || '').matchAll(/<li\b[^>]*data-key=["'](\d+)["'][^>]*>([\s\S]*?)<\/li>/gi)].map(([,stockId,part]) => {
    const link = attr(part.match(/<a\b[^>]*\bcard-img-link\b[^>]*>/i)?.[0] || '', 'href');
    const productId = /^\/yugioh\/produto\/(\d+)(?:\/|$)/.exec(link)?.[1] || '';
    const name = plain(part.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
    const price = shownPrice(part.match(/class="card-preco moeda"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    const quality = part.match(/class=["']card-qualidade["'][\s\S]*?<\/div>\s*(?:<span[^>]*>[\s\S]*?<\/span>)?\s*<\/div>/i)?.[0] || '';
    const raritySpans = [...quality.matchAll(/<span\s+title=["']([^"']+)["'][^>]*>/gi)];
    const quantity = Number(plain(content(part,'span','quantidade-num'))) || 1;
    const issue = !name || !productId || price === null ? 'Anúncio com dados incompletos na vitrine do MYP Cards.' : '';
    return {origin:'store',stockId,name,altName:plain(content(part,'span','nome-original')),edition:plain(content(part,'span','card-edicao')),code:attr(part,'data-ga-item-id').replace(/^yugioh_/i,'').toUpperCase(),productId,url:productId?origin+link:'',condition:conditionFrom(quality),language:languageFrom(quality),rarity:decode(raritySpans.at(-1)?.[1]),printing:plain(content(part,'span','card-printing')),price,quantity,issue};
  });
  if (!rows.length && page <= Math.ceil(total/size)) throw new Error('A página da vitrine veio vazia antes do fim da lista.');
  return {rows,total,page,pages:Math.ceil(total/size)};
}

export function parseOffers(html) {
  const tab = html.match(/<button\b[^>]*id=["']produto-abas-aba-ofertas["'][^>]*>([\s\S]*?)<\/button>/i)?.[1];
  const count = Number(tab?.match(/\(([\d.]+)\)/)?.[1].replaceAll('.','')) || 0;
  if (!tab && !/id=["']produto-abas["']/.test(html)) throw new Error('A página de ofertas do MYP Cards não pôde ser reconhecida.');
  const rows = [...html.matchAll(/<tr\b[^>]*data-key=["'](\d+)["'][^>]*>([\s\S]*?)<\/tr>/gi)].filter(([, ,part])=>/estoque-lista-nomevendedor/.test(part)).map(([,stockId,part]) => {
    const quality = content(part,'td','estoque-lista-qualidadenome');
    const rarityText = content(part,'td','estoque-lista-nomeenfoil');
    const seller = plain(content(part,'a','nome-vendedor-apelido'));
    const rarity = plain(rarityText.replace(/,\s*<n\b[\s\S]*?<\/n>/i,''));
    const printing = plain(rarityText.match(/<n\b[^>]*>([\s\S]*?)<\/n>/i)?.[1]);
    const price = shownPrice(content(part,'td','estoque-lista-precoestoque'));
    const quantity = Number(plain(content(part,'td','estoque-lista-quantidadeestoque')).match(/^\d+/)?.[0]);
    if (!seller || price === null || !Number.isSafeInteger(quantity)) throw new Error('Uma oferta do MYP veio com dados incompletos.');
    return {stockId,seller,rarity,printing,condition:conditionFrom(quality),language:languageFrom(quality),price,quantity,source:'MYP Cards'};
  }).filter(offer=>offer.quantity>0);
  if (count && !rows.length) throw new Error('O MYP informou ofertas, mas nenhuma apareceu na página.');
  const pages = type => Math.max(1,...[...html.matchAll(new RegExp(`estoque-${type}-page=(\\d+)`,'g'))].map(m=>Number(m[1])).filter(page=>Number.isSafeInteger(page)));
  const pageSize = type => {
    const href=[...html.matchAll(/href=["']([^"']+)["']/gi)].find(([,link])=>link.includes(`estoque-${type}-page=`))?.[1];
    return href ? /[?&]((?:dp-\d+-)?per-page)=(\d+)/.exec(decode(href))?.slice(1) || [] : [];
  };
  const [certSizeKey,certSize]=pageSize('cert'), [otherSizeKey,otherSize]=pageSize('outros');
  const slug = /<link\b[^>]*href=["']https:\/\/mypcards\.com\/yugioh\/produto\/\d+\/([a-z0-9_-]+)["'][^>]*rel=["']canonical["']/i.exec(html)?.[1] || '';
  return {rows,count,slug,certPages:pages('cert'),otherPages:pages('outros'),certSizeKey,certSize,otherSizeKey,otherSize};
}

export const reply = (value,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const invalid = error => reply({error},400);
async function requestMyp(path,type,token='') {
  const headers = {Accept:type};
  if (token && path.startsWith('/api/v1/')) headers['X-Api-Token']=token;
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),18000);
  try {
    return await fetch(origin+path,{headers,redirect:'manual',signal:controller.signal});
  } finally { clearTimeout(timeout); }
}
async function upstream(path,type,token) {
  let response;
  try {
    response = await requestMyp(path,type,token);
  } catch (error) {
    console.warn('MYP Cards upstream',error.name);
    return {error:reply({error:'O MYP Cards não respondeu à consulta. Tente novamente ou use a importação por arquivo.'},502)};
  }
  if (!response.ok) {
    if (response.status === 429) {
      const header=response.headers.get('Retry-After');
      const seconds=/^\d+$/.test(header || '') ? Number(header) : (Date.parse(header)-Date.now())/1000;
      const retryAfter=Number.isFinite(seconds) ? Math.max(1,Math.ceil(seconds)) : 60;
      return {error:reply({error:'O MYP Cards limitou as consultas temporariamente.',retryAfter},429)};
    }
    if (response.status === 404) return {error:reply({error:'O MYP Cards não encontrou a página consultada.'},404)};
    return {error:reply({error:`O MYP Cards respondeu HTTP ${response.status}. Você pode usar as ofertas coletadas.`,upstreamStatus:response.status},502)};
  }
  if (!(response.headers.get('content-type') || '').includes(type)) return {error:reply({error:'O MYP Cards retornou um formato inesperado.'},502)};
  return {response};
}

export async function connectionStatus(path,type,token) {
  let response;
  try { response=await requestMyp(path,type,token); }
  catch { return {status:null,kind:'network'}; }
  const contentType = (response.headers.get('content-type') || '').split(';')[0];
  const rateLimit = Number(response.headers.get('x-rate-limit-limit')) || null;
  const status = response.status;
  let kind = response.ok ? 'ok' : 'http';
  let provider = '';
  if (response.headers.get('cf-mitigated')==='challenge') { kind='challenge'; provider='Cloudflare'; }
  else if ([401,403].includes(status)) {
    const body = response.body?.getReader();
    const sample = await body?.read().catch(()=>null);
    const prefix = sample?.value ? new TextDecoder().decode(sample.value.slice(0,8192)) : '';
    void body?.cancel().catch(()=>{});
    if (/\bcf-chl-\w+|\bCloudflare Ray ID\b|\bError (?:1010|1020)\b/i.test(prefix)) { kind='edge-denial'; provider='Cloudflare'; }
    else kind=contentType.includes('json') ? 'api-denial' : 'html-denial';
    return {status,kind,provider,rateLimit};
  }
  void response.body?.cancel().catch(()=>{});
  if (response.ok && !contentType.includes(type)) kind='format';
  return {status,kind,provider,rateLimit};
}

export async function api(url,env={}) {
  const query = url.searchParams;
  const token = /^[!-~]{1,512}$/.test(env.MYP_API_TOKEN || '') ? env.MYP_API_TOKEN : '';
  if (url.pathname === '/api/precos-publicos') {
    const id=query.get('id'), code=query.get('code'), page=query.get('page');
    if ([id,code,page].filter(value=>value!==null).length!==1 ||
        id!==null && !/^\d{1,10}$/.test(id) ||
        code!==null && !/^[A-Za-z0-9_-]{1,100}$/.test(code) ||
        page!==null && !/^[1-9]\d{0,4}$/.test(page)) return invalid('Informe apenas o ID, o código ou a página do catálogo.');
    const path=page!==null ? `/yugioh/precos?page_number=${page}&page_size=50`
      : id!==null ? `/produto/${id}` : `/yugioh/precos/${encodeURIComponent(btoa(code))}`;
    const result=await upstream('/api/v1'+path,'application/json');
    if (result.error) return result.error;
    const data=await result.response.json();
    const items=page!==null ? data?.cards : [data];
    if (!Array.isArray(items) || items.some(item=>!/^\d{1,10}$/.test(String(item?.internal_code)))) {
      throw new Error('A API pública do MYP retornou um formato inesperado.');
    }
    return reply({products:items.map(item=>({
      id:String(item.internal_code),code:clean(item.card_code),edition:clean(item.edition_code),
      minimum:money(item.min_price),average:money(item.avg_price)
    }))});
  }
  if (url.pathname === '/api/myp-status') {
    const [catalog,offers]=await Promise.all([
      connectionStatus('/api/v1/jogos','application/json',token),
      connectionStatus('/yugioh/produto/322754/harmonia-fydraulis','text/html')
    ]);
    return reply({catalog,offers,tokenConfigured:Boolean(token)});
  }
  if (url.pathname === '/api/store') {
    const seller = storefrontSeller(`https://mypcards.com/${encodeURIComponent(query.get('seller')||'')}/yugioh`);
    const page = Number(query.get('page') || '1');
    if (!seller || !Number.isSafeInteger(page) || page<1 || page>500) return invalid('Vitrine ou página inválida.');
    const result = await upstream(`/${encodeURIComponent(seller)}/yugioh${page>1?`?page=${page}`:''}`,'text/html');
    return result.error || reply(parseStorefront(await result.response.text(),page));
  }
  if (url.pathname === '/api/offers') {
    const id = query.get('id') || '', slug = query.get('slug') || '';
    const cert = Number(query.get('cert')||'1'), other = Number(query.get('other')||'1');
    if (!/^\d{1,10}$/.test(id) || !/^[a-z0-9_-]{0,150}$/i.test(slug) || [cert,other].some(page=>!Number.isSafeInteger(page)||page<1||page>500)) return invalid('Produto ou página inválida.');
    const paging = cert>1 || other>1 ? `?estoque-cert-page=${cert}&per-page=10&estoque-outros-page=${other}&dp-1-per-page=10` : '';
    const result = await upstream(`/yugioh/produto/${id}${slug?`/${slug}`:''}${paging}`,'text/html');
    return result.error || reply(parseOffers(await result.response.text()));
  }
  if (url.pathname === '/api/catalog') {
    const name = clean(query.get('name')), code = clean(query.get('code'));
    if ((!name && !code) || name.length>180 || code.length>100 || (code && !/^[A-Za-z0-9_-]+$/.test(code))) return invalid('Nome ou código inválido.');
    const lookup = name ? `carta/${encodeURIComponent(name)}` : `precos/${encodeURIComponent(btoa(code))}`;
    const result = await upstream(`/api/v1/yugioh/${lookup}`,'application/json',token);
    if (result.error) return result.error;
    const value = await result.response.json();
    const cards = name ? value.cards : [value];
    if (!Array.isArray(cards)) throw new Error('O catálogo do MYP retornou um formato inesperado.');
    return reply(cards.map(card=>({productId:String(card.internal_code||''),name:card.name_pt||card.name_en||'',altName:card.name_en||'',code:card.card_code||'',edition:card.edition_code||'',url:card.link||''})).filter(card=>/^\d{1,10}$/.test(card.productId)));
  }
  return reply({error:'Caminho não encontrado.'},404);
}
