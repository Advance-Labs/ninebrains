/**
 * Renders the comparison pages at `/compare/` from `compare/*.json`, one file per competitor.
 *
 * The rules come from docs/strategy/workstreams/W9-positioning-and-content.md:
 *  - every claim about a competitor links to that competitor's own docs, with the date it was
 *    checked, so a cell without a source on one of `hosts` fails the build;
 *  - "choose them when" comes first and names them, so the page is not a rigged grid;
 *  - structured data only for blocks the page visibly carries.
 *
 * Ninebrains' side of every row is written once, below, so eleven pages cannot describe the
 * product eleven ways.
 */

const SITE = 'https://ninebrains.dev';
const ENTITY = 'https://advancelabs.dev/lab/ninebrains#software';
const AUTHOR = 'Lucas Krawczak';
const ORG = 'Advance Labs Inc.';

/** Rows, in order. `ninebrains` is the shared answer; competitor files answer by key. */
export const CRITERIA = [
  [
    'what',
    'What it is',
    'Desktop app that runs coding agents in parallel lanes, plans the work as a job graph, and blocks completion until configured checks pass.',
  ],
  ['licence', 'Licence', 'Open source, Apache-2.0.'],
  ['price', 'Price', 'Free. Model usage is billed by your provider as usual.'],
  ['platforms', 'Platforms', 'macOS, Windows and Linux. Developed and tested on macOS first.'],
  [
    'agents',
    'Agents it runs',
    'Claude Code and Codex in lanes, using the CLIs you are already logged in to. Other agent CLIs run in Emdash tasks.',
  ],
  [
    'isolation',
    'Isolation',
    'A git worktree and branch per lane. Worktrees stop agents overwriting each other’s files at the same time; they do not prevent merge or semantic conflicts.',
  ],
  [
    'planning',
    'Planning',
    'A job graph with dependencies, dispatched to idle lanes, plus a planner canvas.',
  ],
  [
    'verification',
    'Checks before “done”',
    'Blocks completion until configured checks pass: tests, a screenshot check at three widths, a read-only reviewer in a disposable checkout, citation checks. Three attempts, then the job blocks.',
  ],
  ['telemetry', 'Telemetry', 'None. No telemetry endpoint is built in.'],
];

/** What Ninebrains cannot claim, shown on every page in the page's own words. */
const LIMITS = [
  'Ninebrains is an early release, and its builds are not code-signed yet. The installer checks the SHA256 and the GitHub build attestation instead.',
  'A passing gate means the configured checks passed. It does not mean the change is correct.',
  'Lanes run on your machine only. Remote machines over SSH work in Emdash tasks, not in lanes.',
  'Windows and Linux builds come from the same CI, but the tests gate has no OS sandbox there, and Windows paths are not yet tested.',
];

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
/** JSON-LD inside a script tag: `<` is the only character that can end the block early. */
const ld = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');
const human = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** Throws on anything the claims rules forbid, so a bad file fails the build, not the page. */
export function validate(c) {
  const where = `compare/${c.slug}.json`;
  for (const k of [
    'slug',
    'name',
    'url',
    'hosts',
    'checked',
    'published',
    'title',
    'description',
    'answer',
    'cells',
    'chooseThem',
    'chooseUs',
  ]) {
    if (c[k] == null) throw new Error(`${where}: missing ${k}`);
  }
  if (!/^[a-z0-9-]+$/.test(c.slug)) throw new Error(`${where}: bad slug`);
  const words = c.answer.trim().split(/\s+/).length;
  if (words < 40 || words > 70) throw new Error(`${where}: answer is ${words} words, needs 40-70`);
  // A bare domain matches it and its subdomains; `github.com/owner` matches only that owner's
  // repos, so a shared host cannot launder a third-party source.
  const own = (u) => {
    const { hostname, pathname } = new URL(u);
    const host = hostname.replace(/^www\./, '');
    return c.hosts.some((h) =>
      h.includes('/')
        ? `${host}${pathname}`.toLowerCase().startsWith(`${h.toLowerCase()}/`)
        : host === h || host.endsWith(`.${h}`)
    );
  };
  const sourced = (item, label) => {
    if (!item.source) throw new Error(`${where}: ${label} has no source`);
    if (!own(item.source))
      throw new Error(
        `${where}: ${label} cites ${item.source}, not their own docs (${c.hosts.join(', ')})`
      );
  };
  for (const [key] of CRITERIA) {
    const cell = c.cells[key];
    if (cell && cell.text) sourced(cell, `cells.${key}`);
  }
  c.chooseThem.forEach((item, i) => sourced(item, `chooseThem[${i}]`));
  const banned =
    /\b(proves? (the )?code is correct|eliminates bugs|no collisions|guarantee[sd]?)\b/i;
  const text = JSON.stringify(c);
  if (banned.test(text)) throw new Error(`${where}: banned claim: ${text.match(banned)[0]}`);
}

