/* Countries Worklay can be used in, shared by the server and the front end.

   Places: geo/<CODE>.json lists a country's regions and geo/<CODE>/<region>.json its cities and areas
   (built by scripts/build-geo.py). Estonia is always on and keeps its own pages; the others are switched on
   with COUNTRIES_ENABLED, e.g. "IN,DE" or "all". Online payment works in Estonia only. */

// code: [name in the language itself, name in English]
export const LANG_NAMES = {
  en: ['English', 'English'], et: ['Eesti', 'Estonian'], ru: ['Русский', 'Russian'],
  de: ['Deutsch', 'German'], fr: ['Français', 'French'], es: ['Español', 'Spanish'], it: ['Italiano', 'Italian'], pt: ['Português', 'Portuguese'], nl: ['Nederlands', 'Dutch'],
  pl: ['Polski', 'Polish'], sv: ['Svenska', 'Swedish'], da: ['Dansk', 'Danish'], no: ['Norsk', 'Norwegian'], fi: ['Suomi', 'Finnish'], is: ['Íslenska', 'Icelandic'],
  lv: ['Latviešu', 'Latvian'], lt: ['Lietuvių', 'Lithuanian'], cs: ['Čeština', 'Czech'], sk: ['Slovenčina', 'Slovak'], hu: ['Magyar', 'Hungarian'], ro: ['Română', 'Romanian'],
  bg: ['Български', 'Bulgarian'], hr: ['Hrvatski', 'Croatian'], sl: ['Slovenščina', 'Slovenian'], sr: ['Српски', 'Serbian'], mk: ['Македонски', 'Macedonian'], sq: ['Shqip', 'Albanian'],
  el: ['Ελληνικά', 'Greek'], uk: ['Українська', 'Ukrainian'],
  hi: ['हिन्दी', 'Hindi'], bn: ['বাংলা', 'Bengali'], te: ['తెలుగు', 'Telugu'], mr: ['मराठी', 'Marathi'], ta: ['தமிழ்', 'Tamil'], gu: ['ગુજરાતી', 'Gujarati'], kn: ['ಕನ್ನಡ', 'Kannada'],
  ml: ['മലയാളം', 'Malayalam'], pa: ['ਪੰਜਾਬੀ', 'Punjabi'], or: ['ଓଡ଼ିଆ', 'Odia'], as: ['অসমীয়া', 'Assamese'], ur: ['اردو', 'Urdu'],
  tr: ['Türkçe', 'Turkish'], ar: ['العربية', 'Arabic'], he: ['עברית', 'Hebrew'], fa: ['دری / فارسی', 'Dari / Persian'], id: ['Bahasa Indonesia', 'Indonesian'], ms: ['Bahasa Melayu', 'Malay'], vi: ['Tiếng Việt', 'Vietnamese'],
  th: ['ไทย', 'Thai'], ja: ['日本語', 'Japanese'], ko: ['한국어', 'Korean'], zh: ['繁體中文', 'Chinese (Traditional)'], fil: ['Filipino', 'Filipino'], uz: ['O‘zbekcha', 'Uzbek'], kk: ['Қазақша', 'Kazakh'],
  az: ['Azərbaycanca', 'Azerbaijani'], ka: ['ქართული', 'Georgian'], hy: ['Հայերեն', 'Armenian'], ne: ['नेपाली', 'Nepali'], si: ['සිංහල', 'Sinhala'], mn: ['Монгол', 'Mongolian'], ky: ['Кыргызча', 'Kyrgyz'],
  tg: ['Тоҷикӣ', 'Tajik'], my: ['မြန်မာ', 'Burmese'], km: ['ខ្មែរ', 'Khmer'], lo: ['ລາວ', 'Lao'],
};
export const RTL = ['ur', 'ar', 'he', 'fa'];

