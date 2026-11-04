require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString("hex");
const ADMINS = new Set((process.env.ADMIN_TELEGRAM_IDS || "").split(",").map(s=>s.trim()).filter(Boolean));
const STANDARD_PRICE = Number(process.env.STANDARD_PRICE_STARS || 0);
const PREMIUM_PRICE = Number(process.env.PREMIUM_PRICE_STARS || 0);
const VIP_PERIOD = 2592000;
const PREMIUM_CATEGORIES = new Set(["business","psychology","psychosomatics","leadership","money","personal"]);
const API_BASE = process.env.API_BASE_URL || "";
const PUBLIC_API_URL = process.env.PUBLIC_API_URL || "https://zer0life-book-club-api.onrender.com";
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || "https://zer0life-book-club.onrender.com";
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
}) : null;

// Telegram Mini Apps run the frontend on a different origin from this API.
// Allow the configured app origin and handle browser preflight requests explicitly.
const allowedOrigins = new Set([
  PUBLIC_APP_URL,
  "https://zer0life-book-club.onrender.com",
  "https://web.telegram.org",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
].filter(Boolean).map(value => { try { return new URL(value).origin; } catch { return value; } }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

const sampleBooks = [
 {id:"b1",category:"business",title:"The Lean Startup",author:"Eric Ries",year:2011,lang:"en",priceStars:350,vip:true,description:"A practical framework for testing ideas and building products customers want.",cover:"https://covers.openlibrary.org/b/isbn/9780307887894-L.jpg"},
 {id:"b2",category:"business",title:"От хорошего к великому",author:"Джим Коллинз",year:2001,lang:"ru",priceStars:300,vip:true,description:"Как компании переходят от хороших результатов к выдающимся.",cover:"https://covers.openlibrary.org/b/isbn/9780712676090-L.jpg"},
 {id:"b3",category:"psychology",title:"Thinking, Fast and Slow",author:"Daniel Kahneman",year:2011,lang:"en",priceStars:400,vip:true,description:"How two systems shape our thinking and decisions.",cover:"https://covers.openlibrary.org/b/isbn/9780374533557-L.jpg"},
 {id:"b4",category:"mindfulness",title:"Сила настоящего",author:"Экхарт Толле",year:1997,lang:"ru",priceStars:280,vip:true,description:"Практики внимания к настоящему моменту.",cover:"https://covers.openlibrary.org/b/isbn/9781577311522-L.jpg"},
 {id:"b5",category:"leadership",title:"The Effective Executive",author:"Peter F. Drucker",year:1967,lang:"en",priceStars:320,vip:true,description:"A classic guide to effectiveness and decision-making.",cover:"https://covers.openlibrary.org/b/isbn/9780060144698-L.jpg"},
 {id:"b6",category:"relationships",title:"Пять языков любви",author:"Гэри Чепмен",year:1992,lang:"ru",priceStars:250,vip:false,description:"Популярная модель способов выражать заботу.",cover:"https://covers.openlibrary.org/b/isbn/9780802412706-L.jpg"},
 {id:"b7",category:"money",title:"The Psychology of Money",author:"Morgan Housel",year:2020,lang:"en",priceStars:350,vip:true,description:"Lessons on wealth, behavior, risk and financial decisions.",cover:"https://covers.openlibrary.org/b/isbn/9780857197689-L.jpg"},
 {id:"b8",category:"personal",title:"Atomic Habits",author:"James Clear",year:2018,lang:"en",priceStars:350,vip:true,description:"A practical system for building better habits.",cover:"https://covers.openlibrary.org/b/isbn/9780735211292-L.jpg"}
];
const categories = [
 ["all","Все книги","All books","Wszystkie książki","✦"],["business","Бизнес","Business","Biznes","▣"],
 ["psychology","Психология","Psychology","Psychologia","◉"],["psychosomatics","Психосоматика","Psychosomatics","Psychosomatyka","⌁"],
 ["mindfulness","Осознанность","Mindfulness","Uważność","☼"],["relationships","Любовь и отношения","Love & relationships","Miłość i relacje","♡"],
 ["leadership","CEO и управление","CEO & leadership","CEO i zarządzanie","♜"],["money","Деньги и инвестиции","Money & investing","Finanse i inwestycje","◇"],
 ["personal","Саморазвитие","Personal growth","Rozwój osobisty","↑"],
 ["marketing","Маркетинг","Marketing","Marketing","✧"],
 ["rhetoric","Риторика и красноречие","Rhetoric & eloquence","Retoryka i elokwencja","❝"],
 ["critical-thinking","Критическое мышление","Critical thinking","Myślenie krytyczne","◇"],
 ["communication","Коммуникация","Communication","Komunikacja","↔"],
 ["intelligence","Интеллект и память","Intelligence & memory","Inteligencja i pamięć","⌘"]
];

function validateInitData(initData) {
 if (!BOT_TOKEN || !initData) return null;
 const p = new URLSearchParams(initData), hash = p.get("hash");
 if (!hash) return null;
 p.delete("hash");
 const check = [...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
 const secret = crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
 const calc = crypto.createHmac("sha256",secret).update(check).digest("hex");
 const a=Buffer.from(calc,"hex"), b=Buffer.from(hash,"hex");
 if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return null;
 const authDate=Number(p.get("auth_date")||0);
 if(!authDate || Date.now()/1000-authDate>86400) return null;
 try { return JSON.parse(p.get("user")||"{}"); } catch { return null; }
}
function auth(req,res,next) {
 const raw=req.get("X-Telegram-Init-Data")||"";
 const user=validateInitData(raw);
 if(!user?.id) {
  const p=new URLSearchParams(raw);
  const age=Number(p.get("auth_date")||0);
  const reason=!BOT_TOKEN?"BOT_TOKEN_MISSING":!raw?"INIT_DATA_EMPTY":!p.get("hash")?"HASH_MISSING":!age?"AUTH_DATE_MISSING":Date.now()/1000-age>86400?"INIT_DATA_EXPIRED":"SIGNATURE_INVALID";
  console.warn("Telegram WebApp auth rejected:",reason,"initDataLength:",raw.length);
  return res.status(401).json({error:reason==="BOT_TOKEN_MISSING"?"Telegram bot token is not configured on the API.":reason==="INIT_DATA_EMPTY"?"Telegram did not provide Mini App initData. Open the app using the bot's Launch button.":reason==="INIT_DATA_EXPIRED"?"Telegram session expired. Close and reopen the Mini App from the bot.":"Telegram signature verification failed. Check that BOT_TOKEN belongs to the bot that launched this Mini App."});
 }
 req.user=user; next();
}
function admin(req,res,next) {
 if(!ADMINS.has(String(req.user.id))) return res.status(403).json({error:"Admin access required"});
 next();
}
async function botApi(method, body) {
 const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)
 });
 const j=await r.json(); if(!j.ok) throw new Error(j.description||"Telegram Bot API error"); return j.result;
}
async function initDatabase() {
 if (!pool) throw new Error("DATABASE_URL is not configured");
 await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
   telegram_id BIGINT PRIMARY KEY, username TEXT, first_name TEXT,
   language_code TEXT DEFAULT 'en', created_at TIMESTAMPTZ DEFAULT NOW(),
   updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  CREATE TABLE IF NOT EXISTS books (
   id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL,
   description TEXT DEFAULT '', category TEXT NOT NULL, language TEXT DEFAULT 'en',
   year INTEGER, price_stars INTEGER DEFAULT 0, vip_only BOOLEAN DEFAULT FALSE,
   cover_url TEXT, content_url TEXT, rights_status TEXT DEFAULT 'pending',
   is_published BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE books ADD COLUMN IF NOT EXISTS year INTEGER;\n  ALTER TABLE books ADD COLUMN IF NOT EXISTS source_url TEXT;
  ALTER TABLE books ADD COLUMN IF NOT EXISTS source_license TEXT;
  ALTER TABLE books ADD COLUMN IF NOT EXISTS rights_evidence_url TEXT;
  ALTER TABLE books ADD COLUMN IF NOT EXISTS rights_checked_at TIMESTAMPTZ;
  ALTER TABLE books ADD COLUMN IF NOT EXISTS rights_checked_by BIGINT;
  ALTER TABLE books ADD COLUMN IF NOT EXISTS full_text_source_url TEXT;
  ALTER TABLE books ADD COLUMN IF NOT EXISTS permission_reference TEXT;
  CREATE INDEX IF NOT EXISTS books_rights_review_idx ON books(rights_status,language);
  ALTER TABLE books ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
  CREATE TABLE IF NOT EXISTS memberships (
   telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
   status TEXT DEFAULT 'inactive', plan TEXT DEFAULT 'free',
   expires_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE memberships ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
  ALTER TABLE memberships ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  CREATE TABLE IF NOT EXISTS purchases (
   id BIGSERIAL PRIMARY KEY, telegram_id BIGINT REFERENCES users(telegram_id),
   book_id TEXT REFERENCES books(id), telegram_payment_charge_id TEXT UNIQUE,
   total_amount INTEGER NOT NULL, currency TEXT DEFAULT 'XTR',
   created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS favorites (
   telegram_id BIGINT REFERENCES users(telegram_id), book_id TEXT REFERENCES books(id),
   created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (telegram_id, book_id)
  );
  CREATE TABLE IF NOT EXISTS reading_progress (
   telegram_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
   book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
   current_page INTEGER NOT NULL DEFAULT 0,
   total_pages INTEGER,
   status TEXT NOT NULL DEFAULT 'planned',
   updated_at TIMESTAMPTZ DEFAULT NOW(),
   completed_at TIMESTAMPTZ,
   PRIMARY KEY (telegram_id, book_id),
   CHECK (current_page >= 0),
   CHECK (total_pages IS NULL OR total_pages > 0),
   CHECK (status IN ('planned','reading','completed'))
  );
  CREATE INDEX IF NOT EXISTS reading_progress_user_status_idx ON reading_progress(telegram_id,status);
  CREATE TABLE IF NOT EXISTS academy_progress (
   telegram_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
   month_number INTEGER NOT NULL CHECK (month_number BETWEEN 1 AND 12),
   completed BOOLEAN NOT NULL DEFAULT FALSE,
   completed_at TIMESTAMPTZ,
   updated_at TIMESTAMPTZ DEFAULT NOW(),
   PRIMARY KEY (telegram_id, month_number)
  );
  CREATE INDEX IF NOT EXISTS academy_progress_user_idx ON academy_progress(telegram_id,completed);
  CREATE TABLE IF NOT EXISTS daily_growth_completions (
   telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
   challenge_date DATE NOT NULL,
   challenge_id TEXT NOT NULL,
   xp_earned INTEGER NOT NULL DEFAULT 20 CHECK (xp_earned >= 0),
   completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   PRIMARY KEY (telegram_id, challenge_date)
  );
  CREATE INDEX IF NOT EXISTS daily_growth_user_date_idx ON daily_growth_completions(telegram_id,challenge_date DESC);
  CREATE TABLE IF NOT EXISTS growth_program_progress (
   telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
   program_id TEXT NOT NULL CHECK (program_id IN ('reset-7','transform-30')),
   day_number INTEGER NOT NULL CHECK (day_number BETWEEN 1 AND 30),
   completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   reflection TEXT NOT NULL DEFAULT '',
   PRIMARY KEY (telegram_id,program_id,day_number)
  );
  CREATE INDEX IF NOT EXISTS growth_program_user_idx ON growth_program_progress(telegram_id,program_id,day_number);
  CREATE TABLE IF NOT EXISTS book_pages (
   book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
   page_number INTEGER NOT NULL CHECK (page_number > 0),
   page_text TEXT NOT NULL,
   created_at TIMESTAMPTZ DEFAULT NOW(),
   PRIMARY KEY (book_id,page_number)
  );
  CREATE TABLE IF NOT EXISTS pending_payments (
   payload TEXT PRIMARY KEY, telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
   kind TEXT NOT NULL CHECK (kind IN ('standard','premium','book')),
   book_id TEXT REFERENCES books(id), amount INTEGER NOT NULL,
   currency TEXT NOT NULL DEFAULT 'XTR', status TEXT NOT NULL DEFAULT 'pending',
   created_at TIMESTAMPTZ DEFAULT NOW(), paid_at TIMESTAMPTZ
  );
  ALTER TABLE purchases ADD COLUMN IF NOT EXISTS plan TEXT;
 `);
 console.log("Database schema ready");
}



async function seedOriginalGrowthBooks(){
 const editions=[
 {key:"clear-thinking",category:"critical-thinking",author:"Zer0Life Editorial",ed:[
 ["en","The Clear Mind: A Practical Guide to Critical Thinking","Learn to question assumptions, weigh evidence and make calmer decisions.",[
 "Thinking clearly begins with separating what happened from what you think it means. A fact can be checked; an interpretation is a story built around it. Both matter, but confusing them creates avoidable conflict. When a claim feels urgent or emotionally satisfying, pause and ask: what do I know, how do I know it, and what might I be missing? Write down the claim in one sentence. Then list the evidence that supports it, the evidence that challenges it, and the information you still need. This simple habit slows impulsive certainty and makes room for better judgement.",
 "Good reasoning is not about winning every argument. It is about being willing to update a belief when stronger evidence appears. Look for alternative explanations before choosing the most dramatic one. Ask whether a source has relevant expertise, whether it shows its evidence, and whether independent sources agree. Watch for common traps: treating one example as a rule, confusing correlation with cause, and noticing only information that confirms what you already believe. A useful question is: what evidence would change my mind? If the answer is “nothing”, you may be defending an identity rather than examining an idea.",
 "Use a short decision review. Define the decision and the result you want. Separate facts, assumptions and unknowns. Generate at least two realistic options, including doing nothing. Consider likely benefits, costs, risks and who else is affected. Choose a small reversible test when possible instead of making a large commitment on weak evidence. Afterward, compare what happened with what you expected. Record the lesson without insulting yourself. Clear thinking is a practice, not a personality trait: curiosity, intellectual humility and careful review improve it over time."
 ]],
 ["ru","Ясное мышление: практическое руководство по критическому мышлению","Учись проверять предположения, оценивать доказательства и принимать более взвешенные решения.",[
 "Ясное мышление начинается с разделения события и его интерпретации. Факт можно проверить; интерпретация — это история, которую мы строим вокруг факта. Оба слоя важны, но их смешение создаёт лишние конфликты. Когда утверждение вызывает сильные эмоции или кажется слишком убедительным, остановись и спроси: что я действительно знаю, откуда это известно и чего мне может не хватать? Запиши утверждение одним предложением. Затем отдельно перечисли подтверждения, возражения и то, что ещё нужно выяснить. Эта привычка помогает не путать уверенность с правотой.",
 "Хорошее мышление — не умение победить в каждом споре. Это готовность изменить мнение, когда появляются более сильные доказательства. Прежде чем выбрать самое драматичное объяснение, найди альтернативы. Проверь, обладает ли источник нужной компетенцией, показывает ли он основания и подтверждают ли вывод независимые источники. Остерегайся типичных ошибок: считать один пример универсальным правилом, путать связь с причиной и замечать только то, что подтверждает прежние убеждения. Полезный вопрос: какие факты заставили бы меня пересмотреть позицию? Если ответ — «никакие», возможно, ты защищаешь образ себя, а не исследуешь идею.",
 "Используй короткий разбор решений. Определи задачу и желаемый результат. Раздели факты, предположения и неизвестное. Придумай минимум два реалистичных варианта, включая отказ от действия. Оцени пользу, цену, риски и влияние на других людей. Если возможно, сначала проведи небольшой обратимый эксперимент, а не делай крупную ставку на слабых данных. После решения сравни результат с ожиданиями и запиши вывод без самоунижения. Ясное мышление — не врождённая черта, а практика любознательности, интеллектуальной скромности и честного анализа."
 ]],
 ["pl","Jasny umysł: praktyczny przewodnik po krytycznym myśleniu","Naucz się sprawdzać założenia, oceniać dowody i podejmować bardziej przemyślane decyzje.",[
 "Jasne myślenie zaczyna się od oddzielenia tego, co się wydarzyło, od tego, co Twoim zdaniem to oznacza. Fakt można sprawdzić; interpretacja jest opowieścią zbudowaną wokół faktu. Obie warstwy są ważne, lecz ich mylenie tworzy niepotrzebne konflikty. Gdy twierdzenie wywołuje silne emocje albo brzmi zbyt przekonująco, zatrzymaj się i zapytaj: co naprawdę wiem, skąd to wiem i czego może mi brakować? Zapisz tezę jednym zdaniem. Następnie wypisz argumenty za nią, przeciw niej oraz informacje, których jeszcze potrzebujesz.",
 "Dobre myślenie nie polega na wygrywaniu każdej dyskusji. Polega na gotowości do zmiany zdania, gdy pojawią się mocniejsze dowody. Zanim wybierzesz najbardziej dramatyczne wyjaśnienie, poszukaj alternatyw. Sprawdź, czy źródło ma odpowiednią wiedzę, pokazuje podstawy swoich wniosków i czy niezależne źródła je potwierdzają. Uważaj na typowe pułapki: uznawanie jednego przykładu za regułę, mylenie korelacji z przyczyną i dostrzeganie wyłącznie informacji zgodnych z wcześniejszym przekonaniem. Zapytaj: jakie dowody skłoniłyby mnie do zmiany zdania? Jeśli odpowiedź brzmi „żadne”, być może bronisz własnego wizerunku zamiast badać ideę.",
 "Stosuj krótki przegląd decyzji. Określ problem i oczekiwany rezultat. Oddziel fakty, założenia i niewiadome. Wymyśl co najmniej dwie realne możliwości, w tym brak działania. Rozważ korzyści, koszty, ryzyko i wpływ na innych. Jeśli to możliwe, najpierw przeprowadź mały, odwracalny test zamiast podejmować duże zobowiązanie na podstawie słabych danych. Po decyzji porównaj wynik z oczekiwaniami i zapisz wnioski bez obwiniania siebie. Jasne myślenie to praktyka ciekawości, pokory intelektualnej i uczciwej analizy."
 ]],
 ["uk","Ясне мислення: практичний посібник із критичного мислення","Навчися перевіряти припущення, оцінювати докази та ухвалювати зваженіші рішення.",[
 "Ясне мислення починається з розділення події та її тлумачення. Факт можна перевірити; інтерпретація — це історія, яку ми будуємо навколо факту. Обидва рівні важливі, але їх змішування створює зайві конфлікти. Коли твердження викликає сильні емоції або здається надто переконливим, зупинись і запитай: що я справді знаю, звідки це відомо і чого мені може бракувати? Запиши твердження одним реченням. Окремо переліч докази на його підтримку, заперечення та інформацію, яку ще треба з’ясувати.",
 "Добре мислення — це не здатність перемагати в кожній суперечці. Це готовність змінити думку, коли з’являються вагоміші докази. Перш ніж обрати найдраматичніше пояснення, знайди альтернативи. Перевір, чи має джерело потрібну компетентність, чи показує підстави своїх висновків і чи підтверджують їх незалежні джерела. Остерігайся типових пасток: вважати один приклад правилом, плутати зв’язок із причиною та помічати лише інформацію, що підтверджує попередні переконання. Запитай себе: які докази змусили б мене змінити думку? Якщо відповідь — «жодні», можливо, ти захищаєш власний образ, а не досліджуєш ідею.",
 "Використовуй короткий аналіз рішень. Визнач проблему та бажаний результат. Розділи факти, припущення й невідоме. Запропонуй щонайменше два реалістичні варіанти, включно з бездіяльністю. Оціни користь, витрати, ризики та вплив на інших. Якщо можливо, спершу проведи невеликий зворотний експеримент, а не роби велику ставку на слабких даних. Після рішення порівняй результат з очікуваннями й запиши висновок без самозвинувачень. Ясне мислення — це практика допитливості, інтелектуальної скромності та чесного аналізу."
 ]]]
 },
 {key:"social-intelligence",category:"relationships",author:"Zer0Life Editorial",ed:[
 ["en","Social Intelligence: Understand People Without Manipulating Them","Observe behaviour carefully, listen better and build relationships with respect.",[
 "Understanding another person starts with curiosity, not mind-reading. A facial expression, pause or gesture can have many explanations: tiredness, culture, distraction, discomfort or something unrelated to you. No single signal reliably reveals a hidden thought or proves deception. Observe patterns over time and check your interpretation with respectful questions. Replace “I know what you meant” with “I may have misunderstood—what did you mean?” This keeps observation separate from assumption and gives the other person room to explain.",
 "Listen for both content and feeling. Let the person finish, summarise the point in your own words and ask whether you understood. Open questions such as “What matters most to you here?” often reveal more than rapid advice. Notice your own reactions too: defensiveness, the urge to impress, or the need to control the conversation. A pause can help you respond rather than react. Empathy does not require agreement; it means making a genuine effort to understand another perspective while keeping your own judgement.",
 "Healthy influence is transparent and allows a real choice. Explain your reasons, disclose relevant interests, invite questions and accept “no” without punishment. Manipulation relies on pressure, confusion, guilt, isolation or concealed motives; these may produce compliance but damage trust. Set boundaries with clear language: “I can help with this, but I cannot take responsibility for that.” If a relationship repeatedly leaves you afraid, confused or cut off from support, speak with someone you trust or a qualified professional. The goal is not to control people. It is to build relationships where honesty and agency can coexist."
 ]],
 ["ru","Социальный интеллект: понимай людей без манипуляций","Наблюдай внимательнее, лучше слушай и строй отношения с уважением.",[
 "Понимание другого человека начинается с любопытства, а не с попытки читать мысли. У выражения лица, паузы или жеста может быть много причин: усталость, культурные особенности, отвлечение, дискомфорт или обстоятельства, не связанные с тобой. Один сигнал не раскрывает скрытую мысль и не доказывает обман. Наблюдай за повторяющимися моделями поведения и проверяй свои догадки уважительными вопросами. Вместо «я знаю, что ты имел в виду» скажи: «Возможно, я неправильно понял — что ты хотел сказать?»",
 "Слушай и содержание, и эмоцию. Дай человеку закончить, перескажи его мысль своими словами и уточни, верно ли понял. Открытые вопросы вроде «Что для тебя здесь самое важное?» часто полезнее поспешного совета. Замечай и собственные реакции: защиту, желание произвести впечатление или контролировать разговор. Пауза помогает ответить осознанно, а не реагировать автоматически. Эмпатия не требует согласия. Она означает искреннюю попытку понять другую точку зрения, сохраняя собственное суждение.",
 "Здоровое влияние прозрачно и оставляет человеку реальный выбор. Объясняй причины, раскрывай важные интересы, допускай вопросы и принимай отказ без наказания. Манипуляция опирается на давление, путаницу, чувство вины, изоляцию или скрытые мотивы. Она может вызвать подчинение, но разрушает доверие. Обозначай границы ясно: «Я могу помочь с этим, но не могу взять ответственность за то». Если отношения постоянно заставляют тебя бояться, теряться или отдаляться от поддержки, поговори с близким человеком или квалифицированным специалистом. Цель — не управлять людьми, а строить отношения, в которых есть честность и свобода выбора."
 ]],
 ["pl","Inteligencja społeczna: rozumiej ludzi bez manipulacji","Uważniej obserwuj, lepiej słuchaj i buduj relacje oparte na szacunku.",[
 "Rozumienie drugiej osoby zaczyna się od ciekawości, a nie od czytania w myślach. Mimika, pauza lub gest mogą mieć wiele przyczyn: zmęczenie, kulturę, rozproszenie, dyskomfort albo coś niezwiązanego z Tobą. Żaden pojedynczy sygnał nie ujawnia ukrytej myśli ani nie dowodzi kłamstwa. Obserwuj wzorce w czasie i sprawdzaj swoje interpretacje za pomocą pełnych szacunku pytań. Zamiast mówić „wiem, co miałeś na myśli”, powiedz: „Mogłem źle zrozumieć — co chciałeś powiedzieć?”",
 "Słuchaj zarówno treści, jak i emocji. Pozwól rozmówcy skończyć, podsumuj własnymi słowami jego myśl i zapytaj, czy dobrze zrozumiałeś. Otwarte pytania, takie jak „Co jest dla Ciebie tutaj najważniejsze?”, często mówią więcej niż pośpieszna rada. Zauważaj też własne reakcje: defensywność, chęć zaimponowania lub kontrolowania rozmowy. Pauza pomaga odpowiedzieć świadomie, zamiast reagować automatycznie. Empatia nie wymaga zgody; oznacza szczere staranie, by zrozumieć inną perspektywę przy zachowaniu własnego osądu.",
 "Zdrowy wpływ jest przejrzysty i pozostawia prawdziwy wybór. Wyjaśniaj powody, ujawniaj istotne interesy, zapraszaj do pytań i przyjmuj odmowę bez karania. Manipulacja wykorzystuje presję, dezorientację, poczucie winy, izolację lub ukryte motywy. Może prowadzić do uległości, ale niszczy zaufanie. Wyznaczaj granice jasno: „Mogę pomóc w tej sprawie, ale nie mogę wziąć za nią odpowiedzialności”. Jeśli relacja stale wywołuje lęk, dezorientację lub odcina Cię od wsparcia, porozmawiaj z zaufaną osobą albo specjalistą. Celem nie jest kontrolowanie ludzi, lecz budowanie relacji opartych na uczciwości i wolności wyboru."
 ]],
 ["uk","Соціальний інтелект: розумій людей без маніпуляцій","Спостерігай уважніше, краще слухай і будуй стосунки з повагою.",[
 "Розуміння іншої людини починається з цікавості, а не зі спроб читати думки. Вираз обличчя, пауза чи жест можуть мати багато причин: втома, культурні особливості, неуважність, дискомфорт або обставини, не пов’язані з тобою. Один сигнал не розкриває прихованої думки й не доводить обман. Спостерігай за повторюваними моделями поведінки та перевіряй припущення шанобливими запитаннями. Замість «я знаю, що ти мав на увазі» скажи: «Можливо, я неправильно зрозумів — що ти хотів сказати?»",
 "Слухай і зміст, і почуття. Дай людині завершити думку, перекажи її своїми словами й уточни, чи правильно зрозумів. Відкриті запитання на кшталт «Що для тебе тут найважливіше?» часто корисніші за поспішну пораду. Помічай і власні реакції: захисну позицію, бажання справити враження чи контролювати розмову. Пауза допомагає відповісти свідомо, а не реагувати автоматично. Емпатія не вимагає згоди. Вона означає щире прагнення зрозуміти іншу точку зору, зберігаючи власне судження.",
 "Здоровий вплив є прозорим і залишає людині справжній вибір. Пояснюй причини, відкрито говори про важливі інтереси, заохочуй запитання й приймай відмову без покарання. Маніпуляція спирається на тиск, плутанину, провину, ізоляцію або приховані мотиви. Вона може викликати підкорення, але руйнує довіру. Чітко окреслюй межі: «Я можу допомогти з цим, але не можу взяти за це відповідальність». Якщо стосунки постійно викликають страх, розгубленість або віддаляють від підтримки, поговори з людиною, якій довіряєш, або фахівцем. Мета — не контролювати людей, а будувати стосунки на чесності та свободі вибору."
 ]]]
 },
 {key:"speak-with-clarity",category:"rhetoric",author:"Zer0Life Editorial",ed:[
 ["en","Speak with Clarity: Rhetoric for Everyday Life","Structure ideas, make stronger arguments and speak so people can follow.",[
 "A clear message begins with one central point. Before speaking, ask what you want the listener to understand, feel or do. State the main idea early, then support it with two or three reasons. Use a concrete example to make an abstract point understandable. Remove side stories that do not serve the purpose. A useful structure is: point, reason, example, conclusion. It works in a meeting, a presentation or a difficult personal conversation because it gives the listener a path to follow.",
 "A strong argument is fair to the other side. Define key terms, distinguish evidence from opinion and avoid exaggeration. Present the best version of a reasonable opposing view before explaining where you disagree. This builds credibility and helps you notice weaknesses in your own case. Do not use volume, speed or complicated vocabulary as substitutes for evidence. If you do not know an answer, say so and offer to check. Trust grows when confidence is matched by honesty.",
 "Practise aloud. Choose a topic and explain it in sixty seconds without notes. Record yourself and listen for one improvement: a clearer opening, shorter sentences, a slower pace or a stronger example. In conversation, ask questions and leave space for a reply. Persuasion is not forcing agreement; it is making your reasoning understandable so another person can decide freely. The best speaker is not the person who talks most. It is the person who helps others see the issue more clearly."
 ]],
 ["ru","Говори ясно: риторика для повседневной жизни","Структурируй мысли, строй убедительные аргументы и говори понятно.",[
 "Ясное сообщение начинается с одной главной мысли. Перед разговором спроси себя, что слушатель должен понять, почувствовать или сделать. Сформулируй тезис в начале, затем подкрепи его двумя-тремя причинами. Добавь конкретный пример, чтобы абстрактная мысль стала понятнее. Убери истории, которые не помогают цели. Простая структура: тезис, причина, пример, вывод. Она подходит для встречи, презентации и непростого личного разговора, потому что даёт собеседнику понятный маршрут.",
 "Сильный аргумент честно относится к противоположной позиции. Определи ключевые понятия, отделяй доказательства от мнений и не преувеличивай. Сначала изложи сильнейшую разумную версию чужой точки зрения, а затем объясни, в чём не согласен. Это укрепляет доверие и помогает увидеть слабые места собственной позиции. Не заменяй доказательства громкостью, скоростью речи или сложными словами. Если не знаешь ответа, так и скажи и предложи проверить. Доверие растёт, когда уверенность сочетается с честностью.",
 "Тренируйся вслух. Выбери тему и объясни её за шестьдесят секунд без заметок. Запиши себя и найди одно улучшение: более ясное начало, короткие предложения, спокойный темп или сильный пример. В разговоре задавай вопросы и оставляй место для ответа. Убеждение — не принуждение к согласию, а понятное изложение аргументов, после которого другой человек может свободно решить. Лучший оратор — не тот, кто говорит больше всех, а тот, кто помогает яснее увидеть суть."
 ]],
 ["pl","Mów jasno: retoryka w codziennym życiu","Porządkuj myśli, buduj mocniejsze argumenty i mów tak, by inni mogli zrozumieć.",[
 "Jasny komunikat zaczyna się od jednej głównej myśli. Zanim zaczniesz mówić, zastanów się, co słuchacz ma zrozumieć, poczuć lub zrobić. Przedstaw tezę na początku, a następnie poprzyj ją dwiema lub trzema racjami. Dodaj konkretny przykład, by wyjaśnić abstrakcyjną ideę. Usuń dygresje, które nie służą celowi. Przydatny układ to: teza, powód, przykład, wniosek. Sprawdza się na spotkaniu, prezentacji i w trudnej rozmowie, bo daje słuchaczowi jasną ścieżkę.",
 "Dobry argument uczciwie traktuje drugą stronę. Zdefiniuj ważne pojęcia, odróżniaj dowody od opinii i nie przesadzaj. Najpierw przedstaw najmocniejszą rozsądną wersję przeciwnego stanowiska, a potem wyjaśnij, z czym się nie zgadzasz. To buduje wiarygodność i pomaga dostrzec słabości własnego rozumowania. Nie zastępuj dowodów głośnością, tempem ani skomplikowanym słownictwem. Jeśli nie znasz odpowiedzi, powiedz to i zaproponuj sprawdzenie. Zaufanie rośnie, gdy pewność idzie w parze z uczciwością.",
 "Ćwicz na głos. Wybierz temat i wyjaśnij go w sześćdziesiąt sekund bez notatek. Nagraj się i wybierz jedną rzecz do poprawy: jaśniejszy początek, krótsze zdania, spokojniejsze tempo lub lepszy przykład. W rozmowie zadawaj pytania i zostawiaj przestrzeń na odpowiedź. Perswazja nie polega na wymuszaniu zgody, lecz na jasnym przedstawieniu rozumowania, by druga osoba mogła swobodnie zdecydować. Najlepszy mówca nie mówi najwięcej — pomaga innym lepiej zrozumieć sprawę."
 ]],
 ["uk","Говори чітко: риторика для щоденного життя","Структуруй думки, будуй сильніші аргументи й говори зрозуміло.",[
 "Чітке повідомлення починається з однієї головної думки. Перед розмовою запитай себе, що слухач має зрозуміти, відчути або зробити. Сформулюй тезу на початку, а потім підкріпи її двома-трьома причинами. Додай конкретний приклад, щоб абстрактна думка стала зрозумілою. Прибери відступи, які не служать меті. Корисна структура: теза, причина, приклад, висновок. Вона працює на зустрічі, презентації та у складній особистій розмові, бо дає слухачеві зрозумілий шлях.",
 "Сильний аргумент чесно ставиться до протилежної позиції. Визнач ключові поняття, відрізняй докази від думок і не перебільшуй. Спершу виклади найсильнішу розумну версію чужої позиції, а потім поясни, з чим не погоджуєшся. Це зміцнює довіру й допомагає побачити слабкі місця власної аргументації. Не замінюй докази гучністю, швидкістю чи складними словами. Якщо не знаєш відповіді, скажи про це й запропонуй перевірити. Довіра зростає, коли впевненість поєднується з чесністю.",
 "Тренуйся вголос. Обери тему й поясни її за шістдесят секунд без нотаток. Запиши себе та знайди одне покращення: чіткіший початок, коротші речення, спокійніший темп або сильніший приклад. У розмові став запитання й залишай простір для відповіді. Переконання — це не примус до згоди, а зрозуміле викладення аргументів, після якого інша людина може вільно вирішити. Найкращий промовець — не той, хто говорить найбільше, а той, хто допомагає краще побачити суть."
 ]]]
 },
 {key:"personal-systems",category:"personal",author:"Zer0Life Editorial",ed:[
 ["en","Build Your Personal System: Habits, Focus and Follow-Through","Turn meaningful goals into small repeatable actions without burnout.",[
 "A goal gives direction, but a system determines what happens on an ordinary Tuesday. Convert a broad ambition into a behaviour you can observe. “Get healthier” is vague; “take a ten-minute walk after lunch” is specific. Make the first version small enough to repeat on a difficult day. Attach it to an existing routine and prepare the environment: put the book where you drink coffee, or keep the walking shoes by the door. Reduce friction before relying on willpower.",
 "Protect attention by choosing one priority for a defined period. Write the next physical action, silence nonessential notifications and keep only the materials you need in front of you. When you get distracted, return without turning the interruption into a reason to quit. Use breaks and rest as part of the system, not as rewards you must earn. Sustainable progress includes recovery. If a routine repeatedly fails, investigate the design: is it too large, poorly timed or dependent on conditions you cannot control?",
 "Review your system once a week. What did you actually do? What made it easier? What got in the way? Change one element at a time so you can learn what works. Track behaviours you control rather than comparing your life with someone else's highlight reel. Missing a day is information, not a verdict. Restart with the next opportunity. A strong personal system is flexible enough for real life and clear enough to guide action. The aim is not perfect productivity; it is steady movement toward what matters."
 ]],
 ["ru","Личная система: привычки, фокус и доведение дел до конца","Превращай значимые цели в небольшие повторяемые действия без выгорания.",[
 "Цель задаёт направление, но система определяет, что произойдёт в обычный вторник. Преврати широкое желание в поведение, которое можно увидеть. «Стать здоровее» — расплывчато; «гулять десять минут после обеда» — конкретно. Сделай первый шаг настолько небольшим, чтобы повторить его даже в трудный день. Привяжи его к уже существующему распорядку и подготовь среду: положи книгу рядом с местом, где пьёшь кофе, или поставь обувь у двери. Сначала убери препятствия, а не полагайся только на силу воли.",
 "Защищай внимание, выбирая один приоритет на определённое время. Запиши следующее физическое действие, отключи ненужные уведомления и оставь перед собой только нужные материалы. Если отвлёкся, просто вернись к задаче, не превращая паузу в повод всё бросить. Отдых и перерывы — часть системы, а не награда, которую нужно заслужить. Устойчивый прогресс включает восстановление. Если привычка постоянно срывается, изучи её конструкцию: не слишком ли она велика, неудобно ли выбрано время и не зависит ли от неподконтрольных условий?",
 "Раз в неделю пересматривай систему. Что ты действительно сделал? Что помогло? Что мешало? Меняй по одному элементу за раз, чтобы понять, что работает. Отслеживай действия, которые контролируешь, а не сравнивай жизнь с чужими лучшими моментами. Пропущенный день — это информация, а не приговор. Начни снова при первой возможности. Хорошая личная система достаточно гибкая для реальной жизни и достаточно ясная, чтобы направлять действия. Цель — не идеальная продуктивность, а устойчивое движение к важному."
 ]],
 ["pl","Twój osobisty system: nawyki, koncentracja i konsekwencja","Zamieniaj ważne cele w małe, powtarzalne działania bez wypalenia.",[
 "Cel wyznacza kierunek, ale system decyduje o tym, co wydarzy się w zwykły wtorek. Zamień szeroką ambicję w zachowanie, które można zaobserwować. „Zadbać o zdrowie” jest niejasne; „spacerować dziesięć minut po obiedzie” jest konkretne. Niech pierwszy krok będzie na tyle mały, by dało się go powtórzyć nawet w trudny dzień. Połącz go z istniejącą rutyną i przygotuj otoczenie: połóż książkę obok miejsca, gdzie pijesz kawę, albo postaw buty przy drzwiach. Najpierw usuń przeszkody, zamiast polegać wyłącznie na silnej woli.",
 "Chroń uwagę, wybierając jeden priorytet na określony czas. Zapisz najbliższe fizyczne działanie, wycisz zbędne powiadomienia i zostaw przed sobą tylko potrzebne materiały. Gdy się rozproszysz, wróć do zadania bez traktowania przerwy jako powodu do rezygnacji. Odpoczynek i przerwy są częścią systemu, a nie nagrodą, na którą trzeba zasłużyć. Trwały postęp wymaga regeneracji. Jeśli nawyk stale się nie udaje, przyjrzyj się jego konstrukcji: czy jest zbyt duży, źle zaplanowany albo zależny od warunków poza Twoją kontrolą?",
 "Raz w tygodniu przejrzyj swój system. Co naprawdę zrobiłeś? Co ułatwiło działanie? Co przeszkadzało? Zmieniaj jeden element naraz, by sprawdzić, co działa. Śledź zachowania, na które masz wpływ, zamiast porównywać swoje życie z najlepszymi chwilami innych. Pominięty dzień to informacja, nie wyrok. Wróć przy najbliższej okazji. Dobry system osobisty jest wystarczająco elastyczny dla prawdziwego życia i wystarczająco jasny, by kierować działaniem. Celem nie jest idealna produktywność, lecz stały ruch w stronę tego, co ważne."
 ]],
 ["uk","Твоя особиста система: звички, фокус і послідовність","Перетворюй важливі цілі на невеликі повторювані дії без вигорання.",[
 "Мета задає напрямок, але система визначає, що відбуватиметься звичайного вівторка. Перетвори широке прагнення на поведінку, яку можна побачити. «Стати здоровішим» — нечітко; «гуляти десять хвилин після обіду» — конкретно. Зроби перший крок настільки малим, щоб повторити його навіть у складний день. Поєднай його з наявним розпорядком і підготуй середовище: поклади книжку біля місця, де п’єш каву, або постав взуття біля дверей. Спершу прибери перешкоди, а не покладайся лише на силу волі.",
 "Захищай увагу, обираючи один пріоритет на визначений час. Запиши наступну фізичну дію, вимкни непотрібні сповіщення й залиш перед собою лише потрібні матеріали. Якщо відволікся, повернись до завдання, не перетворюючи паузу на причину все кинути. Відпочинок і перерви — частина системи, а не нагорода, яку треба заслужити. Сталий прогрес включає відновлення. Якщо звичка постійно не вдається, досліди її конструкцію: чи не завелика вона, чи зручно обрано час і чи не залежить від умов, які ти не контролюєш?",
 "Раз на тиждень переглядай свою систему. Що ти справді зробив? Що допомогло? Що завадило? Змінюй лише один елемент за раз, щоб зрозуміти, що працює. Відстежуй дії, які контролюєш, а не порівнюй життя з чужими найкращими моментами. Пропущений день — це інформація, а не вирок. Почни знову за першої нагоди. Хороша особиста система достатньо гнучка для реального життя й достатньо зрозуміла, щоб спрямовувати дії. Мета — не ідеальна продуктивність, а послідовний рух до важливого."
 ]]]
 }
 ];
 let added=0,pages=0;
 for(const book of editions){
  const cover="https://raw.githubusercontent.com/wlodek2106-cyber/zer0life-book-club-/main/covers/"+book.key+".svg";
  for(const [lang,title,description,chapters] of book.ed){
   const id="zl-"+book.key+"-"+lang;
   const client=await pool.connect();
   try{
    await client.query("BEGIN");
    const exists=await client.query("SELECT id FROM books WHERE id=$1 FOR UPDATE",[id]);
    if(exists.rowCount){await client.query("ROLLBACK");continue;}
    await client.query(`INSERT INTO books(id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url)
     VALUES($1,$2,$3,$4,$5,$6,2026,0,FALSE,$7,NULL,'original',FALSE,NULL,$8,$9)`,
     [id,title,book.author,description,book.category,lang,cover,"Original text written for Zer0Life Book Club; commercial distribution permitted by project ownership.","Original editorial content authored for Zer0Life Book Club."]);
    for(let i=0;i<chapters.length;i++){
     await client.query("INSERT INTO book_pages(book_id,page_number,page_text) VALUES($1,$2,$3)",[id,i+1,chapters[i]]);
     pages++;
    }
    await client.query("UPDATE books SET is_published=FALSE WHERE id=$1 AND rights_status='original'",[id]);
    await client.query("COMMIT");added++;
   }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }
 }
 console.log("Original Zer0Life multilingual books published:",added,"complete chapters:",pages);
 return {added,pages};
}

async function seedOriginalStarterBooks() {
  // Short starter guides are not part of the product. Keep them unpublished.
  // Only complete, rights-cleared books with full text may appear in the catalog.
  const result = await pool.query(
    "UPDATE books SET is_published=FALSE WHERE is_published=TRUE AND (id LIKE 'zl-original-%' OR id LIKE 'zl-clear-thinking-%' OR id LIKE 'zl-social-intelligence-%' OR id LIKE 'zl-speak-with-clarity-%' OR id LIKE 'zl-personal-systems-%')"
  );
  console.log("Short starter guides hidden from catalog:", result.rowCount);
}


async function seedInitialEnglishClassics(){
 const works=[
  {id:1342,title:"Pride and Prejudice",author:"Jane Austen",death:1817,year:1813,category:"relationships"},
  {id:84,title:"Frankenstein; or, The Modern Prometheus",author:"Mary Shelley",death:1851,year:1818,category:"psychology"},
  {id:11,title:"Alice’s Adventures in Wonderland",author:"Lewis Carroll",death:1898,year:1865,category:"personal"},
  {id:1661,title:"The Adventures of Sherlock Holmes",author:"Arthur Conan Doyle",death:1930,year:1892,category:"personal"},
  {id:174,title:"The Picture of Dorian Gray",author:"Oscar Wilde",death:1900,year:1890,category:"psychology"}
 ];
 let added=0;
 for(const w of works){
  if(2026-w.death<71)continue;
  const id="pg-"+w.id;
  const contentUrl="https://www.gutenberg.org/cache/epub/"+w.id+"/pg"+w.id+".txt.utf8";
  const sourceUrl="https://www.gutenberg.org/ebooks/"+w.id;
  const evidence=null;
  const r=await pool.query(`INSERT INTO books
   (id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url)
   VALUES($1,$2,$3,$4,$5,'en', $6,0,FALSE,NULL,$7,'pending',FALSE,$8,$9,$10)
   ON CONFLICT(id) DO UPDATE SET cover_url=EXCLUDED.cover_url,description=EXCLUDED.description,category=EXCLUDED.category WHERE books.rights_status='pending' AND books.is_published=FALSE RETURNING id`,
   [id,w.title,w.author,"Original English edition. Author died more than 70 years ago; edition and source terms retained for review.",w.category,w.year,contentUrl,sourceUrl,"Project Gutenberg US public-domain claim; EU/Polish redistribution review required",evidence]);
  added+=r.rowCount;
 }
 console.log("Initial English classics queued for rights review:",added);
}
async function seedSlavicClassicsForRightsReview(){
 const works=[
  {id:'ru-war-and-peace',title:'Война и мир',author:'Лев Толстой',death:1910,year:1869,lang:'ru',category:'personal',source:'https://ru.wikisource.org/wiki/Война_и_мир'},
  {id:'ru-crime-and-punishment',title:'Преступление и наказание',author:'Фёдор Достоевский',death:1881,year:1866,lang:'ru',category:'psychology',source:'https://ru.wikisource.org/wiki/Преступление_и_наказание'},
  {id:'pl-lalka',title:'Lalka',author:'Bolesław Prus',death:1912,year:1890,lang:'pl',category:'personal',source:'https://pl.wikisource.org/wiki/Lalka'},
  {id:'pl-quo-vadis',title:'Quo Vadis',author:'Henryk Sienkiewicz',death:1916,year:1896,lang:'pl',category:'personal',source:'https://pl.wikisource.org/wiki/Quo_Vadis'},
  {id:'uk-tini-zabutykh-predkiv',title:'Тіні забутих предків',author:'Михайло Коцюбинський',death:1913,year:1911,lang:'uk',category:'personal',source:'https://uk.wikisource.org/wiki/Тіні_забутих_предків'},
  {id:'uk-zakhar-berkut',title:'Захар Беркут',author:'Іван Франко',death:1916,year:1883,lang:'uk',category:'personal',source:'https://uk.wikisource.org/wiki/Захар_Беркут'}
 ];
 for(const w of works){
  if(2026-w.death<71)continue;
  await pool.query(`INSERT INTO books(id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url)
   VALUES($1,$2,$3,'Original-language edition candidate. Full text and exact edition rights must be verified before distribution.',$4,$5,$6,0,FALSE,NULL,NULL,'pending',FALSE,$7,'Author death term appears expired; edition, translation, scan and commercial redistribution rights remain unverified',NULL)
   ON CONFLICT(id) DO NOTHING`,[w.id,w.title,w.author,w.category,w.lang,w.year,w.source||null]);
 }
 console.log('Slavic classics queued for edition-level rights review');
}
async function seedMoreSlavicClassicsForReview(){
 const works=[
  {id:'ru-anna-karenina',title:'Анна Каренина',author:'Лев Толстой',death:1910,year:1878,lang:'ru',source:'https://ru.wikisource.org/wiki/Анна_Каренина'},
  {id:'ru-fathers-and-sons',title:'Отцы и дети',author:'Иван Тургенев',death:1883,year:1862,lang:'ru',source:'https://ru.wikisource.org/wiki/Отцы_и_дети'},
  {id:'ru-dead-souls',title:'Мёртвые души',author:'Николай Гоголь',death:1852,year:1842,lang:'ru',source:'https://ru.wikisource.org/wiki/Мёртвые_души'},
  {id:'ru-hero-of-our-time',title:'Герой нашего времени',author:'Михаил Лермонтов',death:1841,year:1840,lang:'ru',source:'https://ru.wikisource.org/wiki/Герой_нашего_времени'},
  {id:'pl-pan-tadeusz',title:'Pan Tadeusz',author:'Adam Mickiewicz',death:1855,year:1834,lang:'pl',source:'https://pl.wikisource.org/wiki/Pan_Tadeusz'},
  {id:'pl-krzyzacy',title:'Krzyżacy',author:'Henryk Sienkiewicz',death:1916,year:1900,lang:'pl',source:'https://pl.wikisource.org/wiki/Krzyżacy'},
  {id:'pl-potop',title:'Potop',author:'Henryk Sienkiewicz',death:1916,year:1886,lang:'pl',source:'https://pl.wikisource.org/wiki/Potop'},
  {id:'pl-faraon',title:'Faraon',author:'Bolesław Prus',death:1912,year:1897,lang:'pl',source:'https://pl.wikisource.org/wiki/Faraon'},
  {id:'uk-kaidash-family',title:'Кайдашева сім’я',author:'Іван Нечуй-Левицький',death:1918,year:1879,lang:'uk',source:'https://uk.wikisource.org/wiki/Кайдашева_сім’я'},
  {id:'uk-forest-song',title:'Лісова пісня',author:'Леся Українка',death:1913,year:1911,lang:'uk',source:'https://uk.wikisource.org/wiki/Лісова_пісня'},
  {id:'uk-aeneid',title:'Енеїда',author:'Іван Котляревський',death:1838,year:1798,lang:'uk',source:'https://uk.wikisource.org/wiki/Енеїда_(Котляревський)'},
  {id:'uk-black-council',title:'Чорна рада',author:'Пантелеймон Куліш',death:1897,year:1857,lang:'uk',source:'https://uk.wikisource.org/wiki/Чорна_рада'}
 ];
 for(const w of works){
  if(2026-w.death<71)continue;
  await pool.query(`INSERT INTO books(id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url)
   VALUES($1,$2,$3,'Original-language literary work candidate. Wikisource edition and exact licence must be reviewed before text import or redistribution.','personal',$4,$5,0,FALSE,NULL,NULL,'pending',FALSE,$6,'Source edition licence not yet verified; commercial subscription redistribution not approved',NULL)
   ON CONFLICT(id) DO NOTHING`,[w.id,w.title,w.author,w.lang,w.year,w.source]);
 }
 console.log('Additional Slavic classics queued for edition and licence review:',works.length);
}

async function seedKnowledgeLibraryCandidates(){
 const works=[
 ["en-wealth-nations","The Wealth of Nations","Adam Smith",1790,1776,"en","money","https://en.wikisource.org/wiki/The_Wealth_of_Nations"],
 ["en-progress-poverty","Progress and Poverty","Henry George",1897,1879,"en","money","https://en.wikisource.org/wiki/Progress_and_Poverty"],
 ["en-principles-management","The Principles of Scientific Management","Frederick Winslow Taylor",1915,1911,"en","business","https://en.wikisource.org/wiki/The_Principles_of_Scientific_Management"],
 ["en-principles-psychology","The Principles of Psychology","William James",1910,1890,"en","psychology","https://en.wikisource.org/wiki/The_Principles_of_Psychology"],
 ["ru-capital","Капитал","Карл Маркс",1883,1867,"ru","money","https://ru.wikisource.org/wiki/Капитал"],
 ["ru-wealth-nations","Исследование о природе и причинах богатства народов","Адам Смит",1790,1776,"ru","money","https://ru.wikisource.org/wiki/Исследование_о_природе_и_причинах_богатства_народов"],
 ["ru-science-management","Принципы научного менеджмента","Фредерик Тейлор",1915,1911,"ru","business","https://ru.wikisource.org/wiki/Принципы_научного_менеджмента"],
 ["ru-psychology","Психология","Иван Сикорский",1919,1908,"ru","psychology","https://ru.wikisource.org/wiki/Психология_(Сикорский)"],
 ["pl-wealth-nations","Badania nad naturą i przyczynami bogactwa narodów","Adam Smith",1790,1776,"pl","money","https://pl.wikisource.org/wiki/Badania_nad_naturą_i_przyczynami_bogactwa_narodów"],
 ["pl-principles-management","Zasady naukowego zarządzania","Frederick Winslow Taylor",1915,1911,"pl","business","https://pl.wikisource.org/wiki/Zasady_naukowego_zarządzania"],
 ["uk-wealth-nations","Добробут націй","Адам Сміт",1790,1776,"uk","money","https://uk.wikisource.org/wiki/Добробут_націй"],
 ["uk-capital","Капітал","Карл Маркс",1883,1867,"uk","money","https://uk.wikisource.org/wiki/Капітал"],
 ["uk-psychology","Психологія","Іван Сікорський",1919,1908,"uk","psychology","https://uk.wikisource.org/wiki/Психологія"],
 // Classic, pre-1955 works useful for rhetoric, reasoning, leadership and marketing history.
 ["en-rhetoric-aristotle","Rhetoric","Aristotle",-322,-330,"en","rhetoric","https://en.wikisource.org/wiki/Rhetoric_(Aristotle)"],
 ["en-de-oratore","De Oratore","Cicero",-43,-55,"en","rhetoric","https://en.wikisource.org/wiki/De_Oratore"],
 ["en-art-of-being-right","The Art of Being Right","Arthur Schopenhauer",1860,1831,"en","critical-thinking","https://en.wikisource.org/wiki/The_Art_of_Being_Right"],
 ["en-elements-style","The Elements of Style","William Strunk Jr.",1946,1918,"en","communication","https://en.wikisource.org/wiki/The_Elements_of_Style"],
 ["en-scientific-advertising","Scientific Advertising","Claude C. Hopkins",1932,1923,"en","marketing","https://en.wikisource.org/wiki/Scientific_Advertising"],
 ["en-principles-psychology-vol1","The Principles of Psychology, Vol. I","William James",1910,1890,"en","psychology","https://en.wikisource.org/wiki/The_Principles_of_Psychology"],
 ["ru-rhetoric-aristotle","Риторика","Аристотель",-322,-330,"ru","rhetoric","https://ru.wikisource.org/wiki/Риторика_(Аристотель)"],
 ["ru-art-of-being-right","Эристика, или Искусство побеждать в спорах","Артур Шопенгауэр",1860,1831,"ru","critical-thinking","https://ru.wikisource.org/wiki/Эристика"],
 ["ru-scientific-advertising","Научная реклама","Клод Хопкинс",1932,1923,"ru","marketing","https://ru.wikisource.org/wiki/Научная_реклама"],
 ["pl-rhetoric-aristotle","Retoryka","Arystoteles",-322,-330,"pl","rhetoric","https://pl.wikisource.org/wiki/Retoryka"],
 ["pl-de-oratore","O mówcy","Cyceron",-43,-55,"pl","rhetoric","https://pl.wikisource.org/wiki/O_mówcy"],
 ["pl-art-of-being-right","Erystyka, czyli sztuka prowadzenia sporów","Arthur Schopenhauer",1860,1831,"pl","critical-thinking","https://pl.wikisource.org/wiki/Erystyka"],
 ["uk-rhetoric-aristotle","Риторика","Арістотель",-322,-330,"uk","rhetoric","https://uk.wikisource.org/wiki/Риторика"],
 ["uk-de-oratore","Про оратора","Цицерон",-43,-55,"uk","rhetoric","https://uk.wikisource.org/wiki/Про_оратора"],
 ["uk-art-of-being-right","Еристика, або Мистецтво перемагати в суперечках","Артур Шопенгауер",1860,1831,"uk","critical-thinking","https://uk.wikisource.org/wiki/Еристика"]
 ];
 let added=0;
 for(const [id,title,author,death,year,lang,category,source] of works){
  if(2026-death<71)continue;
  const r=await pool.query(`INSERT INTO books(id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url)
   VALUES($1,$2,$3,$4,$5,$6,$7,0,FALSE,NULL,NULL,'pending',FALSE,$8,$9,NULL)
   ON CONFLICT(id) DO NOTHING RETURNING id`,
   [id,title,author,"Full-text candidate. Exact language edition, translation and source licence require verification before publication.",category,lang,year,source,"Pending rights review: author life+70 appears expired; exact edition and transcription not confirmed"]);
  added+=r.rowCount;
 }
 console.log("Knowledge category candidates queued:",added);
}

async function seedHumanBehaviorCandidates(){
 const works=[
  // English edition candidates — all remain hidden until exact edition and commercial rights are checked.
  ["en-crowd-le-bon","The Crowd: A Study of the Popular Mind","Gustave Le Bon",1895,"en","psychology","Historical social psychology; read critically and compare with modern research."],
  ["en-psychology-persuasion","Influence: The Psychology of Persuasion","Robert B. Cialdini",1984,"en","psychology","Persuasion research, compliance and ethical influence; edition rights review required."],
  ["en-games-people-play","Games People Play","Eric Berne",1964,"en","relationships","Transactional analysis and recurring interpersonal patterns; not a diagnostic tool."],
  ["en-presentation-self","The Presentation of Self in Everyday Life","Erving Goffman",1956,"en","communication","Sociological analysis of social roles and impression management."],
  ["en-attached","Attached","Amir Levine and Rachel Heller",2010,"en","relationships","Popular introduction to adult attachment; compare claims with current evidence."],
  ["en-emotional-intelligence","Emotional Intelligence","Daniel Goleman",1995,"en","psychology","Emotional awareness and regulation; popular synthesis, not a clinical manual."],
  ["en-gaslight-effect","The Gaslight Effect","Robin Stern",2007,"en","relationships","Recognising manipulative relationship patterns and rebuilding self-trust."],
  ["en-difficult-conversations","Difficult Conversations","Douglas Stone, Bruce Patton and Sheila Heen",1999,"en","communication","Practical framework for conflict, listening and hard conversations."],
  ["en-48-laws-power","The 48 Laws of Power","Robert Greene",1998,"en","leadership","A critical study of power strategies; analyse ethically rather than imitate coercion."],
  ["en-laws-human-nature","The Laws of Human Nature","Robert Greene",2018,"en","psychology","Popular interpretations of motives and social behaviour; claims require critical reading."],
  ["en-surrounded-idiots","Surrounded by Idiots","Thomas Erikson",2014,"en","relationships","Popular communication typology; colour categories are not validated personality diagnoses."],
  ["en-body-language","What Every BODY Is Saying","Joe Navarro",2008,"en","psychology","Nonverbal behaviour and observation; gestures do not reliably reveal a person's thoughts or deception."],
  // Russian
  ["ru-crowd-le-bon","Психология народов и масс","Гюстав Лебон",1895,"ru","psychology","Историческая социальная психология; сопоставлять с современными исследованиями."],
  ["ru-influence-cialdini","Психология влияния","Роберт Чалдини",1984,"ru","psychology","Принципы убеждения, согласия и этичного влияния."],
  ["ru-games-people-play","Игры, в которые играют люди","Эрик Берн",1964,"ru","relationships","Транзактный анализ и повторяющиеся сценарии общения; не диагностический инструмент."],
  ["ru-presentation-self","Представление себя другим в повседневной жизни","Эрвинг Гоффман",1956,"ru","communication","Социальные роли и управление впечатлением."],
  ["ru-attached","Подходим друг другу","Амир Левин и Рэйчел Хеллер",2010,"ru","relationships","Популярное введение в теорию привязанности; проверять научные утверждения."],
  ["ru-emotional-intelligence","Эмоциональный интеллект","Дэниел Гоулман",1995,"ru","psychology","Эмоциональная осознанность и саморегуляция."],
  ["ru-gaslight-effect","Эффект газлайтинга","Робин Стерн",2007,"ru","relationships","Распознавание психологического давления и восстановление доверия к себе."],
  ["ru-difficult-conversations","Трудные разговоры","Дуглас Стоун, Брюс Паттон и Шейла Хин",1999,"ru","communication","Практика сложных разговоров, слушания и разрешения конфликтов."],
  ["ru-48-laws-power","48 законов власти","Роберт Грин",1998,"ru","leadership","Критическое изучение стратегий власти, а не руководство принуждением."],
  ["ru-laws-human-nature","Законы человеческой природы","Роберт Грин",2018,"ru","psychology","Популярные интерпретации мотивов; оценивать критически."],
  ["ru-surrounded-idiots","Кругом одни идиоты","Томас Эриксон",2014,"ru","relationships","Популярная типология общения; цветовые типы не являются научным диагнозом."],
  ["ru-body-language","Я вижу, о чём вы думаете","Джо Наварро",2008,"ru","psychology","Невербальное поведение; отдельный жест не раскрывает мысли и не доказывает ложь."],
  // Polish
  ["pl-crowd-le-bon","Psychologia tłumu","Gustave Le Bon",1895,"pl","psychology","Historyczna psychologia społeczna; czytać krytycznie i porównywać z aktualnymi badaniami."],
  ["pl-influence-cialdini","Wywieranie wpływu na ludzi","Robert B. Cialdini",1984,"pl","psychology","Perswazja, uległość i etyczny wpływ."],
  ["pl-games-people-play","W co grają ludzie","Eric Berne",1964,"pl","relationships","Analiza transakcyjna i wzorce relacji; nie jest narzędziem diagnostycznym."],
  ["pl-presentation-self","Człowiek w teatrze życia codziennego","Erving Goffman",1956,"pl","communication","Role społeczne i zarządzanie wrażeniem."],
  ["pl-attached","Partnerstwo bliskości","Amir Levine i Rachel Heller",2010,"pl","relationships","Popularne wprowadzenie do teorii przywiązania; warto weryfikować twierdzenia."],
  ["pl-emotional-intelligence","Inteligencja emocjonalna","Daniel Goleman",1995,"pl","psychology","Świadomość emocji i samoregulacja."],
  ["pl-gaslight-effect","Efekt Gaslight","Robin Stern",2007,"pl","relationships","Rozpoznawanie manipulacji i odbudowa zaufania do siebie."],
  ["pl-difficult-conversations","Trudne rozmowy","Douglas Stone, Bruce Patton i Sheila Heen",1999,"pl","communication","Praktyczne podejście do konfliktów i trudnych rozmów."],
  ["pl-48-laws-power","48 praw władzy","Robert Greene",1998,"pl","leadership","Krytyczna analiza strategii władzy, nie instrukcja przymusu."],
  ["pl-laws-human-nature","Prawa ludzkiej natury","Robert Greene",2018,"pl","psychology","Popularne interpretacje motywów; wymagają krytycznej oceny."],
  ["pl-surrounded-idiots","Otoczeni przez idiotów","Thomas Erikson",2014,"pl","relationships","Popularna typologia komunikacji; kolory nie są diagnozą osobowości."],
  ["pl-body-language","Mowa ciała","Joe Navarro",2008,"pl","psychology","Zachowania niewerbalne; pojedynczy gest nie ujawnia myśli ani kłamstwa."],
  // Ukrainian
  ["uk-crowd-le-bon","Психологія народів і мас","Гюстав Лебон",1895,"uk","psychology","Історична соціальна психологія; критично зіставляти із сучасними дослідженнями."],
  ["uk-influence-cialdini","Психологія впливу","Роберт Чалдіні",1984,"uk","psychology","Переконання, згода та етичний вплив."],
  ["uk-games-people-play","Ігри, у які грають люди","Ерік Берн",1964,"uk","relationships","Транзакційний аналіз і сценарії взаємодії; не діагностичний інструмент."],
  ["uk-presentation-self","Презентація себе іншим у повсякденному житті","Ервінг Гофман",1956,"uk","communication","Соціальні ролі та керування враженням."],
  ["uk-attached","Attached: теорія прив’язаності у стосунках","Амір Левін і Рейчел Геллер",2010,"uk","relationships","Популярний вступ до теорії прив’язаності; твердження варто перевіряти."],
  ["uk-emotional-intelligence","Емоційний інтелект","Деніел Ґоулман",1995,"uk","psychology","Емоційна усвідомленість і саморегуляція."],
  ["uk-gaslight-effect","Ефект газлайтингу","Робін Стерн",2007,"uk","relationships","Розпізнавання психологічного тиску та відновлення довіри до себе."],
  ["uk-difficult-conversations","Складні розмови","Дуглас Стоун, Брюс Паттон і Шейла Гін",1999,"uk","communication","Практичні підходи до конфліктів і складних розмов."],
  ["uk-48-laws-power","48 законів влади","Роберт Ґрін",1998,"uk","leadership","Критичний аналіз стратегій влади, а не інструкція з примусу."],
  ["uk-laws-human-nature","Закони людської природи","Роберт Ґрін",2018,"uk","psychology","Популярні інтерпретації мотивів; потрібне критичне читання."],
  ["uk-surrounded-idiots","У колі одні ідіоти","Томас Еріксон",2014,"uk","relationships","Популярна типологія комунікації; кольорові типи не є діагнозом."],
  ["uk-body-language","Мова тіла","Джо Наварро",2008,"uk","psychology","Невербальна поведінка; один жест не розкриває думок і не доводить брехню."]
 ];
 let added=0;
 for(const [id,title,author,year,lang,category,description] of works){
  const r=await pool.query(`INSERT INTO books
   (id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url)
   VALUES($1,$2,$3,$4,$5,$6,$7,0,TRUE,$8,NULL,'pending',FALSE,NULL,$9,NULL)
   ON CONFLICT(id) DO NOTHING RETURNING id`,
   [id,title,author,description,category,lang,year,"https://raw.githubusercontent.com/wlodek2106-cyber/zer0life-book-club-/main/covers/human-behavior/"+id+".svg","Metadata candidate only. Full-text, translation and commercial redistribution rights not yet verified."]);
  added+=r.rowCount;
 }
 console.log("Human behaviour and relationship titles queued for rights review:",added);
}

async function seedNextClassicsForRightsReview(){
 const works=[
  {id:'en-moby-dick',title:'Moby-Dick; or, The Whale',author:'Herman Melville',death:1891,year:1851,lang:'en'},
  {id:'en-great-expectations',title:'Great Expectations',author:'Charles Dickens',death:1870,year:1861,lang:'en'},
  {id:'en-dracula',title:'Dracula',author:'Bram Stoker',death:1912,year:1897,lang:'en'},
  {id:'ru-oblomov',title:'Обломов',author:'Иван Гончаров',death:1891,year:1859,lang:'ru'},
  {id:'ru-fathers-and-sons-extra',title:'Записки охотника',author:'Иван Тургенев',death:1883,year:1852,lang:'ru'},
  {id:'ru-quiet-don-excluded',title:'Капитанская дочка',author:'Александр Пушкин',death:1837,year:1836,lang:'ru'},
  {id:'pl-quovadis-extra',title:'Trylogia: Ogniem i mieczem',author:'Henryk Sienkiewicz',death:1916,year:1884,lang:'pl'},
  {id:'pl-emancypantki',title:'Emancypantki',author:'Bolesław Prus',death:1912,year:1894,lang:'pl'},
  {id:'pl-chlopi',title:'Chłopi',author:'Władysław Reymont',death:1925,year:1904,lang:'pl'},
  {id:'uk-mykola-dzherya',title:'Микола Джеря',author:'Іван Нечуй-Левицький',death:1918,year:1878,lang:'uk'},
  {id:'uk-boryslav',title:'Борислав сміється',author:'Іван Франко',death:1916,year:1882,lang:'uk'},
  {id:'uk-kobzar',title:'Кобзар',author:'Тарас Шевченко',death:1861,year:1840,lang:'uk'}
 ];
 for(const w of works){
  if(2026-w.death<71)continue;
  await pool.query(`INSERT INTO books(id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url)
   VALUES($1,$2,$3,'Full-length classic candidate. Exact source edition, transcription and commercial distribution rights require verification.','personal',$4,$5,0,FALSE,NULL,NULL,'pending',FALSE,$6,'Author death term appears expired; edition and source rights remain unverified',NULL)
   ON CONFLICT(id) DO NOTHING`,[w.id,w.title,w.author,w.lang,w.year,'https://www.google.com/search?q='+encodeURIComponent(w.title+' full text Wikisource')]);
 }
 console.log('Additional classics queued for rights review:',works.length);
}

const { inflateRawSync } = require("node:zlib");
function unzipEpubEntries(buffer){
 const files=new Map();let eocd=-1;
 for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65558);i--){if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break;}}
 if(eocd<0)throw new Error("EPUB ZIP directory missing");
 const count=buffer.readUInt16LE(eocd+10);let pos=buffer.readUInt32LE(eocd+16);
 for(let n=0;n<count;n++){
  if(buffer.readUInt32LE(pos)!==0x02014b50)throw new Error("Invalid EPUB ZIP entry");
  const method=buffer.readUInt16LE(pos+10),compressed=buffer.readUInt32LE(pos+20),nameLen=buffer.readUInt16LE(pos+28),extraLen=buffer.readUInt16LE(pos+30),commentLen=buffer.readUInt16LE(pos+32),local=buffer.readUInt32LE(pos+42);
  const name=buffer.toString("utf8",pos+46,pos+46+nameLen);
  const localName=buffer.readUInt16LE(local+26),localExtra=buffer.readUInt16LE(local+28),dataStart=local+30+localName+localExtra;
  const raw=buffer.subarray(dataStart,dataStart+compressed);
  if(method===0)files.set(name,Buffer.from(raw));else if(method===8)files.set(name,inflateRawSync(raw));else throw new Error("Unsupported EPUB compression");
  pos+=46+nameLen+extraLen+commentLen;
 }
 return files;
}
function decodeBookHtml(html){
 return html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ")
  .replace(/<br\s*\/?\s*>/gi,"\n").replace(/<\/(p|div|h[1-6]|li|section|blockquote|tr)>/gi,"\n\n")
  .replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">")
  .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/[ \t]+/g," ").replace(/ *\n */g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
function extractEpubText(buffer){
 const files=unzipEpubEntries(buffer);
 const container=files.get("META-INF/container.xml")?.toString("utf8");
 if(!container)throw new Error("EPUB container metadata missing");
 const opfPath=container.match(/full-path=["']([^"']+)["']/i)?.[1];
 const opf=files.get(opfPath)?.toString("utf8");
 if(!opf)throw new Error("EPUB package metadata missing");
 const base=opfPath.includes("/")?opfPath.slice(0,opfPath.lastIndexOf("/")+1):"";
 const manifest=new Map();
 for(const m of opf.matchAll(/<item\b([^>]+)>/gi)){
  const id=m[1].match(/id=["']([^"']+)["']/i)?.[1];
  const href=m[1].match(/href=["']([^"']+)["']/i)?.[1];
  const media=m[1].match(/media-type=["']([^"']+)["']/i)?.[1];
  if(id&&href&&(/xhtml|html/i.test(media||""))){
   const cleanHref=href.startsWith("./")?href.slice(2):href;
   manifest.set(id,base+cleanHref);
  }
 }
 const spineMatch=opf.match(/<spine\b[^>]*>([\s\S]*?)<\/spine>/i);
 const spine=spineMatch?spineMatch[1]:"";
 const ids=[...spine.matchAll(/<itemref\b[^>]*idref=["']([^"']+)["']/gi)].map(x=>x[1]);
 const parts=[];
 for(const id of ids){
  const path=manifest.get(id);const file=path?files.get(path):null;
  if(file){const t=decodeBookHtml(file.toString("utf8"));if(t.length>100)parts.push(t);}
 }
 const text=parts.join("\n\n");
 if(text.length<15000)throw new Error("EPUB text too short; not importing incomplete book");
 return text;
}
async function importStandardEbooks(){
 // Project Gutenberg explicitly restricts non-free for-profit use and redistribution.
 // Therefore its full texts are NOT copied into this subscription library.
 // Keep canonical links available for users to read at the source; only import
 // texts from separately verified CC0/CC-BY/CC-BY-SA or licensed sources.
 const works=[
  {id:"pg-1342",title:"Pride and Prejudice",author:"Jane Austen",category:"relationships"},
  {id:"pg-84",title:"Frankenstein; or, The Modern Prometheus",author:"Mary Shelley",category:"psychology"},
  {id:"pg-1661",title:"The Adventures of Sherlock Holmes",author:"Arthur Conan Doyle",category:"personal"},
  {id:"pg-6435",title:"The Principles of Scientific Management",author:"Frederick Winslow Taylor",category:"business"},
  {id:"pg-8581",title:"The Art of Money Getting",author:"P. T. Barnum",category:"money"},
  {id:"pg-59844",title:"The Science of Getting Rich",author:"Wallace D. Wattles",category:"money"},
  {id:"pg-42055",title:"Your Mind and How to Use It",author:"William Walker Atkinson",category:"psychology"}
 ];
 const result=[];
 for(const w of works){
  const n=w.id.replace("pg-","");
  const pageUrl="https://www.gutenberg.org/ebooks/"+n;
  try{
   const r=await pool.query(`INSERT INTO books(id,title,author,description,category,language,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url)
    VALUES($1,$2,$3,$4,$5,'en',0,FALSE,NULL,NULL,'pending',FALSE,$6,$7,$8)
    ON CONFLICT(id) DO UPDATE SET source_url=EXCLUDED.source_url,source_license=EXCLUDED.source_license,rights_evidence_url=EXCLUDED.rights_evidence_url
    WHERE books.rights_status='pending' RETURNING id`,
    [w.id,w.title,w.author,"External reading link only. Project Gutenberg terms do not permit non-free for-profit redistribution; no full text is copied or sold through Zer0Life Book Club.",w.category,pageUrl,"External source only; not licensed for this paid redistribution workflow","https://www.gutenberg.org/policy/terms_of_use.html"]);
   result.push({id:w.id,title:w.title,status:"external_link_only",source:pageUrl});
  }catch(e){console.error("Gutenberg link metadata skipped:",w.title,e.message);result.push({id:w.id,status:"skipped",reason:e.message});}
 }
 console.log("Project Gutenberg kept as external links only:",JSON.stringify(result));return result;
}
async function importCuratedWikisourceBooks(){
 // The previous Eneyida record exposed glossary fragments rather than the poem.
 // Hide and clear it before rebuilding from the three actual poem parts.
 await pool.query("UPDATE books SET is_published=FALSE WHERE id='uk-eneida-1798'");
 await pool.query("DELETE FROM book_pages WHERE book_id='uk-eneida-1798'");
 const works=[
  {id:"ru-o-smysle-voyny",title:"О смысле войны",author:"Лев Александрович Тихомиров",death:1923,year:1905,lang:"ru",host:"ru.wikisource.org",page:"О смысле войны (Тихомиров)",proof:/общественное достояние/i,category:"psychology",cover:"https://raw.githubusercontent.com/wlodek2106-cyber/zer0life-book-club-/main/covers/o-smysle-voiny.svg"},
  {id:"en-art-of-money-getting",title:"The Art of Money Getting",author:"P. T. Barnum",death:1891,year:1880,lang:"en",host:"en.wikisource.org",page:"The Art of Money Getting",proof:/public domain/i,category:"money",cover:"https://raw.githubusercontent.com/wlodek2106-cyber/zer0life-book-club-/main/covers/art-of-money-getting.svg"},
  {id:"ru-crime-and-punishment",title:"Преступление и наказание",author:"Фёдор Михайлович Достоевский",death:1881,year:1866,lang:"ru",host:"ru.wikisource.org",page:"Преступление и наказание (Достоевский)",proof:/общественное достояние/i,category:"psychology",cover:"https://raw.githubusercontent.com/wlodek2106-cyber/zer0life-book-club-/main/covers/crime-and-punishment-ru.svg"},
  {id:"pl-pan-tadeusz-1834",title:"Pan Tadeusz (wyd. 1834)",author:"Adam Mickiewicz",death:1855,year:1834,lang:"pl",host:"pl.wikisource.org",page:"Pan Tadeusz (wyd. 1834)",proof:/public domain/i,category:"personal",cover:"https://raw.githubusercontent.com/wlodek2106-cyber/zer0life-book-club-/main/covers/pan-tadeusz-pl.svg"},
  {id:"uk-eneida-1798",title:"Енеїда",author:"Іван Котляревський",death:1838,year:1798,lang:"uk",host:"uk.wikisource.org",page:"Енеїда (1798)",chapterPages:["Енеїда (1798)/I","Енеїда (1798)/II","Енеїда (1798)/III"],proof:/суспільному надбанні в усьому світі/i,category:"personal",cover:"https://raw.githubusercontent.com/wlodek2106-cyber/zer0life-book-club-/main/covers/eneida.svg"}
 ];
 const results=[];
 let lastWikisourceRequestAt=0;
 for(const w of works){
  try{
   if(2026-w.death<71)throw new Error("Author's life+70 term has not expired for Poland");
   const source="https://"+w.host+"/wiki/"+encodeURIComponent(w.page.replace(/ /g,"_"));
   const apiBase="https://"+w.host+"/w/api.php?action=parse&prop=text%7Clinks&format=json&formatversion=2&page=";
   const fetchPage=async title=>{
    const url=apiBase+encodeURIComponent(title);
    let lastError;
    for(let attempt=0;attempt<5;attempt++){
     try{
      if(attempt>0)await new Promise(resolve=>setTimeout(resolve,5000*Math.pow(2,attempt-1)));
      const waitMs=Math.max(0,1200-(Date.now()-lastWikisourceRequestAt));
      if(waitMs)await new Promise(resolve=>setTimeout(resolve,waitMs));
      lastWikisourceRequestAt=Date.now();
      const response=await fetch(url,{headers:{"User-Agent":"Zer0LifeBookClub/1.0 (public-domain text import)"}});
      if(response.status===429||response.status>=500){
       const retryAfter=Number(response.headers.get("retry-after"));
       const retryDelay=Number.isFinite(retryAfter)&&retryAfter>0?Math.min(retryAfter,120):0;
       lastError=new Error("Wikisource API HTTP "+response.status+" for "+title);
       if(attempt<4){if(retryDelay)await new Promise(resolve=>setTimeout(resolve,retryDelay*1000));continue;}
       throw lastError;
      }
      if(!response.ok)throw new Error("Wikisource API HTTP "+response.status+" for "+title);
      const data=await response.json();
      if(data.error)throw new Error(data.error.info||"Wikisource page unavailable");
      return data.parse||{};
     }catch(error){
      lastError=error;
      if(attempt===4||!/429|5\\d\\d|fetch failed|network/i.test(error.message))throw error;
     }
    }
    throw lastError||new Error("Wikisource page request failed: "+title);
   };
   const root=await fetchPage(w.page);
   const rootHtml=String(root.text||"");
   if(!rootHtml||!w.proof.test(rootHtml))throw new Error("Exact work page lacks the expected public-domain notice");
   // Wikisource often stores a book as an index linking to separate chapters.
   // Crawl only descendants of the exact work page; never publish the short index itself.
   const queue=Array.isArray(w.chapterPages)?w.chapterPages.slice():(root.links||[]).map(x=>x.title).filter(t=>t&&t.startsWith(w.page+"/")&&!/(словник|значен|dictionary|glossary)/i.test(t));
   const seen=new Set(),parts=[];
   while(queue.length&&seen.size<160){
    const title=queue.shift();
    if(/(словник|значен|dictionary|glossary)/i.test(title))continue;
    if(seen.has(title))continue;
    seen.add(title);
    const page=await fetchPage(title);
    const html=String(page.text||"");
    const childLinks=(page.links||[]).map(x=>x.title).filter(t=>t&&t.startsWith(w.page+"/")&&!seen.has(t)&&!/(словник|значен|dictionary|glossary)/i.test(t));
    if(childLinks.length)queue.push(...childLinks);
    const text=decodeBookHtml(html);
    // Leaf chapter pages carry prose; navigation and index pages are not imported.
    if(!childLinks.length&&text.length>500)parts.push({title,text});
   }
   if(Array.isArray(w.chapterPages)&&parts.length!==w.chapterPages.length)throw new Error("Expected all original poem parts; received "+parts.length);
    if(!parts.length)throw new Error("No full chapter pages found under the book index");
   parts.sort((a,b)=>a.title.localeCompare(b.title,"ru"));
   const body=parts.map(p=>p.text).join("\n\n");
   if(body.length<12000)throw new Error("Collected chapter text is too short ("+body.length+" chars); refusing partial publication");
   const chunks=[];let rest=body;
   while(rest.length){let cut=Math.min(2800,rest.length);if(cut<rest.length){const p=rest.lastIndexOf(" ",cut);if(p>cut*.65)cut=p;}chunks.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();}
   if(chunks.length<5)throw new Error("Insufficient full-text pages after chapter collection");
   const evidence="Wikisource exact work page marks this work public domain; author died in "+w.death+" and Poland applies life+70. Chapter pages collected from: "+source;
   await pool.query(`INSERT INTO books(id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url)
    VALUES($1,$2,$3,$4,$5,$6,$7,0,FALSE,$8,$9,'public_domain',FALSE,$9,$10,$9)
    ON CONFLICT(id) DO UPDATE SET content_url=EXCLUDED.content_url,cover_url=COALESCE(EXCLUDED.cover_url,books.cover_url),source_url=EXCLUDED.source_url,source_license=EXCLUDED.source_license,rights_evidence_url=EXCLUDED.rights_evidence_url
    WHERE books.rights_status IN ('pending','public_domain')`,
    [w.id,w.title,w.author,"Complete chapter-by-chapter text from Wikisource. Public-domain notice checked on exact work page. Source attribution retained: "+source,w.category,w.lang,w.year,w.cover,source,"Public domain; exact page notice verified; author life+70 term expired in Poland"]);
   const client=await pool.connect();
   try{
    await client.query("BEGIN");
    const current=await client.query("SELECT rights_status FROM books WHERE id=$1 FOR UPDATE",[w.id]);
    if(!current.rows[0]||current.rows[0].rights_status!=="public_domain")throw new Error("Rights approval not present");
    await client.query("DELETE FROM book_pages WHERE book_id=$1",[w.id]);
    for(let i=0;i<chunks.length;i++)await client.query("INSERT INTO book_pages(book_id,page_number,page_text) VALUES($1,$2,$3)",[w.id,i+1,chunks[i]]);
    await client.query("UPDATE books SET is_published=TRUE,full_text_source_url=$2 WHERE id=$1",[w.id,source]);
    await client.query("COMMIT");
   }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
   results.push({id:w.id,title:w.title,language:w.lang,status:"published",pages:chunks.length,chapters:parts.length,characters:body.length,source});
  }catch(e){console.error("Wikisource import skipped:",w.id,e.message);results.push({id:w.id,title:w.title,language:w.lang,status:"skipped",reason:e.message});}
 }
 console.log("Curated Wikisource chapter import:",JSON.stringify(results));
 return results;
}

async function importCatalogMetadata() {
 // Import metadata only. Nothing is published until distribution rights are reviewed.
 const targets = [{code:"en",limit:50},{code:"ru",limit:50},{code:"pl",limit:50},{code:"uk",limit:50}];
 let inserted = 0;
 if (process.env.GUTENDEX_ENABLED === "true") for (const target of targets) {
  try {
   let url = `https://gutendex.com/books?languages=${target.code}&copyright=false&mime_type=text%2F&sort=popular`;
   let collected = [];
   while (url && collected.length < target.limit) {
    const response = await fetch(url, {headers:{"User-Agent":"Zer0LifeBookClub/1.0 (catalog metadata import)"}});
    if (!response.ok) throw new Error(`Gutendex HTTP ${response.status}`);
    const data = await response.json();
    collected.push(...(data.results || []));
    url = data.next;
   }
   for (const b of collected.slice(0,target.limit)) {
    const author = (b.authors || []).map(a=>a.name).join(", ") || "Unknown";
    const textUrl = b.formats?.["text/plain; charset=utf-8"] || b.formats?.["text/plain"] || null;
    const cover = b.formats?.["image/jpeg"] || null;
    const result = await pool.query(`INSERT INTO books
     (id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url)
     VALUES($1,$2,$3,$4,$5,$6,NULL,0,FALSE,$7,$8,'pending',FALSE,$9)
     ON CONFLICT(id) DO NOTHING RETURNING id`,
     [`pg-${b.id}`,b.title,author,(b.subjects||[]).slice(0,5).join("; "), "personal",target.code,cover,textUrl,`https://www.gutenberg.org/ebooks/${b.id}`]);
    inserted += result.rowCount;
   }
  } catch(e) { console.error(`Catalog metadata import failed for ${target.code}:`,e.message); }
 }
 // Open Library is used for limited bibliographic discovery only, not as a bulk text backend.
 // Its API documents language filters inside q (e.g. language:fre), and work keys are OL…W identifiers.
 for (const target of [{code:"en",ol:"eng"},{code:"ru",ol:"rus"},{code:"pl",ol:"pol"},{code:"uk",ol:"ukr"}]) {
  try {
   const fields="key,title,author_name,first_publish_year,cover_i,language,has_fulltext,edition_count";
   const queries=["language:"+target.ol];
   if(target.code==="en") queries.push("language:eng");
   let data=null,lastError=null;
   for(const query of queries){
    const url="https://openlibrary.org/search.json?q="+encodeURIComponent(query)+"&lang="+target.code+"&limit=25&fields="+encodeURIComponent(fields);
    for(let attempt=1;attempt<=3;attempt++){
     try{
      const response=await fetch(url,{headers:{"User-Agent":"Zer0LifeBookClub/1.0 (contact: support@zer0lifelabs.com)"}});
      if(!response.ok) throw new Error("Open Library HTTP "+response.status);
      data=await response.json();break;
     }catch(e){lastError=e;if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1200));}
    }
    if(data)break;
   }
   if(!data)throw lastError||new Error("Open Library search unavailable");
   let n=0;
   for(const item of (data.docs||[])){
    const title=String(item.title||"").trim();
    let key=String(item.key||"").trim();
    if(!title) continue;
    if(key.startsWith("/works/")) key=key.split("/").pop();
    if(!/^OL[0-9]+W$/.test(key)) continue;
    const author=(item.author_name||[]).join(", ")||"Unknown";
    const cover=item.cover_i?"https://covers.openlibrary.org/b/id/"+item.cover_i+"-L.jpg":null;
    const source="https://openlibrary.org/works/"+key;
    const result=await pool.query(`INSERT INTO books
     (id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url)
     VALUES($1,$2,$3,$4,'personal',$5,$6,0,FALSE,$7,NULL,'pending',FALSE,$8)
     ON CONFLICT(id) DO NOTHING RETURNING id`,
     ["ol-"+key,title,author,"Open Library discovery record; full text and commercial distribution rights not verified",target.code,item.first_publish_year||null,cover,source]);
    inserted+=result.rowCount;n++;
   }
   console.log("Open Library metadata import "+target.code+":",n,"records inspected; API matches:",data.numFound||0);
  }catch(e){console.error("Open Library discovery failed for "+target.code+":",e.message);}
 }
 // Ukrainian Wikisource metadata discovery; all records stay unpublished until rights review.
 try {
  const apiUrl="https://uk.wikisource.org/w/api.php?action=query&list=categorymembers&cmtitle="+encodeURIComponent("Категорія:Українська література")+"&cmnamespace=0&cmlimit=100&format=json&origin=*";
  const response=await fetch(apiUrl,{headers:{"User-Agent":"Zer0LifeBookClub/1.0 (metadata discovery)"}});
  if(!response.ok) throw new Error(`Wikisource HTTP ${response.status}`);
  const data=await response.json();
  let n=0;
  for(const item of (data.query?.categorymembers||[])) {
   if(n>=50) break;
   const title=String(item.title||"").trim();
   const pageId=Number(item.pageid||0);
   if(!title||!pageId) continue;
   const result=await pool.query(`INSERT INTO books
    (id,title,author,description,category,language,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url)
    VALUES($1,$2,'Автор не указан','Метаданные из Украинской Викитеки; права на распространение не проверены','personal','uk',0,FALSE,NULL,$3,'pending',FALSE,$3)
    ON CONFLICT(id) DO NOTHING RETURNING id`,
    [`uk-ws-${pageId}`,title,`https://uk.wikisource.org/wiki/${encodeURIComponent(title.replace(/ /g,"_"))}`]);
   inserted+=result.rowCount; n++;
  }
  console.log("Ukrainian Wikisource metadata:",n,"records inspected");
 } catch(e) { console.error("Ukrainian Wikisource import failed:",e.message); }
 // Polish open-library metadata fallback. Wolne Lektury terms and each work's licence
 // must be reviewed before any item can be published or placed behind a paywall.
 try {
  const response=await fetch("https://wolnelektury.pl/api/books/");
  if(response.ok) {
   const items=await response.json();
   let n=0;
   for(const b of items) {
    if(n>=50) break;
    const title=String(b.title||"").trim();
    const href=String(b.href||"").trim();
    if(!title||!href) continue;
    const slug=href.split("/").filter(Boolean).pop();
    const result=await pool.query(`INSERT INTO books
     (id,title,author,description,category,language,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url)
     VALUES($1,$2,$3,$4,'personal','pl',0,FALSE,$5,$6,'pending',FALSE,$6)
     ON CONFLICT(id) DO NOTHING RETURNING id`,
     [`wl-${slug}`,title,String(b.author||"Unknown"),String(b.genre||""),b.cover||null,`https://wolnelektury.pl${href}`]);
    inserted+=result.rowCount; n++;
   }
  }
 } catch(e) { console.error("Wolne Lektury metadata import failed:",e.message); }
 const counts=await pool.query("SELECT language, COUNT(*)::int AS total FROM books GROUP BY language ORDER BY language");
 console.log("Catalog totals by language:",JSON.stringify(counts.rows));
 console.log("Catalog metadata import finished; inserted:",inserted,"(all entries pending rights review)");
}

