'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';
import { isCurrent } from '../lib/navigation';

/** On a phone the menu closes once a link is chosen (the page stays, so its checkbox would stay ticked). */
function closeMenu() {
  const toggle = document.getElementById('nav-toggle');
  if (toggle instanceof HTMLInputElement) toggle.checked = false;
}

/** A sidebar link that marks itself when it is the page being shown. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  return (
    <Link
      href={href}
      className="nav-link"
      aria-current={isCurrent(href, path) ? 'page' : undefined}
      onClick={closeMenu}
    >
      {children}
    </Link>
  );
}
