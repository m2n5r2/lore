const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

function sendJson(res, statusCode, body, headers = {}) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

module.exports = async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: { status: 'METHOD_NOT_ALLOWED', message: 'POST only' } });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, {
      error: {
        status: 'MISSING_API_KEY',
        message: 'Set GEMINI_API_KEY in the Vercel project environment variables.'
      }
    });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: { status: 'BAD_REQUEST', message: 'Invalid JSON body.' } });
    return;
  }

  const model = String(payload.model || DEFAULT_MODEL).replace(/[^a-zA-Z0-9._-]/g, '') || DEFAULT_MODEL;
  const { model: _model, ...geminiPayload } = payload;

  let response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(geminiPayload)
    });
  } catch {
    sendJson(res, 502, { error: { status: 'UPSTREAM_UNAVAILABLE', message: 'Could not reach Gemini API.' } });
    return;
  }

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = response.ok
      ? { candidates: [{ content: { parts: [{ text }] } }] }
      : { error: { status: 'UPSTREAM_ERROR', message: text || 'Gemini API request failed.' } };
  }

  const headers = {};
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) headers['retry-after'] = retryAfter;

  sendJson(res, response.status, body, headers);
};