async function ensureUser(u) {
 if(!pool) throw new Error("DATABASE_URL is not configured");
 await pool.query(`INSERT INTO users(telegram_id,username,first_name,language_code) VALUES($1,$2,$3,$4)
 ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,language_code=EXCLUDED.language_code,updated_at=NOW()`,
 [u.id,u.username||null,u.first_name||"",u.language_code||"en"]);
}
async function catalog(req,res) {
 const q=String(req.query.q||"").toLowerCase(), cat=String(req.query.category||"all"), lang=String(req.query.lang||"all");
 if(pool) {
  const r=await pool.query(`SELECT id,title,author,description,category,language AS lang,year,price_stars AS "priceStars",vip_only AS vip,cover_url AS cover
   FROM books WHERE is_published=true AND rights_status IN ('licensed','public_domain','original')
   AND ($1='all' OR category=$1) AND ($2='all' OR language=$2)
   AND EXISTS (SELECT 1 FROM book_pages bp WHERE bp.book_id=books.id)\n   AND ($3='' OR LOWER(title||' '||author||' '||description) LIKE '%'||$3||'%') ORDER BY created_at DESC`,[cat,lang,q]);
  return res.json({categories,books:r.rows});
 }
 const rows=sampleBooks.filter(b=>(cat==="all"||b.category===cat)&&(lang==="all"||b.lang===lang)&&(!q||`${b.title} ${b.author} ${b.description}`.toLowerCase().includes(q)));
 res.json({categories,books:rows});
}

