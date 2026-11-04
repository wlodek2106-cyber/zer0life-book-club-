// Import the complete 1911 text of Taylor's management book.
// Taylor died in 1915; the author's economic rights expired in the EU after the 70-year post-mortem term.
// Project Gutenberg identifies its transcription as public domain in the USA; retain its required legal notice.
const BOOK = {
  id: "taylor-principles-scientific-management-en",
  title: "The Principles of Scientific Management",
  author: "Frederick Winslow Taylor",
  description: "Complete 1911 book on management principles, productivity, work design and cooperation.",
  category: "business",
  language: "en",
  year: 1911,
  source: "https://www.gutenberg.org/ebooks/6435",
  text: "https://www.gutenberg.org/cache/epub/6435/pg6435.txt",
  cover: "/covers/taylor-scientific-management.svg"
};
module.exports = async function importTaylorManagement(pool) {
  const exists = await pool.query("SELECT is_published FROM books WHERE id=$1", [BOOK.id]);
  if (exists.rows[0]?.is_published) {
    const count = await pool.query("SELECT COUNT(*)::int AS n FROM book_pages WHERE book_id=$1", [BOOK.id]);
    if (count.rows[0].n >= 10) return {id: BOOK.id, status: "already-published", pages: count.rows[0].n};
  }
  const response = await fetch(BOOK.text, {headers: {"User-Agent": "Zer0LifeBookClub/1.0 (full-text public-domain reader)"}});
  if (!response.ok) throw new Error("Project Gutenberg returned HTTP " + response.status);
  let body = (await response.text()).replace(/^\uFEFF/, "").replace(/\r/g, "").trim();
  if (!body.includes("The Principles of Scientific Management") ||
      !body.includes("Frederick Winslow Taylor") ||
      !/\*\*\* START OF (THE|THIS) PROJECT GUTENBERG EBOOK/i.test(body) ||
      !/\*\*\* END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i.test(body)) {
    throw new Error("Source identity or complete ebook boundaries could not be verified");
  }
  body = body.slice(body.search(/\*\*\* START OF (THE|THIS) PROJECT GUTENBERG EBOOK/i));
  body = body.slice(body.indexOf("\n") + 1);
  const end = body.search(/\*\*\* END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  body = body.slice(0, end).trim();
  if (body.length < 30000) throw new Error("Full-text length check failed: " + body.length + " characters");
  const chunks = [];
  let rest = body;
  while (rest.length) {
    let cut = Math.min(3000, rest.length);
    if (cut < rest.length) {
      const boundary = rest.lastIndexOf(" ", cut);
      if (boundary > 2200) cut = boundary;
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (chunks.length < 10) throw new Error("Page-count check failed: " + chunks.length);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO books
      (id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url,full_text_source_url,rights_checked_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,0,FALSE,$8,$9,'public_domain',FALSE,$10,$11,$10,$9,NOW())
      ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,author=EXCLUDED.author,description=EXCLUDED.description,
      category=EXCLUDED.category,language=EXCLUDED.language,year=EXCLUDED.year,cover_url=EXCLUDED.cover_url,
      content_url=EXCLUDED.content_url,rights_status='public_domain',source_url=EXCLUDED.source_url,
      source_license=EXCLUDED.source_license,rights_evidence_url=EXCLUDED.rights_evidence_url,
      full_text_source_url=EXCLUDED.full_text_source_url,rights_checked_at=NOW(),is_published=FALSE`,
      [BOOK.id,BOOK.title,BOOK.author,BOOK.description,BOOK.category,BOOK.language,BOOK.year,BOOK.cover,BOOK.text,BOOK.source,
       "Public domain in the EU: author died 1915; 70-year post-mortem term expired 1986. Source transcription: Project Gutenberg eBook #6435; Gutenberg states public domain in the USA."]);
    await client.query("DELETE FROM book_pages WHERE book_id=$1", [BOOK.id]);
    for (let i=0; i<chunks.length; i++) {
      await client.query("INSERT INTO book_pages(book_id,page_number,page_text) VALUES($1,$2,$3)", [BOOK.id,i+1,chunks[i]]);
    }
    await client.query("UPDATE books SET is_published=TRUE WHERE id=$1", [BOOK.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  console.log("Published complete Taylor business book", JSON.stringify({id:BOOK.id,pages:chunks.length,characters:body.length,source:BOOK.source}));
  return {id:BOOK.id,pages:chunks.length,characters:body.length};
};
