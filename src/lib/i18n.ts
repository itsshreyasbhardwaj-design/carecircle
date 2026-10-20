import type { Locale } from './time.ts';

/**
 * Static, hand-written translations for navigation and common interface text.
 * Nothing here is machine-translated at runtime, and clinical content is never
 * translated — dose instructions and document text are always shown in the words
 * a person actually entered.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English', hi: 'हिन्दी', bn: 'বাংলা',
};

const en = {
  'nav.dashboard': 'Today',
  'nav.family': 'Family',
  'nav.records': 'Health Vault',
  'nav.appointments': 'Appointments',
  'nav.planner': 'Care planner',
  'nav.medications': 'Medications',
  'nav.assistant': 'Assistant',
  'nav.notifications': 'Notifications',
  'nav.activity': 'Activity',
  'nav.settings': 'Settings',
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.add': 'Add',
  'action.delete': 'Delete',
  'action.signOut': 'Sign out',
  'action.signIn': 'Sign in',
  'action.signUp': 'Create account',
  'common.loading': 'Loading…',
  'common.none': 'Nothing here yet',
  'common.required': 'Required',
  'common.notShared': 'Not shared with you',
  'common.unconfirmed': 'Not confirmed',
  'common.selfReported': 'Self-reported',
  'quick.addDocument': 'Add a document',
  'quick.scheduleAppointment': 'Schedule an appointment',
  'quick.createTask': 'Create a care task',
  'quick.addReminder': 'Add a medication routine',
  'quick.inviteCaregiver': 'Invite a caregiver',
  'safety.noAdvice': 'CareCircle organises information. It does not give medical advice.',
} as const;

export type MessageKey = keyof typeof en;

const hi: Partial<Record<MessageKey, string>> = {
  'nav.dashboard': 'आज',
  'nav.family': 'परिवार',
  'nav.records': 'हेल्थ वॉल्ट',
  'nav.appointments': 'अपॉइंटमेंट',
  'nav.planner': 'देखभाल योजना',
  'nav.medications': 'दवाइयाँ',
  'nav.assistant': 'सहायक',
  'nav.notifications': 'सूचनाएँ',
  'nav.activity': 'गतिविधि',
  'nav.settings': 'सेटिंग्स',
  'action.save': 'सहेजें',
  'action.cancel': 'रद्द करें',
  'action.add': 'जोड़ें',
  'action.delete': 'हटाएँ',
  'action.signOut': 'साइन आउट',
  'action.signIn': 'साइन इन',
  'action.signUp': 'खाता बनाएँ',
  'common.loading': 'लोड हो रहा है…',
  'common.none': 'अभी कुछ नहीं',
  'common.required': 'आवश्यक',
  'common.notShared': 'आपके साथ साझा नहीं',
  'common.unconfirmed': 'पुष्टि नहीं हुई',
  'common.selfReported': 'स्वयं बताया गया',
  'quick.addDocument': 'दस्तावेज़ जोड़ें',
  'quick.scheduleAppointment': 'अपॉइंटमेंट तय करें',
  'quick.createTask': 'देखभाल कार्य बनाएँ',
  'quick.addReminder': 'दवा दिनचर्या जोड़ें',
  'quick.inviteCaregiver': 'देखभालकर्ता को आमंत्रित करें',
  'safety.noAdvice': 'CareCircle जानकारी व्यवस्थित करता है। यह चिकित्सीय सलाह नहीं देता।',
};

const bn: Partial<Record<MessageKey, string>> = {
  'nav.dashboard': 'আজ',
  'nav.family': 'পরিবার',
  'nav.records': 'হেলথ ভল্ট',
  'nav.appointments': 'অ্যাপয়েন্টমেন্ট',
  'nav.planner': 'সেবা পরিকল্পনা',
  'nav.medications': 'ওষুধ',
  'nav.assistant': 'সহকারী',
  'nav.notifications': 'বিজ্ঞপ্তি',
  'nav.activity': 'কার্যকলাপ',
  'nav.settings': 'সেটিংস',
  'action.save': 'সংরক্ষণ',
  'action.cancel': 'বাতিল',
  'action.add': 'যোগ করুন',
  'action.delete': 'মুছে ফেলুন',
  'action.signOut': 'সাইন আউট',
  'action.signIn': 'সাইন ইন',
  'action.signUp': 'অ্যাকাউন্ট তৈরি করুন',
  'common.loading': 'লোড হচ্ছে…',
  'common.none': 'এখনও কিছু নেই',
  'common.required': 'আবশ্যক',
  'common.notShared': 'আপনার সাথে শেয়ার করা হয়নি',
  'common.unconfirmed': 'নিশ্চিত করা হয়নি',
  'common.selfReported': 'নিজে জানানো',
  'quick.addDocument': 'নথি যোগ করুন',
  'quick.scheduleAppointment': 'অ্যাপয়েন্টমেন্ট নির্ধারণ',
  'quick.createTask': 'সেবা কাজ তৈরি করুন',
  'quick.addReminder': 'ওষুধের রুটিন যোগ করুন',
  'quick.inviteCaregiver': 'সেবাদাতাকে আমন্ত্রণ জানান',
  'safety.noAdvice': 'CareCircle তথ্য সাজায়। এটি চিকিৎসা পরামর্শ দেয় না।',
};

const DICTS: Record<Locale, Partial<Record<MessageKey, string>>> = { en, hi, bn };

/** Falls back to English for any key a translation has not covered yet. */
export function translator(locale: Locale) {
  const dict = DICTS[locale] ?? en;
  return (key: MessageKey): string => dict[key] ?? en[key];
}
