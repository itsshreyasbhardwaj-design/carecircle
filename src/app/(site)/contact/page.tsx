import { Card, Notice, PageHead } from '@/components/ui';

export const metadata = { title: 'Contact' };

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14">
      <PageHead title="Contact" sub="How to reach the people who maintain this build." />
      <Notice tone="warn" title="There is no contact form here, on purpose" className="mt-6">
        A form that appears to send a message while no email provider is configured would be
        misleading — you would believe someone had received it. Until a provider is connected,
        this page tells you the truth instead.
      </Notice>
      <Card className="mt-6 p-6">
        <h2 className="text-lg font-bold text-ink">While this is a local build</h2>
        <p className="mt-2 text-muted">
          You are running CareCircle on your own machine. Nobody else operates it, and nobody
          else can see your data. Questions and problems belong with whoever gave you this
          repository — raise them there.
        </p>
        <h2 className="mt-6 text-lg font-bold text-ink">Before a public release</h2>
        <ul className="mt-2 space-y-2 text-muted">
          <li>• A real support address, monitored by a person.</li>
          <li>• A published grievance process and a named data-protection contact, as Indian data protection law expects.</li>
          <li>• A security contact for responsible disclosure.</li>
          <li>• A documented breach-notification procedure.</li>
        </ul>
        <p className="mt-4 text-sm text-muted">
          None of these is in place yet, which is one of several reasons this build is not ready
          for real patient information.
        </p>
      </Card>
    </div>
  );
}
