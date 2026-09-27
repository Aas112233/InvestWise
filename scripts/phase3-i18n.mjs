// Phase 3 i18n sync: deep-merges member directory + audit log keys into
// messages/{en,ur,hi,bn}.json. Re-runnable (merge, never delete).
// Validate with: node scripts/validate-i18n.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "ur", "hi", "bn"];

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      target[key] !== null &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

const additions = {
  en: {
    members: {
      columns: { code: "Member Code", name: "Name", contact: "Contact", shares: "Shares", contributed: "Total Contributed", warnings: "Warnings", status: "Status", actions: "Actions" },
      searchPlaceholder: "Search by name, email, or code...",
      statusFilter: "Status",
      allStatuses: "All statuses",
      addMember: "Add Member",
      refresh: "Refresh",
      statusLabels: { active: "Active", pending: "Pending", inactive: "Inactive", suspended: "Suspended" },
      rowMenu: { view: "View Profile", edit: "Edit", suspend: "Suspend", activate: "Activate", delete: "Delete" },
      suspendTitle: "Suspend member",
      suspendMessage: "Suspend {name}? They will not be able to sign in.",
      activateTitle: "Activate member",
      activateMessage: "Reactivate {name}?",
      deleteTitle: "Delete member",
      deleteMessage: "Permanently delete {name}? This cannot be undone.",
      suspendedToast: "{name} suspended.",
      activatedToast: "{name} activated.",
      deletedToast: "{name} deleted.",
      form: {
        titleAdd: "Add Member", titleEdit: "Edit Member", name: "Full name", email: "Email", phone: "Phone",
        role: "Role", selectRole: "Select role...", shares: "Shares",
        sharesLockedNote: "Shares are locked by transaction history and cannot be changed directly.",
        nid: "NID / Passport", father: "Father's name", address: "Address",
        nominee: "Nominee", nomineeRelation: "Relation", nomineePhone: "Nominee phone",
        save: "Save Member", saving: "Saving...",
        createdToast: "{name} added successfully.", updatedToast: "{name} updated successfully.",
      },
      detail: {
        profile: "Member Profile", sharesTitle: "Share Certificates", shares: "Shares",
        contributed: "Total Contributed", joinDate: "Join Date", deposits: "Deposit History",
        depositsEmpty: "No deposit records found.", warnings: "Warning Record",
        warningsEmpty: "No warnings on record.", performance: "Performance Score",
        contactTitle: "Contact Information",
      },
      errors: { loadFailed: "Failed to load members.", saveFailed: "Failed to save member." },
    },
    audit: {
      title: "Audit Logs",
      subtitle: "Immutable record of all system activity.",
      searchPlaceholder: "Search by user, details, or IP...",
      actionFilter: "Action",
      allActions: "All actions",
      resourceFilter: "Resource",
      allResources: "All resources",
      fromDate: "From date",
      toDate: "To date",
      clearFilters: "Clear filters",
      columns: { timestamp: "Timestamp", user: "User", action: "Action", resource: "Resource", ip: "IP Address", status: "Status", details: "Details", userAgent: "User Agent" },
      detailsTitle: "Log Details",
      detailsEmpty: "No additional details.",
      loadFailed: "Failed to load audit logs.",
      forbidden: "Access restricted",
      forbiddenDetails: "Only admins and managers can view audit logs.",
    },
  },
  ur: {
    members: {
      columns: { code: "ممبر کوڈ", name: "نام", contact: "رابطہ", shares: "شیئرز", contributed: "کل جمع", warnings: "تنبیہات", status: "حالت", actions: "عمل" },
      searchPlaceholder: "نام، ای میل یا کوڈ سے تلاش کریں...",
      statusFilter: "حالت",
      allStatuses: "تمام حالتیں",
      addMember: "ممبر شامل کریں",
      refresh: "ریفریش",
      statusLabels: { active: "فعال", pending: "زیر التواء", inactive: "غیر فعال", suspended: "معطل" },
      rowMenu: { view: "پروفائل دیکھیں", edit: "ترمیم", suspend: "معطل کریں", activate: "فعال کریں", delete: "حذف کریں" },
      suspendTitle: "ممبر معطل کریں",
      suspendMessage: "کیا آپ {name} کو معطل کرنا چاہتے ہیں؟ وہ سائن ان نہیں کر سکیں گے۔",
      activateTitle: "ممبر فعال کریں",
      activateMessage: "کیا آپ {name} کو دوبارہ فعال کرنا چاہتے ہیں؟",
      deleteTitle: "ممبر حذف کریں",
      deleteMessage: "کیا آپ {name} کو مستقل حذف کرنا چاہتے ہیں؟ یہ عمل واپس نہیں ہو سکتا۔",
      suspendedToast: "{name} معطل کر دیا گیا۔",
      activatedToast: "{name} فعال کر دیا گیا۔",
      deletedToast: "{name} حذف کر دیا گیا۔",
      form: {
        titleAdd: "نیا ممبر", titleEdit: "ممبر میں ترمیم", name: "پورا نام", email: "ای میل", phone: "فون",
        role: "کردار", selectRole: "کردار منتخب کریں...", shares: "شیئرز",
        sharesLockedNote: "شیئرز لین دین کی تاریخ سے لاک ہیں اور براہ راست تبدیل نہیں ہو سکتے۔",
        nid: "شناختی کارڈ/پاسپورٹ", father: "والد کا نام", address: "پتہ",
        nominee: "نامزد", nomineeRelation: "رشتہ", nomineePhone: "نامزد فون",
        save: "ممبر محفوظ کریں", saving: "محفوظ ہو رہا ہے...",
        createdToast: "{name} کامیابی سے شامل ہوا۔", updatedToast: "{name} اپ ڈیٹ ہو گیا۔",
      },
      detail: {
        profile: "ممبر پروفائل", sharesTitle: "شیئر سرٹیفکیٹ", shares: "شیئرز",
        contributed: "کل جمع شدہ", joinDate: "شمولیت کی تاریخ", deposits: "جمع کی تاریخ",
        depositsEmpty: "کوئی جمع ریکارڈ نہیں ملا۔", warnings: "تنبیہی ریکارڈ",
        warningsEmpty: "کوئی تنبیہ نہیں۔", performance: "کارکردگی اسکور",
        contactTitle: "رابطے کی معلومات",
      },
      errors: { loadFailed: "ممبرز لوڈ ناکام۔", saveFailed: "ممبر محفوظ ناکام۔" },
    },
    audit: {
      title: "آڈٹ لاگز",
      subtitle: "تمام سسٹم سرگرمیوں کا ناقابل ترمیم ریکارڈ۔",
      searchPlaceholder: "صارف، تفصیل یا IP سے تلاش کریں...",
      actionFilter: "عمل",
      allActions: "تمام اعمال",
      resourceFilter: "ریسورس",
      allResources: "تمام ریسورسز",
      fromDate: "از تاریخ",
      toDate: "تا تاریخ",
      clearFilters: "فلٹر صاف کریں",
      columns: { timestamp: "وقت", user: "صارف", action: "عمل", resource: "ریسورس", ip: "IP ایڈریس", status: "حالت", details: "تفصیل", userAgent: "یوزر ایجنٹ" },
      detailsTitle: "لاگ کی تفصیل",
      detailsEmpty: "کوئی اضافی تفصیل نہیں۔",
      loadFailed: "آڈٹ لاگز لوڈ ناکام۔",
      forbidden: "رسائی محدود",
      forbiddenDetails: "صرف ایڈمن اور مینیجر آڈٹ لاگز دیکھ سکتے ہیں۔",
    },
  },
  hi: {
    members: {
      columns: { code: "सदस्य कोड", name: "नाम", contact: "संपर्क", shares: "शेयर", contributed: "कुल जमा", warnings: "चेतावनी", status: "स्थिति", actions: "कार्रवाई" },
      searchPlaceholder: "नाम, ईमेल या कोड से खोजें...",
      statusFilter: "स्थिति",
      allStatuses: "सभी स्थितियाँ",
      addMember: "सदस्य जोड़ें",
      refresh: "रिफ़्रेश",
      statusLabels: { active: "सक्रिय", pending: "लंबित", inactive: "निष्क्रिय", suspended: "निलंबित" },
      rowMenu: { view: "प्रोफ़ाइल देखें", edit: "संपादित करें", suspend: "निलंबित करें", activate: "सक्रिय करें", delete: "हटाएँ" },
      suspendTitle: "सदस्य निलंबित करें",
      suspendMessage: "क्या आप {name} को निलंबित करना चाहते हैं? वे साइन इन नहीं कर पाएँगे।",
      activateTitle: "सदस्य सक्रिय करें",
      activateMessage: "क्या आप {name} को पुनः सक्रिय करना चाहते हैं?",
      deleteTitle: "सदस्य हटाएँ",
      deleteMessage: "क्या आप {name} को स्थायी रूप से हटाना चाहते हैं? यह वापस नहीं होगा।",
      suspendedToast: "{name} निलंबित किया गया।",
      activatedToast: "{name} सक्रिय किया गया।",
      deletedToast: "{name} हटाया गया।",
      form: {
        titleAdd: "नया सदस्य", titleEdit: "सदस्य संपादित करें", name: "पूरा नाम", email: "ईमेल", phone: "फ़ोन",
        role: "भूमिका", selectRole: "भूमिका चुनें...", shares: "शेयर",
        sharesLockedNote: "शेयर लेनदेन इतिहास से लॉक हैं और सीधे बदले नहीं जा सकते।",
        nid: "पहचान पत्र/पासपोर्ट", father: "पिता का नाम", address: "पता",
        nominee: "नामांकित", nomineeRelation: "संबंध", nomineePhone: "नामांकित फ़ोन",
        save: "सदस्य सहेजें", saving: "सहेजा जा रहा है...",
        createdToast: "{name} सफलतापूर्वक जोड़ा गया।", updatedToast: "{name} अपडेट किया गया।",
      },
      detail: {
        profile: "सदस्य प्रोफ़ाइल", sharesTitle: "शेयर प्रमाणपत्र", shares: "शेयर",
        contributed: "कुल जमा", joinDate: "शामिल होने की तिथि", deposits: "जमा इतिहास",
        depositsEmpty: "कोई जमा रिकॉर्ड नहीं मिला।", warnings: "चेतावनी रिकॉर्ड",
        warningsEmpty: "कोई चेतावनी नहीं।", performance: "प्रदर्शन स्कोर",
        contactTitle: "संपर्क जानकारी",
      },
      errors: { loadFailed: "सदस्य लोड विफल।", saveFailed: "सदस्य सहेजना विफल।" },
    },
    audit: {
      title: "ऑडिट लॉग",
      subtitle: "सभी सिस्टम गतिविधियों का अपरिवर्तनीय रिकॉर्ड।",
      searchPlaceholder: "उपयोगकर्ता, विवरण या IP से खोजें...",
      actionFilter: "कार्रवाई",
      allActions: "सभी कार्रवाइयाँ",
      resourceFilter: "संसाधन",
      allResources: "सभी संसाधन",
      fromDate: "तिथि से",
      toDate: "तिथि तक",
      clearFilters: "फ़िल्टर साफ़ करें",
      columns: { timestamp: "समय", user: "उपयोगकर्ता", action: "कार्रवाई", resource: "संसाधन", ip: "IP पता", status: "स्थिति", details: "विवरण", userAgent: "यूज़र एजेंट" },
      detailsTitle: "लॉग विवरण",
      detailsEmpty: "कोई अतिरिक्त विवरण नहीं।",
      loadFailed: "ऑडिट लॉग लोड विफल।",
      forbidden: "पहुँच प्रतिबंधित",
      forbiddenDetails: "केवल एडमिन और प्रबंधक ऑडिट लॉग देख सकते हैं।",
    },
  },
  bn: {
    members: {
      columns: { code: "সদস্য কোড", name: "নাম", contact: "যোগাযোগ", shares: "শেয়ার", contributed: "মোট জমা", warnings: "সতর্কতা", status: "অবস্থা", actions: "পদক্ষেপ" },
      searchPlaceholder: "নাম, ইমেইল বা কোড দিয়ে খুঁজুন...",
      statusFilter: "অবস্থা",
      allStatuses: "সব অবস্থা",
      addMember: "সদস্য যোগ করুন",
      refresh: "রিফ্রেশ",
      statusLabels: { active: "সক্রিয়", pending: "অপেক্ষমাণ", inactive: "নিষ্ক্রিয়", suspended: "বরখাস্ত" },
      rowMenu: { view: "প্রোফাইল দেখুন", edit: "সম্পাদনা", suspend: "বরখাস্ত করুন", activate: "সক্রিয় করুন", delete: "মুছুন" },
      suspendTitle: "সদস্য বরখাস্ত করুন",
      suspendMessage: "আপনি কি {name}-কে বরখাস্ত করতে চান? তিনি সাইন ইন করতে পারবেন না।",
      activateTitle: "সদস্য সক্রিয় করুন",
      activateMessage: "আপনি কি {name}-কে পুনরায় সক্রিয় করতে চান?",
      deleteTitle: "সদস্য মুছুন",
      deleteMessage: "আপনি কি {name}-কে স্থায়ীভাবে মুছতে চান? এটি ফেরত আসবে না।",
      suspendedToast: "{name} বরখাস্ত করা হয়েছে।",
      activatedToast: "{name} সক্রিয় করা হয়েছে।",
      deletedToast: "{name} মোছা হয়েছে।",
      form: {
        titleAdd: "নতুন সদস্য", titleEdit: "সদস্য সম্পাদনা", name: "পুরো নাম", email: "ইমেইল", phone: "ফোন",
        role: "ভূমিকা", selectRole: "ভূমিকা নির্বাচন...", shares: "শেয়ার",
        sharesLockedNote: "শেয়ার লেনদেন ইতিহাস দ্বারা লক এবং সরাসরি বদলানো যাবে না।",
        nid: "পরিচয়পত্র/পাসপোর্ট", father: "বাবার নাম", address: "ঠিকানা",
        nominee: "মনোনীত", nomineeRelation: "সম্পর্ক", nomineePhone: "মনোনীত ফোন",
        save: "সদস্য সংরক্ষণ", saving: "সংরক্ষণ হচ্ছে...",
        createdToast: "{name} সফলভাবে যোগ হয়েছে।", updatedToast: "{name} আপডেট হয়েছে।",
      },
      detail: {
        profile: "সদস্য প্রোফাইল", sharesTitle: "শেয়ার সার্টিফিকেট", shares: "শেয়ার",
        contributed: "মোট জমা", joinDate: "যোগদানের তারিখ", deposits: "জমার ইতিহাস",
        depositsEmpty: "কোনো জমার রেকর্ড পাওয়া যায়নি।", warnings: "সতর্কতা রেকর্ড",
        warningsEmpty: "কোনো সতর্কতা নেই।", performance: "কর্মক্ষমতা স্কোর",
        contactTitle: "যোগাযোগের তথ্য",
      },
      errors: { loadFailed: "সদস্য লোড ব্যর্থ।", saveFailed: "সদস্য সংরক্ষণ ব্যর্থ।" },
    },
    audit: {
      title: "অডিট লগ",
      subtitle: "সব সিস্টেম কার্যক্রমের অপরিবর্তনীয় রেকর্ড।",
      searchPlaceholder: "ব্যবহারকারী, বিবরণ বা IP দিয়ে খুঁজুন...",
      actionFilter: "কাজ",
      allActions: "সব কাজ",
      resourceFilter: "রিসোর্স",
      allResources: "সব রিসোর্স",
      fromDate: "তারিখ থেকে",
      toDate: "তারিখ পর্যন্ত",
      clearFilters: "ফিল্টার মুছুন",
      columns: { timestamp: "সময়", user: "ব্যবহারকারী", action: "কাজ", resource: "রিসোর্স", ip: "IP ঠিকানা", status: "অবস্থা", details: "বিবরণ", userAgent: "ইউজার এজেন্ট" },
      detailsTitle: "লগ বিবরণ",
      detailsEmpty: "অতিরিক্ত বিবরণ নেই।",
      loadFailed: "অডিট লগ লোড ব্যর্থ।",
      forbidden: "প্রবেশ সীমাবদ্ধ",
      forbiddenDetails: "শুধু অ্যাডমিন ও ম্যানেজার অডিট লগ দেখতে পারেন।",
    },
  },
};

for (const locale of LOCALES) {
  const path = join(root, "messages", `${locale}.json`);
  const current = JSON.parse(readFileSync(path, "utf8"));
  deepMerge(current, additions[locale]);
  writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`merged phase-3 keys into messages/${locale}.json`);
}
