// Imports one openly licensed Wolne Lektury work into the free catalogue.
// Usage is through server startup: require("./scripts/import-wolne-lektury")(pool)
module.exports = async function importWolneLektury(pool) {
  const slug = "pan-tadeusz";
  const apiUrl = "https://wolnelektury.pl/api/books/" + slug + "/";
  const headers = {
    Accept: "application/json",
    "User-Agent": "Zer0LifeBookClub/1.0 (Wolne Lektury attribution import)"
  };
  const apiResponse = await fetch(apiUrl, { headers });
  if (!apiResponse.ok) throw new Error("Wolne Lektury API HTTP " + apiResponse.status);
  const payload = await apiResponse.json();
  const book = payload.book || payload;
  const title = book.title;
  const author = (book.author_names || []).join(", ");
  const sourceUrl = book.url;
  const textUrl = book.txt_url;
  const coverUrl = book.cover_url;
  if (!title || !author || !sourceUrl || !textUrl || !coverUrl) {
    throw new Error("Wolne Lektury detail response lacks required book fields");
  }

  const textResponse = await fetch(textUrl, { headers });
  if (!textResponse.ok) throw new Error("Wolne Lektury TXT HTTP " + textResponse.status);
  const body = (await textResponse.text()).replace(/^\uFEFF/, "").replace(/\r/g, "").trim();
  if (body.length < 12000) throw new Error("Full text is too short; publication refused");

  // Keep the source-provided legal notice verbatim at the end of the text.
  const footer = body.slice(-16000);
  const licencePattern = /(Creative Commons[^\n]{0,240}|CC BY(?:-SA)?[^\n]{0,240}|CC0[^\n]{0,240}|domena publiczna[^\n]{0,240}|public domain[^\n]{0,240})/i;
  const licenceMatch = footer.match(licencePattern);
  if (!licenceMatch) throw new Error("No explicit licence/public-domain statement found in source text; refusing import");

  const chunks = [];
  let remaining = body;
  while (remaining.length) {
    let cut = Math.min(2800, remaining.length);
    if (cut < remaining.length) {
      const boundary = remaining.lastIndexOf(" ", cut);
      if (boundary > cut * 0.65) cut = boundary;
    }
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (chunks.length < 5) throw new Error("Not enough full-text pages");

  const id = "pl-wolne-" + slug;
  const attribution = "Książka pochodzi z serwisu Wolne Lektury. Źródło: " + sourceUrl +
    ". Licencja: " + licenceMatch[0] +
    ". Pełna nota licencyjna i źródłowa zachowana w oryginalnym tekście.";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO books
       (id,title,author,description,category,language,year,price_stars,vip_only,cover_url,content_url,rights_status,is_published,source_url,source_license,rights_evidence_url)
       VALUES($1,$2,$3,$4,'personal','pl',1834,0,FALSE,$5,$6,'public_domain',FALSE,$6,$7,$6)
       ON CONFLICT(id) DO UPDATE SET
       title=EXCLUDED.title,author=EXCLUDED.author,description=EXCLUDED.description,
       cover_url=EXCLUDED.cover_url,content_url=EXCLUDED.content_url,source_url=EXCLUDED.source_url,
       source_license=EXCLUDED.source_license,rights_evidence_url=EXCLUDED.rights_evidence_url,
       rights_status='public_domain'`,
      [id, title, author, attribution, coverUrl, textUrl, licenceMatch[0].slice(0, 500)]
    );
    const rights = await client.query("SELECT rights_status FROM books WHERE id=$1 FOR UPDATE", [id]);
    if (!rights.rows[0] || rights.rows[0].rights_status !== "public_domain") {
      throw new Error("Rights status did not pass verification");
    }
    await client.query("DELETE FROM book_pages WHERE book_id=$1", [id]);
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        "INSERT INTO book_pages(book_id,page_number,page_text) VALUES($1,$2,$3)",
        [id, i + 1, chunks[i]]
      );
    }
    await client.query(
      "UPDATE books SET is_published=TRUE,full_text_source_url=$2 WHERE id=$1",
      [id, sourceUrl]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  console.log("Wolne Lektury full text published:", JSON.stringify({
    id, title, author, pages: chunks.length, characters: body.length,
    source: sourceUrl, cover: coverUrl, licence: licenceMatch[0]
  }));
};
