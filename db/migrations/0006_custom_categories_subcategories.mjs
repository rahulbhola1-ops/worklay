/* Freelancer-created categories, Russian names, and subcategories for every category.

   wl_categories.status: APPROVED, or NEW for a category a freelancer created that an admin hasn't
   looked at yet. NEW categories work straight away for the freelancer and in search, but are left
   off the home page and out of search engines until approved. Their ids start with "own-".
   wl_users.custom_subcategories: a freelancer's own specialisations, next to the standard ones. */
import { sql } from 'kysely';

const RU = {
  dev: 'Разработка и IT', design: 'Дизайн и креатив', writing: 'Тексты и переводы', marketing: 'Цифровой маркетинг', video: 'Видео и анимация',
  business: 'Бизнес и администрирование', home: 'Дом и ремонт', music: 'Музыка и аудио', tutoring: 'Репетиторство и уроки', events: 'Мероприятия и фотосъёмка',
  beauty: 'Красота и уход', cleaning: 'Уборка дома', childcare: 'Присмотр за детьми и семья', driving: 'Перевозки и транспорт',
};
const RU_SUB = {
  photographer: 'Фотограф', videographer: 'Видеограф', 'makeup-artist': 'Визажист', 'hair-stylist': 'Парикмахер', 'house-cleaning': 'Уборка дома', 'deep-cleaning': 'Генеральная уборка',
  'moving-help': 'Помощь с переездом', babysitting: 'Присмотр за детьми', nanny: 'Няня', 'pet-sitting': 'Присмотр за питомцами', 'personal-driver': 'Личный водитель', 'local-delivery': 'Местная доставка',
};
// [category, id, English, Estonian, Russian]
const SUBS = [
  ['dev', 'web-development', 'Web development', 'Veebiarendus', 'Веб-разработка'],
  ['dev', 'mobile-apps', 'Mobile apps', 'Mobiilirakendused', 'Мобильные приложения'],
  ['dev', 'online-shops', 'Online shops', 'E-poed', 'Интернет-магазины'],
  ['dev', 'it-support', 'IT support', 'IT-tugi', 'IT-поддержка'],
  ['dev', 'data-ai', 'Data & AI', 'Andmed ja tehisintellekt', 'Данные и ИИ'],
  ['dev', 'testing-qa', 'Testing & QA', 'Testimine', 'Тестирование'],
  ['design', 'logo-branding', 'Logo & branding', 'Logo ja bränding', 'Логотипы и брендинг'],
  ['design', 'web-ui-design', 'Web & app design', 'Veebi- ja äpidisain', 'Дизайн сайтов и приложений'],
  ['design', 'illustration', 'Illustration', 'Illustratsioon', 'Иллюстрация'],
  ['design', 'print-design', 'Print design', 'Trükidisain', 'Полиграфический дизайн'],
  ['design', 'interior-design', 'Interior design', 'Sisekujundus', 'Дизайн интерьера'],
  ['design', '3d-modelling', '3D modelling', '3D-modelleerimine', '3D-моделирование'],
  ['writing', 'translation', 'Translation', 'Tõlkimine', 'Перевод'],
  ['writing', 'copywriting', 'Copywriting', 'Reklaamtekstid', 'Копирайтинг'],
  ['writing', 'proofreading', 'Proofreading & editing', 'Korrektuur ja toimetamine', 'Корректура и редактура'],
  ['writing', 'blog-articles', 'Blogs & articles', 'Blogid ja artiklid', 'Блоги и статьи'],
  ['writing', 'cv-letters', 'CVs & cover letters', 'CV-d ja kaaskirjad', 'Резюме и письма'],
  ['marketing', 'social-media', 'Social media', 'Sotsiaalmeedia', 'Социальные сети'],
  ['marketing', 'seo', 'Search engine optimisation', 'Otsingumootoritele optimeerimine', 'Поисковая оптимизация'],
  ['marketing', 'online-ads', 'Online advertising', 'Veebireklaam', 'Интернет-реклама'],
  ['marketing', 'email-marketing', 'Email marketing', 'E-posti turundus', 'Email-маркетинг'],
  ['marketing', 'marketing-strategy', 'Marketing strategy', 'Turundusstrateegia', 'Маркетинговая стратегия'],
  ['video', 'video-editing', 'Video editing', 'Videomontaaž', 'Видеомонтаж'],
  ['video', 'animation', 'Animation', 'Animatsioon', 'Анимация'],
  ['video', 'drone-filming', 'Drone filming', 'Droonivõtted', 'Съёмка с дрона'],
  ['video', 'short-form-video', 'Short social videos', 'Lühivideod', 'Короткие видео'],
  ['video', 'promo-video', 'Promo videos', 'Reklaamvideod', 'Рекламные ролики'],
  ['business', 'bookkeeping', 'Bookkeeping', 'Raamatupidamine', 'Бухгалтерия'],
  ['business', 'virtual-assistant', 'Virtual assistant', 'Virtuaalne assistent', 'Виртуальный ассистент'],
  ['business', 'data-entry', 'Data entry', 'Andmesisestus', 'Ввод данных'],
  ['business', 'business-consulting', 'Business consulting', 'Ärikonsultatsioon', 'Бизнес-консультации'],
  ['business', 'recruitment', 'Recruitment', 'Värbamine', 'Подбор персонала'],
  ['business', 'customer-service', 'Customer service', 'Klienditeenindus', 'Обслуживание клиентов'],
  ['home', 'plumbing', 'Plumbing', 'Torutööd', 'Сантехника'],
  ['home', 'electrical', 'Electrical work', 'Elektritööd', 'Электрика'],
  ['home', 'painting', 'Painting', 'Maalritööd', 'Покраска'],
  ['home', 'furniture-assembly', 'Furniture assembly', 'Mööbli kokkupanek', 'Сборка мебели'],
  ['home', 'carpentry', 'Carpentry', 'Puusepatööd', 'Столярные работы'],
  ['home', 'gardening', 'Gardening', 'Aiatööd', 'Садовые работы'],
  ['home', 'appliance-repair', 'Appliance repair', 'Kodumasinate remont', 'Ремонт техники'],
  ['home', 'small-repairs', 'Small repairs', 'Pisiremont', 'Мелкий ремонт'],
  ['music', 'music-production', 'Music production', 'Muusika produtseerimine', 'Музыкальное продюсирование'],
  ['music', 'mixing-mastering', 'Mixing & mastering', 'Miksimine ja masterdamine', 'Сведение и мастеринг'],
  ['music', 'voice-over', 'Voice-over', 'Pealelugemine', 'Озвучивание'],
  ['music', 'live-music', 'Live music', 'Elav muusika', 'Живая музыка'],
  ['music', 'dj', 'DJ', 'DJ', 'Диджей'],
  ['music', 'podcast-editing', 'Podcast editing', 'Podcasti montaaž', 'Монтаж подкастов'],
  ['tutoring', 'school-subjects', 'School subjects', 'Kooliained', 'Школьные предметы'],
  ['tutoring', 'exam-preparation', 'Exam preparation', 'Eksamiks valmistumine', 'Подготовка к экзаменам'],
  ['tutoring', 'language-lessons', 'Language lessons', 'Keeletunnid', 'Уроки языков'],
  ['tutoring', 'music-lessons', 'Music lessons', 'Muusikatunnid', 'Уроки музыки'],
  ['tutoring', 'coding-lessons', 'Coding lessons', 'Programmeerimistunnid', 'Уроки программирования'],
  ['tutoring', 'homework-help', 'Homework help', 'Abi kodutöödega', 'Помощь с домашними заданиями'],
  ['tutoring', 'art-lessons', 'Art lessons', 'Kunstitunnid', 'Уроки рисования'],
  ['tutoring', 'sports-coaching', 'Sports coaching', 'Sporditreening', 'Спортивные тренировки'],
  ['tutoring', 'preschool', 'Preschool preparation', 'Kooliks ettevalmistus', 'Подготовка к школе'],
  ['tutoring', 'special-needs', 'Special needs support', 'Hariduslike erivajaduste tugi', 'Поддержка при особых потребностях'],
  ['events', 'event-planning', 'Event planning', 'Ürituste korraldus', 'Организация мероприятий'],
  ['events', 'wedding-host', 'Wedding host', 'Pulmaisa', 'Ведущий свадьбы'],
  ['events', 'catering-help', 'Catering help', 'Toitlustusabi', 'Помощь с кейтерингом'],
  ['events', 'decoration', 'Decoration', 'Dekoreerimine', 'Оформление'],
  ['events', 'kids-entertainer', 'Children’s entertainer', 'Lastepeo meelelahutaja', 'Детский аниматор'],
  ['beauty', 'nails', 'Nails', 'Küünehooldus', 'Маникюр'],
  ['beauty', 'massage', 'Massage', 'Massaaž', 'Массаж'],
  ['beauty', 'brows-lashes', 'Brows & lashes', 'Kulmud ja ripsmed', 'Брови и ресницы'],
  ['beauty', 'personal-trainer', 'Personal trainer', 'Personaaltreener', 'Персональный тренер'],
  ['beauty', 'barber', 'Barber', 'Habemeajaja', 'Барбер'],
  ['cleaning', 'window-cleaning', 'Window cleaning', 'Akende pesu', 'Мытьё окон'],
  ['cleaning', 'office-cleaning', 'Office cleaning', 'Kontorikoristus', 'Уборка офисов'],
  ['cleaning', 'carpet-sofa', 'Carpet & sofa cleaning', 'Vaiba- ja diivanipesu', 'Чистка ковров и диванов'],
  ['cleaning', 'laundry-ironing', 'Laundry & ironing', 'Pesu ja triikimine', 'Стирка и глажка'],
  ['childcare', 'elderly-care', 'Elderly care', 'Eakate hooldus', 'Уход за пожилыми'],
  ['childcare', 'dog-walking', 'Dog walking', 'Koerte jalutamine', 'Выгул собак'],
  ['childcare', 'school-pickup', 'School pick-up', 'Lapse koolist toomine', 'Встреча из школы'],
  ['driving', 'airport-transfer', 'Airport transfer', 'Lennujaamatransport', 'Трансфер в аэропорт'],
  ['driving', 'moving-van', 'Van & moving', 'Kaubik ja kolimine', 'Фургон и переезды'],
  ['driving', 'courier', 'Courier', 'Kuller', 'Курьер'],
  ['driving', 'car-delivery', 'Car delivery', 'Auto kohaletoomine', 'Перегон автомобиля'],
];
const q = v => `'${String(v).replace(/'/g, "''")}'`;

