/* Worklay front end. Talks to the Node API under /api.
   `db` holds what the server says the current visitor may see; every change goes
   through the API and then reloads that data. */
import { privacyPage, cookiesPage } from './legal.js';
import { termsPage } from './terms-page.js';
import { blogHtml, localPost } from './blog-text.mjs';

(() => {
'use strict';

/* ---------- config (overwritten by the server's settings on load) ---------- */
const API_URL = window.WORKLAY_API || '/api';
const apiUrl = (route, params = '') => API_URL + (API_URL.includes('?') ? '&' : '?') + 'r=' + route + params;
let PLATFORM_FEE = 0.10;
let MIN_PAYOUT = 20;
const LANG_KEY = 'worklay-lang';

let CATEGORIES = [ // replaced by the server's list (wl_categories) on load
  { id: 'dev', name: 'Development & IT', ico: '💻', color: '#eef1ff' },
  { id: 'design', name: 'Design & Creative', ico: '🎨', color: '#fff0e7' },
  { id: 'writing', name: 'Writing & Translation', ico: '✍️', color: '#e3f8ee' },
  { id: 'marketing', name: 'Digital Marketing', ico: '📈', color: '#f0ebff' },
  { id: 'video', name: 'Video & Animation', ico: '🎬', color: '#ffe9ee' },
  { id: 'business', name: 'Business & Admin', ico: '💼', color: '#fff6d9' },
  { id: 'home', name: 'Home & Handyman', ico: '🛠️', color: '#e6f6ff' },
  { id: 'music', name: 'Music & Audio', ico: '🎧', color: '#eaf9f3' },
  { id: 'tutoring', name: 'Tutoring & Lessons', ico: '📚', color: '#fdf1e1' },
];
const NO_CATEGORY = { id: '', name: 'Other', nameEt: 'Muu', nameRu: 'Другое', ico: '🧩', color: '#eef1ff', serviceType: 'REMOTE', requiresVerification: false, requiredDocuments: [], perks: [], subcategories: [] };
const catById = id => CATEGORIES.find(c => c.id === id) || NO_CATEGORY;
// Category or subcategory name in the chosen language. Freelancers can create categories, so always esc() it in HTML.
const catName = c => (lang === 'et' ? c.nameEt : lang === 'ru' ? c.nameRu : '') || c.name;
const approvedCats = () => CATEGORIES.filter(c => c.status !== 'NEW');
// What the current user can pick: approved categories, their own new ones, and the one they're in.
const pickableCats = (current = '') => CATEGORIES.filter(c => c.status !== 'NEW' || c.id === current || (db && db.me && c.createdBy === db.me));
const specialisms = u => [...(catById(u.category).subcategories || []).filter(x => u.subcategories.includes(x.id)).map(catName), ...(u.customSubcategories || [])];
let CATEGORY_ICONS = ['🧩'], APPROVAL_DAYS = 7, TERMS_VERSION = '';

/* ---------- freelancer profile helpers: pricing, weekly hours, tutoring, documents ---------- */
const WEEKDAYS = [['MON', 'Mon'], ['TUE', 'Tue'], ['WED', 'Wed'], ['THU', 'Thu'], ['FRI', 'Fri'], ['SAT', 'Sat'], ['SUN', 'Sun']];
const TIMES = [['morning', 'Morning', '8–12', 480, 720], ['afternoon', 'Afternoon', '12–17', 720, 1020], ['evening', 'Evening', '17–21', 1020, 1260]];
const TUTOR_SUBJECTS = ['Mathematics', 'Estonian', 'English', 'Russian', 'German', 'Physics', 'Chemistry', 'Biology', 'Geography', 'History', 'Computer science', 'Music', 'Art', 'Exam preparation'];
const TUTOR_LEVELS = ['Grades 1–4', 'Grades 5–9', 'Grades 10–12', 'University', 'Adults'];
const PRICING = { HOURLY: ['Hourly', 'per hour'], FIXED_PACKAGE: ['Package / session', 'per session'], PER_EVENT: ['Per event', 'per event'] };
const SERVICE_TYPES = { REMOTE: '🌐 Remote', ON_SITE: '📍 On-site', HYBRID: '🔀 Online or on-site' };
const DOC_INFO = {
  GOVERNMENT_ID: ['Government ID', 'Passport or ID card. A clear photo of the side with your photo.'],
  DRIVERS_LICENSE: ['Driver’s licence', 'Both sides of a valid driving licence.'],
  BACKGROUND_CHECK: ['Background check', 'Optional: a criminal record extract (e.g. from eesti.ee), as a PDF or photo.'],
};
let SLOT_MINUTES = [30, 45, 60, 90, 120, 180, 240, 300, 360, 480];
const splitList = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
const chk = (name, value, label, on, extra = '') => `<label class="chk"><input type="checkbox" name="${name}" value="${esc(value)}" ${on ? 'checked' : ''}>${label}${extra}</label>`;
const areaChecks = (city, chosen = []) => (CITIES[city] || []).map(a => chk('areas', a, esc(a), chosen.includes(a))).join('') || '<span class="small muted">Choose your city first.</span>';
const minutesOf = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const durationText = m => m % 60 ? (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`) : `${m / 60} h`;
// "€25 per hour", "€300 per 4-hour shoot"
const priceText = u => (u.priceAmount > 0 ? `${money(u.priceAmount)} ${esc(u.priceUnitLabel || PRICING[u.pricingType]?.[1] || '')}` : '');
// "Mon–Fri 09:00–17:00 · Sat 10:00–14:00"
function weeklyText(w) {
  const days = WEEKDAYS.filter(([d]) => (w?.[d] || []).length);
  if (!days.length) return '';
  const groups = [];
  for (const [d, label] of days) {
    const key = w[d].map(x => `${x.start}–${x.end}`).join(', '), last = groups[groups.length - 1];
    const idx = WEEKDAYS.findIndex(([k]) => k === d);
    if (last && last.key === key && last.endIdx === idx - 1) { last.endIdx = idx; last.endLabel = label; }
    else groups.push({ key, startLabel: label, endLabel: label, endIdx: idx, startIdx: idx });
  }
  return groups.map(g => `${g.startLabel}${g.endIdx > g.startIdx ? (g.endIdx - g.startIdx > 1 ? '–' : ', ') + g.endLabel : ''} ${g.key}`).join(' · ');
}
// Does the freelancer work during this part of the day on any day?
const worksDuring = (u, key) => { const t = TIMES.find(([k]) => k === key); return !!t && Object.values(u.weeklyAvailability || {}).some(ws => ws.some(w => minutesOf(w.start) < t[4] && minutesOf(w.end) > t[3])); };
// Today and the time in Estonia (bookings use local Estonian time)
function localNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const addDays = (date, n) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekdayKey = date => WEEKDAYS[(new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7][0];
const fmtDate = (date, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(date + 'T12:00:00Z').toLocaleDateString(numberLocale(), { ...opts, timeZone: 'UTC' });
const bookingStarted = b => { const n = localNow(); return b.date < n.date || (b.date === n.date && minutesOf(b.start) <= n.minutes); };

const FEATURE_NAMES = ['Source File', 'Social Media Kit', 'High Resolution', 'Project Upload'];
let PAYOUT_METHODS = ['PayPal', 'Payoneer', 'Bank transfer'];
let GOOGLE_AUTH = false; // true when the server has Google sign-in configured
let PHOTO_UPLOADS = false, MAX_PHOTO_MB = 3; // profile photos (Cloudflare R2)
let CARD_PAYMENTS = false; // true when the server has Stripe configured: customers pay by card, freelancers are paid through Stripe

// Cities and their areas/districts. The live list comes from api/config.php.
let CITIES = {
  'Tallinn': ['Haabersti', 'Kesklinn', 'Kristiine', 'Lasnamäe', 'Mustamäe', 'Nõmme', 'Pirita', 'Põhja-Tallinn'],
  'Tartu': ['Annelinn', 'Karlova', 'Kesklinn', 'Maarjamõisa', 'Ropka', 'Supilinn', 'Tammelinn', 'Ülejõe'],
  'Pärnu': ['Kesklinn', 'Raeküla', 'Rannarajoon', 'Vana-Pärnu', 'Ülejõe'],
  'Narva': ['Kalevi', 'Kesklinn', 'Kreenholm', 'Pähklimäe', 'Soldino'],
  'Kohtla-Järve': ['Ahtme', 'Järve', 'Sompa'],
  'Viljandi': ['Kesklinn', 'Paalalinn', 'Peetrimõisa'],
};
const locStr = o => o && o.city ? (o.area ? `${o.area}, ${o.city}` : o.city) : '';
function locationFields(city = '', area = '', { required = false, any = false } = {}) {
  const req = required ? 'required' : '';
  const areas = CITIES[city] || [];
  return `<div class="row">
    <div class="field"><label>${t('loc.city')}</label><select name="city" data-role="city" ${req}><option value="">${any ? t('hero.allCities') : t('loc.selectCity')}</option>${Object.keys(CITIES).map(c => `<option ${c === city ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field"><label>${t('loc.area')}</label><select name="area" data-role="area" data-any="${any ? 1 : ''}" ${req} ${areas.length ? '' : 'disabled'}><option value="">${any ? t('loc.allAreas') : t('loc.selectArea')}</option>${areas.map(a => `<option ${a === area ? 'selected' : ''}>${a}</option>`).join('')}</select></div></div>`;
}
// Proximity: 2 = same area, 1 = same city, 0 = elsewhere
const proximity = (a, b) => !a || !b || !a.city || a.city !== b.city ? 0 : (a.area && (a.area === b.area || (b.serviceAreas || []).includes(a.area)) ? 2 : 1);
const proxTag = o => { const u = me(); if (!u || !u.city || u.id === o.id) return ''; const p = proximity(u, o); return p === 2 ? '<span class="tag green">📍 Your area</span>' : p === 1 ? '<span class="tag">📍 Your city</span>' : ''; };

/* ---------- i18n ---------- */
const LANGS = { en: 'English', et: 'Eesti', ru: 'Русский' };
const I18N = {
  en: {},
  et: {
    'nav.freelancers': 'Leia vabakutselisi', 'nav.projects': 'Projektid', 'nav.services': 'Teenused', 'nav.blog': 'Blogi', 'nav.about': 'Meist', 'nav.contact': 'Kontakt',
    'cta.post': 'Postita projekt', 'cta.signin': 'Logi sisse', 'cta.login': 'Logi sisse', 'cta.signup': 'Registreeru', 'cta.search': 'Otsi',
    'hero.title': 'Leia tööd. Saa asjad tehtud.', 'hero.lead': 'Worklay ühendab ülesannetega inimesed vabakutseliste ja professionaalidega, kes otsivad tööd.',
    'hero.ph': 'Mida sa vajad?', 'home.how': 'Kuidas see töötab', 'home.cats': 'Sirvi kategooriaid', 'home.popular': 'Populaarsed teenused', 'home.latest': 'Uusimad projektid',
    'footer.tag': 'Ühendame ülesanded inimestega, kes need ära teevad.', 'footer.platform': 'Platvorm', 'footer.company': 'Ettevõte',
    'common.viewall': 'Vaata kõiki', 'common.send': 'Saada', 'common.follow': 'Jälgi', 'common.following': 'Jälgid', 'common.message': 'Saada sõnum', 'common.order': 'Telli',
    'language.label': 'Keel', 'language.select': 'Vali keel', 'language.en': 'English', 'language.et': 'Eesti', 'language.ru': 'Vene',
    'hero.search': 'Otsi', 'hero.allCities': 'Kõik linnad', 'hero.searchIn': 'Otsi valdkonnas', 'hero.popular': 'Populaarne:', 'hero.hire': 'Palgata vabakutseline', 'hero.earn': 'Alusta teenimist →',
    'hero.local': 'Kohalikud spetsialistid {count} Eesti linnas', 'hero.near': 'Spetsialistid sinu lähedal', 'hero.searchArea': 'Otsi linna ja piirkonna järgi',
    'hero.verified': 'Kontrollitud vabakutselised', 'hero.idChecked': 'Meie meeskonna poolt kontrollitud', 'hero.proposals': 'Saa pakkumisi kiiresti', 'hero.postFree': 'Postita projekt tasuta',
    'trust.cities': '{cities} linna, {areas} piirkonda', 'trust.nearby': 'Leia abi lähedalt', 'trust.verified': 'Isikutuvastusega spetsialistid', 'trust.documents': 'Dokumendid on kontrollitud', 'trust.pay': 'Maksa pärast töö valmimist', 'trust.release': 'Raha vabastatakse pärast sinu kinnitust', 'trust.free': 'Liitumine on tasuta', 'trust.post': 'Postita projekt tasuta',
    'home.safe': 'Lihtne ja turvaline', 'home.customer': '🧑‍💼 Klientidele', 'home.freelancer': '🛠️ Vabakutselistele',
    'home.postFree': 'Postita töö tasuta', 'home.describe': 'Kirjelda tööd, eelarvet ja asukohta.', 'home.compare': 'Võrdle pakkumisi', 'home.compareDesc': 'Kohalikud spetsialistid saadavad pakkumisi. Vaata arvustusi ja märke ning vestle enne otsustamist.', 'home.payHappy': 'Maksa, kui oled rahul', 'home.payHappyDesc': 'Kinnita töö ja tasu kantakse vabakutselisele.', 'home.createProfile': 'Loo profiil', 'home.chooseLocation': 'Vali linn ja piirkond, et lähedal asuvad kliendid sind leiaksid.', 'home.offerPackages': 'Paku teenusepakette või saada pakkumisi', 'home.setPrices': 'Määra ise Basicu, Standardi ja Premiumi paketihinnad.', 'home.getPaid': 'Saa tasu', 'home.withdraw': 'Kui klient töö kinnitab, kantakse 90% tasust automaatselt sulle.',
    'home.categoriesDesc': 'Leia sobiv tegija kodutöödest veebidisainini.', 'home.available': 'saadaval', 'home.first': 'Ole esimene', 'home.nearbyHead': 'Vabakutselised sinu linnas', 'home.nearbyLocation': 'Vabakutselised sinu lähedal linnas', 'home.pickCity': 'Vali linn, et näha lähedal saadaolevaid tegijaid.', 'home.firstFreelancer': 'Ole üks esimestest vabakutselistest', 'home.joinFreelancer': 'Liitu vabakutselisena', 'home.setupFreelancer': 'Seadista vabakutselise profiil', 'home.profileNearby': 'Loo tasuta profiil, vali linn ja piirkond ning leia lähedal asuvaid kliente.', 'home.readyPackages': 'Valmispaketid selgete hindadega.', 'home.noServices': 'Teenuseid veel pole', 'home.servicesDesc': 'Vabakutselised saavad pakkuda Basicu, Standardi ja Premiumi pakette enda määratud hinnaga.', 'home.jobsDesc': 'Tööd inimestelt, kes vajavad abi.', 'home.needDone': 'Vajad abi?', 'home.postProjectFree': 'Postita projekt tasuta ja saa pakkumisi lähedal asuvatelt vabakutselistelt.', 'home.earnOwn': 'Teeni enda tingimustel', 'home.offerLocal': 'Paku teenuseid enda hinnaga ja leia kliente oma piirkonnast.', 'home.browseProjects': 'Sirvi projekte',
    'chip.cleaning': 'Koristus', 'chip.furniture': 'Mööbli kokkupanek', 'chip.logo': 'Logo kujundus', 'chip.web': 'Veebiarendus', 'chip.translation': 'Tõlge',
    'category.dev': 'Arendus ja IT', 'category.design': 'Disain ja loovtöö', 'category.writing': 'Kirjutamine ja tõlge', 'category.marketing': 'Digiturundus', 'category.video': 'Video ja animatsioon', 'category.business': 'Äri ja haldus', 'category.home': 'Kodu ja remont', 'category.music': 'Muusika ja heli', 'category.tutoring': 'Õpetamine ja eratunnid',
    'category.events': 'Üritused ja fotograafia', 'category.beauty': 'Ilu ja isikuhooldus', 'category.cleaning': 'Kodu ja koristus', 'category.childcare': 'Lapsehoid ja pere', 'category.driving': 'Sõidu- ja veoteenused',
    'footer.legal': 'Õiguslik', 'legal.terms': 'Kasutustingimused', 'legal.privacy': 'Privaatsuspoliitika', 'legal.cookies': 'Küpsiste poliitika', 'legal.cookieSettings': 'Küpsiste seaded',
    'cookie.title': 'Sinu privaatsus', 'cookie.text': 'Kasutame ainult küpsiseid, mis on vajalikud sisselogimiseks ja sinu valikute meelespidamiseks. Analüütika- ja reklaamiküpsiseid kasutame ainult sinu nõusolekul.',
    'cookie.accept': 'Nõustu kõigiga', 'cookie.reject': 'Keeldu valikulistest', 'cookie.customize': 'Kohanda', 'cookie.save': 'Salvesta valikud', 'cookie.saved': 'Küpsiste valikud salvestatud',
    'cookie.settingsIntro': 'Vali, milliseid küpsiseid lubad. Hädavajalikud küpsised on alati sees, sest sait ei tööta ilma nendeta.',
    'cookie.necessary': 'Hädavajalikud', 'cookie.necessaryDesc': 'Sisselogimine, keele-eelistus ja need küpsiste valikud.', 'cookie.alwaysOn': 'Alati sees',
    'cookie.analytics': 'Analüütika', 'cookie.analyticsDesc': 'Aitab meil mõista, kuidas saiti kasutatakse. Praegu ei kasuta me analüütikatööriistu, seega selle lubamine midagi ei muuda.',
  },
  ru: {
    'nav.freelancers': 'Найти фрилансеров', 'nav.projects': 'Проекты', 'nav.services': 'Услуги', 'nav.blog': 'Блог', 'nav.about': 'О нас', 'nav.contact': 'Контакты',
    'cta.post': 'Разместить проект', 'cta.signin': 'Войти', 'cta.login': 'Войти', 'cta.signup': 'Регистрация', 'cta.search': 'Найти',
    'hero.title': 'Найдите работу. Решите любую задачу.', 'hero.titleHtml': 'Найдите проверенных <span class="hl">местных специалистов</span> для любой задачи',
    'hero.lead': 'Worklay помогает людям, которым нужно что-то сделать, найти фрилансеров и специалистов, которые ищут работу.',
    'hero.ph': 'С чем вам нужна помощь?', 'home.how': 'Как это работает', 'home.cats': 'Категории', 'home.popular': 'Популярные услуги', 'home.latest': 'Новые проекты',
    'footer.tag': 'Связываем людей с задачами и специалистов, которые их выполнят.', 'footer.platform': 'Платформа', 'footer.company': 'Компания',
    'common.viewall': 'Смотреть все', 'common.send': 'Отправить', 'common.follow': 'Подписаться', 'common.following': 'Вы подписаны', 'common.message': 'Написать', 'common.order': 'Заказать',
    'language.label': 'Язык', 'language.select': 'Выберите язык', 'language.en': 'Английский', 'language.et': 'Эстонский', 'language.ru': 'Русский',
    'hero.search': 'Поиск', 'hero.allCities': 'Все города', 'hero.searchIn': 'Искать в разделе', 'hero.popular': 'Популярное:', 'hero.hire': 'Нанять фрилансера', 'hero.earn': 'Начать зарабатывать →',
    'hero.local': 'Местные специалисты в городах Эстонии ({count})', 'hero.near': 'Специалисты рядом с вами', 'hero.searchArea': 'Поиск по городу и району',
    'hero.verified': 'Проверенные фрилансеры', 'hero.idChecked': 'Личность проверена нашей командой', 'hero.proposals': 'Быстро получайте предложения', 'hero.postFree': 'Разместите проект бесплатно',
    'trust.cities': 'Городов: {cities}, районов: {areas}', 'trust.nearby': 'Помощь совсем рядом', 'trust.verified': 'Специалисты с проверенной личностью', 'trust.documents': 'Документы проверены нашей командой', 'trust.pay': 'Оплата после выполнения', 'trust.release': 'Деньги переводятся после вашего подтверждения', 'trust.free': 'Регистрация бесплатна', 'trust.post': 'Размещение проектов бесплатно',
    'home.safe': 'Просто и безопасно', 'home.customer': '🧑‍💼 Для заказчиков', 'home.freelancer': '🛠️ Для фрилансеров',
    'home.postFree': 'Разместите задание бесплатно', 'home.describe': 'Опишите, что нужно сделать, бюджет и место.', 'home.compare': 'Сравните предложения', 'home.compareDesc': 'Местные специалисты присылают предложения. Посмотрите их отзывы и значки и пообщайтесь в чате, прежде чем решить.', 'home.payHappy': 'Платите, когда довольны', 'home.payHappyDesc': 'Подтвердите работу, и оплата перейдёт фрилансеру.', 'home.createProfile': 'Создайте профиль', 'home.chooseLocation': 'Укажите город и район, чтобы заказчики поблизости находили вас первыми.', 'home.offerPackages': 'Предлагайте пакеты или отправляйте предложения', 'home.setPrices': 'Сами устанавливайте цены для пакетов Basic, Standard и Premium.', 'home.getPaid': 'Получайте оплату', 'home.withdraw': 'Когда клиент подтвердит работу, 90% оплаты автоматически переводится вам.',
    'home.categoriesDesc': 'От ремонта дома до веб-дизайна: найдите подходящего исполнителя.', 'home.available': 'доступно', 'home.first': 'Станьте первым', 'home.nearbyHead': 'Фрилансеры в вашем городе', 'home.nearbyLocation': 'Фрилансеры рядом с вами в городе', 'home.pickCity': 'Выберите город, чтобы увидеть, кто доступен поблизости.', 'home.firstFreelancer': 'Станьте одним из первых фрилансеров', 'home.joinFreelancer': 'Стать фрилансером', 'home.setupFreelancer': 'Настроить профиль фрилансера', 'home.profileNearby': 'Создайте бесплатный профиль, укажите город и район и получайте заказы от людей поблизости.', 'home.readyPackages': 'Готовые пакеты с понятными ценами.', 'home.noServices': 'Услуг пока нет', 'home.servicesDesc': 'Фрилансеры могут предлагать свои услуги в пакетах Basic, Standard и Premium по своей цене.', 'home.jobsDesc': 'Задания от людей, которым нужна помощь.', 'home.needDone': 'Нужно что-то сделать?', 'home.postProjectFree': 'Разместите проект бесплатно и получите предложения от фрилансеров поблизости.', 'home.earnOwn': 'Готовы зарабатывать на своих условиях?', 'home.offerLocal': 'Предлагайте услуги по своей цене, и заказчики из вашего района найдут вас.', 'home.browseProjects': 'Смотреть проекты',
    'chip.cleaning': 'Уборка', 'chip.furniture': 'Сборка мебели', 'chip.logo': 'Дизайн логотипа', 'chip.web': 'Веб-разработка', 'chip.translation': 'Перевод',
    'category.dev': 'Разработка и IT', 'category.design': 'Дизайн и креатив', 'category.writing': 'Тексты и переводы', 'category.marketing': 'Цифровой маркетинг', 'category.video': 'Видео и анимация', 'category.business': 'Бизнес и администрирование', 'category.home': 'Дом и ремонт', 'category.music': 'Музыка и звук', 'category.tutoring': 'Репетиторство и уроки',
    'category.events': 'Мероприятия и фотосъёмка', 'category.beauty': 'Красота и уход', 'category.cleaning': 'Уборка дома', 'category.childcare': 'Присмотр за детьми и семья', 'category.driving': 'Перевозки и транспорт',
    'footer.legal': 'Правовая информация', 'legal.terms': 'Условия использования', 'legal.privacy': 'Политика конфиденциальности', 'legal.cookies': 'Политика cookie', 'legal.cookieSettings': 'Настройки cookie',
    'cookie.title': 'Ваша конфиденциальность', 'cookie.text': 'Мы используем только cookie, необходимые для входа в систему и запоминания ваших настроек. Аналитические и рекламные cookie мы будем использовать только с вашего согласия.',
    'cookie.accept': 'Принять все', 'cookie.reject': 'Отклонить необязательные', 'cookie.customize': 'Настроить', 'cookie.save': 'Сохранить выбор', 'cookie.saved': 'Настройки cookie сохранены',
    'cookie.settingsIntro': 'Выберите, какие cookie вы разрешаете. Строго необходимые cookie включены всегда, потому что без них сайт не работает.',
    'cookie.necessary': 'Строго необходимые', 'cookie.necessaryDesc': 'Вход в систему, выбор языка и эти настройки cookie.', 'cookie.alwaysOn': 'Всегда включены',
    'cookie.analytics': 'Аналитика', 'cookie.analyticsDesc': 'Помогает нам понять, как используется сайт. Мы пока не используем инструменты аналитики, поэтому сейчас включение этой опции ничего не меняет.',
    'auth.welcomeBack': 'С возвращением', 'auth.loginSub': 'Войдите в свой аккаунт', 'auth.join': 'Присоединяйтесь к Worklay', 'auth.joinSub': 'Создайте бесплатный аккаунт',
    'auth.googleContinue': 'Продолжить с Google', 'auth.googleSignup': 'Зарегистрироваться через Google', 'auth.googleTerms': 'Продолжая с Google, вы принимаете {terms} и подтверждаете ознакомление с {privacy}.', 'auth.privacyLink': 'Политикой конфиденциальности', 'auth.or': 'или',
    'auth.email': 'Электронная почта', 'auth.password': 'Пароль', 'auth.noAccount': 'Нет аккаунта?', 'auth.haveAccount': 'Уже есть аккаунт?', 'auth.show': 'Показать', 'auth.hide': 'Скрыть',
    'auth.iWant': 'Я хочу', 'auth.hire': 'Нанимать фрилансеров', 'auth.work': 'Работать фрилансером', 'auth.fullName': 'Имя и фамилия', 'auth.mainCategory': 'Основная категория услуг', 'auth.whatDo': 'Чем вы занимаетесь?', 'auth.whatDoPh': 'например, фотограф, няня',
    'auth.nextSteps': 'Далее вы укажете цены, часы работы и, для некоторых услуг, загрузите удостоверение личности для проверки.', 'auth.pwPh': 'Не менее 8 символов', 'auth.terms': 'Я принимаю {terms} и подтверждаю ознакомление с {privacy}', 'auth.create': 'Создать аккаунт',
    'auth.welcomeBackName': 'С возвращением, {name}!', 'auth.createdWork': 'Аккаунт создан! Теперь настройте профиль услуг.', 'auth.createdHire': 'Аккаунт создан! Разместите свой первый проект.', 'auth.createdGoogle': 'Аккаунт создан через Google! Укажите город и район, чтобы люди поблизости могли вас найти.',
    'auth.googleDisabled': 'Вход через Google сейчас недоступен.', 'auth.googleState': 'Время входа через Google истекло. Попробуйте ещё раз.', 'auth.googleCancelled': 'Вход через Google отменён.', 'auth.googleUnverified': 'Ваш адрес электронной почты в Google не подтверждён, поэтому мы не можем использовать его для входа.', 'auth.googleFailed': 'Не удалось войти через Google. Попробуйте ещё раз.',
    'loc.city': 'Город', 'loc.area': 'Район', 'loc.selectCity': 'Выберите город', 'loc.selectArea': 'Выберите район', 'loc.allAreas': 'Все районы',
  },
};
const EN = {
  'nav.freelancers': 'Find freelancers', 'nav.projects': 'Projects', 'nav.services': 'Services', 'nav.blog': 'Blog', 'nav.about': 'About', 'nav.contact': 'Contact',
  'cta.post': 'Post a project', 'cta.signin': 'Sign in', 'cta.login': 'Log in', 'cta.signup': 'Sign up', 'cta.search': 'Search',
  'hero.title': 'Find work. Get work done.', 'hero.lead': 'Worklay connects people who need tasks done with freelancers and professionals looking for work.',
  'hero.ph': 'What do you need help with?', 'home.how': 'How it works', 'home.cats': 'Browse categories', 'home.popular': 'Popular services', 'home.latest': 'Latest projects',
  'footer.tag': 'Connecting people with tasks to the professionals who get them done.', 'footer.platform': 'Platform', 'footer.company': 'Company',
  'common.viewall': 'View all', 'common.send': 'Send', 'common.follow': 'Follow', 'common.following': 'Following', 'common.message': 'Message', 'common.order': 'Order',
  'language.label': 'Language', 'language.select': 'Select language', 'language.en': 'English', 'language.et': 'Estonian', 'language.ru': 'Russian',
  'hero.search': 'Search', 'hero.allCities': 'All cities', 'hero.searchIn': 'Search in', 'hero.popular': 'Popular:', 'hero.hire': 'Hire a freelancer', 'hero.earn': 'Start earning →',
  'hero.local': 'Local professionals in {count} Estonian cities', 'hero.near': 'Professionals near you', 'hero.searchArea': 'Search by city and area',
  'hero.verified': 'Verified freelancers', 'hero.idChecked': 'ID checked by our team', 'hero.proposals': 'Get proposals fast', 'hero.postFree': 'Post a project for free',
  'trust.cities': '{cities} cities, {areas} areas', 'trust.nearby': 'Find help right around the corner', 'trust.verified': 'ID-verified professionals', 'trust.documents': 'Documents checked by our team', 'trust.pay': "Pay when it's done", 'trust.release': 'Released after you approve the work', 'trust.free': 'Free to join', 'trust.post': 'Post projects at no cost',
  'home.safe': 'Simple & safe', 'home.customer': '🧑‍💼 For customers', 'home.freelancer': '🛠️ For freelancers',
  'home.postFree': 'Post your job for free', 'home.describe': 'Describe what you need, your budget and where it is.', 'home.compare': 'Compare proposals', 'home.compareDesc': 'Local professionals send offers. Check their reviews and badges, and chat before you decide.', 'home.payHappy': "Pay when you're happy", 'home.payHappyDesc': 'Approve the work and payment is released to the freelancer.', 'home.createProfile': 'Create your profile', 'home.chooseLocation': 'Choose your city and area so nearby customers find you first.', 'home.offerPackages': 'Offer packages or send proposals', 'home.setPrices': 'Set your own prices in Basic, Standard and Premium tiers.', 'home.getPaid': 'Get paid', 'home.withdraw': 'When the client approves the work, 90% of the price is sent to you automatically.',
  'home.categoriesDesc': 'From home repairs to web design: find the right person for the job.', 'home.available': 'available', 'home.first': 'Be the first', 'home.nearbyHead': 'Find freelancers in your city', 'home.nearbyLocation': 'Freelancers near you in', 'home.pickCity': "Pick a city to see who's available nearby.", 'home.firstFreelancer': 'Be one of the first freelancers', 'home.joinFreelancer': 'Join as a freelancer', 'home.setupFreelancer': 'Set up my freelancer profile', 'home.profileNearby': 'Create a free profile, choose your city and area, and start getting jobs from people nearby.', 'home.readyPackages': 'Ready-made packages with clear prices.', 'home.noServices': 'No services yet', 'home.servicesDesc': 'Freelancers can offer their work in Basic, Standard and Premium packages at their own price.', 'home.jobsDesc': 'Jobs posted by people who need a hand.', 'home.needDone': 'Need something done?', 'home.postProjectFree': 'Post your project for free and get proposals from freelancers near you.', 'home.earnOwn': 'Ready to earn on your own terms?', 'home.offerLocal': 'Offer your services at your own price and get found by customers in your area.', 'home.browseProjects': 'Browse projects',
  'chip.cleaning': 'Cleaning', 'chip.furniture': 'Furniture assembly', 'chip.logo': 'Logo design', 'chip.web': 'Web development', 'chip.translation': 'Translation',
  'category.dev': 'Development & IT', 'category.design': 'Design & Creative', 'category.writing': 'Writing & Translation', 'category.marketing': 'Digital Marketing', 'category.video': 'Video & Animation', 'category.business': 'Business & Admin', 'category.home': 'Home & Handyman', 'category.music': 'Music & Audio', 'category.tutoring': 'Tutoring & Lessons',
  'category.events': 'Events & Photography', 'category.beauty': 'Beauty & Personal Care', 'category.cleaning': 'Home & Cleaning', 'category.childcare': 'Childcare & Family', 'category.driving': 'Driving & Transport',
  'hero.titleHtml': 'Find trusted <span class="hl">local professionals</span> for any job',
  'footer.legal': 'Legal', 'legal.terms': 'Terms of Service', 'legal.privacy': 'Privacy Policy', 'legal.cookies': 'Cookie Policy', 'legal.cookieSettings': 'Cookie settings',
  'cookie.title': 'Your privacy', 'cookie.text': 'We only use cookies that are needed to log you in and remember your choices. We will only use analytics or advertising cookies if you agree.',
  'cookie.accept': 'Accept all', 'cookie.reject': 'Reject optional', 'cookie.customize': 'Customize', 'cookie.save': 'Save choices', 'cookie.saved': 'Cookie choices saved',
  'cookie.settingsIntro': 'Choose which cookies you allow. Strictly necessary cookies are always on because the site cannot work without them.',
  'cookie.necessary': 'Strictly necessary', 'cookie.necessaryDesc': 'Login, language preference and these cookie choices.', 'cookie.alwaysOn': 'Always on',
  'cookie.analytics': 'Analytics', 'cookie.analyticsDesc': 'Helps us understand how the site is used. We don’t use any analytics tools yet, so turning this on changes nothing for now.',
  'auth.welcomeBack': 'Welcome back', 'auth.loginSub': 'Log in to your account', 'auth.join': 'Join Worklay', 'auth.joinSub': 'Create your free account',
  'auth.googleContinue': 'Continue with Google', 'auth.googleSignup': 'Sign up with Google', 'auth.googleTerms': 'By continuing with Google you agree to the {terms} and have read the {privacy}.', 'auth.privacyLink': 'Privacy Policy', 'auth.or': 'or',
  'auth.email': 'Email', 'auth.password': 'Password', 'auth.noAccount': 'Don’t have an account?', 'auth.haveAccount': 'Already have an account?', 'auth.show': 'Show', 'auth.hide': 'Hide',
  'auth.iWant': 'I want to', 'auth.hire': 'Hire freelancers', 'auth.work': 'Work as a freelancer', 'auth.fullName': 'Full name', 'auth.mainCategory': 'Main service category', 'auth.whatDo': 'What do you do?', 'auth.whatDoPh': 'e.g. Photographer, Babysitter',
  'auth.nextSteps': 'Next you’ll set your prices, the hours you work and, for some services, upload an ID for verification.', 'auth.pwPh': 'At least 8 characters', 'auth.terms': 'I agree to the {terms} and have read the {privacy}', 'auth.create': 'Create account',
  'auth.welcomeBackName': 'Welcome back, {name}!', 'auth.createdWork': 'Account created! Now set up your service profile.', 'auth.createdHire': 'Account created! Post your first project.', 'auth.createdGoogle': 'Account created with Google! Add your city and area so people nearby can find you.',
  'auth.googleDisabled': 'Sign-in with Google is not available right now.', 'auth.googleState': 'Your Google sign-in expired. Please try again.', 'auth.googleCancelled': 'Google sign-in was cancelled.', 'auth.googleUnverified': 'Your Google email address is not verified, so we can’t use it to sign you in.', 'auth.googleFailed': 'Google sign-in failed. Please try again.',
  'loc.city': 'City', 'loc.area': 'Area', 'loc.selectCity': 'Select city', 'loc.selectArea': 'Select area', 'loc.allAreas': 'All areas',
};
let lang = 'en';
const t = k => (I18N[lang] && I18N[lang][k]) || EN[k] || k;
const numberLocale = () => ({ et: 'et-EE', ru: 'ru-RU' })[lang] || 'en';

function detectLang() {
  try { const saved = localStorage.getItem(LANG_KEY); if (saved && LANGS[saved]) return [saved, 'saved']; } catch (e) {}
  for (const l of (navigator.languages || [navigator.language || 'en'])) {
    const code = l.slice(0, 2).toLowerCase();
    if (LANGS[code]) return [code, 'browser'];
  }
  return ['en', 'default'];
}

function flagSvg(code) {
  if (code === 'ru') return '<svg class="language-flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="10" fill="#fff"/><rect y="10" width="60" height="10" fill="#0039A6"/><rect y="20" width="60" height="10" fill="#D52B1E"/></svg>';
  if (code === 'et') return '<svg class="language-flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="10" fill="#4891D9"/><rect y="10" width="60" height="10" fill="#111"/><rect y="20" width="60" height="10" fill="#fff"/></svg>';
  return '<svg class="language-flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#012169"/><path d="M0 0 60 30M60 0 0 30" stroke="#fff" stroke-width="6"/><path d="M0 0 60 30M60 0 0 30" stroke="#C8102E" stroke-width="2.5"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="5"/></svg>';
}

function languagePicker() {
  return `<div class="language-picker" id="language-picker">
    <button class="language-toggle" type="button" data-action="toggle-language" aria-label="${t('language.select')}" aria-haspopup="true" aria-expanded="false">
      ${flagSvg(lang)}<span>${lang.toUpperCase()}</span><span class="language-chevron" aria-hidden="true">⌄</span>
    </button>
    <div class="language-menu" role="group" aria-label="${t('language.select')}">
      ${Object.entries(LANGS).map(([code, name]) => `<button class="language-option ${code === lang ? 'active' : ''}" type="button" data-action="set-language" data-lang="${code}" aria-pressed="${code === lang}">
        ${flagSvg(code)}<span>${t(`language.${code}`) || name}</span>${code === lang ? '<span class="language-check" aria-hidden="true">✓</span>' : ''}
      </button>`).join('')}
    </div>
  </div>`;
}

/* ---------- cookie consent ----------
   Strictly necessary storage (login cookie, language, this consent record) is always allowed.
   Optional categories are off until the visitor opts in. To add e.g. analytics, either listen
   for the `worklay:consent` event, or put the tag in index.html as
     <script type="text/plain" data-consent="analytics" data-src="https://…"></script>
   and it will only be activated after consent. List any new cookies in legal.js. */
const CONSENT_KEY = 'worklay-consent';
const CONSENT_VERSION = 1;               // bump when categories change to ask everyone again
const CONSENT_MAX_AGE = 182 * 864e5;     // re-ask after ~6 months
const OPTIONAL_CATEGORIES = ['analytics'];

function readConsent() {
  try {
    const c = JSON.parse(localStorage.getItem(CONSENT_KEY));
    if (c && c.v === CONSENT_VERSION && Date.now() - new Date(c.date) < CONSENT_MAX_AGE) return c;
  } catch (e) {}
  return null;
}
function activateConsentedScripts(c) {
  document.querySelectorAll('script[type="text/plain"][data-consent]').forEach(s => {
    if (!c[s.dataset.consent]) return;
    const n = document.createElement('script');
    for (const a of s.attributes) {
      if (a.name === 'type' || a.name === 'data-consent') continue;
      n.setAttribute(a.name === 'data-src' ? 'src' : a.name, a.value);
    }
    n.text = s.text;
    s.replaceWith(n);
  });
}
function clearOptionalCookies() {
  // worklay_auth is HttpOnly and invisible here, so this only removes cookies set by optional scripts.
  const host = location.hostname, domains = ['', host, '.' + host, '.' + host.split('.').slice(-2).join('.')];
  document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean).forEach(name => {
    domains.forEach(d => { document.cookie = `${name}=; Max-Age=0; Path=/${d ? '; Domain=' + d : ''}`; });
  });
}
function saveConsent(choices) {
  const prev = readConsent();
  const c = { v: CONSENT_VERSION, date: new Date().toISOString(), necessary: true };
  OPTIONAL_CATEGORIES.forEach(k => { c[k] = !!choices[k]; });
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(c)); } catch (e) {}
  renderCookieBanner();
  closeModal();
  // Scripts that already ran can't be unloaded, so withdrawing consent clears their cookies and reloads.
  if (prev && OPTIONAL_CATEGORIES.some(k => prev[k] && !c[k])) { clearOptionalCookies(); location.reload(); return; }
  activateConsentedScripts(c);
  window.dispatchEvent(new CustomEvent('worklay:consent', { detail: { ...c } }));
  toast(t('cookie.saved'));
}
function renderCookieBanner() {
  let el = document.getElementById('cookie-banner');
  if (readConsent()) { el && el.remove(); return; }
  if (!el) { el = document.createElement('section'); el.id = 'cookie-banner'; el.className = 'cookie-banner'; document.body.appendChild(el); }
  el.setAttribute('aria-label', t('cookie.title'));
  el.innerHTML = `<div class="cookie-text"><h2>🍪 ${t('cookie.title')}</h2><p>${t('cookie.text')} <a href="#/cookies">${t('legal.cookies')}</a> · <a href="#/privacy">${t('legal.privacy')}</a></p></div>
    <div class="cookie-actions">
      <button class="btn btn-outline btn-sm" type="button" data-action="cookie-settings">${t('cookie.customize')}</button>
      <button class="btn btn-primary btn-sm" type="button" data-action="cookie-reject">${t('cookie.reject')}</button>
      <button class="btn btn-primary btn-sm" type="button" data-action="cookie-accept">${t('cookie.accept')}</button>
    </div>`;
}
function openCookieSettings() {
  const c = readConsent() || {};
  modal(`<h2>${t('legal.cookieSettings')}</h2><p class="muted">${t('cookie.settingsIntro')}</p>
    <form id="cookie-form">
      <div class="cookie-cat"><div><b>${t('cookie.necessary')}</b> <span class="tag green">${t('cookie.alwaysOn')}</span><p class="small muted">${t('cookie.necessaryDesc')}</p></div>
        <input class="switch" type="checkbox" checked disabled aria-label="${t('cookie.necessary')}"></div>
      ${OPTIONAL_CATEGORIES.map(k => `<div class="cookie-cat"><label for="ck-${k}"><b>${t('cookie.' + k)}</b><p class="small muted">${t('cookie.' + k + 'Desc')}</p></label>
        <input class="switch" type="checkbox" id="ck-${k}" name="${k}" ${c[k] ? 'checked' : ''}></div>`).join('')}
      <p class="small"><a href="#/cookies" data-action="close-modal">${t('legal.cookies')}</a> · <a href="#/privacy" data-action="close-modal">${t('legal.privacy')}</a></p>
      <div class="cookie-modal-actions">
        <button class="btn btn-outline btn-sm" type="submit">${t('cookie.save')}</button>
        <button class="btn btn-primary btn-sm" type="button" data-action="cookie-reject">${t('cookie.reject')}</button>
        <button class="btn btn-primary btn-sm" type="button" data-action="cookie-accept">${t('cookie.accept')}</button>
      </div>
    </form>`);
}
window.worklayConsent = { get: readConsent, open: () => openCookieSettings() };

/* ---------- utils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + Math.random().toString(36).slice(2, 9);
const money = n => '€' + Number(n).toLocaleString(numberLocale(), { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const now = () => new Date().toISOString();
const daysAgo = d => new Date(Date.now() - d * 864e5).toISOString();
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString(numberLocale(), { month: 'short', year: 'numeric' });
}
const monthYear = iso => new Date(iso).toLocaleDateString(numberLocale(), { month: 'short', year: 'numeric' });
const initials = n => n.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

/* ---------- API ---------- */
let db = null;
async function api(route, data) {
  const isForm = data instanceof FormData;
  const opts = { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { 'X-Worklay': '1' } };
  if (data !== undefined) { opts.body = isForm ? data : JSON.stringify(data); if (!isForm) opts.headers['Content-Type'] = 'application/json'; }
  let res, json;
  try { res = await fetch(apiUrl(route), opts); } catch (e) { throw new Error('Cannot reach the server. Check your internet connection.'); }
  try { json = await res.json(); } catch (e) { throw new Error('The server returned an unexpected response.'); }
  if (!res.ok) throw Object.assign(new Error(json.error || 'Something went wrong.'), { code: json.code });
  return json;
}
async function refresh() {
  db = await api('bootstrap');
  if (db.config) { CITIES = db.config.cities; PLATFORM_FEE = db.config.fee; MIN_PAYOUT = db.config.minPayout; PAYOUT_METHODS = db.config.payoutMethods; GOOGLE_AUTH = !!db.config.googleAuth; CARD_PAYMENTS = !!db.config.cardPayments;
    if (db.config.categories) CATEGORIES = db.config.categories.map(c => ({ ...c, ico: c.icon }));
    if (db.config.slotMinutes) SLOT_MINUTES = db.config.slotMinutes; CATEGORY_ICONS = db.config.categoryIcons || CATEGORY_ICONS; TERMS_VERSION = db.config.termsVersion || ''; APPROVAL_DAYS = db.config.approvalDays || APPROVAL_DAYS; PHOTO_UPLOADS = !!db.config.photoUploads; MAX_PHOTO_MB = db.config.maxPhotoMb || 3; }
}
// Run an API call, reload data, re-render. Shows server errors as a toast (or in errEl).
let busy = false;
let lastBtn = null; // the button the user just pressed — shows a spinner while saving
async function act(route, data, okMsg, { errEl, after } = {}) {
  if (busy) return null;
  busy = true;
  const btn = lastBtn; lastBtn = null;
  if (btn) btn.classList.add('loading');
  if (errEl) errEl.textContent = '';
  try {
    const r = await api(route, data);
    await refresh();
    if (after) after(r); else render();
    if (okMsg) toast(okMsg, 'success');
    return r;
  } catch (e) {
    if (e.code === 'TERMS') openTerms();
    else if (errEl) errEl.textContent = e.message; else toast(esc(e.message), 'error');
    return null;
  } finally { busy = false; if (btn) btn.classList.remove('loading'); }
}
const me = () => db.users.find(u => u.id === db.me) || null; // the server sends the logged-in user id as `me`
const user = id => db.users.find(u => u.id === id);
const service = id => db.services.find(s => s.id === id);
const project = id => db.projects.find(p => p.id === id);

function userStats(id) {
  const rv = db.reviews.filter(r => r.targetUser === id);
  const rating = rv.length ? rv.reduce((a, r) => a + r.rating, 0) / rv.length : 0;
  const s = (user(id) || {}).stats || { inQueue: 0, doneProjects: 0, doneServices: 0 };
  return { reviews: rv.length, rating, inQueue: s.inQueue, doneProjects: s.doneProjects, doneServices: s.doneServices };
}
const serviceRating = sid => {
  const rv = db.reviews.filter(r => r.serviceId === sid);
  return { n: rv.length, avg: rv.length ? rv.reduce((a, r) => a + r.rating, 0) / rv.length : 0 };
};
const inWishlist = (kind, id) => me() && db.wishlist.some(w => w.userId === me().id && w.kind === kind && w.id === id);
const isFollowing = id => me() && db.follows.some(f => f.follower === me().id && f.followee === id);

/* ---------- UI helpers ---------- */
function toast(html, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.innerHTML = `<div>${html}</div>`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 4200);
}
function avatar(u, size = '') {
  if (u.avatarUrl) return `<img class="avatar ${size}" src="${esc(u.avatarUrl)}" alt="${esc(u.name)}" loading="lazy" decoding="async">`;
  return `<span class="avatar ${size}" style="background:${u.color}22;color:${u.color}">${esc(initials(u.name))}</span>`;
}
function stars(avg, n) { return n ? `<span class="stars">★ ${avg.toFixed(1)}</span> <span class="muted">(${n})</span>` : '<span class="muted">New</span>'; }
function badges(u) {
  const s = userStats(u.id), out = [];
  if (u.verification.status === 'verified') out.push(['#17B26A', '✓', 'Identity verified']);
  if (s.reviews && s.rating >= 4.5) out.push(['#ef4565', '★', 'Top rated (4.5+)']);
  if ((Date.now() - new Date(u.joined)) / 864e5 > 365) out.push(['#7cc242', '⌛', 'Member for over a year']);
  out.push(['#FF7A3D', s.doneProjects + s.doneServices, 'Completed jobs']);
  out.push(['#22243a', s.reviews, 'Reviews received']);
  return `<div class="badges">${out.map(([c, l, tip]) => `<span class="hexb" style="background:${c}" title="${esc(tip)}">${l}</span>`).join('')}</div>`;
}
function statPills(id) {
  const s = userStats(id);
  return `<div class="stat-pills"><span class="pill blue"><b>${s.inQueue}</b>In Queue Service</span><span class="pill teal"><b>${s.doneProjects}</b>Complete Project</span><span class="pill amber"><b>${s.doneServices}</b>Complete Service</span></div>`;
}
const statusTag = st => ({ open: '<span class="tag green">Open</span>', awarded: '<span class="tag orange">In progress</span>', completed: '<span class="tag gray">Completed</span>', pending: '<span class="tag">Pending</span>', accepted: '<span class="tag green">Accepted</span>', rejected: '<span class="tag gray">Not selected</span>', in_queue: '<span class="tag">In queue</span>', delivered: '<span class="tag orange">Delivered</span>', paid: '<span class="tag green">Paid</span>', awaiting_payment: '<span class="tag orange">Awaiting payment</span>', processing: '<span class="tag">Payment processing</span>', released: '<span class="tag orange">Waiting for payout setup</span>', transferring: '<span class="tag">Sending…</span>', transferred: '<span class="tag green">Sent to Stripe</span>', refunding: '<span class="tag">Refunding…</span>', refunded: '<span class="tag gray">Refunded</span>', cancelled: '<span class="tag gray">Cancelled</span>', AWAITING_PAYMENT: '<span class="tag orange">Awaiting payment</span>', PENDING: '<span class="tag">Waiting for confirmation</span>', CONFIRMED: '<span class="tag green">Confirmed</span>', COMPLETED: '<span class="tag gray">Completed</span>', CANCELLED: '<span class="tag gray">Cancelled</span>', APPROVED: '<span class="tag green">Approved</span>', REJECTED: '<span class="tag orange">Rejected</span>' }[st] || esc(st));

