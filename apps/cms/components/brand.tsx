// The Pythagoras mark in the website editor (docs/design.md): the same drawing
// as the portal's logo (apps/web/app/brand.tsx), inline so it needs no request.

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Pythagoras" focusable="false">
      <defs>
        <linearGradient id="cms-pyth-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5480ff" />
          <stop offset="1" stopColor="#2546db" />
        </linearGradient>
        <linearGradient id="cms-pyth-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#35d6c4" />
          <stop offset="1" stopColor="#0b9e91" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="13" fill="#0e1738" />
      <path d="M18 26 L30 14 L38 22 L26 34 Z" fill="url(#cms-pyth-a)" />
      <rect x="10" y="26" width="8" height="8" rx="1.5" fill="url(#cms-pyth-b)" />
      <rect x="18" y="34" width="8" height="8" rx="1.5" fill="#ffc93c" />
      <path d="M18 26 L18 34 L26 34 Z" fill="#ffffff" />
    </svg>
  );
}

/** On the sign-in page. */
export function Logo() {
  return (
    <div className="pyth-logo">
      <Mark size={64} />
      <div>
        <strong>Pythagoras</strong>
        <span>School websites</span>
      </div>
    </div>
  );
}

/** In the navigation. */
export function Icon() {
  return <Mark size={28} />;
}
