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
 ["personal","Саморазвитие","Personal growth","Rozwój osobisty","↑"]
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
 const user=validateInitData(req.get("X-Telegram-Init-Data")||"");
 if(!user?.id) return res.status(401).json({error:"Valid Telegram Mini App session required"});
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


async function seedOriginalStarterBooks() {
  // Short starter guides are not part of the product. Keep them unpublished.
  // Only complete, rights-cleared books with full text may appear in the catalog.
  const result = await pool.query(
    "UPDATE books SET is_published=FALSE WHERE id LIKE 'zl-original-%' AND is_published=TRUE"
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
   ON CONFLICT(id) DO NOTHING RETURNING id`,
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
 const works=[
  {id:"pg-1342",title:"Pride and Prejudice",author:"Jane Austen",death:1817,year:1813,category:"relationships",slug:"jane-austen/pride-and-prejudice"},
  {id:"pg-84",title:"Frankenstein",author:"Mary Shelley",death:1851,year:1831,category:"psychology",slug:"mary-shelley/frankenstein"},
  {id:"pg-1661",title:"The Adventures of Sherlock Holmes",author:"Arthur Conan Doyle",death:1930,year:1892,category:"personal",slug:"arthur-conan-doyle/the-adventures-of-sherlock-holmes"}
 ];
 const result=[];
 for(const w of works){
  try{
   if(2026-w.death<71)throw new Error("Author term not expired in Poland");
   const pageUrl="https://standardebooks.org/ebooks/"+w.slug;
   const downloadUrl=pageUrl+"/downloads/epub";
   await pool.query(`INSERT INTO books(id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url)
    VALUES($1,$2,$3,'Standard Ebooks edition; original author term expired in Poland. Text edition dedicated by Standard Ebooks to CC0; text only, no cover imported.',$4,'en',$5,0,FALSE,NULL,$6,'public_domain',FALSE,$7,'Original work: Polish life+70 term expired; Standard Ebooks production contributions CC0 1.0',$8)
    ON CONFLICT(id) DO UPDATE SET content_url=EXCLUDED.content_url,source_url=EXCLUDED.source_url,source_license=EXCLUDED.source_license,rights_evidence_url=EXCLUDED.rights_evidence_url
    WHERE books.rights_status IN ('pending','public_domain')`,
    [w.id,w.title,w.author,w.category,w.year,downloadUrl,pageUrl,"https://standardebooks.org/about"]);
   const response=await fetch(downloadUrl,{headers:{"User-Agent":"Zer0LifeBookClub/1.0 (public-domain ebook ingestion)","Accept":"application/epub+zip, application/octet-stream;q=0.9"}});
   if(!response.ok)throw new Error("Standard Ebooks download HTTP "+response.status);
   const contentType=(response.headers.get("content-type")||"").toLowerCase();
   if(contentType.includes("text/html"))throw new Error("Download endpoint returned HTML, not EPUB");
   const bytes=Buffer.from(await response.arrayBuffer());
   if(bytes.length<10000||bytes.length>30000000)throw new Error("EPUB size outside expected range");
   const textBody=extractEpubText(bytes);
   const chunks=[];let rest=textBody;
   while(rest.length){let cut=Math.min(2800,rest.length);if(cut<rest.length){const p=rest.lastIndexOf(" ",cut);if(p>cut*.65)cut=p;}chunks.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();}
   if(chunks.length<5)throw new Error("Insufficient page count");
   const client=await pool.connect();
   try{
    await client.query("BEGIN");
    const rights=await client.query("SELECT rights_status FROM books WHERE id=$1 FOR UPDATE",[w.id]);
    if(!rights.rows[0]||rights.rows[0].rights_status!=="public_domain")throw new Error("Rights status is not approved");
    await client.query("DELETE FROM book_pages WHERE book_id=$1",[w.id]);
    for(let i=0;i<chunks.length;i++)await client.query("INSERT INTO book_pages(book_id,page_number,page_text) VALUES($1,$2,$3)",[w.id,i+1,chunks[i]]);
    await client.query("UPDATE books SET is_published=TRUE,full_text_source_url=$2 WHERE id=$1",[w.id,downloadUrl]);
    await client.query("COMMIT");
   }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
   result.push({id:w.id,title:w.title,status:"published",pages:chunks.length});
  }catch(e){console.error("Standard Ebooks import skipped:",w.title,e.message);result.push({id:w.id,title:w.title,status:"skipped",reason:e.message});}
 }
 console.log("Standard Ebooks full-text import:",JSON.stringify(result));
 return result;
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
  const pageLimit=access.fullAccess?Number.MAX_SAFE_INTEGER:5;
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
app.post("/api/admin/import-standard-ebooks",auth,admin,async(_req,res)=>{try{const result=await importStandardEbooks();res.json({ok:true,results:result});}catch(e){res.status(500).json({error:e.message});}});\napp.post("/api/admin/import-approved",auth,admin,async(req,res)=>{
 try{const result=await importApprovedOnlineBooks(req.body?.limit);res.json({ok:true,...result});}
 catch(e){res.status(500).json({error:e.message});}
});
app.post("/api/internal/catalog-sync",async(req,res)=>{
 const expected=process.env.CATALOG_SYNC_TOKEN;
 const supplied=String(req.headers.authorization||"").replace(/^Bearer\\s+/i,"");
 if(!expected||supplied!==expected)return res.status(401).json({error:"Unauthorized"});
 try{
  await importCatalogMetadata();
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
 if (pool) { await initDatabase(); await seedOriginalStarterBooks(); await seedInitialEnglishClassics(); await seedSlavicClassicsForRightsReview(); await seedMoreSlavicClassicsForReview(); await seedNextClassicsForRightsReview(); await importCatalogMetadata(); scheduleCatalogSync(); }
 app.listen(PORT, async () => {
  console.log(`Zer0Life Book Club API listening on ${PORT}`);
  if (BOT_TOKEN) {
   try {
    const webhookUrl = `${PUBLIC_API_URL}/telegram/webhook`;
    const result = await botApi("setWebhook", { url: webhookUrl, secret_token: WEBHOOK_SECRET, allowed_updates: ["message", "pre_checkout_query"] });
    console.log("Telegram webhook registered:", result === true ? "yes" : "no");
   } catch (e) { console.error("Telegram webhook registration failed:", e.message); }
  } else console.warn("BOT_TOKEN missing; bot webhook not registered.");
 });
}
start().catch(e=>{console.error("Startup failed:",e.message);process.exit(1);});
