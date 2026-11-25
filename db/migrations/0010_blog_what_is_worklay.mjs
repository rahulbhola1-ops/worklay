/* Blog posts in Estonian and Russian, and the first post: "What is Worklay?".
   The text format is described in blog-text.mjs. */
import { sql } from 'kysely';

const EN = {
  title: 'What is Worklay? A new way to find work',
  excerpt: 'Worklay brings together people who need something done and people who know how to do it. Here is how it works for customers and freelancers.',
  body: `Someone needs a tap fixed, a website built or a child helped with maths. Someone nearby knows exactly how to do it and is looking for work. Too often, the two never meet. Worklay is here to change that.

## What is Worklay?

Worklay is an Estonian marketplace for work of all kinds, online and on site. Customers post a project, choose a ready-made service or book a freelancer for a day and time that suits them. Freelancers show what they can do, set their own prices and hours, and get found by people who need them.

From design and development to tutoring, photography, beauty, cleaning and home repairs: you choose a category and then the exact speciality you need.

## For customers: you stay in control

We want every customer to be satisfied, so Worklay is built around that:

- You see the price before you confirm.
- You pay by card up front, but Worklay holds the money while the work is being done.
- When the work is done, you have 7 days to check it. Approve it and the freelancer is paid. If you do nothing, it counts as approved.
- If something is wrong, report it with proof within those 7 days. The money stays held while we look at it, and if your proof shows the work wasn’t done as agreed, you are refunded.
- In some categories, such as cleaning and childcare, we check the freelancer’s documents before they can be booked.

## For freelancers: work in your own field

We want freelancers to be happy with how they work, too:

- Offer what you are really good at. If no category fits, create your own.
- Decide your own prices, working hours and areas.
- Start knowing that the customer has already paid and the money is waiting.
- When the customer approves the work, your share is sent automatically. If they don’t answer within 7 days, you are paid anyway, unless a problem was reported.
- Creating a profile is free. Worklay keeps 10% of completed jobs, and the rest is yours.

## A new way to find work

Looking for work used to mean sending out applications and waiting. On Worklay, people can find you by what you do, where you are and when you are free. You can also look through projects and send a proposal yourself. A full-time career, a few hours in the evening or a hobby you are good at: it all counts.

## “I don’t have any work”

We believe everyone is good at something, and somewhere there is a person who needs exactly that. Our goal is simple: nobody with a skill should have to say “I don’t have any work”. We can’t promise that every profile gets a booking, but we can make it much easier to be found.

Do you need something done? Find a freelancer. Do you have a skill? Create your profile and show people what you can do.`,
};
const ET = {
  title: 'Mis on Worklay? Uus viis tööd leida',
  excerpt: 'Worklay viib kokku inimesed, kellel on vaja midagi tehtud saada, ja need, kes oskavad seda teha. Vaata, kuidas see klientidele ja vabakutselistele töötab.',
  body: `Kellelgi on vaja kraan korda teha, veebileht valmis saada või last matemaatikas aidata. Keegi lähedal oskab just seda ja otsib tööd. Liiga sageli need kaks ei kohtu. Worklay on loodud selleks, et see muutuks.

## Mis on Worklay?

Worklay on Eesti turuplats igasuguse töö jaoks, nii veebis kui ka kohapeal. Klient postitab projekti, valib valmis teenuse või broneerib vabakutselise endale sobivaks päevaks ja kellaajaks. Vabakutseline näitab, mida ta oskab, määrab ise oma hinnad ja tööajad ning on leitav neile, kes teda vajavad.

Disainist ja arendusest kuni eratundide, pildistamise, ilu, koristuse ja koduremondini: vali kategooria ja seejärel täpne eriala, mida vajad.

## Kliendile: sina otsustad

Tahame, et iga klient jääks rahule, ja Worklay on ehitatud selle järgi:

- Näed hinda enne kinnitamist.
- Maksad kaardiga ette, kuid Worklay hoiab raha töö tegemise ajal.
- Kui töö on tehtud, on sul 7 päeva aega see üle vaadata. Kui kinnitad, saab vabakutseline raha. Kui sa midagi ei tee, loetakse töö kinnitatuks.
- Kui midagi on valesti, teata sellest nende 7 päeva jooksul koos tõendiga. Raha jääb hoiule, kuni me olukorra üle vaatame, ja kui tõend näitab, et töö ei vasta kokkulepitule, saad raha tagasi.
- Mõnes kategoorias, näiteks koristuses ja lapsehoius, kontrollime vabakutselise dokumente enne, kui teda saab broneerida.

## Vabakutselisele: töö oma alal

Tahame, et ka vabakutselised oleksid oma tööga rahul:

- Paku seda, milles oled päriselt hea. Kui sobivat kategooriat pole, loo enda oma.
- Otsusta ise oma hinnad, tööajad ja piirkonnad.
- Alusta tööd teadmisega, et klient on juba maksnud ja raha ootab.
- Kui klient töö kinnitab, kantakse sinu osa üle automaatselt. Kui ta 7 päeva jooksul ei vasta, saad raha ikkagi, välja arvatud juhul, kui on teatatud probleemist.
- Profiili loomine on tasuta. Worklay jätab lõpetatud töödest endale 10%, ülejäänu on sinu.

## Uus viis tööd leida

Varem tähendas töö otsimine avalduste saatmist ja ootamist. Worklays leitakse sind selle järgi, mida sa teed, kus sa oled ja millal sul aega on. Võid ka ise projekte vaadata ja pakkumise saata. Täiskohaga amet, paar tundi õhtuti või hobi, milles oled hea: kõik loeb.

## „Mul ei ole tööd”

Usume, et igaüks on milleski hea ja kusagil on inimene, kes vajab just seda. Meie eesmärk on lihtne: keegi, kellel on oskus, ei peaks ütlema „mul ei ole tööd”. Me ei saa lubada, et iga profiil saab broneeringu, kuid saame teha leitavaks olemise palju lihtsamaks.

Vajad midagi tehtud? Leia vabakutseline. Sul on oskus? Loo profiil ja näita, mida sa oskad.`,
};
const RU = {
  title: 'Что такое Worklay? Новый способ найти работу',
  excerpt: 'Worklay соединяет тех, кому нужно что-то сделать, с теми, кто умеет это делать. Рассказываем, как это работает для клиентов и фрилансеров.',
  body: `Кому-то нужно починить кран, сделать сайт или помочь ребёнку с математикой. Кто-то рядом умеет именно это и ищет работу. Слишком часто они так и не встречаются. Worklay создан, чтобы это изменить.

## Что такое Worklay?

Worklay — эстонская площадка для самой разной работы, онлайн и на месте. Клиент размещает проект, выбирает готовую услугу или бронирует фрилансера на удобные день и время. Фрилансер показывает, что он умеет, сам назначает цены и часы работы, и его находят те, кому он нужен.

От дизайна и разработки до репетиторства, фотосъёмки, красоты, уборки и домашнего ремонта: выберите категорию, а затем нужную специализацию.

## Клиентам: всё под вашим контролем

Мы хотим, чтобы каждый клиент остался доволен, и Worklay устроен именно так:

- Вы видите цену до подтверждения.
- Вы платите картой заранее, но Worklay хранит деньги, пока работа выполняется.
- Когда работа готова, у вас есть 7 дней, чтобы её проверить. Если вы подтверждаете её, фрилансер получает деньги. Если вы ничего не сделаете, работа считается подтверждённой.
- Если что-то не так, сообщите об этом с доказательствами в течение этих 7 дней. Деньги остаются на хранении, пока мы разбираемся, и если доказательства покажут, что работа не соответствует договорённости, вы получите возврат.
- В некоторых категориях, например в уборке и присмотре за детьми, мы проверяем документы фрилансера до первых бронирований.

## Фрилансерам: работа в своей области

Мы хотим, чтобы и фрилансеры были довольны своей работой:

- Предлагайте то, что действительно умеете. Если подходящей категории нет, создайте свою.
- Сами решайте, какие у вас цены, часы и районы работы.
- Начинайте, зная, что клиент уже заплатил и деньги ждут.
- Когда клиент подтверждает работу, ваша доля переводится автоматически. Если он не ответит в течение 7 дней, вы всё равно получите деньги, если не было сообщения о проблеме.
- Создать профиль можно бесплатно. Worklay удерживает 10% с выполненных работ, остальное ваше.

## Новый способ найти работу

Раньше искать работу значило рассылать заявки и ждать. На Worklay вас находят по тому, что вы делаете, где находитесь и когда свободны. Вы можете и сами просматривать проекты и отправлять предложения. Основная профессия, пара часов вечером или любимое дело, которое хорошо получается, — всё подходит.

## «У меня нет работы»

Мы верим, что каждый в чём-то хорош и что где-то есть человек, которому нужно именно это. Наша цель проста: никто, у кого есть умение, не должен говорить «у меня нет работы». Мы не можем обещать, что каждый профиль получит заказ, но можем сделать так, чтобы вас было намного легче найти.

Нужно что-то сделать? Найдите фрилансера. Есть умение? Создайте профиль и покажите, что вы умеете.`,
};
const q = s => `$wl$${s}$wl$`; // dollar quoting: the text needs no escaping

