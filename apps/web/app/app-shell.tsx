import Link from 'next/link';
import { type ReactNode } from 'react';
import { type HomeView } from '../lib/home';
import { initials, navigation } from '../lib/navigation';
import { Logo } from './brand';
import { Icon } from './icons';
import { NavLink } from './nav-link';

/**
 * The frame around every page for a signed-in person (docs/design.md): the
 * sidebar with what they can reach, and a top bar with notifications, who is
 * signed in and signing out.
 */
export function AppShell({
  view,
  person,
  children,
}: {
  view: HomeView;
  person: { givenName: string; familyName: string };
  children: ReactNode;
}) {
  const groups = navigation(view);
  const roles = [...view.groupRoles, ...view.schoolRoles.map((role) => role.role)];
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main">
        <Link href="/" className="brand">
          <Logo />
          <span>
            Pythagoras
            <small>School group</small>
          </span>
        </Link>
        <nav aria-label="Sections" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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
        <div className="sidebar-foot">Synthetic data · development build</div>
      </aside>
      <div className="content">
        <header className="topbar">
          <span className="topbar-title">{roles.length > 0 ? roles.join(' · ') : 'Family portal'}</span>
          <div className="topbar-actions">
            <Link
              href="/notifications"
              className="icon-button"
              aria-label="Notifications"
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
                Sign out
              </button>
            </form>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
