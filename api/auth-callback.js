import crypto from 'crypto';

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  return cookieHeader.split(';').reduce((acc, item) => {
    const parts = item.split('=');
    const key = parts[0] && parts[0].trim();
    const value = parts.slice(1).join('=').trim();
    if (key) acc[key] = decodeURIComponent(value || '');
    return acc;
  }, {});
}

function verifyOAuthHmac(query, secret) {
  const params = new URLSearchParams(query);
  const hmac = params.get('hmac');
  if (!hmac) return false;

  params.delete('hmac');
  params.delete('signature');

  const message = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const generated = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(generated, 'utf8'), Buffer.from(hmac, 'utf8'));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  try {
    const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
    const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
    const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
    const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL;

    if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET || !SHOPIFY_SHOP_DOMAIN || !SHOPIFY_APP_URL) {
      res.status(500).send('Missing required environment variables.');
      return;
    }

    const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
    const isValidHmac = verifyOAuthHmac(queryString, SHOPIFY_CLIENT_SECRET);

    if (!isValidHmac) {
      res.status(401).send('Invalid OAuth HMAC.');
      return;
    }

    const url = new URL(req.url, SHOPIFY_APP_URL);
    const code = url.searchParams.get('code');
    const shop = url.searchParams.get('shop');
    const state = url.searchParams.get('state');

    const cookies = parseCookies(req);
    const cookieState = cookies.shopify_oauth_state;

    if (!state || !cookieState || state !== cookieState) {
      res.status(400).send('Invalid OAuth state.');
      return;
    }

    if (!code || !shop) {
      res.status(400).send('Missing OAuth code or shop.');
      return;
    }

    if (shop !== SHOPIFY_SHOP_DOMAIN) {
      res.status(400).send('Shop domain mismatch.');
      return;
    }

    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        code
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error('OAuth token exchange failed:', tokenData);
      res.status(500).send('Failed to exchange OAuth token.');
      return;
    }

    const accessToken = tokenData.access_token;
    const scope = tokenData.scope || '';

    res.setHeader('Set-Cookie', 'shopify_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    res.end(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Shopify OAuth Complete</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background: #111;
              color: #fff;
              padding: 40px;
              line-height: 1.6;
            }
            .wrap {
              max-width: 900px;
              margin: 0 auto;
              background: #1a1a1a;
              border: 1px solid rgba(255,255,255,.1);
              border-radius: 16px;
              padding: 24px;
            }
            code, pre {
              display: block;
              white-space: pre-wrap;
              word-break: break-all;
              background: #000;
              color: #d9d9d9;
              padding: 16px;
              border-radius: 12px;
              border: 1px solid rgba(255,255,255,.12);
            }
            .ok {
              color: #8df0b5;
            }
          </style>
        </head>
        <body>
          <div class="wrap">
            <h1 class="ok">OAuth completed successfully</h1>
            <p>Copy the access token below and save it to your Vercel environment variable:</p>
            <pre>SHOPIFY_OFFLINE_ACCESS_TOKEN=${accessToken}</pre>
            <p>Granted scopes:</p>
            <pre>${scope}</pre>
            <p>After saving the environment variable, redeploy your Vercel project.</p>
          </div>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('auth-callback error:', error);
    res.status(500).send('Shopify OAuth callback failed.');
  }
}