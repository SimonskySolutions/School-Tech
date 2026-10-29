-- migrate:up

-- Revenue split by payment mode (ADR 0010): money from test-mode payments
-- (the development provider, Stripe test mode) is reported apart from live
-- money, so a report can never present test payments as real revenue. An
-- allocation counts as "test" when the order it belongs to was paid in test
-- mode; allocations of orders without any provider payment count as "live".
CREATE OR REPLACE VIEW reporting.school_revenue_daily WITH (security_invoker = true) AS
SELECT a.group_id,
       a.school_id,
       a.billing_entity_id,
       (a.allocated_at AT TIME ZONE s.time_zone)::date AS local_date,
       a.currency,
       coalesce(sum(a.amount_minor) FILTER (WHERE a.kind = 'payment'), 0)         AS received_minor,
       coalesce(sum(a.amount_minor) FILTER (WHERE a.kind = 'credit_applied'), 0)  AS paid_by_credit_minor,
       coalesce(-sum(a.amount_minor) FILTER (WHERE a.kind = 'refund'), 0)         AS refunded_minor,
       coalesce(-sum(a.amount_minor) FILTER (WHERE a.kind = 'credit_issued'), 0)  AS credited_minor,
       sum(a.amount_minor)                                                        AS net_minor,
       mode.payment_mode
FROM commerce.payment_allocation a
JOIN org.school s ON s.id = a.school_id
JOIN commerce.order_line l ON l.id = a.order_line_id
CROSS JOIN LATERAL (
  SELECT CASE WHEN EXISTS (SELECT 1 FROM commerce.payment p WHERE p.order_id = l.order_id AND p.provider_mode = 'test')
              THEN 'test' ELSE 'live' END AS payment_mode
) mode
GROUP BY a.group_id, a.school_id, a.billing_entity_id, (a.allocated_at AT TIME ZONE s.time_zone)::date, a.currency,
         mode.payment_mode;
COMMENT ON VIEW reporting.school_revenue_daily IS
  'Money allocated to each school per local day and payment mode. net = received + paid by credit - refunded - credited. Test-mode money is never real revenue.';

-- migrate:down
DROP VIEW reporting.school_revenue_daily;
CREATE VIEW reporting.school_revenue_daily WITH (security_invoker = true) AS
SELECT a.group_id,
       a.school_id,
       a.billing_entity_id,
       (a.allocated_at AT TIME ZONE s.time_zone)::date AS local_date,
       a.currency,
       coalesce(sum(a.amount_minor) FILTER (WHERE a.kind = 'payment'), 0)         AS received_minor,
       coalesce(sum(a.amount_minor) FILTER (WHERE a.kind = 'credit_applied'), 0)  AS paid_by_credit_minor,
       coalesce(-sum(a.amount_minor) FILTER (WHERE a.kind = 'refund'), 0)         AS refunded_minor,
       coalesce(-sum(a.amount_minor) FILTER (WHERE a.kind = 'credit_issued'), 0)  AS credited_minor,
       sum(a.amount_minor)                                                        AS net_minor
FROM commerce.payment_allocation a
JOIN org.school s ON s.id = a.school_id
GROUP BY a.group_id, a.school_id, a.billing_entity_id, (a.allocated_at AT TIME ZONE s.time_zone)::date, a.currency;
COMMENT ON VIEW reporting.school_revenue_daily IS 'Money allocated to each school per local day. net = received + paid by credit - refunded - credited.';
GRANT SELECT ON reporting.school_revenue_daily TO pyth_api;
