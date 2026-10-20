import { one } from '../db/index.ts';
import { audit } from './audit.ts';
import { nowIso, relative } from './time.ts';
import {
  CATEGORY_LABELS, listDocuments, searchDocuments, type DocumentRow,
} from './documents.ts';
import { appointmentDocuments, prepItems, upcomingAppointments } from './appointments.ts';
import { listTasks, pendingHandoversFor } from './tasks.ts';
import { listSchedules, unconfirmedCheckins } from './medications.ts';
import { accessibleProfiles } from './profiles.ts';
import type { DocumentCategory } from './extract.ts';

/**
 * THE CIRCLE ASSISTANT
 *
 * An administrative retrieval tool, not a clinician and not a language model.
 * It works by: recognising an intent from keywords, running the SAME
 * permission-scoped queries the rest of the app uses, and filling a fixed
 * template with what came back. Every statement it makes links to a record the
 * asker is allowed to open.
 *
 * Two hard limits:
 *   - It cannot leak. It has no query of its own; it calls the scoped services,
 *     so a document the asker may not read is never in its input.
 *   - It will not answer a clinical question. Those are detected and refused
 *     with a pointer to a qualified person.
 */

export type AssistantItem = { text: string; link?: string; source?: string };
export type AssistantSection = { title: string; items: AssistantItem[]; empty?: string };

export type AssistantAnswer = {
  intent: 'find_records' | 'appointment_prep' | 'followups' | 'care_brief' | 'clinical_refusal' | 'help';
  headline: string;
  summary: string | null;
  sections: AssistantSection[];
  /** Records this answer was built from, so every claim is checkable. */
  sources: { label: string; link: string }[];
  caveats: string[];
};

/**
 * Wording that asks for medical judgement. The assistant declines these outright
 * rather than attempting a hedged answer.
 */
