# Visual design

The look of everything people see: the portal and the school websites (`apps/web`), the sign-in pages and their e-mails (Keycloak), the website editor (`apps/cms`), the development payment page and the notification e-mails (`apps/api`). It takes the layout of the school-management products families and staff already know (a dark sidebar, a dashboard of tiles) and makes it calmer and more modern: a deep ink frame, one violet accent with a few supporting hues, generous rounding and soft depth.

The portal and websites share one stylesheet, `apps/web/app/globals.css`. There is no CSS framework and no build step for styles. The other surfaces copy the same tokens (see [Every surface](#every-surface)).

The look is called Blueprint and chalk: deep navy, electric blue, a little pencil yellow and graph-paper backgrounds, so it reads as modern and technical and still as a school.

## Principles

- **The pages stay plain HTML.** Most pages are semantic markup (`main`, `section`, `article`, `details`, `table`, `form`, `[role=status]`), and the stylesheet styles those elements directly. A new page looks right without class names; classes are only for the dashboard and the shell.
- **No external fonts or assets.** Fonts come from the operating system (Segoe UI Variable on Windows, San Francisco on Apple devices, the system sans-serif elsewhere); Inter is used only if the device already has it. Loading Google Fonts or a CDN would send every visitor's address to a third party (GDPR), so nothing is fetched from outside the platform. The logo is an inline SVG (`app/brand.tsx`) and icons are bundled from `lucide-react` (ISC licence).
- **The sidebar is a guide, not a permission.** `lib/navigation.ts` builds the links from what the API says the person is, the same as the home page. Every page still asks the API, which decides what the person may see.
- **Accessible by default.** Text meets WCAG AA contrast on its background; focus is a visible blue ring (`--focus`); the current page is marked with `aria-current="page"`, not only by colour; icons are `aria-hidden` next to a text label; motion is turned off under `prefers-reduced-motion`.

## Tokens

Defined on `:root` in `globals.css`.

| Group | Tokens | Use |
| --- | --- | --- |
| Ink | `--ink-950` … `--ink-700` | Sidebar, hero banner, headings |
| Accent | `--accent-800` … `--accent-50` | Electric blue: buttons, links, the current page, focus |
| Pencil | `--pencil` | A touch of school yellow on marks and the brand, never for text |
| Paper | `--font-mono`, `--grid-light`, `--grid-dark`, `--grid-size` | Monospaced figures and the graph-paper backgrounds |
| Supporting hues | `--teal-*`, `--amber-*`, `--rose-*`, `--sky-*`, `--green-*` (600 and 50) | Tile icons and notices; never as the only signal |
| Surfaces | `--canvas`, `--surface`, `--surface-soft`, `--border`, `--border-strong` | Page background, cards, dividers |
| Text | `--text`, `--text-soft`, `--muted` | Body, secondary and quiet text |
| Shape | `--radius-xl` (22) … `--radius-sm` (8), `--shadow-sm`, `--shadow-md`, `--shadow-glow` | Cards, tiles, buttons |

## Components

| Component | Where | Notes |
| --- | --- | --- |
| Application shell | `app/app-shell.tsx`, `.shell`, `.sidebar`, `.topbar` | Shown by `app/layout.tsx` to anyone signed in. Sidebar groups from `lib/navigation.ts`; the top bar holds the language switch (EN / BG, `app/language-switch.tsx`), notifications, who is signed in and signing out |
| Navigation link | `app/nav-link.tsx`, `.nav-link` | Client component; marks the current page with `aria-current` (`isCurrent` in `lib/navigation.ts`) |
| Hero | `.hero`, `.eyebrow`, `.chips` | The dashboard greeting with today's date and the person's roles |
| Tiles | `.tiles`, `.tile`, `.tile-icon` (`.teal`, `.amber`, `.rose`, `.sky`, `.green`) | One per page the person can reach |
| Child card | `.card-grid`, `.child-card`, `.action-chips` | A parent's children with links for each |
| Cards | `main > section`, `article`, `details`, `form`, `table`, `.card` | Automatic for the plain pages |
| Buttons | `button`, `.button` | Solid electric blue; quieter inside list rows and tables |
| Notices | `[role=status]` (green), `[role=alert]` (rose), `[data-testid=not-permitted]` (amber), `.dev-banner` | The development banner stays on every page while the build uses synthetic data |
| Sign-in page | `.auth-page`, `.auth-card` | What a signed-out visitor sees |
| Website frame | `app/sites/site-frame.tsx`, `.site-header`, `.site-footer` | The school's name and CMS menu, the Family portal button, a footer with the group's schools |
| Website hero and highlights | `.site-hero`, `.site-banner`, `.site-highlights`, `.prose` | The start page's banner and the platform's own services for families; CMS text in a reading card. Only facts the platform knows, never invented claims about a school |
| Inquiry form | `.inquiry-form`, `.notice-panel` | Two columns of fields; the privacy notice and the agreements across |
| Figures | `.stats`, `.stat-value`, `.stat-label` | A row of headline numbers at the top of a page |
| Badges and meters | `.badge` (`.ok`, `.warn`, `.full`), `.meter` (`.warn`, `.full`, `--value`) | Places taken and budgets used; the words beside them carry the meaning, not the colour |
| Class cards | `.class-grid`, `.class-head`, `.class-name`, `.seats` | Each class with its places |
| Timetable | `app/timetable-grid.tsx`, `.timetable`, `.lesson` (`.tone-1` … `.tone-6`), `.view-switch` | A week across the page, one column a day on a phone |
| Register and grades | `.register`, `.marks`, `.grades` (`.grade-2` … `.grade-6`) | One row per child; the marks are real radio buttons |
| Group overview | `.school-card`, `.facts` | Every school on one screen (`/group`) |
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

Below 960px the sidebar folds behind a Menu button (a plain checkbox and label, so it works without JavaScript) and the dashboard grids drop to fewer columns. Timetables show one column a day, wide tables scroll inside their own card, and the page itself never scrolls sideways. On the websites the header and blocks stack.

## Adding a page

Write semantic HTML. Use `<p><Link href="/">← Home</Link></p>` as the first line for the breadcrumb, `<section>` for each block and `<table>` for lists of records. Add the page to `lib/navigation.ts` (and its test) if it should appear in the sidebar, and to the home page if it deserves a tile.
