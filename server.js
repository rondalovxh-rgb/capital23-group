import 'dotenv/config';
import express from 'express';
import Stripe from 'stripe';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PORT = Number(process.env.PORT || 4242);

app.use(helmet());

// Webhooks must be registered before express.json() so Stripe's raw-body
// signature verification receives the original request bytes.
app.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Invalid Stripe webhook signature:', err.message);
    return res.status(400).send('Invalid webhook signature');
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        // TODO: In your database transaction:
        // 1) deduplicate event.id in a webhook_events table,
        // 2) locate order by pi.metadata.order_id,
        // 3) verify order amount/currency and payment_intent ID,
        // 4) mark paid exactly once, then enqueue fulfillment.
        console.log('Payment succeeded:', pi.id, 'order:', pi.metadata.order_id);
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        console.log('Payment failed:', pi.id, pi.last_payment_error?.message);
        // TODO: Persist failure state without treating it as paid.
        break;
      }
      default:
        break;
    }
    return res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler failed:', err);
    return res.status(500).send('Webhook handler failed');
  }
});

app.use(express.json({ limit: '20kb' }));

const createIntentLimiter = rateLimit({
  windowMs: 60_000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

// Replace with real session/JWT authentication. Never trust a customer ID
// supplied in the request body. This demo rejects unauthenticated requests.
function requireCustomer(req, res, next) {
  // TODO: validate your secure session cookie/JWT and set req.user.id.
  const customerId = req.session?.customerId;
  if (!customerId) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.user = { id: customerId };
  next();
}

// Replace with a database query scoped to the authenticated customer.
async function findPendingOrder(orderId, customerId) {
  // Return a trusted record such as:
  // { id, customerId, amount: 8500, currency: 'usd', status: 'pending' }
  // The amount MUST be calculated from server-side catalog/pricing data.
  // Never accept amount, currency, product price, or discount from the browser.
  return null;
}

app.post('/create-payment-intent', requireCustomer, createIntentLimiter, async (req, res) => {
  try {
    const { orderId } = req.body ?? {};
    if (typeof orderId !== 'string' || orderId.length < 3 || orderId.length > 100) {
      return res.status(400).json({ error: 'A valid order ID is required.' });
    }

    const order = await findPendingOrder(orderId, req.user.id);
    if (!order || order.status !== 'pending' || order.customerId !== req.user.id) {
      return res.status(404).json({ error: 'Pending order not found.' });
    }
    if (!Number.isSafeInteger(order.amount) || order.amount < 50 || order.amount > 99_999_999) {
      return res.status(400).json({ error: 'Order amount is invalid.' });
    }
    if (!/^[a-z]{3}$/.test(order.currency)) {
      return res.status(400).json({ error: 'Order currency is invalid.' });
    }

    // Use a stable idempotency key for the order's one PaymentIntent.
    // Persist the resulting PaymentIntent ID on the order and reuse/update it
    // on subsequent checkout attempts rather than creating duplicates.
    const idempotencyKey = `c23-order-${crypto.createHash('sha256').update(order.id).digest('hex')}`;
    const intent = await stripe.paymentIntents.create({
      amount: order.amount,
      currency: order.currency,
      automatic_payment_methods: { enabled: true },
      payment_method_options: {
        card: { request_three_d_secure: 'any' }
      },
      metadata: {
        order_id: order.id,
        customer_id: req.user.id,
        business: 'Capital23 Group LLC'
      }
    }, { idempotencyKey });

    // TODO: Persist intent.id on the order and enforce one intent per order.
    return res.json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error('Create PaymentIntent failed:', err.message);
    return res.status(500).json({ error: 'Unable to start secure checkout.' });
  }
});

app.get('/config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

app.listen(PORT, () => console.log(`C23 checkout API listening on :${PORT}`));
