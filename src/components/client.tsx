'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * The only client-side JavaScript in the app, and all of it is progressive:
 * every form here still submits without it.
 */

/** Disables a submit button while its form is in flight, so nothing double-posts. */
export function SubmitButton({ children, variant = 'primary', className = '', pendingLabel }: {
  children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  className?: string; pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  const styles: Record<string, string> = {
    primary: 'bg-accent text-accent-ink hover:brightness-110',
    secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
    ghost: 'text-accent hover:bg-accent-soft',
    danger: 'border border-bad/40 bg-bad-soft text-bad hover:brightness-95',
  };
  return (
    <button type="submit" disabled={pending} aria-busy={pending}
      className={`cc-btn inline-flex items-center justify-center gap-2 rounded-card px-4 py-2.5 text-[0.95rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${styles[variant]} ${className}`}>
      {pending ? (pendingLabel ?? 'Working…') : children}
    </button>
  );
}

/**
 * Confirmation for a destructive action, using the native <dialog> element so
 * focus handling, Escape and the backdrop come from the browser.
 * Without JavaScript the inner form still submits directly.
 */
export function ConfirmSubmit({ label, title, body, confirmLabel, children }: {
  label: string; title: string; body: ReactNode; confirmLabel?: string; children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <button type={mounted ? 'button' : 'submit'}
        onClick={mounted ? () => ref.current?.showModal() : undefined}
        className="cc-btn inline-flex items-center justify-center gap-2 rounded-card border border-bad/40 bg-bad-soft px-4 py-2.5 text-[0.95rem] font-semibold text-bad hover:brightness-95">
        {label}
      </button>
      <dialog ref={ref}
        className="w-[min(32rem,calc(100vw-2rem))] rounded-panel border border-line bg-surface p-0 text-ink backdrop:bg-black/40">
        <div className="px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="mt-2 text-[0.95rem] text-muted">{body}</div>
          {children}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={() => ref.current?.close()}
            className="cc-btn rounded-card border border-line-strong bg-surface px-4 py-2.5 text-[0.95rem] font-semibold">
            Cancel
          </button>
          <SubmitButton variant="danger">{confirmLabel ?? label}</SubmitButton>
        </div>
      </dialog>
    </>
  );
}

/** Copies an invitation link. Falls back to selecting the text for manual copying. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="copy-link" className="text-sm font-semibold text-ink">{label}</label>
      <div className="flex flex-wrap gap-2">
        <input id="copy-link" readOnly value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-card border border-line-strong bg-surface-2 px-3 py-2.5 font-mono text-sm text-ink" />
        <button type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            } catch {
              document.getElementById('copy-link')?.focus();
            }
          }}
          className="cc-btn rounded-card bg-accent px-4 py-2.5 text-[0.95rem] font-semibold text-accent-ink">
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <p aria-live="polite" className="sr-only">{copied ? 'Link copied' : ''}</p>
    </div>
  );
}

/** Repeatable time inputs for a medication routine. Starts with one row. */
export function TimeList({ name, initial }: { name: string; initial?: string[] }) {
  const [times, setTimes] = useState<string[]>(initial?.length ? initial : ['09:00']);
  return (
    <div className="flex flex-col gap-2">
      {times.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="time" name={name} defaultValue={t} required
            aria-label={`Reminder time ${i + 1}`}
            className="w-40 rounded-card border border-line-strong bg-surface px-3 py-2.5 text-ink" />
          {times.length > 1 ? (
            <button type="button" onClick={() => setTimes(times.filter((_, j) => j !== i))}
              className="cc-btn rounded-card border border-line-strong px-3 py-2 text-sm font-semibold text-muted">
              Remove<span className="sr-only"> reminder time {i + 1}</span>
            </button>
          ) : null}
        </div>
      ))}
      <button type="button" onClick={() => setTimes([...times, '21:00'])}
        className="cc-btn self-start rounded-card border border-line-strong px-3 py-2 text-sm font-semibold text-accent">
        Add another time
      </button>
    </div>
  );
}
