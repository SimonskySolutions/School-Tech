// DEMO CONTENT - synthetic only. Never load into production.
//
// Writes the four demo websites into the CMS: a start page and a few pages for
// the group, Pythagoras Sofia, Pythagoras Varna and Pythagoras Academy. The
// facts (classes, prices, clubs, teachers, the grade 1 intake) are the ones
// db/seeds/demo.sql and db/seeds/development.sql put in the platform.
//
// Runs inside the cms container, against the running CMS, as the development
// editor: `node scripts/cms-demo-content.mjs` loads it, `... remove` deletes
// every page of these websites so the development start pages come back when
// the CMS restarts. scripts/db-seed-demo.sh calls it.

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const CMS = 'http://127.0.0.1:3000';
const EDITOR = 'editor@pythagoras.test';
const PASSWORD_FILE = process.env.CMS_DEV_EDITOR_PASSWORD_FILE;

// --- Rich text ---------------------------------------------------------------
// Blocks are [kind, content]: 'h2', 'p', 'ul', 'ol'. In text, **bold** and
// [words](/path) become bold text and links.

const base = { version: 1, direction: 'ltr', format: '', indent: 0 };

function inline(text) {
  const nodes = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) nodes.push(textNode(text.slice(at, match.index)));
    if (match[1]) nodes.push(textNode(match[1], 1));
    else
      nodes.push({
        ...base,
        type: 'link',
        version: 3,
        id: randomBytes(12).toString('hex'),
        fields: { linkType: 'custom', newTab: false, url: match[3] },
        children: [textNode(match[2])],
      });
    at = match.index + match[0].length;
  }
  if (at < text.length) nodes.push(textNode(text.slice(at)));
  return nodes;
}

function textNode(text, format = 0) {
  return { type: 'text', version: 1, text, detail: 0, format, mode: 'normal', style: '' };
}

function block([kind, content]) {
  if (kind === 'h2') return { ...base, type: 'heading', tag: 'h2', children: inline(content) };
  if (kind === 'p')
    return { ...base, type: 'paragraph', textFormat: 0, textStyle: '', children: inline(content) };
  const ordered = kind === 'ol';
  return {
    ...base,
    type: 'list',
    listType: ordered ? 'number' : 'bullet',
    tag: ordered ? 'ol' : 'ul',
    start: 1,
    children: content.map((item, index) => ({
      ...base,
      type: 'listitem',
      value: index + 1,
      children: inline(item),
    })),
  };
}

const richText = (blocks) => ({ root: { ...base, type: 'root', children: blocks.map(block) } });

// --- Shared wording ----------------------------------------------------------

const DAY = [
  'p',
  'Six lessons of 40 minutes, from 08:00 to 13:00, with a break after each one and a longer break at 10:20. Lunch follows, then the afternoon clubs.',
];
const SUBJECTS = [
  'p',
  'Maths, Bulgarian, English, Science, History, PE, Music and Computing, each with its own teacher. PE is in the gym, Music in the art and music room and Computing in the computer lab; every other lesson is in the class’s home room.',
];
const HOW_TO_APPLY = [
  'ol',
  [
    '**Ask about a place.** Tell us about your child and the school you have in mind.',
    '**Meet the school.** The school invites you to an open day or a meeting.',
    '**Apply** in the family portal, with the documents the school asks for.',
    '**Accept the offer** and pay the enrolment fee; your child is enrolled.',
  ],
];
const ASK = ['p', '[Ask about a place](/inquiry) and the school will reply with the next steps.'];
const PORTAL = [
  'p',
  'Lunch, clubs, transport, uniforms and trips are booked and paid in the family portal, and every payment comes with an invoice.',
];
const teachers = (names) => [
  'ul',
  ['Maths', 'Bulgarian', 'English', 'Science', 'History', 'PE', 'Music', 'Computing'].map(
    (subject, index) => `${names[index]}, ${subject}`,
  ),
];

// --- The websites -------------------------------------------------------------

