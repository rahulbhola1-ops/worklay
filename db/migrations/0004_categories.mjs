/* Service categories and subcategories, stored in the database instead of the front end.
   service_type: REMOTE (done online), ON_SITE (at the customer's place) or HYBRID (either).
   requires_verification: freelancers must upload the documents in required_documents
   (GOVERNMENT_ID, DRIVERS_LICENSE, BACKGROUND_CHECK) and be approved before taking bookings.
   perks: suggested checkboxes shown to freelancers in this category during onboarding.
   Category ids are the same strings already stored in wl_users/wl_services/wl_projects.category. */
import { sql } from 'kysely';

const UP = [
  `CREATE TABLE wl_categories (
    id                    text PRIMARY KEY,
    name                  text NOT NULL,
    name_et               text NOT NULL,
    icon                  text NOT NULL,
    color                 text NOT NULL DEFAULT '#eef1ff',
    service_type          text NOT NULL CHECK (service_type IN ('REMOTE', 'ON_SITE', 'HYBRID')),
    requires_verification boolean NOT NULL DEFAULT false,
    required_documents    jsonb NOT NULL DEFAULT '[]'::jsonb,
    perks                 jsonb NOT NULL DEFAULT '[]'::jsonb,
    sort_order            integer NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE wl_subcategories (
    id          text PRIMARY KEY,
    category_id text NOT NULL REFERENCES wl_categories (id) ON DELETE CASCADE,
    name        text NOT NULL,
    name_et     text NOT NULL,
    sort_order  integer NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX wl_subcategories_category ON wl_subcategories (category_id, sort_order)`,

  `INSERT INTO wl_categories (id, name, name_et, icon, color, service_type, requires_verification, required_documents, perks, sort_order) VALUES
    ('dev',       'Development & IT',       'Arendus ja IT',             '💻', '#eef1ff', 'REMOTE',  false, '[]', '["Fast turnaround", "Source code included", "Ongoing support"]', 10),
    ('design',    'Design & Creative',      'Disain ja loovtöö',         '🎨', '#fff0e7', 'REMOTE',  false, '[]', '["Source files included", "Unlimited revisions", "Fast turnaround"]', 20),
    ('writing',   'Writing & Translation',  'Kirjutamine ja tõlge',      '✍️', '#e3f8ee', 'REMOTE',  false, '[]', '["Native speaker", "Proofreading included", "Fast turnaround"]', 30),
    ('marketing', 'Digital Marketing',      'Digiturundus',              '📈', '#f0ebff', 'REMOTE',  false, '[]', '["Monthly reports", "Ad budget management", "Fast turnaround"]', 40),
    ('video',     'Video & Animation',      'Video ja animatsioon',      '🎬', '#ffe9ee', 'HYBRID',  false, '[]', '["Pro camera kit", "Editing included", "Drone footage"]', 50),
    ('business',  'Business & Admin',       'Äri ja haldus',             '💼', '#fff6d9', 'REMOTE',  false, '[]', '["Accounting software", "Fast turnaround", "Ongoing support"]', 60),
    ('home',      'Home & Handyman',        'Kodu ja remont',            '🛠️', '#e6f6ff', 'ON_SITE', false, '[]', '["Own tools", "Own vehicle", "Materials can be included"]', 70),
    ('music',     'Music & Audio',          'Muusika ja heli',           '🎧', '#eaf9f3', 'HYBRID',  false, '[]', '["Own sound equipment", "Studio available", "Mixing included"]', 80),
    ('tutoring',  'Tutoring & Lessons',     'Õpetamine ja eratunnid',    '📚', '#fdf1e1', 'HYBRID',  false, '[]', '["Online lessons", "Comes to your home", "Exam preparation", "Learning materials included"]', 90),
    ('events',    'Events & Photography',   'Üritused ja fotograafia',   '📸', '#fdeef4', 'ON_SITE', false, '[]', '["Pro camera kit", "Lighting equipment", "Editing included", "Drone footage", "Delivery within a week"]', 100),
    ('beauty',    'Beauty & Personal Care', 'Ilu ja isikuhooldus',       '💄', '#fbeefb', 'ON_SITE', false, '[]', '["Comes to you", "Own professional kit", "Bridal experience", "Single-use hygienic tools"]', 110),
    ('cleaning',  'Home & Cleaning',        'Kodu ja koristus',          '🧽', '#e7f7f6', 'ON_SITE', true,  '["GOVERNMENT_ID"]', '["Own cleaning supplies", "Eco-friendly products", "Own vacuum & equipment", "Pet-friendly"]', 120),
    ('childcare', 'Childcare & Family',     'Lapsehoid ja pere',         '🧸', '#fff3e0', 'ON_SITE', true,  '["GOVERNMENT_ID"]', '["First-aid certified", "Experience with infants", "Non-smoker", "Can help with homework", "Speaks English"]', 130),
    ('driving',   'Driving & Transport',    'Sõidu- ja veoteenused',     '🚗', '#eaf0ff', 'ON_SITE', true,  '["GOVERNMENT_ID", "DRIVERS_LICENSE"]', '["Valid driver''s licence & car", "Large car / van", "Child seat available", "Can carry heavy items"]', 140)`,

  `INSERT INTO wl_subcategories (id, category_id, name, name_et, sort_order) VALUES
    ('photographer',   'events',    'Photographer',     'Fotograaf',          10),
    ('videographer',   'events',    'Videographer',     'Videograaf',         20),
    ('makeup-artist',  'beauty',    'Makeup Artist',    'Meigikunstnik',      10),
    ('hair-stylist',   'beauty',    'Hair Stylist',     'Juuksur',            20),
    ('house-cleaning', 'cleaning',  'House Cleaning',   'Kodukoristus',       10),
    ('deep-cleaning',  'cleaning',  'Deep Cleaning',    'Suurpuhastus',       20),
    ('moving-help',    'cleaning',  'Moving Help',      'Kolimisabi',         30),
    ('babysitting',    'childcare', 'Babysitting',      'Lapsehoidmine',      10),
    ('nanny',          'childcare', 'Nanny',            'Lapsehoidja',        20),
    ('pet-sitting',    'childcare', 'Pet Sitting',      'Lemmikloomahoid',    30),
    ('personal-driver','driving',   'Personal Driver',  'Isiklik autojuht',   10),
    ('local-delivery', 'driving',   'Local Delivery',   'Kohalik kättetoimetamine', 20)`,
];

const DOWN = [
  'DROP TABLE IF EXISTS wl_subcategories',
  'DROP TABLE IF EXISTS wl_categories',
];

const run = async (db, statements) => { for (const s of statements) await sql.raw(s).execute(db); };

export const up = db => run(db, UP);
export const down = db => run(db, DOWN);