const UP = [
  `ALTER TABLE wl_categories
     ADD COLUMN name_ru text NOT NULL DEFAULT '',
     ADD COLUMN status text NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPROVED', 'NEW')),
     ADD COLUMN created_by integer REFERENCES wl_users (id) ON DELETE SET NULL,
     ADD COLUMN created_at timestamptz NOT NULL DEFAULT now()`,
  'CREATE UNIQUE INDEX wl_categories_name ON wl_categories (lower(name))',
  `ALTER TABLE wl_subcategories ADD COLUMN name_ru text NOT NULL DEFAULT ''`,
  `ALTER TABLE wl_users ADD COLUMN custom_subcategories jsonb NOT NULL DEFAULT '[]'::jsonb`,
  ...Object.entries(RU).map(([id, ru]) => `UPDATE wl_categories SET name_ru = ${q(ru)} WHERE id = ${q(id)}`),
  ...Object.entries(RU_SUB).map(([id, ru]) => `UPDATE wl_subcategories SET name_ru = ${q(ru)} WHERE id = ${q(id)}`),
  `INSERT INTO wl_subcategories (category_id, id, name, name_et, name_ru, sort_order) VALUES
    ${SUBS.map(([c, id, en, et, ru], i) => `(${[c, id, en, et, ru].map(q).join(', ')}, ${100 + i})`).join(',\n    ')}`,
];

const DOWN = [
  // Freelancers in a category of their own making keep their account but have to pick a category again.
  `UPDATE wl_users SET category = '' WHERE category LIKE 'own-%'`,
  `DELETE FROM wl_categories WHERE id LIKE 'own-%'`,
  `DELETE FROM wl_subcategories WHERE id IN (${SUBS.map(s => q(s[1])).join(', ')})`,
  'ALTER TABLE wl_users DROP COLUMN IF EXISTS custom_subcategories',
  'ALTER TABLE wl_subcategories DROP COLUMN IF EXISTS name_ru',
  'DROP INDEX IF EXISTS wl_categories_name',
  'ALTER TABLE wl_categories DROP COLUMN IF EXISTS created_at, DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS name_ru',
];

const run = async (db, statements) => { for (const s of statements) await sql.raw(s).execute(db); };

export const up = db => run(db, UP);
export const down = db => run(db, DOWN);
