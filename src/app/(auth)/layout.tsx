import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-ink">
            <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
              <circle cx="13" cy="13" r="11.5" fill="none" stroke="var(--accent)" strokeWidth="2.2" />
              <path d="M13 18.2s-4.6-2.9-4.6-6.1A2.9 2.9 0 0 1 13 9.9a2.9 2.9 0 0 1 4.6 2.2c0 3.2-4.6 6.1-4.6 6.1Z"
                    fill="var(--accent)" />
            </svg>
            CareCircle
          </Link>
        </div>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