// Reader access policy: first five pages are free. Standard unlocks general-library books;
// Premium unlocks every tier. Admins bypass all membership checks.
async function getReaderAccess(telegramId, book) {
 if (ADMINS.has(String(telegramId))) return { isAdmin:true, plan:"admin", fullAccess:true, previewPages:5 };
 const r=await pool.query("SELECT plan,status,expires_at FROM memberships WHERE telegram_id=$1",[telegramId]);
 const m=r.rows[0]||{plan:"free",status:"inactive",expires_at:null};
 const active=m.status==="active" && (!m.expires_at || new Date(m.expires_at)>new Date());
 const plan=active?m.plan:"free";
 const premiumBook=PREMIUM_CATEGORIES.has(book.category) || !!book.vip_only;
 const fullAccess=plan==="premium" || (plan==="standard" && !premiumBook);
 return {isAdmin:false,plan,fullAccess,previewPages:5};
}
app.get("/api/books/:bookId/pages",auth,async(req,res)=>{
 try {
  await ensureUser(req.user);
  const b=await pool.query("SELECT id,category,vip_only FROM books WHERE id=$1 AND is_published=true AND rights_status IN ('licensed','public_domain','original')",[req.params.bookId]);
  if(!b.rows[0]) return res.status(404).json({error:"Book not found or distribution rights not verified"});
  const access=await getReaderAccess(req.user.id,b.rows[0]);
  const pageLimit=access.fullAccess?2147483647:5; // PostgreSQL INTEGER is signed 32-bit; MAX_SAFE_INTEGER overflows it.
  const pages=await pool.query("SELECT page_number,page_text FROM book_pages WHERE book_id=$1 AND page_number<=$2 ORDER BY page_number",[req.params.bookId,pageLimit]);
  res.json({bookId:req.params.bookId,access,previewOnly:!access.fullAccess,pages:pages.rows});
 } catch(e){res.status(500).json({error:e.message});}
});

