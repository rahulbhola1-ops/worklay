/* Terms of Service for every country except Estonia (terms-page.js), in English.

   These are drafts. A country's page says so until a lawyer there has checked it and its code is added
   to REVIEWED below. When the text changes in a way people must agree to again, raise the country's
   version in terms.mjs. The text describes what the site does abroad: no online booking or payment. */
import { LEGAL } from './legal.js';
import { COUNTRIES } from './countries.mjs';
import { termsVersionFor } from './terms.mjs';

// Countries whose Terms a lawyer has approved, e.g. ['DE', 'FR'].
export const REVIEWED = [];

const EU = 'AT BE BG HR CY CZ DK FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ');
const EEA = ['IS', 'LI', 'NO'];

// Data protection authority | consumer authority or advice body ('' = not listed)
const BODIES = {
  AT: 'Datenschutzbehörde|Internet Ombudsstelle', BE: 'Data Protection Authority (APD/GBA)|FPS Economy', BG: 'Commission for Personal Data Protection|Commission for Consumer Protection',
  HR: 'AZOP|State Inspectorate', CY: 'Commissioner for Personal Data Protection|Consumer Protection Service', CZ: 'ÚOOÚ|Czech Trade Inspection Authority (ČOI)', DK: 'Datatilsynet|Forbrugerombudsmanden',
  FI: 'Data Protection Ombudsman|Competition and Consumer Authority (KKV)', FR: 'CNIL|DGCCRF', DE: 'the data protection authority of your federal state|Verbraucherzentrale', GR: 'Hellenic Data Protection Authority|Consumer Ombudsman',
  HU: 'NAIH|consumer protection authority', IE: 'Data Protection Commission|Competition and Consumer Protection Commission (CCPC)', IT: 'Garante per la protezione dei dati personali|AGCM', LV: 'Datu valsts inspekcija|PTAC',
  LT: 'State Data Protection Inspectorate (VDAI)|State Consumer Rights Protection Authority (VVTAT)', LU: 'CNPD|Union Luxembourgeoise des Consommateurs', MT: 'IDPC|MCCAA', NL: 'Autoriteit Persoonsgegevens|ACM (ConsuWijzer)', PL: 'UODO|UOKiK',
  PT: 'CNPD|Direção-Geral do Consumidor', RO: 'ANSPDCP|ANPC', SK: 'Office for Personal Data Protection|Slovak Trade Inspection (SOI)', SI: 'Information Commissioner|Market Inspectorate', ES: 'AEPD|your local consumer office (OMIC)', SE: 'IMY|Konsumentverket',
  IS: 'Persónuvernd|Neytendastofa', LI: 'Datenschutzstelle|', NO: 'Datatilsynet|Forbrukertilsynet', GB: 'Information Commissioner’s Office (ICO)|Citizens Advice', CH: 'FDPIC (EDÖB/PFPDT/IFPDT)|',
  AL: 'Information and Data Protection Commissioner|', AD: 'Agència Andorrana de Protecció de Dades|', BA: 'Personal Data Protection Agency|', XK: 'Information and Privacy Agency|', MD: 'National Center for Personal Data Protection|', MC: 'APDP|',
  ME: 'Agency for Personal Data Protection|', MK: 'Agency for Personal Data Protection|', SM: 'Autorità Garante per la protezione dei dati personali|', RS: 'Commissioner for Information of Public Importance and Personal Data Protection|', UA: 'Parliament Commissioner for Human Rights|',
  US: 'Federal Trade Commission or your state’s attorney general|Federal Trade Commission or your state’s attorney general', CA: 'Office of the Privacy Commissioner of Canada|the consumer protection office of your province or territory', AU: 'Office of the Australian Information Commissioner (OAIC)|ACCC or your state’s fair trading office',
  IN: 'Data Protection Board of India|National Consumer Helpline (1915)',
  JP: 'Personal Information Protection Commission|Consumer Hotline (188)', KR: 'Personal Information Protection Commission|Korea Consumer Agency (1372)', SG: 'Personal Data Protection Commission|CASE', TH: 'Personal Data Protection Committee|Office of the Consumer Protection Board',
  PH: 'National Privacy Commission|Department of Trade and Industry', MY: 'Personal Data Protection Department|Tribunal for Consumer Claims', TR: 'KVKK|consumer arbitration committees', IL: 'Privacy Protection Authority|Consumer Protection and Fair Trade Authority', SA: 'SDAIA|', GE: 'Personal Data Protection Service|',
  AM: 'Personal Data Protection Agency|', KZ: '|', LK: '|Consumer Affairs Authority', BD: '|Directorate of National Consumers’ Right Protection',
};