// code | slug | name | own name | currency | languages (first = suggested) | word for a region in English
const ROWS = `
EE|estonia|Estonia|Eesti|EUR|en et ru|county|Europe
AL|albania|Albania|Shqipëria|ALL|sq en|county|Europe
AD|andorra|Andorra|Andorra|EUR|es fr pt en|parish|Europe
AT|austria|Austria|Österreich|EUR|de en|state|Europe
BE|belgium|Belgium|België / Belgique|EUR|nl fr de en|region|Europe
BA|bosnia-and-herzegovina|Bosnia and Herzegovina|Bosna i Hercegovina|BAM|hr sr en|region|Europe
BG|bulgaria|Bulgaria|България|EUR|bg en|province|Europe
HR|croatia|Croatia|Hrvatska|EUR|hr en|county|Europe
CY|cyprus|Cyprus|Κύπρος|EUR|el en|district|Europe
CZ|czechia|Czechia|Česko|CZK|cs en|region|Europe
DK|denmark|Denmark|Danmark|DKK|da en|region|Europe
FI|finland|Finland|Suomi|EUR|fi sv en|region|Europe
FR|france|France|France|EUR|fr en|region|Europe
DE|germany|Germany|Deutschland|EUR|de en|state|Europe
GR|greece|Greece|Ελλάδα|EUR|el en|region|Europe
HU|hungary|Hungary|Magyarország|HUF|hu en|county|Europe
IS|iceland|Iceland|Ísland|ISK|is en|region|Europe
IE|ireland|Ireland|Ireland|EUR|en|province|Europe
IT|italy|Italy|Italia|EUR|it en|region|Europe
XK|kosovo|Kosovo|Kosova|EUR|sq sr en|district|Europe
LV|latvia|Latvia|Latvija|EUR|lv ru en|municipality|Europe
LI|liechtenstein|Liechtenstein|Liechtenstein|CHF|de en|municipality|Europe
LT|lithuania|Lithuania|Lietuva|EUR|lt en ru|county|Europe
LU|luxembourg|Luxembourg|Luxembourg|EUR|fr de en|canton|Europe
MT|malta|Malta|Malta|EUR|en|locality|Europe
MD|moldova|Moldova|Moldova|MDL|ro ru en|district|Europe
MC|monaco|Monaco|Monaco|EUR|fr it en|region|Europe
ME|montenegro|Montenegro|Crna Gora|EUR|sr en|municipality|Europe
NL|netherlands|Netherlands|Nederland|EUR|nl en|province|Europe
MK|north-macedonia|North Macedonia|Северна Македонија|MKD|mk sq en|municipality|Europe
NO|norway|Norway|Norge|NOK|no en|county|Europe
PL|poland|Poland|Polska|PLN|pl en|voivodeship|Europe
PT|portugal|Portugal|Portugal|EUR|pt en|district|Europe
RO|romania|Romania|România|RON|ro hu en|county|Europe
SM|san-marino|San Marino|San Marino|EUR|it en|municipality|Europe
RS|serbia|Serbia|Србија|RSD|sr hu en|region|Europe
SK|slovakia|Slovakia|Slovensko|EUR|sk hu en|region|Europe
SI|slovenia|Slovenia|Slovenija|EUR|sl en|municipality|Europe
ES|spain|Spain|España|EUR|es en|region|Europe
SE|sweden|Sweden|Sverige|SEK|sv en fi|county|Europe
CH|switzerland|Switzerland|Schweiz / Suisse / Svizzera|CHF|de fr it en|canton|Europe
UA|ukraine|Ukraine|Україна|UAH|uk en ru|region|Europe
GB|united-kingdom|United Kingdom|United Kingdom|GBP|en|country|Europe
US|united-states|United States|United States|USD|en es|state|North America
CA|canada|Canada|Canada|CAD|en fr|province|North America
AU|australia|Australia|Australia|AUD|en|state|Oceania
IN|india|India|भारत|INR|en hi bn te mr ta gu kn ml pa or as ur|state|Asia
AF|afghanistan|Afghanistan|افغانستان|AFN|fa uz en|province|Asia
AM|armenia|Armenia|Հայաստան|AMD|hy ru en|province|Asia
AZ|azerbaijan|Azerbaijan|Azərbaycan|AZN|az ru en|district|Asia
BH|bahrain|Bahrain|البحرين|BHD|ar en|governorate|Asia
BD|bangladesh|Bangladesh|বাংলাদেশ|BDT|bn en|division|Asia
BT|bhutan|Bhutan|Bhutan|BTN|en ne|district|Asia
BN|brunei|Brunei|Brunei|BND|ms en|district|Asia
KH|cambodia|Cambodia|កម្ពុជា|KHR|km en|province|Asia
GE|georgia|Georgia|საქართველო|GEL|ka ru en|region|Asia
ID|indonesia|Indonesia|Indonesia|IDR|id en|province|Asia
IQ|iraq|Iraq|العراق|IQD|ar en|governorate|Asia
IL|israel|Israel|ישראל|ILS|he ar ru en|district|Asia
JP|japan|Japan|日本|JPY|ja en|prefecture|Asia
JO|jordan|Jordan|الأردن|JOD|ar en|governorate|Asia
KZ|kazakhstan|Kazakhstan|Қазақстан|KZT|kk ru en|region|Asia
KW|kuwait|Kuwait|الكويت|KWD|ar en|governorate|Asia
KG|kyrgyzstan|Kyrgyzstan|Кыргызстан|KGS|ky ru en|region|Asia
LA|laos|Laos|ລາວ|LAK|lo en|province|Asia
LB|lebanon|Lebanon|لبنان|LBP|ar fr en|governorate|Asia
MY|malaysia|Malaysia|Malaysia|MYR|ms en ta|state|Asia
MV|maldives|Maldives|Maldives|MVR|en|atoll|Asia
MN|mongolia|Mongolia|Монгол|MNT|mn en|province|Asia
MM|myanmar|Myanmar|မြန်မာ|MMK|my en|region|Asia
NP|nepal|Nepal|नेपाल|NPR|ne en|province|Asia
OM|oman|Oman|عُمان|OMR|ar en|governorate|Asia
PK|pakistan|Pakistan|پاکستان|PKR|ur en|province|Asia
PS|palestine|Palestine|فلسطين|ILS|ar en|region|Asia
PH|philippines|Philippines|Pilipinas|PHP|fil en|region|Asia
QA|qatar|Qatar|قطر|QAR|ar en|municipality|Asia
SA|saudi-arabia|Saudi Arabia|السعودية|SAR|ar en|region|Asia
SG|singapore|Singapore|Singapore|SGD|en ms ta|region|Asia
KR|south-korea|South Korea|대한민국|KRW|ko en|province|Asia
LK|sri-lanka|Sri Lanka|ශ්‍රී ලංකා|LKR|si ta en|province|Asia
SY|syria|Syria|سوريا|SYP|ar en|governorate|Asia
TW|taiwan|Taiwan|臺灣|TWD|zh en|region|Asia
TJ|tajikistan|Tajikistan|Тоҷикистон|TJS|tg ru en|region|Asia
TH|thailand|Thailand|ไทย|THB|th en|province|Asia
TL|timor-leste|Timor-Leste|Timor-Leste|USD|pt en id|municipality|Asia
TR|turkey|Türkiye|Türkiye|TRY|tr en|province|Asia
TM|turkmenistan|Turkmenistan|Türkmenistan|TMT|ru en|region|Asia
AE|united-arab-emirates|United Arab Emirates|الإمارات|AED|ar en|emirate|Asia
UZ|uzbekistan|Uzbekistan|O‘zbekiston|UZS|uz ru en|region|Asia
VN|vietnam|Vietnam|Việt Nam|VND|vi en|province|Asia
YE|yemen|Yemen|اليمن|YER|ar en|governorate|Asia`;