app.get("/api/health",async(_req,res)=>{
 try{if(pool)await pool.query("SELECT 1");res.json({ok:true,app:"Zer0Life Book Club",database:!!pool,databaseConnected:!!pool});}
 catch(e){res.status(503).json({ok:false,app:"Zer0Life Book Club",database:false,error:"Database connection failed"});}
});
app.get("/api/catalog",catalog);
app.get("/api/me",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const [m,f,p]=await Promise.all([
   pool.query("SELECT status,plan,expires_at FROM memberships WHERE telegram_id=$1",[req.user.id]),
   pool.query("SELECT book_id FROM favorites WHERE telegram_id=$1",[req.user.id]),
   pool.query("SELECT book_id FROM purchases WHERE telegram_id=$1",[req.user.id])
  ]);
  const progress=await pool.query("SELECT book_id,current_page,total_pages,status,updated_at,completed_at FROM reading_progress WHERE telegram_id=$1 ORDER BY updated_at DESC",[req.user.id]);
  res.json({user:req.user,isAdmin:ADMINS.has(String(req.user.id)),membership:(()=>{const x=m.rows[0]||{status:"inactive",plan:"free",expires_at:null};if(x.status!=="active"||(x.expires_at&&new Date(x.expires_at)<=new Date()))return {...x,status:"inactive",plan:"free"};return x;})(),favorites:f.rows.map(x=>x.book_id),ownedBooks:p.rows.map(x=>x.book_id),reading:progress.rows});
 }catch(e){res.status(503).json({error:e.message});}
});
app.post("/api/favorites/:bookId",auth,async(req,res)=>{
 try{await ensureUser(req.user);await pool.query("INSERT INTO favorites(telegram_id,book_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.user.id,req.params.bookId]);res.json({ok:true});}
 catch(e){res.status(500).json({error:e.message});}
});
app.get("/api/academy/progress",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const r=await pool.query("SELECT month_number,completed,completed_at,updated_at FROM academy_progress WHERE telegram_id=$1 ORDER BY month_number",[req.user.id]);
  res.json({progress:r.rows});
 }catch(e){res.status(503).json({error:e.message});}
});
app.post("/api/academy/progress/:month",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const month=Number(req.params.month);
  if(!Number.isInteger(month)||month<1||month>12)return res.status(400).json({error:"Month must be between 1 and 12."});
  const completed=req.body.completed===true;
  const r=await pool.query(`INSERT INTO academy_progress(telegram_id,month_number,completed,completed_at,updated_at)
   VALUES($1,$2,$3,CASE WHEN $3 THEN NOW() ELSE NULL END,NOW())
   ON CONFLICT(telegram_id,month_number) DO UPDATE SET completed=EXCLUDED.completed,completed_at=CASE WHEN EXCLUDED.completed THEN COALESCE(academy_progress.completed_at,NOW()) ELSE NULL END,updated_at=NOW()
   RETURNING month_number,completed,completed_at,updated_at`,[req.user.id,month,completed]);
  res.json({ok:true,progress:r.rows[0]});
 }catch(e){res.status(500).json({error:e.message});}
});

