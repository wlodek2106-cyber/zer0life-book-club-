// Import one complete, commercially reusable business textbook from LibreTexts.
// The exact book index and chapter pages carry CC BY 4.0 notices.
// No OpenStax trademarks or cover art are reused; the app serves its own SVG cover.
const BOOK = {
  id: "oer-entrepreneurship-openstax",
  title: "Entrepreneurship",
  authors: "Michael Laverty and Chris Littel et al. (OpenStax)",
  category: "business",
  language: "en",
  index: "https://biz.libretexts.org/Bookshelves/Business/Entrepreneurship/Entrepreneurship_(OpenStax)",
  license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Entrepreneurship by Michael Laverty and Chris Littel et al., OpenStax. Available for free at openstax.org. Licensed under CC BY 4.0."
};

function decodeHtml(s) {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
function plainText(html) {
  return decodeHtml(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\u00a0]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}
function extractLinks(html, base, prefix) {
  const links = new Set();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(decodeHtml(m[1]), base);
      u.hash = "";
      if (u.hostname === "biz.libretexts.org" && u.pathname.startsWith(prefix) &&
          !/\.(pdf|jpg|jpeg|png|svg|zip)$/i.test(u.pathname)) links.add(u.toString());
    } catch {}
  }
  return [...links];
}
async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Zer0LifeBookClub/1.0 (CC BY 4.0 OER reader)", Accept: "text/html" } });
  if (!r.ok) throw new Error("LibreTexts HTTP " + r.status + " for " + url);
  return r.text();
}
function makePages(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  const pages = [];
  let rest = clean;
  while (rest.length) {
    let cut = Math.min(3600, rest.length);
    if (cut < rest.length) {
      const p = rest.lastIndexOf(" ", cut);
      if (p > 2500) cut = p;
    }
    pages.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return pages;
}
module.exports = async function importEntrepreneurship(pool) {
  const indexUrl = BOOK.index;
  const indexHtml = await get(indexUrl);
  if (!/CC BY\s*4\.0/i.test(indexHtml) && !/creativecommons\.org\/licenses\/by\/4\.0/i.test(indexHtml) && !/Creative Commons Attribution 4\.0/i.test(indexHtml)) {
    throw new Error("Book index did not expose the expected CC BY 4.0 notice");
  }
  const basePath = new URL(indexUrl).pathname.replace(/\/$/, "") + "/";
  const firstLevel = extractLinks(indexHtml, indexUrl, basePath);
  const chapterRoots = firstLevel.filter(u => /\/(?:\d{2}%3A|\d{2}:|\d{2}%3a)/i.test(new URL(u).pathname));
  if (chapterRoots.length < 10) throw new Error("Expected 15 chapter links; found " + chapterRoots.length);
  const allPages = new Set();
  for (const chapterUrl of chapterRoots) {
    allPages.add(chapterUrl);
    const chapterHtml = await get(chapterUrl);
    const subpages = extractLinks(chapterHtml, chapterUrl, basePath);
    for (const u of subpages) {
      if (u !== chapterUrl && /\/\d{2}\.\d{2}%3A|\/\d{2}\.\d{2}:/i.test(new URL(u).pathname)) allPages.add(u);
    }
  }
  const ordered = [...allPages].sort((a,b) => a.localeCompare(b));
  const chunks = [];
  let totalChars = 0;
  for (const url of ordered) {
    const html = await get(url);
    if (!/CC BY 4\.0 license/i.test(html) && !/shared under a CC BY 4\.0 license/i.test(html)) continue;
    const text = plainText(html);
    if (text.length < 900) continue;
    const content = BOOK.attribution + " Source chapter: " + url + ". " + text;
    const parts = makePages(content);
    chunks.push(...parts);
    totalChars += text.length;
  }
  if (chunks.length < 15 || totalChars < 50000) {
    throw new Error("Full-text validation failed: " + chunks.length + " pages, " + totalChars + " source characters");
  }
  const coverUrl = "/covers/entrepreneurship-openstax.svg";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO books
      (id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url,full_text_source_url)
      VALUES($1,$2,$3,$4,$5,$6,2020,0,FALSE,$7,$8,'licensed',FALSE,$9,$10,$11,$9)
      ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,author=EXCLUDED.author,description=EXCLUDED.description,
      category=EXCLUDED.category,language=EXCLUDED.language,cover_url=EXCLUDED.cover_url,content_url=EXCLUDED.content_url,
      source_url=EXCLUDED.source_url,source_license=EXCLUDED.source_license,rights_evidence_url=EXCLUDED.rights_evidence_url,
      full_text_source_url=EXCLUDED.full_text_source_url,rights_status='licensed'`,
      [BOOK.id,BOOK.title,BOOK.authors,"Complete 15-chapter textbook covering opportunity discovery, pitching, marketing, finance, business models, legal structure and growth.",BOOK.category,BOOK.language,coverUrl,indexUrl,BOOK.index,BOOK.license+"; attribution retained on every imported reader page.",BOOK.licenseUrl]);
    const rights = await client.query("SELECT rights_status FROM books WHERE id=$1 FOR UPDATE",[BOOK.id]);
    if (rights.rows[0]?.rights_status !== "licensed") throw new Error("Licence state not approved");
    await client.query("DELETE FROM book_pages WHERE book_id=$1",[BOOK.id]);
    for (let i=0;i<chunks.length;i++) {
      await client.query("INSERT INTO book_pages(book_id,page_number,page_text) VALUES($1,$2,$3)",[BOOK.id,i+1,chunks[i]]);
    }
    await client.query("UPDATE books SET is_published=TRUE,vip_only=FALSE,price_stars=0 WHERE id=$1",[BOOK.id]);
    await client.query("COMMIT");
  } catch(e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
  console.log("Published complete business textbook:",JSON.stringify({id:BOOK.id,title:BOOK.title,chapters:chapterRoots.length,sourcePages:ordered.length,readerPages:chunks.length,characters:totalChars,license:BOOK.license}));
  return {id:BOOK.id,readerPages:chunks.length,characters:totalChars};
};
