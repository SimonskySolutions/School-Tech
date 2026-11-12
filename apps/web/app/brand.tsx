/**
 * The Pythagoras mark: a right triangle with the squares on its sides, the
 * theorem the group is named after. Drawn inline, so it needs no request.
 */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Pythagoras" focusable="false">
      <defs>
        <linearGradient id="pyth-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5480ff" />
          <stop offset="1" stopColor="#2546db" />
        </linearGradient>
        <linearGradient id="pyth-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#35d6c4" />
          <stop offset="1" stopColor="#0b9e91" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="13" fill="#0e1738" />
      {/* The square on the hypotenuse, tilted along it. */}
      <path d="M18 26 L30 14 L38 22 L26 34 Z" fill="url(#pyth-a)" />
      {/* The squares on the two legs. */}
      <rect x="10" y="26" width="8" height="8" rx="1.5" fill="url(#pyth-b)" />
      <rect x="18" y="34" width="8" height="8" rx="1.5" fill="#ffc93c" />
      {/* The triangle itself. */}
      <path d="M18 26 L18 34 L26 34 Z" fill="#ffffff" />
    </svg>
  );
}
