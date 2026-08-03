# SBAS Info LLC — Website v2

Three pages, one payment backend. Built to be explained, not just deployed.

---

## Part 1 — The non-technical explanation

Use this section verbatim with customers. No jargon.

### What the website is

Three pages that live on the internet:

| Page | File | What it does |
|---|---|---|
| Home | `index.html` | Explains the services and captures leads |
| About | `about.html` | Builds trust — who we are, how we work, FAQs |
| Payment | `payment.html` | Lets a client pay an invoice or start a retainer |

Each page is a **single file**. Open it in a browser and it works — there is nothing to install, compile, or build. That is deliberate: it makes the site fast, cheap to host, and impossible to break with a bad update.

### How money actually moves

This is the part worth being precise about, because it's the part clients ask about.

1. You agree a price with the client and create an invoice reference — say `SBAS-1001`.
2. The client visits the payment page and types in that reference.
3. **The website asks our server what that reference costs.** The client's browser never proposes a price.
4. The server replies with the amount and description. The client sees it and confirms.
5. Stripe's secure card form appears directly on our page.
6. The client pays. **Stripe handles the card. We never see or store a card number.**
7. Stripe notifies our server that payment succeeded, and the client gets a receipt.

**Why step 3 matters.** The naive way to build this is to let the client type the amount into a box. That's exploitable — anyone can open their browser's developer tools and change a $4,500 invoice to $1 before it reaches Stripe. Putting the price on the server closes that hole completely. It's the single most important design decision in this build, and it's worth saying out loud to a customer.

### One-time payments vs. retainers

Both run through the same page. The invoice record decides which:

- `mode: "payment"` → charged once, for a project.
- `mode: "subscription"` → charged monthly, for a retainer.

Retainer clients get a Stripe billing portal link in their receipt where they can update a card or cancel — so no subscription-management screens had to be built.

### What we don't store

No card numbers. No CVVs. No patient data of any kind. The contact form on the home page explicitly tells visitors not to send PHI through it.

---

## Part 2 — Launch checklist

Nothing on this list is optional. The site will look finished before it *is* finished.

### 1. Replace every placeholder

Search all three HTML files for `[[` — every match is a fact only you can supply.

| File | Placeholder | What to put |
|---|---|---|
| `index.html` | `[[X]] days` | Real typical turnaround |
| `index.html` | `[[X]]+` practices served | Real number, or delete the tile |
| `index.html` | `[[PHONE NUMBER]]`, `[[EMAIL ADDRESS]]` | Real contact details (also in the `href`) |
| `about.html` | `[[TITLE]]`, `[[BIO]]`, `[[CREDENTIAL]]` | Larry's and Landon's real roles, backgrounds, certifications |
| `about.html` | `[[TIMELINE]]` | Real engagement duration range |

**Do not invent credentials.** In a compliance business, an overstated certification is a liability, not a marketing flourish.

### 2. Configure Stripe

In `payment.html`, two lines near the bottom:

```js
var STRIPE_PUBLISHABLE_KEY = 'pk_test_REPLACE_ME';   // your publishable key
var API_BASE               = 'http://localhost:4242'; // '' if same origin
```

The publishable key is safe to expose — that's what "publishable" means. The **secret key** goes only in the server's `.env` file and never in any HTML file, ever.

### 3. Connect the lead form

The home page form validates input but does not send anywhere yet; it says so on submit. Point it at Formspree, Netlify Forms, or your own endpoint. Look for the comment `Wire action/fetch to a real endpoint` in `index.html`.

### 4. Stand up the backend

`server.js` is the contract. If you already have a Stripe backend, don't run this file — make yours match these three routes:

```
GET  /api/invoice/:ref              → { ref, practice, description, mode, amountCents, currency }
POST /api/create-checkout-session   → { clientSecret }        body: { ref }
GET  /api/session-status?session_id → { status, paymentStatus, email, ref }
```

To run the reference server:

```bash
npm install               # reads package.json
cp .env.example .env      # then open .env and fill in your keys
npm start                 # API on :4242
```

In a second terminal, serve the static pages and forward webhooks:

