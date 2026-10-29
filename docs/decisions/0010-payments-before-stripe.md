# 0010 Payments built for Stripe, run on a development provider until it is set up

Date: 2026-10-29 · Status: Accepted (Stripe is not being set up yet)

## Context

The network will use Stripe hosted checkout later, but no Stripe account exists now. The payment journey (reserve, checkout, verified provider event, confirmation by the worker) must still be built and tested end to end, without pretending payments are real.

## Decision

- The API talks to payments through one interface, the **payment provider port**: create a hosted checkout, verify and parse a provider event, fetch the authoritative payment state, issue a refund.
- Two adapters implement it:
  - **`stripe`**: the real adapter (Checkout Sessions, webhook signature verification, payment and refund retrieval). It is built and unit-tested against Stripe's documented formats, but it stays **disabled** until test-mode keys are configured. It cannot be enabled by accident: the API refuses to start with `PAYMENT_PROVIDER=stripe` and no keys.
  - **`development`**: a local simulator, clearly labelled "Development payment, no money moves", with its own checkout page (succeed, fail, abandon) that sends HMAC-signed events to the same webhook path. It exists to exercise the real flow: signature checks, duplicates, out-of-order events, failures, expiry and late payment.
- The database already supports both (`commerce.payment.provider`, `integration.inbound_event.provider`); the `development` value is added by migration when the adapter is built.
- Reports and the family portal label development payments, and the development provider refuses to start when `NODE_ENV=production`.

## As built (M2, 2026-10-29)

- The port has two operations so far: create a hosted checkout, and verify a webhook. Parsing a stored event into a payment outcome is a pure function per provider, used by the worker, so the worker needs no provider keys. Fetching the authoritative payment state and refunds are not built yet.
- Both providers sign webhooks with the scheme Stripe documents (`t=<time>,v1=<HMAC-SHA256 of "time.body">`, five minutes of tolerance), so one verification path is tested by both. The development provider derives separate keys for checkout tokens and webhooks from `DEV_PAYMENTS_SECRET`; its checkout token is stateless and signed, so it cannot be altered to pay a different amount.
- The browser's return from the provider changes nothing. Only the worker, after a verified and stored event, marks a payment succeeded. Events are applied in PostgreSQL, not through Redis, because provider payloads can contain personal data (ADR 0002, 0006).
- A failed payment releases the seats at once (the parent books again). An expired reservation releases them too, but a late success is still accepted: the line is confirmed if a seat is free, and otherwise the amount becomes credit with the same billing entity.
- The provider's checkout URL is kept on the payment (`checkout_url`) so the order page can offer "Pay now" again while the order holds its seats.

## Consequences

- Switching to Stripe means: create the account, put the test keys and webhook secret in the secret store, set `PAYMENT_PROVIDER=stripe`, register the webhook URL. The steps are in `docs/operations.md` (Payments).
- The integration register lists Stripe as "built, not validated" until a real test-mode payment has gone through.
