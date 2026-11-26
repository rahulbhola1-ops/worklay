/* Version of the Terms of Service, shared by the server and the front end. Change it whenever the
   text in terms-page.js changes in a way people must agree to again: everyone is then asked to
   accept the new version before they can order, book, publish or send proposals. */
export const TERMS_VERSION = '2026-11-26';

/* Days a client has to approve finished work or report a problem before the freelancer is paid
   automatically, and days Worklay has to decide a reported problem. Both are promised in the Terms. */
export const APPROVAL_DAYS = 7;

/* Every other country has its own Terms (terms-world.js) with its own version, and people accept the
   Terms of their own country. Raise a country here when its text changes, e.g. { DE: '2027-01-15' }. */
const WORLD_VERSION = '2026-11-26';
const COUNTRY_VERSIONS = {};
export const termsVersionFor = country => (country === 'EE' ? TERMS_VERSION : `${country}:${COUNTRY_VERSIONS[country] || WORLD_VERSION}`);
