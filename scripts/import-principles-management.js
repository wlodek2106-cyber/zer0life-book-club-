// Import one complete, commercially reusable business textbook from LibreTexts.
// The exact book index and chapter pages carry CC BY 4.0 notices.
// No OpenStax trademarks or cover art are reused; the app serves its own SVG cover.
const BOOK = {
  id: "oer-principles-management-lumen",
  title: "Principles of Management",
  authors: "Lumen Learning",
  category: "business",
  language: "en",
  index: "https://biz.libretexts.org/Courses/Lumen_Learning/Principles_of_Management_%28Lumen%29",
  license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Principles of Management (Lumen), authored and curated by Lumen Learning. Source: Business LibreTexts. Licensed under CC BY 4.0."
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
function hasCCBY4(html) { return /CC BY\s*4\.0/i.test(html) || /creativecommons\.org\/licenses\/by\/4\.0/i.test(html) || /Creative Commons Attribution 4\.0/i.test(html) || /Attribution 4\.0 International/i.test(html); }
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
module.exports = async function importPrinciplesManagement(pool) {
  const indexUrl = BOOK.index;
  const indexHtml = await get(indexUrl);
  if (!hasCCBY4(indexHtml)) {
    throw new Error("Book index did not expose the expected CC BY 4.0 notice");
  }
  const basePath = new URL(indexUrl).pathname.replace(/\/$/, "") + "/";
  // Discover the live chapter links from the book TOC instead of hard-coding
  // MindTouch slugs; the platform's encoded names can change between editions.
  const chapterRoots = extractLinks(indexHtml, indexUrl, basePath).filter(u => {
    const path = decodeURIComponent(new URL(u).pathname);
    return new RegExp("^" + basePath.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\  const moduleSlugs = [
    "01:_Introduction_to_Management","02:_History_of_Management","03:_Planning_and_Mission",
    "04:_Environments_and_Strategic_Management","05:_Decision_Making","06:_Organizational_Structures",
    "07:_Human_Resource_Management","08:_Groups,_Teams,_and_Teamwork","09:_Culture_and_Diversity",
    "10:_Leadership","11:_Motivation","12:_The_Individual_and_the_Organization",
    "13:_Ethics_in_Business","14:_Communication","15:_Control","16:_Globalization_and_Business"
  ];
  const chapterRoots = moduleSlugs.map(slug =>
    new URL(encodeURIComponent(slug), indexUrl.replace(/\/$/, "") + "/").toString()
  );
  const allPages = new Set();
  for (const chapterUrl of chapterRoots) {
    const chapterHtml = await get(chapterUrl);
    const subpages = extractLinks(chapterHtml, chapterUrl, basePath);
    for (const u of subpages) {
      const path = decodeURIComponent(new URL(u).pathname);
      if (/\/\d{1,2}\.\d{1,2}:/.test(path)) allPages.add(u);
    }
  }
") + "\\d{2}:_").test(path);
  });
  if (chapterRoots.length < 12) {
    throw new Error("Expected at least 12 chapter links in the live table of contents; found " + chapterRoots.length);
  }
  const allPages = new Set();
  const visited = new Set(chapterRoots);
  const queue = [...chapterRoots];
  while (queue.length && visited.size < 1200) {
    const current = queue.shift();
    const html = await get(current);
    for (const u of extractLinks(html, current, basePath)) {
      if (visited.has(u)) continue;
      visited.add(u);
      const path = decodeURIComponent(new URL(u).pathname);
      // Section pages are numbered below a chapter (e.g. 1.1, 1.2, 2.1).
      if (/\\/\\d{1,2}\\.\\d{1,2}(?:\\.|:|$)/.test(path)) allPages.add(u);
      // Follow same-book links so nested chapter TOCs are also discovered.
      if (path.startsWith(basePath) && path !== new URL(indexUrl).pathname &&
          path.split("/").length <= new URL(indexUrl).pathname.split("/").length + 3) {
        queue.push(u);
      }
    }
  }
  const ordered = [...allPages].sort((a,b) => a.localeCompare(b));
  const chunks = [];
  let totalChars = 0;
  for (const url of ordered) {
    const html = await get(url);
    if (!hasCCBY4(html)) continue;
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
  const coverUrl = null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO books
      (id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url,full_text_source_url)
      VALUES($1,$2,$3,$4,$5,$6,2023,0,FALSE,$7,$8,'licensed',FALSE,$9,$10,$11,$9)
      ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,author=EXCLUDED.author,description=EXCLUDED.description,
      category=EXCLUDED.category,language=EXCLUDED.language,cover_url=EXCLUDED.cover_url,content_url=EXCLUDED.content_url,
      source_url=EXCLUDED.source_url,source_license=EXCLUDED.source_license,rights_evidence_url=EXCLUDED.rights_evidence_url,
      full_text_source_url=EXCLUDED.full_text_source_url,rights_status='licensed'`,
      [BOOK.id,BOOK.title,BOOK.authors,"Complete 16-module textbook covering planning, decision making, organizational structure, culture, leadership, motivation and communication.",BOOK.category,BOOK.language,coverUrl,indexUrl,BOOK.index,BOOK.license+"; attribution retained on every imported reader page.",BOOK.licenseUrl]);
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