const DAILY_GROWTH_CHALLENGES = [
 {id:"observe",category:"Awareness",title:"Факт или интерпретация?",minutes:5,xp:20,task:"Запиши один сегодняшний эпизод в двух колонках: что произошло объективно и какую историю ты себе рассказал. Найди ещё одно возможное объяснение.",reflection:"Что изменилось, когда ты отделил факт от предположения?"},
 {id:"read",category:"Learning",title:"10 минут осознанного чтения",minutes:10,xp:20,task:"Прочитай 5–10 страниц выбранной книги. Выпиши одну мысль своими словами и один вопрос, который она у тебя вызвала.",reflection:"Какую одну идею ты попробуешь применить?"},
 {id:"listen",category:"Relationships",title:"Слушай, чтобы понять",minutes:5,xp:20,task:"В разговоре сегодня не перебивай. Кратко перескажи собеседнику его мысль и спроси, правильно ли ты понял.",reflection:"Что ты заметил, когда сначала слушал, а потом отвечал?"},
 {id:"boundary",category:"Self-respect",title:"Одна здоровая граница",minutes:5,xp:20,task:"Определи одну ситуацию, где тебе нужно яснее обозначить свои возможности. Сформулируй уважительную фразу: «Я могу…, но не могу…».",reflection:"Какую границу ты хочешь поддерживать последовательно?"},
 {id:"money",category:"Financial literacy",title:"Проверь один денежный выбор",minutes:7,xp:20,task:"Посмотри на одну недавнюю покупку или расход. Запиши: какую потребность он закрывал, был ли выбор осознанным и что можно улучшить в следующий раз.",reflection:"Какой небольшой финансовый вывод ты сделал?"},
 {id:"focus",category:"Discipline",title:"15 минут одного дела",minutes:15,xp:20,task:"Выбери важную задачу, убери уведомления и поработай над ней 15 минут без переключений. Начни с самого маленького шага.",reflection:"Что помогло тебе удержать внимание?"},
 {id:"gratitude",category:"Well-being",title:"Заметь три опоры",minutes:4,xp:20,task:"Запиши три конкретные вещи, которые сегодня поддержали тебя. Одна из них может быть твоим собственным действием.",reflection:"Что ты обычно принимаешь как должное?"},
 {id:"emotion",category:"Emotional intelligence",title:"Назови эмоцию точнее",minutes:5,xp:20,task:"Остановись и назови эмоцию точнее, чем «нормально» или «плохо». Оцени её интенсивность от 1 до 10 и подумай, какая потребность за ней стоит.",reflection:"Какая потребность могла стоять за этой эмоцией?"},
 {id:"goal",category:"Growth",title:"Один шаг к большой цели",minutes:8,xp:20,task:"Выбери одну долгосрочную цель и запиши действие на 10 минут, которое приблизит тебя к ней сегодня. Сделай его или назначь конкретное время.",reflection:"Какой следующий небольшой шаг станет логичным продолжением?"},
 {id:"kindness",category:"Relationships",title:"Маленький акт доброты",minutes:5,xp:20,task:"Сделай для кого-то небольшой полезный жест без ожидания награды: помоги, поблагодари или удели человеку внимание.",reflection:"Как этот поступок повлиял на ваше общение?"},
 {id:"body",category:"Well-being",title:"Пауза для тела",minutes:5,xp:20,task:"Сделай спокойную паузу: отложи экран, расслабь плечи, подыши комфортно и оцени, что сейчас нужно твоему телу. Не делай ничего через боль.",reflection:"Что ты заметил в своём состоянии?"},
 {id:"decision",category:"Critical thinking",title:"Проверь своё убеждение",minutes:7,xp:20,task:"Выбери одно мнение, в котором сегодня был уверен. Найди сильный аргумент против него и подумай, какие данные могли бы изменить твою позицию.",reflection:"Стало ли твоё мнение точнее или гибче?"},
 {id:"create",category:"Creativity",title:"Создай, а не только потребляй",minutes:10,xp:20,task:"Создай небольшой результат: абзац, идею, эскиз, заметку или план. Не оценивай качество — закончи маленькую версию.",reflection:"Что ты создал и что можно развить дальше?"},
 {id:"review",category:"Reflection",title:"Вечерний разбор без осуждения",minutes:5,xp:20,task:"Ответь письменно: что сегодня получилось, чему научился и что завтра сделаешь чуть иначе. Не превращай разбор в самокритику.",reflection:"Какой один вывод ты заберёшь в завтра?"}
];
function getDailyGrowthChallenge(dateString){
 const d=new Date(dateString+"T00:00:00Z");
 const day=Math.floor(d.getTime()/86400000);
 return DAILY_GROWTH_CHALLENGES[((day%DAILY_GROWTH_CHALLENGES.length)+DAILY_GROWTH_CHALLENGES.length)%DAILY_GROWTH_CHALLENGES.length];
}
function growthStreak(rows,today){
 const completed=new Set(rows.map(x=>String(x.challenge_date).slice(0,10)));
 let cursor=new Date(today+"T00:00:00Z");
 if(!completed.has(today))cursor.setUTCDate(cursor.getUTCDate()-1);
 let streak=0;
 while(completed.has(cursor.toISOString().slice(0,10))){streak++;cursor.setUTCDate(cursor.getUTCDate()-1);}
 return streak;
}
app.get("/api/growth/today",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const today=(await pool.query("SELECT CURRENT_DATE::text AS today")).rows[0].today;
  const challenge=getDailyGrowthChallenge(today);
  const r=await pool.query("SELECT challenge_date::text,challenge_id,xp_earned,completed_at FROM daily_growth_completions WHERE telegram_id=$1 ORDER BY challenge_date DESC LIMIT 45",[req.user.id]);
  const doneToday=r.rows.some(x=>x.challenge_date===today);
  const totalXp=r.rows.reduce((sum,x)=>sum+Number(x.xp_earned||0),0);
  const all=await pool.query("SELECT COALESCE(SUM(xp_earned),0)::int AS xp,COUNT(*)::int AS completed FROM daily_growth_completions WHERE telegram_id=$1",[req.user.id]);
  const xp=Number(all.rows[0].xp||0);
  res.json({date:today,challenge,doneToday,streak:growthStreak(r.rows,today),xp,level:Math.floor(xp/100)+1,completedDays:Number(all.rows[0].completed),nextLevelXp:100-(xp%100),recent:r.rows.slice(0,7)});
 }catch(e){res.status(503).json({error:e.message});}
});
app.post("/api/growth/complete",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const today=(await pool.query("SELECT CURRENT_DATE::text AS today")).rows[0].today;
  const challenge=getDailyGrowthChallenge(today);
  if(req.body.challengeId!==challenge.id)return res.status(400).json({error:"This is not today's challenge. Refresh and try again."});
  const r=await pool.query("INSERT INTO daily_growth_completions(telegram_id,challenge_date,challenge_id,xp_earned) VALUES($1,CURRENT_DATE,$2,$3) ON CONFLICT(telegram_id,challenge_date) DO NOTHING RETURNING challenge_date::text,challenge_id,xp_earned,completed_at",[req.user.id,challenge.id,challenge.xp]);
  const stats=await pool.query("SELECT COALESCE(SUM(xp_earned),0)::int AS xp,COUNT(*)::int AS completed FROM daily_growth_completions WHERE telegram_id=$1",[req.user.id]);
  res.json({ok:true,alreadyCompleted:r.rowCount===0,awardedXp:r.rowCount?challenge.xp:0,xp:Number(stats.rows[0].xp),level:Math.floor(Number(stats.rows[0].xp)/100)+1,completedDays:Number(stats.rows[0].completed)});
 }catch(e){res.status(500).json({error:e.message});}
});

