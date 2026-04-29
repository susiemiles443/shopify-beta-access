import crypto from 'crypto';

export function json(res, status, data, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  for (const [key, value] of Object.entries(extraHeaders)) {
    res.setHeader(key, value);
  }

  res.end(JSON.stringify(data));
}

export function getEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

export function safeEqual(a, b) {
  const aBuf = Buffer.from(a || '', 'utf8');
  const bBuf = Buffer.from(b || '', 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function buildOAuthRedirect({
  shop,
  clientId,
  scopes,
  redirectUri,
  state
}) {
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', scopes);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

export function verifyOAuthHmac(query, secret) {
  const params = new URLSearchParams(query);
  const hmac = params.get('hmac');
  if (!hmac) return false;

  params.delete('hmac');
  params.sort();

  const message = Array.from(params.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const digest = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  return safeEqual(digest, hmac);
}

export async function shopifyAdminFetch({ shop, token, query, variables = {} }) {
  const response = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify({ query, variables })
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    throw new Error(`Invalid Shopify response: ${text || 'empty response'}`);
  }

  if (!response.ok) {
    throw new Error(data?.errors?.[0]?.message || `Shopify request failed: ${response.status}`);
  }

  if (data?.errors) {
    throw new Error(
      Array.isArray(data.errors)
        ? data.errors.map((e) => e.message).join('; ')
        : 'Unknown Shopify GraphQL error'
    );
  }

  return data;
}

export function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}