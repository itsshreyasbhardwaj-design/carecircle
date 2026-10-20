import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Hand-rolled primitives built on native HTML elements.
 * Native <dialog>, <details>, <input type="date"> and real <label>/<fieldset>
 * give keyboard support, screen-reader semantics and mobile pickers for free —
 * a component library would mostly re-implement them.
 */

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted border-line',
  accent: 'bg-accent-soft text-accent border-accent/30',
  ok: 'bg-ok-soft text-ok border-ok/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  bad: 'bg-bad-soft text-bad border-bad/30',
};

export function Card({ children, className = '', as: As = 'section', id }: {
  children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' | 'li'; id?: string;
}) {
  return (
    <As id={id}
      className={`rounded-panel border border-line bg-surface shadow-[var(--shadow)] ${className}`}>
      {children}
    </As>
  );
}

export function CardHead({ title, sub, action, id }: {
  title: ReactNode; sub?: ReactNode; action?: ReactNode; id?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {sub ? <p className="mt-0.5 text-sm text-muted">{sub}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const BTN_BASE =
  'cc-btn inline-flex items-center justify-center gap-2 rounded-card px-4 py-2.5 text-[0.95rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55';

const BTN_VARIANT = {
  primary: 'bg-accent text-accent-ink hover:brightness-110',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-accent hover:bg-accent-soft',
  danger: 'border border-bad/40 bg-bad-soft text-bad hover:brightness-95',
} as const;

export type ButtonVariant = keyof typeof BTN_VARIANT;

export function Button({ children, variant = 'primary', className = '', ...rest }:
  { children: ReactNode; variant?: ButtonVariant; className?: string }
  & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`${BTN_BASE} ${BTN_VARIANT[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function ButtonLink({ href, children, variant = 'primary', className = '', ...rest }:
  { href: string; children: ReactNode; variant?: ButtonVariant; className?: string }
  & Omit<React.ComponentProps<typeof Link>, 'href' | 'className'>) {
  return (
    <Link href={href} {...rest} className={`${BTN_BASE} ${BTN_VARIANT[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Badge({ children, tone = 'neutral', title }: {
  children: ReactNode; tone?: Tone; title?: string;
}) {
  return (
    <span title={title}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

/** A labelled field. The label is always a real <label>, never a placeholder. */
export function Field({ label, name, children, hint, error, required, className = '' }: {
  label: ReactNode; name: string; children?: ReactNode; hint?: ReactNode;
  error?: string; required?: boolean; className?: string;
}) {
  const hintId = hint ? `${name}-hint` : undefined;
  const errId = error ? `${name}-error` : undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {/* The visual asterisk is decorative: the control's own `required`
          attribute already announces the requirement, so a second sr-only
          "(required)" would be read twice — and would pollute the label text
          that tests and assistive tooling match on. */}
      <label htmlFor={name} className="text-sm font-semibold text-ink">
        {label}
        {required ? <span className="ml-1 text-bad" aria-hidden="true">*</span> : null}
      </label>
      {hint ? <p id={hintId} className="text-sm text-muted">{hint}</p> : null}
      {children}
      {error ? (
        <p id={errId} role="alert" className="text-sm font-medium text-bad">{error}</p>
      ) : null}
    </div>
  );
}

const CONTROL =
  'w-full rounded-card border border-line-strong bg-surface px-3 py-2.5 text-ink placeholder:text-faint';

export function Input({ name, error, ...rest }:
  { name: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input id={name} name={name} {...rest}
      aria-invalid={error ? true : undefined}
      aria-describedby={[rest['aria-describedby'], error ? `${name}-error` : null]
        .filter(Boolean).join(' ') || undefined}
      className={`${CONTROL} ${error ? 'border-bad' : ''}`} />
  );
}

export function Textarea({ name, error, ...rest }:
  { name: string; error?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea id={name} name={name} rows={rest.rows ?? 3} {...rest}
      aria-invalid={error ? true : undefined}
      className={`${CONTROL} ${error ? 'border-bad' : ''}`} />
  );
}

export function Select({ name, children, error, ...rest }:
  { name: string; children: ReactNode; error?: string }
  & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select id={name} name={name} {...rest}
      aria-invalid={error ? true : undefined}
      className={`${CONTROL} ${error ? 'border-bad' : ''}`}>
      {children}
    </select>
  );
}

export function Checkbox({ name, label, hint, defaultChecked, value = 'on', required }: {
  name: string; label: ReactNode; hint?: ReactNode; defaultChecked?: boolean;
  value?: string; required?: boolean;
}) {
  const id = `${name}-${String(value)}`;
  return (
    <div className="flex items-start gap-3 py-1.5">
      <input type="checkbox" id={id} name={name} value={value}
        defaultChecked={defaultChecked} required={required}
        className="mt-1 shrink-0 accent-[var(--accent)]" />
      <label htmlFor={id} className="text-[0.95rem] leading-snug text-ink">
        {label}
        {hint ? <span className="block text-sm text-muted">{hint}</span> : null}
      </label>
    </div>
  );
}

export function Notice({ tone = 'neutral', title, children, className = '' }: {
  tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <div role={tone === 'bad' ? 'alert' : undefined}
      className={`rounded-card border px-4 py-3 text-[0.95rem] ${TONE_CLASS[tone]} ${className}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : ''}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, body, action }: {
  title: string; body?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-base font-semibold text-ink">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-prose text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = 'h-5 w-full' }: { className?: string }) {
  return <div className={`cc-skeleton ${className}`} aria-hidden="true" />;
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, tone = 'neutral', definition, href }: {
  label: string; value: ReactNode; tone?: 'neutral' | 'attention' | 'good';
  definition?: string; href?: string;
}) {
  const inner = (
    <>
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${
        tone === 'attention' ? 'text-warn' : tone === 'good' ? 'text-ok' : 'text-ink'}`}>
        {value}
      </p>
      {definition ? (
        <p className="mt-2 text-xs leading-snug text-faint">{definition}</p>
      ) : null}
    </>
  );
  const base = 'block rounded-panel border border-line bg-surface p-5 text-left';
  return href
    ? <Link href={href} className={`${base} transition-colors hover:bg-surface-2`}>{inner}</Link>
    : <div className={base}>{inner}</div>;
}

/** Collapsible details — used for "how this works" explanations and filters. */
export function Disclosure({ summary, children, open }: {
  summary: ReactNode; children: ReactNode; open?: boolean;
}) {
  return (
    <details open={open} className="rounded-card border border-line bg-surface-2">
      <summary className="cursor-pointer list-none px-4 py-3 text-[0.95rem] font-semibold text-ink marker:hidden">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="text-accent">▸</span>{summary}
        </span>
      </summary>
      <div className="border-t border-line px-4 py-3 text-sm text-muted">{children}</div>
    </details>
  );
}

/** The standing disclaimer. Shown wherever a user might expect clinical help. */
export function SafetyNote({ children }: { children?: ReactNode }) {
  return (
    <p className="rounded-card border border-line bg-sunken px-4 py-3 text-sm text-muted">
      <strong className="font-semibold text-ink">CareCircle does not give medical advice.</strong>{' '}
      {children ??
        'It organises records, appointments and responsibilities. For anything clinical, speak to a qualified healthcare professional. It is not an emergency service.'}
    </p>
  );
}

export function DemoBanner() {
  return (
    <div className="rounded-card border border-warn/40 bg-warn-soft px-4 py-2.5 text-sm font-semibold text-warn">
      Fictional demonstration data — not real patient information.
    </div>
  );
}

export function PageHead({ title, sub, action }: {
  title: string; sub?: ReactNode; action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {sub ? <p className="mt-1 max-w-prose text-muted">{sub}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function DefinitionRow({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-line py-2.5 last:border-0">
      <dt className="w-44 shrink-0 text-sm font-medium text-muted">{term}</dt>
      <dd className="min-w-0 flex-1 text-[0.95rem] text-ink">{children}</dd>
    </div>
  );
}

/** Renders the ?error / ?ok messages that server actions redirect back with. */
export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (!error && !ok) return null;
  return (
    <div className="space-y-3">
      {error ? <Notice tone="bad" title="That did not work">{error}</Notice> : null}
      {ok ? <Notice tone="ok">{ok}</Notice> : null}
    </div>
  );
}