const GROWTH_PROGRAMS={"reset-7":7,"transform-30":30};
app.get("/api/growth/programs",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const r=await pool.query("SELECT program_id,day_number,completed_at,reflection FROM growth_program_progress WHERE telegram_id=$1 ORDER BY program_id,day_number",[req.user.id]);
  const stats=await pool.query("SELECT program_id,COUNT(*)::int AS completed FROM growth_program_progress WHERE telegram_id=$1 GROUP BY program_id",[req.user.id]);
  res.json({progress:r.rows,counts:Object.fromEntries(stats.rows.map(x=>[x.program_id,Number(x.completed)]))});
 }catch(e){res.status(503).json({error:e.message});}
});
app.post("/api/growth/programs/:programId/:day/complete",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const program=req.params.programId,day=Number(req.params.day),max=GROWTH_PROGRAMS[program];
  if(!max||!Number.isInteger(day)||day<1||day>max)return res.status(400).json({error:"Invalid growth programme day."});
  const reflection=String(req.body.reflection||"").trim().slice(0,1000);
  const r=await pool.query("INSERT INTO growth_program_progress(telegram_id,program_id,day_number,reflection) VALUES($1,$2,$3,$4) ON CONFLICT(telegram_id,program_id,day_number) DO UPDATE SET reflection=CASE WHEN EXCLUDED.reflection<>'' THEN EXCLUDED.reflection ELSE growth_program_progress.reflection END RETURNING program_id,day_number,completed_at,reflection",[req.user.id,program,day,reflection]);
  const count=await pool.query("SELECT COUNT(*)::int AS completed FROM growth_program_progress WHERE telegram_id=$1 AND program_id=$2",[req.user.id,program]);
  res.json({ok:true,progress:r.rows[0],completed:Number(count.rows[0].completed),total:max});
 }catch(e){res.status(500).json({error:e.message});}
});
app.get("/api/growth/weekly-review",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const r=await pool.query("SELECT COUNT(*) FILTER (WHERE challenge_date>=CURRENT_DATE-6)::int AS days_this_week,COALESCE(SUM(xp_earned) FILTER (WHERE challenge_date>=CURRENT_DATE-6),0)::int AS xp_this_week,COUNT(*) FILTER (WHERE challenge_date>=CURRENT_DATE-6 AND challenge_date<CURRENT_DATE)::int AS previous_days FROM daily_growth_completions WHERE telegram_id=$1",[req.user.id]);
  const reading=await pool.query("SELECT COUNT(*) FILTER (WHERE status='completed')::int AS books_finished,COUNT(*) FILTER (WHERE status='reading')::int AS books_in_progress FROM reading_progress WHERE telegram_id=$1",[req.user.id]);
  const program=await pool.query("SELECT COUNT(*)::int AS programme_days FROM growth_program_progress WHERE telegram_id=$1 AND completed_at>=NOW()-INTERVAL '7 days'",[req.user.id]);
  res.json({week:r.rows[0],reading:reading.rows[0],programmeDays:Number(program.rows[0].programme_days)});
 }catch(e){res.status(503).json({error:e.message});}
});