export const COUNTRIES = Object.fromEntries(ROWS.trim().split('\n').map(r => {
  const [code, slug, name, native, currency, langs, region, continent] = r.split('|');
  return [code, { code, slug, name, native, currency, langs: langs.split(' '), region, continent }];
}));
export const countryBySlug = slug => Object.values(COUNTRIES).find(c => c.slug === slug) || null;
// "IN,DE" or "all" → codes that may be switched on (Estonia is always on).
export function enabledCountries(setting) {
  const want = String(setting || '').toUpperCase().split(',').map(x => x.trim());
  return Object.keys(COUNTRIES).filter(c => c === 'EE' || want.includes('ALL') || want.includes(c));
}
// Languages offered in a region: its own first, then the rest of the country's.
export const langsFor = (country, region) => [...new Set([...((region && region.langs) || []), ...COUNTRIES[country].langs])];

const LOCALE = { en: { US: 'en-US', CA: 'en-CA', AU: 'en-AU', IN: 'en-IN', GB: 'en-GB', IE: 'en-IE' } };
export const localeFor = (lang, country) => (lang === 'en' && LOCALE.en[country]) || `${lang === 'no' ? 'nb' : lang}${country === 'XK' ? '' : '-' + country}-u-nu-latn`;
export function formatMoney(n, country, lang = 'en') {
  const v = Number(n) || 0;
  return new Intl.NumberFormat(localeFor(lang, country), { style: 'currency', currency: COUNTRIES[country].currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v); // whole amounts without decimals
}
export const currencySign = country => new Intl.NumberFormat('en', { style: 'currency', currency: COUNTRIES[country].currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(p => p.type === 'currency').value;

/* ---------- saving a place ----------
   City and area are suggestions: smaller places may be typed. Known places keep their usual spelling. */
const tidy = v => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
// Case and accents don't matter: “montreal” is “Montréal”.
export const foldName = s => String(s).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const known = (options, v) => (options.includes(v) ? v : options.find(o => foldName(o) === foldName(v)) || v);
const VALID = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,'’()/&-]*$/u;
// places: { city: [areas] } of that region, or null if there is no such region.
export function cleanPlace(places, { state, city, area }) {
  const s = places && { slug: String(state), cities: places };
  if (!s) return { state: '', city: '', area: '' };
  const c0 = tidy(city), c = c0.length >= 2 && VALID.test(c0) ? known(Object.keys(s.cities), c0) : '';
  const a0 = tidy(area), a = c && a0.length >= 2 && VALID.test(a0) ? known(s.cities[c] || [], a0) : '';
  return { state: s.slug, city: c, area: a };
}
