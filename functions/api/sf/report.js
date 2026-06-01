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
          price_buy, price_sell, scu_buy, rsi_handle,
          auto_collected, source, type } = body;

  // auto_collected = true  → vient du SC Trade Tracker (id_commodity peut être 0)
  // auto_collected = false → vient du formulaire manuel (id_commodity requis)
  const isAuto = auto_collected === true;

  // Pour les reports manuels : id_terminal et rsi_handle obligatoires
  if (!isAuto && (!id_terminal || !rsi_handle)) {
    return new Response(JSON.stringify({ status: 'error', message: 'Missing required fields' }), { status: 400, headers: CORS });
  }

  // Pour les reports manuels seulement : rejeter si commodité inconnue
  if (!isAuto && (!commodity_name || commodity_name === 'Commodity inconnue')) {
    return new Response(JSON.stringify({ status: 'skip', message: 'Commodity not identified' }), { status: 200, headers: CORS });
  }

  const now = Math.floor(Date.now() / 1000);
  // SCAN = juste disponibilité stock, price_buy/sell = 0
  const isScan = type === 'SCAN';

  await env.SF_DB.prepare(`
    INSERT INTO price_reports
      (id_terminal, id_commodity, terminal_name, commodity_name, commodity_code,
       price_buy, price_sell, scu_buy, rsi_handle, submitted_at, auto_collected, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id_terminal || 0, id_commodity || 0,
    terminal_name || '', commodity_name || '',
    commodity_code || '', isScan ? 0 : (price_buy || 0),
    isScan ? 0 : (price_sell || 0), scu_buy || 0,
    rsi_handle || 'auto', now,
    isAuto ? 1 : 0, isScan ? 'scan' : (source || 'manual')
  ).run();

  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