const WEBSITES = {
  pythagoras: [
    {
      slug: 'home',
      title: 'Three schools, one family portal',
      blocks: [
        [
          'p',
          'Pythagoras is a group of three schools: **Pythagoras Sofia** for grades 1 to 4, **Pythagoras Varna** for grades 5 to 7, and **Pythagoras Academy**, with small classes and afternoon clubs. Each school runs its own day; families use one portal for all three.',
        ],
        ['h2', 'One account for the whole family'],
        [
          'p',
          'Parents sign in once to book lunch, clubs and transport, pay online, give consents and see each child’s timetable, whichever school the child attends.',
        ],
        ['h2', 'Applying for 2027/28'],
        [
          'p',
          'Grade 1 at Pythagoras Sofia takes applications until 2 February 2027. [See how admissions work](/admissions).',
        ],
      ],
    },
    {
      slug: 'about',
      title: 'About us',
      navOrder: 1,
      blocks: [
        [
          'p',
          'The three schools share one set of policies and one family portal. Each keeps its own principal, team, timetable and fees.',
        ],
        ['h2', 'Who’s who'],
        [
          'ul',
          [
            'Elena Petrova, chief executive of the group',
            'Petar Nikolov, principal of Pythagoras Sofia',
            'Desislava Todorova, principal of Pythagoras Varna',
            'Stefan Angelov, principal of Pythagoras Academy',
          ],
        ],
        ['h2', 'Families at more than one school'],
        [
          'p',
          'A family with children at two schools has one account, one order history and one set of invoices.',
        ],
      ],
    },
    {
      slug: 'admissions',
      title: 'Admissions',
      navOrder: 2,
      blocks: [
        ['p', 'Each school takes its own applications. The steps are the same everywhere:'],
        HOW_TO_APPLY,
        ['h2', 'Open now'],
        [
          'ul',
          [
            'Pythagoras Sofia, grade 1 for 2027/28: 20 places, applications from 3 November 2026 to 2 February 2027.',
          ],
        ],
        ASK,
      ],
    },
    {
      slug: 'news',
      title: 'News',
      navOrder: 3,
      blocks: [
        ['h2', 'One portal for all three schools'],
        [
          'p',
          'Families now book lunch, clubs and transport, pay and download invoices in one place, for every child at every Pythagoras school.',
        ],
        ['h2', 'Grade 1 applications for 2027/28 are open'],
        ['p', 'Pythagoras Sofia takes applications until 2 February 2027. [Ask about a place](/inquiry).'],
      ],
    },
  ],

  'school-a': [
    {
      slug: 'home',
      title: 'Primary school, grades 1 to 4',
      blocks: [
        [
          'p',
          'Pythagoras Sofia teaches children from grade 1 to grade 4, in four classes of up to 24. Lessons run from 08:00 to 13:00, followed by lunch and afternoon clubs.',
        ],
        ['h2', 'This year'],
        [
          'ul',
          [
            'Classes 1A, 2A, 3A and 4A. Class 1A is full.',
            'Lunch every school day, booked by the day.',
            'Chess on Wednesdays, debate on Tuesdays, piano lessons on Thursdays.',
            'A school bus on route 1.',
          ],
        ],
        ['h2', 'Grade 1 in 2027/28'],
        ['p', '20 places, with applications open until 2 February 2027. [See admissions](/admissions).'],
      ],
    },
    {
      slug: 'our-school',
      title: 'Our school',
      navOrder: 1,
      blocks: [
        ['h2', 'The school day'],
        DAY,
        ['h2', 'Subjects and rooms'],
        SUBJECTS,
        ['h2', 'After lessons'],
        [
          'ul',
          [
            'Chess club, Wednesdays at 14:00',
            'Debate club, Tuesdays at 15:00',
            'Piano lessons, Thursdays at 14:00, in packages of five',
            'A museum visit on Saturday 14 November, with each parent’s permission',
          ],
        ],
        PORTAL,
      ],
    },
    {
      slug: 'team',
      title: 'Our team',
      navOrder: 2,
      blocks: [
        ['p', 'Petar Nikolov is the principal of Pythagoras Sofia.'],
        ['h2', 'Teachers'],
        teachers([
          'Ms Vasileva',
          'Ms Stoyanova',
          'Mr Harris',
          'Ms Pavlova',
          'Mr Yordanov',
          'Mr Kolev',
          'Ms Rangelova',
          'Mr Bonev',
        ]),
        ['p', 'To reach a teacher or the office, send a request from the family portal.'],
      ],
    },
    {
      slug: 'fees',
      title: 'Fees',
      navOrder: 3,
      blocks: [
        ['p', 'Fees for 2026/27.'],
        [
          'ul',
          [
            'Tuition: €450 a month',
            'Enrolment fee: €150, once, when your child joins',
            'Lunch: €4.50 a day',
            'Chess club: €60 a term',
            'Debate club: €50 a term',
            'Piano lessons: €120 for five lessons',
            'School bus, route 1: €90 a term',
            'School polo shirt: €25 or €28, by size',
            'Museum visit: €15',
          ],
        ],
        PORTAL,
      ],
    },
    {
      slug: 'admissions',
      title: 'Admissions',
      navOrder: 4,
      blocks: [
        ['h2', 'Grade 1 for 2027/28'],
        [
          'p',
          '20 places. Applications open on 3 November 2026 and close on 2 February 2027. An offer stays open for 14 days.',
        ],
        ['h2', 'How to apply'],
        HOW_TO_APPLY,
        ASK,
      ],
    },
    {
      slug: 'news',
      title: 'News',
      navOrder: 5,
      blocks: [
        ['h2', 'Museum visit on 14 November'],
        [
          'p',
          'We visit the museum by coach with school staff. Parents give their permission and book the visit in the family portal.',
        ],
        ['h2', 'Chess club starts on 11 November'],
        ['p', 'Wednesdays at 14:00 until the end of December. Book it in the family portal.'],
        ['h2', 'Grade 1 applications are open'],
        ['p', 'Until 2 February 2027. [Ask about a place](/inquiry).'],
      ],
    },
  ],

  'school-b': [
    {
      slug: 'home',
      title: 'Grades 5 to 7',
      blocks: [
        [
          'p',
          'Pythagoras Varna teaches grades 5 to 7, in classes of up to 26. Lessons run from 08:00 to 13:00, with clubs in the afternoon.',
        ],
        ['h2', 'This year'],
        [
          'ul',
          [
            'Classes 5A, 6A and 7A. Class 6A is full.',
            'Lunch every school day, booked by the day.',
            'The art studio on Wednesdays. It is full; families can join its waiting list in the family portal.',
          ],
        ],
      ],
    },
    {
      slug: 'our-school',
      title: 'Our school',
      navOrder: 1,
      blocks: [
        ['h2', 'The school day'],
        DAY,
        ['h2', 'Subjects and rooms'],
        SUBJECTS,
        ['h2', 'After lessons'],
        ['ul', ['Art studio, Wednesdays at 15:00']],
        PORTAL,
      ],
    },
    {
      slug: 'team',
      title: 'Our team',
      navOrder: 2,
      blocks: [
        ['p', 'Desislava Todorova is the principal of Pythagoras Varna.'],
        ['h2', 'Teachers'],
        teachers([
          'Mr Dimov',
          'Ms Hristova',
          'Ms Clarke',
          'Mr Vladimirov',
          'Ms Gencheva',
          'Ms Tasheva',
          'Mr Slavov',
          'Ms Zaharieva',
        ]),
        ['p', 'To reach a teacher or the office, send a request from the family portal.'],
      ],
    },
    {
      slug: 'fees',
      title: 'Fees',
      navOrder: 3,
      blocks: [
        ['p', 'Fees for 2026/27.'],
        ['ul', ['Tuition: €420 a month', 'Lunch: €4.80 a day', 'Art studio: €60 a term']],
        PORTAL,
      ],
    },
    {
      slug: 'admissions',
      title: 'Admissions',
      navOrder: 4,
      blocks: [
        [
          'p',
          'Pythagoras Varna is not taking applications for 2027/28 yet. Ask about a place now and the school will contact you when they open.',
        ],
        ['h2', 'How to apply'],
        HOW_TO_APPLY,
        ASK,
      ],
    },
    {
      slug: 'news',
      title: 'News',
      navOrder: 5,
      blocks: [
        ['h2', 'The art studio is full'],
        [
          'p',
          'Every place this term is taken. Join the waiting list in the family portal, where you can see your place in the queue.',
        ],
        ['h2', 'Lunch by the day'],
        ['p', 'Book and pay for lunch only on the days your child needs it, in the family portal.'],
      ],
    },
  ],

  'school-c': [
    {
      slug: 'home',
      title: 'Small classes and afternoon clubs',
      blocks: [
        [
          'p',
          'Pythagoras Academy teaches classes of up to 18 children, from grade 1 to grade 3, and runs courses and clubs in the afternoon.',
        ],
        ['h2', 'This year'],
        [
          'ul',
          [
            'Classes 1B, 2B and 3B. Class 1B is full.',
            'The robotics club on Thursdays at 15:00.',
            'Lunch every school day, booked by the day.',
          ],
        ],
      ],
    },
    {
      slug: 'courses',
      title: 'Courses and clubs',
      navOrder: 1,
      blocks: [
        ['h2', 'Robotics club'],
        ['p', 'Thursdays at 15:00, €80 a term. Children build and program small robots.'],
        ['h2', 'The school day'],
        DAY,
        ['h2', 'Subjects and rooms'],
        SUBJECTS,
        PORTAL,
      ],
    },
    {
      slug: 'team',
      title: 'Our team',
      navOrder: 2,
      blocks: [
        ['p', 'Stefan Angelov is the principal of Pythagoras Academy.'],
        ['h2', 'Teachers'],
        teachers([
          'Ms Mihaylova',
          'Ms Lazarova',
          'Mr Reed',
          'Ms Boneva',
          'Mr Tonev',
          'Mr Valchev',
          'Ms Kirova',
          'Mr Radev',
        ]),
        ['p', 'To reach a teacher or the office, send a request from the family portal.'],
      ],
    },
    {
      slug: 'fees',
      title: 'Fees',
      navOrder: 3,
      blocks: [
        ['p', 'Fees for 2026/27.'],
        ['ul', ['Tuition: €480 a month', 'Lunch: €5.00 a day', 'Robotics club: €80 a term']],
        PORTAL,
      ],
    },
    {
      slug: 'admissions',
      title: 'Admissions',
      navOrder: 4,
      blocks: [
        [
          'p',
          'Classes are small, so places go quickly. Ask early and the school will reply with what is free.',
        ],
        ['h2', 'How to apply'],
        HOW_TO_APPLY,
        ASK,
      ],
    },
    {
      slug: 'news',
      title: 'News',
      navOrder: 5,
      blocks: [
        ['h2', 'Robotics: a new term'],
        [
          'p',
          'The club meets on Thursdays at 15:00 until the end of December. Book it in the family portal.',
        ],
      ],
    },
  ],
};

