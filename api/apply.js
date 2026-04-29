import {
  getEnv,
  json,
  parseRequestBody,
  shopifyAdminFetch,
  verifyProxySignature
} from '../lib/shopify.js';

function parseQueryFromReq(req, appUrl) {
  const url = new URL(req.url, appUrl);
  const query = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (query[key]) {
      if (Array.isArray(query[key])) {
        query[key].push(value);
      } else {
        query[key] = [query[key], value];
      }
    } else {
      query[key] = value;
    }
  }
  return query;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export default async function handler(req, res) {
  try {
    const appUrl = getEnv('SHOPIFY_APP_URL');
    const shop = getEnv('SHOPIFY_SHOP_DOMAIN');
    const token = getEnv('SHOPIFY_OFFLINE_ACCESS_TOKEN');
    const apiSecret = getEnv('SHOPIFY_API_SECRET') || getEnv('SHOPIFY_CLIENT_SECRET');
    const customerTag = getEnv('BETA_CUSTOMER_TAG', 'beta-approved');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === 'GET') {
      return json(res, 200, {
        success: true,
        message: 'Apply endpoint is alive',
        note: 'Use POST via Shopify App Proxy'
      });
    }

    if (req.method !== 'POST') {
      return json(res, 405, { success: false, message: 'Method not allowed' });
    }

    if (!appUrl || !shop || !token || !apiSecret) {
      return json(res, 500, {
        success: false,
        message: 'Missing SHOPIFY_APP_URL, SHOPIFY_SHOP_DOMAIN, SHOPIFY_OFFLINE_ACCESS_TOKEN, or SHOPIFY_API_SECRET'
      });
    }

    const query = parseQueryFromReq(req, appUrl);

    if (!verifyProxySignature(query, apiSecret)) {
      console.error('apply invalid proxy signature', query);
      return json(res, 401, { success: false, message: 'Invalid proxy signature' });
    }

    const body = await parseRequestBody(req);
    const customerId = body.customer_id;
    const email = normalizeEmail(body.email);
    const agreed = !!body.agreed;

    if (!customerId || !email || !agreed) {
      return json(res, 400, {
        success: false,
        message: 'Missing customer_id, email, or agreement'
      });
    }

    const gid = `gid://shopify/Customer/${customerId}`;

    const customerQuery = `
      query GetCustomer($id: ID!) {
        customer(id: $id) {
          id
          email
          tags
        }
      }
    `;

    const customerData = await shopifyAdminFetch({
      shop,
      token,
      query: customerQuery,
      variables: { id: gid }
    });

    const customer = customerData?.data?.customer;

    if (!customer) {
      return json(res, 404, { success: false, message: 'Customer not found' });
    }

    const shopifyEmail = normalizeEmail(customer.email);

    if (shopifyEmail !== email) {
      return json(res, 403, {
        success: false,
        message: 'Customer email mismatch'
      });
    }

    const currentTags = Array.isArray(customer.tags) ? customer.tags : [];
    const nextTags = currentTags.includes(customerTag)
      ? currentTags
      : [...currentTags, customerTag];

    const mutation = `
      mutation UpdateCustomer($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer {
            id
            email
            tags
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const updateData = await shopifyAdminFetch({
      shop,
      token,
      query: mutation,
      variables: {
        input: {
          id: gid,
          tags: nextTags
        }
      }
    });

    const payload = updateData?.data?.customerUpdate;
    const userErrors = payload?.userErrors || [];

    if (userErrors.length > 0) {
      return json(res, 400, {
        success: false,
        message: userErrors.map((e) => e.message).join('; ')
      });
    }

    return json(res, 200, {
      success: true,
      message: 'Application submitted successfully',
      customer: payload?.customer || null
    });
  } catch (error) {
    console.error('apply error', error);
    return json(res, 500, {
      success: false,
      message: error.message || 'Internal server error'
    });
  }
}