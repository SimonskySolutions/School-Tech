# 0025 Uniforms: variants, prices and stock

Date: 2026-10-31 · Status: Accepted

## Context

The brief asks for uniforms with product variants and stock (M4.6). A product (a polo shirt) comes in variants (sizes, colours), each with its own price and its own stock at the school. Families buy through the same checkout as everything else; the school must never sell an item it does not have, unpaid orders must not hold stock forever, and staff hand items over and correct the stock count.

## Decision

- **A product is an offering of kind `uniform`; its variants are `catalog.product_variant` rows** (size, colour, SKU, low-stock threshold). Variants belong to one school, like the offering.
- **Each variant has its own price versions.** `catalog.price_version` gains an optional `variant_id`; uniqueness and the no-overlap rule are per offering and variant. An order line points at the variant's price version, so the agreed price is preserved exactly as for every other line. Queries for "the offering's current price" only read versions without a variant.
- **Stock is counted on the variant and can never be oversold.** `on_hand` (physically in the store), `reserved` (held by unpaid orders) and `allocated` (paid, not yet handed over), with the check `reserved + allocated <= on_hand`. Counters are kept by triggers on **stock reservations** (`commerce.stock_reservation`, one per order line, with a quantity), in the same transaction as the order: the variant row is locked, so two families buying the last item at the same moment cannot both get it (`PY019`).
- **Reservations follow the order**, exactly like session bookings: they expire with an unpaid order and are confirmed by the worker when the payment is confirmed; a late payment after the stock is gone becomes credit with the same company.
- **Handing over** (`commerce.hand_over_stock`, staff with `bookings.manage` at the school) moves a paid reservation to handed over and takes the items off `on_hand`. **Stock corrections** (`catalog.adjust_stock`, staff with `catalog.manage`: deliveries in, counted losses out, with a reason) are written to an append-only **stock ledger** (`catalog.stock_movement`), and a correction can never take `on_hand` below what is reserved or allocated.
- **Low stock**: the staff page lists variants whose free stock (`on_hand − reserved − allocated`) is at or below their threshold.

## Consequences

- Returns and exchanges of handed-over items are not modelled; a return is a stock correction plus a credit issued by finance.
- Stock is per school; moving items between schools is a correction out at one and in at the other.
- Uniforms are bought for a child (the order line names the child), which is what the hand-over list shows.
