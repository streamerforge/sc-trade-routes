/**
 * GET /api/sf/prices
 * Retourne les prix SF les plus récents par paire (terminal, commodité).
 * Pas de cache — données toujours fraîches depuis D1.
 * Binding requis : SF_DB (D1)
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (!env.SF_DB) {
    return new Response(JSON.stringify({ status: 'error', message: 'DB not bound' }), { status: 500, headers: CORS });
  }

  // On prend le report le plus récent par paire (terminal + commodité)
  // Gère les deux cas : données manuelles (id > 0) et auto-collectées (id = 0)
  // Requête en deux parties pour éviter les CASE WHEN coûteux dans les JOINs

  // 1. Reports manuels (id_terminal > 0, id_commodity > 0)
  const { results: manual } = await env.SF_DB.prepare(`
    SELECT r.id_terminal, r.id_commodity, r.terminal_name, r.commodity_name,
           r.commodity_code, r.price_buy, r.price_sell, r.scu_buy,
           r.rsi_handle, r.submitted_at, r.confirmed_count
    FROM price_reports r
    INNER JOIN (
      SELECT id_terminal, id_commodity, MAX(submitted_at) AS latest
      FROM price_reports
      WHERE id_terminal > 0 AND id_commodity > 0
      GROUP BY id_terminal, id_commodity
    ) l ON r.id_terminal = l.id_terminal
       AND r.id_commodity = l.id_commodity
       AND r.submitted_at = l.latest
    ORDER BY r.submitted_at DESC
    LIMIT 2500
  `).all();

  // 2. Reports auto-collectés (id = 0, groupés par nom)
  const { results: auto } = await env.SF_DB.prepare(`
    SELECT r.id_terminal, r.id_commodity, r.terminal_name, r.commodity_name,
           r.commodity_code, r.price_buy, r.price_sell, r.scu_buy,
           r.rsi_handle, r.submitted_at, r.confirmed_count
    FROM price_reports r
    INNER JOIN (
      SELECT terminal_name, commodity_name, MAX(submitted_at) AS latest
      FROM price_reports
      WHERE id_terminal = 0
        AND commodity_name IS NOT NULL
        AND commodity_name != ''
        AND commodity_name != 'Commodity inconnue'
        AND (price_buy > 0 OR price_sell > 0)
      GROUP BY terminal_name, commodity_name
    ) l ON r.terminal_name = l.terminal_name
       AND r.commodity_name = l.commodity_name
       AND r.submitted_at = l.latest
    ORDER BY r.submitted_at DESC
    LIMIT 2500
  `).all();

  const results = [...(manual || []), ...(auto || [])];

  return new Response(JSON.stringify({ status: 'ok', data: results || [] }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}
