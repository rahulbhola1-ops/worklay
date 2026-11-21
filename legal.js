/* Legal pages (privacy policy, cookie policy) and the cookie inventory.
   Fill in the bracketed [placeholders] in LEGAL before going live, and keep COOKIES
   in sync with what the site actually stores in the browser. */

export const LEGAL = {
  company: '[Company name OÜ]',
  regCode: '[registry code]',
  address: '[registered address], Estonia',
  email: 'support@worklay.com',
  hosting: '[hosting provider and country, e.g. Hetzner Online GmbH, Germany]',
  updated: '2026-11-21',
};

/* Everything Worklay stores in the visitor's browser. `category` must match a consent
   category: 'necessary' is always allowed, anything else needs opt-in consent. */
export const COOKIES = [
  { name: 'worklay_auth', type: 'cookie', category: 'necessary', duration: { en: '30 days', et: '30 päeva' },
    purpose: { en: 'Keeps you logged in after you sign in. HttpOnly, only sent to Worklay.', et: 'Hoiab sind pärast sisselogimist sisse logituna. HttpOnly, saadetakse ainult Worklayle.' } },
  { name: 'worklay_oauth', type: 'cookie', category: 'necessary', duration: { en: '10 minutes', et: '10 minutit' },
    purpose: { en: 'Only set when you sign in with Google. Protects the sign-in against forgery and is deleted when you return.', et: 'Seatakse ainult Google’iga sisselogimisel. Kaitseb sisselogimist võltsimise eest ja kustutatakse, kui naased.' } },
  { name: 'worklay-lang', type: 'localStorage', category: 'necessary', duration: { en: 'Until you clear it', et: 'Kuni kustutad' },
    purpose: { en: 'Remembers the language you chose.', et: 'Jätab meelde sinu valitud keele.' } },
  { name: 'worklay-consent', type: 'localStorage', category: 'necessary', duration: { en: '6 months', et: '6 kuud' },
    purpose: { en: 'Remembers your cookie choices so we don’t ask again on every visit.', et: 'Jätab meelde sinu küpsiste valikud, et me ei küsiks igal külastusel uuesti.' } },
];

