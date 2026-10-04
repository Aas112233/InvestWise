/**
 * i18n injection for the module-entitlement work. Same contract as
 * inject-admin-i18n.mjs: every key lands in all four locales, and the script
 * fails loudly if the key sets drift.
 *
 * Run: node scripts/inject-modules-i18n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'ur', 'hi', 'bn'];

const additions = {
  en: {
    'tenantModules.members': 'Members',
    'tenantModules.funds': 'Funds',
    'tenantModules.settings': 'Settings',
    'tenantModules.deposits': 'Deposits',
    'tenantModules.transactions': 'Transactions',
    'tenantModules.expenses': 'Expenses',
    'tenantModules.dividends': 'Dividends',
    'tenantModules.analysis': 'Analysis',
    'tenantModules.reports': 'Reports',
    'tenantModules.projects': 'Projects',
    'tenantModules.meetings': 'Meetings',
    'tenantModules.governance': 'Governance',
    'tenantModules.goals': 'Goals',
    'tenantModules.requestDeposit': 'Deposit Requests',
    'tenantModules.audit': 'Audit',

    'admin.featureFlags.title': 'Module Licensing',
    'admin.featureFlags.desc':
      'Control which modules each organisation is licensed for. A disabled module is rejected at the API, not just hidden in the menu.',
    'admin.featureFlags.search': 'Search tenants…',
    'admin.featureFlags.required': 'Required',
    'admin.featureFlags.pending': '{count} unsaved',
    'admin.featureFlags.loadFailed': 'Could not load module entitlements',
    'admin.featureFlags.empty': 'No tenants match this search',
    'admin.featureFlags.updated': 'Modules updated',
    'admin.featureFlags.updateFailed': 'Update failed',
    'admin.featureFlags.category.core': 'Core',
    'admin.featureFlags.category.finance': 'Finance',
    'admin.featureFlags.category.operations': 'Operations',

    'admin.tenants.detail.financials': 'Financial Throughput',
    'admin.tenants.detail.netReserve': 'Net Reserves',
    'admin.tenants.detail.transactions': 'Transactions',
  },

  ur: {
    'tenantModules.members': 'اراکین',
    'tenantModules.funds': 'فنڈز',
    'tenantModules.settings': 'ترتیبات',
    'tenantModules.deposits': 'جمعیاں',
    'tenantModules.transactions': 'لین دین',
    'tenantModules.expenses': 'اخراجات',
    'tenantModules.dividends': 'منافع',
    'tenantModules.analysis': 'تجزیہ',
    'tenantModules.reports': 'رپورٹس',
    'tenantModules.projects': 'منصوبے',
    'tenantModules.meetings': 'جلسات',
    'tenantModules.governance': 'انتظام',
    'tenantModules.goals': 'اہداف',
    'tenantModules.requestDeposit': 'جمعی کی درخواستیں',
    'tenantModules.audit': 'آڈٹ',

    'admin.featureFlags.title': 'ماڈیول لائسنسنگ',
    'admin.featureFlags.desc':
      'کن اداروں کو کن ماڈیولز کے لیے لائسنس دیا جائے اسے کنٹرول کریں۔ غیر فعال ماڈیول اے پی آئی پر بھی رد ہوتا ہے، صرف مینو میں چھپایا نہیں جاتا۔',
    'admin.featureFlags.search': 'ٹیننٹ تلاش کریں…',
    'admin.featureFlags.required': 'لازمی',
    'admin.featureFlags.pending': '{count} محفوظ نہیں ہوئے',
    'admin.featureFlags.loadFailed': 'ماڈیول اسنٹمنٹ لوڈ نہیں ہو سکے',
    'admin.featureFlags.empty': 'اس تلاش سے کوئی ٹیننٹ نہیں ملا',
    'admin.featureFlags.updated': 'ماڈیولز اپ ڈیٹ ہو گئے',
    'admin.featureFlags.updateFailed': 'اپ ڈیٹ ناکام',
    'admin.featureFlags.category.core': 'بنیادی',
    'admin.featureFlags.category.finance': 'مالی',
    'admin.featureFlags.category.operations': 'ت عملیات',

    'admin.tenants.detail.financials': 'مالی گردش',
    'admin.tenants.detail.netReserve': 'خالص ذخائر',
    'admin.tenants.detail.transactions': 'لین دین',
  },

  hi: {
    'tenantModules.members': 'सदस्य',
    'tenantModules.funds': 'निधि',
    'tenantModules.settings': 'सेटिंग्स',
    'tenantModules.deposits': 'जमा',
    'tenantModules.transactions': 'लेन-देन',
    'tenantModules.expenses': 'व्यय',
    'tenantModules.dividends': 'लाभांश',
    'tenantModules.analysis': 'विश्लेषण',
    'tenantModules.reports': 'रिपोर्ट',
    'tenantModules.projects': 'परियोजनाएँ',
    'tenantModules.meetings': 'बैठकें',
    'tenantModules.governance': 'शासन',
    'tenantModules.goals': 'लक्ष्य',
    'tenantModules.requestDeposit': 'जमा अनुरोध',
    'tenantModules.audit': 'ऑडिट',

    'admin.featureFlags.title': 'मॉड्यूल लाइसेंसिंग',
    'admin.featureFlags.desc':
      'नियंत्रित करें कि किस संगठन को कौन-से मॉड्यूल लाइसेंस हैं। बंद मॉड्यूल मेन्यू में छिपने के साथ-साथ API पर भी अस्वीकार होता है।',
    'admin.featureFlags.search': 'टेनेंट खोजें…',
    'admin.featureFlags.required': 'आवश्यक',
    'admin.featureFlags.pending': '{count} असहेजे गए',
    'admin.featureFlags.loadFailed': 'मॉड्यूल अधिकार लोड नहीं हो सके',
    'admin.featureFlags.empty': 'इस खोज से कोई टेनेंट नहीं मिला',
    'admin.featureFlags.updated': 'मॉड्यूल अपडेट हो गए',
    'admin.featureFlags.updateFailed': 'अपडेट विफल',
    'admin.featureFlags.category.core': 'मुख्य',
    'admin.featureFlags.category.finance': 'वित्त',
    'admin.featureFlags.category.operations': 'संचालन',

    'admin.tenants.detail.financials': 'वित्तीय प्रवाह',
    'admin.tenants.detail.netReserve': 'शुद्ध रक्षित',
    'admin.tenants.detail.transactions': 'लेन-देन',
  },

  bn: {
    'tenantModules.members': 'সদস্য',
    'tenantModules.funds': 'তহবিল',
    'tenantModules.settings': 'সেটিংস',
    'tenantModules.deposits': 'জমা',
    'tenantModules.transactions': 'লেনদেন',
    'tenantModules.expenses': 'ব্যয়',
    'tenantModules.dividends': 'লভাংশ',
    'tenantModules.analysis': 'বিশ্লেষণ',
    'tenantModules.reports': 'প্রতিবেদন',
    'tenantModules.projects': 'প্রকল্প',
    'tenantModules.meetings': 'সভা',
    'tenantModules.governance': 'শাসন',
    'tenantModules.goals': 'লক্ষ্য',
    'tenantModules.requestDeposit': 'জমার অনুরোধ',
    'tenantModules.audit': 'অডিট',

    'admin.featureFlags.title': 'মডিউল লাইসেন্সিং',
    'admin.featureFlags.desc':
      'নিয়ন্ত্রণ করুন কোন প্রতিষ্ঠান কোন মডিউলের জন্য লাইসেন্সধারী। বন্ধ মডিউল মেনুতে লুকানোর পাশাপাশি API-তেও প্রত্যাখ্যান হয়।',
    'admin.featureFlags.search': 'টেন্যান্ট খুঁজুন…',
    'admin.featureFlags.required': 'আবশ্যক',
    'admin.featureFlags.pending': '{count} সংরক্ষিত হয়নি',
    'admin.featureFlags.loadFailed': 'মডিউল অনুমতি লোড করা যায়নি',
    'admin.featureFlags.empty': 'এই অনুসন্ধানে কোনো টেন্যান্ট মেলেনি',
    'admin.featureFlags.updated': 'মডিউল আপডেট হয়েছে',
    'admin.featureFlags.updateFailed': 'আপডেট ব্যর্থ',
    'admin.featureFlags.category.core': 'মূল',
    'admin.featureFlags.category.finance': 'আর্থিক',
    'admin.featureFlags.category.operations': 'পরিচালনা',

    'admin.tenants.detail.financials': 'আর্থিক প্রবাহ',
    'admin.tenants.detail.netReserve': 'নিট রিজার্ভ',
    'admin.tenants.detail.transactions': 'লেনদেন',
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
