/* Search engine and AI crawler support: server-rendered HTML for public pages, per-page
   metadata (title, description, canonical, Open Graph, JSON-LD), robots.txt and sitemap.xml.

   Public pages have real addresses (/freelancers, /user/12, …). The server answers them with
   readable HTML inside #root, so crawlers that don't run JavaScript still see the content and
   links. In the browser, the app then takes over and draws the same page.
   Private pages (dashboard, messages, …) get a noindex header and no content. */
import fs from 'node:fs';
import { blogHtml } from './blog-text.mjs';
import { COUNTRIES, LANG_NAMES, countryBySlug, langsFor, formatMoney } from './countries.mjs';

const SITE_NAME = 'Worklay';
const TAGLINE = 'Find work. Get work done.';
const DEFAULT_DESCRIPTION = 'Worklay connects people who need tasks done with trusted local freelancers and professionals across Estonia: tutors, cleaners, photographers, developers and more.';

// First path segment of pages that are never indexed. Access control is enforced by the API,
// not by this list.
export const PRIVATE_SECTIONS = ['dashboard', 'admin', 'messages', 'notifications', 'wishlist', 'onboarding', 'post-project', 'post-service', 'settings'];
const PUBLIC_STATIC = {
  about: ['About Worklay', 'Worklay is a local services marketplace built on trust: verified freelancers, clear prices and payment released only when the work is done.'],
  contact: ['Contact Worklay', 'Questions, feedback or partnerships: get in touch with the Worklay team.'],
  terms: ['Terms of Service', 'How Worklay works: payments are held until the work is done, Worklay keeps 10%, and how cancellations, refunds and disputes are handled.'],
  privacy: ['Privacy Policy', 'How Worklay collects, uses and protects your personal data.'],
  cookies: ['Cookie Policy', 'The cookies and browser storage Worklay uses, and how to change your choices.'],
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
// JSON inside <script>: escape "<" so text can never close the tag.
const jsonLd = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const list = v => (Array.isArray(v) ? v : []);
const money = (n, country = 'EE') => formatMoney(n, country, 'en');
const PRICE_UNIT = { HOURLY: 'per hour', FIXED_PACKAGE: 'per package', PER_EVENT: 'per event' };

export function createSeo({ db, categories, publicOrigin, cities, countries = ['EE'], geoOf, placesOf, indexHtmlPath }) {
  let template = null;
  const loadTemplate = () => {
    if (template === null) { try { template = fs.readFileSync(indexHtmlPath, 'utf8'); } catch { template = ''; } }
    return template;
  };

  const approved = cats => cats.filter(c => c.status !== 'NEW'); // categories an admin hasn't looked at yet aren't advertised
  const freelancerQuery = (country = 'EE') => db.selectFrom('wl_users')
    .where('country_code', '=', country).select(['id', 'country_code', 'state', 'name', 'title', 'category', 'city', 'area', 'specialty', 'bio', 'pricing_type', 'price_amount', 'price_unit_label', 'created_at'])
    .where('is_freelancer', '=', true).where('onboarding_completed_at', 'is not', null);

  /* ---------- shared page parts ---------- */
  const shell = (origin, mainHtml) => `<a class="skip-link" href="#app">Skip to main content</a>
<header class="topbar"><div class="container topbar-inner"><a href="/" class="logo">Worklay</a>
<nav class="mainnav" aria-label="Main"><a href="/freelancers">Find freelancers</a> <a href="/projects">Projects</a> <a href="/services">Services</a> <a href="/blog">Blog</a> <a href="/about">About</a> <a href="/contact">Contact</a></nav></div></header>
<main id="app" class="app" tabindex="-1"><div class="container ssr-content">${mainHtml}</div></main>
<footer class="footer"><div class="container"><nav aria-label="Footer"><a href="/freelancers">Find freelancers</a> <a href="/services">Services</a> <a href="/projects">Projects</a> <a href="/about">About</a> <a href="/terms">Terms</a> <a href="/privacy">Privacy Policy</a> <a href="/cookies">Cookie Policy</a></nav><p>© ${new Date().getFullYear()} Worklay. ${esc(TAGLINE)}</p></div></footer>`;

  const siteJsonLd = origin => [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${origin}/`, description: DEFAULT_DESCRIPTION, inLanguage: ['en', 'et', 'ru'],
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${origin}/freelancers?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } },
    { '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: `${origin}/`, logo: `${origin}/logo.svg`, slogan: TAGLINE, email: 'support@worklay.com', areaServed: 'EE' },
  ];

  const freelancerCard = (f, cats) => {
    const cat = cats.find(c => c.id === f.category);
    const price = Number(f.price_amount) > 0 ? ` · ${money(f.price_amount, f.country_code)} ${esc(f.price_unit_label || PRICE_UNIT[f.pricing_type] || '')}` : '';
    const where = f.city ? ` · ${esc(f.area ? `${f.area}, ${f.city}` : f.city)}` : '';
    return `<li><a href="/user/${f.id}"><strong>${esc(f.name)}</strong></a> — ${esc(f.title || (cat ? cat.name : 'Freelancer'))}${cat ? ` (${esc(cat.name)})` : ''}${where}${price}</li>`;
  };

  /* ---------- pages ---------- */
  async function home(origin) {
    const [cats, fls] = await Promise.all([categories(), freelancerQuery().orderBy('id', 'desc').limit(12).execute()]);
    return {
      title: `${SITE_NAME} – Find trusted local professionals for any job`,
      description: DEFAULT_DESCRIPTION,
      html: `<h1>Find trusted local professionals for any job</h1>
<p>${esc(DEFAULT_DESCRIPTION)}</p>
<p><a href="/freelancers">Find freelancers</a> · <a href="/services">Browse services</a> · <a href="/projects">Browse projects</a></p>
<section aria-labelledby="ssr-cats"><h2 id="ssr-cats">Browse categories</h2><ul>${approved(cats).map(c => `<li><a href="/freelancers?cat=${esc(c.id)}">${esc(c.name)}</a></li>`).join('')}</ul></section>
${fls.length ? `<section aria-labelledby="ssr-new"><h2 id="ssr-new">Freelancers on Worklay</h2><ul>${fls.map(f => freelancerCard(f, cats)).join('')}</ul></section>` : ''}
<section aria-labelledby="ssr-how"><h2 id="ssr-how">How it works</h2><ol><li>Post your job for free or book a freelancer directly.</li><li>Compare profiles, prices and reviews.</li><li>Pay securely; the money is released only after you approve the work.</li></ol></section>
<p>Local professionals across Estonia: ${Object.keys(cities).slice(0, 40).map(esc).join(', ')} and more.</p>`,
    };
  }

  async function freelancers(origin, query) {
    const cats = await categories();
    const cat = cats.find(c => c.id === query.get('cat')) || null;
    const city = cities[query.get('city')] ? query.get('city') : '';
    let q = freelancerQuery();
    if (cat) q = q.where('category', '=', cat.id);
    if (city) q = q.where('city', '=', city);
    const fls = await q.orderBy('id', 'desc').limit(200).execute();
    const title = `${cat ? `${cat.name} freelancers` : 'Find freelancers'}${city ? ` in ${city}` : ' in Estonia'} | ${SITE_NAME}`;
    // Only category and city pages are distinct; other filters point at the plain list.
    const canonicalQuery = new URLSearchParams(Object.entries({ cat: cat?.id || '', city }).filter(([, v]) => v)).toString();
    return {
      title,
      description: clip(`${cat ? `Hire trusted local freelancers for ${cat.name.toLowerCase()}` : 'Hire trusted local freelancers'}${city ? ` in ${city}` : ' across Estonia'} on Worklay. Compare profiles, prices and availability, and book online.`, 160),
      robots: cat?.status === 'NEW' ? 'noindex, follow' : undefined,
      canonicalPath: '/freelancers' + (canonicalQuery ? `?${canonicalQuery}` : ''),
      html: `<h1>${esc(cat ? `${cat.name} freelancers` : 'Find freelancers')}${city ? ` in ${esc(city)}` : ''}</h1>
${fls.length ? `<ul>${fls.map(f => freelancerCard(f, cats)).join('')}</ul>` : '<p>No freelancers here yet.</p>'}
<nav aria-label="Categories"><h2>Other categories</h2><ul>${approved(cats).map(c => `<li><a href="/freelancers?cat=${esc(c.id)}">${esc(c.name)}</a></li>`).join('')}</ul></nav>`,
    };
  }

  async function countryPage(country, slug) {
    const region = slug ? geoOf(country.code).regions.find(r => r.slug === slug) : null;
    if (slug && !region) return null;
    const cats = await categories();
    let q = freelancerQuery(country.code);
    if (region) q = q.where('state', '=', region.slug);
    const fls = await q.orderBy('id', 'desc').limit(100).execute();
    const name = region ? `${region.name}, ${country.name}` : country.name;
    const places = region ? placesOf(country.code, region.slug) : {}, cityNames = Object.keys(places);
    return {
      title: `Freelancers and local services in ${name} | ${SITE_NAME}`,
      description: clip(`Find freelancers and local professionals in ${name}${cityNames.length ? ` (${cityNames.slice(0, 5).join(', ')})` : ` by ${country.region}, city and area`} on Worklay.`, 160),
      html: `<h1>Find skilled people and work in ${esc(name)}</h1>
<p>Languages: ${langsFor(country.code, region).map(l => esc(LANG_NAMES[l][1])).join(', ')}</p>
${region ? `<h2>Cities</h2><ul>${Object.entries(places).slice(0, 150).map(([c, areas], i) => `<li>${esc(c)}${areas.length ? `: ${areas.slice(0, i < 10 ? 100 : 12).map(esc).join(', ')}` : ''}</li>`).join('')}</ul><p><a href="/${country.slug}">${esc(country.name)}</a></p>`
    : `<h2>Regions</h2><ul>${geoOf(country.code).regions.map(r => `<li><a href="/${country.slug}/${r.slug}">${esc(r.name)}</a></li>`).join('')}</ul><p><a href="/countries">All countries</a></p>`}
<p>Place names: GeoNames (CC BY 4.0)${geoOf(country.code).osm ? ' and © OpenStreetMap contributors (ODbL)' : ''}.</p>
<h2>Freelancers</h2>${fls.length ? `<ul>${fls.map(f => freelancerCard(f, cats)).join('')}</ul>` : '<p>No freelancers here yet.</p>'}`,
    };
  }
  const abroad = countries.filter(c => c !== 'EE').map(c => COUNTRIES[c]);
  const countriesPage = () => ({ title: `Countries | ${SITE_NAME}`, description: 'Countries where you can use Worklay.',
    html: `<h1>Countries</h1><ul><li><a href="/">Estonia</a></li>${abroad.map(c => `<li><a href="/${c.slug}">${esc(c.name)}</a></li>`).join('')}</ul>` });

  async function profile(origin, id) {
    const u = await db.selectFrom('wl_users').selectAll().where('id', '=', Number(id) || 0).executeTakeFirst();
    if (!u) return null;
    const publicProfile = u.is_freelancer && !!u.onboarding_completed_at;
    if (!publicProfile) {
      // Customers and unfinished freelancer profiles: viewable in the app, never indexed.
      return { title: `${u.name || 'Member'} | ${SITE_NAME}`, description: DEFAULT_DESCRIPTION, robots: 'noindex, follow', html: `<h1>${esc(u.name || 'Worklay member')}</h1>` };
    }
    const cats = await categories();
    const cat = cats.find(c => c.id === u.category);
    const [rev] = await db.selectFrom('wl_reviews').select([db.fn.avg('rating').as('avg'), db.fn.countAll().as('n')]).where('target_user', '=', u.id).execute();
    const where = u.city ? (u.area ? `${u.area}, ${u.city}` : u.city) : '';
    const price = Number(u.price_amount) > 0 ? `${money(u.price_amount, u.country_code)} ${u.price_unit_label || PRICE_UNIT[u.pricing_type] || ''}`.trim() : '';
    const job = u.title || (cat ? cat.name : 'Freelancer');
    const subjects = [...list(u.tutor_subjects), ...list(u.skills)];
    const person = { '@context': 'https://schema.org', '@type': 'ProfilePage', url: `${origin}/user/${u.id}`,
      mainEntity: { '@type': 'Person', name: u.name, jobTitle: job, description: clip(u.specialty || u.bio, 300) || undefined,
        address: u.city ? { '@type': 'PostalAddress', addressLocality: u.city, addressCountry: u.country_code } : undefined,
        knowsAbout: subjects.length ? subjects : undefined } };
    return {
      title: `${u.name} – ${job}${u.city ? ` in ${u.city}` : ''} | ${SITE_NAME}`,
      description: clip([`${u.name}: ${job}${where ? ` in ${where}` : ''}.`, u.specialty || u.bio ? `${String(u.specialty || u.bio).trim().replace(/[.!?]?$/, '.')}` : '', price ? `From ${price}.` : '', 'Book on Worklay.'].filter(Boolean).join(' '), 160),
      ogType: 'profile',
      jsonLd: [person],
      html: `<article><h1>${esc(u.name)}</h1>
<p><strong>${esc(job)}</strong>${cat ? ` · ${esc(cat.name)}` : ''}${where ? ` · ${esc(where)}` : ''}</p>
${price ? `<p>Price: ${esc(price)}</p>` : ''}
${Number(rev?.n) ? `<p>Rating: ${Number(rev.avg).toFixed(1)} / 5 from ${Number(rev.n)} review${Number(rev.n) === 1 ? '' : 's'}</p>` : ''}
${u.specialty ? `<h2>Speciality</h2><p>${esc(u.specialty)}</p>` : ''}
${u.bio ? `<h2>About</h2><p>${esc(u.bio)}</p>` : ''}
${subjects.length ? `<h2>Skills and subjects</h2><ul>${subjects.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
${cat ? `<p><a href="/freelancers?cat=${esc(cat.id)}">More ${esc(cat.name)} freelancers</a></p>` : ''}</article>`,
    };
  }

  async function services() {
    const rows = await db.selectFrom('wl_services as s').innerJoin('wl_users as u', 'u.id', 's.seller_id').select(['s.id', 's.title', 's.description', 'u.name']).where('u.country_code', '=', 'EE').orderBy('s.id', 'desc').limit(200).execute();
    return {
      title: `Services | ${SITE_NAME}`,
      description: 'Ready-made service packages from local freelancers, with clear Basic, Standard and Premium prices.',
      html: `<h1>Services</h1>${rows.length ? `<ul>${rows.map(r => `<li><a href="/service/${r.id}">${esc(r.title)}</a> by ${esc(r.name)}</li>`).join('')}</ul>` : '<p>No services listed yet.</p>'}`,
    };
  }

  async function service(origin, id) {
    const s = await db.selectFrom('wl_services as s').innerJoin('wl_users as u', 'u.id', 's.seller_id').select(['s.id', 's.title', 's.description', 's.packages', 'u.id as seller', 'u.name', 'u.country_code']).where('s.id', '=', Number(id) || 0).executeTakeFirst();
    if (!s) return null;
    const pk = list(s.packages);
    return {
      title: `${s.title} | ${SITE_NAME}`,
      description: clip(s.description || `${s.title} by ${s.name} on Worklay.`, 160),
      html: `<article><h1>${esc(s.title)}</h1><p>By <a href="/user/${s.seller}">${esc(s.name)}</a></p><p>${esc(s.description)}</p>
${pk.length ? `<h2>Packages</h2><ul>${pk.map(p => `<li>${esc(p.name || p.tier || 'Package')}: ${money(p.price, s.country_code)}${p.delivery ? `, ${Number(p.delivery)} days delivery` : ''}</li>`).join('')}</ul>` : ''}</article>`,
    };
  }

  async function projects() {
    const rows = await db.selectFrom('wl_projects').select(['id', 'title', 'city', 'budget_min', 'budget_max']).where('status', '=', 'open').where('country_code', '=', 'EE').orderBy('id', 'desc').limit(200).execute();
    return {
      title: `Projects | ${SITE_NAME}`,
      description: 'Open jobs posted by people who need a hand. Send a proposal and get hired.',
      html: `<h1>Projects</h1>${rows.length ? `<ul>${rows.map(r => `<li><a href="/project/${r.id}">${esc(r.title)}</a>${r.city ? ` · ${esc(r.city)}` : ''} · budget ${money(r.budget_min)}–${money(r.budget_max)}</li>`).join('')}</ul>` : '<p>No open projects right now.</p>'}`,
    };
  }

  async function project(origin, id) {
    const p = await db.selectFrom('wl_projects').select(['id', 'title', 'description', 'city', 'budget_min', 'budget_max', 'status', 'country_code']).where('id', '=', Number(id) || 0).executeTakeFirst();
    if (!p) return null;
    return {
      title: `${p.title} | ${SITE_NAME}`,
      description: clip(p.description || p.title, 160),
      robots: p.status === 'open' ? undefined : 'noindex, follow',
      html: `<article><h1>${esc(p.title)}</h1><p>Budget ${money(p.budget_min, p.country_code)}–${money(p.budget_max, p.country_code)}${p.city ? ` · ${esc(p.city)}` : ''}</p><p>${esc(p.description)}</p></article>`,
    };
  }

  async function blog() {
    const rows = await db.selectFrom('wl_posts').select(['id', 'title', 'excerpt']).orderBy('id', 'desc').execute();
    return {
      title: `Blog | ${SITE_NAME}`,
      description: 'News and tips for customers and freelancers using Worklay.',
      html: `<h1>Worklay Blog</h1>${rows.length ? `<ul>${rows.map(r => `<li><a href="/blog/${r.id}">${esc(r.title)}</a> — ${esc(r.excerpt)}</li>`).join('')}</ul>` : '<p>No posts yet.</p>'}`,
    };
  }

  async function blogPost(origin, id) {
    const p = await db.selectFrom('wl_posts').selectAll().where('id', '=', Number(id) || 0).executeTakeFirst();
    if (!p) return null;
    return {
      title: `${p.title} | ${SITE_NAME} Blog`,
      description: clip(p.excerpt || p.body, 160),
      ogType: 'article',
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, datePublished: new Date(p.created_at).toISOString(), url: `${origin}/blog/${p.id}`, publisher: { '@type': 'Organization', name: SITE_NAME } }],
      html: `<article><h1>${esc(p.title)}</h1><p>${esc(p.excerpt)}</p>${blogHtml(p.body, esc)}</article>`,
    };
  }

  // Decide what a page address shows. Returns { status, title, description, robots?, html, … }.
  async function pageFor(req) {
    const origin = publicOrigin(req);
    const url = new URL(req.originalUrl, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [section = '', id] = parts;
    if (PRIVATE_SECTIONS.includes(section)) return { status: 200, title: SITE_NAME, description: DEFAULT_DESCRIPTION, robots: 'noindex, nofollow', html: '' };
    let page = null;
    if (!section) page = await home(origin);
    else if (section === 'freelancers' && !id) page = await freelancers(origin, url.searchParams);
    else if (abroad.length && section === 'countries' && !id) page = countriesPage();
    else if (abroad.some(c => c.slug === section) && parts.length <= 2) page = await countryPage(countryBySlug(section), id);
    else if (section === 'user' && id) page = await profile(origin, id);
    else if (section === 'services' && !id) page = await services();
    else if (section === 'service' && id) page = await service(origin, id);
    else if (section === 'projects' && !id) page = await projects();
    else if (section === 'project' && id) page = await project(origin, id);
    else if (section === 'blog') page = id ? await blogPost(origin, id) : await blog();
    else if (PUBLIC_STATIC[section] && !id) { const [t, d] = PUBLIC_STATIC[section]; page = { title: `${t} | ${SITE_NAME}`, description: d, html: `<h1>${esc(t)}</h1><p>${esc(d)}</p>` }; }
    if (!page) return { status: 404, title: `Page not found | ${SITE_NAME}`, description: DEFAULT_DESCRIPTION, robots: 'noindex, follow', html: '<h1>Page not found</h1><p><a href="/">Go to the homepage</a></p>' };
    return { status: 200, canonicalPath: url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, ''), ...page };
  }

  async function renderPage(req, res) {
    const tpl = loadTemplate();
    if (!tpl) return res.status(500).send('Front end not built. Run npm run build.');
    let page;
    try { page = await pageFor(req); }
    catch (e) { console.error('SEO render failed', e); page = { status: 200, title: `${SITE_NAME} – ${TAGLINE}`, description: DEFAULT_DESCRIPTION, html: '' }; }
    const origin = publicOrigin(req);
    const canonical = page.canonicalPath ? origin + page.canonicalPath : '';
    const head = [
      `<meta name="description" content="${esc(page.description)}" />`,
      page.robots ? `<meta name="robots" content="${esc(page.robots)}" />` : '',
      canonical && !page.robots ? `<link rel="canonical" href="${esc(canonical)}" />` : '',
      `<meta property="og:site_name" content="${SITE_NAME}" />`,
      `<meta property="og:type" content="${esc(page.ogType || 'website')}" />`,
      `<meta property="og:title" content="${esc(page.title)}" />`,
      `<meta property="og:description" content="${esc(page.description)}" />`,
      canonical ? `<meta property="og:url" content="${esc(canonical)}" />` : '',
      `<meta property="og:image" content="${esc(origin)}/og-image.png" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      ...(page.robots ? [] : [...siteJsonLd(origin), ...(page.jsonLd || [])].map(jsonLd)),
    ].filter(Boolean).join('\n    ');
    const html = tpl
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(page.title)}</title>`)
      .replace(/\s*<meta name="description"[^>]*>/, '')
      .replace('</head>', `    ${head}\n  </head>`)
      .replace('<div id="root"></div>', `<div id="root">${page.html ? shell(origin, page.html) : ''}</div>`);
    if (page.robots) res.setHeader('X-Robots-Tag', page.robots);
    res.status(page.status).type('html').setHeader('Cache-Control', 'no-cache').send(html);
  }

  function robots(req, res) {
    const origin = publicOrigin(req);
    res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600');
    res.send([
      '# Worklay: public pages are open to search engines and AI crawlers.',
      '# Private areas are also protected by login on the server; this file is not access control.',
      'User-agent: *',
      'Allow: /',
      'Disallow: /api',
      ...PRIVATE_SECTIONS.map(s => `Disallow: /${s}`),
      '',
      `Sitemap: ${origin}/sitemap.xml`,
      '',
    ].join('\n'));
  }

  async function sitemap(req, res) {
    const origin = publicOrigin(req);
    const day = d => (d ? new Date(d).toISOString().slice(0, 10) : undefined);
    const [cats, fls, svcs, posts] = await Promise.all([
      categories(),
      freelancerQuery().orderBy('id').execute().then(async ee => { for (const c of abroad) ee.push(...await freelancerQuery(c.code).orderBy('id').execute()); return ee; }),
      db.selectFrom('wl_services').select(['id', 'created_at']).orderBy('id').execute(),
      db.selectFrom('wl_posts').select(['id', 'created_at']).orderBy('id').execute(),
    ]);
    const urls = [
      { loc: '/', priority: '1.0' }, { loc: '/freelancers', priority: '0.9' }, { loc: '/services', priority: '0.7' }, { loc: '/projects', priority: '0.7' },
      { loc: '/blog', priority: '0.5' }, { loc: '/about', priority: '0.4' }, { loc: '/contact', priority: '0.3' }, { loc: '/terms', priority: '0.2' }, { loc: '/privacy', priority: '0.2' }, { loc: '/cookies', priority: '0.2' },
      ...approved(cats).map(c => ({ loc: `/freelancers?cat=${c.id}`, priority: '0.8' })),
      ...(abroad.length ? [{ loc: '/countries', priority: '0.6' }] : []),
      ...abroad.flatMap(c => [{ loc: `/${c.slug}`, priority: '0.8' }, ...geoOf(c.code).regions.filter(r => r.n > 1).map(r => ({ loc: `/${c.slug}/${r.slug}`, priority: '0.6' }))]),
      ...fls.map(f => ({ loc: `/user/${f.id}`, lastmod: day(f.created_at), priority: '0.7' })),
      ...svcs.map(s => ({ loc: `/service/${s.id}`, lastmod: day(s.created_at), priority: '0.6' })),
      ...posts.map(p => ({ loc: `/blog/${p.id}`, lastmod: day(p.created_at), priority: '0.5' })),
    ];
    res.type('application/xml').setHeader('Cache-Control', 'public, max-age=3600');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u =>
      `  <url><loc>${esc(origin + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`);
  }

  return { renderPage, robots, sitemap };
}
