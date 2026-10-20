import Link from 'next/link';
import { getSettings, requireUser } from '@/lib/session';
import { unreadCount } from '@/lib/reminders';
import { nudgeScheduler } from '@/lib/scheduler-hook';
import { translator, type MessageKey } from '@/lib/i18n';
import { signOutAction } from '@/app/actions/auth';

const NAV: { href: string; key: MessageKey; icon: string }[] = [
  { href: '/dashboard', key: 'nav.dashboard', icon: '◉' },
  { href: '/planner', key: 'nav.planner', icon: '✓' },
  { href: '/appointments', key: 'nav.appointments', icon: '▣' },
  { href: '/records', key: 'nav.records', icon: '⬓' },
  { href: '/medications', key: 'nav.medications', icon: '◈' },
  { href: '/family', key: 'nav.family', icon: '⬟' },
  { href: '/assistant', key: 'nav.assistant', icon: '✦' },
  { href: '/activity', key: 'nav.activity', icon: '≡' },
  { href: '/settings', key: 'nav.settings', icon: '⚙' },
];

// Shown in the mobile bottom bar; the rest stay in the "More" row.
const PRIMARY = new Set(['/dashboard', '/planner', '/records', '/medications']);

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await getSettings();
  nudgeScheduler();
  const unread = unreadCount(user.id);
  const t = translator(settings.locale);

  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[16rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden border-r border-line bg-surface lg:flex lg:flex-col">
        <div className="border-b border-line px-5 py-4">
          <Link href="/dashboard" className="flex items-center gap-2 text-lg font-bold tracking-tight text-ink">
            <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
              <circle cx="13" cy="13" r="11.5" fill="none" stroke="var(--accent)" strokeWidth="2.2" />
              <path d="M13 18.2s-4.6-2.9-4.6-6.1A2.9 2.9 0 0 1 13 9.9a2.9 2.9 0 0 1 4.6 2.2c0 3.2-4.6 6.1-4.6 6.1Z"
                    fill="var(--accent)" />
            </svg>
            CareCircle
          </Link>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href} icon={item.icon} label={t(item.key)} />
              </li>
            ))}
            <li>
              <NavLink href="/notifications" icon="◔" label={t('nav.notifications')} badge={unread} />
            </li>
          </ul>
        </nav>
        <div className="border-t border-line p-3">
          <p className="px-3 py-1 text-sm font-semibold text-ink">{user.full_name}</p>
          <p className="truncate px-3 text-xs text-muted">{user.email}</p>
          <form action={signOutAction} className="mt-2">
            <button type="submit"
              className="w-full rounded-card px-3 py-2 text-left text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink">
              {t('action.signOut')}
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold text-ink">
          <svg width="24" height="24" viewBox="0 0 26 26" aria-hidden="true">
            <circle cx="13" cy="13" r="11.5" fill="none" stroke="var(--accent)" strokeWidth="2.2" />
            <path d="M13 18.2s-4.6-2.9-4.6-6.1A2.9 2.9 0 0 1 13 9.9a2.9 2.9 0 0 1 4.6 2.2c0 3.2-4.6 6.1-4.6 6.1Z"
                  fill="var(--accent)" />
          </svg>
          CareCircle
        </Link>
        <Link href="/notifications"
          className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-card px-3 text-sm font-semibold text-ink">
          <span aria-hidden="true">◔</span>
          <span className="sr-only">{t('nav.notifications')}</span>
          {unread > 0 ? (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-ink">
              {unread}
              <span className="sr-only"> unread</span>
            </span>
          ) : null}
        </Link>
        <Link href="/settings" className="inline-flex min-h-11 items-center rounded-card px-3 text-sm font-semibold text-ink">
          <span aria-hidden="true">⚙</span><span className="sr-only">{t('nav.settings')}</span>
        </Link>
      </header>

      <div className="flex min-w-0 flex-col">
        <main id="main" className="min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-10 lg:pt-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>

      {/* Mobile bottom bar: large targets, labels always visible */}
      <nav aria-label="Main"
        className="fixed bottom-0 left-0 right-0 z-20 border-t border-line bg-surface lg:hidden">
        <ul className="grid grid-cols-5">
          {NAV.filter((n) => PRIMARY.has(n.href)).map((item) => (
            <li key={item.href}>
              <Link href={item.href}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[0.7rem] font-semibold text-muted">
                <span aria-hidden="true" className="text-base">{item.icon}</span>
                <span className="text-center leading-tight">{t(item.key)}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link href="/family"
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[0.7rem] font-semibold text-muted">
              <span aria-hidden="true" className="text-base">⬟</span>
              <span className="text-center leading-tight">{t('nav.family')}</span>
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}

function NavLink({ href, icon, label, badge }: {
  href: string; icon: string; label: string; badge?: number;
}) {
  return (
    <Link href={href}
      className="flex min-h-11 items-center gap-3 rounded-card px-3 py-2 text-[0.95rem] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink">
      <span aria-hidden="true" className="w-5 text-center text-accent">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge && badge > 0 ? (
        <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-ink">
          {badge}<span className="sr-only"> unread</span>
        </span>
      ) : null}
    </Link>
  );
}
