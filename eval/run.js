// Offline search-quality eval: Babylist's current search vs this prototype's
// query understanding + re-ranking (lib/search-core.js, the code the side panel runs).
//
//   node eval/fetch-snapshots.js   # once, saves live API responses to eval/snapshots/
//   node eval/run.js               # computes metrics, writes eval/report.md
//
// Relevance labels are CATEGORY PROXIES written by the author (eval/queries.json):
// a result gets grade 2 if its Babylist category is in relevantCategories, 1 if in
// partialCategories, else 0; anything over the query's price cap gets 0. They are not
// human relevance judgments; review them before quoting any number.
const fs = require("fs");
const path = require("path");
const { parseQuery, rankProducts, parsePrice } = require("../lib/search-core");

const K = 10;
const queries = JSON.parse(fs.readFileSync(path.join(__dirname, "queries.json"), "utf8"));

function loadSnapshot(term) {
  const slug = term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "empty";
  const file = path.join(__dirname, "snapshots", `${slug}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing snapshot for "${term}". Run: node eval/fetch-snapshots.js`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function grade(p, q, maxPrice) {
  if (maxPrice !== null) {
    const price = parsePrice(p);
    if (!(price > 0 && price <= maxPrice)) return 0;
  }
  if ((q.relevantCategories || []).includes(p.category)) return 2;
  if ((q.partialCategories || []).includes(p.category)) return 1;
  return 0;
}

const dcg = (grades) => grades.reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);

function evaluate(q) {
  const parsed = parseQuery(q.q);
  const maxPrice = parsed.maxPrice;

  // System A: Babylist today = raw query, API order.
  const baseline = loadSnapshot(q.q.toLowerCase()).products;
  // System B: prototype = rewritten catalog query + price filter + re-rank (no persona).
  const protoCandidates = loadSnapshot(parsed.catalogQuery.toLowerCase()).products;
  const proto = rankProducts(protoCandidates, {
    lifestyle: "default", strategy: "balanced", registryTitles: [], cleanQuery: parsed.cleanQuery, maxPrice
  }).map((s) => s.p);

  // Ideal ranking pools every candidate either system retrieved, plus results for the
  // query's reference terms (poolQueries), so a system that returns nothing scores 0
  // instead of the query silently dropping out.
  const pool = new Map();
  const refs = (q.poolQueries || []).flatMap((t) => loadSnapshot(t.toLowerCase()).products);
  [...baseline, ...protoCandidates, ...refs].forEach((p) => pool.set(p.id, p));
  const idealGrades = [...pool.values()].map((p) => grade(p, q, maxPrice)).sort((a, b) => b - a).slice(0, K);
  const idcg = dcg(idealGrades);

  const score = (list) => {
    const top = list.slice(0, K);
    const grades = top.map((p) => grade(p, q, maxPrice));
    const top5 = grades.slice(0, 5);
    return {
      n: list.length,
      ndcg: idcg > 0 ? dcg(grades) / idcg : null,
      p5: top.length ? top5.filter((g) => g === 2).length / 5 : 0,
      overPrice: maxPrice !== null && top.length
        ? top.filter((p) => !(parsePrice(p) > 0 && parsePrice(p) <= maxPrice)).length / top.length
        : null,
      top3: top.slice(0, 3).map((p) => `${p.name} [${p.category}${maxPrice !== null ? `, ${p.hero_price}` : ""}]`)
    };
  };

  return { q: q.q, cls: q.class, catalogQuery: parsed.catalogQuery, maxPrice, idcg, base: score(baseline), proto: score(proto) };
}

const results = queries.map(evaluate);
const mean = (xs) => { const v = xs.filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const fmt = (x) => (x === null ? "n/a" : x.toFixed(2));
const classes = [...new Set(results.map((r) => r.cls))];

let md = `# Search quality eval: Babylist search vs prototype\n\n`;
md += `Snapshot of Babylist's public product-search API (\`/api/v3/products\`), ${queries.length} queries, nDCG@${K} and strict P@5.\n\n`;
md += `> **Labels are category proxies written by the author, not human judgments.** A result counts as relevant if its Babylist category matches the query's intent (eval/queries.json). Read the numbers as directional.\n\n`;
md += `- **Babylist**: the raw query sent to the API, in the API's order.\n- **Prototype**: \`lib/search-core.js\`: typo map, price-cap parsing, rule-based rewrite of need-style queries, then re-ranking (no persona).\n\n`;

md += `## By query class\n\n| Class | Queries | nDCG@10 Babylist | nDCG@10 Prototype | P@5 Babylist | P@5 Prototype | Zero results (B / P) |\n|---|---|---|---|---|---|---|\n`;
for (const c of classes) {
  const rs = results.filter((r) => r.cls === c && r.idcg > 0);
  if (!rs.length) continue;
  md += `| ${c} | ${rs.length} | ${fmt(mean(rs.map((r) => r.base.ndcg)))} | ${fmt(mean(rs.map((r) => r.proto.ndcg)))} | ${fmt(mean(rs.map((r) => r.base.p5)))} | ${fmt(mean(rs.map((r) => r.proto.p5)))} | ${rs.filter((r) => r.base.n === 0).length} / ${rs.filter((r) => r.proto.n === 0).length} |\n`;
}
const all = results.filter((r) => r.idcg > 0);
md += `| **all** | ${all.length} | **${fmt(mean(all.map((r) => r.base.ndcg)))}** | **${fmt(mean(all.map((r) => r.proto.ndcg)))}** | ${fmt(mean(all.map((r) => r.base.p5)))} | ${fmt(mean(all.map((r) => r.proto.p5)))} | ${all.filter((r) => r.base.n === 0).length} / ${all.filter((r) => r.proto.n === 0).length} |\n\n`;

const priced = results.filter((r) => r.maxPrice !== null);
md += `## Price constraints\n\nShare of top-${K} results over the stated price cap (or unpriced):\n\n| Query | Babylist results | Babylist over cap | Prototype over cap |\n|---|---|---|---|\n`;
for (const r of priced) md += `| ${r.q} | ${r.base.n} | ${fmt(r.base.overPrice)} | ${fmt(r.proto.overPrice)} |\n`;

const ooc = results.filter((r) => r.cls === "out-of-catalog");
md += `\n## Out-of-catalog queries\n\nIdeal behavior is zero results plus a route to other retailers.\n\n| Query | Babylist results | Top result |\n|---|---|---|\n`;
for (const r of ooc) md += `| ${r.q} | ${r.base.n} | ${r.base.top3[0] || "(none)"} |\n`;

md += `\n## Per query\n\n| Query | Class | Prototype rewrite | nDCG B | nDCG P | Δ |\n|---|---|---|---|---|---|\n`;
for (const r of all) {
  const d = r.proto.ndcg - r.base.ndcg;
  md += `| ${r.q} | ${r.cls} | ${r.catalogQuery === r.q.toLowerCase() ? "–" : `"${r.catalogQuery}"`} | ${fmt(r.base.ndcg)} | ${fmt(r.proto.ndcg)} | ${d > 0.005 ? "+" : ""}${fmt(d)} |\n`;
}

const byDelta = [...all].sort((a, b) => (b.proto.ndcg - b.base.ndcg) - (a.proto.ndcg - a.base.ndcg));
const show = (r) => `- **${r.q}** (${fmt(r.base.ndcg)} → ${fmt(r.proto.ndcg)})\n  - Babylist top 3: ${r.base.top3.join("; ") || "(no results)"}\n  - Prototype top 3: ${r.proto.top3.join("; ") || "(no results)"}\n`;
md += `\n## Biggest wins\n\n${byDelta.slice(0, 4).filter((r) => r.proto.ndcg - r.base.ndcg > 0.005).map(show).join("")}`;
md += `\n## Biggest regressions\n\n${byDelta.slice(-4).reverse().filter((r) => r.proto.ndcg - r.base.ndcg < -0.005).map(show).join("") || "None.\n"}`;

fs.writeFileSync(path.join(__dirname, "report.md"), md);
console.log(md.split("## Per query")[0]);
console.log("Full report: eval/report.md");
