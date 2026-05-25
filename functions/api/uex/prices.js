/**
 * GET /api/uex/prices
 * Retourne tous les prix UEX (Stanton + Pyro + Nyx) depuis le cache KV.
 *
 * Nouveau flux : 2 requêtes UEX en parallèle au lieu de ~50
 *   1. /terminals              → metadata de localisation (tous les terminaux)
 *   2. /commodities_prices_all → tous les prix bruts (id_terminal + prix)
 *   → JOIN sur id_terminal, filtre sur systèmes connus
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
const SYSTEMS  = new Set(['Stanton', 'Pyro', 'Nyx']);
const TTL      = 5 * 60;       // 5 min cache KV
const KV_KEY   = 'prices_v2';  // nouvelle clé (évite conflit avec l'ancienne v1)

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

  // ── 1. Cache global ─────────────────────────────────────────────────
  let allPrices = await kvGet(KV_KEY, TTL);

  // ── 2. Rebuild si expiré ────────────────────────────────────────────
  if (!allPrices) {
    // 2 requêtes en parallèle
    const [terminals, rawPrices] = await Promise.all([
      uexGet('terminals'),
      uexGet('commodities_prices_all'),
    ]);

    // Map id_terminal → metadata localisation (systèmes voulus uniquement)
    const termMap = new Map();
    for (const t of terminals) {
      if (t.is_available === 1 && SYSTEMS.has(t.star_system_name)) {
        termMap.set(t.id, t);
      }
    }

    // JOIN : enrichir chaque prix + filtrer sur systèmes connus
    allPrices = [];
    for (const p of rawPrices) {
      const t = termMap.get(p.id_terminal);
      if (!t) continue; // hors systèmes voulus ou terminal indisponible
      allPrices.push({
        ...p,
        star_system_name:   t.star_system_name   || null,
        planet_name:        t.planet_name        || null,
        orbit_name:         t.orbit_name         || null,
        moon_name:          t.moon_name          || null,
        space_station_name: t.space_station_name || null,
        outpost_name:       t.outpost_name       || null,
        city_name:          t.city_name          || null,
      });
    }

    await kvSet(KV_KEY, allPrices, TTL);
  }

  return new Response(JSON.stringify({ status: 'ok', data: allPrices }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Cache-Count': allPrices?.length ?? 0,
      ...CORS,
    },
  });
}
