export function send(res, status, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(data));
}
export async function readBody(req) {
  if (!req.headers['content-type']?.includes('application/json')) return null;
  if (req.body !== undefined) {
    try { return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return null; }
  }
  let body = '';
  for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 12000) return null; }
  try { return JSON.parse(body); } catch { return null; }
}
