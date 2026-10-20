import { Card, Notice, PageHead } from '@/components/ui';

export const metadata = { title: 'Terms of service (draft)' };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <PageHead
        title="Terms of service — DRAFT"
        sub="Placeholder terms describing the software honestly. Not legally reviewed and not enforceable as drafted."
      />

      <Notice tone="warn" title="This is a draft requiring legal review" className="mt-6">
        A real agreement needs a governing jurisdiction, liability and indemnity clauses, dispute
        resolution, subscription and refund terms, and a lawyer. None of that is settled here.
      </Notice>

      <div className="mt-8 space-y-6">
        <Section title="1. What CareCircle is">
          <p>
            CareCircle is administrative software for organising healthcare coordination within a
            family: documents, appointments, medication routines you have confirmed, care tasks
            and the permissions between family members.
          </p>
        </Section>

        <Section title="2. What CareCircle is not">
          <ul>
            <li>Not a medical device and not a diagnostic tool.</li>
            <li>Not a substitute for a licensed healthcare professional.</li>
            <li>Not an emergency or monitoring service. It will not summon help.</li>
            <li>Not a prescribing system. It never generates, suggests or modifies a medication or a dose.</li>
            <li>Not a treatment-recommendation engine.</li>
            <li>Not a hospital information management system.</li>
          </ul>
          <p>
            Clinical decisions belong to you and your clinicians. Information you see here is
            whatever a person entered, shown back to you.
          </p>
        </Section>

        <Section title="3. Your responsibilities">
          <ul>
            <li>Enter medication instructions only as they were actually prescribed or confirmed, and attach the prescription where you can.</li>
            <li>Check text read automatically from a document before relying on it. Automatic reading makes mistakes, and the original file is always the authority.</li>
            <li>Share access only with people who should have it, and withdraw it when they should not.</li>
            <li>Do not upload another person&rsquo;s health information without their agreement.</li>
            <li>Keep your password and recovery code to yourself.</li>
          </ul>
        </Section>

        <Section title="4. Accounts and access">
          <p>
            You control the care profiles you own and decide who may see what. Granting a permission
            is your decision and your responsibility; so is withdrawing it. Circle administration
            is a roster function and never conveys access to anyone&rsquo;s records.
          </p>
        </Section>

        <Section title="5. Reminders are best-effort">
          <p>
            Reminders are generated when the application&rsquo;s scheduler runs, and appear only inside
            the app. There is no SMS, email or push delivery. Do not use CareCircle as the only
            safeguard for anything that matters clinically.
          </p>
        </Section>

        <Section title="6. This build, and your data">
          <p>
            This is a local development build. You run it; you hold the data; you are responsible
            for backups. The document encryption key cannot be recovered if you lose it. There is
            no service level, no uptime commitment and no support obligation.
          </p>
        </Section>

        <Section title="7. Payment">
          <p>
            Nothing is charged. No payment provider is connected and no transaction can occur.
            Prices shown elsewhere are proposals for a future release. Exporting your data,
            deleting your account and withdrawing consent will never require payment.
          </p>
        </Section>

        <Section title="8. Changes and termination">
          <p>
            You may delete your account at any time from Settings → Privacy, which removes your
            profiles, their records and the stored files. Consent and audit records are retained,
            since they contain no health content and a withdrawal should remain provable.
          </p>
        </Section>
      </div>

      <Card className="mt-8 p-6">
        <p className="text-sm text-muted">
          Draft last revised 20 October 2026. Requires legal review before publication.
        </p>
      </Card>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-muted [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