function serviceCard(s) {
  const u = user(s.sellerId), r = serviceRating(s.id);
  return `<div class="card svc-card">
    <button class="heart ${inWishlist('service', s.id) ? 'on' : ''}" data-action="wish" data-kind="service" data-id="${s.id}" aria-label="Save to wishlist">${inWishlist('service', s.id) ? '♥' : '♡'}</button>
    <a href="#/service/${s.id}" class="svc-cover" style="background:${s.color}">${s.emoji}</a>
    <div class="svc-body">
      <a class="seller-line" href="#/user/${u.id}">${avatar(u, 'sm')} ${esc(u.name)} ${u.verification.status === 'verified' ? '<span class="verified" title="Verified">✓</span>' : ''}</a>
      <a class="svc-title" href="#/service/${s.id}">${esc(s.title)}</a>
      <div class="small">${stars(r.avg, r.n)}${u.city ? ` · <span class="muted">📍 ${esc(locStr(u))}</span>` : ''}</div>
      ${proxTag(u) ? `<div>${proxTag(u)}</div>` : ''}
    </div>
    <div class="svc-foot"><span class="tag gray">${esc(catName(catById(s.category)))}</span><span>From <span class="price">${money(s.packages[0].price)}</span></span></div>
  </div>`;
}
function projectCard(p) {
  const owner = user(p.ownerId), n = p.proposalCount;
  return `<div class="card proj-card">
    <button class="heart ${inWishlist('project', p.id) ? 'on' : ''}" data-action="wish" data-kind="project" data-id="${p.id}" aria-label="Save to wishlist">${inWishlist('project', p.id) ? '♥' : '♡'}</button>
    <div style="display:flex;gap:8px">${statusTag(p.status)} <span class="tag gray">${esc(catName(catById(p.category)))}</span></div>
    <h3><a href="#/project/${p.id}">${esc(p.title)}</a></h3>
    <p class="muted small" style="margin:0">${esc(p.description.slice(0, 130))}${p.description.length > 130 ? '…' : ''}</p>
    <div class="proj-meta"><span>💶 <b>${money(p.budgetMin)}–${money(p.budgetMax)}</b></span><span>⏱ ${esc(p.deadline)}</span><span>📨 ${n} proposal${n === 1 ? '' : 's'}</span></div>
    <div class="proj-meta"><span>📍 ${esc(locStr(p) || '—')}</span>${p.remote ? '<span class="tag purple">🌐 Remote OK</span>' : '<span class="tag orange">On-site</span>'}${proxTag({ ...p, id: p.ownerId })}</div>
    <div class="seller-line">${avatar(owner, 'sm')} ${esc(owner.name)} · <span class="muted">${ago(p.created)}</span></div>
  </div>`;
}
const empty = (icon, text, cta = '') => `<div class="empty"><div class="big">${icon}</div><p>${text}</p>${cta}</div>`;
const requireLogin = () => { if (me()) return true; openLogin(); return false; };

