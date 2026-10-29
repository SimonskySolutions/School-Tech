// Redis must hold no personal data (ADR 0002, 0006). Outbox payloads are meant
// to carry identifiers and codes only; this guard refuses anything else before
// it leaves PostgreSQL. It catches the usual mistakes (a name, an e-mail, free
// text); it is not a substitute for reviewing what an event carries.

const SAFE_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_STRING = /^[A-Za-z0-9_.:-]{1,64}$/;
const PERSONAL_KEY =
  /(name|email|e_mail|phone|address|birth|dob|iban|card|note|comment|description|reason|message)/;
// Keys that name an identifier or a code (order_id, reason_code) are fine; their
// values are still held to SAFE_STRING.
const REFERENCE_KEY = /_(id|ids|code)$/;
const MAX_DEPTH = 3;

export function checkPayload(payload: unknown, depth = 0): string | null {
  if (payload === null || typeof payload === 'boolean') return null;
  if (typeof payload === 'number') return Number.isFinite(payload) ? null : 'non-finite number';
  if (typeof payload === 'string') {
    return SAFE_STRING.test(payload) ? null : 'a value that is not an identifier or code';
  }
  if (depth >= MAX_DEPTH) return 'nesting deeper than 3 levels';
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const problem = checkPayload(item, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  if (typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload)) {
      if (!SAFE_KEY.test(key)) return `key "${key.slice(0, 32)}" is not snake_case`;
      if (PERSONAL_KEY.test(key) && !REFERENCE_KEY.test(key)) return `key "${key}" suggests personal data`;
      const problem = checkPayload(value, depth + 1);
      if (problem) return `${key}: ${problem}`;
    }
    return null;
  }
  return `unsupported value of type ${typeof payload}`;
}
