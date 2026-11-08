// Pages answered as plain HTML rather than through React (the one-time
// password page): the same look as the portal (docs/design.md), with the
// styles inline so the page needs no other request.

/** The Pythagoras mark (app/brand.tsx) as markup. */
export const LOGO_SVG = `<svg width="52" height="52" viewBox="0 0 48 48" role="img" aria-label="Pythagoras">
<defs><linearGradient id="pa" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5480ff"/><stop offset="1" stop-color="#2546db"/></linearGradient>
<linearGradient id="pb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#35d6c4"/><stop offset="1" stop-color="#0b9e91"/></linearGradient></defs>
<rect x="2" y="2" width="44" height="44" rx="13" fill="#0e1738"/><path d="M18 26 L30 14 L38 22 L26 34 Z" fill="url(#pa)"/>
<rect x="10" y="26" width="8" height="8" rx="1.5" fill="url(#pb)"/><rect x="18" y="34" width="8" height="8" rx="1.5" fill="#ffc93c"/>
<path d="M18 26 L18 34 L26 34 Z" fill="#fff"/></svg>`;

const STYLE = `*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;line-height:1.55;
font-family:'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif;color:#121a33;
background:radial-gradient(60% 60% at 15% 10%,rgb(84 128 255/35%),transparent 60%),radial-gradient(50% 50% at 90% 90%,rgb(11 158 145/25%),transparent 60%),#080e26}
.card{width:min(520px,100%);background:#fff;border-radius:22px;padding:34px;box-shadow:0 30px 80px -20px rgb(0 0 0/55%)}
h1{font-size:1.6rem;letter-spacing:-.02em;margin:14px 0 8px;color:#0e1738}
p{margin:0 0 .85em;color:#414b6b}
a{color:#2f5bf5;font-weight:600;text-decoration:none}a:hover{text-decoration:underline}
code{font-family:ui-monospace,'Cascadia Code',Menlo,monospace;background:#f0f4ff;color:#1b36b5;padding:.15em .45em;border-radius:6px}
.secret{display:block;margin-top:6px;padding:12px 14px;font-size:1.25rem;letter-spacing:.04em;border:1px dashed #aac1ff;word-break:break-all}
.dev{display:inline-flex;gap:8px;padding:6px 12px;border-radius:999px;background:#fff6e0;color:#8a5a00;border:1px solid #f5d68f;font-size:.8rem;font-weight:600}
.button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:10px 18px;border-radius:10px;color:#fff;
background:linear-gradient(135deg,#5480ff,#2546db);box-shadow:0 4px 14px -6px rgb(47 91 245/60%)}
.button:hover{text-decoration:none;filter:brightness(1.05)}`;

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A whole page: the card with the logo, the development notice, then `body` (already escaped HTML). */
export function standalonePage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<style>${STYLE}</style></head>
<body><main class="card">${LOGO_SVG}
<h1>${escape(title)}</h1>${body}
<p style="margin:18px 0 0"><span class="dev">● Development build with synthetic data.</span></p></main></body></html>`;
}
