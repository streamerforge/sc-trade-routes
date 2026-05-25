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
  // avec au moins 1 confirmation OU soumis il y a moins de 24h
  const { results } = await env.SF_DB.prepare(`
    SELECT
      r.id_terminal,
      r.id_commodity,
      r.terminal_name,
      r.commodity_name,
      r.commodity_code,
      r.price_buy,
      r.price_sell,
      r.scu_buy,
      r.rsi_handle,
      r.submitted_at,
      r.confirmed_count
    FROM price_reports r
    INNER JOIN (
      SELECT id_terminal, id_commodity, MAX(submitted_at) AS latest
      FROM price_reports
      GROUP BY id_terminal, id_commodity
    ) latest ON r.id_terminal = latest.id_terminal
             AND r.id_commodity = latest.id_commodity
             AND r.submitted_at = latest.latest
    ORDER BY r.submitted_at DESC
    LIMIT 5000
  `).all();

  return new Response(JSON.stringify({ status: 'ok', data: results || [] }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}
