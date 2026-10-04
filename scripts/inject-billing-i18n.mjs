/**
 * i18n injection for the subscription-lifecycle and platform-settings work.
 * Same contract: every key lands in all four locales, drift fails loudly.
 *
 * Run: node scripts/inject-billing-i18n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'ur', 'hi', 'bn'];

const additions = {
  en: {
    'admin.billing.arr': 'ARR (run rate)',
    'admin.billing.conversion': 'Trial conversion',
    'admin.billing.daysLeft': '{days}d left',
    'admin.billing.overdueBy': '{days}d overdue',

    'admin.plans.title': 'Plan Catalogue',
    'admin.plans.create': 'New plan',
    'admin.plans.createTitle': 'New plan',
    'admin.plans.editTitle': 'Edit plan',
    'admin.plans.plan': 'Plan',
    'admin.plans.name': 'Display name',
    'admin.plans.slug': 'Slug',
    'admin.plans.slugHint': 'Lowercase, digits and dashes.',
    'admin.plans.price': 'Monthly price',
    'admin.plans.priceHint': 'Decimal amount, max 2 places.',
    'admin.plans.maxUsers': 'Max users',
    'admin.plans.status': 'Status',
    'admin.plans.delete': 'Delete',
    'admin.plans.deleteTitle': 'Delete this plan?',
    'admin.plans.deleteDesc':
      'Only possible if no tenant is on this plan. Otherwise retire it instead — a live plan with tenants cannot be removed.',
    'admin.plans.empty': 'No plans defined',
    'admin.plans.saved': 'Plan saved',
    'admin.plans.saveFailed': 'Save failed',
    'admin.plans.deleted': 'Plan deleted',
    'admin.plans.deleteFailed': 'Delete failed',

    'admin.settings.title': 'Platform Settings',
    'admin.settings.desc':
      'Defaults applied to newly provisioned tenants, plus the platform-wide maintenance switch.',
    'admin.settings.identity': 'Platform Identity',
    'admin.settings.platformName': 'Platform name',
    'admin.settings.supportEmail': 'Support email',
    'admin.settings.supportEmailHint': 'Shown to tenants on the blocked screen.',
    'admin.settings.supportPhone': 'Support phone',
    'admin.settings.newTenantDefaults': 'New Tenant Defaults',
    'admin.settings.trialDays': 'Default trial length (days)',
    'admin.settings.trialDaysHint': 'Between 1 and 365.',
    'admin.settings.currency': 'Default currency',
    'admin.settings.timezone': 'Default timezone',
    'admin.settings.registration': 'Public self-service signup',
    'admin.settings.registrationHint':
      "Stored for a future public signup endpoint. No public signup exists today — /register is an authenticated admin invite, so this does not gate anything yet.",
    'admin.settings.dangerZone': 'Platform-wide maintenance',
    'admin.settings.maintenanceToggle': 'Block all tenant sign-ins',
    'admin.settings.maintenanceHint':
      'Every tenant is locked out. Platform operators keep access. Distinct from per-tenant maintenance mode.',
    'admin.settings.maintenanceMessage': 'Maintenance message',
    'admin.settings.defaultMaintenanceMessage':
      'InvestWise is under maintenance. Please try again shortly.',
    'admin.settings.maintenanceConfirmTitle': 'Apply platform-wide maintenance?',
    'admin.settings.maintenanceConfirmDesc':
      'Every tenant user is locked out until this is switched off. Platform operators keep access.',
    'admin.settings.apply': 'Apply',
    'admin.settings.saving': 'Saving…',
    'admin.settings.saved': 'Platform settings saved',
    'admin.settings.saveFailed': 'Save failed',
    'admin.settings.loadFailed': 'Could not load platform settings',
    'admin.settings.save': 'Save changes',

    'admin.overview.mrr': 'MRR',
    'common.enabled': 'Enabled',
    'common.disabled': 'Disabled',
  },

  ur: {
    'admin.billing.arr': 'سالانہ آمدنی (ARR)',
    'admin.billing.conversion': 'ٹرائل کی تبدیلی',
    'admin.billing.daysLeft': '{days} دن باقی',
    'admin.billing.overdueBy': '{days} دن تاخیر',

    'admin.plans.title': 'پلان کی فہرست',
    'admin.plans.create': 'نیا پلان',
    'admin.plans.createTitle': 'نیا پلان',
    'admin.plans.editTitle': 'پلان میں ترمیم',
    'admin.plans.plan': 'پلان',
    'admin.plans.name': 'ظاہری نام',
    'admin.plans.slug': 'سلگ',
    'admin.plans.slugHint': 'چھوٹے حروف، ہندسے اور ڈیش۔',
    'admin.plans.price': 'ماہانہ قیمت',
    'admin.plans.priceHint': 'اعشاریہ رقم، زیادہ سے زیادہ 2 اعشارہ۔',
    'admin.plans.maxUsers': 'زیادہ سے زیادہ صارفین',
    'admin.plans.status': 'حالت',
    'admin.plans.delete': 'حذف کریں',
    'admin.plans.deleteTitle': 'یہ پلان حذف کریں؟',
    'admin.plans.deleteDesc':
      'صرف اس صورت میں ممکن ہے جب کوئی ٹیننٹ اس پلان پر نہ ہو۔ ورنہ اسے ریٹائر کریں — فعال پلان میں ٹیننٹس کے ساتھ حذف نہیں ہو سکتا۔',
    'admin.plans.empty': 'کوئی پلان متعین نہیں',
    'admin.plans.saved': 'پلان محفوظ ہو گیا',
    'admin.plans.saveFailed': 'محفوظ کرنا ناکام',
    'admin.plans.deleted': 'پلان حذف ہو گیا',
    'admin.plans.deleteFailed': 'حذف کرنا ناکام',

    'admin.settings.title': 'پلیٹ فارم ترتیبات',
    'admin.settings.desc':
      'نئے ٹیننٹس کو دیے جانے والے ڈیفالٹس، اور پلیٹ فارم کا دیوالی نگہداشت سوئچ۔',
    'admin.settings.identity': 'پلیٹ فارم کی پہچان',
    'admin.settings.platformName': 'پلیٹ فارم کا نام',
    'admin.settings.supportEmail': 'سپورٹ ای میل',
    'admin.settings.supportEmailHint': 'بلاک اسکرین پر ٹیننٹس کو دکھایا جاتا ہے۔',
    'admin.settings.supportPhone': 'سپورٹ فون',
    'admin.settings.newTenantDefaults': 'نئے ٹیننٹ کے ڈیفالٹس',
    'admin.settings.trialDays': 'ڈیفالٹ ٹرائل مدت (دن)',
    'admin.settings.trialDaysHint': '1 سے 365 دن کے درمیان۔',
    'admin.settings.currency': 'ڈیفالٹ کرنسی',
    'admin.settings.timezone': 'ڈیفالٹ ٹائم زون',
    'admin.settings.registration': 'عوامی خود روزگار رجسٹریشن',
    'admin.settings.registrationHint':
      'مستقبل کے عوامی رجسٹریشن اینڈ پوائنٹ کے لیے محفوظ ہے۔ آج کوئی عوامی رجسٹریشن نہیں — /register ایڈمن کا دعوتی عمل ہے، اس لیے ابھی کچھ محدود نہیں کرتا۔',
    'admin.settings.dangerZone': 'پلیٹ فارم کا دیوالی نگہداشت',
    'admin.settings.maintenanceToggle': 'تمام ٹیننٹس کا سائن ان بند کریں',
    'admin.settings.maintenanceHint':
      'ہر ٹیننٹ باہر ہو جائے گا۔ پلیٹ فارم آپریٹرز کو رسائی باقی رہے گی۔ یہ ہر ٹیننٹ کے اپنے مینٹیننس موڈ سے الگ ہے۔',
    'admin.settings.maintenanceMessage': 'نگہداشت کا پیغام',
    'admin.settings.defaultMaintenanceMessage':
      'InvestWise زیرِ نگہداشت ہے۔ براہِ کرم کچھ دیر بعد دوبارہ کوشش کریں۔',
    'admin.settings.maintenanceConfirmTitle': 'پلیٹ فارم کا دیوالی نگہداشت لاگو کریں؟',
    'admin.settings.maintenanceConfirmDesc':
      'اسے بند کرنے تک ہر ٹیننٹ صارف باہر رہے گا۔ پلیٹ فارم آپریٹرز کو رسائی باقی رہے گی۔',
    'admin.settings.apply': 'لاگو کریں',
    'admin.settings.saving': 'محفوظ ہو رہا ہے…',
    'admin.settings.saved': 'پلیٹ فارم ترتیبات محفوظ ہو گئیں',
    'admin.settings.saveFailed': 'محفوظ کرنا ناکام',
    'admin.settings.loadFailed': 'پلیٹ فارم ترتیبات لوڈ نہیں ہو سکیں',
    'admin.settings.save': 'تبدیلیاں محفوظ کریں',

    'admin.overview.mrr': 'ماہانہ آمدنی',
    'common.enabled': 'فعال',
    'common.disabled': 'غیر فعال',
  },

  hi: {
    'admin.billing.arr': 'वार्षिक राजस्व (ARR)',
    'admin.billing.conversion': 'ट्रायल रूपांतरण',
    'admin.billing.daysLeft': '{days} दिन शेष',
    'admin.billing.overdueBy': '{days} दिन विलंब',

    'admin.plans.title': 'प्लान सूची',
    'admin.plans.create': 'नया प्लान',
    'admin.plans.createTitle': 'नया प्लान',
    'admin.plans.editTitle': 'प्लान संपादित करें',
    'admin.plans.plan': 'प्लान',
    'admin.plans.name': 'प्रदर्शित नाम',
    'admin.plans.slug': 'स्लग',
    'admin.plans.slugHint': 'छोटे अक्षर, अंक और डैश।',
    'admin.plans.price': 'मासिक मूल्य',
    'admin.plans.priceHint': 'दशमलव राशि, अधिकतम 2 दशमलव।',
    'admin.plans.maxUsers': 'अधिकतम उपयोगकर्ता',
    'admin.plans.status': 'स्थिति',
    'admin.plans.delete': 'हटाएँ',
    'admin.plans.deleteTitle': 'यह प्लान हटाएँ?',
    'admin.plans.deleteDesc':
      'केवल तभी संभव है जब कोई टेनेंट इस प्लान पर न हो। अन्यथा इसे निष्क्रिय करें — टेनेंट वाला सक्रिय प्लान हटाया नहीं जा सकता।',
    'admin.plans.empty': 'कोई प्लान निर्धारित नहीं',
    'admin.plans.saved': 'प्लान सहेजा गया',
    'admin.plans.saveFailed': 'सहेजना विफल',
    'admin.plans.deleted': 'प्लान हटाया गया',
    'admin.plans.deleteFailed': 'हटाना विफल',

    'admin.settings.title': 'प्लेटफ़ॉर्म सेटिंग्स',
    'admin.settings.desc':
      'नए टेनेंट को दिए जाने वाले डिफ़ॉल्ट, और प्लेटफ़ॉर्म-स्तरीय रखरखाव स्विच।',
    'admin.settings.identity': 'प्लेटफ़ॉर्म पहचान',
    'admin.settings.platformName': 'प्लेटफ़ॉर्म का नाम',
    'admin.settings.supportEmail': 'सपोर्ट ईमेल',
    'admin.settings.supportEmailHint': 'ब्लॉक स्क्रीन पर टेनेंट को दिखता है।',
    'admin.settings.supportPhone': 'सपोर्ट फ़ोन',
    'admin.settings.newTenantDefaults': 'नए टेनेंट के डिफ़ॉल्ट',
    'admin.settings.trialDays': 'डिफ़ॉल्ट ट्रायल अवधि (दिन)',
    'admin.settings.trialDaysHint': '1 से 365 दिन के बीच।',
    'admin.settings.currency': 'डिफ़ॉल्ट मुद्रा',
    'admin.settings.timezone': 'डिफ़ॉल्ट समय क्षेत्र',
    'admin.settings.registration': 'सार्वजनिक सेल्फ़-सर्विस पंजीकरण',
    'admin.settings.registrationHint':
      'भविष्य के सार्वजनिक पंजीकरण एंडपॉइंट के लिए सहेजा गया। आज कोई सार्वजनिक पंजीकरण नहीं है — /register एडमिन का आमंत्रण है, इसलिए यह अभी कुछ नियंत्रित नहीं करता।',
    'admin.settings.dangerZone': 'प्लेटफ़ॉर्म-स्तरीय रखरखाव',
    'admin.settings.maintenanceToggle': 'सभी टेनेंट का साइन इन बंद करें',
    'admin.settings.maintenanceHint':
      'हर टेनेंट बाहर हो जाएगा। प्लेटफ़ॉर्म ऑपरेटरों की पहुँच बनी रहेगी। यह प्रति-टेनेंट रखरखाव मोड से अलग है।',
    'admin.settings.maintenanceMessage': 'रखरखाव संदेश',
    'admin.settings.defaultMaintenanceMessage':
      'InvestWise रखरखाव में है। कृपया थोड़ी देर बाद पुनः प्रयास करें।',
    'admin.settings.maintenanceConfirmTitle': 'प्लेटफ़ॉर्म-स्तरीय रखरखाव लागू करें?',
    'admin.settings.maintenanceConfirmDesc':
      'इसे बंद करने तक हर टेनेंट उपयोगकर्ता बाहर रहेगा। प्लेटफ़ॉर्म ऑपरेटरों की पहुँच बनी रहेगी।',
    'admin.settings.apply': 'लागू करें',
    'admin.settings.saving': 'सहेजा जा रहा है…',
    'admin.settings.saved': 'प्लेटफ़ॉर्म सेटिंग्स सहेजी गईं',
    'admin.settings.saveFailed': 'सहेजना विफल',
    'admin.settings.loadFailed': 'प्लेटफ़ॉर्म सेटिंग्स लोड नहीं हो सकीं',
    'admin.settings.save': 'बदलाव सहेजें',

    'admin.overview.mrr': 'मासिक राजस्व',
    'common.enabled': 'सक्षम',
    'common.disabled': 'अक्षम',
  },

  bn: {
    'admin.billing.arr': 'বার্ষিক আয় (ARR)',
    'admin.billing.conversion': 'ট্রায়াল রূপান্তর',
    'admin.billing.daysLeft': '{days} দিন বাকি',
    'admin.billing.overdueBy': '{days} দিন দেরি',

    'admin.plans.title': 'প্লান তালিকা',
    'admin.plans.create': 'নতুন প্লান',
    'admin.plans.createTitle': 'নতুন প্লান',
    'admin.plans.editTitle': 'প্লান সম্পাদনা',
    'admin.plans.plan': 'প্লান',
    'admin.plans.name': 'প্রদর্শন নাম',
    'admin.plans.slug': 'স্লাগ',
    'admin.plans.slugHint': 'ছোট হাত, সংখ্যা ও ড্যাশ।',
    'admin.plans.price': 'মাসিক মূল্য',
    'admin.plans.priceHint': 'দশমিক পরিমাণ, সর্বোচ্চ ২ দশমিক।',
    'admin.plans.maxUsers': 'সর্বোচ্চ ব্যবহারকারী',
    'admin.plans.status': 'অবস্থা',
    'admin.plans.delete': 'মুছুন',
    'admin.plans.deleteTitle': 'এই প্লান মুছবেন?',
    'admin.plans.deleteDesc':
      'কেবল তখনই সম্ভব যখন কোনো টেন্যান্ট এই প্লানে নেই। অন্যথায় এটি অবসরে দিন — টেন্যান্টসহ সক্রিয় প্লান মোছা যায় না।',
    'admin.plans.empty': 'কোনো প্লান নির্ধারিত নেই',
    'admin.plans.saved': 'প্লান সংরক্ষিত হয়েছে',
    'admin.plans.saveFailed': 'সংরক্ষণ ব্যর্থ',
    'admin.plans.deleted': 'প্লান মুছে ফেলা হয়েছে',
    'admin.plans.deleteFailed': 'মুছতে ব্যর্থ',

    'admin.settings.title': 'প্ল্যাটফর্ম সেটিংস',
    'admin.settings.desc':
      'নতুন টেন্যান্টকে দেওয়া ডিফল্ট, এবং প্ল্যাটফর্ম-পর্যায়ের রক্ষণাবেক্ষণ সুইচ।',
    'admin.settings.identity': 'প্ল্যাটফর্ম পরিচয়',
    'admin.settings.platformName': 'প্ল্যাটফর্মের নাম',
    'admin.settings.supportEmail': 'সাপোর্ট ইমেইল',
    'admin.settings.supportEmailHint': 'ব্লক স্ক্রিনে টেন্যান্টদের দেখানো হয়।',
    'admin.settings.supportPhone': 'সাপোর্ট ফোন',
    'admin.settings.newTenantDefaults': 'নতুন টেন্যান্টের ডিফল্ট',
    'admin.settings.trialDays': 'ডিফল্ট ট্রায়াল মেয়াদ (দিন)',
    'admin.settings.trialDaysHint': '১ থেকে ৩৬৫ দিনের মধ্যে।',
    'admin.settings.currency': 'ডিফল্ট মুদ্রা',
    'admin.settings.timezone': 'ডিফল্ট সময় অঞ্চল',
    'admin.settings.registration': 'পাবলিক সেল্ফ-সার্ভিস নিবন্ধন',
    'admin.settings.registrationHint':
      'ভবিষ্ত পাবলিক নিবন্ধন এন্ডপয়েন্টের জন্য সংরক্ষিত। আজ কোনো পাবলিক নিবন্ধন নেই — /register হলো অ্যাডমিনের আমন্ত্রণ, তাই এটি এখনো কিছু সীমাবদ্ধ করে না।',
    'admin.settings.dangerZone': 'প্ল্যাটফর্ম-পর্যায়ের রক্ষণাবেক্ষণ',
    'admin.settings.maintenanceToggle': 'সব টেন্যান্টের সাইন ইন বন্ধ করুন',
    'admin.settings.maintenanceHint':
      'প্রতিটি টেন্যান্ট বাইরে চলে যাবে। প্ল্যাটফর্ম অপারেটরদের প্রবেশাধিকার থাকবে। এটি প্রতি-টেন্যান্ট রক্ষণাবেক্ষণ মোড থেকে আলাদা।',
    'admin.settings.maintenanceMessage': 'রক্ষণাবেক্ষণ বার্তা',
    'admin.settings.defaultMaintenanceMessage':
      'InvestWise রক্ষণাবেক্ষণে আছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
    'admin.settings.maintenanceConfirmTitle': 'প্ল্যাটফর্ম-পর্যায়ের রক্ষণাবেক্ষণ প্রয়োগ করবেন?',
    'admin.settings.maintenanceConfirmDesc':
      'এটি বন্ধ না করা পর্যন্ত প্রতিটি টেন্যান্ট ব্যবহারকারী বাইরে থাকবে। প্ল্যাটফর্ম অপারেটরদের প্রবেশাধিকার থাকবে।',
    'admin.settings.apply': 'প্রয়োগ করুন',
    'admin.settings.saving': 'সংরক্ষণ হচ্ছে…',
    'admin.settings.saved': 'প্ল্যাটফর্ম সেটিংস সংরক্ষিত হয়েছে',
    'admin.settings.saveFailed': 'সংরক্ষণ ব্যর্থ',
    'admin.settings.loadFailed': 'প্ল্যাটফর্ম সেটিংস লোড করা যায়নি',
    'admin.settings.save': 'পরিবর্তন সংরক্ষণ করুন',

    'admin.overview.mrr': 'মাসিক আয়',
    'common.enabled': 'সক্রিয়',
    'common.disabled': 'নিষ্ক্রিয়',
  },
};

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

for (const locale of LOCALES) {
  const file = join(root, 'messages', `${locale}.json`);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const dict = additions[locale];
  for (const [key, value] of Object.entries(dict)) setPath(json, key, value);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  console.log(`[ok] messages/${locale}.json  (+${Object.keys(dict).length} keys)`);
}

const flatten = (o, prefix = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );

const sets = LOCALES.map((l) =>
  new Set(flatten(JSON.parse(readFileSync(join(root, 'messages', `${l}.json`), 'utf8'))))
);
const reference = sets[0];
let drift = 0;
for (let i = 1; i < sets.length; i += 1) {
  for (const key of reference) if (!sets[i].has(key)) { console.log(`  MISSING in ${LOCALES[i]}: ${key}`); drift += 1; }
  for (const key of sets[i]) if (!reference.has(key)) { console.log(`  EXTRA in ${LOCALES[i]}: ${key}`); drift += 1; }
}
console.log(drift === 0 ? '[ok] all 4 locales key sets identical' : `[FAIL] ${drift} key drift`);
