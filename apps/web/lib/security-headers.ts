// The headers on every portal and website response (next.config.ts).

export const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Nothing goes to other sites (the callback URL carries a one-time code).
  // Not "no-referrer": browsers then send "Origin: null" with every form post,
  // and the action routes refuse a post that does not come from the portal.
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];
