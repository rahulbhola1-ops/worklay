/* Blog posts, shared by the server (search engines) and the front end.
   Post text is plain: blocks separated by an empty line, "## " starts a heading, and a block whose
   lines all start with "- " is a list. Everything is escaped, so posts can't contain HTML. */

// The post in the visitor's language, falling back to English.
export const localPost = (p, lang) => ({ title: p[`title_${lang}`] || p.title, excerpt: p[`excerpt_${lang}`] || p.excerpt, body: p[`body_${lang}`] || p.body });

export const blogHtml = (body, esc) => String(body || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map(x => x.trim()).filter(Boolean).map(block => {
  if (block.startsWith('## ')) return `<h2>${esc(block.slice(3))}</h2>`;
  const lines = block.split('\n');
  if (lines.every(l => l.startsWith('- '))) return `<ul>${lines.map(l => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
  return `<p>${lines.map(esc).join('<br>')}</p>`;
}).join('');
