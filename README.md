# Capital23 Group LLC — free-first platform starter

This package combines the existing C23 storefront preview with a Cloudflare Worker backend scaffold for Stripe test mode and PayPal sandbox. It is **not deployed**, and the storefront preview remains a visual prototype until its checkout UI is wired to these endpoints.

## Free-first hosting

1. Create a free Cloudflare account and install Node.js on a computer.
2. In this folder run `npm install`.
3. Create a D1 database: `npx wrangler d1 create c23-orders`.
4. Copy the returned database ID into `wrangler.jsonc`.
5. Create the schema: `npx wrangler d1 execute c23-orders --local --file=./schema.sql` for local development, then repeat with `--remote` after the database is created remotely.
6. Copy `.dev.vars.example` to `.dev.vars` and fill it with TEST/SANDBOX credentials only. Do not upload or share secret keys in chat.
7. Run `npm run dev` for local testing. Deploy only after the app is fully reviewed with `npm run deploy`.

Cloudflare's free tier has usage limits. The current plan lists up to 100,000 Worker requests per day and 10 ms CPU time per invocation; verify current limits before production use.

## Important payment safety notes

- This scaffold deliberately rejects live Stripe keys and PayPal live mode.
- The server calculates amounts from its own allow-listed catalog. It does not trust prices sent by the browser.
- The listed prices are illustrative placeholders from the existing visual preview, **not approved C23 prices**. Replace the `CATALOG` map with the actual approved Stripe catalog before any live use.
- The Property Turnover quote item is intentionally excluded from direct checkout until a quote is approved.
- Stripe success is recorded from a signature-verified `payment_intent.succeeded` webhook, not a browser redirect.
- PayPal capture is performed server-side and checked for `COMPLETED` status.
- This is a starter, not a complete production system. Before accepting live payments, add customer authentication/authorization for client-specific invoices, stronger order-state controls, webhook reconciliation and monitoring, rate limiting/abuse protection, privacy and refund policies, and tested idempotency/retry handling.
- No live payment has been created, and no Stripe or PayPal account settings have been changed.

## Endpoints

- `POST /api/stripe/payment-intent` — creates a Stripe test PaymentIntent for allow-listed items.
- `POST /api/stripe/webhook` — verifies Stripe webhook signatures and records successful payments.
- `POST /api/paypal/orders` — creates a PayPal sandbox order.
- `POST /api/paypal/orders/:id/capture` — captures a sandbox order server-side.

## Next integration step

Wire the storefront bag to send item IDs and quantities to these endpoints, render Stripe Payment Element using the returned client secret, and render PayPal's JavaScript SDK button using the returned PayPal order ID. The front end must never send an authoritative amount or mark an order paid by itself.