/* ---------- modals ---------- */
let modalOpener = null;
function modal(html, onMount) {
  const root = $('#modal-root');
  if (!root.innerHTML) modalOpener = document.activeElement;
  root.innerHTML = `<div class="modal-bg" data-action="close-modal-bg"><div class="modal" role="dialog" aria-modal="true" tabindex="-1"><button class="close" data-action="close-modal" aria-label="Close">×</button>${html}</div></div>`;
  const box = root.querySelector('.modal'), title = box.querySelector('h1,h2,h3');
  if (title) { title.id = title.id || 'modal-title'; box.setAttribute('aria-labelledby', title.id); }
  onMount && onMount(box);
  const f = root.querySelector('input:not([type=hidden]),textarea,select'); (f || box).focus();
}
const closeModal = () => {
  const root = $('#modal-root'); if (!root.innerHTML) return;
  root.innerHTML = '';
  if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
  modalOpener = null;
};
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function openLogin() { openAuth('login'); }
const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
// Messages for ?auth_error=… / ?welcome=… set by the server after the Google redirect.
const GOOGLE_MESSAGES = {
  google_disabled: ['auth.googleDisabled', 'error'],
  google_state: ['auth.googleState', 'error'],
  google_cancelled: ['auth.googleCancelled', ''],
  google_unverified: ['auth.googleUnverified', 'error'],
  google_failed: ['auth.googleFailed', 'error'],
};
const PAYMENT_MESSAGES = {
  success: ['Payment received ✓ The money is held safely and released only after you approve the work.', 'success'],
  processing: ['Your payment is being processed. We’ll let you know when it’s confirmed.', ''],
  cancelled: ['Payment cancelled. You weren’t charged.', ''],
  refunded: ['This project was already awarded, so your payment was refunded.', 'error'],
  failed: ['We couldn’t confirm your payment. If you were charged, please contact support.', 'error'],
};
function handleGoogleReturn() {
  const { q } = parseHash();
  if (q.payment || q.stripe) {
    if (q.payment) { const [msg, kind] = PAYMENT_MESSAGES[q.payment] || PAYMENT_MESSAGES.failed; toast(msg, kind); }
    if (q.stripe === 'error') toast('Couldn’t open Stripe. Please try again.', 'error');
    if (q.stripe === 'return') api('payments/status', {}).then(r => refresh().then(() => { render(); toast(r.ready ? 'Payouts are set up ✓' : 'Stripe still needs a few details. You can continue setup any time.', r.ready ? 'success' : ''); })).catch(e => toast(esc(e.message), 'error'));
    const { name, args } = parseHash(), rest = { ...q }; delete rest.payment; delete rest.stripe;
    const qs = new URLSearchParams(rest).toString();
    history.replaceState(null, '', '/' + [name, ...args].join('/') + (qs ? '?' + qs : ''));
    return;
  }
  if (!q.auth_error && !q.welcome && !q.signed_in) return;
  if (q.auth_error) { const [msg, kind] = GOOGLE_MESSAGES[q.auth_error] || GOOGLE_MESSAGES.google_failed; toast(t(msg), kind); }
  else if (q.welcome === 'google') toast(t('auth.createdGoogle'), 'success');
  else if (q.signed_in === 'google' && me()) toast(t('auth.welcomeBackName').replace('{name}', esc(me().name.split(' ')[0])), 'success');
  const { name, args } = parseHash(), rest = { ...q }; delete rest.auth_error; delete rest.welcome; delete rest.signed_in;
  const qs = new URLSearchParams(rest).toString();
  history.replaceState(null, '', '/' + [name, ...args].join('/') + (qs ? '?' + qs : ''));
}
const pwField = (name, auto, extra = '') => `<div class="pw-wrap"><input name="${name}" type="password" required autocomplete="${auto}" ${extra}><button type="button" class="pw-toggle" data-action="toggle-pw">${t('auth.show')}</button></div>`;
function openAuth(mode = 'login', intent = 'hire') {
  const err = '<p class="auth-err" role="alert" style="color:#d92d50;min-height:1.2em;margin:0 0 8px;font-size:.9rem"></p>';
  modal(`<div style="text-align:center;margin-bottom:18px"><svg viewBox="0 0 32 32" width="44" height="44" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#3858FF"/><path d="M7 10l4 13 5-9 5 9 4-13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h2 style="margin:8px 0 0">${mode === 'login' ? t('auth.welcomeBack') : t('auth.join')}</h2><p class="muted" style="margin:4px 0 0">${mode === 'login' ? t('auth.loginSub') : t('auth.joinSub')}</p></div>
    <div class="tabs" style="width:100%;margin-bottom:18px"><button style="flex:1" class="${mode === 'login' ? 'active' : ''}" data-action="auth-tab" data-mode="login">${t('cta.login')}</button><button style="flex:1" class="${mode === 'signup' ? 'active' : ''}" data-action="auth-tab" data-mode="signup">${t('cta.signup')}</button></div>
    ${GOOGLE_AUTH ? `<button type="button" class="btn btn-google btn-block" data-action="google-auth">${GOOGLE_G}${mode === 'login' ? t('auth.googleContinue') : t('auth.googleSignup')}</button>
      <p class="small muted" style="text-align:center;margin:8px 0 0">${t('auth.googleTerms').replace('{terms}', `<a href="#/terms" data-action="close-modal">${t('legal.terms')}</a>`).replace('{privacy}', `<a href="#/privacy" data-action="close-modal">${t('auth.privacyLink')}</a>`)}</p>
      <div class="auth-divider"><span>${t('auth.or')}</span></div>` : ''}
    ${mode === 'login' ? `<form id="login-form">
      <div class="field"><label>${t('auth.email')}</label><input name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label>${t('auth.password')}</label>${pwField('password', 'current-password')}</div>
      ${err}<button class="btn btn-primary btn-block">${t('cta.login')}</button>
      <p class="small muted" style="text-align:center">${t('auth.noAccount')} <a href="#" data-action="auth-tab" data-mode="signup">${t('cta.signup')}</a></p></form>`
    : `<form id="signup-form">
      <div class="field"><label>${t('auth.iWant')}</label><div class="row">
        <label class="choice"><input type="radio" name="intent" value="hire" ${intent !== 'work' ? 'checked' : ''}><span class="big-ico">🧑‍💼</span> ${t('auth.hire')}</label>
        <label class="choice"><input type="radio" name="intent" value="work" ${intent === 'work' ? 'checked' : ''}><span class="big-ico">🛠️</span> ${t('auth.work')}</label></div></div>
      <div class="field"><label>${t('auth.fullName')}</label><input name="name" required maxlength="60" autocomplete="name"></div>
      ${locationFields('', '', { required: true })}
      <div class="fl-only"><div class="row"><div class="field"><label>${t('auth.mainCategory')}</label><select name="category">${approvedCats().map(c => `<option value="${c.id}">${c.ico} ${esc(catName(c))}</option>`).join('')}<option value="">🧩 ${{ et: 'Muu / loon oma kategooria', ru: 'Другое / создам свою категорию' }[lang] || 'Other / I’ll create my own'}</option></select></div>
        <div class="field"><label>${t('auth.whatDo')}</label><input name="title" maxlength="60" placeholder="${esc(t('auth.whatDoPh'))}"></div></div>
        <p class="small muted" style="margin-top:-6px">${t('auth.nextSteps')}</p></div>
      <div class="field"><label>${t('auth.email')}</label><input name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label>${t('auth.password')}</label>${pwField('password', 'new-password', `minlength="8" placeholder="${esc(t('auth.pwPh'))}"`)}</div>
      <label class="filter-opt small"><input type="checkbox" name="terms" required> ${t('auth.terms').replace('{terms}', `<a href="#/terms" data-action="close-modal">${t('legal.terms')}</a>`).replace('{privacy}', `<a href="#/privacy" data-action="close-modal">${t('auth.privacyLink')}</a>`)}</label>
      ${err}<button class="btn btn-primary btn-block">${t('auth.create')}</button>
      <p class="small muted" style="text-align:center">${t('auth.haveAccount')} <a href="#" data-action="auth-tab" data-mode="login">${t('cta.login')}</a></p></form>`}`, m => {
    const errEl = $('.auth-err', m);
    const lf = $('#login-form', m), sf = $('#signup-form', m);
    if (lf) lf.onsubmit = e => {
      e.preventDefault(); const f = new FormData(lf);
      act('auth/login', { email: f.get('email'), password: f.get('password') }, null, { errEl, after: () => {
        closeModal(); render(); toast(t('auth.welcomeBackName').replace('{name}', esc(me().name.split(' ')[0]))); } });
    };
    if (sf) sf.onsubmit = e => {
      e.preventDefault(); const f = new FormData(sf), work = f.get('intent') === 'work';
      const title = (f.get('title') || '').trim() || (f.get('category') ? catById(f.get('category')).name + ' freelancer' : 'Freelancer');
      act('auth/register', { intent: f.get('intent'), name: f.get('name'), email: f.get('email'), password: f.get('password'), city: f.get('city'), area: f.get('area'), category: f.get('category'), title, terms: !!f.get('terms') }, null, { errEl, after: () => {
        closeModal(); OB = null; go(work ? '#/onboarding' : '#/post-project'); render();
        toast(work ? t('auth.createdWork') : t('auth.createdHire')); } });
    };
  });
}

// Asks a logged-in user to accept the current Terms of Service.
function openTerms() {
  modal(`<h2>Our Terms of Service were updated</h2>
    <ul class="muted"><li>The client pays up front and Worklay holds the money until the work is done.</li><li>When the client approves the work, the freelancer is paid automatically.</li><li>If the client doesn’t approve finished work or report a problem within ${APPROVAL_DAYS} days, the freelancer is paid automatically.</li><li>If the client reports a problem with proof and Worklay accepts it, the client is refunded. Worklay decides within ${APPROVAL_DAYS} days.</li><li>Worklay keeps ${Math.round(PLATFORM_FEE * 100)}% of completed jobs, taken from the freelancer’s share.</li></ul>
    <p><a href="/terms" target="_blank" rel="noopener">Read the full ${t('legal.terms')}</a></p>
    <button class="btn btn-primary btn-block" data-action="terms-accept">I agree to the Terms of Service</button>`);
}
function openProposal(pid) {
  const p = project(pid);
  modal(`<h2>Submit a proposal</h2><p class="muted">${esc(p.title)}<br>Budget ${money(p.budgetMin)}–${money(p.budgetMax)}</p>
    <form id="pf"><div class="row"><div class="field"><label>Your price (€)</label><input name="amount" type="number" min="5" step="1" required value="${p.budgetMin}"></div>
    <div class="field"><label>Delivery (days)</label><input name="days" type="number" min="1" required value="7"></div></div>
    <div class="field"><label>Cover letter</label><textarea name="cover" required minlength="20" placeholder="Explain why you're a great fit and how you'll approach the work."></textarea></div>
    <p class="small muted">The client is notified right away. If you're awarded, Worklay keeps a ${PLATFORM_FEE * 100}% platform fee from the final amount.</p>
    <button class="btn btn-primary btn-block">Send proposal</button></form>`, m => {
    $('#pf', m).onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target);
      act('proposal/create', { projectId: pid, amount: f.get('amount'), days: f.get('days'), cover: f.get('cover') }, 'Proposal sent ✓', { after: () => { closeModal(); render(); } });
    };
  });
}

function openReview(targetUser, ctx) {
  modal(`<h2>Leave a review</h2><p class="muted">How was working with ${esc(user(targetUser).name)}?</p>
    <form id="rf"><div class="field"><label>Rating</label><select name="rating">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${'★'.repeat(n)}${'☆'.repeat(5 - n)} (${n})</option>`).join('')}</select></div>
    <div class="field"><label>Feedback</label><textarea name="text" required placeholder="Share details about quality, communication and delivery."></textarea></div>
    <button class="btn btn-primary btn-block">Submit review</button></form>`, m => {
    $('#rf', m).onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target);
      act('review/create', { rating: f.get('rating'), text: f.get('text'), orderId: ctx.orderId || 0, projectId: ctx.projectId || 0 }, 'Thanks for your review!', { after: () => { closeModal(); render(); } });
    };
  });
}

function openOrder(sid, idx) {
  const s = service(sid), pkg = s.packages[idx];
  modal(`<h2>Confirm order</h2><p><b>${esc(pkg.name)}</b> · ${esc(s.title)}</p><p class="muted">${esc(pkg.desc)}</p>
    <div class="list-item"><span>Package price</span><b>${money(pkg.price)}</b></div>
    <div class="list-item"><span>Delivery</span><span>${esc(pkg.delivery)}</span></div>
    <div class="field" style="margin-top:14px"><label>Requirements for the seller</label><textarea id="req" placeholder="Describe what you need…"></textarea></div>
    <p class="small muted">${CARD_PAYMENTS
      ? '🔒 You’ll pay securely by card on Stripe. Worklay holds the money and only releases it to the seller after you approve the delivery.'
      : 'The seller starts once you confirm. Payment is released to the seller only after you approve the delivery.'}</p>
    <button class="btn btn-primary btn-block" data-action="confirm-order" data-id="${sid}" data-idx="${idx}">${CARD_PAYMENTS ? 'Continue to payment · ' : 'Pay '}${money(pkg.price)}</button>`);
}

function openPayout() {
  const u = me();
  modal(`<h2>Request payout</h2><p class="muted">Available balance: <b>${money(u.balance)}</b>. Minimum ${money(MIN_PAYOUT)}.</p>
    <form id="pof"><div class="field"><label>Amount (€)</label><input name="amount" type="number" min="${MIN_PAYOUT}" max="${u.balance}" step="0.01" value="${u.balance}" required></div>
    <div class="field"><label>Method</label><select name="method">${PAYOUT_METHODS.map(m => `<option>${m}</option>`).join('')}</select></div>
    <div class="field"><label>Account details</label><input name="details" required placeholder="PayPal/Payoneer email, or IBAN"></div>
    <button class="btn btn-primary btn-block">Request payout</button></form>`, m => {
    $('#pof', m).onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target);
      act('payout/request', { amount: f.get('amount'), method: f.get('method'), details: f.get('details') }, 'Payout requested. An admin will process it shortly.', { after: () => { closeModal(); render(); } });
    };
  });
}

/* ---------- header ---------- */
function renderHeader() {
  const u = me(), el = $('#topbar-actions');
  document.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
  const tabbar = $('#tabbar');
  document.body.classList.toggle('has-tabbar', !!u);
  if (!u) {
    el.innerHTML = `${languagePicker()}<button class="btn btn-ghost" data-action="login">${t('cta.login')}</button><button class="btn btn-primary btn-sm" data-action="signup">${t('cta.signup')}</button>`;
    if (tabbar) tabbar.innerHTML = '';
    return;
  }
  const unreadN = db.notifications.filter(n => n.userId === u.id && !n.read).length;
  const unreadM = db.messages.filter(m => m.to === u.id && !m.read).length;
  if (tabbar) {
    const route = parseHash().name;
    const tab = (href, ico, label, names, cls = '', badge = 0) => `<a href="${href}" class="${cls} ${names.includes(route) ? 'active' : ''}"><span class="ti">${ico}</span>${label}${badge ? `<span class="dot">${badge}</span>` : ''}</a>`;
    tabbar.innerHTML = tab('#/', '🏠', 'Home', ['']) + tab('#/freelancers', '🔍', 'Find', ['freelancers', 'services', 'projects'])
      + tab(u.isFreelancer ? '#/post-service' : '#/post-project', '＋', u.isFreelancer ? 'Offer' : 'Post', ['post-project', 'post-service'], 'post')
      + tab('#/messages', '💬', 'Messages', ['messages'], '', unreadM) + tab('#/dashboard', '👤', 'Me', ['dashboard', 'notifications', 'wishlist', 'user'], '', unreadN);
  }
  el.innerHTML = `${languagePicker()}
    <a class="icon-btn hide-sm" href="#/wishlist" title="Wishlist" aria-label="Wishlist">♡</a>
    <a class="icon-btn" href="#/messages" title="Messages" aria-label="Messages">💬${unreadM ? `<span class="dot">${unreadM}</span>` : ''}</a>
    <a class="icon-btn" href="#/notifications" title="Notifications" aria-label="Notifications">🔔${unreadN ? `<span class="dot">${unreadN}</span>` : ''}</a>
    <div class="dropdown" id="userdd"><button class="icon-btn" style="padding:0;border:0" data-action="toggle-dd" aria-label="Account menu" aria-haspopup="true" aria-expanded="false">${avatar(u)}</button>
      <div class="dropdown-menu"><div style="padding:8px 12px"><b>${esc(u.name)}</b><br><small class="muted">${money(u.balance)} balance</small></div><hr>
        <a href="#/dashboard">Dashboard</a><a href="#/user/${u.id}">My profile</a><a href="#/post-project">Post a project</a><a href="#/post-service">Offer a service</a><a href="#/wishlist">Wishlist</a>
        ${u.role === 'admin' ? '<a href="#/admin">Admin panel</a>' : ''}<hr><button data-action="logout">Log out</button></div></div>`;
}

/* ---------- views ---------- */
const V = {};

/* Earnings tab when payments go through Stripe Connect. */
function stripeEarnings(u) {
  const s = u.payouts || {}, mine = (db.payments || []).filter(p => p.sellerId === u.id);
  const label = p => p.kind === 'booking' ? `Booking ${fmtDate((db.bookings.find(b => b.id === p.bookingId) || {}).date || localNow().date)}` : p.kind === 'order' ? (service((db.orders.find(o => o.id === p.orderId) || {}).serviceId) || {}).title || 'Service order' : (project(p.projectId) || {}).title || 'Project';
  const setup = !s.connected
    ? `<div><b>Set up payouts</b><div class="small muted">Connect your bank account through Stripe to receive your earnings. Stripe will ask for your ID and bank details; it only takes a few minutes.</div></div><button class="btn btn-primary" data-action="stripe-connect">Set up payouts</button>`
    : !s.ready
      ? `<div><b>Finish setting up payouts</b><div class="small muted">Stripe still needs some details before it can send you money. Earnings wait safely until you finish.</div></div><button class="btn btn-primary" data-action="stripe-connect">Continue setup</button>`
      : `<div><b>✓ Payouts are on</b><div class="small muted">When a customer approves your work, your share is sent to your Stripe account and paid out to your bank automatically.</div></div><button class="btn btn-outline" data-action="stripe-dashboard">Open Stripe dashboard</button>`;
  return `<h1>Earnings & payouts</h1>
    <div class="kpis"><div class="kpi"><div class="muted small">Held until approval</div><div class="v">${money(s.held || 0)}</div></div><div class="kpi"><div class="muted small">Waiting for payout setup</div><div class="v">${money(s.waiting || 0)}</div></div><div class="kpi"><div class="muted small">Sent to your bank account</div><div class="v">${money(s.transferred || 0)}</div></div><div class="kpi"><div class="muted small">Platform fee</div><div class="v">${PLATFORM_FEE * 100}%</div></div></div>
    <div class="card card-pad" style="margin-bottom:20px"><div class="list-item">${setup}</div></div>
    <div class="card card-pad"><h3>Payments</h3>${mine.length ? mine.map(p => `<div class="list-item"><div><b>${esc(label(p))}</b><div class="small muted">Customer paid ${money(p.amount)} · fee ${money(p.fee)} · ${ago(p.created)}</div></div><div style="display:flex;gap:10px;align-items:center"><b>${money(p.net)}</b>${statusTag(p.status)}</div></div>`).join('') : '<p class="muted">No payments yet. When customers pay for your services or projects, they appear here.</p>'}</div>`;
}

/* Live date and time (visitor's local time zone) shown in the home hero. */
function clockParts(d = new Date()) {
  const loc = ({ et: 'et-EE', ru: 'ru-RU' })[lang] || 'en-GB';
  const date = d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return { date: date.charAt(0).toUpperCase() + date.slice(1), time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' }), iso: d.toISOString() };
}
function liveClock() {
  const c = clockParts();
  return `<span class="pill-badge hero-clock" id="live-clock">🕒 <span class="clock-date">${c.date}</span><span aria-hidden="true">·</span><time class="clock-time" datetime="${c.iso}">${c.time}</time></span>`;
}
function tickClock() {
  const el = document.getElementById('live-clock');
  if (el) {
    const c = clockParts();
    el.querySelector('.clock-date').textContent = c.date;
    const tm = el.querySelector('.clock-time'); tm.textContent = c.time; tm.setAttribute('datetime', c.iso);
  }
  setTimeout(tickClock, 1000 - (Date.now() % 1000)); // stay aligned to the start of each second
}

V.home = () => {
  const latest = [...db.projects].filter(p => p.status === 'open').sort((a, b) => b.created.localeCompare(a.created)).slice(0, 3);
  const popular = [...db.services].sort((a, b) => serviceRating(b.id).n - serviceRating(a.id).n).slice(0, 4);
  const u = me();
  const nearby = db.users.filter(x => x.isFreelancer && (!u || x.id !== u.id)).sort((a, b) => byNearMe(x => x)(a, b) || userStats(b.id).rating - userStats(a.id).rating).slice(0, 4);
  const nearHead = u && u.city ? `${t('home.nearbyLocation')} ${esc(u.city)}` : t('home.nearbyHead');
  const areaCount = Object.values(CITIES).reduce((a, l) => a + l.length, 0);
  const catCount = id => db.users.filter(x => x.isFreelancer && x.category === id).length + db.services.filter(s => s.category === id).length;
  const invite = (ico, title, text, btn) => `<div class="invite"><span class="ico">${ico}</span><div><h3>${title}</h3><p>${text}</p></div>${btn}</div>`;
  const joinBtn = u ? `<a class="btn btn-primary" href="#/dashboard/settings">${t('home.setupFreelancer')}</a>` : `<button class="btn btn-primary" data-action="signup" data-intent="work">${t('home.joinFreelancer')}</button>`;
  return `
  <section class="hero"><div class="container hero-inner">
    <div>
      <div class="hero-badges"><span class="pill-badge">📍 ${t('hero.local').replace('{count}', Object.keys(CITIES).length)}</span>${liveClock()}</div>
      <h1>${lang === 'en' || lang === 'ru' ? t('hero.titleHtml') : t('hero.title')}</h1>
      <p class="lead">${t('hero.lead')}</p>
      <form class="search-bar" id="hero-search"><input name="q" placeholder="${esc(t('hero.ph'))}" aria-label="${t('hero.search')}"><select name="city" aria-label="${t('hero.searchArea')}"><option value="">📍 ${t('hero.allCities')}</option>${Object.keys(CITIES).map(c => `<option ${u && u.city === c ? 'selected' : ''}>${c}</option>`).join('')}</select><select name="type" aria-label="${t('hero.searchIn')}"><option value="freelancers">${t('nav.freelancers')}</option><option value="services">${t('nav.services')}</option><option value="projects">${t('nav.projects')}</option></select><button class="btn btn-primary">${t('cta.search')}</button></form>
      <div class="chips"><span class="chips-label">${t('hero.popular')}</span>${[['Cleaning', 'chip.cleaning'], ['Furniture assembly', 'chip.furniture'], ['Logo design', 'chip.logo'], ['Web development', 'chip.web'], ['Translation', 'chip.translation']].map(([q, key]) => `<button class="chip" data-action="chip" data-q="${q}">${t(key)}</button>`).join('')}</div>
      ${u ? '' : `<div class="hero-ctas"><a class="btn btn-white btn-lg" href="#/post-project">${t('hero.hire')}</a><button class="btn btn-glass btn-lg" data-action="signup" data-intent="work">${t('hero.earn')}</button></div>`}
    </div>
    <div class="hero-art" aria-hidden="true">
      <svg class="shape" style="left:40px;top:10px" width="54" height="54" viewBox="0 0 50 50"><path d="M25 3l20 40H5z" fill="#F4A6B4"/></svg>
      <svg class="shape" style="right:20px;top:60px;animation-delay:-2s" width="44" height="44" viewBox="0 0 50 50"><circle cx="25" cy="25" r="22" fill="#FFC233"/></svg>
      <svg class="shape" style="left:10px;bottom:30px;animation-delay:-4s" width="60" height="60" viewBox="0 0 50 50"><rect x="5" y="5" width="40" height="40" rx="10" fill="#7B5CF5"/></svg>
      <div class="hero-card" style="left:70px;top:70px"><span class="avatar md" style="background:#eef1ff;color:#3858FF">📍</span><div><b>${t('hero.near')}</b><small class="muted">${t('hero.searchArea')}</small></div></div>
      <div class="hero-card" style="right:0;top:170px;animation-delay:-2s"><span class="avatar md" style="background:#e3f8ee;color:#17B26A">✓</span><div><b>${t('hero.verified')}</b><small class="muted">${t('hero.idChecked')}</small></div></div>
      <div class="hero-card" style="left:30px;bottom:30px;animation-delay:-4s"><span class="avatar md" style="background:#fff0e7;color:#FF7A3D">📨</span><div><b>${t('hero.proposals')}</b><small class="muted">${t('hero.postFree')}</small></div></div>
    </div>
  </div></section>

  <section class="container trust"><div class="trust-inner">
    <div class="trust-item"><span class="ico" style="background:#eef1ff">📍</span><div><b>${t('trust.cities').replace('{cities}', Object.keys(CITIES).length).replace('{areas}', areaCount)}</b><span>${t('trust.nearby')}</span></div></div>
    <div class="trust-item"><span class="ico" style="background:#e3f8ee">🛡️</span><div><b>${t('trust.verified')}</b><span>${t('trust.documents')}</span></div></div>
    <div class="trust-item"><span class="ico" style="background:#fff0e7">💶</span><div><b>${t('trust.pay')}</b><span>${t('trust.release')}</span></div></div>
    <div class="trust-item"><span class="ico" style="background:#f0ebff">🆓</span><div><b>${t('trust.free')}</b><span>${t('trust.post')}</span></div></div>
  </div></section>

  <section class="section"><div class="container">
    <div class="section-head"><div><div class="eyebrow">${t('home.safe')}</div><h2>${t('home.how')}</h2></div></div>
    <div class="how">
      <div class="how-col"><h3>${t('home.customer')}</h3><ol>
        <li><div><b>${t('home.postFree')}</b>${t('home.describe')}</div></li>
        <li><div><b>${t('home.compare')}</b>${t('home.compareDesc')}</div></li>
        <li><div><b>${t('home.payHappy')}</b>${t('home.payHappyDesc')}</div></li></ol>
        <a class="btn btn-primary" href="#/post-project">${t('cta.post')}</a></div>
      <div class="how-col alt"><h3>${t('home.freelancer')}</h3><ol>
        <li><div><b>${t('home.createProfile')}</b>${t('home.chooseLocation')}</div></li>
        <li><div><b>${t('home.offerPackages')}</b>${t('home.setPrices')}</div></li>
        <li><div><b>${t('home.getPaid')}</b>${t('home.withdraw')}</div></li></ol>
        ${u ? `<a class="btn btn-outline" href="#/post-service">${t('nav.services')}</a>` : `<button class="btn btn-outline" data-action="signup" data-intent="work">${t('cta.signup')}</button>`}</div>
    </div>
  </div></section>

  <section class="section" style="padding-top:0"><div class="container">
    <div class="section-head"><div><h2>${t('home.cats')}</h2><p>${t('home.categoriesDesc')}</p></div></div>
    <div class="cat-grid">${approvedCats().map(c => { const n = catCount(c.id); return `<a class="cat" href="#/freelancers?cat=${c.id}"><span class="ico" style="background:${c.color}">${c.ico}</span><div><b>${esc(catName(c))}</b><span>${n ? n + ' ' + t('home.available') : t('home.first')}</span></div></a>`; }).join('')}</div>
  </div></section>

  <section class="section" style="padding-top:0"><div class="container">
    <div class="section-head"><div><h2>${nearHead}</h2><p>${t('home.pickCity')}</p></div>${nearby.length ? `<a href="#/freelancers${u && u.city ? '?city=' + encodeURIComponent(u.city) : ''}">${t('common.viewall')} →</a>` : ''}</div>
    ${nearby.length ? `<div class="grid">${nearby.map(freelancerCard).join('')}</div>` : invite('🙋', t('home.firstFreelancer'), t('home.profileNearby'), joinBtn)}
    <div class="city-chips">${Object.keys(CITIES).map(c => `<a class="city-chip" href="#/freelancers?city=${encodeURIComponent(c)}">📍 ${c}</a>`).join('')}</div>
  </div></section>

  <section class="section" style="padding-top:0"><div class="container">
    <div class="section-head"><div><h2>${t('home.popular')}</h2><p>${t('home.readyPackages')}</p></div>${popular.length ? `<a href="#/services">${t('common.viewall')} →</a>` : ''}</div>
    ${popular.length ? `<div class="grid">${popular.map(serviceCard).join('')}</div>` : invite('📦', t('home.noServices'), t('home.servicesDesc'), u ? `<a class="btn btn-primary" href="#/post-service">${t('nav.services')}</a>` : joinBtn)}
  </div></section>

  <section class="section" style="padding-top:0"><div class="container">
    <div class="section-head"><div><h2>${t('home.latest')}</h2><p>${t('home.jobsDesc')}</p></div>${latest.length ? `<a href="#/projects">${t('common.viewall')} →</a>` : ''}</div>
    ${latest.length ? `<div class="grid">${latest.map(projectCard).join('')}</div>` : invite('📝', t('home.needDone'), t('home.postProjectFree'), `<a class="btn btn-primary" href="#/post-project">${t('cta.post')}</a>`)}
  </div></section>

  <section class="container"><div class="cta-band"><div><h2>${t('home.earnOwn')}</h2><p style="color:#e4e8ff;margin:0">${t('home.offerLocal')}</p></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">${u ? `<a class="btn btn-white" href="#/post-service">${t('nav.services')}</a>` : `<button class="btn btn-white" data-action="signup" data-intent="work">${t('cta.signup')}</button>`}<a class="btn btn-glass" href="#/projects">${t('home.browseProjects')}</a></div></div></section>`;
};

