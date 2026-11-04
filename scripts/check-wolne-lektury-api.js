// Read-only smoke check for the official Wolne Lektury API.
// Run with: node scripts/check-wolne-lektury-api.js
// This verifies the JSON response shape and full-text/cover links without publishing content.
const slug = process.argv[2] || "pan-tadeusz";
const url = new URL("https://wolnelektury.pl/api/books/" + encodeURIComponent(slug) + "/");
url.searchParams.set("format", "json");

async function main() {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Zer0LifeBookClub/1.0 (API compatibility check)" }
  });
  if (!response.ok) throw new Error("API HTTP " + response.status);
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("json")) throw new Error("Expected JSON, received " + (type || "unknown content type"));
  const payload = await response.json();
  const book = payload.book || payload;
  const result = {
    slug: book.slug || slug,
    title: book.title || null,
    authors: book.author_names || [],
    source_page: book.url || null,
    text_url: book.txt_url || null,
    cover_url: book.cover_url || null,
    language: book.language || null
  };
  if (!result.title || !result.source_page || !result.text_url || !result.cover_url) {
    throw new Error("Book metadata is incomplete: " + JSON.stringify(result));
  }
  const textResponse = await fetch(result.text_url, {
    headers: { "User-Agent": "Zer0LifeBookClub/1.0 (API compatibility check)" }
  });
  if (!textResponse.ok) throw new Error("TXT HTTP " + textResponse.status);
  const text = (await textResponse.text()).replace(/^\\uFEFF/, "").trim();
  result.text_characters = text.length;
  result.full_text_candidate = text.length >= 12000;
  console.log(JSON.stringify(result, null, 2));
  if (!result.full_text_candidate) process.exitCode = 2;
}
main().catch(error => {
  console.error("Wolne Lektury API check failed:", error.message);
  process.exitCode = 1;
});
