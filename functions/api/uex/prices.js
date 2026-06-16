/**
 * GET /api/uex/prices
 * Retourne TOUS les prix UEX (Stanton + Pyro + Nyx) depuis le cache KV.
 *
 * Cache indépendant par système :
 *   - Stanton : 5 min
 *   - Pyro    : 5 min
 *   - Nyx     : 5 min
 *
 * Fetch terminal par terminal (10 en parallèle) — tous les champs
 * de localisation inclus (space_station_name, outpost_name, etc.)
 * Utilise commodities_prices/id_terminal/XX qui retourne scu_buy,
 * scu_buy_max, scu_sell_stock, scu_sell_max, date_modified, etc.
 *
 * Bindings requis (wrangler.toml) :
 *   UEX_CACHE   → KV namespace
 *   UEX_API_KEY → variable secrète (optionnelle)
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UEX_BASE    = 'https://api.uexcorp.uk/2.0';
const TTL_STANTON = 30 * 60;   // 30 min
const TTL_PYRO    = 30 * 60;   // 30 min
const TTL_NYX     = 30 * 60;   // 30 min
const BATCH       = 15;        // requêtes en parallèle (augmenté pour accélérer le refetch)

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const kv = env.UEX_CACHE;
  if (!kv) {
    return new Response(JSON.stringify({ status: 'error', message: 'KV UEX_CACHE non configuré' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const uexHeaders = { 'Content-Type': 'application/json' };
  if (env.UEX_API_KEY) uexHeaders['secret-key'] = env.UEX_API_KEY;

  // ── Helper fetch UEX ────────────────────────────────────────────────
  async function uexGet(path, { noKey = false } = {}) {
    try {
      const h = noKey ? { 'Content-Type': 'application/json' } : uexHeaders;
      const r = await fetch(`${UEX_BASE}/${path}`, { headers: h });
      if (!r.ok) return [];
      const j = await r.json();
      return (j.status === 'ok' && Array.isArray(j.data)) ? j.data : [];
    } catch { return []; }
  }

  // ── Cache KV helpers ────────────────────────────────────────────────
  async function kvGet(key, ttl) {
    try {
      const { value, metadata } = await kv.getWithMetadata(key, { type: 'json' });
      if (value && metadata?.ts && (Date.now() / 1000 - metadata.ts) < ttl) return value;
    } catch {}
    return null;
  }
  async function kvSet(key, data, ttl) {
    if (!data?.length) return;
    try {
      await kv.put(key, JSON.stringify(data), {
        expirationTtl: ttl,
        metadata: { ts: Math.floor(Date.now() / 1000), count: data.length },
      });
    } catch {}
  }

  // ── Fetch prix pour une liste de terminaux (10 en //) ───────────────
  async function fetchByTerminals(terms) {
    const collected = [];
    for (let i = 0; i < terms.length; i += BATCH) {
      const batch = terms.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(t => uexGet(`commodities_prices/id_terminal/${t.id}`))
      );
      results.forEach(r => { if (Array.isArray(r)) collected.push(...r); });
    }
    return collected;
  }

  // ── 1. Vérifier les 3 caches ────────────────────────────────────────
  let stanton = await kvGet('prices_stanton', TTL_STANTON);
  let pyro    = await kvGet('prices_pyro',    TTL_PYRO);
  let nyx     = await kvGet('prices_nyx',     TTL_NYX);

  // ── 2. Fetch terminaux si au moins 1 système périmé ─────────────────
  let allTerminals = null;
  if (!stanton || !pyro || !nyx) {
    allTerminals = await uexGet('terminals', { noKey: true });
  }

  // ── 3. Stanton ──────────────────────────────────────────────────────
  if (!stanton) {
    const terms = allTerminals.filter(t =>
      t.star_system_name === 'Stanton' && t.is_available === 1 && t.type === 'commodity'
    );
    stanton = await fetchByTerminals(terms);
    await kvSet('prices_stanton', stanton, TTL_STANTON);
  }

  // ── 4. Pyro ─────────────────────────────────────────────────────────
  if (!pyro) {
    const terms = allTerminals.filter(t =>
      t.star_system_name === 'Pyro' && t.is_available === 1 && t.type === 'commodity'
    );
    pyro = await fetchByTerminals(terms);
    await kvSet('prices_pyro', pyro, TTL_PYRO);
  }

  // ── 5. Nyx ──────────────────────────────────────────────────────────
  if (!nyx) {
    const terms = allTerminals.filter(t =>
      t.star_system_name === 'Nyx' && t.is_available === 1 && t.type === 'commodity'
    );
    nyx = await fetchByTerminals(terms);
    await kvSet('prices_nyx', nyx, TTL_NYX);
  }

  // ── 6. Combinaison ──────────────────────────────────────────────────
  const allPrices = [...(stanton || []), ...(pyro || []), ...(nyx || [])];

  return new Response(JSON.stringify({ status: 'ok', data: allPrices }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Cache-Stanton': stanton?.length ?? 0,
      'X-Cache-Pyro':    pyro?.length    ?? 0,
      'X-Cache-Nyx':     nyx?.length     ?? 0,
      ...CORS,
    },
  });
}
