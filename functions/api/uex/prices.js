/**
 * GET /api/uex/prices
 * Retourne tous les prix UEX (Stanton + Pyro + Nyx) depuis le cache KV.
 *
 * Flux : 3 requêtes UEX en parallèle (une par système) au lieu de ~50
 *   commodities_prices?id_star_system=68  → Stanton (données complètes)
 *   commodities_prices?id_star_system=64  → Pyro    (données complètes)
 *   commodities_prices?id_star_system=55  → Nyx     (données complètes)
 *
 * Avantage vs commodities_prices_all : inclut scu_buy_max, scu_sell_max,
 * star_system_name, space_station_name et tous les champs de localisation.
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

const UEX_BASE = 'https://api.uexcorp.uk/2.0';
const TTL      = 5 * 60; // 5 min cache KV

// IDs système UEX stables (ne changent pas)
const SYSTEMS = [
  { name: 'Stanton', id: 68, key: 'prices_stanton_v2' },
  { name: 'Pyro',    id: 64, key: 'prices_pyro_v2'    },
  { name: 'Nyx',     id: 55, key: 'prices_nyx_v2'     },
];

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

  // ── Helper fetch UEX ────────────────────────────────────────────────
  const uexHeaders = { 'Content-Type': 'application/json' };
  if (env.UEX_API_KEY) uexHeaders['secret-key'] = env.UEX_API_KEY;

  async function uexGet(endpoint) {
    try {
      const r = await fetch(`${UEX_BASE}/${endpoint}`, { headers: uexHeaders });
      if (!r.ok) return [];
      const j = await r.json();
      return (j.status === 'ok' && Array.isArray(j.data)) ? j.data : [];
    } catch { return []; }
  }

  // ── Cache KV helpers ────────────────────────────────────────────────
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

  // ── Chargement avec cache par système ───────────────────────────────
  const results = await Promise.all(
    SYSTEMS.map(async sys => {
      // 1. Cache KV
      const cached = await kvGet(sys.key);
      if (cached) return cached;

      // 2. Fetch UEX si expiré
      const prices = await uexGet(`commodities_prices?id_star_system=${sys.id}`);
      await kvSet(sys.key, prices);
      return prices;
    })
  );

  const allPrices = results.flat();

  return new Response(JSON.stringify({ status: 'ok', data: allPrices }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Cache-Stanton': results[0]?.length ?? 0,
      'X-Cache-Pyro':    results[1]?.length ?? 0,
      'X-Cache-Nyx':     results[2]?.length ?? 0,
      ...CORS,
    },
  });
}
