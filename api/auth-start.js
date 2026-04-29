import crypto from 'crypto';

function randomString(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

export default async function handler(req, res) {
  try {
    const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
    const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
    const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || 'read_customers,write_customers';
    const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL;

    if (!SHOPIFY_CLIENT_ID || !SHOPIFY_SHOP_DOMAIN || !SHOPIFY_APP_URL) {
      res.status(500).send('Missing required environment variables.');
      return;
    }

    const state = randomString(16);
    const redirectUri = `${SHOPIFY_APP_URL}/api/auth-callback`;

    const installUrl = new URL(`https://${SHOPIFY_SHOP_DOMAIN}/admin/oauth/authorize`);
    installUrl.searchParams.set('client_id', SHOPIFY_CLIENT_ID);
    installUrl.searchParams.set('scope', SHOPIFY_SCOPES);
    installUrl.searchParams.set('redirect_uri', redirectUri);
    installUrl.searchParams.set('state', state);
    installUrl.searchParams.set('grant_options[]', '');

    res.setHeader('Set-Cookie', `shopify_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    res.writeHead(302, { Location: installUrl.toString() });
    res.end();

  } catch (error) {
    console.error('auth-start error:', error);
    res.status(500).send('Failed to start Shopify OAuth.');
  }
}