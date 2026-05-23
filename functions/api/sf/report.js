/**
 * POST /api/sf/report
 * Enregistre un report de prix dans la base Streamer Forge (D1).
 * Binding requis : SF_DB (D1)
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ status: 'error', message: 'POST only' }), { status: 405, headers: CORS });
  }

  if (!env.SF_DB) {
    return new Response(JSON.stringify({ status: 'error', message: 'DB not bound' }), { status: 500, headers: CORS });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ status: 'error', message: 'Invalid JSON' }), { status: 400, headers: CORS });
  }

  const { id_terminal, id_commodity, terminal_name, commodity_name, commodity_code,
          price_buy, price_sell, scu_buy, rsi_handle } = body;

  if (!id_terminal || !id_commodity || !rsi_handle) {
    return new Response(JSON.stringify({ status: 'error', message: 'Missing required fields' }), { status: 400, headers: CORS });
  }

  const now = Math.floor(Date.now() / 1000);

  await env.SF_DB.prepare(`
    INSERT INTO price_reports
      (id_terminal, id_commodity, terminal_name, commodity_name, commodity_code,
       price_buy, price_sell, scu_buy, rsi_handle, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id_terminal, id_commodity, terminal_name || '', commodity_name || '',
    commodity_code || '', price_buy || 0, price_sell || 0, scu_buy || 0,
    rsi_handle, now
  ).run();

  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
