const API = (window.ZER0LIFE_API_BASE || "").replace(/\/$/, "");
const apiUrl = (p) => `${API}${p}`;
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor?.("#090909"); tg.setBackgroundColor?.("#090909"); }
const state={lang:"en",category:"all",filter:"all",query:"",books:[],favorites:new Set(),savedOnly:false};
const copy={
 en:{hero:"A curated library for ambitious minds, thoughtful leaders and lifelong learners.",explore:"Explore the library",categories:"Explore categories",library:"Library",search:"Search books, authors, ideas...",vip:"Unlock the entire library",home:"Home",saved:"Saved",profile:"Profile",all:"All books",empty:"No books found. Try another search.",buy:"Buy book",vipCta:"Become a member"},
 ru:{hero:"Библиотека для амбициозных людей, осознанных лидеров и тех, кто учится всю жизнь.",explore:"Открыть библиотеку",categories:"Категории",library:"Библиотека",search:"Поиск книг, авторов и идей...",vip:"Откройте всю библиотеку",home:"Главная",saved:"Избранное",profile:"Профиль",all:"Все книги",empty:"Книги не найдены. Измените поиск.",buy:"Купить книгу",vipCta:"Стать участником"},
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
async function loadBooks(){
 try{const r=await fetch(apiUrl(`/api/catalog?category=${encodeURIComponent(state.category)}&q=${encodeURIComponent(state.query)}&lang=${state.filter}`));if(!r.ok)throw 0;const d=await r.json();state.books=d.books;}
 catch{state.books=localBooks.filter(b=>(state.category==="all"||b.category===state.category)&&(state.filter==="all"||b.lang===state.filter)&&(!state.query||`${b.title} ${b.author}`.toLowerCase().includes(state.query.toLowerCase())));}
 renderBooks();renderCategories();
}
function renderCategories(){
 $("#categoryGrid").innerHTML=categories.map(([id,icon])=>{let label=id==="all"?(state.lang==="ru"?"Все книги":state.lang==="pl"?"Wszystkie":"All books"):catNames[id][["en","ru","pl"].indexOf(state.lang)];return `<button class="category ${state.category===id?"active":""}" data-cat="${id}"><span class="cat-icon">${icon}</span><b>${label}</b></button>`}).join("");
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
function openBook(id){const b=state.books.find(x=>x.id===id)||localBooks.find(x=>x.id===id);if(!b)return;openModal(`<div class="eyebrow">BOOK DETAILS</div><h2>${b.title}</h2><img class="modal-cover" src="${b.cover}" onerror="this.style.display='none'"><b>${b.author}</b><p>${b.description}</p><p>Language: ${b.lang.toUpperCase()} · ${b.year}</p><button class="gold-button" id="buyBook">${tr().buy} · ${b.priceStars} Stars ↗</button><div class="notice">Demo mode: checkout is not active until the Telegram bot and Stars payments are configured. Only licensed or public-domain full texts should be distributed.</div><button class="gold-button" id="saveBook" style="background:#29251e;color:#d6bd8b;margin-top:8px">♡ ${state.favorites.has(b.id)?"Saved":"Add to saved"}</button>`);$("#buyBook").onclick=()=>startCheckout("/api/pay/book",{bookId:b.id});$("#saveBook").onclick=()=>{state.favorites.has(b.id)?state.favorites.delete(b.id):state.favorites.add(b.id);openBook(id)}}
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
function openVip(){openModal(`<div class="eyebrow gold-text">ZER0LIFE VIP CLUB</div><h2>Knowledge without limits.</h2><div class="vip-price">$15 <small>/ month</small></div><p>Full access to the VIP collection, curated reading paths, saved books and new members-only releases.</p><button class="gold-button" id="joinVip">Continue to membership ↗</button><div class="notice">Preview only. The final amount will be displayed in Telegram Stars before confirmation. Subscription renewals and cancellation controls must be configured before launch.</div>`);$("#joinVip").onclick=()=>startCheckout("/api/pay/vip")}
function setLanguage(lang){state.lang=lang;$("#langButton").textContent=lang.toUpperCase()+"⌄";$("#heroSub").textContent=tr().hero;$("#exploreButton").innerHTML=tr().explore+" <span>↗</span>";$("#searchInput").placeholder=tr().search;renderCategories();renderBooks()}
$("#langButton").onclick=()=>{const next={en:"ru",ru:"pl",pl:"en"}[state.lang];setLanguage(next)};
$("#searchInput").addEventListener("input",e=>{state.query=e.target.value;loadBooks()});
$("#sortSelect").onchange=renderBooks;
$("#filterTabs").querySelectorAll("button").forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;$("#filterTabs").querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));loadBooks()});
$("#vipButton").onclick=$("#vipButton2").onclick=openVip;
$("#exploreButton").onclick=()=>$("#library").scrollIntoView({behavior:"smooth"});
$("#modalClose").onclick=closeModal;$("#modalBackdrop").onclick=e=>{if(e.target.id==="modalBackdrop")closeModal()};
$("#profileButton").onclick=()=>openModal(`<div class="eyebrow">YOUR ACCOUNT</div><h2>Welcome to Zer0Life</h2><p>Telegram profile and membership status will appear here after secure Telegram authentication is connected.</p><div class="notice">Preview account · Free membership</div>`);
document.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-nav]").forEach(x=>x.classList.toggle("nav-active",x===b));if(b.dataset.nav==="library")$("#library").scrollIntoView({behavior:"smooth"});else if(b.dataset.nav==="saved"){state.savedOnly=true;loadBooks();$("#library").scrollIntoView({behavior:"smooth"})}else if(b.dataset.nav==="profile")$("#profileButton").click();else{state.savedOnly=false;loadBooks();window.scrollTo({top:0,behavior:"smooth"})}});
setLanguage("en");loadBooks();