const CLINICAL_PATTERNS: RegExp[] = [
  /\b(should|shall)\s+(i|we|he|she|they|mum|mom|dad|amma|appa)\b/i,
  /\b(is|are)\s+it\s+(safe|ok|okay|normal|dangerous|bad|fine)\b/i,
  /\bwhat\s+(dose|dosage|medicine|medication|drug|tablet)\s+(should|do|does|to)\b/i,
  /\b(increase|decrease|double|halve|stop|skip|change)\s+(the\s+)?(dose|dosage|medicine|medication|tablet)/i,
  /\b(diagnos|prognos|symptom|side[\s-]?effect|interaction|contraindicat)/i,
  /\bwhat('?s| is)\s+wrong\b/i,
  /\b(why|what)\s+(do|does|did)\s+(i|he|she|they)\s+(have|feel|get)\b/i,
  /\b(treat|cure|remedy|prescribe)\b/i,
  /\bhow\s+(serious|bad|urgent)\b/i,
  /\b(emergency|ambulance|chest pain|can'?t breathe|unconscious|bleeding heavily)\b/i,
];

const CATEGORY_WORDS: { category: DocumentCategory; words: RegExp }[] = [
  { category: 'prescription', words: /\b(prescription|rx|medicine list)\b/i },
  { category: 'lab_report', words: /\b(lab|blood|report|test|pathology|scan|x-?ray|result)\b/i },
  { category: 'discharge_summary', words: /\b(discharge|hospital stay|admission)\b/i },
  { category: 'referral_letter', words: /\b(referral|referred)\b/i },
  { category: 'vaccination_record', words: /\b(vaccin|immunis|immuniz|jab|booster)\b/i },
  { category: 'insurance', words: /\b(insurance|policy|claim|cashless)\b/i },
  { category: 'visit_record', words: /\b(visit|consultation|opd)\b/i },
];

/** Words that are about finding things, not clinical content. */
const SPECIALITY_WORDS = /\b(cardiolog|neurolog|orthopaed|orthoped|dermatolog|ophthalm|dental|dentist|gynae|gyneco|paediatric|pediatric|urolog|nephrolog|endocrin|oncolog|physio|ent|psychiatr)\w*/i;

export function detectClinicalQuestion(query: string): boolean {
  return CLINICAL_PATTERNS.some((p) => p.test(query));
}

const REFUSAL: AssistantAnswer = {
  intent: 'clinical_refusal',
  headline: 'That is a question for a qualified clinician',
  summary:
    'CareCircle organises records and responsibilities. It does not give medical advice, interpret results, or change medication — and it is not an emergency service.',
  sections: [
    {
      title: 'What to do instead',
      items: [
        { text: 'Contact the treating doctor or clinic directly.' },
        { text: 'For anything urgent, use your local emergency number rather than this app.' },
        { text: 'I can help you find the relevant documents to take with you — try "find the latest lab report".' },
      ],
    },
  ],
  sources: [],
  caveats: ['CareCircle is not a medical device and gives no clinical advice.'],
};

export function ask(userId: string, rawQuery: string): AssistantAnswer {
  const query = rawQuery.trim();
  if (!query) return help();

  if (detectClinicalQuestion(query)) {
    audit({ actorUserId: userId, action: 'assistant:query', outcome: 'allowed',
            detail: { intent: 'clinical_refusal', chars: query.length } });
    return REFUSAL;
  }

  const intent = classifyIntent(query);
  const answer = intent === 'appointment_prep' ? appointmentPrep(userId, query)
    : intent === 'followups' ? followups(userId)
    : intent === 'care_brief' ? careBrief(userId)
    : intent === 'find_records' ? findRecords(userId, query)
    : help();

  audit({ actorUserId: userId, action: 'assistant:query', outcome: 'allowed',
          detail: { intent: answer.intent, chars: query.length, sources: answer.sources.length } });
  return answer;
}

function classifyIntent(q: string): AssistantAnswer['intent'] {
  const score = {
    appointment_prep: /\b(prepare|preparation|prep|what (do|should) (i|we) (bring|take|carry)|before the appointment|packet|checklist)\b/i.test(q) ? 3 : 0,
    followups: /\b(follow[\s-]?up|next step|what needs doing|outstanding|pending task|to ?do)\b/i.test(q) ? 3 : 0,
    care_brief: /\b(brief|summary|overview|what('?s| is) (happening|coming up|going on)|this week|catch me up|update me)\b/i.test(q) ? 3 : 0,
    find_records: /\b(find|show|where|get|fetch|look up|search|last|latest|recent|report|document|prescription|record)\b/i.test(q) ? 2 : 0,
  };
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] === 0) return 'help';
  return best[0] as AssistantAnswer['intent'];
}

// ----------------------------------------------------------- A. record finder

function findRecords(userId: string, query: string): AssistantAnswer {
  const profiles = accessibleProfiles(userId);
  const named = profiles.find((p) =>
    new RegExp(`\\b${escapeRegExp(p.display_name.split(/\s+/)[0] ?? '')}\\b`, 'i').test(query));
  const category = CATEGORY_WORDS.find((c) => c.words.test(query))?.category ?? null;
  const speciality = query.match(SPECIALITY_WORDS)?.[0] ?? null;

  // Full-text search first; fall back to a filtered list when there are no terms.
  const terms = [speciality, category ? CATEGORY_LABELS[category] : null]
    .filter(Boolean).join(' ');
  let hits: DocumentRow[] = terms ? searchDocuments(userId, terms, 10) : [];
  if (hits.length === 0) {
    hits = listDocuments(userId, {
      careProfileId: named?.id ?? null, category, limit: 10,
    });
  } else if (named) {
    hits = hits.filter((h) => h.care_profile_id === named.id);
  }

  const wantsLatest = /\b(last|latest|most recent|recent)\b/i.test(query);
  if (wantsLatest) hits = hits.slice(0, 3);

  const items: AssistantItem[] = hits.map((d) => ({
    text: `${d.title} — ${CATEGORY_LABELS[d.category]}${d.provider_name ? `, ${d.provider_name}` : ''}`,
    link: `/records/${d.id}`,
    source: `${d.profile_name} · ${d.document_date ?? d.created_at.slice(0, 10)}`,
  }));

  const filters = [
    named ? `for ${named.display_name}` : null,
    category ? CATEGORY_LABELS[category].toLowerCase() : null,
    speciality ? `matching "${speciality}"` : null,
  ].filter(Boolean).join(', ');

  return {
    intent: 'find_records',
    headline: items.length
      ? `${items.length} document${items.length === 1 ? '' : 's'} you can open`
      : 'No matching documents you have access to',
    summary: filters ? `Searched the Health Vault ${filters}.` : 'Searched the Health Vault.',
    sections: [{
      title: 'Documents',
      items,
      empty: 'Nothing matched. Either it has not been uploaded yet, or it belongs to someone who has not shared it with you.',
    }],
    sources: items.filter((i) => i.link).map((i) => ({ label: i.text, link: i.link! })),
    caveats: items.length
      ? ['Open the original document to confirm anything before acting on it.']
      : ['This only searches records you have been given access to.'],
  };
}

// ------------------------------------------------------ B. appointment prep

function appointmentPrep(userId: string, query: string): AssistantAnswer {
  const upcoming = upcomingAppointments(userId, 30, 10);
  const profiles = accessibleProfiles(userId);
  const named = profiles.find((p) =>
    new RegExp(`\\b${escapeRegExp(p.display_name.split(/\s+/)[0] ?? '')}\\b`, 'i').test(query));
  const candidates = named ? upcoming.filter((a) => a.care_profile_id === named.id) : upcoming;
  const appt = candidates[0];

  if (!appt) {
    return {
      intent: 'appointment_prep',
      headline: 'No upcoming appointment to prepare for',
      summary: named
        ? `There is nothing scheduled for ${named.display_name} in the next 30 days that you can see.`
        : 'Nothing is scheduled in the next 30 days that you can see.',
      sections: [{ title: 'Next step', items: [{ text: 'Add an appointment', link: '/appointments' }] }],
      sources: [], caveats: [],
    };
  }

  const prep = prepItems(userId, appt.id);
  const docs = appointmentDocuments(userId, appt.id);
  const sections: AssistantSection[] = [
    {
      title: 'When and where',
      items: [
        { text: appt.title, source: `${appt.profile_name} · ${relative(appt.starts_at)}`,
          link: `/appointments/${appt.id}` },
        ...(appt.provider_name ? [{ text: `Provider: ${appt.provider_name}` }] : []),
        ...(appt.location ? [{ text: `Location: ${appt.location}` }] : []),
        { text: `Status: ${appt.status}` },
      ],
    },
    {
      title: 'Who is taking them',
      items: appt.responsible_name
        ? [{ text: `${appt.responsible_name} is responsible for this appointment.` }]
        : [],
      empty: 'Nobody has been assigned yet. Assign someone so the responsibility is clear.',
    },
    {
      title: 'Questions you saved for the doctor',
      items: prep.filter((p) => p.kind === 'question').map((p) => ({ text: p.text })),
      empty: 'No questions saved yet. Add them before the visit so they are not forgotten.',
    },
    {
      title: 'Documents to bring',
      items: docs.map((d) => ({ text: d.title, link: `/records/${d.id}` })),
      empty: 'No documents linked to this appointment yet.',
    },
    {
      title: 'Other preparation recorded',
      items: prep.filter((p) => p.kind !== 'question').map((p) => ({
        text: p.text,
        source: p.source === 'clinician_provided' ? 'From the clinic' : 'Added by the family',
      })),
      empty: 'Nothing else recorded.',
    },
  ];

  return {
    intent: 'appointment_prep',
    headline: `Preparation packet: ${appt.title}`,
    summary:
      'Built only from what has been entered for this appointment. Any clinical preparation instruction shown here was transcribed by a person from the clinic, not generated.',
    sections,
    sources: [{ label: appt.title, link: `/appointments/${appt.id}` },
              ...docs.map((d) => ({ label: d.title, link: `/records/${d.id}` }))],
    caveats: [
      'This app does not invent preparation instructions, such as fasting. Check with the clinic if you are unsure.',
    ],
  };
}

// ----------------------------------------------------- D. follow-up extractor

/**
 * Surfaces follow-up information that was already CONFIRMED on a document, plus
 * open tasks. It proposes drafts for a person to accept — it never creates a task
 * on its own and never interprets a clinical instruction into one.
 */
function followups(userId: string): AssistantAnswer {
  const docs = listDocuments(userId, { limit: 200 });
  const withFollowups = docs.filter((d) => d.extraction_status === 'extracted');

  const drafts: AssistantItem[] = [];
  for (const d of withFollowups.slice(0, 40)) {
    const row = followupFor(d.id);
    if (!row?.suggested_followup_date) continue;
    drafts.push({
      text: `Book a follow-up for ${d.profile_name} on ${row.suggested_followup_date}`,
      link: `/records/${d.id}`,
      source: `Read from "${d.title}"${row.reviewed_at ? ' (you confirmed this)' : ' (not yet confirmed)'}`,
    });
  }

  const open = listTasks(userId, { openOnly: true, limit: 25 });
  const overdue = open.filter((t) => t.due_at && t.due_at < nowIso());

  return {
    intent: 'followups',
    headline: `${drafts.length} suggested follow-up${drafts.length === 1 ? '' : 's'}, ${open.length} open task${open.length === 1 ? '' : 's'}`,
    summary:
      'Suggestions come from dates written on documents. Nothing here has been created for you — review each one and create it yourself if it is right.',
    sections: [
      {
        title: 'Suggested, awaiting your confirmation',
        items: drafts,
        empty: 'No explicit follow-up dates were found on your documents.',
      },
      {
        title: 'Overdue tasks',
        items: overdue.map((t) => ({
          text: t.title, link: `/tasks/${t.id}`,
          source: `${t.profile_name} · was due ${relative(t.due_at!)}`,
        })),
        empty: 'Nothing overdue.',
      },
      {
        title: 'Open tasks',
        items: open.filter((t) => !overdue.includes(t)).map((t) => ({
          text: `${t.title} — ${t.assignee_name ?? 'unassigned'}`,
          link: `/tasks/${t.id}`, source: t.profile_name,
        })),
        empty: 'No open tasks.',
      },
    ],
    sources: drafts.filter((d) => d.link).map((d) => ({ label: d.text, link: d.link! })),
    caveats: [
      'A date read from a document may be wrong. Check the original before booking anything.',
      'Instructions like "review after 4 weeks" are shown as written and never turned into a date automatically.',
    ],
  };
}

function followupFor(documentId: string) {
  return one<{ suggested_followup_date: string | null; reviewed_at: string | null }>(
    `SELECT e.suggested_followup_date, e.reviewed_at
     FROM document_extractions e
     JOIN medical_documents d ON d.current_version_id = e.document_version_id
     WHERE d.id = ?`,
    documentId,
  );
}

// -------------------------------------------------------- E. family care brief

export function careBrief(userId: string): AssistantAnswer {
  const appts = upcomingAppointments(userId, 7, 10);
  const open = listTasks(userId, { openOnly: true, limit: 20 });
  const done = listTasks(userId, { status: 'completed', limit: 10 });
  const recentDocs = listDocuments(userId, { limit: 5 });
  const meds = listSchedules(userId);
  const unconfirmed = unconfirmedCheckins(userId, 10);
  const handovers = pendingHandoversFor(userId);

  return {
    intent: 'care_brief',
    headline: 'Family care brief',
    summary: 'Everything below comes from records you have access to. Nothing is inferred.',
    sections: [
      {
        title: 'Appointments in the next 7 days',
        items: appts.map((a) => ({
          text: a.title, link: `/appointments/${a.id}`,
          source: `${a.profile_name} · ${relative(a.starts_at)} · ${a.responsible_name ?? 'nobody assigned'}`,
        })),
        empty: 'Nothing scheduled in the next week.',
      },
      {
        title: 'Tasks still open',
        items: open.map((t) => ({
          text: t.title, link: `/tasks/${t.id}`,
          source: `${t.profile_name} · ${t.assignee_name ?? 'unassigned'} · ${t.status}`,
        })),
        empty: 'No open tasks.',
      },
      {
        title: 'Recently completed',
        items: done.map((t) => ({
          text: t.title, link: `/tasks/${t.id}`,
          source: `${t.profile_name} · ${t.completed_at ? relative(t.completed_at) : ''}`,
        })),
        empty: 'Nothing completed recently.',
      },
      {
        title: 'Handover requests waiting for you',
        items: handovers.map((h) => ({
          text: `${h.from_name} asked you to take over "${h.task_title}"`,
          link: `/tasks/${h.task_id}`,
        })),
        empty: 'None.',
      },
      {
        title: 'Medication check-ins nobody has confirmed',
        items: unconfirmed.map((c) => ({
          text: `${c.medication_name} for ${c.profile_name}`,
          link: '/medications',
          source: `slot ${relative(c.scheduled_for)} — still unconfirmed`,
        })),
        empty: 'All dose slots have been answered.',
      },
      {
        title: 'Active medication routines',
        items: meds.map((m) => ({
          text: `${m.medication_name}${m.strength ? ` ${m.strength}` : ''} — as recorded: "${m.dose_instruction}"`,
          link: '/medications', source: `${m.profile_name} · ${m.instruction_source.replace('_', ' ')}`,
        })),
        empty: 'No active medication routines.',
      },
      {
        title: 'Recently added documents',
        items: recentDocs.map((d) => ({
          text: d.title, link: `/records/${d.id}`,
          source: `${d.profile_name} · ${CATEGORY_LABELS[d.category]}`,
        })),
        empty: 'No documents you can see.',
      },
    ],
    sources: [
      ...appts.map((a) => ({ label: a.title, link: `/appointments/${a.id}` })),
      ...open.map((t) => ({ label: t.title, link: `/tasks/${t.id}` })),
    ],
    caveats: [
      'An unconfirmed dose slot means nobody answered the reminder. It does not mean the medicine was missed.',
    ],
  };
}

function help(): AssistantAnswer {
  return {
    intent: 'help',
    headline: 'What I can look up for you',
    summary: 'I find and organise what is already in CareCircle. I do not give medical advice.',
    sections: [{
      title: 'Try asking',
      items: [
        { text: '"Find the latest lab report"' },
        { text: '"What do I need to prepare for the next appointment?"' },
        { text: '"What follow-ups are outstanding?"' },
        { text: '"Give me a brief for this week"' },
      ],
    }],
    sources: [],
    caveats: ['I only see records that have been shared with you.'],
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
