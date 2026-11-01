# Capital23 Group LLC — Stripe checkout starter

This is a starter implementation for a custom web checkout using Stripe Payment Element + PaymentIntents, with 3DS requested using `request_three_d_secure: 'any'`.

## Important status

- This is source code, not a deployed application.
- The storefront preview is a visual/demo prototype and does not process payments.
- `findPendingOrder()` intentionally returns `null`; connect it to a real database and server-side catalog/pricing before testing payments.
- `requireCustomer()` expects your real session middleware. Do not deploy the placeholder as authentication.
- No live Stripe settings or charges have been changed or created.

## Run locally

1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and add Stripe **test-mode** keys.
3. Run `npm install`.
4. Implement `findPendingOrder()` and `requireCustomer()` using your database and authentication system.
5. Run `npm run dev`.
6. Serve `checkout.html` and `checkout.js` from the same HTTPS origin as the API. Inject the publishable key and a server-created order ID into the page.
7. Forward Stripe test webhooks to `/stripe-webhook` using the Stripe CLI and set the resulting signing secret in `.env`.

## Before production

- Persist orders, PaymentIntent IDs and webhook event IDs in a database.
- Make order creation, payment intent association, and fulfillment idempotent/transactional.
- Verify order ownership, amount, currency, inventory, discounts and tax server-side.
- Add CSRF protection for cookie sessions, secure cookies, origin checks, monitoring, error reporting and retry-safe webhook processing.
- Configure HTTPS, allowed origins, CSP and deployment secrets.
- Test successful, declined, 3DS challenge, abandoned, duplicate webhook and retry flows in Stripe test mode.
- Fulfill only after a verified `payment_intent.succeeded` webhook and server-side reconciliation.

Stripe 3DS behavior is issuer/network/risk dependent. `any` requests 3DS when supported and applicable; it does not guarantee an interactive challenge on every payment.