app.get("/api/reading",auth,async(req,res)=>{
 try{await ensureUser(req.user);const r=await pool.query("SELECT book_id,current_page,total_pages,status,updated_at,completed_at FROM reading_progress WHERE telegram_id=$1 ORDER BY updated_at DESC",[req.user.id]);res.json({reading:r.rows});}
 catch(e){res.status(503).json({error:e.message});}
});
app.post("/api/reading/:bookId",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const page=Math.max(0,Math.floor(Number(req.body.currentPage)||0));
  const total=req.body.totalPages==null?null:Math.max(1,Math.floor(Number(req.body.totalPages)||1));
  const status=req.body.status==="completed"?"completed":(page>0?"reading":"planned");
  const current=total==null?page:Math.min(page,total);
  const r=await pool.query(`INSERT INTO reading_progress(telegram_id,book_id,current_page,total_pages,status,completed_at,updated_at)
   VALUES($1,$2,$3,$4,$5,CASE WHEN $5='completed' THEN NOW() ELSE NULL END,NOW())
   ON CONFLICT(telegram_id,book_id) DO UPDATE SET current_page=EXCLUDED.current_page,total_pages=COALESCE(EXCLUDED.total_pages,reading_progress.total_pages),status=EXCLUDED.status,completed_at=CASE WHEN EXCLUDED.status='completed' THEN COALESCE(reading_progress.completed_at,NOW()) ELSE NULL END,updated_at=NOW()
   RETURNING book_id,current_page,total_pages,status,updated_at,completed_at`,[req.user.id,req.params.bookId,current,total,status]);
  res.json({ok:true,progress:r.rows[0]});
 }catch(e){res.status(500).json({error:e.message});}
});
app.delete("/api/favorites/:bookId",auth,async(req,res)=>{
 try{await pool.query("DELETE FROM favorites WHERE telegram_id=$1 AND book_id=$2",[req.user.id,req.params.bookId]);res.json({ok:true});}
 catch(e){res.status(500).json({error:e.message});}
});

// Telegram Stars subscriptions. Prices must be explicitly configured in Render.
async function createMembershipInvoice(req,res,plan,amount) {
 try {
  if(!amount || !Number.isInteger(amount) || amount<1) return res.status(503).json({error:"This plan is not available yet: Stars price has not been configured."});
  await ensureUser(req.user);
  const payload=`membership:${plan}:${req.user.id}:${crypto.randomUUID()}`;
  await pool.query("INSERT INTO pending_payments(payload,telegram_id,kind,amount) VALUES($1,$2,$3,$4)",[payload,req.user.id,plan,amount]);
  try {
   await botApi("sendInvoice",{chat_id:req.user.id,title:`Zer0Life ${plan==="standard"?"Standard":"Premium"}`,description:`30 days of ${plan} library membership`,payload,provider_token:"",currency:"XTR",prices:[{label:`${plan} · 30 days`,amount}],subscription_period:VIP_PERIOD});
  } catch(e) {
   await pool.query("DELETE FROM pending_payments WHERE payload=$1",[payload]);
   throw e;
  }
  res.json({ok:true,message:"Invoice sent to your Telegram chat"});
 } catch(e){res.status(500).json({error:e.message});}
}
app.post("/api/pay/standard",auth,(req,res)=>createMembershipInvoice(req,res,"standard",STANDARD_PRICE));
app.post("/api/pay/premium",auth,(req,res)=>createMembershipInvoice(req,res,"premium",PREMIUM_PRICE));
// Legacy route intentionally maps to Standard, but remains unavailable until its price is configured.
app.post("/api/pay/vip",auth,(req,res)=>createMembershipInvoice(req,res,"standard",STANDARD_PRICE));

app.post("/api/pay/book",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const r=await pool.query("SELECT id,title,price_stars FROM books WHERE id=$1 AND is_published=true AND rights_status IN ('licensed','public_domain','original')",[req.body.bookId]);
  const book=r.rows[0]; if(!book)return res.status(404).json({error:"Published, rights-cleared book not found"});
  if(ADMINS.has(String(req.user.id)))return res.json({ok:true,message:"Administrator access is free. No payment required."});
  if(!Number.isInteger(book.price_stars)||book.price_stars<1)return res.status(503).json({error:"Book price is not configured"});
  const payload=`book:${book.id}:${req.user.id}:${crypto.randomUUID()}`;
  await pool.query("INSERT INTO pending_payments(payload,telegram_id,kind,book_id,amount) VALUES($1,$2,'book',$3,$4)",[payload,req.user.id,book.id,book.price_stars]);
  try{await botApi("sendInvoice",{chat_id:req.user.id,title:book.title,description:`Digital book: ${book.title}`,payload,provider_token:"",currency:"XTR",prices:[{label:book.title,amount:book.price_stars}]});}
  catch(e){await pool.query("DELETE FROM pending_payments WHERE payload=$1",[payload]);throw e;}
  res.json({ok:true,message:"Invoice sent to your Telegram chat"});
 }catch(e){res.status(500).json({error:e.message});}
});