const UP = [
  `ALTER TABLE wl_posts
     ADD COLUMN title_et text, ADD COLUMN excerpt_et text, ADD COLUMN body_et text,
     ADD COLUMN title_ru text, ADD COLUMN excerpt_ru text, ADD COLUMN body_ru text`,
  `INSERT INTO wl_posts (title, emoji, color, excerpt, body, title_et, excerpt_et, body_et, title_ru, excerpt_ru, body_ru)
   VALUES (${[EN.title, '🤝', '#e3f8ee', EN.excerpt, EN.body, ET.title, ET.excerpt, ET.body, RU.title, RU.excerpt, RU.body].map(q).join(', ')})`,
];

const DOWN = [
  `DELETE FROM wl_posts WHERE title = ${q(EN.title)}`,
  `ALTER TABLE wl_posts DROP COLUMN IF EXISTS title_et, DROP COLUMN IF EXISTS excerpt_et, DROP COLUMN IF EXISTS body_et,
     DROP COLUMN IF EXISTS title_ru, DROP COLUMN IF EXISTS excerpt_ru, DROP COLUMN IF EXISTS body_ru`,
];

const run = async (db, statements) => { for (const s of statements) await sql.raw(s).execute(db); };

export const up = db => run(db, UP);
export const down = db => run(db, DOWN);
