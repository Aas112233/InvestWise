// Project types (migration 0032) — i18n sync.
//
// Adds every key the type selector, the Project Level Members contract section,
// the Review-before-save panel and the settle/detail labels reference, in all
// four locales, and removes the v9 meter strings whose feature no longer exists.
//
// WHY THIS EDITS THE FILES AS TEXT, NOT AS PARSED JSON: these dictionaries are
// not byte-identical to `JSON.stringify(parse(file), null, 2)` (escaped
// sequences, formatting), so a round-trip would rewrite the whole 147 KB file,
// bury a 50-key change in thousands of formatting lines and collide with any
// concurrent edit. Every line here is inserted or removed in place, so the diff
// is exactly the keys this feature added — nothing else.
//
// Order matters: INSERTIONS run first (they anchor on keys that exist today,
// including some the RETIRED list then removes), then deletions.
//
// Re-runnable: an existing key is never overwritten, and a missing line is
// simply not found. Run: node scripts/project-types-i18n.mjs
// Then:     npm run i18n:validate && npm run i18n:audit
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** [en, ur, hi, bn] — interpolation names must match the t() call sites. */
const KEYS = {
  // Anchored inside `projects.form`.
  "projects.form.typeSection": ["Project Type", "پروجیکٹ کی قسم", "परियोजना का प्रकार", "প্রকল্পের ধরন"],
  "projects.form.typeClub": ["Club Level", "کلب سطح", "क्लब-स्तरीय", "ক্লাব-স্তর"],
  "projects.form.typeClubHint": [
    "Board and Shareholder Members only. Capital by shares, returns by the category rules in Settings → Financial.",
    "صرف بورڈ اور شیئر ہولڈر ارکان۔ سرمایہ شیئروں کے مطابق، منافع ترتیبات → مالیات کے زمرہ جات کے مطابق۔",
    "केवल बोर्ड और शेयरहोल्डर सदस्य। पूंजी शेयरों से, लाभ सेटिंग्स → वित्तीय के श्रेणी नियमों से।",
    "শুধুমাত্ৰ বোৰ্ড আৰু শ্েয়ৰহোল্ডাৰ সদস্য। মূলধন শ্েয়ৰ অনুসৰি, আয় ্েটিংছ → মালিত শ্েণীৰ নিয়ম অনুসৰি।",
  ],
  "projects.form.typeExtra": ["Extra Investor", "اضافی سیانمکار", "अतिरत ा", "অতৰিক্ত বনয়োগকাৰী"],
  "projects.form.typeExtraHint": [
    "Adds Project Level Members. Their contract percentage of the budget is funded first; Board and Shareholders fund the rest and split the remaining profit purely by share number.",
    "پروجیکٹ سطح کے ارکان شامل کرتا ہے۔ بجٹ کا ان کا معاوضتی فیصد پہلے جمع ہوتا ہے؛ بورڈ اَور شیئر ہولڈر باقی دیتے ہیں اَور باقی منافع صرف شیئر تعداد سے تقسیم کرتے ہیں۔",
    "परियोजना-तरीय सदस्य जोड़ता है। बजट में उनका अनुबंध ात पहिले भरता है; बोर्ड अَौर शेयरहोल्डर बाकī भरते हَौर शेष लाभ केवल शयर संया से बँटते ह।",
    "প্ৰকল্প-স্তরের সদস্য যোগ কৰে। বাজেটত তেওলোৰ চুক্তি শতকৰা প্ৰথমে সংগ্হ হয়; বোৰ্ড আৰু শ্েয়ৰহোল্ডাৰে বাকী সংগ্হ কৰে আৰু বাকী লাভ কেৱল শ্েয়ৰ সংখ্য়াৰে ভাগ কৰে।",
  ],
  "projects.form.typeLockedNote": [
    "This project already has ledger entries, so its type can no longer be changed — the capital and returns were recorded under the rules it was created with.",
    "اس پروجیکٹ میں پہلے سے لیجر اندراج ہیں، لہذا اس کی قسم اَب نہیں بدلی جا سکتی — سرمایہ اَور منافع اُسی قواعد میں درج ہیں جس کے ساتھ یہ بنا تھا۔",
    "इस परियोजना में पहिले से खता प्रिविां ह, इसलए उसका ्कादर اَب नहं बदला जा सकता — पूंजी अَौर लाभ उसी नियमों में दरज हुए जिक साथ वह बनी थी।",
    "এই প্ৰকল্পৰ ইতিমধ্েয় খতিা এনত্ৰভুক্তি আছ, গতিকে এৰ ধৰণ আৰু সলনি কৰা নযায — মূলধন আৰু আয় সেই নীয়মে লিপিবদ্ধ হৈছিল যিটোত ই সৃি্ট হৈছিল।",
  ],
  "projects.form.typePickFirst": [
    "Choose the project type above to see how the capital is funded and how the returns are split.",
    "دیکھن کے لۓے کہ سرمایہ کیسے جمع ہوتا ہے اَور منافع کیسے تقسیم ہوتا ہے، اوپر پروجیکٹ کی قسم چنیں۔",
    "देखने के लॕए क पूंजी कैसे भरता है अ०र लाभ कैसे बँटता है, ऊपर परियोजन का ्कादर चुनेन।",
    "মূলধন কেনেকৈ সংগ্হ হয় আৰু আয় কেনেকৈ ভাগ হয় দেখিবোৰে বাবে ওপৰত প্ৰকল্পেৰ ধৰণ বাছনি কৰক।",
  ],
  "projects.form.typeClubCapitalNote": [
    "Club Level: every member funds by shares, and returns follow the category rules in Settings → Financial. There is no contract percentage on a club project.",
    "کلب سطح: ہر رکن شیئروں سے سرمایہ دیتا ہے اَور منافع ترتیبات → مالیات کے زمرہ جات پر چلتا ہے۔ کلب پروجیکٹ کا کوئی معاوضتی فیصد نہیں ہوتا۔",
    "क्लब-स्तरीय: हर सदस्य शयरों से पूंजी भरता है अ०र लाभ सेटंग्स → वत्तीय के श्रेणीय नियमों का पालन करत है। क्लব परियोजन का कोई अनुबंध ात नहं होता।",
    "ক্লাব-স্তৰ: প্ৰত্য়েকে শ্েয়ৰে মূলধন দিয়ে আয় ্েটিংছ → মালিতৰ শ্েণীৰ নীয়ম মানি চলে। ক্লাব প্ৰকল্পেৰ কোনো চুক্তি শতকৰা নাই।",
  ],
  "projects.form.pmSection": ["Project Level Members", "پروجیکٹ سطح کے ارکان", "परियोजना-तरीय सदस्य", "প্ৰকল্প-স্তরের সদস্য"],
  "projects.form.pmPercentContract": [
    "Contract — Project Level Members' share of the budget (%)",
    "معاوضہ — بجٹ میں پروجیکٹ سطح کے ارکان کا حصہ (٪)",
    "अनुबंध — बजट में परियोजना-तरीय सदस्यो ंका हिस्सा (%)",
    "চুক্তি — বাজেটত প্ৰকল্প-স্তরের সদস্যেৰ অংশ শতকৰা (%)",
  ],
  "projects.form.pmPercentContractHint": [
    "One percentage for the project, not per member. Every Project Level Member obligation below is derived from it, and the same figure is what their returns follow.",
    "پروجیکٹ کے لۓے ایک ہی فیصد، ہر رکن کے لۓے نہیں۔ نیچے ہر پروجیکٹ سطح کے رکن کی زمہداری اسی سے بنتی ہے اَور وہی عدد ان کا منافع طے کرتا ہے۔",
    "परियोजन के लॕए एक ही ात, हर सदस्य के लॕए नहं। नीचे हर परियोजन-तरीय सदस्य का दायत्व उसी से बनता है अ०र वही अंक उनका लाभ तय करत है।",
    "প্ৰকল্পেৰ বাবে এটাই শতকৰা, প্ৰত্য়েকে নহোয়। তলত প্ৰত্েক প্ৰকল্প-স্তরের সদস্যেৰ দায়িত্ব সেইৰেপৰা গণনা কৰা হয় আৰু সেই সংখ্য়াই তেওলোৰ আয় নিৰ্ধাৰণ কৰে।",
  ],
  "projects.form.pmContractChip": ["Contract {{amount}}", "معاوضہ {{amount}}", "अनबंध {{amount}}", "চুক্তি {{amount}}"],
  "projects.form.pmEachChip": [
    "{{each}} per member ({{count}})",
    "فی رکن {{each}} ({{count}})",
    "प्ित सदस्य {{each}} ({{count}})",
    "প্ৰতি সদস্য {{each}} ({{count}})",
  ],
  "projects.form.clubCeilingChip": [
    "Board + Shareholders may fund up to {{ceiling}}",
    "بورڈ + شیئر ہولڈر زیاده سے زیاده {{ceiling}} دے سکتے ہيں",
    "बोर्ड + शेयरहोल्डर अधिकतम {{ceiling}} तक भर सकते ह",
    "বোৰ্ড + শ্েয়ৰহোল্ডাৰে সৰ্বাধিক {{ceiling}} দিব পাৰিব",
  ],
  "projects.form.noPmRows": [
    "No Project Level Members yet. Add one to fund the contract against a member and a deposit fund.",
    "اَب کوئی پروجیکٹ سطح کا رکن نہیں۔ معاوضہ کسی رکن اَور ڈپازٹ فنڈ کے خلاف جمع کرنے کے لۓے ایک شامل کریں۔",
    "अब कोई परियोजन-तरीय सदस्य नहं। एक सदस्य जोड़ें ता क अनुबंध उस सदस्य के निेय कोश से भरा जाय।",
    "এতিয়ালৈ কোনো প্ৰকল্প-স্তরের সদস্য নাই। চুক্তি এজন সদস্য আৰু এটা জমা তহবিলেৰে পূৰ কৰাৰ বাবে এজন যোগ কৰক।",
  ],
  "projects.form.contractCapital": ["Contract capital", "معاوضتی سرمایہ", "अनबंध पूंजी", "চুক্তিৰ মূলধন"],
  "projects.form.noShares": ["—", "—", "—", "—"],
  "projects.form.pmNoSharesHint": [
    "Funds by contract percentage, not by shares",
    "فیصد معاوضے سے سرمایہ، شیئروں سے نہیں",
    "अनबंध ात से पूंजी, शयरों से नहं",
    "চুক্তিৰ শতকৰাৰে মূলধন, শ্েয়ৰেৰে নহোয়",
  ],
  "projects.form.selectPmMember": [
    "Select a Project Level Member...",
    "پروجیکٹ سطح کا رکن چنیں...",
    "एक परियोजना-तरीय सदस्य चुनेन...",
    "এজন প্ৰকল্প-স্তরের সদস্য বাছনি কৰক...",
  ],
  "projects.form.addPmMember": [
    "Add Project Level Member",
    "پروجیکٹ سطح کا رکن شامل کریں",
    "परियोजन-तरीय सदस्य जोड़ें",
    "প্ৰকল্প-স্তরের সদস্য যোগ কৰক",
  ],
  "projects.form.pmDepositShort": [
    "Deposit balance is below this contract (Available: {{available}})",
    "ڈپازٹ بیلنس اس معاوضے سے کم ہے (دستیاب: {{available}})",
    "नियेय शेष इस अनुबंध से कम है (उपलब्ध: {{available}})",
    "জমা ভাৰসন এই চুক্তিৰ তলত (উপলব্ধ: {{available}})",
  ],
  "projects.form.pmRowIncomplete": [
    "Each Project Level Member needs both a source deposit fund and a member.",
    "ہر پروجیکٹ سطح کے رکن کے لۓے ماخذ ڈپازٹ فنڈ اَور رکن دونوں چاہیے۔",
    "हर परियोजना-तरीय सदस्य के लॕए सोत निॆेय कोश अ०र सदस्य दोनो ंचाहए।",
    "প্ৰত্েক প্ৰকল্প-স্তরের সদস্যেৰ বাবে উৎস জমা তহবিল আৰু সদস্য দুয়টাই লাগে।",
  ],
  "projects.validation.typeRequired": [
    "Choose the project type: Club Level or Extra Investor.",
    "پروجیکٹ کی قسم چنیں: کلب سطح یا اضافی سیانمکار۔",
    "परियोजना का ्कदार चुनेन: क्लब-स्तरीय या अतरत ा।",
    "প্ৰকল্পেৰ ধৰণ বাছনি কৰক: ক্লাব-স্তৰ নাইবাে অতিৰিক্ত বিনিয়ােগকাৰী।",
  ],
  "projects.validation.pmPercentRequired": [
    "This project has Project Level Members, so their contract percentage is required.",
    "اس پروجیکٹ میں پروجیکٹ سطح کے ارکان ہيں، لہذا اُن کا معاوضتی فیصد لازمی ہے۔",
    "इस परियोजन में परियोजन-तरीय सदस्य ह, इसलए उनका अनुबंध ात आवश्यك है।",
    "এই প্ৰকল্পত প্ৰকল্প-স্তরের সদস্য আছ, গতিকে তেওলোৰ চুক্তি শতকৰা আৱশ্যক।",
  ],
  "projects.validation.capitalExceedsClubCeiling": [
    "Board and Shareholder capital ({{invested}}) exceeds what the Project Level Member contract leaves of the budget ({{ceiling}}). Contract: {{contract}} of {{budget}}.",
    "بورڈ اَور شیئر ہولڈر سرمایہ ({{invested}}) اس سے زیاده ہے جو پروجیکٹ سطح کا معاوضہ بجٹ میں باقی چھوڑتا ہے ({{ceiling}})۔ معاوضہ: {{budget}} میں سے {{contract}}۔",
    "बोर्ड अ०र शेयरहोल्डर पूंजी ({{invested}}) इससे अधिक है जो परियोजन-तरीय अनुबंध बजट में शेष छोड़ता है ({{ceiling}})। अनुबंध: {{budget}} में से {{contract}}।",
    "বোৰ্ড আৰু শ্েয়ৰহোল্ডাৰ মূলধন ({{invested}}) তাতকৈ বেছি যাি প্ৰকল্প-স্তরের চুক্তি বাজেটত থাই যাে ({{ceiling}})। চুক্তি: {{budget}}ৰ পৰা {{contract}}।",
  ],
  "projects.shareholders.insufficientForContract": [
    "cannot fund its contract share (Available: {{available}}, Required: {{required}}).",
    "اپنا معاوضتی حصہ جمع نہيں کرسکتا (دستیاب: {{available}}، درکار: {{required}})۔",
    "अपन अनुबंध ंश नहं भर सकत (उपलब्ध: {{available}}, आवश्यक: {{required}})।",
    "নিজৰ চুক্তিৰ অংশ সংগ্হ কৰিব নোৱাৰে (উপলব্ধ: {{available}}, প্ৰযোজন: {{required}})।",
  ],
  "projects.shareholders.insufficientFundForContract": [
    "cannot fund this contract (Available: {{available}}, Required: {{required}}).",
    "یہ معاوضہ جمع نہيں کرسکتا (دستیاب: {{available}}، درکار: {{required}})۔",
    "यह अनुबंध नहं भर सकत (उपलब्ध: {{available}}, आवश्यك: {{required}})।",
    "এই চুক্তি সংগ্হ কৰিব নোৱাৰে (উপলব্ধ: {{available}}, প্ৰযোজন: {{required}})।",
  ],
  "projects.returns.noShares": ["—", "—", "—", "—"],
  "projects.pmContractLabel": [
    "Project Level Members contract: {{percent}}% of budget",
    "پروجیکٹ سطح کے ارکان کا معاوضہ: بجٹ کا {{percent}}٪",
    "परियोजन-तरीय सदस्यो ंका अनुबंध: बजट का {{percent}}%",
    "প্ৰকল্প-স্তরের সদস্যেৰ চুক্তি: বাজেটৰ {{percent}}%",
  ],
  "projects.reviewButton": ["Review", "جائزہ", "समीा", "পৰ্যালোচনা"],
  "projects.review.title": [
    "Review the split before saving",
    "محفوظ کرنے سے پہلے تقسیم کا جائزہ",
    "सहेजने से पहलै वॉटन का समीा",
    "সংৰক্ষণৰ পৰ্বৰে ভাগৰ পৰ্যালোচনা",
  ],
  "projects.review.member": ["Member", "رکن", "सदस्य", "सदস্য"],
  "projects.review.category": ["Category", "زمرہ", "श्रेणী", "শ্েণী"],
  "projects.review.weight": ["Weight", "وزن", "वजन", "ওজন"],
  "projects.review.capital": ["Capital", "سرمایہ", "पूंजी", "মূলধন"],
  "projects.review.categoryPm": [
    "Project Level Member",
    "پروجیکٹ سطح کا رکن",
    "परियोजना-तरीय सदस्य",
    "প্ৰকল্প-স্তরের সদস্য",
  ],
  "projects.review.weightContract": ["contract", "معاوضہ", "अनबंध", "चुక్ত"],
  "projects.review.nobody": [
    "No one is funding this project yet — you can add participants later.",
    "اَب کوئی اس پروجیکٹ کو سرمایہ نہيں دے رہا — آپ ارکان بعد میں شامل کر سکتے ہيں۔",
    "अब कोई इस परियोजन को पूंजी नहं दे रह — आप सदस्य बाद में जोड़ सकते ह।",
    "এতিয়ালৈ কোনোৱে এই প্ৰকল্পত মূলধন দিয়া নাই — আপুনি পিছত সদস্য যোগ কৰিব পাৰে।",
  ],
  "projects.review.budget": ["Budget {{amount}}", "بجٹ {{amount}}", "بजट {{amount}}", "বাজেট {{amount}}"],
  "projects.review.contract": [
    "Project Level Members contract {{percent}}%",
    "پروجیکٹ سطح کے ارکان کا معاوضہ {{percent}}٪",
    "परियोजन-तरीय सदस्यो ंका अनुबंध {{percent}}%",
    "প্ৰকল্প-স্তরের সদস্যেৰ চুক্তি {{percent}}%",
  ],
  "projects.review.typeExtra": ["Extra Investor", "اضافی سیانمکار", "अतरत ा", "অতিৰিক্ত বিনয়ােগকাৰী"],
  "projects.review.potPm": ["Project Level Members", "پروجیکٹ سطح کے ارکان", "परियोजन-तरीय सदस्य", "প্ৰকল্প-স্তরের সদস্য"],
  "projects.review.potClub": ["Board + Shareholders", "بورڈ + شیئر ہولڈر", "بورد + शेयरहोल्डर", "بورڈ + شہئرہولڈر"],
  "projects.review.potPercentOfPool": [
    "% of the member pool",
    "ارکان کے پول کا فیصد",
    "सदस्य पूल क ात",
    "সদস্য পুলেৰ শতকৰা",
  ],
  "projects.review.potPercentOfRemainder": [
    "% of what the contract leaves",
    "معاوضے کے بعد باقی کا فیصد",
    "अनबंध के ब ष्य क ात",
    "চুক্তিৰ পৰা বাঁকীেৰ শতকৰা",
  ],
  "projects.review.potCapital": ["capital", "سرمایہ", "پूंजी", "মূলধन"],
  "projects.review.splitExtra": [
    "{{percent}}% contract, then 100% of the remainder by share number",
    "{{percent}}٪ معاوضہ، پھر باقی 100٪ شیئر تعداد سے",
    "{{percent}}% अनुबंध, फर शेष 100% शयर संख्يا से",
    "{{percent}}% চুক্তি, তাদৰে বাঁকী ১০০% শেয়ৰ সংখ্য়াৰে",
  ],
  "projects.review.splitClub": [
    "100% by the category rules and share numbers",
    "100٪ زمرہ جات اَور شیئر تعداد سے",
    "100% श्रेण ीय नियमो ंऔर शयर संख् यो ंसे",
    "১০০% শেণীৰ নিয়ম আৰু শেয়ৰ সংখ্য়াৰে",
  ],
  "projects.review.addsUp": [
    "Capital total {{total}} of the {{ceiling}} budget. The member pool splits as {{split}} — that is 100% of the project, once.",
    "کُل سرمایہ {{total}}, بجٹ {{ceiling}} سے۔ ارکان کا پول یس طرز پر تقسیم ہوتا ہے: {{split}} — یہ پروجیکٹ کا 100٪ ہے, ایک ہی بار۔",
    "कूल पूंजी {{total}}, बजट {{ceiling}} से। सदस्य पूल इसर ंटता है: {{split}} — य परियोजन क 100% है, एक बार।",
    "মুঠ মূলধন {{total}}, বাজেট {{ceiling}}ৰ পৰা। সদস্য পুল এনেকৈ ভাগ হয়: {{split}} — ইয়াই প্ৰকল্পেৰ ১০০%, একবাৰ।",
  ],
  "projects.review.back": ["Back to editing", "ترمیم پر واپس", "संपादन पर वापस", "সম্পাদনৈ উভতি"],
  "projects.review.confirm": [
    "Confirm & save",
    "تصدیق کر کے محفوظ کریں",
    "पुष्ट करके सहेजें",
    "নিশ্চিত কৰি সংৰক্ষণ কৰক",
  ],
  "members.form.projectBindingHint": [
    "Only Extra Investor projects appear: a Project Level Member exists inside a contract, and a Club Level project has no seat for one.",
    "صرف اضافی سیانمکاری پروجیکٹ نظر اتے ہيں: پروجیکٹ سطح کا رکن ایک معاوضے کے اندर ہوتا ہے, اور کلب سطح کے پروجیکٹ میں اس کے لۓ جگہ نہيں۔",
    "केवल अतरत ा परयोजनाए दिखत ह: परयोजना-तरीय सदस्य एक अनुबंध के अंदर रहता ह, और क्लब-तरीय परयोजना में उसके लॕए स्थान नहं ह।",
    "কেৱল অতৰিক্ত বনয়োগকাৰী প্ৰকল্পহে দেখা জয: প্ৰকল্প-স্তরের সদস্য এট চুক্তিৰ ভতৰত থাকে, আৰু ক্লাব-স্তৰেৰ প্ৰকল্পত তাৰ বাবে ঠাই নাই।",
  ],
};

