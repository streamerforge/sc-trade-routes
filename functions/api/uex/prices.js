/**
 * GET /api/uex/prices
 * Cache KV serveur des prix UEX (Stanton x2 + Pyro + Nyx).
 *
 * Limite Cloudflare Free : 50 subrequêtes par invocation.
 * Solution : le Worker se rappelle lui-même avec ?_build=<sys> pour chaque
 * chunk — chaque sous-appel repart avec un budget de 50 subreqs frais.
 *
 * Chunks :
 *   prices_stanton_0  — terminaux Stanton batch 0 (idx 0-47)
 *   prices_stanton_1  — terminaux Stanton batch 1 (idx 48-95)
 *   prices_pyro       — tous les terminaux Pyro commodity
 *   prices_nyx        — tous les terminaux Nyx commodity
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UEX_BASE       = 'https://api.uexcorp.uk/2.0';
const TTL            = 30 * 60;   // 30 min
const TERM_BATCH     = 48;        // terminaux par chunk (1 subreq terminals + 48 prix = 49 ≤ 50)
const FETCH_PARALLEL = 15;        // requêtes parallèles dans fetchBatch

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const kv  = env.UEX_CACHE;
  const url = new URL(request.url);

  const uexHeaders = { 'Content-Type': 'application/json' };
  if (env.UEX_API_KEY) uexHeaders['secret-key'] = env.UEX_API_KEY;

  // ── Helpers ─────────────────────────────────────────────────────────
  async function uexGet(path, { noKey = false } = {}) {
    try {
      const h = noKey ? { 'Content-Type': 'application/json' } : uexHeaders;
      const r = await fetch(`${UEX_BASE}/${path}`, { headers: h });
      if (!r.ok) return [];
      const j = await r.json();
      return (j.status === 'ok' && Array.isArray(j.data)) ? j.data : [];
    } catch { return []; }
  }

  async function kvGet(key) {
    try {
      const { value, metadata } = await kv.getWithMetadata(key, { type: 'json' });
      if (value && metadata?.ts && (Date.now() / 1000 - metadata.ts) < TTL) return value;
    } catch {}
    return null;
  }

  async function kvSet(key, data) {
    if (!data?.length) return;
    try {
      await kv.put(key, JSON.stringify(data), {
        expirationTtl: TTL,
        metadata: { ts: Math.floor(Date.now() / 1000), count: data.length },
      });
    } catch {}
  }

  // Fetch prix pour une liste de terminaux (FETCH_PARALLEL en //)
  // 1 subreq pour les terminaux + ≤TERM_BATCH subreqs pour les prix = ≤49 total
  async function fetchBatch(terms) {
    const collected = [];
    for (let i = 0; i < terms.length; i += FETCH_PARALLEL) {
      const slice = terms.slice(i, i + FETCH_PARALLEL);
      const results = await Promise.all(
        slice.map(t => uexGet(`commodities_prices/id_terminal/${t.id}`, { noKey: true }))
      );
      results.forEach(r => { if (Array.isArray(r)) collected.push(...r); });
    }
    return collected;
  }

  // ── Mode build interne (?_build=stanton0|stanton1|pyro|nyx) ─────────
  // Chaque appel _build crée une nouvelle invocation avec 50 subreqs frais.
  const buildParam = url.searchParams.get('_build');
  if (buildParam) {
    const allTerminals = await uexGet('terminals', { noKey: true }); // 1 subreq

    if (buildParam === 'pyro') {
      const terms = allTerminals.filter(t =>
        t.star_system_name === 'Pyro' && t.is_available === 1 && t.type === 'commodity'
      );
      const prices = await fetchBatch(terms);
      await kvSet('prices_pyro', prices);
      return new Response(JSON.stringify({ built: 'pyro', count: prices.length }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    if (buildParam === 'nyx') {
      const terms = allTerminals.filter(t =>
        t.star_system_name === 'Nyx' && t.is_available === 1 && t.type === 'commodity'
      );
      const prices = await fetchBatch(terms);
      await kvSet('prices_nyx', prices);
      return new Response(JSON.stringify({ built: 'nyx', count: prices.length }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    if (buildParam === 'stanton0' || buildParam === 'stanton1') {
      const stantonTerms = allTerminals.filter(t =>
        t.star_system_name === 'Stanton' && t.is_available === 1 && t.type === 'commodity'
      );
      const page   = buildParam === 'stanton0' ? 0 : 1;
      const chunk  = stantonTerms.slice(page * TERM_BATCH, (page + 1) * TERM_BATCH);
      const prices = await fetchBatch(chunk);
      await kvSet(`prices_stanton_${page}`, prices);
      return new Response(JSON.stringify({ built: buildParam, count: prices.length }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    return new Response('unknown _build param', { status: 400, headers: CORS });
  }

  // ── Mode principal : lecture KV + trigger builds si nécessaire ───────
  if (!kv) {
    return new Response(JSON.stringify({ status: 'error', message: 'KV UEX_CACHE non configuré' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const forceRefresh = url.searchParams.has('force');

  let [s0, s1, pyro, nyx] = await Promise.all([
    forceRefresh ? null : kvGet('prices_stanton_0'),
    forceRefresh ? null : kvGet('prices_stanton_1'),
    forceRefresh ? null : kvGet('prices_pyro'),
    forceRefresh ? null : kvGet('prices_nyx'),
  ]);

  // Trigger les builds manquants — chaque fetch = nouvelle invocation = 50 subreqs frais
  const origin    = url.origin;
  const buildKeys = [];
  if (!s0)   buildKeys.push('stanton0');
  if (!s1)   buildKeys.push('stanton1');
  if (!pyro) buildKeys.push('pyro');
  if (!nyx)  buildKeys.push('nyx');

  if (buildKeys.length) {
    await Promise.all(
      buildKeys.map(k =>
        fetch(`${origin}/api/uex/prices?_build=${k}`)
          .then(r => r.json())
          .catch(() => null)
      )
    );
    // Re-lecture KV après builds
    [s0, s1, pyro, nyx] = await Promise.all([
      kvGet('prices_stanton_0'),
      kvGet('prices_stanton_1'),
      kvGet('prices_pyro'),
      kvGet('prices_nyx'),
    ]);
  }

  const allPrices = [...(s0||[]), ...(s1||[]), ...(pyro||[]), ...(nyx||[])];

  return new Response(JSON.stringify({ status: 'ok', data: allPrices }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Cache-Stanton': (s0?.length ?? 0) + (s1?.length ?? 0),
      'X-Cache-Pyro':    pyro?.length ?? 0,
      'X-Cache-Nyx':     nyx?.length ?? 0,
      'X-Build-Keys':    buildKeys.join(',') || 'all-cached',
      ...CORS,
    },
  });
}
