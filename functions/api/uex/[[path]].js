/**
 * Cloudflare Pages Function — Proxy UEX Corp API
 * Cachée côté serveur : la clé API n'est jamais exposée au navigateur.
 *
 * Variable d'environnement requise (Cloudflare Pages → Settings → Variables) :
 *   UEX_API_KEY  =  ta clé secrète UEX
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-user-key',
};

export async function onRequest(context) {
  const { request, env, params } = context;

  // Preflight CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // Reconstruit le chemin UEX (ex: /api/uex/commodities → /2.0/commodities)
  const path   = params.path ? '/' + params.path.join('/') : '';
  const url    = new URL(request.url);
  const uexUrl = `https://api.uexcorp.uk/2.0${path}${url.search}`;

  // Entêtes à envoyer à UEX
  // La clé utilisateur (x-user-key) prime sur la clé serveur SF
  const headers = { 'Content-Type': 'application/json' };
  const userKey = request.headers.get('x-user-key');
  if (userKey) {
    headers['secret-key'] = userKey;
  } else if (env.UEX_API_KEY) {
    headers['secret-key'] = env.UEX_API_KEY;
  }

  // Options fetch selon la méthode
  const fetchOpts = { method: request.method, headers };
  if (request.method === 'POST') {
    fetchOpts.body = await request.text();
  }

  const uexResp = await fetch(uexUrl, fetchOpts);
  const body    = await uexResp.text();

  // Pas de cache pour les POST (reports)
  const cacheHeader = request.method === 'POST'
    ? 'no-store'
    : 'public, max-age=180';

  return new Response(body, {
    status: uexResp.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheHeader, ...CORS },
  });
}