const consumer = c => {
  if (EU.includes(c.code) || EEA.includes(c.code)) return `<p>If you are a consumer and the freelancer acts as a business, you usually have 14 days to withdraw from a contract made online. If you ask for the service to start within that time, you may have to pay for the part already done, and the right ends once the service has been fully provided. There are exceptions, for example for leisure services on a specific date.</p>`;
  return { GB: `<p>If you are a consumer and the freelancer acts as a trader, you usually have 14 days to cancel a service contract made online. If you ask for the service to start within that time, you may have to pay for the part already done. Services must be carried out with reasonable care and skill.</p>`,
    US: `<p>Your rights depend on federal law and the law of your state. These terms don’t require arbitration and don’t take away your right to join a class action.</p>`,
    CA: `<p>Your rights depend on the law of your province or territory. <b>Quebec:</b> a French version of these terms must be made available to you before you agree to them, and Quebec’s consumer protection law applies to consumers living there.</p>`,
    AU: `<p>Services come with guarantees under the Australian Consumer Law that cannot be excluded, including that they are provided with due care and skill. Nothing in these terms limits them.</p>`,
    IN: `<p>You have the rights given by the Consumer Protection Act 2019 and the rules made under it. Grievance officer: [name, address, email and phone of the grievance officer].</p>`,
    CH: `<p>Swiss law has no general right to withdraw from services booked online. Agree on cancellation with the freelancer beforehand.</p>` }[c.code] || `<p>You have the rights that the consumer protection law of ${c.name} gives you.</p>`;
};
const privacy = c => (EU.includes(c.code) || EEA.includes(c.code) ? 'the General Data Protection Regulation (GDPR)'
  : { GB: 'the UK GDPR and the Data Protection Act 2018', CH: 'the Federal Act on Data Protection', US: 'the privacy laws of the United States and your state', CA: 'PIPEDA and provincial privacy laws', AU: 'the Privacy Act 1988', JP: 'the Act on the Protection of Personal Information', KR: 'the Personal Information Protection Act', SG: 'the Personal Data Protection Act 2012', TH: 'the Personal Data Protection Act', PH: 'the Data Privacy Act of 2012', TR: 'Law No. 6698 on the Protection of Personal Data', IN: 'the Digital Personal Data Protection Act 2023' }[c.code] || `the data protection law of ${c.name}`);

