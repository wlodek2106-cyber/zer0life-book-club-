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
const VIP_PRICE = Number(process.env.VIP_PRICE_STARS || 1500);
const VIP_PERIOD = Number(process.env.VIP_PERIOD_SECONDS || 2592000);
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
  ALTER TABLE books ADD COLUMN IF NOT EXISTS year INTEGER;
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
 `);
 console.log("Database schema ready");
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
   AND ($3='' OR LOWER(title||' '||author||' '||description) LIKE '%'||$3||'%') ORDER BY created_at DESC`,[cat,lang,q]);
  return res.json({categories,books:r.rows});
 }
 const rows=sampleBooks.filter(b=>(cat==="all"||b.category===cat)&&(lang==="all"||b.lang===lang)&&(!q||`${b.title} ${b.author} ${b.description}`.toLowerCase().includes(q)));
 res.json({categories,books:rows});
}
app.get("/api/health",async(_req,res)=>{
 try{if(pool)await pool.query("SELECT 1");res.json({ok:true,app:"Zer0Life Book Club",database:!!pool,databaseConnected:!!pool});}
 catch(e){res.status(503).json({ok:false,app:"Zer0Life Book Club",database:false,error:"Database connection failed"});}
});
app.get("/api/catalog",catalog);
app.get("/api/me",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const [m,f,p]=await Promise.all([
   pool.query("SELECT status,expires_at FROM memberships WHERE telegram_id=$1",[req.user.id]),
   pool.query("SELECT book_id FROM favorites WHERE telegram_id=$1",[req.user.id]),
   pool.query("SELECT book_id FROM purchases WHERE telegram_id=$1",[req.user.id])
  ]);
  const progress=await pool.query("SELECT book_id,current_page,total_pages,status,updated_at,completed_at FROM reading_progress WHERE telegram_id=$1 ORDER BY updated_at DESC",[req.user.id]);
  res.json({user:req.user,isAdmin:ADMINS.has(String(req.user.id)),membership:m.rows[0]||{status:"inactive",plan:"free"},favorites:f.rows.map(x=>x.book_id),ownedBooks:p.rows.map(x=>x.book_id),reading:progress.rows});
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

// Telegram Stars: all digital goods/services use currency XTR and an empty provider_token.
app.post("/api/pay/book",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const r=pool?await pool.query("SELECT id,title,price_stars FROM books WHERE id=$1 AND is_published=true AND rights_status IN ('licensed','public_domain','original')",[req.body.bookId]):{rows:[]};
  const book=r.rows[0]; if(!book)return res.status(404).json({error:"Published, rights-cleared book not found"});
  const payload=`book:${book.id}:${req.user.id}:${crypto.randomUUID()}`;
  await botApi("sendInvoice",{chat_id:req.user.id,title:book.title,description:`Digital book: ${book.title}`,payload,provider_token:"",currency:"XTR",prices:[{label:book.title,amount:book.price_stars}]});
  res.json({ok:true,message:"Invoice sent to your Telegram chat"});
 }catch(e){res.status(500).json({error:e.message});}
});
app.post("/api/pay/vip",auth,async(req,res)=>{
 try{
  await ensureUser(req.user);
  const payload=`vip:${req.user.id}:${crypto.randomUUID()}`;
  await botApi("sendInvoice",{chat_id:req.user.id,title:"Zer0Life VIP Club",description:"30 days of access to the VIP book library",payload,provider_token:"",currency:"XTR",prices:[{label:"VIP membership · 30 days",amount:VIP_PRICE}],subscription_period:VIP_PERIOD});
  res.json({ok:true,message:"VIP invoice sent to your Telegram chat"});
 }catch(e){res.status(500).json({error:e.message});}
});

// Telegram webhook: validate Telegram's secret-token header.
app.post("/telegram/webhook", async (req,res) => {
 if (req.get("X-Telegram-Bot-Api-Secret-Token") !== WEBHOOK_SECRET) return res.sendStatus(401);
 const u = req.body || {};
 try {
  const msg = u.message;
  if (msg?.text?.startsWith("/start")) {
   await botApi("sendMessage", {
    chat_id: msg.chat.id,
    text: "Welcome to Zer0Life Book Club! Open the library to explore books and your reading space.",
    reply_markup: { inline_keyboard: [[{ text: "📚 Open Book Club", web_app: { url: PUBLIC_APP_URL } }]] }
   });
  } else if (msg?.text?.startsWith("/help")) {
   await botApi("sendMessage", { chat_id: msg.chat.id, text: "Use /start to open Zer0Life Book Club." });
  }
  // Keep checkout disabled until DB migrations and invoice ownership/amount validation are complete.
  if (u.pre_checkout_query) {
   await botApi("answerPreCheckoutQuery", { pre_checkout_query_id: u.pre_checkout_query.id, ok: false, error_message: "Payments are temporarily unavailable. Please try again later." });
  }
  res.sendStatus(200);
 } catch (e) { console.error("Telegram webhook handler error:", e.message); res.sendStatus(500); }
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
 });
}
start().catch(e=>{console.error("Startup failed:",e.message);process.exit(1);});