/**
 * Where each group is inserted: the line whose key it goes after. Every anchor
 * below occurs exactly once per locale file (verified), so the insertion point
 * is unambiguous and the new key lands in the right object.
 */
const ANCHORS = {
  "projects.form": "pmPercent",
  "projects.validation": "capitalExceedsBudget",
  "projects.shareholders": "sourceFundRequired",
  "projects.returns": "categoryBreakdown",
  projects: "pmPercentLabel",
  "members.form": "projectBinding",
};

/** v9 meter strings whose feature migration 0032 removed. */
const RETIRED = [
  "pmPercent",
  "pmPercentMeter",
  "pmPercentOver",
  "pmPercentHintClub",
  "pmPercentHintNone",
  "pmPercentPlaceholderClub",
  "pmPercentPlaceholderNone",
];

// Locale order in KEYS values: [en, ur, hi, bn]
const LOCALES = ["en", "ur", "hi", "bn"];
const summary = {};

for (let li = 0; li < LOCALES.length; li++) {
  const locale = LOCALES[li];
  const file = join(root, "messages", `${locale}.json`);
  const raw = readFileSync(file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);

  // ---- insertions -------------------------------------------------------
  // Grouped by parent so a brand-new object ("review") is written once, with all
  // its keys, instead of chasing an insertion point that moves each time.
  const byParent = new Map();
  for (const [key, values] of Object.entries(KEYS)) {
    const parent = key.split(".").slice(0, -1).join(".");
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push([key.split(".").pop(), values]);
  }

  // Existence is answered by the PARSED file, never by a text search: generic
  // leaf names ("title", "member", "capital") occur all over these dictionaries,
  // and a substring test would report them as already present and silently skip
  // the very keys this feature needs. The text is only used for placement.
  const parsed = JSON.parse(raw);
  const at = (path) =>
    path.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), parsed);
  const added = [];

  const anchorIndex = (anchorKey) => {
    const idx = lines.findIndex((l) => l.includes(`"${anchorKey}":`));
    if (idx === -1) throw new Error(`Anchor "${anchorKey}" not found in ${locale}.json`);
    return idx;
  };

  for (const [parent, entries] of byParent) {
    const missing = entries.filter(([leaf]) => typeof at(`${parent}.${leaf}`) !== "string");
    if (missing.length === 0) continue;

    // Locate the object these keys belong to. It either has its own anchor, or
    // (for a brand-new group like `projects.review`) it is created next to its
    // parent's anchor line.
    const parentLeaf = parent.split(".").pop();
    const grand = parent.split(".").slice(0, -1).join(".");
    let anchorIdx;
    let createWrapper = false;
    if (ANCHORS[parent]) {
      anchorIdx = anchorIndex(ANCHORS[parent]);
    } else {
      if (!ANCHORS[grand]) throw new Error(`No anchor for '${parent}'`);
      if (at(parent) && typeof at(parent) === "object") {
        anchorIdx = lines.findIndex((l) => l.trimStart().startsWith(`"${parentLeaf}": {`));
        if (anchorIdx === -1) throw new Error(`"${parentLeaf}" exists but not as an object`);
      } else {
        anchorIdx = anchorIndex(ANCHORS[grand]);
        createWrapper = true;
      }
    }

    const indent = lines[anchorIdx].match(/^\s*/)[0];
    const keyIndent = createWrapper ? `${indent}  ` : indent;
    const block = missing.map(
      ([leaf, values]) => `${keyIndent}"${leaf}": ${JSON.stringify(values[li])},`,
    );
    if (createWrapper) {
      block.unshift(`${indent}"${parentLeaf}": {`);
      block.push(`${indent}},`);
    }

    // The anchor gains a follower, so it must end with a comma unless it is an
    // opening brace — skipping this is how JSON quietly stops being JSON.
    const anchorTrimmed = lines[anchorIdx].trimEnd();
    if (!anchorTrimmed.endsWith("{") && !anchorTrimmed.endsWith(",")) {
      lines[anchorIdx] = anchorTrimmed + ",";
    }
    lines.splice(anchorIdx + 1, 0, ...block);
    added.push(...missing.map(([leaf]) => `${parent}.${leaf}`));
  }

  // ---- retirements ------------------------------------------------------
  const dropped = [];
  for (const leaf of RETIRED) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes(`"${leaf}":`)) continue;
      const hadComma = lines[i].trimEnd().endsWith(",");
      lines.splice(i, 1);
      if (!hadComma) {
        // It was the object's last member: the new last member must not keep a
        // trailing comma.
        for (let j = i - 1; j >= 0; j--) {
          const t = lines[j].trimEnd();
          if (t === "") continue;
          if (t.endsWith(",")) lines[j] = t.slice(0, -1);
          break;
        }
      }
      dropped.push(leaf);
      break;
    }
  }

  const out = lines.join(eol);
  JSON.parse(out); // never write a file that would break every locale
  writeFileSync(file, out, "utf8");
  summary[locale] = { added: Object.keys(KEYS).length, retired: [...new Set(dropped)] };
  console.log(
    `${locale}.json: ${Object.keys(KEYS).length} key slots processed, retired ${[...new Set(dropped)].join(", ") || "none"}`,
  );
}
