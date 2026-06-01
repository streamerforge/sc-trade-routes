/**
 * GET  /api/sf/guids?guid=XXXX  → lookup un GUID
 * GET  /api/sf/guids             → retourne tous les GUIDs connus
 * POST /api/sf/guids             → soumet un nouveau GUID → nom
 *
 * Binding requis : SF_DB (D1)
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS });

  if (!env.SF_DB)
    return new Response(JSON.stringify({ status: 'error', message: 'DB not bound' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } });

  // ── GET : lookup ou liste complète ────────────────────────────────
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const guid = url.searchParams.get('guid');

    if (guid) {
      // Lookup un GUID spécifique
      const row = await env.SF_DB.prepare(
        'SELECT * FROM guid_registry WHERE guid = ?'
      ).bind(guid).first();

      if (!row)
        return new Response(JSON.stringify({ status: 'not_found' }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });

      return new Response(JSON.stringify({ status: 'ok', data: row }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
    }

    // Retourne tous les GUIDs connus (pour cache local du tracker)
    const { results } = await env.SF_DB.prepare(
      'SELECT guid, commodity_name, commodity_code FROM guid_registry ORDER BY confirmed_count DESC'
    ).all();

    return new Response(JSON.stringify({ status: 'ok', data: results }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
  }

  // ── POST : soumettre un nouveau GUID ──────────────────────────────
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); }
    catch { return new Response(JSON.stringify({ status: 'error', message: 'Invalid JSON' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }); }

    const { guid, commodity_name, commodity_code } = body;

    if (!guid || !commodity_name)
      return new Response(JSON.stringify({ status: 'error', message: 'guid and commodity_name required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } });

    const now = Math.floor(Date.now() / 1000);

    // Upsert — si le GUID existe déjà, on incrémente confirmed_count
    await env.SF_DB.prepare(`
      INSERT INTO guid_registry (guid, commodity_name, commodity_code, confirmed_count, first_seen, last_seen)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(guid) DO UPDATE SET
        confirmed_count = confirmed_count + 1,
        last_seen = excluded.last_seen,
        -- Ne met à jour le nom que si le nouveau est plus sûr (même nom = confirmation)
        commodity_name = CASE
          WHEN guid_registry.commodity_name = excluded.commodity_name THEN guid_registry.commodity_name
          ELSE excluded.commodity_name
        END
    `).bind(guid, commodity_name, commodity_code || '', now, now).run();

    return new Response(JSON.stringify({ status: 'ok' }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
  }

  return new Response(JSON.stringify({ status: 'error', message: 'Method not allowed' }),
    { status: 405, headers: { 'Content-Type': 'application/json', ...CORS } });
}