// --- The CMS ------------------------------------------------------------------

async function call(token, method, path, body) {
  const response = await fetch(`${CMS}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `JWT ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(json.errors ?? json)}`);
  return json;
}

async function signIn() {
  if (!PASSWORD_FILE)
    throw new Error('CMS_DEV_EDITOR_PASSWORD_FILE is not set; run this in the cms container');
  const password = readFileSync(PASSWORD_FILE, 'utf8').trim();
  return (await call(null, 'POST', '/api/users/login', { email: EDITOR, password })).token;
}

const query = (params) => new URLSearchParams(params).toString();

async function tenantId(token, key) {
  const found = await call(
    token,
    'GET',
    `/api/websites?${query({ 'where[key][equals]': key, limit: '1', depth: '0' })}`,
  );
  if (!found.docs[0]) throw new Error(`no website ${key} in the CMS; start the cms container first`);
  return found.docs[0].id;
}

async function pagesOf(token, tenant) {
  const params = { 'where[tenant][equals]': String(tenant), limit: '100', depth: '0', draft: 'true' };
  return (await call(token, 'GET', `/api/pages?${query(params)}`)).docs;
}

async function load(token) {
  for (const [key, pages] of Object.entries(WEBSITES)) {
    const tenant = await tenantId(token, key);
    const existing = new Map((await pagesOf(token, tenant)).map((page) => [page.slug, page.id]));
    for (const page of pages) {
      const data = {
        title: page.title,
        slug: page.slug,
        navOrder: page.navOrder ?? null,
        tenant,
        body: richText(page.blocks),
        _status: 'published',
      };
      const id = existing.get(page.slug);
      if (id) await call(token, 'PATCH', `/api/pages/${id}?depth=0`, data);
      else await call(token, 'POST', '/api/pages?depth=0', data);
    }
    console.log(`${key}: ${pages.length} pages`);
  }
}

async function remove(token) {
  for (const key of Object.keys(WEBSITES)) {
    const tenant = await tenantId(token, key);
    const pages = await pagesOf(token, tenant);
    for (const page of pages) await call(token, 'DELETE', `/api/pages/${page.id}?depth=0`);
    console.log(`${key}: ${pages.length} pages removed`);
  }
}

const token = await signIn();
await (process.argv[2] === 'remove' ? remove(token) : load(token));