const head = ({ title, description, path, extra = '' }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${SITE}${path}" />
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
    <meta name="theme-color" content="#000000" />
    <meta property="og:url" content="${SITE}${path}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${SITE}/assets/ninebrains-banner.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="llms" href="/llms.txt" />
    <link rel="stylesheet" href="/compare.css" />
${extra}  </head>
  <body>
    <header class="top">
      <a class="brand" href="/">ninebrains</a>
      <nav><a href="/compare/">Compare</a><a href="/docs/">Docs</a><a href="https://github.com/Advance-Labs/ninebrains">GitHub</a></nav>
    </header>
    <main>`;

const foot = `    </main>
    <footer>
      <p>Apache-2.0, a fork of <a href="https://github.com/generalaction/emdash">Emdash</a>. Built by <a href="https://advancelabs.dev">${ORG}</a></p>
      <p><a href="/compare/">All comparisons</a> · <a href="/docs/gates/">How gates work</a> · <a href="/docs/lanes/">Lanes</a> · <a href="/llms.txt">llms.txt</a></p>
    </footer>
  </body>
</html>
`;

const byline = (c) =>
  `<p class="byline">By ${AUTHOR}, ${ORG} Reviewed by ${AUTHOR}. Published <time datetime="${c.published}">${human(c.published)}</time>, updated <time datetime="${c.updated ?? c.published}">${human(c.updated ?? c.published)}</time>. ${esc(c.name)} claims checked against their own documentation on <time datetime="${c.checked}">${human(c.checked)}</time>.</p>`;

export function renderPage(c) {
  validate(c);
  const path = `/compare/${c.slug}/`;
  const faq = c.faq ?? [];
  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: c.title,
      description: c.description,
      url: `${SITE}${path}`,
      datePublished: c.published,
      dateModified: c.updated ?? c.published,
      author: { '@type': 'Person', name: AUTHOR },
      publisher: { '@type': 'Organization', name: ORG, url: 'https://advancelabs.dev' },
      about: [{ '@id': ENTITY }, { '@type': 'SoftwareApplication', name: c.name, url: c.url }],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ninebrains', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Compare', item: `${SITE}/compare/` },
        {
          '@type': 'ListItem',
          position: 3,
          name: `Ninebrains vs ${c.name}`,
          item: `${SITE}${path}`,
        },
      ],
    },
  ];
  if (faq.length) {
    schema.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }
  const extra = schema
    .map((s) => `    <script type="application/ld+json">\n${ld(s)}\n    </script>\n`)
    .join('');

  const rows = CRITERIA.map(([key, label, ours]) => {
    const cell = c.cells[key];
    const theirs = cell?.text
      ? `${esc(cell.text)} <a class="src" href="${esc(cell.source)}" rel="nofollow">source</a>`
      : '<span class="dim">Not stated in their docs.</span>';
    return `<tr><th scope="row">${esc(label)}</th><td>${esc(ours)}</td><td>${theirs}</td></tr>`;
  }).join('\n            ');

  const sources = [
    ...new Set(
      [
        ...Object.values(c.cells).map((x) => x?.source),
        ...c.chooseThem.map((x) => x.source),
      ].filter(Boolean)
    ),
  ];

  return `${head({ title: c.title, description: c.description, path, extra })}
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Ninebrains</a> / <a href="/compare/">Compare</a> / <span>${esc(c.name)}</span></nav>
      <article>
        <h1>${esc(c.title)}</h1>
        <p class="answer">${esc(c.answer)}</p>
        ${byline(c)}
        ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}

        <h2 id="choose-${esc(c.slug)}">Choose ${esc(c.name)} when</h2>
        <ul>
          ${c.chooseThem.map((x) => `<li>${esc(x.text)} <a class="src" href="${esc(x.source)}" rel="nofollow">source</a></li>`).join('\n          ')}
        </ul>

        <h2 id="choose-ninebrains">Choose Ninebrains when</h2>
        <ul>
          ${c.chooseUs.map((x) => `<li>${esc(x)}</li>`).join('\n          ')}
        </ul>

        <h2 id="side-by-side">Side by side</h2>
        <div class="table">
          <table>
            <thead><tr><th scope="col"></th><th scope="col">Ninebrains</th><th scope="col">${esc(c.name)}</th></tr></thead>
            <tbody>
            ${rows}
            </tbody>
          </table>
        </div>
        <p class="dim">The ${esc(c.name)} column quotes or summarises ${esc(c.name)}’s own website, documentation or repository, as checked on ${human(c.checked)}. Software changes; if a row is out of date, <a href="https://github.com/Advance-Labs/ninebrains/issues/new?title=${encodeURIComponent(`Compare page out of date: ${c.name}`)}">tell us</a> and we will fix it.</p>

        <h2 id="limitations">Limitations</h2>
        <ul>
          ${[...LIMITS, ...(c.limits ?? [])].map((x) => `<li>${esc(x)}</li>`).join('\n          ')}
        </ul>
