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

async function importCatalogMetadata() {
 // Import metadata only. Nothing is published until distribution rights are reviewed.
 const targets = [{code:"en",limit:50},{code:"ru",limit:50},{code:"pl",limit:50},{code:"uk",limit:50}];
 let inserted = 0;
 for (const target of targets) {
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
 // Fallback for English and Russian metadata. Open Library language query is
 // language:eng / language:rus. Records remain unpublished pending rights review.
 for (const target of [{code:"en",ol:"eng"},{code:"ru",ol:"rus"},{code:"uk",ol:"ukr"}]) {
  try {
   const fields="key,title,author_name,first_publish_year,cover_i";
   const urls=[`https://openlibrary.org/search.json?language=${target.ol}&limit=100&fields=${fields}`,`https://openlibrary.org/search.json?q=${encodeURIComponent(`language:${target.ol}`)}&limit=100&fields=${fields}`];
   let data=null,lastError=null;
   for(const url of urls){try{const response=await fetch(url,{headers:{"User-Agent":"Zer0LifeBookClub/1.0 (metadata discovery)"}});if(!response.ok)throw new Error(`Open Library HTTP ${response.status}`);data=await response.json();break;}catch(e){lastError=e;}}
   if(!data) throw lastError||new Error("Open Library unavailable");
   let n=0;
   for(const b of (data.docs||[])) {
    if(n>=50) break;
    const title=String(b.title||"").trim();
    const key=String(b.key||"").trim();
    if(!title||!key||!key.startsWith("/works/")) continue;
    const author=(b.author_name||[]).join(", ")||"Unknown";
    const cover=b.cover_i?`https://covers.openlibrary.org/b/id/${b.cover_i}-L.jpg`:null;
    const result=await pool.query(`INSERT INTO books
     (id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url)
     VALUES($1,$2,$3,'Imported bibliographic metadata; text and distribution rights not verified','personal',$4,$5,0,FALSE,$6,NULL,'pending',FALSE,$7)
     ON CONFLICT(id) DO NOTHING RETURNING id`,
     [`ol-${key.split("/").pop()}`,title,author,target.code,b.first_publish_year||null,cover,`https://openlibrary.org${key}`]);
    inserted+=result.rowCount; n++;
   }
   console.log(`Open Library metadata import ${target.code}:`,n,"records inspected");
  } catch(e) { console.error(`Open Library fallback failed for ${target.code}:`,e.message); }
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
async function start() {
 if (pool) { await initDatabase(); await importCatalogMetadata(); }
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
