# Babylist Search: Prototype + Search-Quality Eval

An **unofficial** prototype, not affiliated with or endorsed by Babylist, built by Vishal Arora to explore the problems in Babylist's [Staff Software Engineer, Search posting](https://job-boards.greenhouse.io/babylist/jobs/6241534004): in-house search, universal (multi-retailer) search, registry-aware ranking, conversational search with Addie, and evals that catch "confidently wrong" output.

It has two parts:

1. **A search-quality eval** (`eval/`): 40 queries run against Babylist's public product-search API, comparing the catalog results at the time of evaluation with this prototype's query understanding and re-ranking. **Start here.**
2. **A Chrome extension** that shows the ideas on babylist.com and partner retailers.

---

## 1. Search quality in the captured evaluation

`node eval/fetch-snapshots.js && node eval/run.js` fetches a fresh catalog snapshot and writes [`eval/report.md`](eval/report.md). The checked-in report is from the original snapshot. A fresh run may produce different results as the catalog changes.

| Query class | Queries | nDCG@10 Babylist | nDCG@10 Prototype |
|---|---|---|---|
| Head terms ("crib", "car seat") | 10 | 0.96 | 0.96 |
| Specific ("convertible car seat") | 6 | 0.90 | 0.90 |
| Need-based ("stroller for twins") | 8 | 0.39 | 0.63 |
| Price-constrained ("crib under $300") | 6 | 0.09 | 0.84 |
| Typos ("carseat", "hihg chair") | 8 | 0.76 | 0.79 |
| **All** | 38 | **0.65** | **0.83** |

**Findings from the snapshot**
- **Price constraints are treated as keywords.** `crib under $300` and `baby monitor under $100` each return one result, a *Nanit Floor Stand* (monitor accessory). For `car seat under $150`, the top 3 are a cash fund, a $680 seat and a $170 seat. 70% of the top 10 are over the cap.
- **Need-style queries collapse.** `best stroller for urban family` returns 2 results (a bassinet attachment and a double stroller). `what do I need for feeding a newborn` returns nothing.
- **Head terms are strong.** Plain product terms score 0.90–1.00, and common misspellings (`stroler`, `bottel`, `moniter`) are already handled.
- **Accessories outrank products for modifier queries.** The #1 result for `compact stroller` is a stroller *bag*. The prototype doesn't fix this either; it needs category-intent ranking.
- **Out-of-catalog queries can produce lexical false positives.** `lawn mower` returns the Boon *Lawn* drying rack. Ideal behavior: no results, plus a route to other retailers (universal registry).
- **Transposition typos fail.** `hihg chair` returns zero results in both systems.

**Caveats (read before quoting numbers)**
- **Labels are category proxies I wrote, not human judgments.** A result is relevant if its Babylist category matches the query intent. They live in `eval/queries.json` for review.
- **The prototype's gains come from hand-written rules** (price parsing, a typo map, a few rewrite rules) written while looking at these queries. Expect smaller gains on unseen queries. The rewrite also *hurts* one query (`lightweight stroller for travel`, 0.93 → 0.84).
- **One snapshot, 40 queries.** The next step is human-judged queries sampled from real logs, then online interleaving or A/B tests.

## 2. What the prototype actually does

| Area | Implementation | Limits |
|---|---|---|
| Query understanding | `lib/search-core.js`: whole-query typo map, `under $X` → price filter, rule-based rewrite of need queries ("…twins" → "double stroller") | Hand-written rules; no learned model |
| Ranking | Babylist API order as a prior × keyword-based lifestyle boost × registry boost (e.g. de-boost items already registered) | Keyword matching, not learned relevance |
| Babylist.com search pages | Re-orders result cards for a parent profile, adds guide links, routes zero-result queries to other retailers | Client-side only |
| Ask Addie drawer | Conversational queries → rewritten catalog query → ranked product carousel | Template copy, no LLM |
| Side panel "Addie" | Chrome built-in AI (Gemini Nano) when available, with a canned fallback | Prompted not to guess car seat compatibility; there's no compatibility database |
| Retailer capture | Reads product data (JSON-LD/DOM) on Amazon, Target, Walmart and IKEA | Selectors may drift |
| Add to registry | Opens Babylist's own *Add to Babylist* form (the same `/bookmarklet/` page their retailer button uses), with an **experimental** auto-submit | Relies on Babylist's internal form; not an official API |

The side panel's search and the eval use **the same code** (`lib/search-core.js`), so the eval measures what the extension ships.

## 3. What I'd build for real in-house search

1. **Query understanding as a model, not rules:** intent and category classification, attribute and constraint extraction (price, age, size), spelling correction from query logs.
2. **Hybrid retrieval:** BM25 plus embeddings (Weaviate is already in the stack), with category-intent filters so accessories don't outrank products.
3. **Learning-to-rank** on engagement and registry-add signals, with personalization features (registry contents, stage, lifestyle) instead of fixed boosts.
4. **Universal search:** one index across Babylist Shop, other retailers' items, guides and registries, with explicit 1P/3P blending.
5. **Evals as infrastructure:** a judged query set by class, offline metrics in CI, online interleaving, plus LLM-answer checks for Addie (grounding, refusing to guess compatibility).

## Running it

- **Eval:** Node 18+. `node eval/fetch-snapshots.js` (polite, cached), then `node eval/run.js`.
- **Extension:** `chrome://extensions` → Developer mode → Load unpacked → this folder. After reloading the extension, refresh open Babylist or retailer tabs.
- **Chrome built-in AI (optional):** enable `chrome://flags/#prompt-api-for-gemini-nano` and `chrome://flags/#optimization-guide-on-device-model`, then relaunch. Without it, Addie uses canned answers and the badge shows *Fallback Mode*.
