'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string }; reset: () => void;
}) {
  useEffect(() => {
    // Logged to the server console only; nothing user-identifying is sent anywhere.
    console.error('CareCircle render error:', error.message);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Something went wrong</h1>
      <p className="mt-3 text-muted">
        Nothing was saved. You can try again, or go back and take a different route.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-faint">reference: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset}
          className="cc-btn inline-flex items-center rounded-card bg-accent px-5 py-2.5 font-semibold text-accent-ink">
          Try again
        </button>
        <Link href="/dashboard"
          className="cc-btn inline-flex items-center rounded-card border border-line-strong px-5 py-2.5 font-semibold text-ink">
          My dashboard
        </Link>
      </div>
    </div>
  );
}
