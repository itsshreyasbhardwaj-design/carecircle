import { Card, Notice, PageHead } from '@/components/ui';

export const metadata = { title: 'Privacy policy (draft)' };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <PageHead
        title="Privacy policy — DRAFT"
        sub="Written to describe what the software actually does. It has not been reviewed by a lawyer and must not be published as-is."
      />

      <Notice tone="warn" title="This is an engineering draft, not a legal document" className="mt-6">
        It is accurate about the system&rsquo;s behaviour and incomplete as a privacy notice. Before
        any public release handling real health data it needs review by a qualified Indian data
        protection practitioner, a named grievance officer, a published retention schedule and a
        breach-notification procedure.
      </Notice>

      <div className="mt-8 space-y-6">
        <Section title="1. Who holds this data">
          <p>
            In this build, you do. CareCircle runs on your own machine and stores everything in a
            local database and a local encrypted file directory. There is no hosted service, no
            third-party processor and no analytics provider. Nothing is transmitted anywhere.
          </p>
          <p>
            One exception worth naming: if you enable photograph text recognition by running the
            optional setup command, that command downloads an open-source language model file
            once over the internet. Your documents are never sent anywhere — the recognition runs
            on your machine afterwards with no network access.
          </p>
        </Section>

        <Section title="2. What is collected">
          <ul>
            <li><strong>Account:</strong> your name, email address, a password hash (Argon2id — the password itself is never stored) and a recovery-code hash.</li>
            <li><strong>Care profiles:</strong> names, relationships, dates of birth and blood group, where you choose to enter them.</li>
            <li><strong>Health information you add:</strong> uploaded documents and their extracted text, appointments, medication routines and dose check-ins, care tasks and notes.</li>
            <li><strong>Coordination data:</strong> circle membership, access grants, invitations, handovers, reminders and notifications.</li>
            <li><strong>Security records:</strong> sessions, and an audit log of record access, uploads, downloads, permission changes and task changes.</li>
          </ul>
        </Section>

        <Section title="3. What is deliberately not collected">
          <ul>
            <li>No tracking, advertising or analytics identifiers of any kind.</li>
            <li>No raw IP addresses. Where an address is relevant to a security event it is stored as a salted hash.</li>
            <li>No health content in the audit log. Audit rows carry identifiers, counts and enum values; the code rejects an attempt to write fields such as notes or document text into them.</li>
            <li>No payment information. No payment provider is connected.</li>
          </ul>
        </Section>

        <Section title="4. Consent, purpose and withdrawal">
          <p>
            Access to another person&rsquo;s information is only ever created by that person granting a
            named permission, for a stated purpose, optionally with an expiry date. Being in the
            same family circle grants nothing. Administering a circle grants nothing.
          </p>
          <p>
            Each grant and each withdrawal is written to an append-only consent ledger recording
            who granted it, to whom, what it covered, why, when, when it expires and when it was
            withdrawn. Withdrawal takes effect on the server on the next request — it is not a
            display preference.
          </p>
        </Section>

        <Section title="5. Security measures">
          <ul>
            <li>Passwords hashed with Argon2id at the OWASP-recommended parameters.</li>
            <li>Session tokens stored only as peppered hashes; cookies are HTTP-only and same-site.</li>
            <li>Documents encrypted at rest with AES-256-GCM, held outside the web root, reachable only through an authorisation check.</li>
            <li>Rate limiting on sign-in, sign-up, password change and account recovery.</li>
            <li>Uploads validated against their actual contents, not their claimed type.</li>
            <li>Every sensitive query scoped by permission in SQL, so unauthorised rows are not selected at all.</li>
          </ul>
          <p>
            Encryption in transit depends on how you serve the application. Run over plain HTTP on
            localhost there is no transport encryption, and that is fine for a single machine but
            not for anything else.
          </p>
        </Section>

        <Section title="6. Your rights over your data">
          <ul>
            <li><strong>Access and portability:</strong> export everything as JSON from Settings → Privacy.</li>
            <li><strong>Correction:</strong> every field you entered is editable.</li>
            <li><strong>Erasure:</strong> delete your account, which removes your profiles, their records and the encrypted files. Audit and consent rows are retained because they contain no health content and because a withdrawal needs to stay provable.</li>
            <li><strong>Withdrawal of consent:</strong> revoke any grant at any time from Settings → Access.</li>
          </ul>
          <p>None of these is restricted by any plan or payment.</p>
        </Section>

        <Section title="7. Retention">
          <p>
            Data stays until you delete it. There is no automatic expiry, and a published retention
            schedule is one of the things a real deployment would have to define.
          </p>
        </Section>

        <Section title="8. Indian data protection context">
          <p>
            India&rsquo;s Digital Personal Data Protection Act, 2023 is the governing statute. The DPDP
            Rules, 2025 were notified on 13 November 2025 (G.S.R. 846(E)), starting a phased
            transition: Consent Manager registration obligations begin around 13 November 2026, and
            the substantive duties — notice and consent, security safeguards, data-principal
            rights, breach notification, and the associated penalties — become enforceable on
            13 May 2027.
          </p>
          <p>
            Health data is sensitive personal information and attracts the strictest handling
            expectations. The engineering in this build maps onto several DPDP concepts
            deliberately: consent is specific, purpose-limited and revocable; data principals can
            export and erase; and the consent ledger exists to evidence lawful basis.
          </p>
          <p className="font-semibold text-ink">
            That is engineering alignment, not compliance. CareCircle is not certified under any
            framework. It claims no HIPAA certification, no ABDM approval, no ABHA integration, no
            government endorsement and no clinical certification. Operating this product publicly
            with real personal data in India would require, at minimum: a published privacy notice
            in the prescribed form, a named Data Protection Officer or grievance contact, a
            documented breach-notification process, a retention and deletion schedule, processor
            agreements for any hosting, independent security testing, and legal advice on whether
            the proxy-caregiver model satisfies consent requirements for people who cannot consent
            themselves.
          </p>
        </Section>

        <Section title="9. Children and dependent adults">
          <p>
            CareCircle does not support managing a child&rsquo;s or a dependent adult&rsquo;s records. DPDP
            places specific duties around processing children&rsquo;s data, including verifiable
            parental consent. Rather than approximate that with an unchecked tick-box, profiles
            marked as dependents are restricted and the record features stay switched off until a
            legally reviewed proxy-authorisation workflow exists.
          </p>
        </Section>

        <Section title="10. Key-recovery limitation">
          <p>
            The document encryption key is generated on first run into a local file that is
            excluded from version control. There is no escrow and no recovery: if that file is
            lost, the encrypted documents cannot be decrypted by anyone, including us. Back it up
            separately from the database, or accept that losing it loses the files.
          </p>
        </Section>
      </div>

      <Card className="mt-8 p-6">
        <p className="text-sm text-muted">
          Draft last revised 20 October 2026. Describes the local development build. Requires legal
          review before publication.
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
