'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';
import { isCurrent } from '../lib/navigation';

/** A sidebar link that marks itself when it is the page being shown. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  return (
    <Link href={href} className="nav-link" aria-current={isCurrent(href, path) ? 'page' : undefined}>
      {children}
    </Link>
  );
}
