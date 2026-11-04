// Import the complete 1911 public-domain management book from its plain-text source.
const BOOK = {
  id: "pd-principles-scientific-management-en",
  title: "The Principles of Scientific Management",
  author: "Frederick Winslow Taylor",
  category: "business",
  language: "en",
  year: 1911,
  source: "https://www.gutenberg.org/ebooks/6435",
  textUrl: "https://www.gutenberg.org/cache/epub/6435/pg6435.txt",
  rightsEvidence: "https://en.wikisource.org/wiki/The_Principles_of_Scientific_Management"
};
function decodeEntities(s) {
  return s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
function makePages(text) {
  const pages=[]; let rest=text.trim();
  while(rest.length) {
    let cut=Math.min(3800,rest.length);
    if(cut<rest.length) { const p=rest.lastIndexOf("\n",cut); if(p>2500) cut=p; }
    pages.push(rest.slice(0,cut).trim()); rest=rest.slice(cut).trim();
  }
  return pages;
}
module.exports = async function importScientificManagement(pool) {
  const response=await fetch(BOOK.textUrl,{headers:{"User-Agent":"Zer0Life Book Club reader contact: zer0lifelabs.com"}});
  if(!response.ok) throw new Error("Project Gutenberg text HTTP "+response.status);
  const raw=await response.text();
  if(!raw.includes("The Principles of Scientific Management") || !raw.includes("Frederick Winslow Taylor") || !raw.includes("*** START OF THE PROJECT GUTENBERG EBOOK")) {
    throw new Error("Source text identity/header verification failed");
  }
  const start=raw.indexOf("*** START OF THE PROJECT GUTENBERG EBOOK");
  const end=raw.indexOf("*** END OF THE PROJECT GUTENBERG EBOOK");
  if(start<0 || end<=start) throw new Error("Could not isolate complete book body");
  const body=raw.slice(start).slice(raw.slice(start).indexOf("\n")+1, end).replace(/\r/g,"").trim();
  const normalized=decodeEntities(body).replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n");
  const pages=makePages(normalized);
  const chars=normalized.length;
  const words=normalized.split(/\s+/).filter(Boolean).length;
  if(chars<50000 || words<8000 || pages.length<15) throw new Error("Full book validation failed: "+words+" words, "+chars+" chars, "+pages.length+" pages");
  const attribution="Frederick Winslow Taylor, The Principles of Scientific Management (1911). Complete text sourced from Project Gutenberg eBook 6435. The underlying work is public domain; Taylor died in 1915. Source: "+BOOK.source+". Rights evidence: "+BOOK.rightsEvidence+".\n\n";
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO books
      (id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url,full_text_source_url)
      VALUES($1,$2,$3,$4,$5,$6,$7,0,FALSE,$8,NULL,'public_domain',FALSE,$9,$10,$11,$12)
      ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,author=EXCLUDED.author,description=EXCLUDED.description,
      category=EXCLUDED.category,language=EXCLUDED.language,year=EXCLUDED.year,cover_url=EXCLUDED.cover_url,
      source_url=EXCLUDED.source_url,source_license=EXCLUDED.source_license,rights_evidence_url=EXCLUDED.rights_evidence_url,
      full_text_source_url=EXCLUDED.full_text_source_url,rights_status='public_domain'`,
      [BOOK.id,BOOK.title,BOOK.author,"The complete original 1911 book on scientific management, work methods, training, cooperation and productivity.",BOOK.category,BOOK.language,BOOK.year,"/covers/principles-scientific-management.svg",BOOK.source,"Public domain underlying work; author died 1915. Original 1911 text; no modern translation used.",BOOK.rightsEvidence,BOOK.textUrl]);
    await client.query("DELETE FROM book_pages WHERE book_id=$1",[BOOK.id]);
    for(let i=0;i<pages.length;i++) await client.query("INSERT INTO book_pages(book_id,page_number,page_text) VALUES($1,$2,$3)",[BOOK.id,i+1,attribution+pages[i]]);
    await client.query("UPDATE books SET is_published=TRUE,vip_only=FALSE,price_stars=0 WHERE id=$1",[BOOK.id]);
    await client.query("COMMIT");
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
  console.log("Published complete public-domain business book:",JSON.stringify({id:BOOK.id,title:BOOK.title,words,pages:pages.length,characters:chars}));
  return {id:BOOK.id,words,pages:pages.length};
};
