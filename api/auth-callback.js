import { getEnv, json, safeEqual, verifyOAuthHmac } from '../lib/shopify.js';

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = cookieHeader.split(';').map((v) => v.trim());
  const target = cookies.find((c) => c.startsWith(`${name}=`));
  if (!target) return '';
  return decodeURIComponent(target.split('=').slice(1).join('='));
}

export default async function handler(req, res) {
  try {
    const secret = getEnv('SHOPIFY_CLIENT_SECRET');
    const clientId = getEnv('SHOPIFY_CLIENT_ID');
    const appUrl = getEnv('SHOPIFY_APP_URL');

    if (!secret || !clientId || !appUrl) {
      return json(res, 500, {
        success: false,
        message: 'Missing SHOPIFY_CLIENT_SECRET, SHOPIFY_CLIENT_ID, or SHOPIFY_APP_URL'
      });
    }

    const url = new URL(req.url, appUrl);
    const code = url.searchParams.get('code');
    const shop = url.searchParams.get('shop');
    const state = url.searchParams.get('state');

    if (!verifyOAuthHmac(url.searchParams, secret)) {
      return json(res, 400, { success: false, message: 'Invalid OAuth HMAC' });
    }

    const cookieState = getCookie(req, 'shopify_oauth_state');
    if (!state || !cookieState || !safeEqual(state, cookieState)) {
      return json(res, 400, { success: false, message: 'Invalid OAuth state' });
    }

    if (!code || !shop) {
      return json(res, 400, { success: false, message: 'Missing code or shop' });
    }

    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: secret,
        code
      })
    });

    const tokenText = await tokenResponse.text();
    let tokenData = null;

    try {
      tokenData = tokenText ? JSON.parse(tokenText) : null;
    } catch (e) {
      return json(res, 500, {
        success: false,
        message: `Invalid token response: ${tokenText || 'empty response'}`
      });
    }

    if (!tokenResponse.ok || !tokenData?.access_token) {
      return json(res, 500, {
        success: false,
        message: tokenData?.error_description || 'Failed to obtain access token'
      });
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(
`OAuth success.

Please copy this token and paste it into Vercel environment variables:

SHOPIFY_OFFLINE_ACCESS_TOKEN=${tokenData.access_token}

Then redeploy your Vercel project.`
    );
  } catch (error) {
    console.error('auth-callback error', error);
    return json(res, 500, { success: false, message: 'Internal server error' });
  }
}