export function termsWorld(code) {
  const c = COUNTRIES[code], [dpa, body] = (BODIES[code] || '|').split('|'), eu = EU.includes(code);
  const mail = `<a href="mailto:${LEGAL.email}">${LEGAL.email}</a>`, li = x => `<ul>${x.map(i => `<li>${i}</li>`).join('')}</ul>`;
  const date = new Date(termsVersionFor(code).split(':')[1] + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const sections = [
    ['Who we are', `<p>Worklay is run by <b>${LEGAL.company}</b> (Estonian registry code ${LEGAL.regCode}), ${LEGAL.address}. Contact: ${mail}. These terms are for people using Worklay in <b>${c.name}</b>. By creating an account you agree to them and confirm that you have read the <a href="#/privacy">Privacy Policy</a>.</p>`],
    ['What Worklay does', `<p>Worklay helps people who need work done (clients) and people who do it (freelancers) find each other by ${c.region}, city and area, see profiles and prices, post projects, send proposals and exchange messages.</p><p>Any contract for work is between the client and the freelancer. Worklay is not a party to it, does not provide the freelancers’ services and is not their employer.</p>`],
    ['Your country and account', li([`You chose ${c.name} as your country. You see people, services and projects in ${c.name}.`, 'You must be at least 18.', 'Give correct information and keep your password secret.', 'You are responsible for what is done through your account.'])],
    ['Freelancers', li(['You work independently and are responsible for your own registration, licences, insurance, taxes and the quality of your work.', `Follow the law of ${c.name}, including the rules for your trade.`, 'Describe your skills, prices and availability truthfully.', 'In some categories (such as cleaning, childcare, driving, and on-site categories created by freelancers) Worklay checks your documents before your profile is shown as verified. A check is not a guarantee of quality.'])],
    ['Prices and payment', `<p>Prices are shown in ${c.currency}. <b>Online booking and payment through Worklay are not available in ${c.name} yet.</b> Worklay does not take or hold any money and charges no fee here. Client and freelancer agree on the price, payment and cancellation directly. If online payment is introduced, we will tell you and ask you to accept new terms first.</p>`],
    ['Problems between you', `<p>Try to solve a problem with the other side first. You can report a person or content that breaks these terms to ${mail}. Worklay can remove content or close accounts, but cannot refund money it never received.</p>`],
    [`Consumer rights in ${c.name}`, `${consumer(c)}<p>Nothing in these terms takes away rights that mandatory law gives you.${body ? ` For help you can contact: ${body}.` : ''}${eu ? ' For a problem with a business in another EU country you can contact the European Consumer Centre in your country.' : ''}</p>`],
    [`Privacy in ${c.name}`, `<p>We handle personal data as described in the <a href="#/privacy">Privacy Policy</a>. You have the rights given by ${privacy(c)}${dpa ? ` and can complain to: ${dpa}` : ''}.</p>`],
    ['Taxes', `<p>Freelancers must declare and pay their own taxes in ${c.name}.${eu ? ' Platforms in the European Union may have to report sellers and their income to the tax authorities.' : ''}</p>`],
    ['What isn’t allowed', li([`Services or content that are illegal in ${c.name}, dangerous or misleading.`, 'Fake documents, reviews or identities.', 'Harassment, discrimination, spam or abuse of the system.'])],
    ['Content and reviews', `<p>What you post stays yours. You allow Worklay to show it in order to provide the service. Reviews must be based on real experience.${eu ? ' If we remove content or limit an account, we give the reasons and you can complain to us.' : ''}</p>`],
    ['Liability', `<p>Freelancers are responsible for their work and clients for how they describe the task. Worklay is responsible for its own service to the extent the law provides. Nothing here excludes liability that cannot be excluded by the law of ${c.name}.</p>`],
    ['Closing or limiting an account', `<p>You can ask us to close your account at any time at ${mail}. If these terms are broken we may remove content, or limit or close an account, and we will explain why unless the law prevents it. You can challenge a decision by writing to us.</p>`],
    ['Changes', '<p>We announce significant changes in advance and ask you to accept the new terms.</p>'],
    ['Law', `<p>Estonian law applies to your agreement with Worklay. If you are a consumer living in ${c.name}, you also keep the protection of the mandatory law of ${c.name} and may bring a case where that law allows you to.</p>`],
    ['Contact', `<p>${LEGAL.company}, ${LEGAL.address}. Email: ${mail}.</p>`],
  ];
  return `<div class="page-head"><div class="container"><h1>Terms of Service: ${c.name}</h1><p>In force from ${date}</p></div></div>
  <article class="prose legal">${REVIEWED.includes(code) ? '' : `<p class="notice"><b>Draft.</b> These terms have not yet been checked by a lawyer in ${c.name}.</p>`}${sections.map(([h, b], i) => `<h2>${i + 1}. ${h}</h2>${b}`).join('')}</article>`;
}