// Telegram webhook validates the invoice against the pending server-side record.
app.post("/telegram/webhook",async(req,res)=>{
 if(req.get("X-Telegram-Bot-Api-Secret-Token")!==WEBHOOK_SECRET)return res.sendStatus(401);
 const u=req.body||{};
 try{
  const msg=u.message;
  if(msg?.text?.startsWith("/start")){
   await botApi("sendMessage",{chat_id:msg.chat.id,text:"Welcome to Zer0Life Book Club! Open the library to explore books and your reading space.",reply_markup:{inline_keyboard:[[{text:"📚 Open Book Club",web_app:{url:PUBLIC_APP_URL}}]]}});
  }else if(msg?.text?.startsWith("/help"))await botApi("sendMessage",{chat_id:msg.chat.id,text:"Use /start to open Zer0Life Book Club."});
  if(u.pre_checkout_query){
   const q=u.pre_checkout_query;
   const p=await pool.query("SELECT telegram_id,amount,currency,status FROM pending_payments WHERE payload=$1",[q.invoice_payload]);
   const item=p.rows[0];
   const valid=!!item&&item.status==="pending"&&String(item.telegram_id)===String(q.from.id)&&item.amount===q.total_amount&&item.currency===q.currency&&q.currency==="XTR";
   await botApi("answerPreCheckoutQuery",{pre_checkout_query_id:q.id,ok:valid,...(!valid?{error_message:"Invoice could not be verified. Please create a new invoice."}:{})});
  }
  if(msg?.successful_payment){
   const s=msg.successful_payment;
   const client=await pool.connect();
   try{
    await client.query("BEGIN");
    const found=await client.query("SELECT * FROM pending_payments WHERE payload=$1 FOR UPDATE",[s.invoice_payload]);
    const p=found.rows[0];
    const isRenewal=!!s.is_recurring;
    if(p&&(p.status==="pending"||(p.status==="paid"&&isRenewal))&&String(p.telegram_id)===String(msg.from.id)&&p.amount===s.total_amount&&p.currency===s.currency&&s.currency==="XTR"&&(p.kind==="book"?!isRenewal:true)){
     const saved=await client.query("INSERT INTO purchases(telegram_id,book_id,telegram_payment_charge_id,total_amount,currency,plan) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(telegram_payment_charge_id) DO NOTHING RETURNING id",[p.telegram_id,p.book_id,s.telegram_payment_charge_id,s.total_amount,s.currency,p.kind==="book"?null:p.kind]);
     if(saved.rowCount>0&&(p.kind==="standard"||p.kind==="premium")){
      const expiry=s.subscription_expiration_date?new Date(s.subscription_expiration_date*1000):new Date(Date.now()+VIP_PERIOD*1000);
      await client.query(`INSERT INTO memberships(telegram_id,status,plan,expires_at,updated_at) VALUES($1,'active',$2,$3,NOW())
       ON CONFLICT(telegram_id) DO UPDATE SET status='active',plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=NOW()`,[p.telegram_id,p.kind,expiry]);
     }
     if(p.status==="pending") await client.query("UPDATE pending_payments SET status='paid',paid_at=NOW() WHERE payload=$1",[p.payload]);
    }
    await client.query("COMMIT");
   }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }
  res.sendStatus(200);
 }catch(e){console.error("Telegram webhook handler error:",e.message);res.sendStatus(500);}
});

app.get("/api/admin/books",auth,admin,async(req,res)=>{
 try{const r=await pool.query("SELECT * FROM books ORDER BY created_at DESC");res.json({books:r.rows});}
 catch(e){res.status(500).json({error:e.message});}
});
app.post("/api/admin/books",auth,admin,async(req,res)=>{
 const b=req.body||{};
 if(!b.id||!b.title||!b.author||!b.category||!b.language)return res.status(400).json({error:"id, title, author, category and language are required"});
 try{
  const r=await pool.query(`INSERT INTO books(id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,author=EXCLUDED.author,description=EXCLUDED.description,category=EXCLUDED.category,language=EXCLUDED.language,year=EXCLUDED.year,price_stars=EXCLUDED.price_stars,vip_only=EXCLUDED.vip_only,cover_url=EXCLUDED.cover_url,content_url=EXCLUDED.content_url,rights_status=EXCLUDED.rights_status,is_published=EXCLUDED.is_published RETURNING id`,
   [b.id,b.title,b.author,b.description||"",b.category,b.language,b.year||null,b.price_stars||0,!!b.vip_only,b.cover_url||null,b.content_url||null,b.rights_status||"pending",!!b.is_published]);
  res.json({ok:true,id:r.rows[0].id});
 }catch(e){res.status(500).json({error:e.message});}
});
app.post("/api/admin/books/:bookId/pages",auth,admin,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const pageNumber=Math.floor(Number(req.body.pageNumber));
  const pageText=String(req.body.pageText||"");
  if(!Number.isInteger(pageNumber)||pageNumber<1||!pageText.trim()) return res.status(400).json({error:"Positive pageNumber and non-empty pageText are required"});
  const book=await pool.query("SELECT id,rights_status FROM books WHERE id=$1",[req.params.bookId]);
  if(!book.rows[0]) return res.status(404).json({error:"Book not found"});
  if(!["licensed","public_domain","original"].includes(book.rows[0].rights_status)) return res.status(403).json({error:"Book distribution rights must be verified before adding readable content"});
  await pool.query("INSERT INTO book_pages(book_id,page_number,page_text) VALUES($1,$2,$3) ON CONFLICT(book_id,page_number) DO UPDATE SET page_text=EXCLUDED.page_text",[req.params.bookId,pageNumber,pageText]);
  res.json({ok:true,bookId:req.params.bookId,pageNumber});
 }catch(e){res.status(500).json({error:e.message});}
});



async function importApprovedOnlineBooks(limit=20) {
 const candidates=await pool.query(`SELECT id,title,content_url,source_url,rights_status,rights_evidence_url,source_license
  FROM books WHERE rights_status IN ('licensed','public_domain') AND rights_evidence_url IS NOT NULL
  AND content_url IS NOT NULL AND (SELECT COUNT(*) FROM book_pages p WHERE p.book_id=books.id)=0
  ORDER BY created_at ASC LIMIT $1`,[Math.max(1,Math.min(50,Number(limit)||20))]);
 const results=[];
 for(const book of candidates.rows){
  try{
   const u=new URL(book.content_url);
   const host=u.hostname.toLowerCase();
   if(!(host==="gutenberg.org"||host.endsWith(".gutenberg.org")||host.endsWith(".wikisource.org")))
    throw new Error("Source host is not on the approved import allowlist");
   if(u.protocol!=="https:") throw new Error("HTTPS source required");
   const response=await fetch(u.toString(),{headers:{"User-Agent":"Zer0LifeBookClub/1.0 (licensed full-text ingestion)"}});
   if(!response.ok) throw new Error("Source returned HTTP "+response.status);
   const type=(response.headers.get("content-type")||"").toLowerCase();
   if(type.includes("text/html")) throw new Error("Source returned HTML, not a direct full-text file");
   let body=await response.text();
   if(body.length<12000) throw new Error("Downloaded content is too short; refusing to publish a partial text");
   body=body.replace(/^\\uFEFF/,"").replace(/\\r/g,"").trim();
   const start=body.search(/\\*\\*\\* START OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
   if(start>=0){const nl=body.indexOf("\\n",start);if(nl>=0)body=body.slice(nl+1);}
   const end=body.search(/\\*\\*\\* END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
   if(end>=0)body=body.slice(0,end);
   body=body.trim();
   if(body.length<10000)throw new Error("Text is too short after removing source wrapper");
   const chunks=[];let rest=body;
   while(rest.length){
    let cut=Math.min(2800,rest.length);
    if(cut<rest.length){const boundary=rest.lastIndexOf(" ",cut);if(boundary>cut*.65)cut=boundary;}
    chunks.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();
   }
   if(chunks.length<5)throw new Error("Insufficient page count; import rejected");
   const client=await pool.connect();
   try{
    await client.query("BEGIN");
    const current=await client.query("SELECT rights_status,rights_evidence_url FROM books WHERE id=$1 FOR UPDATE",[book.id]);
    if(!current.rows[0]||!["licensed","public_domain"].includes(current.rows[0].rights_status)||!current.rows[0].rights_evidence_url)throw new Error("Rights approval changed during import");
    await client.query("DELETE FROM book_pages WHERE book_id=$1",[book.id]);
    for(let i=0;i<chunks.length;i++)await client.query("INSERT INTO book_pages(book_id,page_number,page_text) VALUES($1,$2,$3)",[book.id,i+1,chunks[i]]);
    await client.query("UPDATE books SET is_published=TRUE,full_text_source_url=content_url WHERE id=$1",[book.id]);
    await client.query("COMMIT");
   }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
   results.push({id:book.id,title:book.title,pages:chunks.length,status:"published"});
  }catch(e){results.push({id:book.id,title:book.title,status:"skipped",reason:e.message});}
 }
 return {processed:results.length,results};
}
app.post("/api/admin/import-standard-ebooks",auth,admin,async(_req,res)=>{try{const result=await importStandardEbooks();res.json({ok:true,results:result});}catch(e){res.status(500).json({error:e.message});}});
app.post("/api/admin/import-approved",auth,admin,async(req,res)=>{
 try{const result=await importApprovedOnlineBooks(req.body?.limit);res.json({ok:true,...result});}
 catch(e){res.status(500).json({error:e.message});}
});
app.post("/api/internal/catalog-sync",async(req,res)=>{
 const expected=process.env.CATALOG_SYNC_TOKEN;
 const supplied=String(req.headers.authorization||"").replace(/^Bearer\\s+/i,"");
 if(!expected||supplied!==expected)return res.status(401).json({error:"Unauthorized"});
 try{
  await importCatalogMetadata();
     try { await require('./scripts/import-entrepreneurship')(pool); } catch (error) { console.error('Entrepreneurship full-text import failed:', error.message); }
  const counts=await pool.query("SELECT language,COUNT(*)::int AS total,COUNT(*) FILTER (WHERE rights_status='pending')::int AS pending FROM books GROUP BY language ORDER BY language");
  res.json({ok:true,counts:counts.rows});
 }catch(e){console.error("Scheduled catalog sync failed:",e.message);res.status(500).json({error:"Catalog sync failed"});}
});
app.post("/api/admin/discover-catalog",auth,admin,async(req,res)=>{
 try{
  await importCatalogMetadata();
  const counts=await pool.query("SELECT language,COUNT(*)::int AS total,COUNT(*) FILTER (WHERE rights_status='pending')::int AS pending FROM books GROUP BY language ORDER BY language");
  res.json({ok:true,counts:counts.rows});
 }catch(e){res.status(500).json({error:e.message});}
});
app.get("/api/admin/rights-review",auth,admin,async(_req,res)=>{
 try{
  const r=await pool.query("SELECT id,title,author,language,year,source_url,content_url,source_license,rights_status,rights_evidence_url,rights_checked_at FROM books WHERE rights_status='pending' OR rights_evidence_url IS NULL ORDER BY created_at DESC LIMIT 250");
  res.json({books:r.rows});
 }catch(e){res.status(500).json({error:e.message});}
});
app.post("/api/admin/books/:bookId/rights",auth,admin,async(req,res)=>{
 const b=req.body||{};
 const allowed=["pending","licensed","public_domain"];
 if(!allowed.includes(b.rights_status)||!b.source_license||!b.rights_evidence_url)
  return res.status(400).json({error:"rights_status, source_license and rights_evidence_url are required"});
 if(!/^https:\/\//i.test(String(b.rights_evidence_url))) return res.status(400).json({error:"A public HTTPS evidence URL is required"});
 if(b.rights_status==="licensed"&&!b.permission_reference)
  return res.status(400).json({error:"A written permission or licence reference is required"});
 try{
  if(b.content_url){
  let source;
  try{source=new URL(String(b.content_url));}catch(_){return res.status(400).json({error:"Invalid full-text source URL"});}
  if(source.protocol!=="https:"||!["gutenberg.org","www.gutenberg.org"].includes(source.hostname)||!/\.txt(\.utf8)?$/i.test(source.pathname))
   return res.status(400).json({error:"For now, direct full-text import accepts only HTTPS Project Gutenberg .txt files"});
 }
 const r=await pool.query("UPDATE books SET rights_status=$1,source_license=$2,rights_evidence_url=$3,permission_reference=$4,content_url=COALESCE($5,content_url),rights_checked_at=NOW(),rights_checked_by=$6,is_published=CASE WHEN $1='pending' THEN FALSE ELSE is_published END WHERE id=$7 RETURNING id",
   [b.rights_status,String(b.source_license).slice(0,300),b.rights_evidence_url,b.permission_reference?String(b.permission_reference).slice(0,500):null,b.content_url||null,req.user.id,req.params.bookId]);
  if(!r.rowCount)return res.status(404).json({error:"Book not found"});
  res.json({ok:true,id:r.rows[0].id,rights_status:b.rights_status});
 }catch(e){res.status(500).json({error:e.message});}
});
app.get("/api/admin/stats",auth,admin,async(_req,res)=>{
 try{
  const [users,subs,books,sales]=await Promise.all([
   pool.query("SELECT COUNT(*)::int AS n FROM users"),
   pool.query("SELECT COUNT(*)::int AS n FROM memberships WHERE status='active' AND expires_at>NOW()"),
   pool.query("SELECT COUNT(*)::int AS n FROM books WHERE is_published=true"),
   pool.query("SELECT COALESCE(SUM(total_amount),0)::int AS stars FROM purchases")
  ]);
  res.json({users:users.rows[0].n,activeVip:subs.rows[0].n,publishedBooks:books.rows[0].n,salesStars:sales.rows[0].stars});
 }catch(e){res.status(500).json({error:e.message});}
});

app.use(express.static(path.join(__dirname,"public")));
let catalogSyncTimer=null;
function scheduleCatalogSync(){
 const delay=24*60*60*1000;
 if(catalogSyncTimer)clearTimeout(catalogSyncTimer);
 catalogSyncTimer=setTimeout(async function runCatalogSync(){
  try{
   console.log('Daily catalog sync started');
   await importCatalogMetadata();
   const result=await pool.query("SELECT language,COUNT(*)::int AS total FROM books GROUP BY language ORDER BY language");
   console.log('Daily catalog sync complete',JSON.stringify(result.rows));
  }catch(error){console.error('Daily catalog sync failed',error.message);}
  finally{scheduleCatalogSync();}
 },delay);
 console.log('Daily catalog sync scheduled');
}
async function start() {
 if (pool) await initDatabase();
 app.listen(PORT, async () => {
  console.log(`Zer0Life Book Club API listening on ${PORT}`);
  if (BOT_TOKEN) {
   try {
    const webhookUrl = `${PUBLIC_API_URL}/telegram/webhook`;
    const result = await botApi("setWebhook", { url: webhookUrl, secret_token: WEBHOOK_SECRET, allowed_updates: ["message", "pre_checkout_query"] });
    console.log("Telegram webhook registered:", result === true ? "yes" : "no");
   } catch (e) { console.error("Telegram webhook registration failed:", e.message); }
  } else console.warn("BOT_TOKEN missing; bot webhook not registered.");
  if (pool) {
   setImmediate(async () => {
    try {
     await seedOriginalGrowthBooks();
     await seedOriginalStarterBooks();
     // Classics queues are disabled; prioritize full-length business and psychology books.
     try {
      const importerPath = require.resolve('./scripts/import-taylor-management');
      console.log('Taylor importer found:', importerPath);
      const imported = await require(importerPath)(pool);
      console.log('Taylor management import result:', JSON.stringify(imported));
      try {
       const barnum = await require('./scripts/import-barnum-money-getting')(pool);
       console.log('Barnum money getting import result:', JSON.stringify(barnum));
      } catch (error) { console.error('Barnum full-text import failed:', error.stack || error.message); }
     } catch (error) { console.error('Taylor management full-text import failed:', error.stack || error.message); }
     await seedKnowledgeLibraryCandidates();
     await seedHumanBehaviorCandidates();
     await importCatalogMetadata();
     await importStandardEbooks();
     await importCuratedWikisourceBooks();
     try { await require('./scripts/import-entrepreneurship')(pool); } catch (error) { console.error('Entrepreneurship full-text import failed:', error.message); }
     scheduleCatalogSync();
     console.log("Background catalogue import finished.");
    } catch (error) {
     console.error("Background catalogue import failed:", error.message);
    }
   });
  }
 });
}
start().catch(e=>{console.error("Startup failed:",e.message);process.exit(1);});