${
  faq.length
    ? `
        <h2 id="faq">Questions</h2>
        ${faq.map((f) => `<h3>${esc(f.q)}</h3>\n        <p>${esc(f.a)}</p>`).join('\n        ')}
`
    : ''
}
        <h2 id="sources">Sources</h2>
        <ul class="sources">
          ${sources.map((u) => `<li><a href="${esc(u)}" rel="nofollow">${esc(u)}</a>, checked ${human(c.checked)}</li>`).join('\n          ')}
          <li><a href="https://github.com/Advance-Labs/ninebrains">github.com/Advance-Labs/ninebrains</a>, for every Ninebrains row</li>
        </ul>
      </article>
${foot}`;
}

export function renderIndex(all) {
  const updated = all
    .map((c) => c.updated ?? c.published)
    .sort()
    .at(-1);
  const title = 'Ninebrains compared with other parallel coding-agent tools';
  const description = `How Ninebrains compares with ${all.map((c) => c.name).join(', ')}: sourced, dated, and honest about when to choose each one.`;
  const extra = `    <script type="application/ld+json">\n${ld({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    url: `${SITE}/compare/`,
    dateModified: updated,
    hasPart: all.map((c) => ({
      '@type': 'Article',
      headline: c.title,
      url: `${SITE}/compare/${c.slug}/`,
    })),
  })}\n    </script>\n`;
  return `${head({ title, description, path: '/compare/', extra })}
      <article>
        <h1>${esc(title)}</h1>
        <p class="answer">Ninebrains runs Claude Code and Codex in parallel git worktrees and blocks completion until configured checks pass. Many tools now run agents in parallel; these pages say, for each one, when you should pick it instead, and cite that tool’s own documentation for every claim made about it.</p>
        <p class="byline">By ${AUTHOR}, ${ORG} Updated <time datetime="${updated}">${human(updated)}</time>.</p>

        <h2 id="pages">Comparisons</h2>
        <ul class="index">
          ${all.map((c) => `<li><a href="/compare/${c.slug}/">Ninebrains vs ${esc(c.name)}</a><span>${esc(c.summary ?? '')}</span></li>`).join('\n          ')}
        </ul>

        <h2 id="criteria">How we compare</h2>
        <p>Every page uses the same rows: ${CRITERIA.map(([, label]) => esc(label.toLowerCase())).join(', ')}. Each page opens with when to choose the other tool. A competitor cell links to their own website, docs or repository and carries the date it was checked; where their docs do not say, the cell says so rather than guessing. Ninebrains does not win every row, and the pages do not pretend it does.</p>

        <h2 id="limitations">Limitations</h2>
        <ul>
          ${LIMITS.map((x) => `<li>${esc(x)}</li>`).join('\n          ')}
          <li>These pages describe each tool as of its stated check date and go out of date as those tools ship.</li>
        </ul>
      </article>
${foot}`;
}
