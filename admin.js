const API=(window.ZER0LIFE_API_BASE||"").replace(/\/$/,"");
const tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();
const headers={"X-Telegram-Init-Data":tg?.initData||""};
const el=id=>document.getElementById(id);
async function api(path,opts={}){const r=await fetch(API+path,{...opts,headers:{...headers,...(opts.headers||{})}});const d=await r.json();if(!r.ok)throw new Error(d.error||"Request failed");return d;}
function safe(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function note(t){const n=el("syncMessage")||el("message");if(n){n.hidden=false;n.textContent=t;}}
async function load(){
 try{
  const [s,b,q]=await Promise.all([api("/api/admin/stats"),api("/api/admin/books"),api("/api/admin/rights-review")]);
  el("stats").innerHTML=[["Users",s.users],["Active subscriptions",s.activeVip],["Published",s.publishedBooks],["Sales",s.salesStars+" ★"]].map(([k,v])=>'<div class="category"><span class="eyebrow">'+k+'</span><b>'+v+'</b></div>').join("");
  el("bookList").innerHTML=b.books.map(x=>'<div style="border-bottom:1px solid #333;padding:8px 0"><b>'+safe(x.title)+'</b> · '+safe(x.author)+'<br>'+safe(x.id)+' · '+safe(x.rights_status)+' · '+(x.is_published?"published":"draft")+'</div>').join("")||"No records yet.";
  const qel=el("rightsQueue");if(qel)qel.innerHTML=q.books.map(x=>'<div style="border-bottom:1px solid #333;padding:8px 0"><b>'+safe(x.title)+'</b> · '+safe(x.author)+'<br>'+safe(x.language)+' · '+safe(x.rights_status)+' · '+safe(x.source_url||"No source")+'</div>').join("")||"No pending rights review.";
 }catch(e){note(e.message);}
}
async function runSync(){
 const b=el("discoverBtn");if(b)b.disabled=true;note("Searching online catalog sources…");
 try{const r=await api("/api/admin/discover-catalog",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});note("Sync complete: "+r.counts.map(x=>x.language+" "+x.total+" (pending "+x.pending+")").join(" · "));await load();}
 catch(e){note("Sync failed: "+e.message);}
 finally{if(b)b.disabled=false;}
}
async function runImport(){
 const b=el("importBtn");if(b)b.disabled=true;note("Importing full texts with approved rights…");
 try{const r=await api("/api/admin/import-approved",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({limit:20})});note("Checked "+r.processed+" books: "+r.results.map(x=>x.title+" — "+x.status+(x.pages?" ("+x.pages+" pages)":x.reason?" ("+x.reason+")":"")).join(" | "));await load();}
 catch(e){note("Import failed: "+e.message);}
 finally{if(b)b.disabled=false;}
}
el("discoverBtn")?.addEventListener("click",runSync);
el("importBtn")?.addEventListener("click",runImport);
load();