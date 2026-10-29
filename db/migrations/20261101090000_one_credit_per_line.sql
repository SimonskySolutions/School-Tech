-- migrate:up

-- A cancelled or unplaceable order line is turned into credit at most once
-- (ADR 0008, 0010). The worker checks before issuing; this index makes a
-- second credit for the same line impossible even if two deliveries of the
-- same event race.
DROP INDEX commerce.account_credit_source_line_idx;
-- Credits without a source line (NULL) stay allowed in any number: NULLs are distinct.
CREATE UNIQUE INDEX account_credit_one_per_line ON commerce.account_credit (source_order_line_id);

-- migrate:down
DROP INDEX commerce.account_credit_one_per_line;
CREATE INDEX account_credit_source_line_idx ON commerce.account_credit (source_order_line_id);
