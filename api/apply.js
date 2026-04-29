import crypto from 'crypto';

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function verifyAppProxySignature(query, secret) {
  const params = new URLSearchParams(query);
  const signature = params.get('signature');
  if (!signature) return false;

  params.delete('signature');

  const sorted = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('');

  const calculated = crypto
    .createHmac('sha256', secret)
    .update(sorted)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(calculated, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}

async function shopifyGraphQLRequest({ shop, accessToken, query, variables = {} }) {
  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json();

  if (!response.ok || data.errors) {
    throw new Error(JSON.stringify(data.errors || data));
  }

  return data.data;
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(tag => String(tag).trim()).filter(Boolean);
  return String(tags).split(',').map(tag => tag.trim()).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { success: false, message: 'Method not allowed.' });
  }

  try {
    const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
    const SHOPIFY_OFFLINE_ACCESS_TOKEN = process.env.SHOPIFY_OFFLINE_ACCESS_TOKEN;
    const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_CLIENT_SECRET;

    if (!SHOPIFY_SHOP_DOMAIN || !SHOPIFY_OFFLINE_ACCESS_TOKEN || !SHOPIFY_API_SECRET) {
      return json(res, 500, { success: false, message: 'Missing server configuration.' });
    }

    const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
    const isValidProxyRequest = verifyAppProxySignature(queryString, SHOPIFY_API_SECRET);

    if (!isValidProxyRequest) {
      return json(res, 401, { success: false, message: 'Invalid proxy signature.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { customer_id, email, tag } = body;

    if (!customer_id || !email || !tag) {
      return json(res, 400, { success: false, message: 'Missing required fields.' });
    }

    const customerGid = `gid://shopify/Customer/${customer_id}`;

    const customerQuery = `
      query GetCustomer($id: ID!) {
        customer(id: $id) {
          id
          email
          tags
        }
      }
    `;

    const customerData = await shopifyGraphQLRequest({
      shop: SHOPIFY_SHOP_DOMAIN,
      accessToken: SHOPIFY_OFFLINE_ACCESS_TOKEN,
      query: customerQuery,
      variables: { id: customerGid }
    });

    const customer = customerData.customer;

    if (!customer) {
      return json(res, 404, { success: false, message: 'Customer not found.' });
    }

    if ((customer.email || '').toLowerCase() !== String(email).toLowerCase()) {
      return json(res, 403, { success: false, message: 'Customer email mismatch.' });
    }

    const existingTags = normalizeTags(customer.tags);

    if (existingTags.includes(tag)) {
      return json(res, 200, {
        success: true,
        message: 'Your beta access is already approved.'
      });
    }

    const updatedTags = [...new Set([...existingTags, tag])];

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

    const mutationData = await shopifyGraphQLRequest({
      shop: SHOPIFY_SHOP_DOMAIN,
      accessToken: SHOPIFY_OFFLINE_ACCESS_TOKEN,
      query: mutation,
      variables: {
        input: {
          id: customerGid,
          tags: updatedTags
        }
      }
    });

    const result = mutationData.customerUpdate;

    if (result.userErrors && result.userErrors.length > 0) {
      return json(res, 400, {
        success: false,
        message: result.userErrors[0].message || 'Failed to update customer tags.'
      });
    }

    return json(res, 200, {
      success: true,
      message: 'Your beta access has been approved successfully.'
    });

  } catch (error) {
    console.error('apply error:', error);
    return json(res, 500, {
      success: false,
      message: 'Server error while processing the beta application.'
    });
  }
}