const fmtDate = (iso, lang) => new Date(iso).toLocaleDateString(lang === 'et' ? 'et-EE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const head = (title, lead) => `<div class="page-head"><div class="container"><h1>${title}</h1><p>${lead}</p></div></div>`;

export function cookieTable(lang) {
  const L = lang === 'et'
    ? { name: 'Nimi', type: 'Tüüp', purpose: 'Eesmärk', duration: 'Kestus' }
    : { name: 'Name', type: 'Type', purpose: 'Purpose', duration: 'Duration' };
  return `<div class="legal-table-wrap"><table class="legal-table"><thead><tr><th>${L.name}</th><th>${L.type}</th><th>${L.purpose}</th><th>${L.duration}</th></tr></thead><tbody>
    ${COOKIES.map(c => `<tr><td><code>${c.name}</code></td><td>${c.type}</td><td>${c.purpose[lang] || c.purpose.en}</td><td>${c.duration[lang] || c.duration.en}</td></tr>`).join('')}
  </tbody></table></div>`;
}

/* ---------- Privacy policy ---------- */
export function privacyPage(lang) {
  const d = fmtDate(LEGAL.updated, lang), m = `<a href="mailto:${LEGAL.email}">${LEGAL.email}</a>`;
  if (lang === 'et') return `${head('Privaatsuspoliitika', `Viimati uuendatud ${d}`)}
  <article class="prose legal">
    <p>See poliitika selgitab, milliseid isikuandmeid Worklay kogub, miks me neid kasutame, kellega neid jagame ja millised õigused sul on. Kohaldame isikuandmete kaitse üldmäärust (GDPR) ja Eesti õigust.</p>

    <h2>1. Kes me oleme</h2>
    <p>Vastutav töötleja on <b>${LEGAL.company}</b> (registrikood ${LEGAL.regCode}), ${LEGAL.address}. Privaatsusküsimustes kirjuta ${m}.</p>

    <h2>2. Milliseid andmeid me kogume</h2>
    <ul>
      <li><b>Kontoandmed:</b> nimi, e-post, parool (salvestame ainult räsi), linn ja piirkond ning kas palkad või töötad vabakutselisena. Kui registreerud Google’i kontoga, saame Google’ilt sinu nime, e-posti aadressi ja Google’i konto ID; sinu Google’i parooli me ei näe.</li>
      <li><b>Profiiliandmed:</b> ametinimetus, tutvustus, oskused, põhikategooria ja tunnihind, kui need lisad.</li>
      <li><b>Isikusamasuse kontroll:</b> dokumendi tüüp, failinimi ja üleslaaditud passi, juhiloa või ID-kaardi pilt.</li>
      <li><b>Sinu loodud sisu:</b> projektid, teenused, pakkumised, tellimused, arvustused, sõnumid, soovinimekiri ja jälgimised.</li>
      <li><b>Makse- ja väljamakseandmed:</b> tellimuste summad, saldo ja väljamaksetaotlused koos valitud meetodi ja andmetega (nt PayPali e-post või IBAN).</li>
      <li><b>Kontaktivorm:</b> nimi, e-post, teema ja sõnum.</li>
      <li><b>Tehnilised andmed:</b> sisselogimisseansi küpsis ja keele-eelistus. Meie majutusteenuse pakkuja võib turvalisuse tagamiseks lühiajaliselt logida IP-aadresse.</li>
    </ul>

    <h2>3. Miks me andmeid kasutame ja õiguslik alus</h2>
    <ul>
      <li><b>Lepingu täitmine (GDPR art 6 lg 1 p b):</b> konto pidamine, turuplatsi toimimine, sõnumid, tellimused, maksed ja väljamaksed.</li>
      <li><b>Õigustatud huvi (art 6 lg 1 p f):</b> isikusamasuse kontroll ja usaldusmärgid, pettuste ja kuritarvituste ennetamine, teenuse turvalisus ning kontaktivormile vastamine.</li>
      <li><b>Juriidiline kohustus (art 6 lg 1 p c):</b> raamatupidamisdokumentide säilitamine ja ametiasutuste päringutele vastamine.</li>
      <li><b>Nõusolek (art 6 lg 1 p a):</b> valikulised küpsised, kui neid kasutusele võtame. Nõusoleku saad igal ajal tagasi võtta.</li>
    </ul>
    <p>Me ei müü sinu andmeid ega kasuta neid automatiseeritud otsusteks, millel on sulle õiguslik mõju.</p>

    <h2>4. Kes sinu andmeid näeb</h2>
    <ul>
      <li><b>Kõik külastajad:</b> sinu avalik profiil (nimi, ametinimetus, linn ja piirkond, tutvustus, oskused, hind, arvustused, kontrollitud märk) ning sinu postitatud projektid ja teenused. Sinu e-post ei ole avalik.</li>
      <li><b>Teised kasutajad:</b> sõnumid näeb ainult adressaat; pakkumisi ja tellimusi näevad tehingu osapooled.</li>
      <li><b>Worklay administraatorid:</b> näevad isikusamasuse dokumente, väljamaksetaotlusi ja kontaktivormi sõnumeid ainult nende menetlemiseks.</li>
      <li><b>Volitatud töötlejad:</b> majutusteenuse pakkuja (${LEGAL.hosting}), kes töötleb andmeid ainult meie juhiste järgi.</li>
      <li><b>Google:</b> kui kasutad Google’iga sisselogimist, suuname sind Google’i lehele ja Google töötleb sinu sisselogimist iseseisva vastutava töötlejana vastavalt oma privaatsuspoliitikale.</li>
      <li><b>Makseteenuse pakkujad:</b> PayPal, Payoneer või sinu pank saavad väljamakse tegemiseks vajalikud andmed ja töötlevad neid iseseisva vastutava töötlejana.</li>
      <li><b>Ametiasutused:</b> kui seadus seda nõuab.</li>
    </ul>

    <h2>5. Andmete edastamine väljapoole EMP-d</h2>
    <p>Hoiame andmeid Euroopa Majanduspiirkonnas. Kui kasutad Google’iga sisselogimist või valid väljamakse PayPali või Payoneeri kaudu, võivad need ettevõtted andmeid edastada väljapoole EMP-d, kasutades oma kaitsemeetmeid (nt Euroopa Komisjoni tüüptingimusi).</p>

    <h2>6. Kui kaua me andmeid hoiame</h2>
    <ul>
      <li><b>Isikusamasuse dokumendi pilt:</b> kustutatakse kohe, kui administraator selle kinnitab või tagasi lükkab. Alles jääb ainult kontrolli tulemus.</li>
      <li><b>Konto, profiil ja sisu:</b> kuni sul on konto. Pärast konto sulgemist kustutame või anonüümime need 30 päeva jooksul, välja arvatud allpool nimetatu.</li>
      <li><b>Tehingu- ja väljamakseandmed:</b> 7 aastat, nagu nõuab raamatupidamise seadus.</li>
      <li><b>Kontaktivormi sõnumid:</b> kuni 12 kuud.</li>
      <li><b>Sisselogimisseanss:</b> aegub 30 päeva pärast või väljalogimisel.</li>
    </ul>

    <h2>7. Kuidas me andmeid kaitseme</h2>
    <p>Paroolid ja seansitokenid salvestatakse ainult räsidena, sisselogimisküpsis on HttpOnly ja SameSite-kaitsega ning isikusamasuse dokumentidele pääsevad ligi ainult administraatorid. Ükski süsteem pole täiesti turvaline. Kui juhtub andmeleke, teavitame sind ja järelevalveasutust, nagu seadus nõuab.</p>

    <h2>8. Sinu õigused</h2>
    <p>Sul on õigus oma andmetega tutvuda, neid parandada või kustutada, nende töötlemist piirata, saada need masinloetaval kujul (andmete ülekantavus), esitada vastuväiteid õigustatud huvil põhinevale töötlemisele ning võtta nõusolek tagasi. Enamikku profiiliandmeid saad muuta profiili seadetes. Muude taotlustega kirjuta ${m}; vastame ühe kuu jooksul.</p>
    <p>Kaebuse saad esitada <a href="https://www.aki.ee" target="_blank" rel="noopener">Andmekaitse Inspektsioonile</a> (Tatari 39, 10134 Tallinn, info@aki.ee) või oma elukohariigi järelevalveasutusele.</p>

    <h2>9. Küpsised</h2>
    <p>Kasutame ainult küpsiseid ja brauseri salvestusruumi, mis on saidi toimimiseks vajalikud. Täpsem info on <a href="#/cookies">küpsiste poliitikas</a>. Oma valikuid saad muuta <a href="#" data-action="cookie-settings">küpsiste seadetes</a>.</p>

    <h2>10. Vanusepiirang</h2>
    <p>Worklay on mõeldud vähemalt 18-aastastele. Me ei kogu teadlikult alaealiste andmeid. Kui arvad, et alaealine on meile andmeid esitanud, võta meiega ühendust.</p>

    <h2>11. Muudatused</h2>
    <p>Kui seda poliitikat muudame, uuendame ülaltoodud kuupäeva. Olulistest muudatustest teavitame saidil või e-posti teel.</p>

    <h2>12. Kontakt</h2>
    <p>${LEGAL.company}, ${LEGAL.address}. E-post: ${m}.</p>
  </article>`;

  return `${head('Privacy Policy', `Last updated ${d}`)}
  <article class="prose legal">
    <p>This policy explains what personal data Worklay collects, why we use it, who we share it with and what rights you have. We apply the EU General Data Protection Regulation (GDPR) and Estonian law.</p>

    <h2>1. Who we are</h2>
    <p>The data controller is <b>${LEGAL.company}</b> (registry code ${LEGAL.regCode}), ${LEGAL.address}. For privacy questions, email ${m}.</p>

    <h2>2. What data we collect</h2>
    <ul>
      <li><b>Account data:</b> name, email, password (we only store a hash), city and area, and whether you hire or work as a freelancer. If you sign up with Google, we receive your name, email address and Google account ID from Google; we never see your Google password.</li>
      <li><b>Profile data:</b> headline, bio, skills, main category and rate, if you add them.</li>
      <li><b>Identity verification:</b> document type, file name and the image of your passport, driving license or ID card that you upload.</li>
      <li><b>Content you create:</b> projects, services, proposals, orders, reviews, messages, wishlist items and follows.</li>
      <li><b>Payment and payout data:</b> order amounts, your balance and payout requests with the method and details you provide (e.g. PayPal email or IBAN).</li>
      <li><b>Contact form:</b> name, email, subject and message.</li>
      <li><b>Technical data:</b> a login session cookie and your language preference. Our hosting provider may briefly log IP addresses for security.</li>
    </ul>

    <h2>3. Why we use your data and our legal bases</h2>
    <ul>
      <li><b>Performing our contract with you (GDPR Art. 6(1)(b)):</b> running your account and the marketplace, messaging, orders, payments and payouts.</li>
      <li><b>Legitimate interests (Art. 6(1)(f)):</b> identity verification and trust badges, preventing fraud and abuse, keeping the service secure and replying to contact requests.</li>
      <li><b>Legal obligations (Art. 6(1)(c)):</b> keeping accounting records and responding to lawful requests from authorities.</li>
      <li><b>Consent (Art. 6(1)(a)):</b> optional cookies, if we ever introduce them. You can withdraw consent at any time.</li>
    </ul>
    <p>We do not sell your data and do not use it for automated decisions that have legal effects on you.</p>

    <h2>4. Who can see your data</h2>
    <ul>
      <li><b>Everyone:</b> your public profile (name, headline, city and area, bio, skills, rate, reviews, verified badge) and the projects and services you post. Your email is not public.</li>
      <li><b>Other members:</b> messages are visible only to the recipient; proposals and orders are visible to the parties involved.</li>
      <li><b>Worklay administrators:</b> see verification documents, payout requests and contact messages only to handle them.</li>
      <li><b>Processors:</b> our hosting provider (${LEGAL.hosting}), which processes data only on our instructions.</li>
      <li><b>Google:</b> if you use Sign in with Google, we send you to Google’s page, and Google handles that sign-in as an independent controller under its own privacy policy.</li>
      <li><b>Payment providers:</b> PayPal, Payoneer or your bank receive the details needed to send a payout and handle them as independent controllers.</li>
      <li><b>Authorities:</b> when the law requires it.</li>
    </ul>

    <h2>5. Transfers outside the EEA</h2>
    <p>We store data in the European Economic Area. If you sign in with Google or choose a payout via PayPal or Payoneer, those companies may transfer data outside the EEA using their own safeguards (such as the European Commission’s Standard Contractual Clauses).</p>

    <h2>6. How long we keep your data</h2>
    <ul>
      <li><b>Identity document image:</b> deleted as soon as an administrator approves or rejects it. Only the result of the check is kept.</li>
      <li><b>Account, profile and content:</b> while you have an account. After you close it we delete or anonymise it within 30 days, except as listed below.</li>
      <li><b>Transaction and payout records:</b> 7 years, as required by the Estonian Accounting Act.</li>
      <li><b>Contact form messages:</b> up to 12 months.</li>
      <li><b>Login session:</b> expires after 30 days or when you log out.</li>
    </ul>

    <h2>7. How we protect your data</h2>
    <p>Passwords and session tokens are stored only as hashes, the login cookie is HttpOnly and SameSite-protected, and only administrators can access verification documents. No system is perfectly secure; if a breach occurs we will notify you and the supervisory authority as the law requires.</p>

    <h2>8. Your rights</h2>
    <p>You have the right to access, correct or delete your data, restrict its processing, receive it in a machine-readable format (portability), object to processing based on legitimate interests, and withdraw consent. You can change most profile data in your profile settings. For anything else, email ${m}; we reply within one month.</p>
    <p>You can complain to the <a href="https://www.aki.ee" target="_blank" rel="noopener">Estonian Data Protection Inspectorate</a> (Andmekaitse Inspektsioon, Tatari 39, 10134 Tallinn, info@aki.ee) or the supervisory authority in your country.</p>

    <h2>9. Cookies</h2>
    <p>We only use cookies and browser storage that the site needs to work. See the <a href="#/cookies">Cookie Policy</a> for details, and change your choices in <a href="#" data-action="cookie-settings">cookie settings</a>.</p>

    <h2>10. Age requirement</h2>
    <p>Worklay is intended for people aged 18 or over. We do not knowingly collect data from minors. If you believe a minor has given us their data, please contact us.</p>

    <h2>11. Changes</h2>
    <p>When we change this policy we update the date above. We will tell you about significant changes on the site or by email.</p>

    <h2>12. Contact</h2>
    <p>${LEGAL.company}, ${LEGAL.address}. Email: ${m}.</p>
  </article>`;
}

/* ---------- Cookie policy ---------- */
export function cookiesPage(lang) {
  const d = fmtDate(LEGAL.updated, lang);
  if (lang === 'et') return `${head('Küpsiste poliitika', `Viimati uuendatud ${d}`)}
  <article class="prose legal">
    <p>Küpsised ja brauseri salvestusruum (localStorage) on väikesed andmekogumid, mida sait sinu seadmesse salvestab. Siin on kirjas kõik, mida Worklay salvestab.</p>
    <h2>Hädavajalikud</h2>
    <p>Need on vajalikud sisselogimiseks ja sinu valikute meelespidamiseks. Kuna sait ilma nendeta ei tööta, ei küsi me nende jaoks nõusolekut, kuid anname neist teada.</p>
    ${cookieTable('et')}
    <h2>Analüütika</h2>
    <p>Praegu me analüütika- ega reklaamiküpsiseid <b>ei kasuta</b>. Kui need tulevikus kasutusele võtame, lisame need siia ja aktiveerime ainult sinu nõusolekul.</p>
    <h2>Kolmandad osapooled</h2>
    <p>Worklay ei laadi kolmandate osapoolte skripte, fonte ega jälgijaid. Kui valid Google’iga sisselogimise, suuname sind Google’i lehele, kus kehtivad Google’i enda küpsised ja privaatsuspoliitika.</p>
    <h2>Valikute muutmine</h2>
    <p>Saad oma valikuid igal ajal muuta või nõusoleku tagasi võtta. Küpsiseid saad kustutada ka brauseri seadetes; kui kustutad <code>worklay_auth</code>, logitakse sind välja.</p>
    <p><button class="btn btn-primary" data-action="cookie-settings">Muuda küpsiste seadeid</button></p>
    <p>Lisateave isikuandmete kohta on <a href="#/privacy">privaatsuspoliitikas</a>.</p>
  </article>`;

  return `${head('Cookie Policy', `Last updated ${d}`)}
  <article class="prose legal">
    <p>Cookies and browser storage (localStorage) are small pieces of data a website saves on your device. This page lists everything Worklay stores.</p>
    <h2>Strictly necessary</h2>
    <p>These are needed to log you in and remember your choices. Because the site cannot work without them, we don’t ask for consent, but we tell you about them.</p>
    ${cookieTable('en')}
    <h2>Analytics</h2>
    <p>We currently use <b>no</b> analytics or advertising cookies. If we introduce them, we will list them here and only turn them on with your consent.</p>
    <h2>Third parties</h2>
    <p>Worklay does not load third-party scripts, fonts or trackers. If you choose Sign in with Google, you are sent to Google’s own page, where Google’s cookies and privacy policy apply.</p>
    <h2>Changing your choices</h2>
    <p>You can change your choices or withdraw consent at any time. You can also delete cookies in your browser settings; deleting <code>worklay_auth</code> logs you out.</p>
    <p><button class="btn btn-primary" data-action="cookie-settings">Change cookie settings</button></p>
    <p>For more about personal data, see the <a href="#/privacy">Privacy Policy</a>.</p>
  </article>`;
}
