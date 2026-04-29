import crypto from 'crypto';
import { buildOAuthRedirect, getEnv, json } from '../lib/shopify.js';

export default async function handler(req, res) {
  try {
    const clientId = getEnv('SHOPIFY_CLIENT_ID');
    const shop = getEnv('SHOPIFY_SHOP_DOMAIN');
    const scopes = getEnv('SHOPIFY_SCOPES', 'read_customers,write_customers');
    const appUrl = getEnv('SHOPIFY_APP_URL');

    if (!clientId || !shop || !appUrl) {
      return json(res, 500, {
        success: false,
        message: 'Missing SHOPIFY_CLIENT_ID, SHOPIFY_SHOP_DOMAIN, or SHOPIFY_APP_URL'
      });
    }

    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${appUrl}/api/auth-callback`;

    res.setHeader(
      'Set-Cookie',
      `shopify_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
    );

    const redirectUrl = buildOAuthRedirect({
      shop,
      clientId,
      scopes,
      redirectUri,
      state
    });

    res.statusCode = 302;
    res.setHeader('Location', redirectUrl);
    res.end();
  } catch (error) {
    console.error('auth-start error', error);
    return json(res, 500, { success: false, message: 'Internal server error' });
  }
}