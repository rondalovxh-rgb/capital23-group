// Serve this file from your HTTPS checkout page. Load Stripe.js directly
// from https://js.stripe.com/v3/ in the HTML; do not bundle or self-host it.
const stripe = Stripe(window.C23_STRIPE_PUBLISHABLE_KEY);
const form = document.querySelector('#payment-form');
const button = document.querySelector('#submit-button');
const message = document.querySelector('#payment-message');
const orderId = window.C23_ORDER_ID; // Created and authorized by your backend.
let elements;

async function initialize() {
  button.disabled = true;
  try {
    const response = await fetch('/create-payment-intent', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Checkout unavailable.');

    elements = stripe.elements({
      clientSecret: data.clientSecret,
      appearance: {
        theme: 'stripe',
        variables: { colorPrimary: '#b69a69', borderRadius: '3px' }
      }
    });
    elements.create('payment').mount('#payment-element');
    button.disabled = false;
    message.textContent = '';
  } catch (err) {
    message.textContent = err.message;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!elements) return;
  button.disabled = true;
  message.textContent = 'Confirming payment securely…';

  const { error, paymentIntent } = await stripe.confirmPayment({
    elements,
    confirmParams: { return_url: `${window.location.origin}/payment-result` },
    redirect: 'if_required'
  });

  if (error) {
    message.textContent = error.message || 'Payment could not be completed.';
    button.disabled = false;
    return;
  }

  if (paymentIntent?.status === 'succeeded') {
    message.textContent = 'Payment submitted. Final confirmation is being verified.';
  } else if (paymentIntent?.status === 'processing') {
    message.textContent = 'Payment is processing. We will confirm when complete.';
  } else {
    message.textContent = 'Payment status: ' + (paymentIntent?.status || 'pending');
  }
  // Do not fulfill from this browser callback. Fulfill only after your
  // verified payment_intent.succeeded webhook updates the order in the DB.
});

initialize();