function filterSidebar(kind, q) {
  const cats = (q.cat || '').split(',').filter(Boolean), subs = (q.sub || '').split(',').filter(Boolean);
  const u = me();
  return `<aside class="filters"><form id="filters">
    <label>Search</label><input name="q" value="${esc(q.q || '')}" placeholder="Keywords">
    <h4>📍 Location</h4>${locationFields(q.city || '', q.area || '', { any: true })}
    ${u && u.city ? `<button type="button" class="btn btn-outline btn-sm btn-block" data-action="near-me">Near me (${esc(locStr(u))})</button>` : ''}
    ${kind === 'projects' ? `<label class="filter-opt"><input type="checkbox" name="remote" value="1" ${q.remote ? 'checked' : ''}> Include remote projects</label>` : ''}
    <h4>Category</h4>${CATEGORIES.filter(c => c.status !== 'NEW' || cats.includes(c.id) || db.users.some(x => x.isFreelancer && x.category === c.id)).map(c => `<div class="cat-filter"><label class="filter-opt"><input type="checkbox" name="cat" value="${c.id}" ${cats.includes(c.id) ? 'checked' : ''}> ${c.ico} ${esc(catName(c))}</label>
      ${kind === 'freelancers' && c.subcategories.length ? `<div class="sub-filter">${c.subcategories.map(x => `<label class="filter-opt small"><input type="checkbox" name="sub" value="${x.id}" ${subs.includes(x.id) ? 'checked' : ''}> ${esc(catName(x))}</label>`).join('')}</div>` : ''}</div>`).join('')}
    ${kind === 'freelancers' ? `<h4>📚 Tutoring</h4>
      <select name="subject"><option value="">Any subject</option>${[...new Set([...TUTOR_SUBJECTS, ...db.users.flatMap(x => x.tutorSubjects || [])])].map(x => `<option ${q.subject === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select name="level" style="margin-top:8px"><option value="">Any class / level</option>${[...new Set([...TUTOR_LEVELS, ...db.users.flatMap(x => x.tutorLevels || [])])].map(x => `<option ${q.level === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <h4>🕒 Available</h4><select name="time"><option value="">Any time</option>${TIMES.map(([k, l, h]) => `<option value="${k}" ${q.time === k ? 'selected' : ''}>${l} (${h})</option>`).join('')}</select>
      <label class="filter-opt"><input type="checkbox" name="urgent" value="1" ${q.urgent ? 'checked' : ''}> ⚡ Takes same-day bookings</label>` : ''}
    <h4>${kind === 'projects' ? 'Budget' : kind === 'freelancers' ? 'Price' : 'Starting price'} (€)</h4><div class="row"><input name="min" type="number" placeholder="Min" value="${esc(q.min || '')}"><input name="max" type="number" placeholder="Max" value="${esc(q.max || '')}"></div>
    ${kind !== 'projects' ? `<h4>Seller</h4><label class="filter-opt"><input type="checkbox" name="verified" value="1" ${q.verified ? 'checked' : ''}> Verified only</label>` : `<h4>Status</h4><label class="filter-opt"><input type="checkbox" name="open" value="1" ${q.open ? 'checked' : ''}> Open for proposals</label>`}
    <button class="btn btn-primary btn-block" style="margin-top:14px">Apply filters</button>
    <a class="btn btn-ghost btn-block btn-sm" href="#/${kind}">Clear</a></form></aside>`;
}
const subById = id => CATEGORIES.flatMap(c => c.subcategories || []).find(x => x.id === id);
// A subcategory only narrows its own category: picking "Nails" doesn't hide people from other chosen categories.
function matchSubs(u, subs) {
  const own = (catById(u.category).subcategories || []).map(x => x.id).filter(id => subs.includes(id));
  return !own.length || own.some(id => u.subcategories.includes(id));
}
function activeFilters(kind, q) {
  const chips = [];
  if (q.q) chips.push(['q', '', `“${q.q}”`]);
  if (q.city) chips.push(['city', '', '📍 ' + (q.area ? q.area + ', ' : '') + q.city]);
  (q.cat || '').split(',').filter(Boolean).forEach(c => chips.push(['cat', c, catById(c).ico + ' ' + catName(catById(c))]));
  (q.sub || '').split(',').filter(Boolean).forEach(id => { const x = subById(id); if (x) chips.push(['sub', id, catName(x)]); });
  if (q.min) chips.push(['min', '', 'From €' + q.min]);
  if (q.max) chips.push(['max', '', 'Up to €' + q.max]);
  if (q.verified) chips.push(['verified', '', '✓ Verified only']);
  if (q.open) chips.push(['open', '', 'Open only']);
  if (q.subject) chips.push(['subject', '', '📚 ' + q.subject]);
  if (q.level) chips.push(['level', '', '🎓 ' + q.level]);
  if (q.time) chips.push(['time', '', '🕒 ' + (TIMES.find(([k]) => k === q.time) || ['', q.time])[1]]);
  if (q.urgent) chips.push(['urgent', '', '⚡ Same-day']);
  if (q.remote) chips.push(['remote', '', '🌐 Incl. remote']);
  if (!chips.length) return '';
  return `<div class="active-filters">${chips.map(([k, v, l]) => `<button class="af-chip" data-action="clear-filter" data-key="${k}" data-val="${esc(v)}" aria-label="Remove filter ${esc(l)}">${esc(l)} <span>×</span></button>`).join('')}<button class="af-clear" data-action="nav" data-href="#/${kind}">Clear all</button></div>`;
}
function listToolbar(kind, q, count, noun, right = '') {
  return `<div class="toolbar"><div style="display:flex;gap:10px;align-items:center"><button class="btn btn-outline btn-sm filter-toggle" data-action="toggle-filters">⚙️ Filters</button><span class="muted"><b style="color:var(--ink)">${count}</b> ${noun}${count === 1 ? '' : 's'}${locHeading(q)}</span></div>${right}</div>${activeFilters(kind, q)}`;
}
const matchQ = (q, ...fields) => !q || fields.join(' ').toLowerCase().includes(q.toLowerCase());
const matchLoc = (q, o) => (!q.city || o.city === q.city) && (!q.area || o.area === q.area);
// Freelancers also match every area they cover.
const matchFreelancerLoc = (q, u) => (!q.city || u.city === q.city) && (!q.area || u.area === q.area || (u.serviceAreas || []).includes(q.area));
// Closest to the viewer first (same area, then same city)
const byNearMe = getLoc => (a, b) => { const u = me(); return u ? proximity(u, getLoc(b)) - proximity(u, getLoc(a)) : 0; };
const locHeading = q => q.city ? ` in ${esc(q.area ? q.area + ', ' + q.city : q.city)}` : '';

function freelancerCard(u) {
  const st = userStats(u.id), svcs = db.services.filter(s => s.sellerId === u.id);
  const from = svcs.length ? Math.min(...svcs.map(s => s.packages[0].price)) : 0;
  return `<div class="card fl-card">
    <div class="top">${avatar(u, 'md')}<div style="min-width:0"><a class="name" href="#/user/${u.id}">${esc(u.name)}</a> ${u.verification.status === 'verified' ? '<span class="verified" title="Verified">✓</span>' : ''}<div class="small muted truncate">${esc(u.title)}</div></div></div>
    ${u.specialty ? `<div class="small"><b>${esc(u.specialty)}</b></div>` : ''}
    <div class="proj-meta"><span>📍 <b>${esc(locStr(u) || 'Location not set')}</b>${u.serviceAreas.filter(a => a !== u.area).length ? ` <span class="muted">+${u.serviceAreas.filter(a => a !== u.area).length} areas</span>` : ''}</span>${proxTag(u)}</div>
    ${weeklyText(u.weeklyAvailability) ? `<div class="small muted">🕒 ${esc(weeklyText(u.weeklyAvailability))}${u.availableForUrgent ? ' · ⚡ same-day' : ''}</div>` : ''}
    <div class="small">${stars(st.rating, st.reviews)} · ${st.doneProjects + st.doneServices} jobs done</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${[...new Set([...specialisms(u), ...u.tutorSubjects, ...u.skills])].slice(0, 4).map(s => `<span class="tag gray">${esc(s)}</span>`).join('')}</div>
    <div class="list-item" style="padding:10px 0 0;border:0"><span>${priceText(u) ? `<b class="price">${priceText(u)}</b>` : from ? `from <b>${money(from)}</b>` : ''}</span>
      <span style="display:flex;gap:6px"><a class="btn btn-outline btn-sm" href="#/messages/${u.id}">💬</a><a class="btn btn-primary btn-sm" href="#/user/${u.id}">View profile</a></span></div>
  </div>`;
}

V.freelancers = (_, q) => {
  const cats = (q.cat || '').split(',').filter(Boolean), subs = (q.sub || '').split(',').filter(Boolean);
  const list = db.users.filter(u => u.isFreelancer && (!me() || u.id !== me().id) && matchFreelancerLoc(q, u) && (!cats.length || cats.includes(u.category)) && matchSubs(u, subs)
    && matchQ(q.q, u.name, u.title, u.specialty, u.bio, u.skills.join(' '), u.tutorSubjects.join(' '), specialisms(u).join(' '), catName(catById(u.category)), catById(u.category).name) && (!q.min || u.priceAmount >= +q.min) && (!q.max || u.priceAmount <= +q.max) && (!q.verified || u.verification.status === 'verified')
    && (!q.subject || u.tutorSubjects.includes(q.subject)) && (!q.level || u.tutorLevels.includes(q.level)) && (!q.time || worksDuring(u, q.time)) && (!q.urgent || u.availableForUrgent))
    .sort((a, b) => byNearMe(x => x)(a, b) || userStats(b.id).rating - userStats(a.id).rating);
  return `<div class="page-head"><div class="container"><h1>Find freelancers${locHeading(q)}</h1><p>Hire trusted local professionals by city and area — or work with anyone remotely.</p></div></div>
  <div class="container layout">${filterSidebar('freelancers', q)}<div>
    ${listToolbar('freelancers', q, list.length, 'freelancer', me() && me().city ? '<span class="small muted">📍 Closest to you first</span>' : '')}
    ${list.length ? `<div class="grid">${list.map(freelancerCard).join('')}</div>` : empty('📍', q.city || q.cat || q.q ? 'No freelancers match yet. Try a nearby area, the whole city or fewer filters.' : 'No freelancers have joined yet. Be the first!', q.area ? `<button class="btn btn-outline" data-action="widen">Show all of ${esc(q.city)}</button>` : (me() ? '<a class="btn btn-primary" href="#/post-project">Post a project instead</a>' : '<button class="btn btn-primary" data-action="signup" data-intent="work">Join as a freelancer</button>'))}
  </div></div>`;
};

V.services = (_, q) => {
  const cats = (q.cat || '').split(',').filter(Boolean);
  let list = db.services.filter(s => (!cats.length || cats.includes(s.category)) && matchQ(q.q, s.title, s.description, user(s.sellerId).name, user(s.sellerId).skills.join(' '))
    && (!q.min || s.packages[0].price >= +q.min) && (!q.max || s.packages[0].price <= +q.max) && (!q.verified || user(s.sellerId).verification.status === 'verified') && matchFreelancerLoc(q, user(s.sellerId)));
  const sort = q.sort || (me() && me().city ? 'near' : 'rating');
  if (sort === 'near') list.sort((a, b) => byNearMe(s => user(s.sellerId))(a, b) || serviceRating(b.id).avg - serviceRating(a.id).avg); else list.sort(sort === 'price' ? (a, b) => a.packages[0].price - b.packages[0].price : sort === 'new' ? (a, b) => b.created.localeCompare(a.created) : (a, b) => serviceRating(b.id).avg - serviceRating(a.id).avg);
  return `<div class="page-head"><div class="container"><h1>${t('nav.services')}${locHeading(q)}</h1><p>Ready-made packages from verified professionals.</p></div></div>
  <div class="container layout">${filterSidebar('services', q)}<div>
    ${listToolbar('services', q, list.length, 'service', `<select data-action="sort" aria-label="Sort">${me() && me().city ? `<option value="near" ${sort === 'near' ? 'selected' : ''}>Nearest to me</option>` : ''}<option value="rating" ${sort === 'rating' ? 'selected' : ''}>Top rated</option><option value="new" ${sort === 'new' ? 'selected' : ''}>Newest</option><option value="price" ${sort === 'price' ? 'selected' : ''}>Lowest price</option></select>`)}
    ${list.length ? `<div class="grid">${list.map(serviceCard).join('')}</div>` : empty('📦', db.services.length ? 'No services match these filters. Try removing some.' : 'No services yet. Freelancers can list their first package in minutes.', me() ? '<a class="btn btn-primary" href="#/post-service">Offer a service</a>' : '<button class="btn btn-primary" data-action="signup" data-intent="work">Join as a freelancer</button>')}
  </div></div>`;
};

V.projects = (_, q) => {
  const cats = (q.cat || '').split(',').filter(Boolean);
  let list = db.projects.filter(p => (!cats.length || cats.includes(p.category)) && matchQ(q.q, p.title, p.description, p.skills.join(' '))
    && (!q.min || p.budgetMax >= +q.min) && (!q.max || p.budgetMin <= +q.max) && (!q.open || p.status === 'open')
    && (matchLoc(q, p) || (q.remote && p.remote)));
  list.sort((a, b) => byNearMe(x => x)(a, b) || b.created.localeCompare(a.created));
  return `<div class="page-head"><div class="container"><h1>${t('nav.projects')}${locHeading(q)}</h1><p>Browse tasks posted by people who need help — and send your proposal.</p></div></div>
  <div class="container layout">${filterSidebar('projects', q)}<div>
    ${listToolbar('projects', q, list.length, 'project', `<a class="btn btn-primary btn-sm" href="#/post-project">+ ${t('cta.post')}</a>`)}
    ${list.length ? `<div class="grid">${list.map(projectCard).join('')}</div>` : empty('📝', db.projects.length ? 'No projects match these filters. Try removing some.' : 'No projects posted yet. Need something done? Post the first one.', `<a class="btn btn-primary" href="#/post-project">${t('cta.post')}</a>`)}
  </div></div>`;
};

V.service = ([id], q) => {
  const s = service(id); if (!s) return V.notFound();
  const u = user(s.sellerId), r = serviceRating(s.id), rv = db.reviews.filter(x => x.serviceId === s.id);
  const sel = Math.min(+(q.pkg || 0), s.packages.length - 1), pk = s.packages[sel];
  const own = me() && me().id === u.id;
  const feat = (on) => on ? '<span class="ok">✓</span>' : '<span class="no">✕</span>';
  return `<div class="container detail"><div>
    <div class="small muted"><a href="#/services">Services</a> › <a href="#/services?cat=${s.category}">${esc(catName(catById(s.category)))}</a></div>
    <h1 style="margin-top:10px">${esc(s.title)}</h1>
    <div class="seller-line"><a href="#/user/${u.id}" class="seller-line">${avatar(u, 'sm')} <b>${esc(u.name)}</b></a> ${u.verification.status === 'verified' ? '<span class="verified">✓ Verified</span>' : ''} · ${stars(r.avg, r.n)}</div>
    <div class="detail-cover" style="background:${s.color}">${s.emoji}</div>
    <h2>About this service</h2><p class="muted">${esc(s.description)}</p>
    <h2 style="margin-top:30px">Compare packages</h2>
    <div class="table-wrap"><table class="pkg-table"><thead><tr><th>Features</th>${s.packages.map(p => `<th><div class="big">${money(p.price)}</div><div>${esc(p.name)}</div><div class="small muted" style="font-weight:400">${esc(p.desc)}</div></th>`).join('')}</tr></thead>
    <tbody><tr><td><b>Delivery Time</b></td>${s.packages.map(p => `<td>${esc(p.delivery)}</td>`).join('')}</tr>
    <tr><td><b>Revisions</b></td>${s.packages.map(p => `<td>${p.revisions}</td>`).join('')}</tr>
    ${FEATURE_NAMES.map((f, i) => `<tr><td><b>${f}</b></td>${s.packages.map(p => `<td>${feat(p.feats[i])}</td>`).join('')}</tr>`).join('')}
    <tr><td><b>Price</b></td>${s.packages.map(p => `<td>${money(p.price)}</td>`).join('')}</tr>
    <tr><td><b>Total</b></td>${s.packages.map((p, i) => `<td><button class="btn btn-sm btn-outline" data-action="order" data-id="${s.id}" data-idx="${i}" ${own ? 'disabled' : ''}>${t('common.order')} ${money(p.price)}</button></td>`).join('')}</tr></tbody></table></div>
    <h2 style="margin-top:30px">About the seller</h2>
    <div class="profile-card">${avatar(u, 'md')}<div style="flex:1;min-width:200px"><a href="#/user/${u.id}"><b>${esc(u.name)}</b></a>${badges(u)}<div class="muted small">${esc(u.title)} · 📍 ${esc(locStr(u) || '—')} · Member since ${monthYear(u.joined)}</div>${proxTag(u)}</div>
      ${own ? '' : `<a class="btn btn-outline btn-sm" href="#/messages/${u.id}">${t('common.message')}</a>`}</div>
    <h2 style="margin-top:30px">Reviews ${r.n ? `<span class="stars">★ ${r.avg.toFixed(1)}</span>` : ''}</h2>
    ${rv.length ? rv.map(x => { const f = user(x.from); return `<div class="review">${avatar(f, 'sm')}<div><b>${esc(f.name)}</b> <span class="stars">${'★'.repeat(x.rating)}</span> <span class="muted small">${ago(x.date)}</span><p style="margin:4px 0 0">${esc(x.text)}</p></div></div>`; }).join('') : '<p class="muted">No reviews yet.</p>'}
  </div>
  <aside><div class="card card-pad side-pkg">
    <div class="tabs">${s.packages.map((p, i) => `<button class="${i === sel ? 'active' : ''}" data-action="pkg-tab" data-idx="${i}">${esc(p.name)}</button>`).join('')}</div>
    <div class="big" style="font-size:2rem;font-weight:700">${money(pk.price)}</div><p class="muted">${esc(pk.desc)}</p>
    <div><b>⏱ ${esc(pk.delivery)}</b> · ${pk.revisions} revisions</div>
    <ul>${FEATURE_NAMES.map((f, i) => `<li>${feat(pk.feats[i])} ${f}</li>`).join('')}</ul>
    <button class="btn btn-primary btn-block" data-action="order" data-id="${s.id}" data-idx="${sel}" ${own ? 'disabled' : ''}>${t('common.order')} (${money(pk.price)})</button>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-outline btn-sm" style="flex:1" data-action="wish" data-kind="service" data-id="${s.id}">${inWishlist('service', s.id) ? '♥ Saved' : '♡ Save'}</button>
    ${own ? '' : `<a class="btn btn-outline btn-sm" style="flex:1" href="#/messages/${u.id}">💬 ${t('common.message')}</a>`}</div>
  </div></aside></div>`;
};

V.project = ([id]) => {
  const p = project(id); if (!p) return V.notFound();
  const owner = user(p.ownerId), u = me(), isOwner = u && u.id === owner.id;
  const props = db.proposals.filter(x => x.projectId === p.id);
  const mine = u && props.find(x => x.sellerId === u.id);
  let action = '';
  if (isOwner && p.status === 'awarded') action = `<button class="btn btn-primary btn-block" data-action="complete-project" data-id="${p.id}">Approve & release ${money(p.awardedAmount)}</button><p class="small muted">${p.deliveredAt ? `The freelancer marked this as done ${ago(p.deliveredAt)}. Check the work, then release the payment.` : 'Release the payment once the work is done.'}</p>${payNote('project', p.id)}`;
  else if (u && p.awardedTo === u.id && p.status === 'awarded') action = (p.deliveredAt ? '<p class="muted">You marked this as done. Waiting for the client’s approval.</p>' : `<button class="btn btn-primary btn-block" data-action="project-deliver" data-id="${p.id}">Work is done</button><p class="small muted">The client is asked to check the work and release the payment.</p>`) + payNote('project', p.id);
  else if (isOwner) action = `<p class="muted">You posted this project.</p>`;
  else if (mine) action = `<p>Your proposal: <b>${money(mine.amount)}</b> ${statusTag(mine.status)}</p>`;
  else if (p.status === 'open') action = `<button class="btn btn-primary btn-block" data-action="propose" data-id="${p.id}">Submit a proposal</button>`;
  else action = `<p class="muted">This project is no longer accepting proposals.</p>`;
  const showProps = isOwner ? props : props.filter(x => u && x.sellerId === u.id);
  return `<div class="container detail"><div>
    <div class="small muted"><a href="#/projects">Projects</a> › ${esc(catName(catById(p.category)))}</div>
    <h1 style="margin-top:10px">${esc(p.title)}</h1>
    <div style="display:flex;gap:8px;margin-bottom:16px">${statusTag(p.status)}<span class="tag gray">Posted ${ago(p.created)}</span></div>
    <div class="card card-pad"><h3>Project details</h3><p style="white-space:pre-line">${esc(p.description)}</p>
      <div class="proj-meta"><span>💶 Budget <b>${money(p.budgetMin)}–${money(p.budgetMax)}</b></span><span>⏱ ${esc(p.deadline)}</span><span>📍 ${esc(locStr(p) || '—')}</span>${p.remote ? '<span class="tag purple">🌐 Can be done remotely</span>' : '<span class="tag orange">On-site work</span>'}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px">${p.skills.map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div></div>
    <h2 style="margin-top:30px">Proposals (${p.proposalCount})</h2>
    ${!isOwner && p.proposalCount > showProps.length ? '<p class="muted small">Proposals are only visible to the project owner.</p>' : ''}
    ${showProps.length ? showProps.map(x => { const s = user(x.sellerId), st = userStats(s.id); return `<div class="card card-pad" style="margin-bottom:14px">
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">${avatar(s, 'md')}<div style="flex:1;min-width:180px"><a href="#/user/${s.id}"><b>${esc(s.name)}</b></a> ${s.verification.status === 'verified' ? '<span class="verified">✓</span>' : ''}<div class="small muted">${esc(s.title)} · ${stars(st.rating, st.reviews)}</div></div>
      <div style="text-align:right"><div class="price" style="font-size:1.3rem">${money(x.amount)}</div><div class="small muted">in ${x.days} day${x.days === 1 ? '' : 's'}</div></div></div>
      <p style="margin:12px 0">${esc(x.cover)}</p>
      <div style="display:flex;gap:8px;align-items:center">${statusTag(x.status)} <span class="muted small">${ago(x.created)}</span><span style="flex:1"></span>
      ${isOwner ? `<a class="btn btn-outline btn-sm" href="#/messages/${s.id}">💬 Message</a>${p.status === 'open' ? `<button class="btn btn-primary btn-sm" data-action="award" data-id="${x.id}">Award project</button>` : ''}` : ''}</div></div>`; }).join('') : (isOwner ? empty('📭', 'No proposals yet. They will appear here and in your notifications.') : '')}
  </div>
  <aside><div class="card card-pad side-pkg">
    <div class="small muted">Budget</div><div style="font-size:1.8rem;font-weight:700">${money(p.budgetMin)}–${money(p.budgetMax)}</div>
    <div style="margin:10px 0 18px" class="muted">⏱ ${esc(p.deadline)} · 📨 ${p.proposalCount} proposals</div>
    ${action}
    <button class="btn btn-outline btn-sm btn-block" style="margin-top:10px" data-action="wish" data-kind="project" data-id="${p.id}">${inWishlist('project', p.id) ? '♥ Saved' : '♡ Save for later'}</button>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <div class="small muted">About the client</div>
    <div class="seller-line" style="margin-top:8px">${avatar(owner, 'md')}<div><a href="#/user/${owner.id}"><b>${esc(owner.name)}</b></a>${owner.verification.status === 'verified' ? '<div class="verified">✓ Verified</div>' : ''}<div class="small muted">📍 ${esc(locStr(owner) || owner.country)} · since ${monthYear(owner.joined)}</div></div></div>
  </div></aside></div>`;
};

V.user = ([id]) => {
  const u = user(id); if (!u) return V.notFound();
  const own = me() && me().id === u.id, st = userStats(u.id);
  const svcs = db.services.filter(s => s.sellerId === u.id), rv = db.reviews.filter(r => r.targetUser === u.id);
  const followers = db.follows.filter(f => f.followee === u.id).length;
  return `<div class="container" style="padding-top:36px">
    <div class="profile-card">${avatar(u, 'lg')}
      <div style="flex:1;min-width:240px"><h1 style="margin:0">${esc(u.name)}</h1>${badges(u)}${u.isFreelancer && u.verification.status === 'pending' ? '<span class="tag orange" style="margin-left:6px">⏳ Verification pending</span>' : ''}
        <div><b>${esc(u.title)}</b>${u.isFreelancer && u.category ? ` · <span class="muted">${catById(u.category).ico} ${esc(catName(catById(u.category)))}</span>` : ''}</div><div class="muted small">📍 ${esc(locStr(u) || u.country || 'Location not set')} ${proxTag(u)} · ${u.isFreelancer && priceText(u) ? `<b>${priceText(u)}</b> · ` : ''}Member since ${monthYear(u.joined)} · ${followers} follower${followers === 1 ? '' : 's'}</div>
        ${statPills(u.id)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${own ? '<a class="btn btn-outline" href="#/dashboard/settings">Edit profile</a>' : `<button class="btn ${isFollowing(u.id) ? 'on' : 'btn-primary'}" data-action="follow" data-id="${u.id}">${isFollowing(u.id) ? '✓ ' + t('common.following') : '+ ' + t('common.follow')}</button><a class="btn btn-outline" href="#/messages/${u.id}">💬 ${t('common.message')}</a>`}</div>
    </div>
    <div class="detail" style="padding:30px 0"><div>
      ${u.bio ? `<h2>About</h2><p class="muted">${esc(u.bio)}</p>` : ''}
      ${svcs.length ? `<h2 style="margin-top:20px">Services</h2><div class="grid">${svcs.map(serviceCard).join('')}</div>` : ''}
      <h2 style="margin-top:30px">Reviews ${st.reviews ? `<span class="stars">★ ${st.rating.toFixed(1)}</span>` : ''}</h2>
      ${rv.length ? rv.map(x => { const f = user(x.from); return `<div class="review">${avatar(f, 'sm')}<div><b>${esc(f.name)}</b> <span class="stars">${'★'.repeat(x.rating)}</span> <span class="muted small">${ago(x.date)}</span><p style="margin:4px 0 0">${esc(x.text)}</p></div></div>`; }).join('') : '<p class="muted">No reviews yet.</p>'}
    </div><aside>${u.isFreelancer && u.onboarded && !own ? bookCard(u) : ''}<div class="card card-pad">
      ${u.isFreelancer ? `${u.specialty ? `<h3>Speciality</h3><p style="margin:0 0 20px">${esc(u.specialty)}</p>` : ''}
        ${specialisms(u).length ? `<h3>Specialises in</h3><div class="detail-list" style="margin-bottom:20px">${specialisms(u).map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : ''}
        ${u.tutorSubjects.length ? `<h3>📚 Teaches</h3><div class="detail-list">${u.tutorSubjects.map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div>
          ${u.tutorLevels.length ? `<div class="detail-list" style="margin-bottom:20px">${u.tutorLevels.map(x => `<span class="tag gray">🎓 ${esc(x)}</span>`).join('')}</div>` : '<div style="margin-bottom:20px"></div>'}` : ''}
        ${weeklyText(u.weeklyAvailability) ? `<h3>🕒 Available</h3><p style="margin:0 0 20px">${esc(weeklyText(u.weeklyAvailability))}${u.availableForUrgent ? '<br><span class="small muted">⚡ Takes same-day bookings</span>' : ''}</p>` : ''}
        ${u.servicePerks.length ? `<h3>✨ Included</h3><div class="detail-list" style="margin-bottom:20px">${u.servicePerks.map(x => `<span class="tag green">${esc(x)}</span>`).join('')}</div>` : ''}
        ${u.serviceAreas.length || (catById(u.category).serviceType !== 'REMOTE' && u.city) ? `<h3>📍 Areas covered</h3><div class="detail-list">${u.serviceAreas.map(a => `<span class="tag gray">${esc(a)}</span>`).join('')}</div><p class="small muted" style="margin:6px 0 20px">Travels up to ${u.travelRadiusKm} km${u.city ? ' around ' + esc(u.city) : ''}</p>` : ''}` : ''}
      <h3>Skills</h3><div style="display:flex;gap:6px;flex-wrap:wrap">${u.skills.length ? u.skills.map(s => `<span class="tag">${esc(s)}</span>`).join('') : '<span class="muted">—</span>'}</div>
      <h3 style="margin-top:20px">Verification</h3><p class="${u.verification.status === 'verified' ? 'verified' : 'muted'}">${u.verification.status === 'verified' ? '✓ Identity verified by Worklay' : u.verification.status === 'pending' ? 'Verification under review' : 'Not verified yet'}</p>
    </div></aside></div></div>`;
};

V.postProject = () => {
  if (!me()) return `<div class="container">${empty('🔐', 'Sign in to post a project.', `<button class="btn btn-primary" data-action="login">${t('cta.login')}</button> <button class="btn btn-outline" data-action="signup">${t('cta.signup')}</button>`)}</div>`;
  return `<div class="page-head"><div class="container"><h1>${t('cta.post')}</h1><p>Tell professionals what you need. They'll get in touch with proposals.</p></div></div>
  <div class="container" style="max-width:760px;padding-top:30px"><form class="card card-pad" id="project-form">
    <div class="field"><label>Project title</label><input name="title" required maxlength="100" placeholder="e.g. Design a logo for my bakery"></div>
    <div class="field"><label>Category</label><select name="category">${pickableCats().map(c => `<option value="${c.id}">${c.ico} ${esc(catName(c))}</option>`).join('')}</select></div>
    <div class="field"><label>Description</label><textarea name="description" required minlength="30" placeholder="Describe the task, what you expect to receive and any important details."></textarea></div>
    <div class="row3"><div class="field"><label>Min budget (€)</label><input name="min" type="number" min="5" required></div><div class="field"><label>Max budget (€)</label><input name="max" type="number" min="5" required></div><div class="field"><label>Deadline</label><input name="deadline" required placeholder="e.g. 2 weeks"></div></div>
    <div class="field"><label>Skills (comma separated)</label><input name="skills" placeholder="Logo design, Illustrator"></div>
    <h3>📍 Where is the work?</h3>${locationFields(me().city || '', me().area || '', { required: true })}
    <label class="filter-opt" style="margin-bottom:16px"><input type="checkbox" name="remote"> This can be done remotely (online)</label>
    <button class="btn btn-primary">Publish project</button></form></div>`;
};

V.postService = () => {
  if (!me()) return `<div class="container">${empty('🔐', 'Sign in to offer a service.', `<button class="btn btn-primary" data-action="login">${t('cta.login')}</button> <button class="btn btn-outline" data-action="signup">${t('cta.signup')}</button>`)}</div>`;
  const defaults = [['Basic', 25, [1, 0, 0, 0]], ['Standard', 75, [1, 1, 0, 0]], ['Premium', 150, [1, 1, 1, 1]]];
  return `<div class="page-head"><div class="container"><h1>Offer a service</h1><p>Set your own price in up to three packages.</p></div></div>
  <div class="container" style="max-width:900px;padding-top:30px"><form class="card card-pad" id="service-form">
    <div class="field"><label>Service title</label><input name="title" required maxlength="90" placeholder="I will…"></div>
    <div class="row"><div class="field"><label>Category</label><select name="category">${pickableCats().map(c => `<option value="${c.id}">${c.ico} ${esc(catName(c))}</option>`).join('')}</select></div>
    <div class="field"><label>Cover icon</label><select name="emoji">${['💻', '📱', '🎨', '🖌️', '✍️', '🌍', '📈', '🎬', '🎧', '💼', '🛠️', '📷'].map(e => `<option>${e}</option>`).join('')}</select></div></div>
    <div class="field"><label>Description</label><textarea name="description" required minlength="30"></textarea></div>
    <h3>Packages</h3><div class="table-wrap"><table class="pkg-table"><thead><tr><th></th>${defaults.map(d => `<th>${d[0]}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Price (€)</td>${defaults.map((d, i) => `<td><input name="price${i}" type="number" min="5" value="${d[1]}" required></td>`).join('')}</tr>
      <tr><td>What's included</td>${defaults.map((d, i) => `<td><input name="desc${i}" required placeholder="Short description"></td>`).join('')}</tr>
      <tr><td>Delivery</td>${defaults.map((d, i) => `<td><input name="delivery${i}" value="${3 + i * 4} days" required></td>`).join('')}</tr>
      <tr><td>Revisions</td>${defaults.map((d, i) => `<td><input name="rev${i}" type="number" min="0" value="${1 + i * 2}" required></td>`).join('')}</tr>
      ${FEATURE_NAMES.map((f, fi) => `<tr><td>${f}</td>${defaults.map((d, i) => `<td><input type="checkbox" style="width:auto" name="f${i}_${fi}" ${d[2][fi] ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <button class="btn btn-primary" style="margin-top:18px">Publish service</button></form></div>`;
};

const DASH_TABS = [['overview', '🏠', 'Overview'], ['bookings', '📅', 'Bookings'], ['projects', '📋', 'My projects'], ['orders', '🛒', 'My orders'], ['selling', '💼', 'Selling'], ['proposals', '📨', 'My proposals'], ['earnings', '💶', 'Earnings & payouts'], ['verification', '🛡️', 'Verification'], ['settings', '⚙️', 'Profile settings']];
V.dashboard = ([tab = 'overview']) => {
  const u = me(); if (!u) return `<div class="container">${empty('🔐', 'Sign in to see your dashboard.', `<button class="btn btn-primary" data-action="login">${t('cta.login')}</button> <button class="btn btn-outline" data-action="signup">${t('cta.signup')}</button>`)}</div>`;
  const st = userStats(u.id);
  const myProjects = db.projects.filter(p => p.ownerId === u.id);
  const myOrders = db.orders.filter(o => o.buyerId === u.id);
  const selling = db.orders.filter(o => o.sellerId === u.id);
  const myProps = db.proposals.filter(p => p.sellerId === u.id);
  const orderRow = (o, asSeller) => { const s = service(o.serviceId), other = user(asSeller ? o.buyerId : o.sellerId), reviewed = db.reviews.some(r => r.orderId === o.id);
    let btn = '';
    if (!asSeller && o.status === 'awaiting_payment') btn = `<button class="btn btn-outline btn-sm" data-action="cancel-order" data-id="${o.id}">Cancel</button>`;
    if (asSeller && o.status === 'in_queue') btn = `<button class="btn btn-primary btn-sm" data-action="deliver" data-id="${o.id}">Mark delivered</button>`;
    if (!asSeller && o.status === 'delivered') btn = `<button class="btn btn-primary btn-sm" data-action="accept-order" data-id="${o.id}">Approve & release payment</button>`;
    if (!asSeller && o.status === 'completed' && !reviewed) btn = `<button class="btn btn-outline btn-sm" data-action="review-order" data-id="${o.id}">Leave review</button>`;
    return `<div class="list-item"><div><a href="#/service/${s.id}"><b>${esc(s.title)}</b></a><div class="small muted">${esc(s.packages[o.pkg].name)} · ${asSeller ? 'Buyer' : 'Seller'}: ${esc(other.name)} · ${ago(o.created)}</div>${payNote('order', o.id)}</div>
      <div style="display:flex;gap:10px;align-items:center"><b>${money(o.price)}</b>${statusTag(o.status)}<a class="btn btn-ghost btn-sm" href="#/messages/${other.id}">💬</a>${btn}</div></div>`; };
  let body = '';
  // Getting-started checklist (different steps for freelancers and customers)
  const steps = u.isFreelancer ? [
    [u.bio && u.bio.length >= 20, 'Write a short bio', '#/dashboard/settings'],
    [u.skills.length > 0, 'Add your skills', '#/dashboard/settings'],
    [u.onboarded, 'Finish your service profile (prices and hours)', '#/onboarding'],
    [db.services.some(s => s.sellerId === u.id), 'Offer your first service', '#/post-service'],
    [u.verification.status === 'verified' || u.verification.status === 'pending', 'Verify your identity', '#/dashboard/verification'],
  ] : [
    [!!u.city, 'Set your location', '#/dashboard/settings'],
    [db.projects.some(p => p.ownerId === u.id), 'Post your first project', '#/post-project'],
    [db.follows.some(f => f.follower === u.id), 'Follow a freelancer you like', '#/freelancers'],
    [u.verification.status === 'verified' || u.verification.status === 'pending', 'Verify your identity (optional)', '#/dashboard/verification'],
  ];
  const doneSteps = steps.filter(s => s[0]).length, pct = Math.round(doneSteps / steps.length * 100);
  const checklist = doneSteps === steps.length ? '' : `<div class="card card-pad checklist" style="margin-bottom:24px">
    <div class="list-item" style="padding:0;border:0"><h3 style="margin:0">${u.isFreelancer ? 'Get your first job faster' : 'Get started'}</h3><b style="color:var(--brand)">${pct}%</b></div>
    <div class="progress"><span style="width:${pct}%"></span></div>
    ${steps.map(([ok, label, href]) => `<div class="check-item ${ok ? 'done' : ''}"><span class="c">${ok ? '✓' : ''}</span>${label}${ok ? '' : `<a href="${href}">Start →</a>`}</div>`).join('')}</div>`;
  if (tab === 'overview') body = `<h1>Hi, ${esc(u.name.split(' ')[0])} 👋</h1>
    ${checklist}
    <div class="kpis"><div class="kpi"><div class="muted small">Balance</div><div class="v">${money(u.balance)}</div></div><div class="kpi"><div class="muted small">Active orders</div><div class="v">${st.inQueue}</div></div><div class="kpi"><div class="muted small">Completed jobs</div><div class="v">${st.doneProjects + st.doneServices}</div></div><div class="kpi"><div class="muted small">Rating</div><div class="v">${st.reviews ? '★ ' + st.rating.toFixed(1) : '—'}</div></div></div>
    <div class="profile-card" style="margin-bottom:24px">${avatar(u, 'md')}<div style="flex:1"><b>${esc(u.name)}</b>${badges(u)}${statPills(u.id)}</div></div>
    <div class="card card-pad"><h3>Recent notifications</h3>${db.notifications.filter(n => n.userId === u.id).slice(0, 5).map(notifRow).join('') || '<p class="muted">Nothing yet.</p>'}</div>`;
  if (tab === 'projects') body = `<div class="section-head"><h1 style="margin:0">My projects</h1><a class="btn btn-primary btn-sm" href="#/post-project">+ New project</a></div><div class="card card-pad">${myProjects.length ? myProjects.map(p => { const n = db.proposals.filter(x => x.projectId === p.id).length; return `<div class="list-item"><div><a href="#/project/${p.id}"><b>${esc(p.title)}</b></a><div class="small muted">${n} proposals · ${ago(p.created)}${p.awardedTo ? ' · Awarded to ' + esc(user(p.awardedTo).name) : ''}</div></div><div style="display:flex;gap:10px;align-items:center">${statusTag(p.status)}<a class="btn btn-outline btn-sm" href="#/project/${p.id}">${p.status === 'open' ? 'Review proposals' : 'View'}</a></div></div>`; }).join('') : empty('📋', 'You haven’t posted any projects yet.')}</div>`;
  if (tab === 'orders') body = `<h1>My orders</h1><div class="card card-pad">${myOrders.length ? myOrders.map(o => orderRow(o, false)).join('') : empty('🛒', 'You haven’t bought any services yet.', '<a class="btn btn-primary" href="#/services">Browse services</a>')}</div>`;
  if (tab === 'selling') body = `<div class="section-head"><h1 style="margin:0">Selling</h1><a class="btn btn-primary btn-sm" href="#/post-service">+ New service</a></div>
    <div class="card card-pad" style="margin-bottom:20px"><h3>Orders received</h3>${selling.length ? selling.map(o => orderRow(o, true)).join('') : '<p class="muted">No orders yet.</p>'}</div>
    <div class="card card-pad"><h3>Awarded projects</h3>${db.projects.filter(p => p.awardedTo === u.id).map(p => `<div class="list-item"><div><a href="#/project/${p.id}"><b>${esc(p.title)}</b></a>${payNote('project', p.id)}</div><div style="display:flex;gap:10px;align-items:center"><b>${money(p.awardedAmount)}</b>${statusTag(p.status)}${p.status === 'awarded' && !p.deliveredAt ? `<button class="btn btn-primary btn-sm" data-action="project-deliver" data-id="${p.id}">Work is done</button>` : ''}</div></div>`).join('') || '<p class="muted">None yet.</p>'}</div>
    <h3 style="margin-top:24px">My services</h3><div class="grid">${db.services.filter(s => s.sellerId === u.id).map(serviceCard).join('') || '<p class="muted">You haven’t listed a service yet.</p>'}</div>`;
  if (tab === 'proposals') body = `<h1>My proposals</h1><div class="card card-pad">${myProps.length ? myProps.map(x => { const p = project(x.projectId); return `<div class="list-item"><div><a href="#/project/${p.id}"><b>${esc(p.title)}</b></a><div class="small muted">${money(x.amount)} · ${x.days} days · sent ${ago(x.created)}</div></div>${statusTag(x.status)}</div>`; }).join('') : empty('📨', 'No proposals sent yet.', '<a class="btn btn-primary" href="#/projects">Find projects</a>')}</div>`;
  if (tab === 'earnings' && CARD_PAYMENTS) body = stripeEarnings(u);
  else if (tab === 'earnings') { const pays = db.payouts.filter(p => p.userId === u.id); body = `<h1>Earnings & payouts</h1>
    <div class="kpis"><div class="kpi"><div class="muted small">Available</div><div class="v">${money(u.balance)}</div></div><div class="kpi"><div class="muted small">Pending payouts</div><div class="v">${money(pays.filter(p => p.status === 'pending').reduce((a, p) => a + p.amount, 0))}</div></div><div class="kpi"><div class="muted small">Withdrawn</div><div class="v">${money(pays.filter(p => p.status === 'paid').reduce((a, p) => a + p.amount, 0))}</div></div><div class="kpi"><div class="muted small">Platform fee</div><div class="v">${PLATFORM_FEE * 100}%</div></div></div>
    <div class="card card-pad" style="margin-bottom:20px"><div class="list-item"><div><b>Withdraw your earnings</b><div class="small muted">Payouts via ${PAYOUT_METHODS.join(', ')}. Earnings become available once a buyer confirms the job objectives were met.</div></div><button class="btn btn-primary" data-action="payout" ${u.balance < MIN_PAYOUT ? 'disabled' : ''}>Request payout</button></div></div>
    <div class="card card-pad"><h3>Payout history</h3>${pays.length ? pays.map(p => `<div class="list-item"><div><b>${money(p.amount)}</b> via ${esc(p.method)}<div class="small muted">${esc(p.details)} · ${ago(p.date)}</div></div>${statusTag(p.status)}</div>`).join('') : '<p class="muted">No payouts yet.</p>'}</div>`; }
  if (tab === 'verification') body = `<h1>Identity verification</h1>${verificationPanel(u)}`;
  if (tab === 'bookings') body = bookingsTab(u);
  if (tab === 'settings') body = `<h1>Profile settings</h1>
    ${PHOTO_UPLOADS ? `<div class="card card-pad photo-card">${avatar(u, 'lg')}<div>
      <h3 style="margin:0 0 4px">Profile photo</h3><p class="small muted" style="margin:0 0 12px">A clear photo of your face helps customers trust you. JPG, PNG or WebP, up to ${MAX_PHOTO_MB} MB.</p>
      <label class="btn btn-primary btn-sm">${u.avatarUrl ? 'Change photo' : 'Upload photo'}<input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" hidden></label>
      ${u.avatarUrl ? '<button class="btn btn-ghost btn-sm" type="button" data-action="photo-remove">Remove</button>' : ''}</div></div>` : ''}
    ${u.isFreelancer ? `<div class="card card-pad service-summary"><div><h3 style="margin:0 0 4px">${catById(u.category).ico} Service profile</h3>
      <div class="small muted">${u.onboarded ? `${esc(catName(catById(u.category)))} · ${priceText(u) || 'no price yet'} · ${esc(weeklyText(u.weeklyAvailability) || 'no hours set')}` : 'Not finished yet: customers can’t book you until it is.'}</div></div>
      <a class="btn ${u.onboarded ? 'btn-outline' : 'btn-primary'} btn-sm" href="#/onboarding">${u.onboarded ? 'Edit category, prices & hours' : 'Finish setup'}</a></div>` : ''}
    <form class="card card-pad" id="settings-form">
    <div class="row"><div class="field"><label>Name</label><input name="name" value="${esc(u.name)}" required></div><div class="field"><label>Email</label><input name="email" type="email" value="${esc(u.email)}" required></div></div>
    <div class="field"><label>Headline</label><input name="title" value="${esc(u.title)}"></div>
    <h3 style="margin-top:8px">📍 Your location</h3><p class="small muted" style="margin-top:-4px">Customers search by city and area, so freelancers nearby are shown first.</p>
    ${locationFields(u.city || '', u.area || '', { required: true })}
    <label class="filter-opt" style="margin-bottom:12px"><input type="checkbox" name="isFreelancer" ${u.isFreelancer ? 'checked' : ''}> I offer services as a freelancer (show me in “Find freelancers”)</label>
    <div class="field"><label>Bio</label><textarea name="bio">${esc(u.bio)}</textarea></div>
    <div class="field"><label>Skills (comma separated)</label><input name="skills" value="${esc(u.skills.join(', '))}"></div>
    <button class="btn btn-primary">Save changes</button></form>`;
  return `<div class="container dash"><nav class="dash-nav">${DASH_TABS.map(([id, ico, label]) => `<a href="#/dashboard/${id}" class="${tab === id ? 'active' : ''}">${ico} ${label}</a>`).join('')}</nav><div>${body}</div></div>`;
};

function notifRow(n) {
  const ico = { offer: '📨', job: '💼', message: '💬', system: '🔔', email: '📧' }[n.type] || '🔔';
  return `<a class="notif ${n.read ? '' : 'unread'}" href="${n.link || '#/notifications'}" data-action="read-notif" data-id="${n.id}" style="color:inherit"><span class="ico">${ico}</span><div style="flex:1"><div>${esc(n.text)}</div><div class="small muted">${ago(n.date)}</div></div></a>`;
}
V.notifications = (_, q) => {
  const u = me(); if (!u) return `<div class="container">${empty('🔐', 'Sign in to see notifications.')}</div>`;
  const f = q.f || 'all', types = { offers: ['offer'], jobs: ['job'], messages: ['message'] };
  const list = db.notifications.filter(n => n.userId === u.id && (f === 'all' || types[f].includes(n.type)));
  return `<div class="container" style="max-width:820px;padding-top:36px"><div class="section-head"><h1 style="margin:0">Notifications</h1><button class="btn btn-outline btn-sm" data-action="read-all">Mark all as read</button></div>
    <div class="tabs" style="margin-bottom:16px">${[['all', 'All'], ['offers', 'Offers'], ['jobs', 'Jobs'], ['messages', 'Messages']].map(([k, l]) => `<button class="${f === k ? 'active' : ''}" data-action="nav" data-href="#/notifications?f=${k}">${l}</button>`).join('')}</div>
    <div class="card card-pad">${list.length ? list.map(notifRow).join('') : empty('🔔', 'You’re all caught up.')}</div></div>`;
};

V.messages = ([withId]) => {
  const u = me(); if (!u) return `<div class="container">${empty('🔐', 'Sign in to message buyers and sellers.')}</div>`;
  const mine = db.messages.filter(m => m.from === u.id || m.to === u.id);
  const partners = [...new Set(mine.map(m => m.from === u.id ? m.to : m.from))];
  if (withId && !partners.includes(withId) && user(withId) && withId !== u.id) partners.unshift(withId);
  partners.sort((a, b) => { const la = mine.filter(m => m.from === a || m.to === a).pop(), lb = mine.filter(m => m.from === b || m.to === b).pop(); return (lb ? lb.date : '9') .localeCompare(la ? la.date : '9'); });
  const other = withId && user(withId);
  if (other && mine.some(m => m.from === withId && !m.read)) {
    mine.forEach(m => { if (m.from === withId) m.read = true; });
    api('message/read', { with: withId }).then(refresh).then(renderHeader).catch(() => {});
  }
  const thread = other ? mine.filter(m => m.from === withId || m.to === withId) : [];
  return `<div class="container"><div class="chat ${other ? '' : 'no-thread'}">
    <div class="chat-list">${partners.length ? partners.map(pid => { const p = user(pid), last = mine.filter(m => m.from === pid || m.to === pid).pop(), unread = mine.some(m => m.from === pid && !m.read);
      return `<a href="#/messages/${pid}" class="${pid === withId ? 'active' : ''}">${avatar(p)}<div style="min-width:0;flex:1"><b>${esc(p.name)}</b>${unread ? ' <span class="tag orange">new</span>' : ''}<div class="small muted truncate">${last ? esc(last.text) : 'Start a conversation'}</div></div></a>`; }).join('') : '<p class="muted" style="padding:20px">No conversations yet. Message a seller from their profile or service page.</p>'}</div>
    <div class="chat-main">${other ? `<div class="chat-head"><a href="#/messages" class="btn btn-ghost btn-sm">←</a>${avatar(other)}<div><a href="#/user/${other.id}"><b>${esc(other.name)}</b></a><div class="small muted">${esc(other.title)}</div></div></div>
      <div class="chat-body" id="chat-body">${thread.length ? thread.map(m => `<div class="bubble ${m.from === u.id ? 'me' : ''}">${esc(m.text)}<time>${ago(m.date)}</time></div>`).join('') : '<p class="muted" style="text-align:center">Say hello 👋 Ask about the work, scope or a proposal.</p>'}</div>
      <form class="chat-input" id="chat-form" data-to="${other.id}"><input name="text" placeholder="Write a message…" autocomplete="off" required><button class="btn btn-primary">${t('common.send')}</button></form>` : empty('💬', 'Select a conversation.')}</div>
  </div></div>`;
};

V.wishlist = () => {
  const u = me(); if (!u) return `<div class="container">${empty('🔐', 'Sign in to use your wishlist.')}</div>`;
  const w = db.wishlist.filter(x => x.userId === u.id);
  const svcs = w.filter(x => x.kind === 'service').map(x => service(x.id)).filter(Boolean), projs = w.filter(x => x.kind === 'project').map(x => project(x.id)).filter(Boolean);
  return `<div class="container" style="padding-top:36px"><h1>Wishlist</h1><p class="muted">Projects and services you saved for later.</p>
    ${!svcs.length && !projs.length ? empty('♡', 'Nothing saved yet. Tap the heart on any service or project.') : ''}
    ${svcs.length ? `<h2>Services</h2><div class="grid">${svcs.map(serviceCard).join('')}</div>` : ''}
    ${projs.length ? `<h2 style="margin-top:30px">Projects</h2><div class="grid">${projs.map(projectCard).join('')}</div>` : ''}</div>`;
};

V.admin = ([sub] = []) => {
  const u = me(); if (!u || u.role !== 'admin') return `<div class="container">${empty('⛔', 'Admins only. Log in with an administrator account.', '<button class="btn btn-primary" data-action="login">Log in</button>')}</div>`;
  if (sub === 'verifications') return adminVerifications();
  if (sub === 'categories') return adminCategories();
  const pending = db.pendingDocuments || [], pays = db.payouts.filter(p => p.status === 'pending');
  const gmv = (db.adminStats || {}).gmv || 0;
  return `<div class="container" style="padding-top:36px"><h1>Admin panel</h1>
    <div class="kpis"><div class="kpi"><div class="muted small">Users</div><div class="v">${db.users.length}</div></div><div class="kpi"><div class="muted small">Services</div><div class="v">${db.services.length}</div></div><div class="kpi"><div class="muted small">Projects</div><div class="v">${db.projects.length}</div></div><div class="kpi"><div class="muted small">Gross volume</div><div class="v">${money(gmv)}</div></div></div>
    <div class="card card-pad" style="margin-bottom:20px"><div class="list-item" style="padding:0;border:0"><div><h3 style="margin:0">Verification queue</h3><div class="small muted">${pending.length} document${pending.length === 1 ? '' : 's'} from ${new Set(pending.map(d => d.userId)).size} freelancer${new Set(pending.map(d => d.userId)).size === 1 ? '' : 's'} waiting for review</div></div><a class="btn btn-primary btn-sm" href="#/admin/verifications">Open queue</a></div></div>
    <div class="card card-pad" style="margin-bottom:20px"><div class="list-item" style="padding:0;border:0"><div><h3 style="margin:0">Categories</h3><div class="small muted">${CATEGORIES.filter(c => c.status === 'NEW').length} new from freelancers, waiting for a look</div></div><a class="btn btn-primary btn-sm" href="#/admin/categories">Open categories</a></div></div>
    ${CARD_PAYMENTS ? `<div class="card card-pad" style="margin-bottom:20px"><h3>Card payments (${(db.payments || []).length})</h3><p class="small muted" style="margin-top:-4px">Held payments can be released or refunded here. Reported problems come first. Work marked as done pays the freelancer automatically after ${APPROVAL_DAYS} days unless someone reports a problem.</p>
      ${(db.payments || []).length ? [...db.payments].sort((a, b) => (b.problem && b.status === 'paid' ? 1 : 0) - (a.problem && a.status === 'paid' ? 1 : 0)).slice(0, 50).map(p => `<div class="list-item"><div><b>#${p.id}</b> ${esc(user(p.buyerId).name)} → ${esc(user(p.sellerId).name)}<div class="small muted">${p.kind === 'order' ? 'Service order' : p.kind === 'booking' ? 'Booking' : 'Project'} · fee ${money(p.fee)} · ${ago(p.created)}</div>${p.problem ? `<div class="small" style="margin-top:4px"><span class="tag orange">Problem</span> ${esc((user(p.problem.by) || {}).name || '')}: ${esc(p.problem.reason)}<div>${proofLinks(p)}${p.status === 'paid' ? ` ${p.problem.proofs.length ? '·' : 'No proof yet ·'} <b${new Date(p.problem.decideBy) < new Date() ? ' style="color:#d92d50"' : ''}>${new Date(p.problem.decideBy) < new Date() ? 'Overdue: decide now' : 'Decide by ' + fmtTime(p.problem.decideBy)}</b>` : ''}</div></div>` : ''}</div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>${money(p.amount)}</b>${statusTag(p.status)}${p.status === 'paid' ? `<button class="btn btn-outline btn-sm" data-action="pay-refund" data-id="${p.id}">Refund client</button><button class="btn btn-primary btn-sm" data-action="pay-release" data-id="${p.id}">Pay freelancer</button>` : ''}</div></div>`).join('') : '<p class="muted">No payments yet.</p>'}</div>` : ''}
    <div class="card card-pad" style="margin-bottom:20px"><h3>Payout requests (${pays.length})</h3>
      ${pays.length ? pays.map(p => `<div class="list-item"><div><b>${esc(user(p.userId).name)}</b> — ${money(p.amount)} via ${esc(p.method)}<div class="small muted">${esc(p.details)} · ${ago(p.date)}</div></div><button class="btn btn-primary btn-sm" data-action="mark-paid" data-id="${p.id}">Mark as paid</button></div>`).join('') : '<p class="muted">No pending payouts.</p>'}</div>
    <div class="card card-pad"><h3>Contact form messages (${db.contacts.length})</h3>${db.contacts.length ? db.contacts.map(c => `<div class="list-item"><div><b>${esc(c.name)}</b> <span class="muted small">${esc(c.email)} · ${ago(c.date)}</span><p style="margin:4px 0 0">${esc(c.message)}</p></div></div>`).join('') : '<p class="muted">No messages.</p>'}</div></div>`;
};

V.about = () => `<div class="page-head"><div class="container"><h1>About Worklay</h1><p>A marketplace built on trust, fair prices and simple tools.</p></div></div>
  <div class="prose"><p>Worklay is a platform that connects people who need help with tasks and projects with freelancers and professionals looking for work. Post what you need and receive proposals, or choose a ready-made service package at a clear price.</p>
  <p>The client pays up front and we hold the money until the work is done. When the client approves the work, the freelancer is paid automatically. Worklay keeps ${Math.round(PLATFORM_FEE * 100)}% of completed jobs; posting projects and creating an account are free. See our <a href="#/terms">Terms of Service</a>.</p></div>
  <div class="container about-grid">
    <div class="step"><div class="step-icon" style="background:#e3f8ee">🛡️</div><h3>Verified members</h3><p class="muted">Admins check passports, driving licenses and ID cards before awarding the verified badge.</p></div>
    <div class="step"><div class="step-icon" style="background:#eef1ff">💬</div><h3>Built-in messaging</h3><p class="muted">Discuss scope and proposals directly, then review and rate completed work.</p></div>
    <div class="step"><div class="step-icon" style="background:#fff0e7">🌍</div><h3>Multilingual</h3><p class="muted">Worklay picks your language based on your location, and you can switch any time.</p></div>
  </div>`;

V.contact = () => `<div class="page-head"><div class="container"><h1>Contact us</h1><p>Questions, feedback or partnership ideas — we'd love to hear from you.</p></div></div>
  <div class="container detail"><form class="card card-pad" id="contact-form">
    <div class="row"><div class="field"><label>Name</label><input name="name" required value="${me() ? esc(me().name) : ''}"></div><div class="field"><label>Email</label><input name="email" type="email" required value="${me() ? esc(me().email) : ''}"></div></div>
    <div class="field"><label>Subject</label><select name="subject"><option>General question</option><option>Payments & payouts</option><option>Verification</option><option>Report a problem</option></select></div>
    <div class="field"><label>Message</label><textarea name="message" required></textarea></div><p class="small muted">We use your details only to reply to you. See our <a href="#/privacy">Privacy Policy</a>.</p><button class="btn btn-primary">Send message</button></form>
    <aside><div class="card card-pad"><h3>Get in touch</h3><p class="muted">📧 support@worklay.com</p><p class="muted">🕘 Mon–Fri, 9:00–18:00 (EET)</p><p class="muted">We usually reply within one business day.</p></div></aside></div>`;

const BLOG_UI = {
  en: { title: 'Worklay Blog', lead: 'News and tips for customers and freelancers.', none: 'No posts yet.', back: 'Blog', find: 'Find a freelancer', work: 'Create your profile' },
  et: { title: 'Worklay blogi', lead: 'Uudised ja nõuanded klientidele ja vabakutselistele.', none: 'Postitusi veel pole.', back: 'Blogi', find: 'Leia vabakutseline', work: 'Loo oma profiil' },
  ru: { title: 'Блог Worklay', lead: 'Новости и советы для клиентов и фрилансеров.', none: 'Записей пока нет.', back: 'Блог', find: 'Найти фрилансера', work: 'Создать профиль' },
};
V.blog = () => { const b = BLOG_UI[lang] || BLOG_UI.en;
  return `<div class="page-head"><div class="container"><h1>${b.title}</h1><p>${b.lead}</p></div></div>
  <div class="container" style="padding-top:36px">${db.posts.length ? `<div class="grid">${db.posts.map(p => { const x = localPost(p, lang); return `<a class="card svc-card" href="#/blog/${p.id}"><div class="blog-cover" style="background:${esc(p.color)}">${esc(p.emoji)}</div><div class="svc-body"><span class="small muted">${monthYear(p.created)}</span><span class="svc-title">${esc(x.title)}</span><p class="muted small" style="margin:0">${esc(x.excerpt)}</p></div></a>`; }).join('')}</div>` : empty('📝', b.none)}</div>`; };
V.blogPost = ([id]) => { const p = db.posts.find(x => x.id === id); if (!p) return V.notFound();
  const x = localPost(p, lang), b = BLOG_UI[lang] || BLOG_UI.en;
  return `<article class="prose blog-post"><a href="#/blog">← ${b.back}</a><div class="blog-cover" style="background:${esc(p.color)};border-radius:16px;margin:16px 0">${esc(p.emoji)}</div><span class="muted small">${monthYear(p.created)}</span><h1>${esc(x.title)}</h1>${blogHtml(x.body, esc)}
    <p class="blog-cta"><a class="btn btn-primary" href="#/freelancers">${b.find}</a>${me() ? '' : `<button class="btn btn-outline" data-action="signup">${b.work}</button>`}</p></article>`; };

V.notFound = () => `<div class="container">${empty('🧭', 'Page not found.', '<a class="btn btn-primary" href="#/">Go home</a>')}</div>`;

/* ---------- freelancer onboarding: #/onboarding?step=1..4 ---------- */
let OB = null; // the profile being edited, kept between steps
function obInit(u) {
  if (OB && OB.userId === u.id) return;
  OB = { userId: u.id, category: u.category || '', subcategories: [...u.subcategories], customSubcategories: [...(u.customSubcategories || [])], skills: [...u.skills], newCat: false, title: u.title || '', specialty: u.specialty || '',
    city: u.city || '', area: u.area || '', serviceAreas: [...u.serviceAreas], travelRadiusKm: u.travelRadiusKm || 15,
    tutorSubjects: [...u.tutorSubjects], tutorLevels: [...u.tutorLevels], pricingType: u.pricingType || 'HOURLY', priceAmount: u.priceAmount || '',
    priceUnitLabel: u.priceUnitLabel || '', servicePerks: [...u.servicePerks], weeklyAvailability: JSON.parse(JSON.stringify(u.weeklyAvailability || {})),
    slotDurationMinutes: u.slotDurationMinutes || 60, availableForUrgent: !!u.availableForUrgent };
}
const obCat = () => CATEGORIES.find(c => c.id === OB.category) || null;
const obSteps = () => [['1', 'Service'], ['2', 'Pricing'], ['3', 'Availability'], ...(obCat()?.requiresVerification ? [['4', 'Verification']] : [])];
// Copy the visible step's inputs into OB.
function obRead() {
  const form = $('#ob-form'); if (!form || !OB || form.tagName !== 'FORM') return; // step 4 has no fields of its own
  const f = new FormData(form), step = form.dataset.step;
  if (step === '1') {
    OB.category = f.get('category') || OB.category; OB.subcategories = f.getAll('subcategories'); OB.customSubcategories = splitList(f.get('customSubcategories')); OB.skills = splitList(f.get('skills')); OB.title = (f.get('title') || '').trim(); OB.specialty = (f.get('specialty') || '').trim();
    if (form.querySelector('[name="city"]')) { OB.city = f.get('city') || ''; OB.area = f.get('area') || ''; OB.travelRadiusKm = +f.get('travelRadiusKm') || 15; OB.serviceAreas = [...new Set([...f.getAll('areas'), OB.area].filter(Boolean))]; }
    if (form.querySelector('[name="subjectsOther"]')) { OB.tutorSubjects = [...f.getAll('subjects'), ...splitList(f.get('subjectsOther'))]; OB.tutorLevels = [...f.getAll('levels'), ...splitList(f.get('levelsOther'))]; }
  }
  if (step === '2') { OB.pricingType = f.get('pricingType') || 'HOURLY'; OB.priceAmount = f.get('priceAmount'); OB.priceUnitLabel = (f.get('priceUnitLabel') || '').trim(); OB.servicePerks = [...f.getAll('perks'), ...splitList(f.get('perksOther'))]; }
  if (step === '3') {
    const w = {};
    for (const [d] of WEEKDAYS) {
      if (!f.get('on_' + d)) continue;
      const starts = f.getAll(d + '_start'), ends = f.getAll(d + '_end');
      w[d] = starts.map((st, i) => ({ start: st, end: ends[i] })).filter(x => x.start && x.end);
      if (!w[d].length) w[d] = [{ start: '09:00', end: '17:00' }];
    }
    OB.weeklyAvailability = w; OB.slotDurationMinutes = +f.get('slotDurationMinutes') || 60; OB.availableForUrgent = !!f.get('availableForUrgent');
  }
}
// Save a draft and move between steps.
function obGo(dir) {
  obRead();
  const steps = obSteps().map(x => +x[0]), cur = +($('#ob-form')?.dataset.step || 1), next = steps[steps.indexOf(cur) + dir];
  if (dir > 0 && cur === 1 && !OB.category) return toast('Please choose a category.', 'error');
  act('onboarding/save', { ...OB }, null, { after: () => { go('#/onboarding?step=' + (next || cur)); render(); window.scrollTo(0, 0); } });
}
const timeOptions = sel => { let o = ''; for (let m = 5 * 60; m <= 23 * 60 + 30; m += 30) o += `<option ${hhmm(m) === sel ? 'selected' : ''}>${hhmm(m)}</option>`; return o; };
V.onboarding = (_, q) => {
  const u = me(); if (!u) return `<div class="container">${empty('🔐', 'Sign in to set up your service profile.', '<button class="btn btn-primary" data-action="login">Log in</button>')}</div>`;
  obInit(u);
  const steps = obSteps(), step = steps.some(([n]) => n === q.step) ? q.step : '1', last = steps[steps.length - 1][0] === step, cat = obCat();
  if (q.welcome === 'google') setTimeout(() => toast('Account created with Google! Now set up your service profile.', 'success'), 50);
  let body = '';
  if (step === '1') body = `<h2>What do you offer?</h2>
    <div class="cat-pick">${pickableCats(OB.category).map(c => `<label class="cat-opt"><input type="radio" name="category" value="${c.id}" data-rerender ${OB.category === c.id ? 'checked' : ''}><span class="ico" style="background:${c.color}">${c.ico}</span><span><b>${esc(catName(c))}</b><small>${SERVICE_TYPES[c.serviceType] || ''}${c.requiresVerification ? ' · 🛡️ ID check' : ''}</small></span></label>`).join('')}
      <button type="button" class="cat-opt cat-new" data-action="ob-newcat" aria-expanded="${!!OB.newCat}"><span class="ico" style="background:#eef1ff">➕</span><span><b>Create my own category</b><small>Nothing here fits what you do?</small></span></button></div>
    ${OB.newCat ? `<div class="card card-pad new-cat"><h3 style="margin:0 0 10px">Create your own category</h3>
      <div class="row"><div class="field"><label>Category name</label><input name="newCatName" maxlength="40" placeholder="e.g. Bicycle repair"></div>
        <div class="field"><label>Where do you work?</label><select name="newCatType"><option value="ON_SITE">At the client’s place</option><option value="HYBRID">Online or at the client’s place</option><option value="REMOTE">Online only</option></select></div></div>
      <div class="field"><label>Icon</label><div class="icon-pick">${CATEGORY_ICONS.map((x, i) => `<label><input type="radio" name="newCatIcon" value="${x}" aria-label="Icon ${i + 1}" ${i ? '' : 'checked'}><span>${x}</span></label>`).join('')}</div></div>
      <p class="small muted">You can list yourself in it straight away. If you work at clients’ places, we check your ID before anyone can book you. Worklay may rename the category or merge it with a similar one.</p>
      <button type="button" class="btn btn-primary btn-sm" data-action="ob-createcat">Create category</button> <button type="button" class="btn btn-ghost btn-sm" data-action="ob-newcat">Cancel</button></div>` : ''}
    ${cat && cat.subcategories.length ? `<div class="field"><label>Which services exactly?</label><div class="chks">${cat.subcategories.map(x => chk('subcategories', x.id, esc(catName(x)), OB.subcategories.includes(x.id))).join('')}</div></div>` : ''}
    ${cat ? `<div class="row"><div class="field"><label>Your own specialisations</label><input name="customSubcategories" value="${esc(OB.customSubcategories.join(', '))}" placeholder="e.g. Vintage furniture, Smart home setup"></div>
      <div class="field"><label>Skills</label><input name="skills" value="${esc(OB.skills.join(', '))}" placeholder="e.g. Photoshop, First aid, Driving licence B"></div></div>
      <p class="small muted" style="margin-top:-6px">Separate with commas. Clients can search for all of these.</p>` : ''}
    <div class="row"><div class="field"><label>Headline</label><input name="title" maxlength="60" value="${esc(OB.title)}" placeholder="e.g. Wedding photographer"></div>
      <div class="field"><label>Your speciality</label><input name="specialty" maxlength="80" value="${esc(OB.specialty)}" placeholder="e.g. Natural-light portraits, Evening babysitting"></div></div>
    ${cat && cat.id === 'tutoring' ? `<div class="field"><label>Subjects you teach</label><div class="chks">${TUTOR_SUBJECTS.map(x => chk('subjects', x, esc(x), OB.tutorSubjects.includes(x))).join('')}</div>
        <input name="subjectsOther" style="margin-top:8px" value="${esc(OB.tutorSubjects.filter(x => !TUTOR_SUBJECTS.includes(x)).join(', '))}" placeholder="Other subjects, comma separated"></div>
      <div class="field"><label>Classes / levels</label><div class="chks">${TUTOR_LEVELS.map(x => chk('levels', x, esc(x), OB.tutorLevels.includes(x))).join('')}</div>
        <input name="levelsOther" style="margin-top:8px" value="${esc(OB.tutorLevels.filter(x => !TUTOR_LEVELS.includes(x)).join(', '))}" placeholder="Other classes or levels, comma separated"></div>` : ''}
    ${cat && cat.serviceType !== 'REMOTE' ? `<h3 style="margin-top:8px">📍 Where do you work?</h3>${locationFields(OB.city, OB.area, { required: true })}
      <div class="field"><label>How far will you travel?</label><select name="travelRadiusKm">${[5, 10, 15, 25, 50, 100].map(k => `<option value="${k}" ${OB.travelRadiusKm === k ? 'selected' : ''}>Up to ${k} km</option>`).join('')}</select></div>
      <div class="field"><label>Areas you cover</label><div class="chks" data-role="cover-areas">${areaChecks(OB.city, OB.serviceAreas)}</div><p class="small muted" style="margin:6px 0 0">Customers searching these areas will find you.</p></div>` : ''}`;
  if (step === '2') body = `<h2>How do you charge?</h2>
    <div class="row3">${Object.entries(PRICING).map(([k, [label, unit]]) => `<label class="choice"><input type="radio" name="pricingType" value="${k}" data-rerender ${OB.pricingType === k ? 'checked' : ''}> ${label}<small class="muted" style="display:block">${unit}</small></label>`).join('')}</div>
    <div class="row" style="margin-top:14px"><div class="field"><label>Price (€)</label><input name="priceAmount" type="number" min="1" step="0.5" value="${esc(OB.priceAmount)}" placeholder="${OB.pricingType === 'HOURLY' ? '25' : '150'}"></div>
      <div class="field"><label>Shown as</label><input name="priceUnitLabel" maxlength="40" value="${esc(OB.priceUnitLabel)}" placeholder="${PRICING[OB.pricingType][1]}${OB.pricingType === 'PER_EVENT' ? ', e.g. per 2-hour shoot' : ''}"></div></div>
    <p class="small muted" style="margin-top:-6px">${OB.pricingType === 'HOURLY' ? 'Clients book in multiples of your slot length and pay for the hours they book.' : 'Clients book one slot and pay this fixed price.'} Worklay keeps ${Math.round(PLATFORM_FEE * 100)}%.</p>
    ${cat ? `<div class="field"><label>What’s included?</label><div class="chks">${[...new Set([...(cat.perks || []), ...OB.servicePerks])].map(x => chk('perks', x, esc(x), OB.servicePerks.includes(x))).join('')}</div>
      <input name="perksOther" style="margin-top:8px" placeholder="Something else? Comma separated"></div>` : ''}`;
  if (step === '3') body = `<h2>When can clients book you?</h2>
    <div class="preset-row"><span class="small muted">Quick fill:</span>${[['weekdays', 'Weekdays 9–17'], ['evenings', 'Weekday evenings'], ['weekends', 'Weekends 10–16'], ['clear', 'Clear all']].map(([k, l]) => `<button type="button" class="btn btn-ghost btn-sm" data-action="ob-preset" data-preset="${k}">${l}</button>`).join('')}</div>
    <div class="week">${WEEKDAYS.map(([d, l]) => { const ws = OB.weeklyAvailability[d] || []; return `<div class="day-row ${ws.length ? 'on' : ''}">
      <label class="day-toggle"><input type="checkbox" name="on_${d}" value="1" data-rerender ${ws.length ? 'checked' : ''}><span>${l}</span></label>
      <div class="windows">${ws.length ? ws.map((w, i) => `<span class="window"><select name="${d}_start">${timeOptions(w.start)}</select>–<select name="${d}_end">${timeOptions(w.end)}</select><button type="button" class="icon-x" data-action="ob-remove-window" data-day="${d}" data-i="${i}" aria-label="Remove">×</button></span>`).join('') + `<button type="button" class="btn btn-ghost btn-sm" data-action="ob-add-window" data-day="${d}">+ hours</button>` : '<span class="muted small">Not available</span>'}</div></div>`; }).join('')}</div>
    <div class="row" style="margin-top:16px"><div class="field"><label>Booking slot length</label><select name="slotDurationMinutes">${SLOT_MINUTES.map(m => `<option value="${m}" ${OB.slotDurationMinutes === m ? 'selected' : ''}>${durationText(m)}</option>`).join('')}</select>
      <p class="small muted" style="margin:6px 0 0">${OB.pricingType === 'HOURLY' ? 'Clients can book one or more slots in a row.' : 'Each booking takes one slot, e.g. a 4-hour shoot.'}</p></div>
      <div class="field"><label>&nbsp;</label><label class="filter-opt"><input type="checkbox" name="availableForUrgent" value="1" ${OB.availableForUrgent ? 'checked' : ''}> ⚡ Available for same-day urgent bookings</label></div></div>`;
  if (step === '4') body = `<h2>Verify your identity</h2><p class="muted">Clients trust ${esc(catName(cat).toLowerCase())} providers with their homes, families or journeys, so Worklay checks your documents before anyone can book you. You can finish setting up now; bookings open as soon as we’ve approved them.</p>${verificationPanel(u, cat)}`;
  return `<div class="container onboarding"><div class="ob-head"><h1>Set up your service profile</h1>
    <ol class="stepper">${steps.map(([n, l], i) => `<li class="${n === step ? 'active' : steps.findIndex(x => x[0] === step) > i ? 'done' : ''}"><button type="button" data-action="ob-step" data-step="${n}"><span>${i + 1}</span>${l}</button></li>`).join('')}</ol></div>
    ${step === '4' /* holds its own upload forms, and forms can't be nested */ ? `<div class="card card-pad" id="ob-form" data-step="4">${body}</div>` : `<form class="card card-pad" id="ob-form" data-step="${step}">${body}</form>`}
    <div class="ob-nav">${step !== '1' ? '<button class="btn btn-outline" data-action="ob-back">← Back</button>' : '<span></span>'}
      ${last ? '<button class="btn btn-primary" data-action="ob-finish">Finish and publish</button>' : '<button class="btn btn-primary" data-action="ob-next">Save and continue →</button>'}</div></div>`;
};

/* ---------- verification documents (dashboard tab and onboarding step 4) ---------- */
function verificationPanel(u, cat = catById(u.category)) {
  const required = cat && cat.requiredDocuments && cat.requiredDocuments.length ? cat.requiredDocuments : ['GOVERNMENT_ID'];
  const optional = cat && ['childcare', 'cleaning'].includes(cat.id) ? ['BACKGROUND_CHECK'] : [];
  const latest = {}; for (const d of db.myDocuments || []) if (!latest[d.type]) latest[d.type] = d;
  const st = u.verification.status;
  const head = st === 'verified' ? '<p class="verified" style="font-size:1.05rem">✓ You are verified. The badge is shown on your profile.</p>'
    : st === 'pending' ? '<p><span class="tag">⏳ Under review</span> We usually check documents within one business day.</p>'
    : st === 'rejected' ? `<p class="tag orange">A document was not approved${u.verification.reason ? ': ' + esc(u.verification.reason) : ''}. Please upload it again.</p>` : '';
  const row = (type, isOptional) => { const d = latest[type], [label, hint] = DOC_INFO[type];
    return `<div class="doc-row"><div><b>${label}</b>${isOptional ? ' <span class="small muted">(optional)</span>' : ''}<div class="small muted">${hint}</div>
      ${d ? `<div class="small" style="margin-top:4px">${{ PENDING: '<span class="tag">⏳ Pending review</span>', APPROVED: '<span class="tag green">✓ Approved</span>', REJECTED: '<span class="tag orange">Not approved</span>' }[d.status]} <span class="muted">uploaded ${ago(d.uploaded)}${d.status === 'REJECTED' && d.reason ? ' · ' + esc(d.reason) : ''}</span></div>` : ''}</div>
      ${!d || d.status === 'REJECTED' ? `<form class="doc-form" id="doc-form-${type}"><input type="hidden" name="documentType" value="${type}"><input type="file" name="doc" accept="image/jpeg,image/png,image/webp,application/pdf" required><button class="btn btn-primary btn-sm">Upload</button></form>` : ''}</div>`; };
  return `<div class="card card-pad">${head}${required.map(t => row(t, false)).join('')}${optional.map(t => row(t, true)).join('')}
    <p class="small muted" style="margin-bottom:0">JPG, PNG, WebP or PDF, up to 5 MB. Only Worklay admins can see your documents, and each file is deleted as soon as it has been reviewed. <a href="#/privacy">Privacy Policy</a></p></div>`;
}

/* ---------- booking card on the public profile ---------- */
let BK = { fid: null };
function bookCard(u) {
  const cat = catById(u.category), today = localNow().date;
  if (BK.fid !== u.id) BK = { fid: u.id, date: '', duration: 0, start: '', slots: [], options: [], price: 0, reason: '' };
  if (!BK.date) { for (let i = 1; i <= 21 && !BK.date; i++) if ((u.weeklyAvailability[weekdayKey(addDays(today, i))] || []).length) BK.date = addDays(today, i); BK.date = BK.date || addDays(today, 1); }
  const blocked = cat.requiresVerification && u.verification.status !== 'verified';
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, u.availableForUrgent ? i : i + 1));
  return `<div class="card card-pad book-card" id="book-card" data-id="${u.id}">
    <h3 style="margin:0 0 2px">📅 Book ${esc(u.name.split(' ')[0])}</h3><div class="price-line">${priceText(u) ? `<b>${priceText(u)}</b>` : '<span class="muted">Price on request</span>'}</div>
    ${blocked ? `<p class="notice">🛡️ Bookings open once Worklay has verified ${esc(u.name.split(' ')[0])}’s documents${u.verification.status === 'pending' ? ' (under review)' : ''}. You can still send a message.</p>` : `
    <div class="day-pills">${days.map(d => { const off = !(u.weeklyAvailability[weekdayKey(d)] || []).length; return `<button type="button" class="day-pill ${d === BK.date ? 'on' : ''}" data-action="bk-day" data-date="${d}" ${off ? 'disabled' : ''}><small>${fmtDate(d, { weekday: 'short' })}</small><b>${fmtDate(d, { day: 'numeric' })}</b><small>${fmtDate(d, { month: 'short' })}</small></button>`; }).join('')}</div>
    <div class="row"><div class="field"><label>Date</label><input type="date" id="bk-date" value="${BK.date}" min="${u.availableForUrgent ? today : addDays(today, 1)}" max="${addDays(today, 90)}"></div>
      <div class="field" id="bk-duration-field"></div></div>
    <label class="small" style="font-weight:600">Free times</label><div class="slot-pills" id="bk-slots"><span class="small muted">Loading…</span></div>
    ${cat.serviceType !== 'REMOTE' ? '<div class="field"><label>Address</label><input id="bk-address" maxlength="200" placeholder="Street, house, city" autocomplete="street-address"></div>' : ''}
    <div class="field"><label>Notes <span class="muted small">(optional)</span></label><textarea id="bk-notes" maxlength="1000" rows="2" placeholder="Anything they should know?"></textarea></div>
    <div id="bk-summary"></div><p class="auth-err" id="bk-err" role="alert" style="color:#d92d50;margin:0 0 8px;font-size:.9rem"></p>
    <button class="btn btn-primary btn-block" data-action="bk-request" id="bk-request" disabled>Request booking</button>
    <p class="small muted" style="margin:8px 0 0;text-align:center">${CARD_PAYMENTS ? '🔒 You pay by card now. Worklay holds the money and releases it after the job; you’re refunded if it isn’t confirmed.' : 'The freelancer confirms your request.'}</p>`}
  </div>`;
}
async function loadSlots() {
  if (!$('#book-card') || !BK.fid || !$('#bk-slots')) return;
  document.querySelectorAll('.day-pill').forEach(b => b.classList.toggle('on', b.dataset.date === BK.date));
  if ($('#bk-date')) $('#bk-date').value = BK.date;
  $('#bk-slots').innerHTML = '<span class="small muted">Loading…</span>';
  try {
    const r = await api(`slots&freelancer=${encodeURIComponent(BK.fid)}&date=${encodeURIComponent(BK.date)}&duration=${BK.duration || ''}`);
    Object.assign(BK, { slots: r.slots, options: r.durationOptions, duration: r.duration, price: r.price, reason: r.reason });
  } catch (err) { Object.assign(BK, { slots: [], reason: 'error' }); }
  drawBooking();
}
function drawBooking() {
  const reasons = { 'day-off': 'Not working on this day. Try another date.', 'fully-booked': 'Fully booked on this day. Try another date.', 'no-same-day': 'Doesn’t take same-day bookings.', past: 'This date has passed.', 'too-far': 'Bookings open up to 90 days ahead.', error: 'Couldn’t load free times. Please try again.' };
  if ($('#bk-duration-field')) $('#bk-duration-field').innerHTML = BK.options.length > 1 ? `<label>Duration</label><select id="bk-duration">${BK.options.map(m => `<option value="${m}" ${m === BK.duration ? 'selected' : ''}>${durationText(m)}</option>`).join('')}</select>` : BK.options.length ? `<label>Duration</label><div class="muted" style="padding:12px 0">${durationText(BK.options[0])}</div>` : '';
  $('#bk-slots').innerHTML = BK.slots.length ? BK.slots.map(s => `<button type="button" class="slot-pill ${s.start === BK.start ? 'on' : ''}" data-action="bk-slot" data-start="${s.start}">${s.start}</button>`).join('') : `<span class="small muted">${reasons[BK.reason] || 'No free times.'}</span>`;
  const u = user(BK.fid), hourly = u.pricingType === 'HOURLY', slot = BK.slots.find(s => s.start === BK.start);
  $('#bk-summary').innerHTML = slot ? `<div class="price-break"><div class="list-item"><span>${fmtDate(BK.date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${slot.start}–${slot.end}</span></div>
    <div class="list-item"><span>${hourly ? `${money(u.priceAmount)} × ${durationText(BK.duration)}` : esc(u.priceUnitLabel || PRICING[u.pricingType][1])}</span><span>${money(BK.price)}</span></div>
    <div class="list-item total"><b>Total</b><b>${money(BK.price)}</b></div></div>` : '';
  $('#bk-request').disabled = !slot;
  $('#bk-request').textContent = slot ? `Request booking · ${money(BK.price)}` : 'Pick a time';
}

/* ---------- held payments: what both sides see, and problem reports ---------- */
const payFor = (kind, id) => (db.payments || []).find(p => p.kind === kind && p[kind + 'Id'] === id && !['pending', 'cancelled'].includes(p.status));
function payNote(kind, id) {
  const p = payFor(kind, id), u = me(); if (!p || !u) return '';
  const seller = p.sellerId === u.id, party = seller || p.buyerId === u.id;
  const text = { paid: `🔒 ${money(p.amount)} is held by Worklay until the work is done${seller ? `. You’ll receive ${money(p.net)}` : ''}.`, released: seller ? `${money(p.net)} was released to you and is waiting for <a href="#/dashboard/earnings">payout setup</a> or the transfer.` : 'Payment released to the freelancer.',
    transferring: 'Payment is being sent to the freelancer.', transferred: seller ? `✓ ${money(p.net)} was sent to your Stripe account.` : '✓ Payment sent to the freelancer.', refunding: 'The payment is being refunded.', refunded: 'The payment was refunded.' }[p.status] || '';
  const done = p.status === 'paid' && p.autoRelease && !p.problem && deliveredAt(kind, id);
  const by = done && fmtTime(+new Date(done) + APPROVAL_DAYS * 864e5);
  const due = !done ? '' : seller ? ` You’re paid automatically on ${by} unless the client reports a problem.` : ` Approve it or report a problem by ${by}; after that the freelancer is paid automatically.`;
  const problem = p.status !== 'paid' || !party ? '' : p.problem
    ? `<div style="margin-top:4px"><span class="tag orange">Problem reported</span> Worklay decides by ${fmtTime(p.problem.decideBy)}. ${proofLinks(p)} <button type="button" class="link-btn" data-action="pay-proof" data-id="${p.id}">Add proof</button></div>`
    : ` <button type="button" class="link-btn" data-action="pay-problem" data-id="${p.id}">Report a problem</button>`;
  return text ? `<div class="small muted pay-note">${text}${due}${problem}</div>` : '';
}
const deliveredAt = (kind, id) => ((kind === 'order' ? db.orders : kind === 'project' ? db.projects : db.bookings).find(x => x.id === id) || {}).deliveredAt;
const fmtTime = d => new Date(d).toLocaleString(numberLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Tallinn' });
const proofLinks = p => p.problem.proofs.map((x, i) => x.hasFile ? `<a href="${apiUrl('payment/proof-file', '&id=' + x.id)}" target="_blank" rel="noopener">📎 ${x.by === p.buyerId ? 'Client' : 'Freelancer'} proof ${i + 1}</a>` : `<span>📎 proof ${i + 1} (deleted)</span>`).join(' · ');
const PROOF_INPUT = required => `<div class="field"><label>${required ? 'Proof: photo, screenshot or PDF (max 5 MB)' : 'Proof, if you have it: photo, screenshot or PDF (max 5 MB)'}</label><input type="file" name="doc" accept="image/jpeg,image/png,image/webp,application/pdf" ${required ? 'required' : ''}></div>`;
function openProblem(id) {
  const p = (db.payments || []).find(x => x.id === id), client = p && p.buyerId === me().id;
  modal(`<h2>Report a problem</h2><p class="muted">The money stays held and the automatic payment stops. Worklay looks at what happened and decides within ${APPROVAL_DAYS} days. ${client ? 'If your proof shows the work wasn’t done as agreed, you’re refunded.' : ''} The other side can see what you send.</p>
    <form id="problem-form" data-id="${esc(id)}"><div class="field"><label>What went wrong?</label><textarea name="reason" required minlength="10" maxlength="1000" placeholder="e.g. The work wasn’t finished, or the other person doesn’t reply."></textarea></div>
    ${PROOF_INPUT(client)}
    <p class="auth-err" role="alert" style="color:#d92d50;margin:0 0 8px;font-size:.9rem"></p><button class="btn btn-primary btn-block">Send to Worklay</button></form>`);
}
function openProof(id) {
  modal(`<h2>Add proof</h2><p class="muted">Worklay and the other side can see the file. You can add up to 5 files.</p>
    <form id="proof-form" data-id="${esc(id)}">${PROOF_INPUT(true)}
    <p class="auth-err" role="alert" style="color:#d92d50;margin:0 0 8px;font-size:.9rem"></p><button class="btn btn-primary btn-block">Add proof</button></form>`);
}

/* ---------- bookings dashboard tab ---------- */
function bookingsTab(u) {
  const received = db.bookings.filter(b => b.freelancerId === u.id), mine = db.bookings.filter(b => b.clientId === u.id);
  const order = b => ({ PENDING: 0, AWAITING_PAYMENT: 1, CONFIRMED: 2, COMPLETED: 3, CANCELLED: 4 }[b.status] ?? 5);
  const sorted = list => [...list].sort((a, b) => order(a) - order(b) || (order(a) < 3 ? (a.date + a.start).localeCompare(b.date + b.start) : (b.date + b.start).localeCompare(a.date + a.start)));
  const row = (b, asFreelancer) => { const other = user(asFreelancer ? b.clientId : b.freelancerId), cat = catById(b.categoryId);
    let btns = '';
    if (asFreelancer && b.status === 'PENDING') btns = `<button class="btn btn-primary btn-sm" data-action="bk-confirm" data-id="${b.id}">Confirm</button><button class="btn btn-outline btn-sm" data-action="bk-decline" data-id="${b.id}">Decline</button>`;
    else if (asFreelancer && b.status === 'CONFIRMED' && bookingStarted(b)) btns = b.deliveredAt ? '<span class="small muted">Waiting for the client’s approval</span>' : `<button class="btn btn-primary btn-sm" data-action="bk-deliver" data-id="${b.id}">Work is done</button>`;
    else if (asFreelancer && b.status === 'CONFIRMED') btns = `<button class="btn btn-ghost btn-sm" data-action="bk-cancel" data-id="${b.id}">Cancel</button>`;
    else if (!asFreelancer && b.status === 'CONFIRMED' && bookingStarted(b)) btns = `<button class="btn btn-primary btn-sm" data-action="bk-complete" data-id="${b.id}">${b.deliveredAt ? 'Approve & release payment' : 'Mark as completed'}</button>`;
    else if (!asFreelancer && ['AWAITING_PAYMENT', 'PENDING', 'CONFIRMED'].includes(b.status)) btns = `<button class="btn btn-ghost btn-sm" data-action="bk-cancel" data-id="${b.id}">Cancel</button>`;
    return `<div class="booking-row"><div class="when"><b>${fmtDate(b.date, { day: 'numeric' })}</b><small>${fmtDate(b.date, { month: 'short' })}</small></div>
      <div style="flex:1;min-width:200px"><div><b>${b.start}–${b.end}</b> · ${fmtDate(b.date, { weekday: 'long' })} · ${cat.ico} ${esc(catName(cat))}</div>
        <div class="small"><a href="#/user/${other.id}">${avatar(other, 'sm')} ${esc(other.name)}</a> · 📍 ${esc(b.address)}</div>
        ${b.notes ? `<div class="small muted">“${esc(b.notes)}”</div>` : ''}${b.status === 'CANCELLED' && b.cancelReason ? `<div class="small muted">Reason: ${esc(b.cancelReason)}</div>` : ''}${payNote('booking', b.id)}</div>
      <div class="booking-side"><b>${money(b.totalPrice)}</b>${statusTag(b.status)}<div class="booking-btns"><a class="btn btn-ghost btn-sm" href="#/messages/${other.id}" aria-label="Message">💬</a>${btns}</div></div></div>`; };
  return `<h1>Bookings</h1>
    ${u.isFreelancer ? `<div class="card card-pad" style="margin-bottom:20px"><h3>Requests from clients ${received.filter(b => b.status === 'PENDING').length ? `<span class="tag orange">${received.filter(b => b.status === 'PENDING').length} to confirm</span>` : ''}</h3>
      ${received.length ? sorted(received).map(b => row(b, true)).join('') : `<p class="muted">No bookings yet.${u.onboarded ? '' : ' <a href="#/onboarding">Finish your service profile</a> so clients can book you.'}</p>`}</div>` : ''}
    <div class="card card-pad"><h3>Your bookings</h3>${mine.length ? sorted(mine).map(b => row(b, false)).join('') : '<p class="muted">You haven’t booked anyone yet. <a href="#/freelancers">Find a freelancer</a></p>'}</div>`;
}

/* ---------- admin: #/admin/verifications ---------- */
function adminVerifications() {
  const docs = db.pendingDocuments || [], byUser = {};
  docs.forEach(d => (byUser[d.userId] = byUser[d.userId] || []).push(d));
  return `<div class="container" style="padding-top:36px"><a href="#/admin">← Admin panel</a><h1>Verification queue</h1>
    <p class="muted">Check that each document is genuine, readable and matches the freelancer’s name. Files are deleted from the server as soon as you approve or reject them.</p>
    ${Object.keys(byUser).length ? Object.entries(byUser).map(([uid, list]) => { const x = user(uid), cat = catById(x.category);
      return `<div class="card card-pad" style="margin-bottom:16px"><div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">${avatar(x)}<div><a href="#/user/${x.id}"><b>${esc(x.name)}</b></a> <span class="muted small">${esc(x.email || '')}</span>
        <div class="small muted">${cat.ico} ${esc(catName(cat))}${cat.requiresVerification ? ` · needs ${cat.requiredDocuments.map(t => DOC_INFO[t][0]).join(' + ')}` : ' · optional verification'}</div></div></div>
        ${list.map(d => `<div class="list-item"><div><b>${DOC_INFO[d.type][0]}</b><div class="small muted">${esc(d.fileName || 'file')} · ${esc(d.mime)} · uploaded ${ago(d.uploaded)}</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${d.hasFile ? `<a class="btn btn-ghost btn-sm" href="${apiUrl('admin/verification-file', '&id=' + d.id)}" target="_blank" rel="noopener">View file</a>` : '<span class="small muted">(file missing)</span>'}
            <button class="btn btn-outline btn-sm" data-action="doc-reject" data-id="${d.id}">Reject</button><button class="btn btn-primary btn-sm" data-action="doc-approve" data-id="${d.id}">Approve</button></div></div>`).join('')}</div>`; }).join('')
      : `<div class="card card-pad">${empty('✅', 'No documents waiting for review.')}</div>`}</div>`;
}

/* ---------- admin: #/admin/categories ---------- */
function adminCategories() {
  const count = id => db.users.filter(x => x.isFreelancer && x.category === id).length;
  const row = c => `<form class="card card-pad cat-row" data-id="${c.id}" style="margin-bottom:12px"><div style="display:flex;gap:12px;align-items:center;margin-bottom:10px"><span class="ico" style="background:${c.color}">${c.ico}</span>
      <div><b>${esc(c.name)}</b> ${c.status === 'NEW' ? '<span class="tag orange">New</span>' : ''}<div class="small muted">${SERVICE_TYPES[c.serviceType] || ''} · ${count(c.id)} freelancer${count(c.id) === 1 ? '' : 's'}${c.createdBy ? ` · created by <a href="#/user/${c.createdBy}">${esc((user(c.createdBy) || {}).name || 'a freelancer')}</a>` : ''}</div></div></div>
    <div class="row3"><div class="field"><label>English</label><input name="name" required maxlength="40" value="${esc(c.name)}"></div><div class="field"><label>Estonian</label><input name="nameEt" required maxlength="40" value="${esc(c.nameEt)}"></div><div class="field"><label>Russian</label><input name="nameRu" required maxlength="40" value="${esc(c.nameRu)}"></div></div>
    <label class="filter-opt"><input type="checkbox" name="requiresVerification" ${c.requiresVerification ? 'checked' : ''}> 🛡️ Freelancers must be ID-checked before they can be booked</label>
    <div class="cat-actions"><button class="btn btn-primary btn-sm">${c.status === 'NEW' ? 'Approve' : 'Save'}</button>
      ${c.id.startsWith('own-') ? `<select name="mergeTarget" aria-label="Merge into"><option value="">Merge into…</option>${CATEGORIES.filter(x => x.id !== c.id).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><button type="button" class="btn btn-outline btn-sm" data-action="cat-merge" data-id="${c.id}">Merge</button>` : ''}</div></form>`;
  const fresh = CATEGORIES.filter(c => c.status === 'NEW'), rest = CATEGORIES.filter(c => c.status !== 'NEW');
  return `<div class="container" style="padding-top:36px"><a href="#/admin">← Admin panel</a><h1>Categories</h1>
    <p class="muted">New categories from freelancers already work in search. Approve them to show them on the home page and to search engines, or merge them into a similar one.</p>
    <h2>New (${fresh.length})</h2>${fresh.map(row).join('') || '<p class="muted">Nothing new.</p>'}<h2 style="margin-top:24px">All categories</h2>${rest.map(row).join('')}</div>`;
}

/* ---------- router ---------- */
const ROUTES = { '': V.home, freelancers: V.freelancers, services: V.services, projects: V.projects, service: V.service, project: V.project, user: V.user, 'post-project': V.postProject, 'post-service': V.postService, dashboard: V.dashboard, onboarding: V.onboarding, notifications: V.notifications, messages: V.messages, wishlist: V.wishlist, admin: V.admin, about: V.about, contact: V.contact, terms: () => termsPage(lang, { fee: PLATFORM_FEE, days: APPROVAL_DAYS }), privacy: () => privacyPage(lang), cookies: () => cookiesPage(lang), blog: (a, q) => a.length ? V.blogPost(a, q) : V.blog() };
// The page address: a real path (/freelancers?cat=x), or a hash for old links (/#/freelancers).
const currentPath = () => (location.hash.startsWith('#/') ? location.hash.slice(1) : location.pathname + location.search);
const toPath = h => '/' + String(h).replace(/^#?\/?/, '');
function parseHash() {
  const [path, qs] = currentPath().replace(/^\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  return { name: parts[0] || '', args: parts.slice(1), q: Object.fromEntries(new URLSearchParams(qs || '')) };
}
function render() {
  if (!db) return;
  const { name, args, q } = parseHash();
  const view = ROUTES[name] || V.notFound;
  renderHeader();
  const u = me(), bar = u && u.termsAccepted === false && name !== 'terms' ? '<div class="container"><div class="notice terms-bar">Our Terms of Service were updated. <button type="button" class="link-btn" data-action="terms-review">Review and accept</button></div></div>' : '';
  try { $('#app').innerHTML = bar + view(args, q); if ($('#book-card')) loadSlots(); }
  catch (err) {
    console.error(err);
    $('#app').innerHTML = `<div class="container">${empty('⚠️', 'Something went wrong showing this page.', '<a class="btn btn-primary" href="#/">Go to homepage</a>')}</div>`;
  }
  document.querySelectorAll('.mainnav a').forEach(a => { const on = a.getAttribute('href') === '/' + name; a.classList.toggle('active', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  const h1 = $('#app h1');
  document.title = name && h1 ? `${h1.textContent.trim()} | Worklay` : 'Worklay – Find work. Get work done.';
  $('#mainnav').classList.remove('open'); $('#burger').setAttribute('aria-expanded', 'false');
  const cb = $('#chat-body'); if (cb) cb.scrollTop = cb.scrollHeight;
}
let lastRoute = '';
// After moving to another page: scroll to the top and put keyboard/screen reader focus on the content.
function afterRouteChange() {
  const r = currentPath().split('?')[0];
  if (r !== lastRoute) { window.scrollTo(0, 0); const main = $('#app'); main && main.focus({ preventScroll: true }); }
  lastRoute = r;
}
window.addEventListener('hashchange', () => { render(); afterRouteChange(); });
window.addEventListener('popstate', () => { render(); afterRouteChange(); });
function navigate(h, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', toPath(h));
  render(); afterRouteChange();
}
// In-app links: open without reloading the page. Modified clicks (new tab etc.) keep browser behaviour.
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank' || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (href.startsWith('#/')) { e.preventDefault(); navigate(href); return; }
  if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/api')) {
    const first = href.slice(1).split(/[/?#]/)[0];
    if (first === '' || ROUTES[first]) { e.preventDefault(); navigate(href); }
  }
});

/* ---------- actions (event delegation) ---------- */
const go = h => navigate(h);
function setQuery(patch) {
  const { name, args, q } = parseHash(); const nq = { ...q, ...patch };
  Object.keys(nq).forEach(k => (nq[k] === '' || nq[k] == null) && delete nq[k]);
  const qs = new URLSearchParams(nq).toString();
  go('#/' + [name, ...args].join('/') + (qs ? '?' + qs : ''));
}
const A = {
  'toggle-language': () => {
    const picker = $('#language-picker');
    const button = picker.querySelector('.language-toggle');
    const open = picker.classList.toggle('open');
    button.setAttribute('aria-expanded', String(open));
  },
  'set-language': el => {
    if (!LANGS[el.dataset.lang]) return;
    if (lang === el.dataset.lang) {
      $('#language-picker').classList.remove('open');
      $('#language-picker .language-toggle').setAttribute('aria-expanded', 'false');
      return;
    }
    lang = el.dataset.lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    document.documentElement.lang = lang;
    render();
    renderCookieBanner();
  },
  'cookie-settings': () => openCookieSettings(),
  reload: () => location.reload(),
  'cookie-accept': () => saveConsent(Object.fromEntries(OPTIONAL_CATEGORIES.map(k => [k, true]))),
  'cookie-reject': () => saveConsent({}),
  login: () => openLogin(),
  'google-auth': () => {
    const picked = document.querySelector('#signup-form input[name="intent"]:checked');
    location.href = API_URL.replace(/\?.*$/, '') + '/auth/google?intent=' + (picked ? picked.value : 'hire');
  },
  logout: () => act('auth/logout', {}, 'You have been logged out.', { after: () => { go('#/'); render(); } }),
  signup: el => openAuth('signup', el && el.dataset.intent),
  'toggle-filters': () => { const f = $('.filters'); if (f) { f.classList.toggle('open'); if (f.classList.contains('open')) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
  'clear-filter': el => { const { key, val } = el.dataset, q = parseHash().q;
    if (key === 'sub') setQuery({ sub: (q.sub || '').split(',').filter(c => c && c !== val).join(',') });
    else if (key === 'cat') { const drop = (catById(val).subcategories || []).map(x => x.id); setQuery({ cat: (q.cat || '').split(',').filter(c => c && c !== val).join(','), sub: (q.sub || '').split(',').filter(x => x && !drop.includes(x)).join(',') }); }
    else if (key === 'city') setQuery({ city: '', area: '' });
    else setQuery({ [key]: '' }); },
  'toggle-pw': el => { const i = el.parentElement.querySelector('input'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? t('auth.hide') : t('auth.show'); },
  'near-me': () => { const u = me(); setQuery({ city: u.city, area: u.area }); },
  widen: () => setQuery({ area: '' }),
  'auth-tab': el => openAuth(el.dataset.mode),
  'close-modal': () => closeModal(),
  'close-modal-bg': (el, e) => { if (e.target === el) closeModal(); },
  'toggle-dd': () => { const dd = $('#userdd'), open = dd.classList.toggle('open'); dd.querySelector('[data-action="toggle-dd"]').setAttribute('aria-expanded', String(open)); },
  chip: el => go('#/services?q=' + encodeURIComponent(el.dataset.q)),
  nav: el => go(el.dataset.href),
  'pkg-tab': el => setQuery({ pkg: el.dataset.idx }),
  wish: el => { if (!requireLogin()) return; const { kind, id } = el.dataset;
    act('wishlist/toggle', { kind, id }, null, { after: r => { render(); toast(r.saved ? 'Saved to wishlist ♥' : 'Removed from wishlist'); } }); },
  follow: el => { if (!requireLogin()) return; const id = el.dataset.id;
    act('follow/toggle', { id }, null, { after: r => { render(); if (r.following) toast(`You'll be notified when ${esc(user(id).name)} posts new services.`); } }); },
  propose: el => { if (requireLogin()) openProposal(el.dataset.id); },
  order: el => { if (requireLogin()) openOrder(el.dataset.id, +el.dataset.idx); },
  'confirm-order': el => act('order/create', { serviceId: el.dataset.id, pkg: +el.dataset.idx, requirements: ($('#req') || {}).value || '' },
    null, { after: r => {
      if (r.checkoutUrl) { location.href = r.checkoutUrl; return; } // Stripe Checkout
      closeModal(); go('#/dashboard/orders'); render(); toast('Order placed ✓ The seller has been notified.', 'success'); } }),
  'cancel-order': el => { if (confirm('Cancel this unpaid order?')) act('order/cancel', { id: el.dataset.id }, 'Order cancelled.'); },
  'photo-remove': () => { if (confirm('Remove your profile photo?')) act('profile/photo-remove', {}, 'Photo removed.'); },
  'stripe-connect': () => act('payments/connect', {}, null, { after: r => { location.href = r.url; } }),
  'stripe-dashboard': () => act('payments/dashboard', {}, null, { after: r => { window.open(r.url, '_blank', 'noopener'); render(); } }),
  deliver: el => act('order/deliver', { id: el.dataset.id }, 'Marked as delivered. The buyer has been notified.'),
  'accept-order': el => { const o = db.orders.find(x => x.id === el.dataset.id);
    act('order/accept', { id: o.id }, 'Payment released to the seller.', { after: () => { render(); openReview(o.sellerId, { orderId: o.id }); } }); },
  'review-order': el => { const o = db.orders.find(x => x.id === el.dataset.id); openReview(o.sellerId, { orderId: o.id }); },
  award: el => { const pr = db.proposals.find(x => x.id === el.dataset.id);
    if (!confirm(CARD_PAYMENTS
      ? `Award this project to ${user(pr.sellerId).name}?\n\nYou'll pay ${money(pr.amount)} by card now. Worklay holds the money and releases it only after you confirm the work is done.`
      : `Award this project to ${user(pr.sellerId).name} for ${money(pr.amount)}?`)) return;
    act('proposal/award', { id: pr.id }, null, { after: r => {
      if (r.checkoutUrl) { location.href = r.checkoutUrl; return; } // Stripe Checkout
      render(); toast(`Project awarded to ${esc(user(pr.sellerId).name)} ✓`, 'success'); } }); },
  'complete-project': el => { const p = project(el.dataset.id); if (!confirm('Confirm the job objectives are met and release payment?')) return;
    act('project/complete', { id: p.id }, 'Payment released.', { after: () => { render(); openReview(p.awardedTo, { projectId: p.id }); } }); },
  payout: () => openPayout(),
  'read-notif': el => { const n = db.notifications.find(x => x.id === el.dataset.id); if (n && !n.read) { n.read = true; api('notification/read', { id: n.id }).catch(() => {}); } },
  'read-all': () => act('notification/read-all', {}),
  // onboarding
  'ob-next': () => obGo(+1),
  'ob-back': () => obGo(-1),
  'ob-newcat': () => { obRead(); OB.newCat = !OB.newCat; render(); const i = $('[name="newCatName"]'); i && i.focus(); },
  'ob-createcat': () => { obRead(); const f = new FormData($('#ob-form'));
    act('category/create', { name: f.get('newCatName'), serviceType: f.get('newCatType'), icon: f.get('newCatIcon') }, null, { after: r => {
      OB.newCat = false; if (OB.category !== r.id) OB.subcategories = []; OB.category = r.id;
      if (r.subcategoryId && !OB.subcategories.includes(r.subcategoryId)) OB.subcategories.push(r.subcategoryId);
      render(); toast(r.existing ? `That already exists in “${esc(r.name)}”, so we selected it for you.` : 'Category created ✓', 'success'); } }); },
  'terms-review': () => openTerms(),
  'terms-accept': () => act('terms/accept', { version: TERMS_VERSION }, null, { after: () => { closeModal(); render(); toast('Thank you. You can continue now.', 'success'); } }),
  // work done, problems
  'project-deliver': el => { if (confirm('Is the work finished? The client will be asked to check it and release the payment.')) act('project/deliver', { id: el.dataset.id }, 'Marked as done ✓ The client has been asked to approve.'); },
  'bk-deliver': el => { if (confirm('Is the work finished? The client will be asked to approve it.')) act('booking/deliver', { id: el.dataset.id }, 'Marked as done ✓ The client has been asked to approve.'); },
  'pay-problem': el => openProblem(el.dataset.id),
  'pay-proof': el => openProof(el.dataset.id),
  'pay-release': el => { const note = prompt('Pay the freelancer? Optional note for both sides:', ''); if (note !== null) act('admin/payment-resolve', { id: el.dataset.id, action: 'release', note }, 'Payment released to the freelancer.'); },
  'pay-refund': el => { const p = db.payments.find(x => x.id === el.dataset.id), proof = p && p.problem && p.problem.proofs.some(x => x.by === p.buyerId); const note = prompt(`${proof ? '' : 'Note: the client hasn’t sent any proof.\n\n'}Refund the client? Optional note for both sides:`, ''); if (note !== null) act('admin/payment-resolve', { id: el.dataset.id, action: 'refund', note }, 'Client refunded.'); },
  // admin categories
  'cat-merge': el => { const sel = el.closest('.cat-row').querySelector('[name="mergeTarget"]'); if (!sel.value) return toast('Choose a category to merge into.', 'error');
    if (confirm('Move everyone to the chosen category and remove this one?')) act('admin/category', { id: el.dataset.id, action: 'merge', target: sel.value }, 'Categories merged.'); },
  'ob-step': el => { obRead(); go('#/onboarding?step=' + el.dataset.step); },
  'ob-finish': () => { obRead(); act('onboarding/save', { ...OB, complete: true }, null, { after: () => { const id = me().id; OB = null; go('#/user/' + id); render(); toast('Your service profile is live ✓', 'success'); } }); },
  'ob-preset': el => { obRead(); const P = { weekdays: [['MON', 'TUE', 'WED', 'THU', 'FRI'], '09:00', '17:00'], evenings: [['MON', 'TUE', 'WED', 'THU', 'FRI'], '17:00', '21:00'], weekends: [['SAT', 'SUN'], '10:00', '16:00'] }[el.dataset.preset];
    if (!P) OB.weeklyAvailability = {}; else P[0].forEach(d => { OB.weeklyAvailability[d] = [{ start: P[1], end: P[2] }]; }); render(); },
  'ob-add-window': el => { obRead(); const ws = OB.weeklyAvailability[el.dataset.day] || (OB.weeklyAvailability[el.dataset.day] = []); const from = ws.length ? Math.min(minutesOf(ws[ws.length - 1].end) + 60, 22 * 60) : 9 * 60; ws.push({ start: hhmm(from), end: hhmm(Math.min(from + 120, 23 * 60 + 30)) }); render(); },
  'ob-remove-window': el => { obRead(); const ws = OB.weeklyAvailability[el.dataset.day] || []; ws.splice(+el.dataset.i, 1); if (!ws.length) delete OB.weeklyAvailability[el.dataset.day]; render(); },
  // booking card
  'bk-day': el => { BK.date = el.dataset.date; BK.start = ''; loadSlots(); },
  'bk-slot': el => { BK.start = el.dataset.start; drawBooking(); },
  'bk-request': () => { if (!requireLogin()) return; const addr = $('#bk-address'), notes = $('#bk-notes');
    act('booking/create', { freelancerId: BK.fid, date: BK.date, start: BK.start, duration: BK.duration, address: addr ? addr.value : '', notes: notes ? notes.value : '' }, null, { errEl: $('#bk-err'), after: r => {
      if (r.checkoutUrl) { location.href = r.checkoutUrl; return; }
      go('#/dashboard/bookings'); render(); toast('Booking requested ✓ The freelancer will confirm it.', 'success'); } }); },
  // bookings dashboard
  'bk-confirm': el => act('booking/respond', { id: el.dataset.id, accept: true }, 'Booking confirmed ✓'),
  'bk-decline': el => { const reason = prompt('Why are you declining? (shown to the client)', 'Sorry, I can’t make it at that time.'); if (reason === null) return; act('booking/respond', { id: el.dataset.id, accept: false, reason }, 'Booking declined'); },
  'bk-cancel': el => { const reason = prompt('Cancel this booking? Optionally tell the other person why:', ''); if (reason === null) return; act('booking/cancel', { id: el.dataset.id, reason }, null, { after: r => { render(); toast(r.refunded ? 'Booking cancelled and refunded.' : 'Booking cancelled.'); } }); },
  'bk-complete': el => { if (confirm('Was the work done? This releases the payment to the freelancer.')) act('booking/complete', { id: el.dataset.id }, 'Thanks! Payment released to the freelancer.'); },
  // admin verification review
  'doc-approve': el => act('admin/verification-review', { id: el.dataset.id, ok: true }, null, { after: r => { render(); toast(r.status === 'verified' ? 'Approved: freelancer is now verified ✓' : 'Document approved', 'success'); } }),
  'doc-reject': el => { const reason = prompt('Reason for rejection (shown to the freelancer):', 'The photo is unreadable. Please upload a clearer one.'); if (reason === null) return; act('admin/verification-review', { id: el.dataset.id, ok: false, reason }, 'Document rejected'); },
  'mark-paid': el => { if (!confirm('Have you sent this payout? The user will be notified.')) return; act('admin/payout-paid', { id: el.dataset.id }, 'Marked as paid'); },
};
// Remember which button started an action so act() can show a spinner on it (capture phase runs first).
document.addEventListener('click', e => { lastBtn = e.target.closest('button'); }, true);
document.addEventListener('submit', e => { lastBtn = e.submitter || e.target.querySelector('button:not([type=button])'); }, true);
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!e.target.closest('#userdd')) { const dd = $('#userdd'); dd && dd.classList.remove('open'); }
  if (!e.target.closest('#language-picker')) {
    const picker = $('#language-picker');
    if (picker) {
      picker.classList.remove('open');
      picker.querySelector('.language-toggle').setAttribute('aria-expanded', 'false');
    }
  }
  if (!el || !A[el.dataset.action]) return;
  if (el.dataset.action === 'close-modal-bg') { if (e.target === el) closeModal(); return; }
  if (el.tagName === 'BUTTON' || el.getAttribute('href') === '#') e.preventDefault();
  A[el.dataset.action](el, e);
});
async function uploadPhoto(input) {
  const file = input.files && input.files[0]; if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast('Please choose a JPG, PNG or WebP image.', 'error'); input.value = ''; return; }
  if (file.size > MAX_PHOTO_MB * 1024 * 1024) { toast(`The photo is too large (max ${MAX_PHOTO_MB} MB).`, 'error'); input.value = ''; return; }
  const label = input.closest('label'); label && label.classList.add('loading');
  const fd = new FormData(); fd.append('photo', file);
  try {
    const r = await fetch(API_URL.replace(/\?.*$/, '') + '/profile/photo', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Worklay': '1' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'The upload failed. Please try again.');
    await refresh(); render(); toast('Profile photo updated ✓', 'success');
  } catch (err) { toast(esc(err.message), 'error'); label && label.classList.remove('loading'); input.value = ''; }
}
document.addEventListener('change', e => {
  if (e.target.id === 'photo-input') { uploadPhoto(e.target); return; }
  if (e.target.closest('#ob-form') && e.target.dataset.rerender !== undefined) { obRead(); render(); return; }
  if (e.target.id === 'bk-duration') { BK.duration = +e.target.value; BK.start = ''; loadSlots(); return; }
  if (e.target.id === 'bk-date') { BK.date = e.target.value; BK.start = ''; loadSlots(); return; }
  if (e.target.dataset.action === 'sort') setQuery({ sort: e.target.value });
  if (e.target.dataset.role === 'city') { // refill the area list (and "areas you cover") for the chosen city
    const cover = e.target.form && e.target.form.querySelector('[data-role="cover-areas"]');
    if (cover) cover.innerHTML = areaChecks(e.target.value);
    const areaSel = e.target.form && e.target.form.querySelector('[data-role="area"]'); if (!areaSel) return;
    const areas = CITIES[e.target.value] || [];
    areaSel.innerHTML = `<option value="">${areaSel.dataset.any ? t('loc.allAreas') : t('loc.selectArea')}</option>` + areas.map(a => `<option>${a}</option>`).join('');
    areaSel.disabled = !areas.length;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const picker = $('#language-picker'), dd = $('#userdd'), nav = $('#mainnav');
    if (picker && picker.classList.contains('open')) { picker.classList.remove('open'); const t = picker.querySelector('.language-toggle'); t.setAttribute('aria-expanded', 'false'); t.focus(); return; }
    if (dd && dd.classList.contains('open')) { dd.classList.remove('open'); const t = dd.querySelector('[data-action="toggle-dd"]'); t.setAttribute('aria-expanded', 'false'); t.focus(); return; }
    if (nav && nav.classList.contains('open')) { nav.classList.remove('open'); const b = $('#burger'); b.setAttribute('aria-expanded', 'false'); b.focus(); return; }
    closeModal();
    return;
  }
  const box = $('#modal-root .modal');
  if (e.key === 'Tab' && box) { // keep focus inside the open dialog
    const items = [...box.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    return;
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { // move between menu items
    const menu = e.target.closest && e.target.closest('#language-picker.open, #userdd.open');
    if (!menu) return;
    const items = [...menu.querySelectorAll('.language-option, .dropdown-menu a, .dropdown-menu button')];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  }
});

/* ---------- Accessibility touch-ups for every piece of HTML the app inserts ----------
   - in-app links get real addresses (/freelancers instead of #/freelancers)
   - a form label without "for" is tied to the input, select or textarea in the same field */
let labelSeq = 0;
function enhance(root) {
  if (!root.querySelectorAll) return;
  root.querySelectorAll('a[href^="#/"]').forEach(a => a.setAttribute('href', toPath(a.getAttribute('href'))));
  root.querySelectorAll('.field > label:not([for]), .field label:not([for]):first-child').forEach(l => {
    if (l.querySelector('input,select,textarea')) return; // wraps its control already
    const field = l.closest('.field'); if (!field) return;
    const ctl = [...field.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea')].find(c => !c.closest('label'))
      || field.querySelector('input[type=checkbox],input[type=radio]');
    if (!ctl) return;
    if (ctl.type === 'checkbox' || ctl.type === 'radio') { // a group of choices: name the group instead
      const group = l.nextElementSibling; if (!group) return;
      l.id = l.id || `lbl-${++labelSeq}`; group.setAttribute('role', 'group'); group.setAttribute('aria-labelledby', l.id); return;
    }
    ctl.id = ctl.id || `fld-${++labelSeq}`; l.htmlFor = ctl.id;
  });
}
new MutationObserver(list => {
  const roots = new Set();
  for (const m of list) if ([...m.addedNodes].some(n => n.nodeType === 1)) roots.add(m.target);
  roots.forEach(enhance);
}).observe(document.body, { childList: true, subtree: true });
enhance(document.body); // the page shell drawn before this script loaded

/* ---------- forms ---------- */
function sendProof(form, f, route, done) {
  const errEl = form.querySelector('.auth-err'), file = f.get('doc');
  if (file && file.size > 5 * 1024 * 1024) { errEl.textContent = 'The file is too large (max 5 MB).'; return; }
  if (!file || !file.size) f.delete('doc');
  f.set('id', form.dataset.id);
  act(route, f, null, { errEl, after: () => { closeModal(); render(); toast(done, 'success'); } });
}
document.addEventListener('submit', e => {
  const form = e.target, f = new FormData(form), id = form.id;
  if (id === 'ob-form') { e.preventDefault(); return; } // onboarding steps are saved with their own buttons
  if (form.classList.contains('doc-form')) { e.preventDefault(); const file = f.get('doc');
    if (!file || !file.size) return toast('Please choose a file.', 'error');
    if (file.size > 5 * 1024 * 1024) return toast('The file is too large (max 5 MB).', 'error');
    act('verification/document', f, 'Document uploaded ✓ We’ll review it soon.'); return; }
  if (form.classList.contains('cat-row')) { e.preventDefault(); act('admin/category', { id: form.dataset.id, action: 'save', name: f.get('name'), nameEt: f.get('nameEt'), nameRu: f.get('nameRu'), requiresVerification: !!f.get('requiresVerification') }, 'Category saved ✓'); return; }
  const handlers = {
    'problem-form': () => sendProof(form, f, 'payment/problem', 'Thanks. Worklay will look at it.'),
    'proof-form': () => sendProof(form, f, 'payment/proof', 'Proof added ✓'),
    'cookie-form': () => saveConsent(Object.fromEntries(OPTIONAL_CATEGORIES.map(k => [k, !!f.get(k)]))),
    'hero-search': () => { const q = { q: f.get('q'), city: f.get('city') }; Object.keys(q).forEach(k => !q[k] && delete q[k]); go(`#/${f.get('type')}?` + new URLSearchParams(q)); },
    filters: () => { const q = { q: f.get('q'), city: f.get('city'), area: f.get('city') ? f.get('area') : '', remote: f.get('remote'), cat: f.getAll('cat').join(','), sub: f.getAll('sub').filter(id => f.getAll('cat').some(c => (catById(c).subcategories || []).some(x => x.id === id))).join(','), min: f.get('min'), max: f.get('max'), verified: f.get('verified'), open: f.get('open'), subject: f.get('subject'), level: f.get('level'), time: f.get('time'), urgent: f.get('urgent') };
      Object.keys(q).forEach(k => !q[k] && delete q[k]); const { name } = parseHash(); go(`#/${name}?` + new URLSearchParams(q)); },
    'project-form': () => {
      if (+f.get('max') < +f.get('min')) return toast('Max budget must be greater than min budget.');
      act('project/create', { title: f.get('title'), category: f.get('category'), description: f.get('description'), min: f.get('min'), max: f.get('max'), deadline: f.get('deadline'), skills: f.get('skills'), city: f.get('city'), area: f.get('area'), remote: !!f.get('remote') },
        'Project published! Freelancers can now send proposals.', { after: r => go('#/project/' + r.id) }); },
    'service-form': () => act('service/create', {
        title: f.get('title'), category: f.get('category'), emoji: f.get('emoji'), description: f.get('description'),
        packages: [0, 1, 2].map(i => ({ price: f.get('price' + i), desc: f.get('desc' + i), delivery: f.get('delivery' + i), revisions: f.get('rev' + i), feats: FEATURE_NAMES.map((_, fi) => f.get(`f${i}_${fi}`) ? 1 : 0) })),
      }, 'Service published!', { after: r => go('#/service/' + r.id) }),
    'chat-form': () => { const text = (f.get('text') || '').trim(); if (!text) return;
      act('message/send', { to: form.dataset.to, text }, null, { after: () => { render(); const i = $('#chat-form input'); i && i.focus(); } }); },
    'settings-form': () => act('profile/update', { name: f.get('name'), email: f.get('email'), title: f.get('title'), city: f.get('city'), area: f.get('area'), isFreelancer: !!f.get('isFreelancer'), bio: f.get('bio'), skills: f.get('skills') }, 'Profile saved'),
    'contact-form': () => act('contact/send', { name: f.get('name'), email: f.get('email'), subject: f.get('subject'), message: f.get('message') },
      'Thanks! We’ll get back to you within one business day.', { after: () => form.reset() }),

  };
  if (handlers[id]) { e.preventDefault(); handlers[id](); }
});

/* ---------- boot ---------- */
[lang] = detectLang();
document.documentElement.lang = lang;
renderCookieBanner();
tickClock();
{ const c = readConsent(); if (c) { activateConsentedScripts(c); window.dispatchEvent(new CustomEvent('worklay:consent', { detail: { ...c } })); } }
$('#burger').onclick = () => $('#burger').setAttribute('aria-expanded', String($('#mainnav').classList.toggle('open')));
$('#year').textContent = new Date().getFullYear();
lastRoute = currentPath().split('?')[0];
$('#app').innerHTML = `<div class="container" style="padding-top:40px" aria-busy="true"><div class="skeleton" style="height:56px;max-width:520px;margin-bottom:16px"></div><div class="skeleton" style="height:22px;max-width:380px;margin-bottom:36px"></div><div class="grid">${'<div class="skeleton" style="height:230px"></div>'.repeat(4)}</div></div>`;
refresh().then(() => { render(); handleGoogleReturn(); }, err => {
  $('#app').innerHTML = `<div class="container">${empty('⚠️', esc(err.message), '<button class="btn btn-primary" data-action="reload">Try again</button>')}</div>`;
});

// Check for new messages and notifications every 20 seconds while the tab is open.
let lastSeen = '';
setInterval(async () => {
  if (document.hidden || !db || !me() || busy || $('#modal-root').innerHTML) return;
  try {
    await refresh();
    const sig = db.messages.length + ':' + db.notifications.length;
    if (sig === lastSeen) return;
    lastSeen = sig;
    renderHeader();
    const input = $('#chat-form input');
    if (parseHash().name === 'messages' && !(input && input.value)) render();
  } catch (e) { /* offline — try again next tick */ }
}, 20000);
})();