```bash
npm run serve             # site on :5500
npm run stripe:listen     # prints the whsec_... for your .env
```

Add real invoices to the `INVOICES` object in `server.js` (samples are commented out), then swap that object for a database table when manual entry gets tedious.

**On secrets:** `.env` holds your Stripe secret key and is git-ignored. `.env.example` is the committed template and must never contain a real key. If a secret key is ever committed, pushed, or pasted into a screenshot, roll it immediately in the Stripe dashboard — rotating is free, a compromised key is not.

### 5. Test before taking real money

Use Stripe test mode and card `4242 4242 4242 4242`, any future expiry, any CVC. Verify all four outcomes:

- Valid reference → confirmation screen shows the right amount
- Unknown reference → clear "we couldn't find that" message
- Successful payment → green success screen and an email receipt
- Cancelled payment → returns cleanly, nothing charged

### 6. Deploy

Any static host serves the three HTML files: Netlify, Vercel, Cloudflare Pages, GitHub Pages. Drag the folder in. The backend needs a Node host — Render, Railway, or Fly.io. Set `SITE_URL` on the backend to your live domain, and `API_BASE` in `payment.html` to your live backend URL.

---

## Part 3 — Technical notes

### Design system

Refined neumorphic. Soft extruded surfaces for *containers*; solid high-contrast fills for *text and controls*.

```
clay      #E4E8EF   base surface
sunken    #D7DCE5   inset wells
ink       #0F1B2D   primary text      14.06:1 on clay
ink2      #3F4E63   secondary text     6.89:1 on clay
ink3      #526176   muted text         5.13:1 on clay
teal      #0B5563   CTA fill           8.42:1 with white text
```

Neumorphism's structural flaw is that it wants everything to be the same colour as the background — which destroys contrast. Every colour pair above was verified numerically against WCAG 2.1 AA (4.5:1 body, 3:1 large text and UI boundaries) before any markup was written. Buttons are solid teal with white text, never clay-on-clay.

Shadows are a fixed set of six (`raise`, `raise-sm`, `raise-lg`, `inset`, `inset-sm`, `cta`) defined once in the Tailwind config. Consistency reads as intentional; ad-hoc shadow values read as noise.

### Accessibility

- Skip-to-content link on every page
- Visible 3px focus ring on all interactive elements — never removed
- All touch targets ≥ 44×44px
- Semantic HTML (`nav`, `main`, `dl`, `details`, real `<label>`s); ARIA only where the DOM can't express intent
- `prefers-reduced-motion` fully honoured — reveal animations and spinners are disabled, not merely shortened
- Async states announced via `role="status" aria-live="polite"`
- Status is never conveyed by colour alone — every state carries an icon and text

### Known tradeoff: Tailwind via CDN

The brief specified the Tailwind CDN, so that's what's here. It costs ~50KB of JavaScript, compiles styles in the browser, and logs a console warning. It is fine for launch and for demos.

When traffic justifies it, compile the CSS instead:

```bash
npm i -D tailwindcss
npx tailwindcss -i input.css -o dist.css --minify
```

Then swap the two `<script>` tags for `<link rel="stylesheet" href="dist.css">`. Roughly 10KB of CSS, zero JavaScript, no flash of unstyled content.

### Known tradeoff: duplicated head blocks

The Tailwind config and base styles are repeated in all three files. That's the price of having no build step — the design tokens live in three places, so a colour change means three edits. Acceptable at three pages; the moment there's a fourth, move to a build step or a template.

### Competitive positioning

The comparison section on the home page contrasts SBAS with "the traditional SRA firm" rather than naming Due North Security directly. This is deliberate. Named comparative advertising invites a disparagement claim and requires every stated fact about the competitor to be substantiated and kept current. The generic framing makes the same argument and carries none of that exposure.

---

## Files

```
index.html    Home page
about.html    About page
payment.html  Payment page + Stripe Embedded Checkout
server.js     Backend contract (reference implementation)
README.md     This file
```

**Legal note:** SBAS Info LLC will need its own Terms of Service and, if the compliance deliverables are ever productized, an EULA. That's a drafting task for a lawyer, not a coding task — but it should happen before the first sale.
