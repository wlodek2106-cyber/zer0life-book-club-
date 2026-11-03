const API = (window.ZER0LIFE_API_BASE || "").replace(/\/$/, "");
const apiUrl = (p) => `${API}${p}`;
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor?.("#090909"); tg.setBackgroundColor?.("#090909"); }
const state={lang:"en",category:"all",filter:"all",query:"",books:[],favorites:new Set(),savedOnly:false,me:null,reading:[],accountError:""};
const initData=()=>tg?.initData||"";
async function api(path,options={}) {
 const headers={...(options.headers||{}),"X-Telegram-Init-Data":initData()};
 if(options.body)headers["content-type"]="application/json";
 const r=await fetch(apiUrl(path),{...options,headers});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error||"Request failed");
 return d;
}
async function loadAccount(){
 if(!initData())return;
 try{state.me=await api("/api/me");state.favorites=new Set(state.me.favorites||[]);state.reading=state.me.reading||[];}
 catch(e){state.accountError=e.message;console.warn("Account load:",e.message);}
}
async function saveProgress(bookId,currentPage,totalPages,status){
 const d=await api("/api/reading/"+encodeURIComponent(bookId),{method:"POST",body:JSON.stringify({currentPage,totalPages,status})});
 const old=state.reading.findIndex(x=>x.book_id===bookId);
 if(old>=0)state.reading.splice(old,1);
 state.reading.unshift(d.progress);
 return d.progress;
}
const copy={
 en:{hero:"A curated library for ambitious minds, thoughtful leaders and lifelong learners.",explore:"Explore the library",categories:"Explore categories",library:"Library",search:"Search books, authors, ideas...",vip:"Unlock the entire library",home:"Home",saved:"Saved",profile:"Profile",all:"All books",empty:"No books found. Try another search.",buy:"Buy book",vipCta:"Become a member"},
 ru:{hero:"Библиотека для амбициозных людей, осознанных лидеров и тех, кто учится всю жизнь.",explore:"Открыть библиотеку",categories:"Категории",library:"Библиотека",search:"Поиск книг, авторов и идей...",vip:"Откройте всю библиотеку",home:"Главная",saved:"Избранное",profile:"Профиль",all:"Все книги",empty:"Книги не найдены. Измените поиск.",buy:"Купить книгу",vipCta:"Стать участником"},
 uk:{hero:"Бібліотека для амбітних людей, лідерів і тих, хто навчається протягом усього життя.",explore:"Відкрити бібліотеку",categories:"Категорії",library:"Бібліотека",search:"Пошук книг, авторів та ідей...",vip:"Відкрийте всю бібліотеку",home:"Головна",saved:"Збережене",profile:"Профіль",all:"Усі книги",empty:"Книг не знайдено. Спробуйте інший пошук.",buy:"Купити книгу",vipCta:"Приєднатися до клубу"},
 pl:{hero:"Wyselekcjonowana biblioteka dla ambitnych umysłów, liderów i osób uczących się przez całe życie.",explore:"Otwórz bibliotekę",categories:"Kategorie",library:"Biblioteka",search:"Szukaj książek, autorów, idei...",vip:"Odblokuj całą bibliotekę",home:"Start",saved:"Zapisane",profile:"Profil",all:"Wszystkie",empty:"Nie znaleziono książek.",buy:"Kup książkę",vipCta:"Dołącz do klubu"}
};
const catNames={business:["Business","Бизнес","Biznes"],psychology:["Psychology","Психология","Psychologia"],psychosomatics:["Psychosomatics","Психосоматика","Psychosomatyka"],mindfulness:["Mindfulness","Осознанность","Uważność"],relationships:["Love & relationships","Любовь и отношения","Miłość i relacje"],leadership:["CEO & leadership","CEO и управление","CEO i zarządzanie"],money:["Money & investing","Деньги и инвестиции","Finanse i inwestycje"],personal:["Personal growth","Саморазвитие","Rozwój osobisty"]};
const categories=[["all","✦"],["business","▣"],["psychology","◉"],["psychosomatics","⌁"],["mindfulness","☼"],["relationships","♡"],["leadership","♜"],["money","◇"],["personal","↑"]];
const localBooks=[
{id:"b1",category:"business",title:"The Lean Startup",author:"Eric Ries",year:2011,lang:"en",priceStars:350,vip:true,description:"A practical framework for testing ideas, learning quickly and building products customers actually want.",cover:"https://covers.openlibrary.org/b/isbn/9780307887894-L.jpg"},
{id:"b2",category:"business",title:"От хорошего к великому",author:"Джим Коллинз",year:2001,lang:"ru",priceStars:300,vip:true,description:"Исследование того, как компании переходят от хороших результатов к выдающимся.",cover:"https://covers.openlibrary.org/b/isbn/9780712676090-L.jpg"},
{id:"b3",category:"psychology",title:"Thinking, Fast and Slow",author:"Daniel Kahneman",year:2011,lang:"en",priceStars:400,vip:true,description:"How two systems shape the way we think, judge and make decisions.",cover:"https://covers.openlibrary.org/b/isbn/9780374533557-L.jpg"},
{id:"b4",category:"mindfulness",title:"Сила настоящего",author:"Экхарт Толле",year:1997,lang:"ru",priceStars:280,vip:true,description:"Практики внимания к настоящему моменту и наблюдения за мыслями.",cover:"https://covers.openlibrary.org/b/isbn/9781577311522-L.jpg"},
{id:"b5",category:"leadership",title:"The Effective Executive",author:"Peter F. Drucker",year:1967,lang:"en",priceStars:320,vip:true,description:"A classic guide to effectiveness, priorities and decision-making for managers.",cover:"https://covers.openlibrary.org/b/isbn/9780060144698-L.jpg"},
{id:"b6",category:"relationships",title:"Пять языков любви",author:"Гэри Чепмен",year:1992,lang:"ru",priceStars:250,vip:false,description:"Популярная модель способов выражать и воспринимать заботу в отношениях.",cover:"https://covers.openlibrary.org/b/isbn/9780802412706-L.jpg"},
{id:"b7",category:"money",title:"The Psychology of Money",author:"Morgan Housel",year:2020,lang:"en",priceStars:350,vip:true,description:"Timeless lessons on wealth, behavior, risk and financial decisions.",cover:"https://covers.openlibrary.org/b/isbn/9780857197689-L.jpg"},
{id:"b8",category:"personal",title:"Atomic Habits",author:"James Clear",year:2018,lang:"en",priceStars:350,vip:true,description:"A practical system for building good habits and making small improvements.",cover:"https://covers.openlibrary.org/b/isbn/9780735211292-L.jpg"}
];
const $=s=>document.querySelector(s);
const tr=()=>copy[state.lang];
const tx=(en,ru,pl,uk)=>state.lang==="ru"?ru:state.lang==="pl"?pl:state.lang==="uk"?uk:en;
async function loadBooks(){
 try{const r=await fetch(apiUrl(`/api/catalog?category=${encodeURIComponent(state.category)}&q=${encodeURIComponent(state.query)}&lang=${state.filter}`));if(!r.ok)throw 0;const d=await r.json();state.books=d.books;}
 catch{state.books=localBooks.filter(b=>(state.category==="all"||b.category===state.category)&&(state.filter==="all"||b.lang===state.filter)&&(!state.query||`${b.title} ${b.author}`.toLowerCase().includes(state.query.toLowerCase())));}
 renderBooks();renderCategories();
}
function renderCategories(){
 $("#categoryGrid").innerHTML=categories.map(([id,icon])=>{let label=id==="all"?tx("All books","Все книги","Wszystkie","Усі книги"):catNames[id][["en","ru","pl","uk"].indexOf(state.lang)]||catNames[id][0];return `<button class="category ${state.category===id?"active":""}" data-cat="${id}"><span class="cat-icon">${icon}</span><b>${label}</b></button>`}).join("");
 document.querySelectorAll("[data-cat]").forEach(b=>b.onclick=()=>{state.category=b.dataset.cat;state.savedOnly=false;loadBooks()});
}
function renderBooks(){
 let books=[...state.books];if(state.savedOnly)books=books.filter(b=>state.favorites.has(b.id));
 if($("#sortSelect").value==="az")books.sort((a,b)=>a.title.localeCompare(b.title));
 $("#bookCount").textContent=String(books.length).padStart(2,"0")+" BOOKS";
 $("#bookGrid").innerHTML=books.length?books.map(b=>`<article class="book-card"><div class="cover-wrap"><img src="${b.cover}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="cover-fallback" style="display:none">${b.title}</div><span class="book-tag">${b.vip?"VIP COLLECTION":"OPEN ACCESS"}</span></div><h3>${b.title}</h3><div class="book-author">${b.author} · ${b.year}</div><div class="book-meta"><span>${b.vip?"VIP / "+b.priceStars+" ★":b.priceStars+" ★"}</span><button data-book="${b.id}">Details ↗</button></div></article>`).join(""):`<div class="empty">${tr().empty}</div>`;
 document.querySelectorAll("[data-book]").forEach(b=>b.onclick=()=>openBook(b.dataset.book));
}
function openModal(html){$("#modalContent").innerHTML=html;$("#modalBackdrop").classList.add("open")}
function closeModal(){$("#modalBackdrop").classList.remove("open")}
function openBook(id){
 const b=state.books.find(x=>x.id===id)||localBooks.find(x=>x.id===id);if(!b)return;
 const p=state.reading.find(x=>x.book_id===id);
 openModal(`<div class="eyebrow">BOOK DETAILS</div><h2>${b.title}</h2><img class="modal-cover" src="${b.cover||""}" onerror="this.style.display='none'"><b>${b.author}</b><p>${b.description||""}</p><p>Language: ${String(b.lang||"en").toUpperCase()} · ${b.year||""}</p>
 <div class="notice">Бесплатный доступ включает первые 5 страниц. Полный текст доступен по активной подписке и только для книг с подтверждёнными правами.</div>
 <div id="bookPages" style="margin:16px 0"></div>
 <h3 style="margin:18px 0 8px">Мой прогресс</h3><p>${p?(tx("Статус: ","Статус: ","Status: ")+(p.status==="completed"?tx("Прочитано","Прочитано","Przeczytana"):p.status==="reading"?tx("Читаю","Читаю","Czytam"):tx("В планах","В планах","W planach"))+" · страница "+p.current_page+(p.total_pages?"/"+p.total_pages:"")):"Вы ещё не добавили книгу в свой план чтения."}</p>
 <label style="display:block;font-size:11px;color:#aaa;margin:8px 0">Текущая страница</label><input id="progressPage" type="number" min="0" value="${p?.current_page||0}" style="width:100%;padding:12px;background:#101010;color:#fff;border:1px solid #39352e;border-radius:6px">
 <label style="display:block;font-size:11px;color:#aaa;margin:8px 0">Всего страниц (если известно)</label><input id="progressTotal" type="number" min="1" value="${p?.total_pages||""}" placeholder="Например, 240" style="width:100%;padding:12px;background:#101010;color:#fff;border:1px solid #39352e;border-radius:6px">
 <button class="gold-button" id="saveProgress">Сохранить прогресс</button><button class="gold-button" id="completeBook" style="background:#29251e;color:#d6bd8b">Отметить прочитанной</button>
 <button class="gold-button" id="buyBook" style="background:#29251e;color:#d6bd8b">Купить книгу · ${b.priceStars||0} Stars</button>
 <button class="gold-button" id="saveBook" style="background:#29251e;color:#d6bd8b">♡ ${state.favorites.has(b.id)?tx("В избранном","В избранном","W ulubionych"):tx("В избранное","В избранное","Dodaj do ulubionych")}</button>`);
 const pagesBox=$("#bookPages");
 if(initData()){
  api("/api/books/"+encodeURIComponent(id)+"/pages").then(data=>{
   const esc=s=>String(s).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
   const pages=data.pages||[];
   pagesBox.innerHTML=pages.length?("<h3>Чтение</h3>"+pages.map(x=>'<section style="padding:14px 0;border-bottom:1px solid #39352e"><div class="eyebrow">СТРАНИЦА '+x.page_number+'</div><p style="white-space:pre-wrap;line-height:1.7">'+esc(x.page_text)+'</p></section>').join("")+(data.previewOnly?'<p class="notice">Это бесплатный фрагмент. Для полного доступа оформите подписку.</p>':"")):'<p class="notice">Текст пока не загружен. Администратор добавит страницы после проверки прав на книгу.</p>';
  }).catch(()=>{pagesBox.innerHTML='<p class="notice">Не удалось загрузить страницы. Откройте приложение через Telegram.</p>';});
 } else { pagesBox.innerHTML='<p class="notice">Для чтения войдите через Telegram.</p>'; }
 $("#saveProgress").onclick=async()=>{try{await saveProgress(id,Number($("#progressPage").value)||0,Number($("#progressTotal").value)||null);openBook(id);}catch(e){alert("Не удалось сохранить: "+e.message)}};
 $("#completeBook").onclick=async()=>{try{const total=Number($("#progressTotal").value)||null;await saveProgress(id,total||Number($("#progressPage").value)||0,total,"completed");openBook(id);}catch(e){alert("Не удалось сохранить: "+e.message)}};
 $("#buyBook").onclick=()=>startCheckout("/api/pay/book",{bookId:b.id});
 $("#saveBook").onclick=async()=>{try{if(state.favorites.has(b.id)){await api("/api/favorites/"+encodeURIComponent(b.id),{method:"DELETE"});state.favorites.delete(b.id)}else{await api("/api/favorites/"+encodeURIComponent(b.id),{method:"POST"});state.favorites.add(b.id)}openBook(id)}catch(e){alert("Откройте приложение через Telegram, чтобы сохранять избранное.")}};
}
async function startCheckout(path, body={}) {
  const initData = tg?.initData || "";
  if (!initData) {
    openModal(`<div class="eyebrow gold-text">OPEN IN TELEGRAM</div><h2>Telegram sign-in required</h2><p>Open this Mini App from the Zer0Life Book Club bot to continue to secure Telegram Stars checkout.</p>`);
    return;
  }
  try {
    const r = await fetch(apiUrl(path), {
      method:"POST",
      headers:{"content-type":"application/json","X-Telegram-Init-Data":initData},
      body:JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Checkout could not be started");
    openModal(`<div class="eyebrow gold-text">CHECK TELEGRAM</div><h2>Invoice sent</h2><p>${data.message || "Open your Telegram chat with the Zer0Life Book Club bot to complete payment."}</p><div class="notice">Your membership or book access is activated only after Telegram confirms successful payment.</div>`);
  } catch(e) {
    openModal(`<div class="eyebrow gold-text">CHECKOUT NOT READY</div><h2>Could not start payment</h2><p>${String(e.message).replace(/[<>&"]/g,"")}</p><div class="notice">The Telegram bot, backend URL and database must be configured before accepting payments.</div>`);
  }
}
function showDemoNotice(){startCheckout("/api/pay/vip")}
function openVip(){openModal(`<div class="eyebrow gold-text">ZER0LIFE BOOK CLUB</div><h2>Choose your membership</h2>
 <section class="notice"><h3>Standard</h3><div class="vip-price">$15 <small>/ month</small></div><p>General library, reading history, favorites and personal progress.</p><button class="gold-button" id="joinStandard">Choose Standard ↗</button></section>
 <section class="notice" style="margin-top:12px"><h3>Premium</h3><div class="vip-price">$30 <small>/ month</small></div><p>Everything in Standard, plus business, psychology, finance, leadership and personal growth collections.</p><button class="gold-button" id="joinPremium">Choose Premium ↗</button></section>
 <p class="notice">Payment is in Telegram Stars. The exact Stars price is shown in the Telegram invoice. Plans remain unavailable until their Stars prices are configured by the administrator.</p>`);
 $("#joinStandard").onclick=()=>startCheckout("/api/pay/standard");
 $("#joinPremium").onclick=()=>startCheckout("/api/pay/premium");
}
function setLanguage(lang){state.lang=lang;state.filter=lang;$("#langButton").textContent=lang.toUpperCase()+"⌄";$("#heroSub").textContent=tr().hero;$("#exploreButton").innerHTML=tr().explore+" <span>↗</span>";$("#searchInput").placeholder=tr().search;$("#filterTabs").querySelectorAll("button").forEach(x=>x.classList.toggle("active",x.dataset.filter===lang));renderCategories();loadBooks()}
$("#langButton").onclick=()=>{const next={en:"ru",ru:"pl",pl:"uk",uk:"en"}[state.lang];setLanguage(next)};
$("#searchInput").addEventListener("input",e=>{state.query=e.target.value;loadBooks()});
$("#sortSelect").onchange=renderBooks;
$("#filterTabs").querySelectorAll("button").forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;$("#filterTabs").querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));loadBooks()});
$("#vipButton").onclick=$("#vipButton2").onclick=openVip;
$("#exploreButton").onclick=()=>$("#library").scrollIntoView({behavior:"smooth"});
$("#modalClose").onclick=closeModal;$("#modalBackdrop").onclick=e=>{if(e.target.id==="modalBackdrop")closeModal()};
$("#profileButton").onclick=async()=>{
 if(!initData()){openModal(`<div class="eyebrow">TELEGRAM ACCOUNT</div><h2>Откройте через Telegram</h2><p>Личный кабинет доступен после запуска Mini App из бота.</p>`);return;}
 await loadAccount();
 if(!state.me){const msg=String(state.accountError||"Не удалось получить профиль").replace(/[<>&"]/g,"");openModal(`<div class="eyebrow">ACCOUNT ERROR</div><h2>Не удалось войти</h2><p>${msg}</p><p>Сервер пока не подтвердил Telegram ID.</p>`);return;}
 const u=state.me?.user||{}, m=state.me?.membership||{}, done=state.reading.filter(x=>x.status==="completed").length, active=state.reading.filter(x=>x.status==="reading").length, planned=state.reading.filter(x=>x.status==="planned").length;
 openModal(`<div class="eyebrow">YOUR ACCOUNT</div><h2>${(u.first_name||"Мой профиль").replace(/[<>&"]/g,"")}</h2><p>Telegram ID: ${u.id||"—"}</p><div class="notice">${state.me?.isAdmin?tx("ADMIN · FULL FREE ACCESS","АДМИНИСТРАТОР · ПОЛНЫЙ БЕСПЛАТНЫЙ ДОСТУП","ADMIN · PEŁNY BEZPŁATNY DOSTĘP"):("Подписка: "+(m.status||"inactive")+" · "+(m.plan||"free"))}</div>
 <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0;text-align:center"><div class="notice"><b>${done}</b><br>Прочитано</div><div class="notice"><b>${active}</b><br>Читаю</div><div class="notice"><b>${planned}</b><br>В планах</div></div>
 <h3>История чтения</h3>${state.reading.length?state.reading.map(x=>{const b=state.books.find(z=>z.id===x.book_id)||localBooks.find(z=>z.id===x.book_id);return `<p>${b?.title||x.book_id} — ${x.status==="completed"?tx("Прочитано","Прочитано","Przeczytana"):x.status==="reading"?tx("Читаю","Читаю","Czytam"):tx("В планах","В планах","W planach")} · стр. ${x.current_page}${x.total_pages?"/"+x.total_pages:""}</p>`}).join(""):"<p>Пока нет книг в истории. Добавьте книгу в план чтения.</p>"}`);
};
document.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-nav]").forEach(x=>x.classList.toggle("nav-active",x===b));if(b.dataset.nav==="library")$("#library").scrollIntoView({behavior:"smooth"});else if(b.dataset.nav==="saved"){state.savedOnly=true;loadBooks();$("#library").scrollIntoView({behavior:"smooth"})}else if(b.dataset.nav==="profile")$("#profileButton").click();else{state.savedOnly=false;loadBooks();window.scrollTo({top:0,behavior:"smooth"})}});
setLanguage("en");loadAccount().then(loadBooks);
