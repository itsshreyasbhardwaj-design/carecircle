import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getSettings } from '@/lib/session';

export const metadata: Metadata = {
  title: { default: 'CareCircle — Your family\'s care, coordinated.', template: '%s · CareCircle' },
  description:
    'One secure place to organise medical records, appointments, medication routines and family caregiving responsibilities.',
  applicationName: 'CareCircle',
  robots: { index: false, follow: false }, // local development build
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1620' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Theme, text size and motion come from the user's saved settings and are
  // rendered as attributes on <html>, so there is no flash and no client script.
  const settings = await getSettings();
  return (
    <html
      lang={settings.locale}
      data-theme={settings.theme === 'system' ? undefined : settings.theme}
      data-text={settings.large_text ? 'large' : undefined}
      data-motion={settings.reduce_motion ? 'reduced' : undefined}
      suppressHydrationWarning
    >
      <body>
        <a className="cc-skip" href="#main">Skip to main content</a>
        {children}
      </body>
    </html>
  );
}
