# Visual design

The look of everything people see: the portal and the school websites (`apps/web`), the sign-in pages and their e-mails (Keycloak), the website editor (`apps/cms`), the development payment page and the notification e-mails (`apps/api`). It takes the layout of the school-management products families and staff already know (a dark sidebar, a dashboard of tiles) and makes it calmer and more modern: a deep ink frame, one violet accent with a few supporting hues, generous rounding and soft depth.

The portal and websites share one stylesheet, `apps/web/app/globals.css`. There is no CSS framework and no build step for styles. The other surfaces copy the same tokens (see [Every surface](#every-surface)).

## Principles

- **The pages stay plain HTML.** Most pages are semantic markup (`main`, `section`, `article`, `details`, `table`, `form`, `[role=status]`), and the stylesheet styles those elements directly. A new page looks right without class names; classes are only for the dashboard and the shell.
- **No external fonts or assets.** Fonts come from the operating system (Segoe UI Variable on Windows, San Francisco on Apple devices, the system sans-serif elsewhere); Inter is used only if the device already has it. Loading Google Fonts or a CDN would send every visitor's address to a third party (GDPR), so nothing is fetched from outside the platform. The logo is an inline SVG (`app/brand.tsx`) and icons are bundled from `lucide-react` (ISC licence).
- **The sidebar is a guide, not a permission.** `lib/navigation.ts` builds the links from what the API says the person is, the same as the home page. Every page still asks the API, which decides what the person may see.
- **Accessible by default.** Text meets WCAG AA contrast on its background; focus is a visible violet ring (`--focus`); the current page is marked with `aria-current="page"`, not only by colour; icons are `aria-hidden` next to a text label; motion is turned off under `prefers-reduced-motion`.

## Tokens

Defined on `:root` in `globals.css`.

| Group | Tokens | Use |
| --- | --- | --- |
| Ink | `--ink-950` … `--ink-700` | Sidebar, hero banner, headings |
| Violet | `--violet-800` … `--violet-50` | The accent: buttons, links, the current page, focus |
| Supporting hues | `--teal-*`, `--amber-*`, `--rose-*`, `--sky-*`, `--green-*` (600 and 50) | Tile icons and notices; never as the only signal |
| Surfaces | `--canvas`, `--surface`, `--surface-soft`, `--border`, `--border-strong` | Page background, cards, dividers |
| Text | `--text`, `--text-soft`, `--muted` | Body, secondary and quiet text |
| Shape | `--radius-xl` (22) … `--radius-sm` (8), `--shadow-sm`, `--shadow-md`, `--shadow-glow` | Cards, tiles, buttons |

## Components

| Component | Where | Notes |
| --- | --- | --- |
| Application shell | `app/app-shell.tsx`, `.shell`, `.sidebar`, `.topbar` | Shown by `app/layout.tsx` to anyone signed in. Sidebar groups from `lib/navigation.ts`; the top bar holds notifications, who is signed in and signing out |
| Navigation link | `app/nav-link.tsx`, `.nav-link` | Client component; marks the current page with `aria-current` (`isCurrent` in `lib/navigation.ts`) |
| Hero | `.hero`, `.eyebrow`, `.chips` | The dashboard greeting with today's date and the person's roles |
| Tiles | `.tiles`, `.tile`, `.tile-icon` (`.teal`, `.amber`, `.rose`, `.sky`, `.green`) | One per page the person can reach |
| Child card | `.card-grid`, `.child-card`, `.action-chips` | A parent's children with links for each |
| Cards | `main > section`, `article`, `details`, `form`, `table`, `.card` | Automatic for the plain pages |
| Buttons | `button`, `.button` | Gradient violet; quieter inside list rows and tables |
| Notices | `[role=status]` (green), `[role=alert]` (rose), `[data-testid=not-permitted]` (amber), `.dev-banner` | The development banner stays on every page while the build uses synthetic data |
| Sign-in page | `.auth-page`, `.auth-card` | What a signed-out visitor sees |
| Website frame | `app/sites/site-frame.tsx`, `.site-header`, `.site-footer` | The school's name and CMS menu, the Family portal button, a footer with the group's schools |
| Website hero and highlights | `.site-hero`, `.site-banner`, `.site-highlights`, `.prose` | The start page's banner and the platform's own services for families; CMS text in a reading card. Only facts the platform knows, never invented claims about a school |
| Inquiry form | `.inquiry-form`, `.notice-panel` | Two columns of fields; the privacy notice and the agreements across |
| Empty states | `.empty-state` | Not found (`app/not-found.tsx`) and a failed page (`app/error.tsx`), in the shell or on their own |

## Every surface

| Surface | Where | How it gets the look |
| --- | --- | --- |
| Portal and school websites | `apps/web/app` | `globals.css`; websites use `body.site` and no portal navigation |
| Sign-in, password reset and other Keycloak pages | `infra/keycloak/themes/pythagoras/login` | Keycloak's own login theme with `css/pythagoras.css` on top: colours, logo, card and buttons. Only styles change, so every field keeps its id. Selected by `loginTheme` in the realm file; dark mode is off, like the portal |
| Keycloak's e-mails | `infra/keycloak/themes/pythagoras/email/html/template.ftl` | A branded frame around Keycloak's wording (`emailTheme`) |
| Website editor | `apps/cms/components/brand.tsx`, `apps/cms/app/(payload)/custom.css` | The logo on the sign-in page and in the navigation, the accent on primary buttons, the dark sign-in backdrop |
| One-time password page | `apps/web/lib/standalone-page.ts` | Plain HTML with the styles inline |
| Development payment page | `apps/api/src/payments/dev-checkout.controller.ts` | Plain HTML with the styles inline; its policy allows no other request |
| Notification e-mails | `apps/api/src/notifications/email-html.ts` | An HTML part made from the template's text (ADR 0031), with the portal link as a button. Tables and inline styles only, because e-mail programs ignore style sheets and SVG; the text part stays |

The Keycloak theme is mounted into the development container (`compose.yaml`). The production Keycloak image must include `infra/keycloak/themes/pythagoras` (M8).

## Small screens

Below 960px the sidebar becomes a band across the top with the links wrapping, and the dashboard grids drop to fewer columns. On the websites the menu moves under the name and the footer and inquiry form become one column. Everything fits a phone width without horizontal scrolling.

## Adding a page

Write semantic HTML. Use `<p><Link href="/">← Home</Link></p>` as the first line for the breadcrumb, `<section>` for each block and `<table>` for lists of records. Add the page to `lib/navigation.ts` (and its test) if it should appear in the sidebar, and to the home page if it deserves a tile.
