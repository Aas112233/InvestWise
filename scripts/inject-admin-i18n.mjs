/**
 * One-shot i18n injection for the SuperAdmin parity work. Merges the new keys
 * into all four locale files so AGENTS.md §9 (4-locale rule) holds by
 * construction — a key can never land in en.json only.
 *
 * Run: node scripts/inject-admin-i18n.mjs
 * Idempotent: re-running overwrites the same keys with the same values.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'ur', 'hi', 'bn'];

/** locale -> { dottedKey: value } */
const additions = {
  en: {
    'common.refresh': 'Refresh',
    'admin.nav.users': 'Users',
    'admin.nav.featureFlags': 'Modules',
    'admin.nav.settings': 'Settings',

    'admin.users.title': 'Global Users',
    'admin.users.desc':
      'Every account across every tenant. Change roles, disable access, reset a forgotten password, or open a support session.',
    'admin.users.search': 'Search name, email or role…',
    'admin.users.filterRole': 'All roles',
    'admin.users.filterStatus': 'All statuses',
    'admin.users.user': 'User',
    'admin.users.tenant': 'Tenant',
    'admin.users.platform': 'Platform',
    'admin.users.role': 'Role',
    'admin.users.roleHint': 'SuperAdmin is platform-wide. Admin is scoped to one tenant.',
    'admin.users.status': 'Status',
    'admin.users.statusHint': 'Deactivated users cannot sign in but keep their data.',
    'admin.users.lastLogin': 'Last login',
    'admin.users.actions': 'Actions',
    'admin.users.account': 'Account',
    'admin.users.fullName': 'Full name',
    'admin.users.edit': 'Edit user',
    'admin.users.editTitle': 'Edit user',
    'admin.users.resetPassword': 'Reset password',
    'admin.users.resetAction': 'Reset password',
    'admin.users.newPassword': 'New password',
    'admin.users.passwordReset': 'Password reset — share it out of band',
    'admin.users.passwordFailed': 'Password reset failed',
    'admin.users.passwordWarning':
      "This overwrites the user's credential immediately. Share it over a channel you trust and ask them to change it.",
    'admin.users.activate': 'Activate',
    'admin.users.deactivate': 'Deactivate',
    'admin.users.activateTitle': 'Reactivate this user?',
    'admin.users.activateDesc': '{email} will be able to sign in again.',
    'admin.users.deactivateTitle': 'Deactivate this user?',
    'admin.users.deactivateDesc': '{email} will no longer be able to sign in.',
    'admin.users.impersonate': 'Impersonate',
    'admin.users.impersonateTitle': 'Start a support session?',
    'admin.users.impersonateDesc':
      'You will be signed in as {email} for 30 minutes. Everything they do is attributed to you in the audit log.',
    'admin.users.impersonateFailed': 'Could not start session',
    'admin.users.cannotImpersonate': 'Platform operators cannot be impersonated',
    'admin.users.loadFailed': 'Could not load users',
    'admin.users.empty': 'No users match these filters',
    'admin.users.updated': 'User updated',
    'admin.users.updateFailed': 'Update failed',

    'admin.actionLog.platformTab': 'Platform Actions',
    'admin.actionLog.tenantTab': 'Tenant Audit',
    'admin.actionLog.target': 'Target',
    'admin.actionLog.empty': 'No platform actions recorded',

    'admin.impersonate.user': 'User',
    'admin.impersonate.tenant': 'Tenant',
    'admin.impersonate.role': 'Role',
    'admin.impersonate.actions': 'Action',
    'admin.impersonate.start': 'Start session',
    'admin.impersonate.started': 'Support session started — opening {email}',
    'admin.impersonate.starting': 'Opening session as {email}…',
    'admin.impersonate.search': 'Search by name, email or role…',
    'admin.impersonate.empty': 'No impersonatable users found',
    'admin.impersonate.searchFailed': 'Could not load users',
    'admin.impersonate.auditNote':
      'Platform operators cannot be impersonated. Starting a session replaces your login cookies for 30 minutes.',

    'admin.notices.updated': 'Broadcast updated',
    'admin.notices.retracted': 'Broadcast retracted',
    'admin.notices.retractFailed': 'Failed to retract notice',
    'admin.notices.edit': 'Edit broadcast',
    'admin.notices.editTitle': 'Edit Broadcast',
    'admin.notices.deactivate': 'Deactivate',
    'admin.notices.activate': 'Reactivate',
    'admin.notices.retract': 'Retract permanently',
    'admin.notices.inactive': 'inactive',
    'admin.notices.titlePlaceholder': 'Scheduled Maintenance Window (Sunday 02:00 UTC)',
    'admin.notices.messagePlaceholder':
      'We will be performing scheduled database optimizations. Access will be read-only for 15 minutes.',
    'admin.notices.keepActive': 'Active (visible to tenants)',
    'admin.notices.deactivateTitle': 'Deactivate this broadcast?',
    'admin.notices.deactivateDesc':
      'It stops being shown to tenants but stays in the list so you can bring it back.',
    'admin.notices.activateTitle': 'Reactivate this broadcast?',
    'admin.notices.activateDesc': 'It becomes visible to tenants again.',
    'admin.notices.retractTitle': 'Retract this broadcast?',
    'admin.notices.retractDesc':
      'It disappears for every tenant and cannot be restored. A record of the retraction is kept in the platform action log.',

    'admin.tenants.detail.supportSession': 'Start support session',
    'admin.tenants.detail.supportSessionShort': 'Support',
  },

  ur: {
    'common.refresh': 'تازہ کریں',
    'admin.nav.users': 'صارفین',
    'admin.nav.featureFlags': 'ماڈیولز',
    'admin.nav.settings': 'ترتیبات',

    'admin.users.title': '全体 صارفین',
    'admin.users.desc':
      'ہر ٹیننٹ کے تمام اکاؤنٹس۔ کردار تبدیل کریں، رسائی بند کریں، بھولی ہوئی پاس ورڈ ری سیٹ کریں، یا سپورٹ سیشن کھولیں۔',
    'admin.users.search': 'نام، ای میل یا کردار تلاش کریں…',
    'admin.users.filterRole': 'تمام کردار',
    'admin.users.filterStatus': 'تمام حالتیں',
    'admin.users.user': 'صارف',
    'admin.users.tenant': 'ٹیننٹ',
    'admin.users.platform': 'پلیٹ فارم',
    'admin.users.role': 'کردار',
    'admin.users.roleHint': 'SuperAdmin پلیٹ فارم کے لیے ہے۔ Admin ایک ٹیننٹ تک محدود ہے۔',
    'admin.users.status': 'حالت',
    'admin.users.statusHint': 'غیر فعال صارف سائن ان نہیں کر سکتے مگر ڈیٹا محفوظ رہتا ہے۔',
    'admin.users.lastLogin': 'آخری لاگ ان',
    'admin.users.actions': 'کارروائیاں',
    'admin.users.account': 'اکاؤنٹ',
    'admin.users.fullName': 'پورا نام',
    'admin.users.edit': 'صارف میں ترمیم',
    'admin.users.editTitle': 'صارف میں ترمیم',
    'admin.users.resetPassword': 'پاس ورڈ ری سیٹ',
    'admin.users.resetAction': 'پاس ورڈ ری سیٹ',
    'admin.users.newPassword': 'نیا پاس ورڈ',
    'admin.users.passwordReset': 'پاس ورڈ ری سیٹ ہو گیا — محفوظ ذریعے سے شیئر کریں',
    'admin.users.passwordFailed': 'پاس ورڈ ری سیٹ ناکام',
    'admin.users.passwordWarning':
      'اس سے صارف کا پاس ورڈ فوراً تبدیل ہو جائے گا۔ قابلِ اعتماد ذریعے سے شیئر کریں اور ان سے تبدیلی کرنے کو کہیں۔',
    'admin.users.activate': 'فعال کریں',
    'admin.users.deactivate': 'غیر فعال کریں',
    'admin.users.activateTitle': 'اس صارف کو دوبارہ فعال کریں؟',
    'admin.users.activateDesc': '{email} دوبارہ سائن ان کر سکے گا۔',
    'admin.users.deactivateTitle': 'اس صارف کو غیر فعال کریں؟',
    'admin.users.deactivateDesc': '{email} اب سائن ان نہیں کر سکے گا۔',
    'admin.users.impersonate': 'اس کی جگہ سائن ان کریں',
    'admin.users.impersonateTitle': 'سپورٹ سیشن شروع کریں؟',
    'admin.users.impersonateDesc':
      'آپ 30 منٹ کے لیے {email} کے طور پر سائن ان ہوں گے۔ ان کی ہر کارروائی آڈیٹ لاگ میں آپ کے نام درج ہوگی۔',
    'admin.users.impersonateFailed': 'سیشن شروع نہیں ہو سکا',
    'admin.users.cannotImpersonate': 'پلیٹ فارم آپریٹرز کی ایمپرسونیٹیشن نہیں ہو سکتی',
    'admin.users.loadFailed': 'صارفین لوڈ نہیں ہو سکے',
    'admin.users.empty': 'ان فلٹرز سے کوئی صارف نہیں ملا',
    'admin.users.updated': 'صارف اپ ڈیٹ ہو گیا',
    'admin.users.updateFailed': 'اپ ڈیٹ ناکام',

    'admin.actionLog.platformTab': 'پلیٹ فارم کارروائیاں',
    'admin.actionLog.tenantTab': 'ٹیننٹ آڈٹ',
    'admin.actionLog.target': 'ہدف',
    'admin.actionLog.empty': 'کوئی پلیٹ فارم کارروائی ریکارڈ نہیں',

    'admin.impersonate.user': 'صارف',
    'admin.impersonate.tenant': 'ٹیننٹ',
    'admin.impersonate.role': 'کردار',
    'admin.impersonate.actions': 'کارروائی',
    'admin.impersonate.start': 'سیشن شروع کریں',
    'admin.impersonate.started': 'سپورٹ سیشن شروع — {email} کھولا جا رہا ہے',
    'admin.impersonate.starting': '{email} کے طور پر سیشن کھولا جا رہا ہے…',
    'admin.impersonate.search': 'نام، ای میل یا کردار سے تلاش کریں…',
    'admin.impersonate.empty': 'کوئی قابلِ ایمپرسونیٹیشن صارف نہیں ملا',
    'admin.impersonate.searchFailed': 'صارفین لوڈ نہیں ہو سکے',
    'admin.impersonate.auditNote':
      'پلیٹ فارم آپریٹرز کی ایمپرسونیٹیشن نہیں ہو سکتی۔ سیشن شروع کرنے پر آپ کے لاگ ان کوکیز 30 منٹ کے لیے تبدیل ہو جائیں گی۔',

    'admin.notices.updated': 'بروڈکاسٹ اپ ڈیٹ ہو گیا',
    'admin.notices.retracted': 'بروڈکاسٹ واپس لے لیا گیا',
    'admin.notices.retractFailed': 'اطلاع واپس نہیں لی جا سکی',
    'admin.notices.edit': 'بروڈکاسٹ میں ترمیم',
    'admin.notices.editTitle': 'بروڈکاسٹ میں ترمیم',
    'admin.notices.deactivate': 'غیر فعال کریں',
    'admin.notices.activate': 'دوبارہ فعال کریں',
    'admin.notices.retract': 'ہمیشہ کے لیے ہٹائیں',
    'admin.notices.inactive': 'غیر فعال',
    'admin.notices.titlePlaceholder': 'منصوبہ بند ترمیم کا وقت (اتوار 02:00 UTC)',
    'admin.notices.messagePlaceholder':
      'ہم ڈیٹابیس کو بہتر بنانے کے لیے وقفہ کریں گے۔ رسائی 15 منٹ تک صرف پڑھنے کے لیے ہوگی۔',
    'admin.notices.keepActive': 'فعال (ٹیننٹس کو نظر آئے گا)',
    'admin.notices.deactivateTitle': 'اس بروڈکاسٹ کو غیر فعال کریں؟',
    'admin.notices.deactivateDesc':
      'یہ ٹیننٹس کو نظر نہیں آئے گا مگر فہرست میں موجود رہے گا تاکہ آپ دوبارہ فعال کر سکیں۔',
    'admin.notices.activateTitle': 'اس بروڈکاسٹ کو دوبارہ فعال کریں؟',
    'admin.notices.activateDesc': 'یہ ٹیننٹس کو دوبارہ نظر آئے گا۔',
    'admin.notices.retractTitle': 'اس بروڈکاسٹ کو واپس لیں؟',
    'admin.notices.retractDesc':
      'یہ ہر ٹیننٹ سے غائب ہو جائے گا اور بحال نہیں ہو سکتا۔ واپسی کا ریکارڈ پلیٹ فارم ایکشن لاگ میں محفوظ رہے گا۔',

    'admin.tenants.detail.supportSession': 'سپورٹ سیشن شروع کریں',
    'admin.tenants.detail.supportSessionShort': 'سپورٹ',
  },

  hi: {
    'common.refresh': 'रिफ्रेश',
    'admin.nav.users': 'उपयोगकर्ता',
    'admin.nav.featureFlags': 'मॉड्यूल',
    'admin.nav.settings': 'सेटिंग्स',

    'admin.users.title': 'सभी उपयोगकर्ता',
    'admin.users.desc':
      'हर टेनेंट के सभी खाते। भूमिका बदलें, पहुँच बंद करें, भूला हुआ पासवर्ड रीसेट करें, या सपोर्ट सेशन खोलें।',
    'admin.users.search': 'नाम, ईमेल या भूमिका से खोजें…',
    'admin.users.filterRole': 'सभी भूमिकाएँ',
    'admin.users.filterStatus': 'सभी स्थितियाँ',
    'admin.users.user': 'उपयोगकर्ता',
    'admin.users.tenant': 'टेनेंट',
    'admin.users.platform': 'प्लेटफ़ॉर्म',
    'admin.users.role': 'भूमिका',
    'admin.users.roleHint': 'SuperAdmin पूरे प्लेटफ़ॉर्म के लिए है। Admin एक ही टेनेंट तक सीमित है।',
    'admin.users.status': 'स्थिति',
    'admin.users.statusHint': 'निष्क्रिय उपयोगकर्ता साइन इन नहीं कर सकते, पर डेटा सुरक्षित रहता है।',
    'admin.users.lastLogin': 'अंतिम लॉगिन',
    'admin.users.actions': 'क्रियाएँ',
    'admin.users.account': 'खाता',
    'admin.users.fullName': 'पूरा नाम',
    'admin.users.edit': 'उपयोगकर्ता संपादित करें',
    'admin.users.editTitle': 'उपयोगकर्ता संपादित करें',
    'admin.users.resetPassword': 'पासवर्ड रीसेट',
    'admin.users.resetAction': 'पासवर्ड रीसेट',
    'admin.users.newPassword': 'नया पासवर्ड',
    'admin.users.passwordReset': 'पासवर्ड रीसेट हो गया — सुरक्षित माध्यम से साझा करें',
    'admin.users.passwordFailed': 'पासवर्ड रीसेट विफल',
    'admin.users.passwordWarning':
      'इससे उपयोगकर्ता का पासवर्ड तुरंत बदल जाएगा। इसे भरोसेमंद माध्यम से साझा करें और उन्हें बदलने को कहें।',
    'admin.users.activate': 'सक्रिय करें',
    'admin.users.deactivate': 'निष्क्रिय करें',
    'admin.users.activateTitle': 'इस उपयोगकर्ता को फिर से सक्रिय करें?',
    'admin.users.activateDesc': '{email} फिर से साइन इन कर सकेंगे।',
    'admin.users.deactivateTitle': 'इस उपयोगकर्ता को निष्क्रिय करें?',
    'admin.users.deactivateDesc': '{email} अब साइन इन नहीं कर पाएँगे।',
    'admin.users.impersonate': 'प्रतिरूपण करें',
    'admin.users.impersonateTitle': 'सपोर्ट सेशन शुरू करें?',
    'admin.users.impersonateDesc':
      'आप 30 मिनट तक {email} के रूप में साइन इन होंगे। उनका हर कार्य ऑडिट लॉग में आपके नाम दर्ज होगा।',
    'admin.users.impersonateFailed': 'सेशन शुरू नहीं हो सका',
    'admin.users.cannotImpersonate': 'प्लेटफ़ॉर्म ऑपरेटरों का प्रतिरूपण नहीं किया जा सकता',
    'admin.users.loadFailed': 'उपयोगकर्ता लोड नहीं हो सके',
    'admin.users.empty': 'इन फ़िल्टर से कोई उपयोगकर्ता नहीं मिला',
    'admin.users.updated': 'उपयोगकर्ता अपडेट हो गया',
    'admin.users.updateFailed': 'अपडेट विफल',

    'admin.actionLog.platformTab': 'प्लेटफ़ॉर्म क्रियाएँ',
    'admin.actionLog.tenantTab': 'टेनेंट ऑडिट',
    'admin.actionLog.target': 'लक्ष्य',
    'admin.actionLog.empty': 'कोई प्लेटफ़ॉर्म क्रिया दर्ज नहीं',

    'admin.impersonate.user': 'उपयोगकर्ता',
    'admin.impersonate.tenant': 'टेनेंट',
    'admin.impersonate.role': 'भूमिका',
    'admin.impersonate.actions': 'क्रिया',
    'admin.impersonate.start': 'सेशन शुरू करें',
    'admin.impersonate.started': 'सपोर्ट सेशन शुरू — {email} खोला जा रहा है',
    'admin.impersonate.starting': '{email} के रूप में सेशन खोला जा रहा है…',
    'admin.impersonate.search': 'नाम, ईमेल या भूमिका से खोजें…',
    'admin.impersonate.empty': 'कोई प्रतिरूपण योग्य उपयोगकर्ता नहीं मिला',
    'admin.impersonate.searchFailed': 'उपयोगकर्ता लोड नहीं हो सके',
    'admin.impersonate.auditNote':
      'प्लेटफ़ॉर्म ऑपरेटरों का प्रतिरूपण नहीं किया जा सकता। सेशन शुरू करने पर आपके लॉगिन कुकीज़ 30 मिनट के लिए बदल जाती हैं।',

    'admin.notices.updated': 'ब्रॉडकास्ट अपडेट हो गया',
    'admin.notices.retracted': 'ब्रॉडकास्ट वापस ले लिया गया',
    'admin.notices.retractFailed': 'सूचना वापस नहीं ली जा सकी',
    'admin.notices.edit': 'ब्रॉडकास्ट संपादित करें',
    'admin.notices.editTitle': 'ब्रॉडकास्ट संपादित करें',
    'admin.notices.deactivate': 'निष्क्रिय करें',
    'admin.notices.activate': 'फिर से सक्रिय करें',
    'admin.notices.retract': 'स्थायी रूप से हटाएँ',
    'admin.notices.inactive': 'निष्क्रिय',
    'admin.notices.titlePlaceholder': 'नियोजित रखरखाव अवधि (रविवार 02:00 UTC)',
    'admin.notices.messagePlaceholder':
      'हम डेटाबेस अनुकूलन कर रहे हैं। पहुँच 15 मिनट के लिए केवल पढ़ने की होगी।',
    'admin.notices.keepActive': 'सक्रिय (टेनेंट्स को दिखेगा)',
    'admin.notices.deactivateTitle': 'इस ब्रॉडकास्ट को निष्क्रिय करें?',
    'admin.notices.deactivateDesc':
      'यह टेनेंट्स को नहीं दिखेगा, लेकिन सूची में रहेगा ताकि आप इसे फिर से सक्रिय कर सकें।',
    'admin.notices.activateTitle': 'इस ब्रॉडकास्ट को फिर से सक्रिय करें?',
    'admin.notices.activateDesc': 'यह टेनेंट्स को फिर से दिखेगा।',
    'admin.notices.retractTitle': 'इस ब्रॉडकास्ट को वापस लें?',
    'admin.notices.retractDesc':
      'यह हर टेनेंट से गायब हो जाएगा और बहाल नहीं हो सकता। वापसी का रिकॉर्ड प्लेटफ़ॉर्म एक्शन लॉग में रहेगा।',

    'admin.tenants.detail.supportSession': 'सपोर्ट सेशन शुरू करें',
    'admin.tenants.detail.supportSessionShort': 'सपोर्ट',
  },

  bn: {
    'common.refresh': 'রিফ্রেশ',
    'admin.nav.users': 'ব্যবহারকারী',
    'admin.nav.featureFlags': 'মডিউল',
    'admin.nav.settings': 'সেটিংস',

    'admin.users.title': 'সব ব্যবহারকারী',
    'admin.users.desc':
      'প্রতিটি টেন্যান্টের সব অ্যাকাউন্ট। ভূমিকা বদলান, অ্যাক্সেস বন্ধ করুন, ভুলে যাওয়া পাসওয়ার্ড রিসেট করুন, বা সাপোর্ট সেশন খুলুন।',
    'admin.users.search': 'নাম, ইমেইল বা ভূমিকা দিয়ে খুঁজুন…',
    'admin.users.filterRole': 'সব ভূমিকা',
    'admin.users.filterStatus': 'সব স্ট্যাটাস',
    'admin.users.user': 'ব্যবহারকারী',
    'admin.users.tenant': 'টেন্যান্ট',
    'admin.users.platform': 'প্ল্যাটফর্ম',
    'admin.users.role': 'ভূমিকা',
    'admin.users.roleHint': 'SuperAdmin প্ল্যাটফর্মজগত। Admin একটি টেন্যান্টের মধ্যেই সীমাবদ্ধ।',
    'admin.users.status': 'স্ট্যাটাস',
    'admin.users.statusHint': 'নিষ্ক্রিয় ব্যবহারকারী সাইন ইন করতে পারবেন না, তবে ডেটা অক্ষত থাকবে।',
    'admin.users.lastLogin': 'সর্বশেষ লগইন',
    'admin.users.actions': 'করণীয়',
    'admin.users.account': 'অ্যাকাউন্ট',
    'admin.users.fullName': 'পূর্ণ নাম',
    'admin.users.edit': 'ব্যবহারকারী সম্পাদনা',
    'admin.users.editTitle': 'ব্যবহারকারী সম্পাদনা',
    'admin.users.resetPassword': 'পাসওয়ার্ড রিসেট',
    'admin.users.resetAction': 'পাসওয়ার্ড রিসেট',
    'admin.users.newPassword': 'নতুন পাসওয়ার্ড',
    'admin.users.passwordReset': 'পাসওয়ার্ড রিসেট হয়েছে — নিরাপদ মাধ্যমে শেয়ার করুন',
    'admin.users.passwordFailed': 'পাসওয়ার্ড রিসেট ব্যর্থ',
    'admin.users.passwordWarning':
      'এতে ব্যবহারকারীর পাসওয়ার্ড সঙ্গে সঙ্গে বদলে যাবে। বিশ্বস্ত মাধ্যমে শেয়ার করুন এবং তাকে পরিবর্তন করতে বলুন।',
    'admin.users.activate': 'সক্রিয় করুন',
    'admin.users.deactivate': 'নিষ্ক্রিয় করুন',
    'admin.users.activateTitle': 'এই ব্যবহারকারীকে আবার সক্রিয় করবেন?',
    'admin.users.activateDesc': '{email} আবার সাইন ইন করতে পারবেন।',
    'admin.users.deactivateTitle': 'এই ব্যবহারকারীকে নিষ্ক্রিয় করবেন?',
    'admin.users.deactivateDesc': '{email} আর সাইন ইন করতে পারবেন না।',
    'admin.users.impersonate': 'অনুকরণ করুন',
    'admin.users.impersonateTitle': 'সাপোর্ট সেশন শুরু করবেন?',
    'admin.users.impersonateDesc':
      'আপনি ৩০ মিনিট {email} হিসেবে সাইন ইন থাকবেন। তাঁর প্রতিটি কাজ অডিট লগে আপনার নামে লিখবে।',
    'admin.users.impersonateFailed': 'সেশন শুরু করা যায়নি',
    'admin.users.cannotImpersonate': 'প্ল্যাটফর্ম অপারেটরদের অনুকরণ করা যায় না',
    'admin.users.loadFailed': 'ব্যবহারকারী লোড করা যায়নি',
    'admin.users.empty': 'এই ফিল্টারে কোনো ব্যবহারকারী মেলেনি',
    'admin.users.updated': 'ব্যবহারকারী আপডেট হয়েছে',
    'admin.users.updateFailed': 'আপডেট ব্যর্থ',

    'admin.actionLog.platformTab': 'প্ল্যাটফর্ম করণীয়',
    'admin.actionLog.tenantTab': 'টেন্যান্ট অডিট',
    'admin.actionLog.target': 'লক্ষ্য',
    'admin.actionLog.empty': 'কোনো প্ল্যাটফর্ম করণীয় নথিভুক্ত নেই',

    'admin.impersonate.user': 'ব্যবহারকারী',
    'admin.impersonate.tenant': 'টেন্যান্ট',
    'admin.impersonate.role': 'ভূমিকা',
    'admin.impersonate.actions': 'করণীয়',
    'admin.impersonate.start': 'সেশন শুরু করুন',
    'admin.impersonate.started': 'সাপোর্ট সেশন শুরু — {email} খোলা হচ্ছে',
    'admin.impersonate.starting': '{email} হিসেবে সেশন খোলা হচ্ছে…',
    'admin.impersonate.search': 'নাম, ইমেইল বা ভূমিকা দিয়ে খুঁজুন…',
    'admin.impersonate.empty': 'অনুকরণযোগ্য কোনো ব্যবহারকারী মেলেনি',
    'admin.impersonate.searchFailed': 'ব্যবহারকারী লোড করা যায়নি',
    'admin.impersonate.auditNote':
      'প্ল্যাটফর্ম অপারেটরদের অনুকরণ করা যায় না। সেশন শুরু করলে আপনার লগইন কুকি ৩০ মিনিটের জন্য বদলে যাবে।',

    'admin.notices.updated': 'ব্রডকাস্ট আপডেট হয়েছে',
    'admin.notices.retracted': 'ব্রডকাস্ট প্রত্যাহার করা হয়েছে',
    'admin.notices.retractFailed': 'বিজ্ঞপ্তি প্রত্যাহার করা যায়নি',
    'admin.notices.edit': 'ব্রডকাস্ট সম্পাদনা',
    'admin.notices.editTitle': 'ব্রডকাস্ট সম্পাদনা',
    'admin.notices.deactivate': 'নিষ্ক্রিয় করুন',
    'admin.notices.activate': 'পুনরায় সক্রিয় করুন',
    'admin.notices.retract': 'স্থায়ীভাবে সরান',
    'admin.notices.inactive': 'নিষ্ক্রিয়',
    'admin.notices.titlePlaceholder': 'নির্ধারিত রক্ষণাবেক্ষণ সময় (রবিবার ০২:০০ UTC)',
    'admin.notices.messagePlaceholder':
      'আমরা ডেটাবেস অনুকূল করছি। ১৫ মিনিটের জন্য অ্যাক্সেস শুধু পড়ার মতো থাকবে।',
    'admin.notices.keepActive': 'সক্রিয় (টেন্যান্টরা দেখবেন)',
    'admin.notices.deactivateTitle': 'এই ব্রডকাস্ট নিষ্ক্রিয় করবেন?',
    'admin.notices.deactivateDesc':
      'এটি টেন্যান্টদের দেখাবে না, তবে তালিকায় থাকবে যাতে আবার সক্রিয় করা যায়।',
    'admin.notices.activateTitle': 'এই ব্রডকাস্ট পুনরায় সক্রিয় করবেন?',
    'admin.notices.activateDesc': 'এটি টেন্যান্টদের আবার দেখাবে।',
    'admin.notices.retractTitle': 'এই ব্রডকাস্ট প্রত্যাহার করবেন?',
    'admin.notices.retractDesc':
      'এটি প্রতিটি টেন্যান্ট থেকে অদৃশ্য হয়ে যাবে এবং ফেরানো যাবে না। প্রত্যাহারের রেকর্ড প্ল্যাটফর্ম অ্যাকশন লগে থাকবে।',

    'admin.tenants.detail.supportSession': 'সাপোর্ট সেশন শুরু করুন',
    'admin.tenants.detail.supportSessionShort': 'সাপোর্ট',
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

// Verify every locale ended up with the identical key set.
const flatten = (o, prefix = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? flatten(v, `${prefix}${k}.`)
      : [`${prefix}${k}`]
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
