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

## Consequences

- Switching to Stripe means: create the account, put the test keys and webhook secret in the secret store, set `PAYMENT_PROVIDER=stripe`, register the webhook URL. The steps go in `docs/operations.md`.
- The integration register lists Stripe as "built, not validated" until a real test-mode payment has gone through.
