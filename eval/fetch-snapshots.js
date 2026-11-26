// Fetches Babylist's public product-search API for every query the eval needs and saves
// the raw responses, so metrics are computed offline on a fixed, reproducible snapshot.
//
//   node eval/fetch-snapshots.js          # fetch anything missing
//   node eval/fetch-snapshots.js --force  # refetch everything
//
// For each query it saves the API result for (a) the raw query, which is today's Babylist
// behavior, (b) the prototype's rewritten catalog query from lib/search-core.js, and
// (c) any poolQueries, used only to build the ideal ranking.
const fs = require("fs");
const path = require("path");
const { parseQuery } = require("../lib/search-core");

const API = "https://www.babylist.com/api/v3/products?heroes=true&search_term=";
const SNAP_DIR = path.join(__dirname, "snapshots");
const DELAY_MS = 750; // be polite to a production API

const force = process.argv.includes("--force");
const queries = JSON.parse(fs.readFileSync(path.join(__dirname, "queries.json"), "utf8"));

function snapPath(term) {
  const slug = term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "empty";
  return path.join(SNAP_DIR, `${slug}.json`);
}

async function fetchTerm(term) {
  const file = snapPath(term);
  if (!force && fs.existsSync(file)) return "cached";
  const started = Date.now();
  const res = await fetch(API + encodeURIComponent(term), { headers: { "User-Agent": "Mozilla/5.0" } });
  const latencyMs = Date.now() - started;
  if (!res.ok) throw new Error(`HTTP ${res.status} for "${term}"`);
  const json = await res.json();
  const products = (json?.data?.hero_products || []).map((p) => ({
    id: p.id, brand: p.brand, name: p.name, category: p.category,
    hero_price: p.hero_price, on_sale: p.on_sale, currently_in_active_sale: p.currently_in_active_sale,
    fsa_hsa_eligible: p.fsa_hsa_eligible, rating: p.rating, review_count: p.review_count,
    is_sponsored: p.is_sponsored, hero_path: p.hero_path, description: p.description
  }));
  fs.writeFileSync(file, JSON.stringify({ term, fetchedAt: new Date().toISOString(), latencyMs, products }, null, 1));
  await new Promise((r) => setTimeout(r, DELAY_MS));
  return `${products.length} results`;
}

(async () => {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const terms = new Set();
  for (const { q } of queries) {
    terms.add(q.toLowerCase());
    terms.add(parseQuery(q).catalogQuery.toLowerCase());
  }
  // Reference queries only widen the pool used for the ideal ranking (see run.js).
  for (const { poolQueries = [] } of queries) poolQueries.forEach((t) => terms.add(t.toLowerCase()));
  for (const term of terms) {
    try {
      console.log(`${term.padEnd(42)} ${await fetchTerm(term)}`);
    } catch (err) {
      console.error(`${term.padEnd(42)} FAILED: ${err.message}`);
      process.exitCode = 1;
    }
  }
})();
