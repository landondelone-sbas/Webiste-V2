/**
 * SBAS Info LLC — payment backend (reference implementation)
 * ---------------------------------------------------------
 * This file is the CONTRACT payment.html depends on. If you already have a
 * Stripe backend, you do not need to run this — you need to make yours expose
 * these three routes with these exact shapes.
 *
 * Run:
 *   npm init -y && npm i express stripe cors dotenv
 *   node server.js
 *
 * .env
 *   STRIPE_SECRET_KEY=sk_test_...
 *   STRIPE_WEBHOOK_SECRET=whsec_...
 *   SITE_URL=http://localhost:5500
 *   PORT=4242
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const Stripe  = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app    = express();

const SITE_URL = process.env.SITE_URL || 'http://localhost:5500';
const PORT     = process.env.PORT || 4242;

app.use(cors({ origin: SITE_URL }));

/* ═══════════════════════════════════════════════════════════════
   INVOICE STORE — the security boundary of this whole system.

   Prices live HERE, on the server. The browser sends only a `ref`.
   That is what stops a customer from editing the amount in devtools
   and paying $1 for a $4,500 engagement.

   Replace this object with a real database table when you outgrow it.
   Shape must stay identical.
   ═══════════════════════════════════════════════════════════════ */
const INVOICES = {
  // 'SBAS-1001': {
  //   ref:         'SBAS-1001',
  //   practice:    'Riverbend Family Medicine',
  //   description: 'HIPAA Security Risk Assessment — single site',
  //   mode:        'payment',        // one-time
  //   amountCents: 450000,
  //   currency:    'usd',
  //   email:       'manager@riverbendfm.com',
  //   paid:        false
  // },
  // 'SBAS-1002': {
  //   ref:         'SBAS-1002',
  //   practice:    'Riverbend Family Medicine',
  //   description: 'Compliance retainer — monthly',
  //   mode:        'subscription',   // recurring
  //   amountCents: 75000,
  //   currency:    'usd',
  //   interval:    'month',
  //   email:       'manager@riverbendfm.com',
  //   paid:        false
  // }
};

const findInvoice = (ref) => INVOICES[String(ref || '').trim().toUpperCase()] || null;

/* ═══════════════════════════════════════════════════════════════
   WEBHOOK — must be registered BEFORE express.json(), because
   Stripe signature verification needs the raw, unparsed body.
   ═══════════════════════════════════════════════════════════════ */
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const ref     = session.metadata && session.metadata.ref;
      const invoice = findInvoice(ref);
      if (invoice) {
        invoice.paid = true;                       // ← persist to your DB here
        console.log(`PAID  ${ref}  ${session.id}`);
      }
      break;
    }
    case 'invoice.paid':
      // Recurring retainer renewed successfully.
      console.log('RENEWED', event.data.object.subscription);
      break;

    case 'invoice.payment_failed':
      // Retainer card declined — follow up with the client.
      console.warn('RETAINER PAYMENT FAILED', event.data.object.subscription);
      break;

    default:
      break;
  }

  res.json({ received: true });
});

app.use(express.json());

/* ═══════════════════════════════════════════════════════════════
   GET /api/invoice/:ref
   Returns the public-safe fields the confirmation screen renders.
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/invoice/:ref', (req, res) => {
  const invoice = findInvoice(req.params.ref);

  if (!invoice)   return res.status(404).json({ error: 'not_found' });
  if (invoice.paid) return res.status(409).json({ error: 'already_paid' });

  res.json({
    ref:         invoice.ref,
    practice:    invoice.practice,
    description: invoice.description,
    mode:        invoice.mode,
    amountCents: invoice.amountCents,
    currency:    invoice.currency || 'usd'
  });
});

/* ═══════════════════════════════════════════════════════════════
   POST /api/create-checkout-session   body: { ref }
   The amount is resolved server-side from `ref`. Never from the body.
   ═══════════════════════════════════════════════════════════════ */
app.post('/api/create-checkout-session', async (req, res) => {
  const invoice = findInvoice(req.body.ref);

  if (!invoice)     return res.status(404).json({ error: 'not_found' });
  if (invoice.paid) return res.status(409).json({ error: 'already_paid' });

  const recurring = invoice.mode === 'subscription';

  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: recurring ? 'subscription' : 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency:     invoice.currency || 'usd',
          unit_amount:  invoice.amountCents,
          product_data: {
            name:        invoice.description,
            description: `${invoice.practice} — ${invoice.ref}`
          },
          ...(recurring && { recurring: { interval: invoice.interval || 'month' } })
        }
      }],
      customer_email: invoice.email || undefined,
      metadata:       { ref: invoice.ref },
      ...(recurring && { subscription_data: { metadata: { ref: invoice.ref } } }),
      return_url: `${SITE_URL}/payment.html?session_id={CHECKOUT_SESSION_ID}`
    });

    res.json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error('create-checkout-session failed:', err.message);
    res.status(500).json({ error: 'session_failed' });
  }
});

/* ═══════════════════════════════════════════════════════════════
   GET /api/session-status?session_id=cs_...
   Drives the success / failure screen after Stripe redirects back.
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/session-status', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
    res.json({
      status:        session.status,          // open | complete | expired
      paymentStatus: session.payment_status,  // paid | unpaid | no_payment_required
      email:         session.customer_details && session.customer_details.email,
      ref:           session.metadata && session.metadata.ref
    });
  } catch (err) {
    console.error('session-status failed:', err.message);
    res.status(400).json({ error: 'invalid_session' });
  }
});

/* Billing portal — lets retainer clients cancel or update their card
   without you building any subscription-management UI. */
app.post('/api/billing-portal', async (req, res) => {
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer:   req.body.customerId,
      return_url: `${SITE_URL}/index.html`
    });
    res.json({ url: portal.url });
  } catch (err) {
    console.error('billing-portal failed:', err.message);
    res.status(400).json({ error: 'portal_failed' });
  }
});

app.listen(PORT, () => console.log(`SBAS payment API listening on :${PORT}`));
