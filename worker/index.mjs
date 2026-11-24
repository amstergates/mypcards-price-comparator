import {api, reply} from './myp.mjs';
import {assets} from './assets.mjs';

export default {
  async fetch(request,env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply({error:'Método indisponível.'},405);
    if (url.pathname.startsWith('/api/') && request.method === 'GET') {
      try { return await api(url,env); }
      catch (error) { return reply({error:error.message || 'Falha ao ler a resposta do MYP Cards.'},502); }
    }
    const asset = Object.hasOwn(assets,url.pathname) ? assets[url.pathname] : null;
    if (!asset) return reply({error:'Página não encontrada.'},404);
    return new Response(request.method === 'HEAD' ? null : asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"}});
  }
};
