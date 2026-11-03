const API=(window.ZER0LIFE_API_BASE||"").replace(/\/$/,"");
const tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();
const headers={"X-Telegram-Init-Data":tg?.initData||""};
const el=id=>document.getElementById(id);
async function api(path,opts={}){const r=await fetch(API+path,{...opts,headers:{...headers,...(opts.headers||{})}});const d=await r.json();if(!r.ok)throw new Error(d.error||"Request failed");return d;}
function safe(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function note(t){const n=el("syncMessage");if(n){n.hidden=false;n.textContent=t;}}
function setup(){const form=el("bookForm");if(form){form.hidden=true;form.style.display="none";const h=form.previousElementSibling;if(h&&h.tagName==="H2"){h.hidden=true;h.style.display="none";}}
 const catalog=el("bookList");if(catalog&&!el("syncPanel")){const p=document.createElement("section");p.id="syncPanel";p.style.cssText="margin:20px 0;padding:16px;border:1px solid #39352e;border-radius:10px";p.innerHTML='<h2>Automatic online library</h2><p style="color:#999;font-size:12px">Search metadata in EN / RU / PL / UK. Full texts are imported only after commercial distribution rights are verified.</p><button id="discoverBtn" class="gold-button" type="button">Sync online catalog</button><button id="standardEbooksBtn" class="gold-button" type="button" style="margin:10px 0 0">Import Standard Ebooks classics</button><button id="importBtn" class="gold-button" type="button" style="margin:10px 0 0">Import approved full texts</button><div id="syncMessage" class="notice" hidden style="margin-top:10px"></div><h3>Rights review queue</h3><div id="rightsQueue"></div>';catalog.parentNode.insertBefore(p,catalog);}
}
async function load(){try{
 const [s,b,q]=await Promise.all([api("/api/admin/stats"),api("/api/admin/books"),api("/api/admin/rights-review")]);
 el("stats").innerHTML=[["Users",s.users],["Active subscriptions",s.activeVip],["Published",s.publishedBooks],["Sales",s.salesStars+" ★"]].map(([k,v])=>'<div class="category"><span class="eyebrow">'+k+'</span><b>'+v+'</b></div>').join("");
 el("bookList").innerHTML=b.books.map(x=>'<div style="border-bottom:1px solid #333;padding:8px 0"><b>'+safe(x.title)+'</b> · '+safe(x.author)+'<br>'+safe(x.id)+' · '+safe(x.rights_status)+' · '+(x.is_published?"published":"draft")+'</div>').join("")||"No records yet.";
 const qel=el("rightsQueue");if(qel){qel.innerHTML=q.books.map(x=>'<div style="border-bottom:1px solid #333;padding:8px 0"><b>'+safe(x.title)+'</b> · '+safe(x.author)+'<br>'+safe(x.language)+' · '+safe(x.rights_status)+' · '+safe(x.source_url||"No source")+'<br><button type="button" class="gold-button rights-review" data-id="'+safe(x.id)+'">Review rights</button></div>').join("")||"No pending rights review.";qel.querySelectorAll(".rights-review").forEach(btn=>btn.addEventListener("click",()=>reviewRights(btn.dataset.id)));}
 }catch(e){note(e.message);}}
async function reviewRights(id){
 const status=window.prompt("Rights status: public_domain, licensed, or pending","public_domain");
 if(!status||!["public_domain","licensed","pending"].includes(status))return;
 const license=window.prompt("Exact licence / rights basis (required)","");
 const evidence=window.prompt("Public HTTPS link proving the rights status","");
 const contentUrl=window.prompt("Direct full-text HTTPS .txt URL from Project Gutenberg (leave blank if unavailable)","");
 if(!license||!evidence)return;
 let permission=null;
 if(status==="licensed"){permission=window.prompt("Publisher permission / contract reference (required)","");if(!permission)return;}
 if(!window.confirm("Save this rights decision for "+id+"? Only approve when the evidence covers this exact edition, translation, cover and commercial subscription redistribution."))return;
 try{
  await api("/api/admin/books/"+encodeURIComponent(id)+"/rights",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({rights_status:status,source_license:license,rights_evidence_url:evidence,permission_reference:permission,content_url:contentUrl||null})});
  note("Rights decision saved for "+id);await load();
 }catch(e){note("Rights review failed: "+e.message);}
}
async function sync(){const b=el("discoverBtn");b.disabled=true;note("Searching online sources…");try{const r=await api("/api/admin/discover-catalog",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});note("Sync complete: "+r.counts.map(x=>x.language+" "+x.total+" ("+x.pending+" pending rights)").join(" · "));await load();}catch(e){note("Sync failed: "+e.message);}finally{b.disabled=false;}}
async function importStandardEbooks(){
 const b=el('standardEbooksBtn');if(b)b.disabled=true;note('Downloading Standard Ebooks EPUB files…');
 try{const r=await api('/api/admin/import-standard-ebooks',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});note('Standard Ebooks: '+r.results.map(x=>x.title+' — '+x.status+(x.pages?' ('+x.pages+' pages)':x.reason?' — '+x.reason:'')).join(' | '));await load();}
 catch(e){note('Standard Ebooks import failed: '+e.message);}finally{if(b)b.disabled=false;}
}
async function importBooks(){const b=el("importBtn");b.disabled=true;note("Downloading approved full texts…");try{const r=await api("/api/admin/import-approved",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({limit:20})});note("Checked "+r.processed+" books: "+r.results.map(x=>x.title+" "+x.status+(x.pages?" "+x.pages+" pages":x.reason?" — "+x.reason:"")).join(" | "));await load();}catch(e){note("Import failed: "+e.message);}finally{b.disabled=false;}}
setup();el("discoverBtn")?.addEventListener("click",sync);el("standardEbooksBtn")?.addEventListener("click",importStandardEbooks);el("importBtn")?.addEventListener("click",importBooks);load();