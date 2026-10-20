import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { ownedProfiles } from '@/lib/profiles';
import { circlesFor } from '@/lib/circles';
import { listAppointments } from '@/lib/appointments';
import { listTasks } from '@/lib/tasks';
import { setOnboardingStepAction } from '@/app/actions/auth';
import {
  ButtonLink, Card, CardHead, Flash, Notice, PageHead, SafetyNote,
} from '@/components/ui';
import { CopyField, SubmitButton } from '@/components/client';

export const metadata = { title: 'Welcome to CareCircle' };

const STEPS = ['welcome', 'how', 'profile', 'circle', 'permissions', 'plan', 'documents'] as const;
type Step = (typeof STEPS)[number];

export default async function OnboardingPage({ searchParams }: {
  searchParams: Promise<{ step?: string; recovery?: string; error?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const step = (STEPS as readonly string[]).includes(sp.step ?? '')
    ? (sp.step as Step)
    : (STEPS as readonly string[]).includes(user.onboarding_step)
      ? (user.onboarding_step as Step)
      : 'welcome';

  const profiles = ownedProfiles(user.id);
  const circles = circlesFor(user.id);
  const appts = listAppointments(user.id, { limit: 1 });
  const tasks = listTasks(user.id, { limit: 1 });
  const index = STEPS.indexOf(step);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Flash error={sp.error} />

      {sp.recovery ? (
        <Card className="border-warn/50">
          <CardHead title="Write this down now"
                    sub="Your recovery code. It is shown once and cannot be shown again." />
          <div className="space-y-3 p-5">
            <CopyField value={sp.recovery} label="Recovery code" />
            <Notice tone="warn">
              This is the only way back into your account if you forget your password, because no
              email provider is configured. Keep it somewhere safe and separate from your password.
            </Notice>
          </div>
        </Card>
      ) : null}

      <PageHead title="Welcome to CareCircle"
                sub={`Step ${index + 1} of ${STEPS.length}. You can skip anything optional.`} />

      <div aria-hidden="true" className="flex gap-1.5">
        {STEPS.map((s, i) => (
          <span key={s}
            className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-accent' : 'bg-sunken'}`} />
        ))}
      </div>
      <p className="sr-only">Step {index + 1} of {STEPS.length}</p>

      <Card>
        {step === 'welcome' ? (
          <StepBody title={`Hello, ${user.full_name.split(' ')[0]}`}>
            <p>
              CareCircle keeps the administration of family healthcare in one place: documents,
              appointments, medication routines and the jobs around them.
            </p>
            <p>
              It answers three questions — what needs to happen next, who agreed to handle it, and
              whether it actually got done.
            </p>
            <SafetyNote />
          </StepBody>
        ) : null}

        {step === 'how' ? (
          <StepBody title="How coordination works here">
            <ul>
              <li>Each person has a <strong>care profile</strong> that they control.</li>
              <li>A <strong>family circle</strong> is a group who coordinate together. Being in one shares nothing by itself.</li>
              <li><strong>Permissions</strong> are granted one at a time, by the person whose records they are, for a stated reason.</li>
              <li>Every appointment and task has <strong>one named owner</strong>, or is visibly unassigned.</li>
              <li>Nothing is ever marked done by the system. Only a person can do that.</li>
            </ul>
          </StepBody>
        ) : null}

        {step === 'profile' ? (
          <StepBody title="Your own care profile">
            {profiles.length > 0 ? (
              <Notice tone="ok" title="Already done">
                Your profile <strong>{profiles[0]?.display_name}</strong> was created when you
                signed up. You can add profiles for relatives from the Family page.
              </Notice>
            ) : (
              <Notice tone="warn">Something went wrong creating your profile. Add one from the Family page.</Notice>
            )}
            <p>
              Add relatives when you are ready. If they can manage their own records, the better
              pattern is for them to sign up and share permissions with you — that keeps control
              with the person the records belong to.
            </p>
            <ButtonLink href="/family" variant="secondary">Open the Family page</ButtonLink>
          </StepBody>
        ) : null}

        {step === 'circle' ? (
          <StepBody title="Create a family circle (optional)">
            {circles.length > 0 ? (
              <Notice tone="ok" title="You have a circle">
                {circles.map((c) => c.name).join(', ')}
              </Notice>
            ) : (
              <p>
                A circle gives the family one place to coordinate. You invite people with a link
                you copy and send yourself — no email is sent by this app.
              </p>
            )}
            <ButtonLink href="/family" variant="secondary">Create or open a circle</ButtonLink>
          </StepBody>
        ) : null}

        {step === 'permissions' ? (
          <StepBody title="How sharing works">
            <p>There are ten separate permissions. A few things worth knowing:</p>
            <ul>
              <li>Running a circle gives you the roster, not anybody&rsquo;s records.</li>
              <li>&ldquo;Add documents&rdquo; does not include reading existing ones.</li>
              <li>A document can be marked <strong>restricted</strong> and shared with exactly one person.</li>
              <li>Any permission can carry an expiry date.</li>
              <li>Withdrawing works immediately, and the withdrawal is recorded.</li>
            </ul>
            <ButtonLink href="/settings/access" variant="secondary">See the Access page</ButtonLink>
          </StepBody>
        ) : null}

        {step === 'plan' ? (
          <StepBody title="Add something to your plan (optional)">
            {appts.length > 0 || tasks.length > 0 ? (
              <Notice tone="ok" title="You have made a start">
                {appts.length > 0 ? 'An appointment is scheduled. ' : ''}
                {tasks.length > 0 ? 'A care task exists. ' : ''}
              </Notice>
            ) : (
              <p>
                The quickest way to see how this works is to add the next real appointment, or one
                administrative job that is currently living in your head.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/appointments/new" variant="secondary">Schedule an appointment</ButtonLink>
              <ButtonLink href="/planner/new" variant="secondary">Create a care task</ButtonLink>
            </div>
          </StepBody>
        ) : null}

        {step === 'documents' ? (
          <StepBody title="About the Health Vault">
            <p>
              Documents are encrypted with AES-256-GCM before they touch the disk, stored outside
              the web root, and only ever returned through a download that checks your permission
              and records the access.
            </p>
            <p>
              When you upload something, CareCircle reads what text it can — locally, with no
              external service — then asks you to check every field before saving. The original
              file always stays the authoritative copy.
            </p>
            <Notice tone="neutral" title="One honest limitation">
              There is no key escrow. If the local key file is lost, the stored documents cannot be
              decrypted by anyone. Back it up separately from the database.
            </Notice>
            <ButtonLink href="/records/new" variant="secondary">Add your first document</ButtonLink>
          </StepBody>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
          {index > 0 ? (
            <Link href={`/onboarding?step=${STEPS[index - 1]}`}
              className="cc-btn inline-flex items-center rounded-card border border-line-strong px-4 py-2.5 font-semibold text-ink">
              Back
            </Link>
          ) : null}
          {index < STEPS.length - 1 ? (
            <form action={setOnboardingStepAction}>
              <input type="hidden" name="step" value={STEPS[index + 1]} />
              <SubmitButton>Next</SubmitButton>
            </form>
          ) : (
            <form action={setOnboardingStepAction}>
              <input type="hidden" name="step" value="done" />
              <input type="hidden" name="finish" value="on" />
              <SubmitButton>Finish and open my dashboard</SubmitButton>
            </form>
          )}
          <form action={setOnboardingStepAction} className="ml-auto">
            <input type="hidden" name="step" value="done" />
            <input type="hidden" name="finish" value="on" />
            <SubmitButton variant="ghost">Skip the rest</SubmitButton>
          </form>
        </div>
      </Card>
    </div>
  );
}

function StepBody({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <CardHead title={title} />
      <div className="space-y-4 px-5 py-5 text-muted [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5 [&_strong]:text-ink">
        {children}
      </div>
    </>
  );
}
