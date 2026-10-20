import Link from 'next/link';
import { getUser } from '@/lib/session';
import { ButtonLink } from '@/components/ui';

const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/for-families', label: 'For families' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
];

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-ink">
            <Logo />
            CareCircle
          </Link>
          <nav aria-label="Main" className="order-3 w-full sm:order-2 sm:w-auto">
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[0.95rem] font-medium text-muted">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-accent">{item.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
            {user ? (
              <ButtonLink href="/dashboard" variant="primary">Open CareCircle</ButtonLink>
            ) : (
              <>
                <ButtonLink href="/login" variant="ghost">Sign in</ButtonLink>
                <ButtonLink href="/signup" variant="primary">Get started free</ButtonLink>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">{children}</main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="flex items-center gap-2 font-bold text-ink"><Logo />CareCircle</p>
            <p className="mt-2 text-sm text-muted">
              Your family&rsquo;s care, coordinated. Built for families in India.
            </p>
          </div>
          <FooterCol title="Product" links={NAV} />
          <FooterCol title="Legal" links={[
            { href: '/privacy', label: 'Privacy policy (draft)' },
            { href: '/terms', label: 'Terms of service (draft)' },
            { href: '/contact', label: 'Contact' },
          ]} />
          <div>
            <p className="font-semibold text-ink">Status of this build</p>
            <p className="mt-2 text-sm text-muted">
              A local development build. It stores data on this machine only, needs no external
              accounts, and is not approved for use with real patient information.
            </p>
          </div>
        </div>
        <div className="border-t border-line px-4 py-5 text-center text-sm text-muted">
          <p>
            CareCircle organises healthcare administration. It is not a medical device, does not
            give clinical advice, and is not an emergency service.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <p className="font-semibold text-ink">{title}</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-muted hover:text-accent">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" className="shrink-0">
      <circle cx="13" cy="13" r="11.5" fill="none" stroke="var(--accent)" strokeWidth="2.2" />
      <path d="M13 18.2s-4.6-2.9-4.6-6.1A2.9 2.9 0 0 1 13 9.9a2.9 2.9 0 0 1 4.6 2.2c0 3.2-4.6 6.1-4.6 6.1Z"
            fill="var(--accent)" />
    </svg>
  );
}
