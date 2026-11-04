// Import the complete Project Gutenberg transcription of Barnum's business book.
const BOOK = {
 id:"barnum-art-of-money-getting-en", title:"The Art of Money Getting",
 author:"P. T. Barnum",
 description:"Complete 19th-century business text on earning, saving, integrity, perseverance and money management.",
 category:"business", language:"en", year:1880,
 source:"https://www.gutenberg.org/ebooks/8581",
 text:"https://www.gutenberg.org/cache/epub/8581/pg8581.txt",
 cover:"/covers/barnum-art-of-money-getting.svg"
};
module.exports=async function importBarnum(pool){
 const old=await pool.query("SELECT is_published FROM books WHERE id=$1",[BOOK.id]);
 if(old.rows[0]?.is_published){
  const n=await pool.query("SELECT COUNT(*)::int AS n FROM book_pages WHERE book_id=$1",[BOOK.id]);
  if(n.rows[0].n>=10)return {id:BOOK.id,status:"already-published",pages:n.rows[0].n};
 }
 const response=await fetch(BOOK.text,{headers:{"User-Agent":"Zer0LifeBookClub/1.0"}});
 if(!response.ok)throw new Error("Gutenberg HTTP "+response.status);
 let body=(await response.text()).replace(/^\uFEFF/,"").replace(/\r/g,"").trim();
 if(!body.includes("THE ART OF MONEY GETTING")||!body.includes("P. T. Barnum")||
  !/\*\*\* START OF (THE|THIS) PROJECT GUTENBERG EBOOK/i.test(body)||
  !/\*\*\* END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i.test(body))
  throw new Error("Barnum source identity or complete ebook boundaries failed");
 const start=body.search(/\*\*\* START OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
 body=body.slice(body.indexOf("\n",start)+1);
 const end=body.search(/\*\*\* END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
 body=body.slice(0,end).trim();
 if(body.length<30000)throw new Error("Full text too short: "+body.length);
 const chunks=[];let rest=body;
 while(rest.length){let cut=Math.min(2800,rest.length);if(cut<rest.length){const p=rest.lastIndexOf(" ",cut);if(p>2000)cut=p;}chunks.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();}
 if(chunks.length<10)throw new Error("Insufficient pages: "+chunks.length);
 const db=await pool.connect();
 try{
  await db.query("BEGIN");
  await db.query(`INSERT INTO books
   (id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url,full_text_source_url,rights_checked_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,0,FALSE,$8,$9,'public_domain',FALSE,$10,$11,$10,$9,NOW())
   ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,author=EXCLUDED.author,description=EXCLUDED.description,
   category=EXCLUDED.category,language=EXCLUDED.language,year=EXCLUDED.year,cover_url=EXCLUDED.cover_url,
   content_url=EXCLUDED.content_url,rights_status='public_domain',source_url=EXCLUDED.source_url,
   source_license=EXCLUDED.source_license,rights_evidence_url=EXCLUDED.rights_evidence_url,
   full_text_source_url=EXCLUDED.full_text_source_url,rights_checked_at=NOW(),is_published=FALSE`,
   [BOOK.id,BOOK.title,BOOK.author,BOOK.description,BOOK.category,BOOK.language,BOOK.year,BOOK.cover,BOOK.text,BOOK.source,
    "P. T. Barnum died in 1891; the EU 70-year post-mortem copyright term expired after 1961. Project Gutenberg eBook #8581; source page states public domain in the USA."]);
  await db.query("DELETE FROM book_pages WHERE book_id=$1",[BOOK.id]);
  for(let i=0;i<chunks.length;i++)await db.query("INSERT INTO book_pages(book_id,page_number,page_text) VALUES($1,$2,$3)",[BOOK.id,i+1,chunks[i]]);
  await db.query("UPDATE books SET is_published=TRUE WHERE id=$1",[BOOK.id]);
  await db.query("COMMIT");
 }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
 const result={id:BOOK.id,pages:chunks.length,characters:body.length,source:BOOK.source};
 console.log("Published complete Barnum business book",JSON.stringify(result));return result;
};