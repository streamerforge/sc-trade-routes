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
      r.confirmed_count,
      r.auto_collected,
      r.source
    FROM price_reports r
    INNER JOIN (
      SELECT
        CASE WHEN id_terminal > 0 THEN CAST(id_terminal AS TEXT) ELSE terminal_name END AS grp_term,
        CASE WHEN id_commodity > 0 THEN CAST(id_commodity AS TEXT) ELSE commodity_name END AS grp_comm,
        MAX(submitted_at) AS latest
      FROM price_reports
      WHERE commodity_name IS NOT NULL
        AND commodity_name != ''
        AND commodity_name != 'Commodity inconnue'
      GROUP BY grp_term, grp_comm
    ) latest
      ON (
        CASE WHEN r.id_terminal > 0 THEN CAST(r.id_terminal AS TEXT) ELSE r.terminal_name END = latest.grp_term
        AND CASE WHEN r.id_commodity > 0 THEN CAST(r.id_commodity AS TEXT) ELSE r.commodity_name END = latest.grp_comm
        AND r.submitted_at = latest.latest
      )
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
