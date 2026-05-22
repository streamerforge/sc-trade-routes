/**
 * Cloudflare Pages Function — Proxy UEX Corp API
 * Cachée côté serveur : la clé API n'est jamais exposée au navigateur.
 *
 * Variable d'environnement requise (Cloudflare Pages → Settings → Variables) :
 *   UEX_API_KEY  =  ta clé secrète UEX
 */
export async function onRequest(context) {
  const { request, env, params } = context;

  // Reconstruit le chemin UEX (ex: /api/uex/commodities → /2.0/commodities)
  const path = params.path ? '/' + params.path.join('/') : '';
  const url  = new URL(request.url);
  const uexUrl = `https://api.uexcorp.space/2.0${path}${url.search}`;

  // Entêtes à envoyer à UEX
  const headers = { 'Content-Type': 'application/json' };
  if (env.UEX_API_KEY) headers['secret_key'] = env.UEX_API_KEY;

  const uexResp = await fetch(uexUrl, { headers });
  const body    = await uexResp.text();

  return new Response(body, {
    status: uexResp.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=900', // cache 15 min côté CDN
    },
  });
}
