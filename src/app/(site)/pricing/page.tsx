import { ButtonLink, Card, Notice, PageHead } from '@/components/ui';

export const metadata = { title: 'Pricing' };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-14">
      <PageHead title="Pricing" sub="Proposed pricing for a future release. Nothing can be charged in this build." />

      <Notice tone="warn" title="No payment processing exists in this product" className="mt-6">
        No payment provider is connected, no card can be entered, and no transaction can be
        simulated. The plans below describe intended packaging. Every feature is currently
        available to every account so the product can be evaluated honestly.
      </Notice>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <Card className="flex flex-col p-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">CareCircle Free</p>
          <p className="mt-2 text-4xl font-bold text-ink">₹0</p>
          <p className="mt-1 text-sm text-muted">For one person managing their own care.</p>
          <ul className="mt-5 flex-1 space-y-2 text-muted">
            {['One self-managed care profile', 'Medical document storage', 'Appointment tracking',
              'Medication reminders you confirm', 'Personal care tasks',
              'Data export and account deletion'].map((x) => <li key={x}>• {x}</li>)}
          </ul>
          <ButtonLink href="/signup" className="mt-6">Get started free</ButtonLink>
        </Card>

        <Card className="flex flex-col border-accent/40 p-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            CareCircle Family — proposed
          </p>
          <p className="mt-2 text-4xl font-bold text-ink">
            ₹199<span className="text-base font-medium text-muted">/month</span>
          </p>
          <p className="mt-1 text-sm text-muted">For a family coordinating together.</p>
          <ul className="mt-5 flex-1 space-y-2 text-muted">
            {['Multiple family profiles', 'Shared care coordination', 'Extended document capacity',
              'Caregiver handovers and availability', 'Advanced activity summaries',
              'Granular family permissions'].map((x) => <li key={x}>• {x}</li>)}
          </ul>
          <p className="mt-6 rounded-card border border-line bg-sunken px-4 py-3 text-sm text-muted">
            Not purchasable. Shown for feedback on packaging and price.
          </p>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">
          CareCircle for Clinics — a future business product
        </p>
        <p className="mt-2 text-2xl font-bold text-ink">₹2,999 – ₹7,999<span className="text-base font-medium text-muted">/month (proposed)</span></p>
        <p className="mt-2 text-muted">
          A possible later product for clinics: appointment coordination, patient-authorised
          document exchange, administrative follow-ups and clinic task workflows. It is not part
          of this release and no clinic integration exists.
        </p>
      </Card>

      <Card className="mt-6 p-6">
        <h2 className="text-lg font-bold text-ink">What a paid plan will never gate</h2>
        <ul className="mt-3 space-y-2 text-muted">
          <li>• Exporting your own data.</li>
          <li>• Deleting your account and its files.</li>
          <li>• Withdrawing access you previously granted to somebody.</li>
          <li>• Reading records that were shared with you.</li>
        </ul>
        <p className="mt-3 text-sm text-muted">
          Charging someone to leave, or to take back consent, would be indefensible for a product
          that holds health information.
        </p>
      </Card>
    </div>
  );
}
