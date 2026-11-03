const API=(window.ZER0LIFE_API_BASE||"").replace(/\/$/,"");
const tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();
const headers={"X-Telegram-Init-Data":tg?.initData||""};
const el=id=>document.getElementById(id);
async function api(path,opts={}){const r=await fetch(API+path,{...opts,headers:{...headers,...(opts.headers||{})}});const d=await r.json();if(!r.ok)throw new Error(d.error||"Request failed");return d}
async function load(){try{const [s,b]=await Promise.all([api("/api/admin/stats"),api("/api/admin/books")]);el("stats").innerHTML=[["Users",s.users],["Active VIP",s.activeVip],["Published",s.publishedBooks],["Book sales",s.salesStars+" ★"]].map(([k,v])=>`<div class="category"><span class="eyebrow">${k}</span><b style="font:600 23px 'Playfair Display';margin-top:8px">${v}</b></div>`).join("");el("bookList").innerHTML=b.books.map(x=>`<div style="border-bottom:1px solid #333;padding:8px 0"><b>${x.title}</b> · ${x.author}<br><span>${x.id} · ${x.rights_status} · ${x.is_published?"published":"draft"}</span></div>`).join("")||"No records yet."}catch(e){el("message").hidden=false;el("message").textContent=e.message;}}
function splitPages(text){const marker=/\\[PAGE\\]/i;if(marker.test(text))return text.split(marker).map(x=>x.trim()).filter(Boolean);const out=[];let rest=text.trim();while(rest.length){let n=Math.min(2500,rest.length);if(n<rest.length){const k=rest.lastIndexOf(" ",n);if(k>n*.65)n=k;}out.push(rest.slice(0,n).trim());rest=rest.slice(n).trim();}return out;}
el("bookForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const d=Object.fromEntries(f.entries());const full=d.full_text||"";delete d.full_text;d.year=d.year?Number(d.year):null;d.price_stars=Number(d.price_stars||0);d.vip_only=f.has("vip_only");d.is_published=false;
if(full.trim().length<500){el("message").hidden=false;el("message").textContent="Please paste the complete book text, not a short excerpt.";return;}
if(!/^[a-z0-9-]{3,100}$/.test(d.id||"")){el("message").hidden=false;el("message").textContent="ID must contain lowercase Latin letters, numbers and hyphens.";return;}
if((d.rights_status==="licensed"||d.rights_status==="public_domain")&&!d.content_url){el("message").hidden=false;el("message").textContent="Add the source or rights-proof URL before uploading.";return;}
const pages=splitPages(full);if(pages.length<10&&!confirm("This is only "+pages.length+" pages. Is this the complete book?"))return;
const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;el("message").hidden=false;
try{await api("/api/admin/books",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(d)});
for(let i=0;i<pages.length;i++){el("message").textContent="Uploading page "+(i+1)+" of "+pages.length+"…";await api("/api/admin/books/"+encodeURIComponent(d.id)+"/pages",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({pageNumber:i+1,pageText:pages[i]})});}
d.is_published=true;await api("/api/admin/books",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(d)});
el("message").textContent="Published successfully. Pages uploaded: "+pages.length+".";e.target.reset();await load();
}catch(err){el("message").textContent="Upload stopped: "+err.message+" You can retry with the same book ID.";}
finally{btn.disabled=false;}
};
load();