import Link from 'next/link';
import { type ReactNode } from 'react';
import { type HomeView } from '../lib/home';
import { type Messages } from '../lib/i18n/messages';
import { initials, navigation } from '../lib/navigation';
import { Logo } from './brand';
import { Icon } from './icons';
import { LanguageSwitch } from './language-switch';
import { NavLink } from './nav-link';

/**
 * The frame around every page for a signed-in person (docs/design.md): the
 * sidebar with what they can reach, and a top bar with the language, notifications,
 * who is signed in and signing out.
 */
export function AppShell({
  view,
  person,
  text,
  children,
}: {
  view: HomeView;
  person: { givenName: string; familyName: string };
  text: Messages;
  children: ReactNode;
}) {
  const groups = navigation(view, text);
  const roles = [...view.groupRoles, ...view.schoolRoles.map((role) => role.role)];
  return (
    <div className="shell">
      <aside className="sidebar" aria-label={text.shell.mainLabel}>
        <Link href="/" className="brand">
          <Logo />
          <span>
            {text.shell.brand}
            <small>{text.shell.tagline}</small>
          </span>
        </Link>
        <input id="nav-toggle" type="checkbox" className="nav-toggle" aria-label={text.shell.menu} />
        <label htmlFor="nav-toggle" className="nav-toggle-button" aria-hidden="true">
          <Icon name="menu" />
        </label>
        <nav aria-label={text.shell.sectionsLabel} className="sidebar-nav">
          {groups.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink key={`${group.label}-${item.href}`} href={item.href}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">{text.shell.footer}</div>
      </aside>
      <div className="content">
        <header className="topbar">
          <span className="topbar-title">
            {roles.length > 0 ? roles.join(' · ') : text.shell.familyPortal}
          </span>
          <div className="topbar-actions">
            <LanguageSwitch />
            <Link
              href="/notifications"
              className="icon-button"
              aria-label={text.shell.notifications}
              data-testid="notifications-link"
            >
              <Icon name="bell" />
            </Link>
            <span className="user-chip">
              <span className="avatar">{initials(person.givenName, person.familyName)}</span>
              {`${person.givenName} ${person.familyName}`}
            </span>
            <form method="post" action="/auth/sign-out" className="sign-out-form">
              <button type="submit" data-testid="sign-out">
                {text.shell.signOut}
              </button>
            </form>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
