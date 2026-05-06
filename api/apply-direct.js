import {
  getEnv,
  json,
  normalizeEmail,
  parseRequestBody,
  shopifyAdminFetch
} from '../lib/shopify.js';

function withCors(req, res, dataStatus, data) {
  const origin = req.headers.origin || '*';
  return json(
    res,
    dataStatus,
    data,
    {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  );
}

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.end();
      return;
    }

    if (req.method === 'GET') {
      return withCors(req, res, 200, {
        success: true,
        message: 'apply-direct endpoint is alive'
      });
    }

    if (req.method !== 'POST') {
      return withCors(req, res, 405, {
        success: false,
        message: 'Method not allowed'
      });
    }

    const shop = getEnv('SHOPIFY_SHOP_DOMAIN');
    const token = getEnv('SHOPIFY_OFFLINE_ACCESS_TOKEN');
    const customerTag = getEnv('BETA_CUSTOMER_TAG', 'beta-approved');

    if (!shop || !token) {
      return withCors(req, res, 500, {
        success: false,
        message: 'Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_OFFLINE_ACCESS_TOKEN'
      });
    }

    const body = await parseRequestBody(req);
    const customerId = body.customer_id;
    const email = normalizeEmail(body.email);
    const agreed = !!body.agreed;

    if (!email || !agreed) {
      return withCors(req, res, 400, {
        success: false,
        message: 'Missing email or agreement'
      });
    }

    let customer;

    if (customerId) {
      // Find customer by ID
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

      customer = customerData?.data?.customer;

      if (!customer) {
        return withCors(req, res, 404, {
          success: false,
          message: 'Customer not found'
        });
      }

      const shopifyEmail = normalizeEmail(customer.email);

      if (shopifyEmail !== email) {
        return withCors(req, res, 403, {
          success: false,
          message: 'Customer email mismatch'
        });
      }
    } else {
      // Find customer by email
      const searchQuery = `email:${email}`;
      const searchQueryGraphql = `
        query SearchCustomers($query: String!) {
          customers(first: 1, query: $query) {
            edges {
              node {
                id
                email
                tags
              }
            }
          }
        }
      `;

      const searchData = await shopifyAdminFetch({
        shop,
        token,
        query: searchQueryGraphql,
        variables: { query: searchQuery }
      });

      const edges = searchData?.data?.customers?.edges;
      if (!edges || edges.length === 0) {
        return withCors(req, res, 404, {
          success: false,
          message: 'No customer found with this email'
        });
      }

      customer = edges[0].node;
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
          id: customer.id,
          tags: nextTags
        }
      }
    });

    const payload = updateData?.data?.customerUpdate;
    const userErrors = payload?.userErrors || [];

    if (userErrors.length > 0) {
      return withCors(req, res, 400, {
        success: false,
        message: userErrors.map((e) => e.message).join('; ')
      });
    }

    return withCors(req, res, 200, {
      success: true,
      message: 'Application submitted successfully',
      customer: payload?.customer || null
    });
  } catch (error) {
    console.error('apply-direct error', error);
    return withCors(req, res, 500, {
      success: false,
      message: error.message || 'Internal server error'
    });
  }
}
