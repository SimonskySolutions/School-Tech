import { type SiteInfo } from '@pythagoras/shared';
import Link from 'next/link';
import { type ReactNode } from 'react';
import { siteUrl } from '../../lib/sites';
import { Logo } from '../brand';
import { Icon } from '../icons';

// The frame of a public school or group website (docs/design.md): the school's
// name and menu, a way into the family portal, and a footer with the schools.

const TAGLINE: Record<SiteInfo['purpose'], string> = {
  school: 'Part of the Pythagoras school group',
  group: 'School group',
  family_portal: 'Family portal',
  campaign: 'Pythagoras school group',
};

export function SiteHeader({
  site,
  links,
  portalUrl,
}: {
  site: Pick<SiteInfo, 'name' | 'purpose'>;
  links: { href: string; title: string }[];
  portalUrl: string;
}) {
  return (
    <header className="site-header" data-testid="site-header">
      <div className="site-bar">
        <Link href="/" className="site-brand">
          <Logo size={40} />
          <span>
            {site.name}
            <small>{TAGLINE[site.purpose]}</small>
          </span>
        </Link>
        {links.length > 1 ? (
          <nav aria-label="Website" className="site-nav">
            <ul>
              {links.map((link) => (
                <li key={link.href}>
                  <a href={link.href}>{link.title}</a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <a href={portalUrl} className="button site-portal">
          <Icon name="home" size={16} /> Family portal
        </a>
      </div>
    </header>
  );
}

export function SiteFooter({
  site,
  portalUrl,
  children,
}: {
  site: Pick<SiteInfo, 'name' | 'schools'>;
  portalUrl: string;
  children?: ReactNode;
}) {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div>
          <span className="site-brand">
            <Logo size={34} />
            <span>{site.name}</span>
          </span>
          <p>
            Parents book lunch and clubs in the <a href={portalUrl}>Pythagoras family portal</a>.
          </p>
          {children}
        </div>
        {site.schools.length > 1 ? (
          <div>
            <h2>Our schools</h2>
            <ul>
              {site.schools.map((school) => (
                <li key={school.name}>
                  {school.host ? <a href={siteUrl(school.host, portalUrl)}>{school.name}</a> : school.name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <p className="site-legal">{`© ${new Date().getFullYear()} Pythagoras school group`}</p>
    </footer>
  );
}
