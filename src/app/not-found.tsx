import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Not found</h1>
      <p className="mt-3 text-muted">
        This page does not exist, or it refers to something you do not have permission to see.
        CareCircle deliberately does not say which — telling you a record exists but is private
        would itself leak information.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/dashboard"
          className="cc-btn inline-flex items-center rounded-card bg-accent px-5 py-2.5 font-semibold text-accent-ink">
          Go to my dashboard
        </Link>
        <Link href="/"
          className="cc-btn inline-flex items-center rounded-card border border-line-strong px-5 py-2.5 font-semibold text-ink">
          Home
        </Link>
      </div>
    </div>
  );
}
