const CATALOG = {
  consult: { name: 'Property Consultation', amount: 7500 },
  maint: { name: 'Maintenance Visit', amount: 12500 },
  walk: { name: 'Walkthrough Package', amount: 8500 },
  checklist: { name: 'Property Checklist', amount: 1500 },
  portal: { name: 'C23 - Portal Activation Fee', amount: 1500 }
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
const makeId = () => crypto.randomUUID();

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}
function validEmail(email) { return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function getItem(body) {
  if (!body || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 10) return null;
  let amount = 0;
  const lines = [];
  for (const entry of body.items) {
    const item = CATALOG[entry?.id];
    const qty = Number(entry?.quantity);
    if (!item || !Number.isInteger(qty) || qty < 1 || qty > 10) return null;
    amount += item.amount * qty;
    lines.push(`${item.name} x${qty}`);
  }
  return { amount, description: lines.join(', ') };
}

async function stripeRequest(path, secret, params) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST', headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/x-www-form-urlencoded'
    }, body: new URLSearchParams(params)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Stripe request failed');
  return data;
}

async function paypalAccessToken(env) {
  const host = env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${host}/v1/oauth2/token`, {
    method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json();
  if (!response.ok) throw new Error('PayPal authentication failed');
  return { token: data.access_token, host };
}

async function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map(part => part.split('=')));
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = new TextEncoder().encode(`${timestamp}.${rawBody}`);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, signed));
  const expected = [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === parts.v1;
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/api/stripe/payment-intent') {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Stripe test credentials are not configured.' }, 503);
    if (env.PAYMENT_MODE !== 'test' || !env.STRIPE_SECRET_KEY.startsWith('sk_test_')) return json({ error: 'This starter is locked to Stripe test mode.' }, 403);
    const body = await readJson(request); const item = getItem(body);
    if (!item || (body.email && !validEmail(body.email))) return json({ error: 'Invalid items or email.' }, 400);
    try {
      const orderId = makeId();
      await env.DB.prepare('INSERT INTO orders (id,email,provider,amount_cents,status) VALUES (?,?,?,?,?)').bind(orderId, body.email || null, 'stripe', item.amount, 'pending').run();
      const pi = await stripeRequest('payment_intents', env.STRIPE_SECRET_KEY, {
        amount: String(item.amount), currency: 'usd', 'automatic_payment_methods[enabled]': 'true',
        'payment_method_options[card][request_three_d_secure]': 'any', description: `Capital23 Group LLC — ${item.description}`,
        'metadata[order_id]': orderId
      });
      await env.DB.prepare('UPDATE orders SET stripe_payment_intent_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(pi.id, orderId).run();
      return json({ orderId, clientSecret: pi.client_secret, amount: item.amount, publishableKey: env.STRIPE_PUBLISHABLE_KEY });
    } catch (error) { return json({ error: error.message || 'Could not start Stripe checkout.' }, 500); }
  }

  if (request.method === 'POST' && url.pathname === '/api/paypal/orders') {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return json({ error: 'PayPal sandbox credentials are not configured.' }, 503);
    if (env.PAYPAL_ENV !== 'sandbox') return json({ error: 'This starter is locked to PayPal sandbox.' }, 403);
    const body = await readJson(request); const item = getItem(body);
    if (!item || (body.email && !validEmail(body.email))) return json({ error: 'Invalid items or email.' }, 400);
    try {
      const orderId = makeId();
      await env.DB.prepare('INSERT INTO orders (id,email,provider,amount_cents,status) VALUES (?,?,?,?,?)').bind(orderId, body.email || null, 'paypal', item.amount, 'pending').run();
      const { token, host } = await paypalAccessToken(env);
      const response = await fetch(`${host}/v2/checkout/orders`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'paypal-request-id': orderId },
        body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: orderId, custom_id: orderId, description: `Capital23 Group LLC — ${item.description}`, amount: { currency_code: 'USD', value: (item.amount / 100).toFixed(2) } }] })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'PayPal order creation failed');
      await env.DB.prepare('UPDATE orders SET provider_order_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(data.id, orderId).run();
      return json({ id: data.id, orderId });
    } catch (error) { return json({ error: error.message || 'Could not start PayPal checkout.' }, 500); }
  }

  const captureMatch = url.pathname.match(/^\/api\/paypal\/orders\/([^/]+)\/capture$/);
  if (request.method === 'POST' && captureMatch) {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET || env.PAYPAL_ENV !== 'sandbox') return json({ error: 'PayPal sandbox is not configured.' }, 503);
    try {
      const order = await env.DB.prepare("SELECT id FROM orders WHERE provider='paypal' AND provider_order_id=? AND status='pending'").bind(captureMatch[1]).first();
      if (!order) return json({ error: 'Pending PayPal order not found.' }, 404);
      const { token, host } = await paypalAccessToken(env);
      const response = await fetch(`${host}/v2/checkout/orders/${encodeURIComponent(captureMatch[1])}/capture`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'paypal-request-id': `${order.id}-capture` }
      });
      const data = await response.json();
      if (!response.ok) return json({ error: data?.message || 'PayPal capture failed.' }, 400);
      if (data.status === 'COMPLETED') await env.DB.prepare("UPDATE orders SET status='paid', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(order.id).run();
      return json({ status: data.status, orderId: order.id });
    } catch (error) { return json({ error: error.message || 'Could not capture PayPal order.' }, 500); }
  }

  if (request.method === 'POST' && url.pathname === '/api/stripe/webhook') {
    const rawBody = await request.text();
    const valid = await verifyStripeSignature(rawBody, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
    if (!valid) return json({ error: 'Invalid webhook signature.' }, 400);
    const event = JSON.parse(rawBody);
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const orderId = pi.metadata?.order_id;
      if (orderId) {
        try {
          await env.DB.batch([
            env.DB.prepare('INSERT INTO stripe_webhook_events (event_id,event_type) VALUES (?,?)').bind(event.id, event.type),
            env.DB.prepare("UPDATE orders SET status='paid', updated_at=CURRENT_TIMESTAMP WHERE id=? AND stripe_payment_intent_id=? AND status='pending'").bind(orderId, pi.id)
          ]);
        } catch (error) {
          if (!String(error.message).toLowerCase().includes('unique')) throw error;
        }
      }
    }
    return json({ received: true });
  }

  return env.ASSETS.fetch(request);
}

export default { fetch: handle };
