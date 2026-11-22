/* Worklay front end. Talks to the Node API under /api.
   `db` holds what the server says the current visitor may see; every change goes
   through the API and then reloads that data. */
import { privacyPage, cookiesPage } from './legal.js';

(() => {
'use strict';

/* ---------- config (overwritten by the server's settings on load) ---------- */
const API_URL = window.WORKLAY_API || '/api';
const apiUrl = (route, params = '') => API_URL + (API_URL.includes('?') ? '&' : '?') + 'r=' + route + params;
let PLATFORM_FEE = 0.10;
let MIN_PAYOUT = 20;
const LANG_KEY = 'worklay-lang';

const CATEGORIES = [
  { id: 'dev', name: 'Development & IT', ico: '💻', color: '#eef1ff' },
  { id: 'design', name: 'Design & Creative', ico: '🎨', color: '#fff0e7' },
  { id: 'writing', name: 'Writing & Translation', ico: '✍️', color: '#e3f8ee' },
  { id: 'marketing', name: 'Digital Marketing', ico: '📈', color: '#f0ebff' },
  { id: 'video', name: 'Video & Animation', ico: '🎬', color: '#ffe9ee' },
  { id: 'business', name: 'Business & Admin', ico: '💼', color: '#fff6d9' },
  { id: 'home', name: 'Home & Handyman', ico: '🛠️', color: '#e6f6ff' },
  { id: 'music', name: 'Music & Audio', ico: '🎧', color: '#eaf9f3' },
];
const catById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[0];
const FEATURE_NAMES = ['Source File', 'Social Media Kit', 'High Resolution', 'Project Upload'];
let PAYOUT_METHODS = ['PayPal', 'Payoneer', 'Bank transfer'];
let GOOGLE_AUTH = false; // true when the server has Google sign-in configured
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
    <div class="field"><label>City</label><select name="city" data-role="city" ${req}><option value="">${any ? 'All cities' : 'Select city'}</option>${Object.keys(CITIES).map(c => `<option ${c === city ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field"><label>Area</label><select name="area" data-role="area" data-any="${any ? 1 : ''}" ${req} ${areas.length ? '' : 'disabled'}><option value="">${any ? 'All areas' : 'Select area'}</option>${areas.map(a => `<option ${a === area ? 'selected' : ''}>${a}</option>`).join('')}</select></div></div>`;
}
// Proximity: 2 = same area, 1 = same city, 0 = elsewhere
const proximity = (a, b) => !a || !b || !a.city || a.city !== b.city ? 0 : (a.area && a.area === b.area ? 2 : 1);
const proxTag = o => { const u = me(); if (!u || !u.city || u.id === o.id) return ''; const p = proximity(u, o); return p === 2 ? '<span class="tag green">📍 Your area</span>' : p === 1 ? '<span class="tag">📍 Your city</span>' : ''; };

/* ---------- i18n ---------- */
const LANGS = { en: 'English', et: 'Eesti' };
const I18N = {
  en: {},
  et: {
    'nav.freelancers': 'Leia vabakutselisi', 'nav.projects': 'Projektid', 'nav.services': 'Teenused', 'nav.blog': 'Blogi', 'nav.about': 'Meist', 'nav.contact': 'Kontakt',
    'cta.post': 'Postita projekt', 'cta.signin': 'Logi sisse', 'cta.login': 'Logi sisse', 'cta.signup': 'Registreeru', 'cta.search': 'Otsi',
    'hero.title': 'Leia tööd. Saa asjad tehtud.', 'hero.lead': 'Worklay ühendab ülesannetega inimesed vabakutseliste ja professionaalidega, kes otsivad tööd.',
    'hero.ph': 'Mida sa vajad?', 'home.how': 'Kuidas see töötab', 'home.cats': 'Sirvi kategooriaid', 'home.popular': 'Populaarsed teenused', 'home.latest': 'Uusimad projektid',
    'footer.tag': 'Ühendame ülesanded inimestega, kes need ära teevad.', 'footer.platform': 'Platvorm', 'footer.company': 'Ettevõte',
    'common.viewall': 'Vaata kõiki', 'common.send': 'Saada', 'common.follow': 'Jälgi', 'common.following': 'Jälgid', 'common.message': 'Saada sõnum', 'common.order': 'Telli',
    'language.label': 'Keel', 'language.select': 'Vali keel', 'language.en': 'English', 'language.et': 'Eesti',
    'hero.search': 'Otsi', 'hero.allCities': 'Kõik linnad', 'hero.searchIn': 'Otsi valdkonnas', 'hero.popular': 'Populaarne:', 'hero.hire': 'Palgata vabakutseline', 'hero.earn': 'Alusta teenimist →',
    'hero.local': 'Kohalikud spetsialistid {count} Eesti linnas', 'hero.near': 'Spetsialistid sinu lähedal', 'hero.searchArea': 'Otsi linna ja piirkonna järgi',
    'hero.verified': 'Kontrollitud vabakutselised', 'hero.idChecked': 'Meie meeskonna poolt kontrollitud', 'hero.proposals': 'Saa pakkumisi kiiresti', 'hero.postFree': 'Postita projekt tasuta',
    'trust.cities': '{cities} linna, {areas} piirkonda', 'trust.nearby': 'Leia abi lähedalt', 'trust.verified': 'Isikutuvastusega spetsialistid', 'trust.documents': 'Dokumendid on kontrollitud', 'trust.pay': 'Maksa pärast töö valmimist', 'trust.release': 'Raha vabastatakse pärast sinu kinnitust', 'trust.free': 'Liitumine on tasuta', 'trust.post': 'Postita projekt tasuta',
    'home.safe': 'Lihtne ja turvaline', 'home.customer': '🧑‍💼 Klientidele', 'home.freelancer': '🛠️ Vabakutselistele',
    'home.postFree': 'Postita töö tasuta', 'home.describe': 'Kirjelda tööd, eelarvet ja asukohta.', 'home.compare': 'Võrdle pakkumisi', 'home.compareDesc': 'Kohalikud spetsialistid saadavad pakkumisi. Vaata arvustusi ja märke ning vestle enne otsustamist.', 'home.payHappy': 'Maksa, kui oled rahul', 'home.payHappyDesc': 'Kinnita töö ja tasu kantakse vabakutselisele.', 'home.createProfile': 'Loo profiil', 'home.chooseLocation': 'Vali linn ja piirkond, et lähedal asuvad kliendid sind leiaksid.', 'home.offerPackages': 'Paku teenusepakette või saada pakkumisi', 'home.setPrices': 'Määra ise Basicu, Standardi ja Premiumi paketihinnad.', 'home.getPaid': 'Saa tasu', 'home.withdraw': 'Võta teenistus välja PayPali, Payoneeri või pangaülekandega.',
    'home.categoriesDesc': 'Leia sobiv tegija kodutöödest veebidisainini.', 'home.available': 'saadaval', 'home.first': 'Ole esimene', 'home.nearbyHead': 'Vabakutselised sinu linnas', 'home.nearbyLocation': 'Vabakutselised sinu lähedal linnas', 'home.pickCity': 'Vali linn, et näha lähedal saadaolevaid tegijaid.', 'home.firstFreelancer': 'Ole üks esimestest vabakutselistest', 'home.joinFreelancer': 'Liitu vabakutselisena', 'home.setupFreelancer': 'Seadista vabakutselise profiil', 'home.profileNearby': 'Loo tasuta profiil, vali linn ja piirkond ning leia lähedal asuvaid kliente.', 'home.readyPackages': 'Valmispaketid selgete hindadega.', 'home.noServices': 'Teenuseid veel pole', 'home.servicesDesc': 'Vabakutselised saavad pakkuda Basicu, Standardi ja Premiumi pakette enda määratud hinnaga.', 'home.jobsDesc': 'Tööd inimestelt, kes vajavad abi.', 'home.needDone': 'Vajad abi?', 'home.postProjectFree': 'Postita projekt tasuta ja saa pakkumisi lähedal asuvatelt vabakutselistelt.', 'home.earnOwn': 'Teeni enda tingimustel', 'home.offerLocal': 'Paku teenuseid enda hinnaga ja leia kliente oma piirkonnast.', 'home.browseProjects': 'Sirvi projekte',
    'chip.cleaning': 'Koristus', 'chip.furniture': 'Mööbli kokkupanek', 'chip.logo': 'Logo kujundus', 'chip.web': 'Veebiarendus', 'chip.translation': 'Tõlge',
    'category.dev': 'Arendus ja IT', 'category.design': 'Disain ja loovtöö', 'category.writing': 'Kirjutamine ja tõlge', 'category.marketing': 'Digiturundus', 'category.video': 'Video ja animatsioon', 'category.business': 'Äri ja haldus', 'category.home': 'Kodu ja remont', 'category.music': 'Muusika ja heli',
    'footer.legal': 'Õiguslik', 'legal.privacy': 'Privaatsuspoliitika', 'legal.cookies': 'Küpsiste poliitika', 'legal.cookieSettings': 'Küpsiste seaded',
    'cookie.title': 'Sinu privaatsus', 'cookie.text': 'Kasutame ainult küpsiseid, mis on vajalikud sisselogimiseks ja sinu valikute meelespidamiseks. Analüütika- ja reklaamiküpsiseid kasutame ainult sinu nõusolekul.',
    'cookie.accept': 'Nõustu kõigiga', 'cookie.reject': 'Keeldu valikulistest', 'cookie.customize': 'Kohanda', 'cookie.save': 'Salvesta valikud', 'cookie.saved': 'Küpsiste valikud salvestatud',
    'cookie.settingsIntro': 'Vali, milliseid küpsiseid lubad. Hädavajalikud küpsised on alati sees, sest sait ei tööta ilma nendeta.',
    'cookie.necessary': 'Hädavajalikud', 'cookie.necessaryDesc': 'Sisselogimine, keele-eelistus ja need küpsiste valikud.', 'cookie.alwaysOn': 'Alati sees',
    'cookie.analytics': 'Analüütika', 'cookie.analyticsDesc': 'Aitab meil mõista, kuidas saiti kasutatakse. Praegu ei kasuta me analüütikatööriistu, seega selle lubamine midagi ei muuda.',
  },
};
const EN = {
  'nav.freelancers': 'Find freelancers', 'nav.projects': 'Projects', 'nav.services': 'Services', 'nav.blog': 'Blog', 'nav.about': 'About', 'nav.contact': 'Contact',
  'cta.post': 'Post a project', 'cta.signin': 'Sign in', 'cta.login': 'Log in', 'cta.signup': 'Sign up', 'cta.search': 'Search',
  'hero.title': 'Find work. Get work done.', 'hero.lead': 'Worklay connects people who need tasks done with freelancers and professionals looking for work.',
  'hero.ph': 'What do you need help with?', 'home.how': 'How it works', 'home.cats': 'Browse categories', 'home.popular': 'Popular services', 'home.latest': 'Latest projects',
  'footer.tag': 'Connecting people with tasks to the professionals who get them done.', 'footer.platform': 'Platform', 'footer.company': 'Company',
  'common.viewall': 'View all', 'common.send': 'Send', 'common.follow': 'Follow', 'common.following': 'Following', 'common.message': 'Message', 'common.order': 'Order',
  'language.label': 'Language', 'language.select': 'Select language', 'language.en': 'English', 'language.et': 'Estonian',
  'hero.search': 'Search', 'hero.allCities': 'All cities', 'hero.searchIn': 'Search in', 'hero.popular': 'Popular:', 'hero.hire': 'Hire a freelancer', 'hero.earn': 'Start earning →',
  'hero.local': 'Local professionals in {count} Estonian cities', 'hero.near': 'Professionals near you', 'hero.searchArea': 'Search by city and area',
  'hero.verified': 'Verified freelancers', 'hero.idChecked': 'ID checked by our team', 'hero.proposals': 'Get proposals fast', 'hero.postFree': 'Post a project for free',
  'trust.cities': '{cities} cities, {areas} areas', 'trust.nearby': 'Find help right around the corner', 'trust.verified': 'ID-verified professionals', 'trust.documents': 'Documents checked by our team', 'trust.pay': "Pay when it's done", 'trust.release': 'Released after you approve the work', 'trust.free': 'Free to join', 'trust.post': 'Post projects at no cost',
  'home.safe': 'Simple & safe', 'home.customer': '🧑‍💼 For customers', 'home.freelancer': '🛠️ For freelancers',
  'home.postFree': 'Post your job for free', 'home.describe': 'Describe what you need, your budget and where it is.', 'home.compare': 'Compare proposals', 'home.compareDesc': 'Local professionals send offers. Check their reviews and badges, and chat before you decide.', 'home.payHappy': "Pay when you're happy", 'home.payHappyDesc': 'Approve the work and payment is released to the freelancer.', 'home.createProfile': 'Create your profile', 'home.chooseLocation': 'Choose your city and area so nearby customers find you first.', 'home.offerPackages': 'Offer packages or send proposals', 'home.setPrices': 'Set your own prices in Basic, Standard and Premium tiers.', 'home.getPaid': 'Get paid', 'home.withdraw': 'Withdraw your earnings via PayPal, Payoneer or bank transfer.',
  'home.categoriesDesc': 'From home repairs to web design: find the right person for the job.', 'home.available': 'available', 'home.first': 'Be the first', 'home.nearbyHead': 'Find freelancers in your city', 'home.nearbyLocation': 'Freelancers near you in', 'home.pickCity': "Pick a city to see who's available nearby.", 'home.firstFreelancer': 'Be one of the first freelancers', 'home.joinFreelancer': 'Join as a freelancer', 'home.setupFreelancer': 'Set up my freelancer profile', 'home.profileNearby': 'Create a free profile, choose your city and area, and start getting jobs from people nearby.', 'home.readyPackages': 'Ready-made packages with clear prices.', 'home.noServices': 'No services yet', 'home.servicesDesc': 'Freelancers can offer their work in Basic, Standard and Premium packages at their own price.', 'home.jobsDesc': 'Jobs posted by people who need a hand.', 'home.needDone': 'Need something done?', 'home.postProjectFree': 'Post your project for free and get proposals from freelancers near you.', 'home.earnOwn': 'Ready to earn on your own terms?', 'home.offerLocal': 'Offer your services at your own price and get found by customers in your area.', 'home.browseProjects': 'Browse projects',
  'chip.cleaning': 'Cleaning', 'chip.furniture': 'Furniture assembly', 'chip.logo': 'Logo design', 'chip.web': 'Web development', 'chip.translation': 'Translation',
  'category.dev': 'Development & IT', 'category.design': 'Design & Creative', 'category.writing': 'Writing & Translation', 'category.marketing': 'Digital Marketing', 'category.video': 'Video & Animation', 'category.business': 'Business & Admin', 'category.home': 'Home & Handyman', 'category.music': 'Music & Audio',
  'footer.legal': 'Legal', 'legal.privacy': 'Privacy Policy', 'legal.cookies': 'Cookie Policy', 'legal.cookieSettings': 'Cookie settings',
  'cookie.title': 'Your privacy', 'cookie.text': 'We only use cookies that are needed to log you in and remember your choices. We will only use analytics or advertising cookies if you agree.',
  'cookie.accept': 'Accept all', 'cookie.reject': 'Reject optional', 'cookie.customize': 'Customize', 'cookie.save': 'Save choices', 'cookie.saved': 'Cookie choices saved',
  'cookie.settingsIntro': 'Choose which cookies you allow. Strictly necessary cookies are always on because the site cannot work without them.',
  'cookie.necessary': 'Strictly necessary', 'cookie.necessaryDesc': 'Login, language preference and these cookie choices.', 'cookie.alwaysOn': 'Always on',
  'cookie.analytics': 'Analytics', 'cookie.analyticsDesc': 'Helps us understand how the site is used. We don’t use any analytics tools yet, so turning this on changes nothing for now.',
};
let lang = 'en';
const t = k => (I18N[lang] && I18N[lang][k]) || EN[k] || k;
const numberLocale = () => lang === 'et' ? 'et-EE' : 'en';

function detectLang() {
  try { const saved = localStorage.getItem(LANG_KEY); if (saved && LANGS[saved]) return [saved, 'saved']; } catch (e) {}
  for (const l of (navigator.languages || [navigator.language || 'en'])) {
    const code = l.slice(0, 2).toLowerCase();
    if (LANGS[code]) return [code, 'browser'];
  }
  return ['en', 'default'];
}

function flagSvg(code) {
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
  if (!res.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}
async function refresh() {
  db = await api('bootstrap');
  if (db.config) { CITIES = db.config.cities; PLATFORM_FEE = db.config.fee; MIN_PAYOUT = db.config.minPayout; PAYOUT_METHODS = db.config.payoutMethods; GOOGLE_AUTH = !!db.config.googleAuth; CARD_PAYMENTS = !!db.config.cardPayments; }
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
    if (errEl) errEl.textContent = e.message; else toast(esc(e.message), 'error');
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
function avatar(u, size = '') { return `<span class="avatar ${size}" style="background:${u.color}22;color:${u.color}">${esc(initials(u.name))}</span>`; }
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
const statusTag = st => ({ open: '<span class="tag green">Open</span>', awarded: '<span class="tag orange">In progress</span>', completed: '<span class="tag gray">Completed</span>', pending: '<span class="tag">Pending</span>', accepted: '<span class="tag green">Accepted</span>', rejected: '<span class="tag gray">Not selected</span>', in_queue: '<span class="tag">In queue</span>', delivered: '<span class="tag orange">Delivered</span>', paid: '<span class="tag green">Paid</span>', awaiting_payment: '<span class="tag orange">Awaiting payment</span>', processing: '<span class="tag">Payment processing</span>', released: '<span class="tag orange">Waiting for payout setup</span>', transferring: '<span class="tag">Sending…</span>', transferred: '<span class="tag green">Sent to Stripe</span>', refunded: '<span class="tag gray">Refunded</span>', cancelled: '<span class="tag gray">Cancelled</span>' }[st] || esc(st));

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
    <div class="svc-foot"><span class="tag gray">${esc(catById(s.category).name)}</span><span>From <span class="price">${money(s.packages[0].price)}</span></span></div>
  </div>`;
}
function projectCard(p) {
  const owner = user(p.ownerId), n = p.proposalCount;
  return `<div class="card proj-card">
    <button class="heart ${inWishlist('project', p.id) ? 'on' : ''}" data-action="wish" data-kind="project" data-id="${p.id}" aria-label="Save to wishlist">${inWishlist('project', p.id) ? '♥' : '♡'}</button>
    <div style="display:flex;gap:8px">${statusTag(p.status)} <span class="tag gray">${esc(catById(p.category).name)}</span></div>
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
function modal(html, onMount) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg" data-action="close-modal-bg"><div class="modal" role="dialog" aria-modal="true"><button class="close" data-action="close-modal" aria-label="Close">×</button>${html}</div></div>`;
  onMount && onMount(root.querySelector('.modal'));
  const f = root.querySelector('input,textarea,select'); f && f.focus();
}
const closeModal = () => { $('#modal-root').innerHTML = ''; };

function openLogin() { openAuth('login'); }
const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
// Messages for ?auth_error=… / ?welcome=… set by the server after the Google redirect.
const GOOGLE_MESSAGES = {
  google_disabled: ['Sign-in with Google is not available right now.', 'error'],
  google_state: ['Your Google sign-in expired. Please try again.', 'error'],
  google_cancelled: ['Google sign-in was cancelled.', ''],
  google_unverified: ['Your Google email address is not verified, so we can’t use it to sign you in.', 'error'],
  google_failed: ['Google sign-in failed. Please try again.', 'error'],
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
    history.replaceState(null, '', '#/' + [name, ...args].join('/') + (qs ? '?' + qs : ''));
    return;
  }
  if (!q.auth_error && !q.welcome && !q.signed_in) return;
  if (q.auth_error) { const [msg, kind] = GOOGLE_MESSAGES[q.auth_error] || GOOGLE_MESSAGES.google_failed; toast(msg, kind); }
  else if (q.welcome === 'google') toast('Account created with Google! Add your city and area so people nearby can find you.', 'success');
  else if (q.signed_in === 'google' && me()) toast(`Welcome back, ${esc(me().name.split(' ')[0])}!`, 'success');
  const { name, args } = parseHash(), rest = { ...q }; delete rest.auth_error; delete rest.welcome; delete rest.signed_in;
  const qs = new URLSearchParams(rest).toString();
  history.replaceState(null, '', '#/' + [name, ...args].join('/') + (qs ? '?' + qs : ''));
}
const pwField = (name, auto, extra = '') => `<div class="pw-wrap"><input name="${name}" type="password" required autocomplete="${auto}" ${extra}><button type="button" class="pw-toggle" data-action="toggle-pw">Show</button></div>`;
function openAuth(mode = 'login', intent = 'hire') {
  const err = '<p class="auth-err" role="alert" style="color:#d92d50;min-height:1.2em;margin:0 0 8px;font-size:.9rem"></p>';
  modal(`<div style="text-align:center;margin-bottom:18px"><svg viewBox="0 0 32 32" width="44" height="44" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#3858FF"/><path d="M7 10l4 13 5-9 5 9 4-13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h2 style="margin:8px 0 0">${mode === 'login' ? 'Welcome back' : 'Join Worklay'}</h2><p class="muted" style="margin:4px 0 0">${mode === 'login' ? 'Log in to your account' : 'Create your free account'}</p></div>
    <div class="tabs" style="width:100%;margin-bottom:18px"><button style="flex:1" class="${mode === 'login' ? 'active' : ''}" data-action="auth-tab" data-mode="login">Log in</button><button style="flex:1" class="${mode === 'signup' ? 'active' : ''}" data-action="auth-tab" data-mode="signup">Sign up</button></div>
    ${GOOGLE_AUTH ? `<button type="button" class="btn btn-google btn-block" data-action="google-auth">${GOOGLE_G}${mode === 'login' ? 'Continue with Google' : 'Sign up with Google'}</button>
      <p class="small muted" style="text-align:center;margin:8px 0 0">By continuing with Google you agree to the Terms of Service and have read the <a href="#/privacy" data-action="close-modal">Privacy Policy</a>.</p>
      <div class="auth-divider"><span>or</span></div>` : ''}
    ${mode === 'login' ? `<form id="login-form">
      <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label>Password</label>${pwField('password', 'current-password')}</div>
      ${err}<button class="btn btn-primary btn-block">Log in</button>
      <p class="small muted" style="text-align:center">Don't have an account? <a href="#" data-action="auth-tab" data-mode="signup">Sign up</a></p></form>`
    : `<form id="signup-form">
      <div class="field"><label>I want to</label><div class="row">
        <label class="choice"><input type="radio" name="intent" value="hire" ${intent !== 'work' ? 'checked' : ''}><span class="big-ico">🧑‍💼</span> Hire freelancers</label>
        <label class="choice"><input type="radio" name="intent" value="work" ${intent === 'work' ? 'checked' : ''}><span class="big-ico">🛠️</span> Work as a freelancer</label></div></div>
      <div class="field"><label>Full name</label><input name="name" required maxlength="60" autocomplete="name"></div>
      ${locationFields('', '', { required: true })}
      <div class="fl-only"><div class="row"><div class="field"><label>Main service category</label><select name="category">${CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
        <div class="field"><label>What do you do?</label><input name="title" maxlength="60" placeholder="e.g. Plumber, Web designer"></div></div>
        <p class="small muted" style="margin-top:-6px">Customers in your city and area will find you first.</p></div>
      <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label>Password</label>${pwField('password', 'new-password', 'minlength="8" placeholder="At least 8 characters"')}</div>
      <label class="filter-opt small"><input type="checkbox" name="terms" required> I agree to the Terms of Service and have read the <a href="#/privacy" data-action="close-modal">Privacy Policy</a></label>
      ${err}<button class="btn btn-primary btn-block">Create account</button>
      <p class="small muted" style="text-align:center">Already have an account? <a href="#" data-action="auth-tab" data-mode="login">Log in</a></p></form>`}`, m => {
    const errEl = $('.auth-err', m);
    const lf = $('#login-form', m), sf = $('#signup-form', m);
    if (lf) lf.onsubmit = e => {
      e.preventDefault(); const f = new FormData(lf);
      act('auth/login', { email: f.get('email'), password: f.get('password') }, null, { errEl, after: () => {
        closeModal(); render(); toast(`Welcome back, ${esc(me().name.split(' ')[0])}!`); } });
    };
    if (sf) sf.onsubmit = e => {
      e.preventDefault(); const f = new FormData(sf), work = f.get('intent') === 'work';
      const title = (f.get('title') || '').trim() || catById(f.get('category')).name + ' freelancer';
      act('auth/register', { intent: f.get('intent'), name: f.get('name'), email: f.get('email'), password: f.get('password'), city: f.get('city'), area: f.get('area'), category: f.get('category'), title, terms: !!f.get('terms') }, null, { errEl, after: () => {
        closeModal(); go(work ? '#/dashboard/settings' : '#/post-project'); render();
        toast(work ? 'Account created! Tell customers about your skills.' : 'Account created! Post your first project.'); } });
    };
  });
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
    <a class="icon-btn hide-sm" href="#/wishlist" title="Wishlist">♡</a>
    <a class="icon-btn" href="#/messages" title="Messages">💬${unreadM ? `<span class="dot">${unreadM}</span>` : ''}</a>
    <a class="icon-btn" href="#/notifications" title="Notifications">🔔${unreadN ? `<span class="dot">${unreadN}</span>` : ''}</a>
    <div class="dropdown" id="userdd"><button class="icon-btn" style="padding:0;border:0" data-action="toggle-dd" aria-label="Account menu">${avatar(u)}</button>
      <div class="dropdown-menu"><div style="padding:8px 12px"><b>${esc(u.name)}</b><br><small class="muted">${money(u.balance)} balance</small></div><hr>
        <a href="#/dashboard">Dashboard</a><a href="#/user/${u.id}">My profile</a><a href="#/post-project">Post a project</a><a href="#/post-service">Offer a service</a><a href="#/wishlist">Wishlist</a>
        ${u.role === 'admin' ? '<a href="#/admin">Admin panel</a>' : ''}<hr><button data-action="logout">Log out</button></div></div>`;
}

/* ---------- views ---------- */
const V = {};

/* Earnings tab when payments go through Stripe Connect. */
function stripeEarnings(u) {
  const s = u.payouts || {}, mine = (db.payments || []).filter(p => p.sellerId === u.id);
  const label = p => p.kind === 'order' ? (service((db.orders.find(o => o.id === p.orderId) || {}).serviceId) || {}).title || 'Service order' : (project(p.projectId) || {}).title || 'Project';
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
  const loc = lang === 'et' ? 'et-EE' : 'en-GB';
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
      <h1>${lang === 'en' ? 'Find trusted <span class="hl">local professionals</span> for any job' : t('hero.title')}</h1>
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
    <div class="cat-grid">${CATEGORIES.map(c => { const n = catCount(c.id); return `<a class="cat" href="#/freelancers?cat=${c.id}"><span class="ico" style="background:${c.color}">${c.ico}</span><div><b>${t(`category.${c.id}`)}</b><span>${n ? n + ' ' + t('home.available') : t('home.first')}</span></div></a>`; }).join('')}</div>
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
  const cats = (q.cat || '').split(',').filter(Boolean);
  const u = me();
  return `<aside class="filters"><form id="filters">
    <label>Search</label><input name="q" value="${esc(q.q || '')}" placeholder="Keywords">
    <h4>📍 Location</h4>${locationFields(q.city || '', q.area || '', { any: true })}
    ${u && u.city ? `<button type="button" class="btn btn-outline btn-sm btn-block" data-action="near-me">Near me (${esc(locStr(u))})</button>` : ''}
    ${kind === 'projects' ? `<label class="filter-opt"><input type="checkbox" name="remote" value="1" ${q.remote ? 'checked' : ''}> Include remote projects</label>` : ''}
    <h4>Category</h4>${CATEGORIES.map(c => `<label class="filter-opt"><input type="checkbox" name="cat" value="${c.id}" ${cats.includes(c.id) ? 'checked' : ''}> ${c.ico} ${c.name}</label>`).join('')}
    <h4>${kind === 'projects' ? 'Budget' : kind === 'freelancers' ? 'Hourly rate' : 'Starting price'} (€)</h4><div class="row"><input name="min" type="number" placeholder="Min" value="${esc(q.min || '')}"><input name="max" type="number" placeholder="Max" value="${esc(q.max || '')}"></div>
    ${kind !== 'projects' ? `<h4>Seller</h4><label class="filter-opt"><input type="checkbox" name="verified" value="1" ${q.verified ? 'checked' : ''}> Verified only</label>` : `<h4>Status</h4><label class="filter-opt"><input type="checkbox" name="open" value="1" ${q.open ? 'checked' : ''}> Open for proposals</label>`}
    <button class="btn btn-primary btn-block" style="margin-top:14px">Apply filters</button>
    <a class="btn btn-ghost btn-block btn-sm" href="#/${kind}">Clear</a></form></aside>`;
}
function activeFilters(kind, q) {
  const chips = [];
  if (q.q) chips.push(['q', '', `“${q.q}”`]);
  if (q.city) chips.push(['city', '', '📍 ' + (q.area ? q.area + ', ' : '') + q.city]);
  (q.cat || '').split(',').filter(Boolean).forEach(c => chips.push(['cat', c, catById(c).ico + ' ' + catById(c).name]));
  if (q.min) chips.push(['min', '', 'From €' + q.min]);
  if (q.max) chips.push(['max', '', 'Up to €' + q.max]);
  if (q.verified) chips.push(['verified', '', '✓ Verified only']);
  if (q.open) chips.push(['open', '', 'Open only']);
  if (q.remote) chips.push(['remote', '', '🌐 Incl. remote']);
  if (!chips.length) return '';
  return `<div class="active-filters">${chips.map(([k, v, l]) => `<button class="af-chip" data-action="clear-filter" data-key="${k}" data-val="${esc(v)}" aria-label="Remove filter ${esc(l)}">${esc(l)} <span>×</span></button>`).join('')}<button class="af-clear" data-action="nav" data-href="#/${kind}">Clear all</button></div>`;
}
function listToolbar(kind, q, count, noun, right = '') {
  return `<div class="toolbar"><div style="display:flex;gap:10px;align-items:center"><button class="btn btn-outline btn-sm filter-toggle" data-action="toggle-filters">⚙️ Filters</button><span class="muted"><b style="color:var(--ink)">${count}</b> ${noun}${count === 1 ? '' : 's'}${locHeading(q)}</span></div>${right}</div>${activeFilters(kind, q)}`;
}
const matchQ = (q, ...fields) => !q || fields.join(' ').toLowerCase().includes(q.toLowerCase());
const matchLoc = (q, o) => (!q.city || o.city === q.city) && (!q.area || o.area === q.area);
// Closest to the viewer first (same area, then same city)
const byNearMe = getLoc => (a, b) => { const u = me(); return u ? proximity(u, getLoc(b)) - proximity(u, getLoc(a)) : 0; };
const locHeading = q => q.city ? ` in ${esc(q.area ? q.area + ', ' + q.city : q.city)}` : '';

function freelancerCard(u) {
  const st = userStats(u.id), svcs = db.services.filter(s => s.sellerId === u.id);
  const from = svcs.length ? Math.min(...svcs.map(s => s.packages[0].price)) : 0;
  return `<div class="card fl-card">
    <div class="top">${avatar(u, 'md')}<div style="min-width:0"><a class="name" href="#/user/${u.id}">${esc(u.name)}</a> ${u.verification.status === 'verified' ? '<span class="verified" title="Verified">✓</span>' : ''}<div class="small muted truncate">${esc(u.title)}</div></div></div>
    <div class="proj-meta"><span>📍 <b>${esc(locStr(u) || 'Location not set')}</b></span>${proxTag(u)}</div>
    <div class="small">${stars(st.rating, st.reviews)} · ${st.doneProjects + st.doneServices} jobs done</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${u.skills.slice(0, 3).map(s => `<span class="tag gray">${esc(s)}</span>`).join('')}</div>
    <div class="list-item" style="padding:10px 0 0;border:0"><span>${u.rate ? `<b class="price">${money(u.rate)}</b>/hr` : ''}${u.rate && from ? ' · ' : ''}${from ? `from <b>${money(from)}</b>` : ''}</span>
      <span style="display:flex;gap:6px"><a class="btn btn-outline btn-sm" href="#/messages/${u.id}">💬</a><a class="btn btn-primary btn-sm" href="#/user/${u.id}">View profile</a></span></div>
  </div>`;
}

V.freelancers = (_, q) => {
  const cats = (q.cat || '').split(',').filter(Boolean);
  const list = db.users.filter(u => u.isFreelancer && (!me() || u.id !== me().id) && matchLoc(q, u) && (!cats.length || cats.includes(u.category))
    && matchQ(q.q, u.name, u.title, u.bio, u.skills.join(' ')) && (!q.min || u.rate >= +q.min) && (!q.max || u.rate <= +q.max) && (!q.verified || u.verification.status === 'verified'))
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
    && (!q.min || s.packages[0].price >= +q.min) && (!q.max || s.packages[0].price <= +q.max) && (!q.verified || user(s.sellerId).verification.status === 'verified') && matchLoc(q, user(s.sellerId)));
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
    <div class="small muted"><a href="#/services">Services</a> › <a href="#/services?cat=${s.category}">${esc(catById(s.category).name)}</a></div>
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
  if (isOwner && p.status === 'awarded') action = `<button class="btn btn-primary btn-block" data-action="complete-project" data-id="${p.id}">Mark complete & release ${money(p.awardedAmount)}</button><p class="small muted">Release payment once the job objectives are met.</p>`;
  else if (isOwner) action = `<p class="muted">You posted this project.</p>`;
  else if (mine) action = `<p>Your proposal: <b>${money(mine.amount)}</b> ${statusTag(mine.status)}</p>`;
  else if (p.status === 'open') action = `<button class="btn btn-primary btn-block" data-action="propose" data-id="${p.id}">Submit a proposal</button>`;
  else action = `<p class="muted">This project is no longer accepting proposals.</p>`;
  const showProps = isOwner ? props : props.filter(x => u && x.sellerId === u.id);
  return `<div class="container detail"><div>
    <div class="small muted"><a href="#/projects">Projects</a> › ${esc(catById(p.category).name)}</div>
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
      <div style="flex:1;min-width:240px"><h1 style="margin:0">${esc(u.name)}</h1>${badges(u)}
        <div><b>${esc(u.title)}</b></div><div class="muted small">📍 ${esc(locStr(u) || u.country || 'Location not set')} ${proxTag(u)} · ${u.isFreelancer && u.rate ? `<b>${money(u.rate)}/hr</b> · ` : ''}Member since ${monthYear(u.joined)} · ${followers} follower${followers === 1 ? '' : 's'}</div>
        ${statPills(u.id)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${own ? '<a class="btn btn-outline" href="#/dashboard/settings">Edit profile</a>' : `<button class="btn ${isFollowing(u.id) ? 'on' : 'btn-primary'}" data-action="follow" data-id="${u.id}">${isFollowing(u.id) ? '✓ ' + t('common.following') : '+ ' + t('common.follow')}</button><a class="btn btn-outline" href="#/messages/${u.id}">💬 ${t('common.message')}</a>`}</div>
    </div>
    <div class="detail" style="padding:30px 0"><div>
      ${u.bio ? `<h2>About</h2><p class="muted">${esc(u.bio)}</p>` : ''}
      ${svcs.length ? `<h2 style="margin-top:20px">Services</h2><div class="grid">${svcs.map(serviceCard).join('')}</div>` : ''}
      <h2 style="margin-top:30px">Reviews ${st.reviews ? `<span class="stars">★ ${st.rating.toFixed(1)}</span>` : ''}</h2>
      ${rv.length ? rv.map(x => { const f = user(x.from); return `<div class="review">${avatar(f, 'sm')}<div><b>${esc(f.name)}</b> <span class="stars">${'★'.repeat(x.rating)}</span> <span class="muted small">${ago(x.date)}</span><p style="margin:4px 0 0">${esc(x.text)}</p></div></div>`; }).join('') : '<p class="muted">No reviews yet.</p>'}
    </div><aside><div class="card card-pad">
      <h3>Skills</h3><div style="display:flex;gap:6px;flex-wrap:wrap">${u.skills.length ? u.skills.map(s => `<span class="tag">${esc(s)}</span>`).join('') : '<span class="muted">—</span>'}</div>
      <h3 style="margin-top:20px">Verification</h3><p class="${u.verification.status === 'verified' ? 'verified' : 'muted'}">${u.verification.status === 'verified' ? '✓ Identity verified by Worklay' : u.verification.status === 'pending' ? 'Verification under review' : 'Not verified yet'}</p>
    </div></aside></div></div>`;
};

V.postProject = () => {
  if (!me()) return `<div class="container">${empty('🔐', 'Sign in to post a project.', `<button class="btn btn-primary" data-action="login">${t('cta.login')}</button> <button class="btn btn-outline" data-action="signup">${t('cta.signup')}</button>`)}</div>`;
  return `<div class="page-head"><div class="container"><h1>${t('cta.post')}</h1><p>Tell professionals what you need. They'll get in touch with proposals.</p></div></div>
  <div class="container" style="max-width:760px;padding-top:30px"><form class="card card-pad" id="project-form">
    <div class="field"><label>Project title</label><input name="title" required maxlength="100" placeholder="e.g. Design a logo for my bakery"></div>
    <div class="field"><label>Category</label><select name="category">${CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
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
    <div class="row"><div class="field"><label>Category</label><select name="category">${CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
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

const DASH_TABS = [['overview', '🏠', 'Overview'], ['projects', '📋', 'My projects'], ['orders', '🛒', 'My orders'], ['selling', '💼', 'Selling'], ['proposals', '📨', 'My proposals'], ['earnings', '💶', 'Earnings & payouts'], ['verification', '🛡️', 'Verification'], ['settings', '⚙️', 'Profile settings']];
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
    return `<div class="list-item"><div><a href="#/service/${s.id}"><b>${esc(s.title)}</b></a><div class="small muted">${esc(s.packages[o.pkg].name)} · ${asSeller ? 'Buyer' : 'Seller'}: ${esc(other.name)} · ${ago(o.created)}</div></div>
      <div style="display:flex;gap:10px;align-items:center"><b>${money(o.price)}</b>${statusTag(o.status)}<a class="btn btn-ghost btn-sm" href="#/messages/${other.id}">💬</a>${btn}</div></div>`; };
  let body = '';
  // Getting-started checklist (different steps for freelancers and customers)
  const steps = u.isFreelancer ? [
    [u.bio && u.bio.length >= 20, 'Write a short bio', '#/dashboard/settings'],
    [u.skills.length > 0, 'Add your skills', '#/dashboard/settings'],
    [u.rate > 0, 'Set your hourly rate', '#/dashboard/settings'],
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
    <div class="card card-pad"><h3>Awarded projects</h3>${db.projects.filter(p => p.awardedTo === u.id).map(p => `<div class="list-item"><a href="#/project/${p.id}"><b>${esc(p.title)}</b></a><div style="display:flex;gap:10px;align-items:center"><b>${money(p.awardedAmount)}</b>${statusTag(p.status)}</div></div>`).join('') || '<p class="muted">None yet.</p>'}</div>
    <h3 style="margin-top:24px">My services</h3><div class="grid">${db.services.filter(s => s.sellerId === u.id).map(serviceCard).join('') || '<p class="muted">You haven’t listed a service yet.</p>'}</div>`;
  if (tab === 'proposals') body = `<h1>My proposals</h1><div class="card card-pad">${myProps.length ? myProps.map(x => { const p = project(x.projectId); return `<div class="list-item"><div><a href="#/project/${p.id}"><b>${esc(p.title)}</b></a><div class="small muted">${money(x.amount)} · ${x.days} days · sent ${ago(x.created)}</div></div>${statusTag(x.status)}</div>`; }).join('') : empty('📨', 'No proposals sent yet.', '<a class="btn btn-primary" href="#/projects">Find projects</a>')}</div>`;
  if (tab === 'earnings' && CARD_PAYMENTS) body = stripeEarnings(u);
  else if (tab === 'earnings') { const pays = db.payouts.filter(p => p.userId === u.id); body = `<h1>Earnings & payouts</h1>
    <div class="kpis"><div class="kpi"><div class="muted small">Available</div><div class="v">${money(u.balance)}</div></div><div class="kpi"><div class="muted small">Pending payouts</div><div class="v">${money(pays.filter(p => p.status === 'pending').reduce((a, p) => a + p.amount, 0))}</div></div><div class="kpi"><div class="muted small">Withdrawn</div><div class="v">${money(pays.filter(p => p.status === 'paid').reduce((a, p) => a + p.amount, 0))}</div></div><div class="kpi"><div class="muted small">Platform fee</div><div class="v">${PLATFORM_FEE * 100}%</div></div></div>
    <div class="card card-pad" style="margin-bottom:20px"><div class="list-item"><div><b>Withdraw your earnings</b><div class="small muted">Payouts via ${PAYOUT_METHODS.join(', ')}. Earnings become available once a buyer confirms the job objectives were met.</div></div><button class="btn btn-primary" data-action="payout" ${u.balance < MIN_PAYOUT ? 'disabled' : ''}>Request payout</button></div></div>
    <div class="card card-pad"><h3>Payout history</h3>${pays.length ? pays.map(p => `<div class="list-item"><div><b>${money(p.amount)}</b> via ${esc(p.method)}<div class="small muted">${esc(p.details)} · ${ago(p.date)}</div></div>${statusTag(p.status)}</div>`).join('') : '<p class="muted">No payouts yet.</p>'}</div>`; }
  if (tab === 'verification') { const v = u.verification; body = `<h1>Identity verification</h1><div class="card card-pad">
    ${v.status === 'verified' ? '<p class="verified" style="font-size:1.1rem">✓ Your identity is verified. The verified badge is shown on your profile.</p>' : v.status === 'pending' ? `<p><span class="tag">Under review</span></p><p class="muted">You submitted your ${esc(v.docType)} (${esc(v.fileName)}) ${ago(v.submitted)}. An administrator will review it soon.</p>` : `
    ${v.status === 'rejected' ? `<p class="tag orange">Previous submission was rejected${v.reason ? ': ' + esc(v.reason) : ''}</p>` : ''}
    <p class="muted">Upload a clear photo of your passport, driving license or ID card. Our admins verify it manually; only admins can see your document, and it is deleted as soon as it has been reviewed. <a href="#/privacy">Privacy Policy</a></p>
    <form id="verify-form"><div class="field"><label>Document type</label><select name="docType"><option>Passport</option><option>Driving license</option><option>ID card</option></select></div>
    <div class="field"><label>Document (JPG, PNG, WEBP or PDF, max 5 MB)</label><input type="file" name="doc" accept="image/*,.pdf" required></div>
    <button class="btn btn-primary">Submit for verification</button></form>`}</div>`; }
  if (tab === 'settings') body = `<h1>Profile settings</h1><form class="card card-pad" id="settings-form">
    <div class="row"><div class="field"><label>Name</label><input name="name" value="${esc(u.name)}" required></div><div class="field"><label>Email</label><input name="email" type="email" value="${esc(u.email)}" required></div></div>
    <div class="field"><label>Headline</label><input name="title" value="${esc(u.title)}"></div>
    <h3 style="margin-top:8px">📍 Your location</h3><p class="small muted" style="margin-top:-4px">Customers search by city and area, so freelancers nearby are shown first.</p>
    ${locationFields(u.city || '', u.area || '', { required: true })}
    <label class="filter-opt" style="margin-bottom:12px"><input type="checkbox" name="isFreelancer" ${u.isFreelancer ? 'checked' : ''}> I offer services as a freelancer (show me in “Find freelancers”)</label>
    <div class="row"><div class="field"><label>Main service category</label><select name="category">${CATEGORIES.map(c => `<option value="${c.id}" ${u.category === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>
      <div class="field"><label>Hourly rate (€)</label><input name="rate" type="number" min="0" step="1" value="${u.rate || ''}"></div></div>
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

V.admin = () => {
  const u = me(); if (!u || u.role !== 'admin') return `<div class="container">${empty('⛔', 'Admins only. Log in with an administrator account.', '<button class="btn btn-primary" data-action="login">Log in</button>')}</div>`;
  const pending = db.users.filter(x => x.verification.status === 'pending'), pays = db.payouts.filter(p => p.status === 'pending');
  const gmv = (db.adminStats || {}).gmv || 0;
  return `<div class="container" style="padding-top:36px"><h1>Admin panel</h1>
    <div class="kpis"><div class="kpi"><div class="muted small">Users</div><div class="v">${db.users.length}</div></div><div class="kpi"><div class="muted small">Services</div><div class="v">${db.services.length}</div></div><div class="kpi"><div class="muted small">Projects</div><div class="v">${db.projects.length}</div></div><div class="kpi"><div class="muted small">Gross volume</div><div class="v">${money(gmv)}</div></div></div>
    <div class="card card-pad" style="margin-bottom:20px"><h3>Identity verification queue (${pending.length})</h3>
      ${pending.length ? pending.map(x => `<div class="list-item"><div style="display:flex;gap:12px;align-items:center">${avatar(x)}<div><b>${esc(x.name)}</b> <span class="muted small">${esc(x.email)}</span><div class="small muted">${esc(x.verification.docType)} · ${esc(x.verification.fileName)} · ${ago(x.verification.submitted)}</div></div></div>
      <div style="display:flex;gap:8px">${x.verification.hasDoc ? `<button class="btn btn-ghost btn-sm" data-action="view-doc" data-id="${x.id}">View document</button>` : '<span class="small muted">(file missing)</span>'}<button class="btn btn-outline btn-sm" data-action="verify" data-id="${x.id}" data-ok="0">Reject</button><button class="btn btn-primary btn-sm" data-action="verify" data-id="${x.id}" data-ok="1">Approve</button></div></div>`).join('') : '<p class="muted">No pending verifications.</p>'}</div>
    ${CARD_PAYMENTS ? `<div class="card card-pad" style="margin-bottom:20px"><h3>Card payments (${(db.payments || []).length})</h3><p class="small muted" style="margin-top:-4px">Refunds and disputes are handled in the <a href="https://dashboard.stripe.com/payments" target="_blank" rel="noopener">Stripe dashboard</a>.</p>
      ${(db.payments || []).length ? db.payments.slice(0, 50).map(p => `<div class="list-item"><div><b>#${p.id}</b> ${esc(user(p.buyerId).name)} → ${esc(user(p.sellerId).name)}<div class="small muted">${p.kind === 'order' ? 'Service order' : 'Project'} · fee ${money(p.fee)} · ${ago(p.created)}</div></div><div style="display:flex;gap:10px;align-items:center"><b>${money(p.amount)}</b>${statusTag(p.status)}</div></div>`).join('') : '<p class="muted">No payments yet.</p>'}</div>` : ''}
    <div class="card card-pad" style="margin-bottom:20px"><h3>Payout requests (${pays.length})</h3>
      ${pays.length ? pays.map(p => `<div class="list-item"><div><b>${esc(user(p.userId).name)}</b> — ${money(p.amount)} via ${esc(p.method)}<div class="small muted">${esc(p.details)} · ${ago(p.date)}</div></div><button class="btn btn-primary btn-sm" data-action="mark-paid" data-id="${p.id}">Mark as paid</button></div>`).join('') : '<p class="muted">No pending payouts.</p>'}</div>
    <div class="card card-pad"><h3>Contact form messages (${db.contacts.length})</h3>${db.contacts.length ? db.contacts.map(c => `<div class="list-item"><div><b>${esc(c.name)}</b> <span class="muted small">${esc(c.email)} · ${ago(c.date)}</span><p style="margin:4px 0 0">${esc(c.message)}</p></div></div>`).join('') : '<p class="muted">No messages.</p>'}</div></div>`;
};

V.about = () => `<div class="page-head"><div class="container"><h1>About Worklay</h1><p>A marketplace built on trust, fair prices and simple tools.</p></div></div>
  <div class="prose"><p>Worklay is a platform that connects people who need help with tasks and projects with freelancers and professionals looking for work. Post what you need and receive proposals, or choose a ready-made service package at a clear price.</p>
  <p>We verify identities, hold payments until job objectives are met, and pay professionals out through PayPal, Payoneer or bank transfer.</p></div>
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

V.blog = () => `<div class="page-head"><div class="container"><h1>Worklay Blog</h1><p>Tips for buyers and freelancers.</p></div></div>
  <div class="container" style="padding-top:36px"><div class="grid">${db.posts.map(p => `<a class="card svc-card" href="#/blog/${p.id}"><div class="blog-cover" style="background:${p.color}">${p.emoji}</div><div class="svc-body"><span class="small muted">${monthYear(p.date)}</span><span class="svc-title">${esc(p.title)}</span><p class="muted small" style="margin:0">${esc(p.excerpt)}</p></div></a>`).join('')}</div></div>`;
V.blogPost = ([id]) => { const p = db.posts.find(x => x.id === id); if (!p) return V.notFound();
  return `<article class="prose"><a href="#/blog">← Blog</a><div class="blog-cover" style="background:${p.color};border-radius:16px;margin:16px 0">${p.emoji}</div><span class="muted small">${monthYear(p.date)}</span><h1>${esc(p.title)}</h1>${p.body.map(x => `<p>${esc(x)}</p>`).join('')}</article>`; };

V.notFound = () => `<div class="container">${empty('🧭', 'Page not found.', '<a class="btn btn-primary" href="#/">Go home</a>')}</div>`;

/* ---------- router ---------- */
const ROUTES = { '': V.home, freelancers: V.freelancers, services: V.services, projects: V.projects, service: V.service, project: V.project, user: V.user, 'post-project': V.postProject, 'post-service': V.postService, dashboard: V.dashboard, notifications: V.notifications, messages: V.messages, wishlist: V.wishlist, admin: V.admin, about: V.about, contact: V.contact, privacy: () => privacyPage(lang), cookies: () => cookiesPage(lang), blog: (a, q) => a.length ? V.blogPost(a, q) : V.blog() };
function parseHash() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  return { name: parts[0] || '', args: parts.slice(1), q: Object.fromEntries(new URLSearchParams(qs || '')) };
}
function render() {
  if (!db) return;
  const { name, args, q } = parseHash();
  const view = ROUTES[name] || V.notFound;
  renderHeader();
  try { $('#app').innerHTML = view(args, q); }
  catch (err) {
    console.error(err);
    $('#app').innerHTML = `<div class="container">${empty('⚠️', 'Something went wrong showing this page.', '<a class="btn btn-primary" href="#/">Go to homepage</a>')}</div>`;
  }
  document.querySelectorAll('.mainnav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#/' + name));
  $('#mainnav').classList.remove('open');
  const cb = $('#chat-body'); if (cb) cb.scrollTop = cb.scrollHeight;
}
let lastRoute = '';
window.addEventListener('hashchange', () => { const r = location.hash.split('?')[0]; render(); if (r !== lastRoute) window.scrollTo(0, 0); lastRoute = r; });

/* ---------- actions (event delegation) ---------- */
const go = h => { location.hash = h; };
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
    if (key === 'cat') setQuery({ cat: (q.cat || '').split(',').filter(c => c && c !== val).join(',') });
    else if (key === 'city') setQuery({ city: '', area: '' });
    else setQuery({ [key]: '' }); },
  'toggle-pw': el => { const i = el.parentElement.querySelector('input'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? 'Hide' : 'Show'; },
  'near-me': () => { const u = me(); setQuery({ city: u.city, area: u.area }); },
  widen: () => setQuery({ area: '' }),
  'auth-tab': el => openAuth(el.dataset.mode),
  'close-modal': () => closeModal(),
  'close-modal-bg': (el, e) => { if (e.target === el) closeModal(); },
  'toggle-dd': () => $('#userdd').classList.toggle('open'),
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
  verify: el => { const ok = el.dataset.ok === '1'; let reason = '';
    if (!ok) { reason = prompt('Reason for rejection (shown to the user):', 'Document image is unreadable'); if (reason === null) return; }
    act('admin/verify', { id: el.dataset.id, ok, reason }, ok ? 'User verified ✓' : 'Verification rejected'); },
  'view-doc': el => { const v = user(el.dataset.id).verification, url = apiUrl('admin/doc', '&id=' + encodeURIComponent(el.dataset.id));
    modal(`<h2>${esc(v.docType)}</h2><p class="muted">${esc(v.fileName)}</p><img src="${url}" alt="" style="border-radius:12px;width:100%;margin-bottom:12px">
      <a class="btn btn-outline btn-sm" href="${url}" target="_blank" rel="noopener">Open in new tab</a><p class="small muted">The document is deleted from the server once you approve or reject it.</p>`); },
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
document.addEventListener('change', e => {
  if (e.target.dataset.action === 'sort') setQuery({ sort: e.target.value });
  if (e.target.dataset.role === 'city') { // refill the area list for the chosen city
    const areaSel = e.target.form && e.target.form.querySelector('[data-role="area"]'); if (!areaSel) return;
    const areas = CITIES[e.target.value] || [];
    areaSel.innerHTML = `<option value="">${areaSel.dataset.any ? 'All areas' : 'Select area'}</option>` + areas.map(a => `<option>${a}</option>`).join('');
    areaSel.disabled = !areas.length;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    const picker = $('#language-picker');
    if (picker) {
      picker.classList.remove('open');
      picker.querySelector('.language-toggle').setAttribute('aria-expanded', 'false');
    }
  }
});

/* ---------- forms ---------- */
document.addEventListener('submit', e => {
  const form = e.target, f = new FormData(form), id = form.id;
  const handlers = {
    'cookie-form': () => saveConsent(Object.fromEntries(OPTIONAL_CATEGORIES.map(k => [k, !!f.get(k)]))),
    'hero-search': () => { const q = { q: f.get('q'), city: f.get('city') }; Object.keys(q).forEach(k => !q[k] && delete q[k]); go(`#/${f.get('type')}?` + new URLSearchParams(q)); },
    filters: () => { const q = { q: f.get('q'), city: f.get('city'), area: f.get('city') ? f.get('area') : '', remote: f.get('remote'), cat: f.getAll('cat').join(','), min: f.get('min'), max: f.get('max'), verified: f.get('verified'), open: f.get('open') };
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
    'settings-form': () => act('profile/update', { name: f.get('name'), email: f.get('email'), title: f.get('title'), city: f.get('city'), area: f.get('area'), isFreelancer: !!f.get('isFreelancer'), category: f.get('category'), rate: f.get('rate'), bio: f.get('bio'), skills: f.get('skills') }, 'Profile saved'),
    'contact-form': () => act('contact/send', { name: f.get('name'), email: f.get('email'), subject: f.get('subject'), message: f.get('message') },
      'Thanks! We’ll get back to you within one business day.', { after: () => form.reset() }),
    'verify-form': () => { const file = f.get('doc'); if (!file || !file.size) return toast('Please choose a file.');
      if (file.size > 5 * 1024 * 1024) return toast('The file is too large (max 5 MB).');
      act('verification/submit', f, 'Document submitted. We’ll notify you when it’s reviewed.'); },
  };
  if (handlers[id]) { e.preventDefault(); handlers[id](); }
});

/* ---------- boot ---------- */
[lang] = detectLang();
document.documentElement.lang = lang;
renderCookieBanner();
tickClock();
{ const c = readConsent(); if (c) { activateConsentedScripts(c); window.dispatchEvent(new CustomEvent('worklay:consent', { detail: { ...c } })); } }
$('#burger').onclick = () => $('#mainnav').classList.toggle('open');
$('#year').textContent = new Date().getFullYear();
lastRoute = location.hash.split('?')[0];
$('#app').innerHTML = `<div class="container" style="padding-top:40px" aria-busy="true"><div class="skeleton" style="height:56px;max-width:520px;margin-bottom:16px"></div><div class="skeleton" style="height:22px;max-width:380px;margin-bottom:36px"></div><div class="grid">${'<div class="skeleton" style="height:230px"></div>'.repeat(4)}</div></div>`;
refresh().then(() => { render(); handleGoogleReturn(); }, err => {
  $('#app').innerHTML = `<div class="container">${empty('⚠️', esc(err.message), '<button class="btn btn-primary" onclick="location.reload()">Try again</button>')}</div>`;
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
