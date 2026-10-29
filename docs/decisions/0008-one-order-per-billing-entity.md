# 0008 One order and one checkout per billing entity

Date: 2026-10-29 · Status: Accepted

## Context

Schools may belong to different legal entities. A hosted checkout session collects money for one merchant account. Collecting one combined payment and redistributing it between independent companies would need a provider model that supports it (for example a marketplace or split-payment arrangement) and agreement from the accountants. That model is not validated.

## Decision

- Every order belongs to exactly one billing entity (`commerce.customer_order.billing_entity_id`, not null).
- A trigger rejects an order line whose offering is billed by a different entity.
- When a parent's basket spans entities, the API creates one order per entity, linked by a shared `checkout_group_id`, and the parent pays them as separate checkouts. The family portal must explain this ("2 payments: School A Ltd, School C Foundation").
- One entity can run several schools, so one order may still contain lines for several schools; each line keeps its own `school_id` for school-level reporting.

## Consequences

Revisit this record only after a payment provider's split-collection model has been validated with the accountants for the network's actual legal entities.
