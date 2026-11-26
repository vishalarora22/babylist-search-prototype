// Search core: query understanding + re-ranking used by the side panel's Universal Search.
// Pure functions, no DOM or chrome.* APIs, so the same code runs in the extension
// (window.BLSearchCore) and in the offline eval harness (Node: require("./lib/search-core")).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BLSearchCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LIFESTYLE_RULES = {
    urban: {
      label: "Urban / Walk-Up",
      keywords: ["compact", "lightweight", "yoyo", "butterfly", "minu", "metro", "trvl", "joolz", "aer", "fold", "travel", "ergobaby", "city", "slim", "clic"],
      negative: ["wagon", "double", "duet", "jogger", "expedition"],
      reason: "Compact / Lightweight for Walk-Ups"
    },
    travel: {
      label: "Frequent Flyer",
      keywords: ["travel", "compact", "overhead", "cabin", "yoyo", "butterfly", "joolz", "aer", "minu", "fold", "portable", "pack", "lite", "clic"],
      negative: ["wagon", "crib", "dresser"],
      reason: "Travel & Overhead-Bin Friendly"
    },
    twins: {
      label: "Twins / Siblings",
      keywords: ["double", "twin", "duo", "vista", "donkey", "gazelle", "wagon", "tandem", "two", "convertible", "second seat", "rumble"],
      negative: ["mini", "single-only"],
      reason: "Multi-Child / Expandable"
    },
    budget: {
      label: "Budget & Value",
      keywords: ["graco", "evenflo", "chicco", "kolcraft", "safety 1st", "summer", "value", "essential"],
      negative: [],
      reason: "High Value / Budget Match"
    },
    fsa: {
      label: "FSA / HSA Eligible",
      keywords: ["pump", "spectra", "elvie", "willow", "medela", "momcozy", "monitor", "owlet", "nanit", "thermometer", "nasal", "humidifier"],
      negative: [],
      reason: "FSA / HSA Eligible"
    }
  };

  const STAGE_LABELS = {
    expecting_t2: "Expecting (2nd Tri)",
    newborn: "Newborn (0–3m)",
    infant: "Infant (3–9m)",
    toddler: "Toddler (9m+)"
  };

  // Whole-query typo map (a small hand-written list, not a spelling model).
  const TYPO_FIXES = {
    stroler: "stroller",
    strollers: "stroller",
    pacifire: "pacifier",
    pacifires: "pacifier",
    carseat: "car seat",
    carseats: "car seat",
    matress: "mattress",
    bottel: "bottle",
    bottels: "bottle",
    diper: "diaper",
    moniter: "monitor"
  };

  // Rule-based rewrite of need-style queries ("best stroller for urban family") into
  // catalog terms, then stop-word removal.
  function normalizeConversationalCatalogQuery(cleanQuery) {
    const lower = cleanQuery.toLowerCase();
    if (/best\s+stroller|urban|walk-up|subway/.test(lower) && lower.includes("stroller")) {
      return "compact stroller";
    }
    if (/double|twin/.test(lower) && lower.includes("stroller")) {
      return "double stroller";
    }
    if (/colic|reflux|gas/.test(lower) && /bottle|feed/.test(lower)) {
      return "anti-colic bottle";
    }
    const stopWords = new Set(["best", "good", "top", "for", "a", "an", "the", "my", "our", "with", "need", "want", "looking", "family", "urban", "small", "cheap"]);
    const words = lower.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
    return words.length > 0 ? words.join(" ") : cleanQuery;
  }

  function parsePrice(p) {
    return parseFloat(String(p.hero_price || p.heroPrice || "").replace(/[^0-9.]/g, "")) || 0;
  }

  // Raw user text → what we send to the catalog API, plus extracted constraints.
  function parseQuery(rawQuery) {
    const raw = String(rawQuery || "").trim() || "stroller";
    let query = raw.toLowerCase();
    let typoFixedFrom = null;
    if (TYPO_FIXES[query]) {
      typoFixedFrom = raw;
      query = TYPO_FIXES[query];
    }
    const priceMatch = query.match(/(?:under|below|<)\s*\$?(\d+)/i);
    const maxPrice = priceMatch ? parseInt(priceMatch[1], 10) : null;
    const cleanQuery = priceMatch ? query.replace(priceMatch[0], "").trim() : query;
    const catalogQuery = normalizeConversationalCatalogQuery(cleanQuery || "stroller");
    return { raw, query, typoFixedFrom, maxPrice, cleanQuery, catalogQuery };
  }

  // Re-rank catalog results. Score = position prior × lifestyle boost × registry boost.
  // opts: { lifestyle, strategy: "balanced" | "price", registryTitles: string[], cleanQuery, maxPrice }
  function rankProducts(products, opts) {
    const lifestyle = opts.lifestyle || "default";
    const strategy = opts.strategy || "balanced";
    const rule = LIFESTYLE_RULES[lifestyle];
    const registryTitles = (opts.registryTitles || []).map(t => String(t || "").toLowerCase());
    const hasVista = registryTitles.some(t => t.includes("vista"));
    const cleanQuery = opts.cleanQuery || "";
    const maxPrice = opts.maxPrice ?? null;

    const scored = products
      .filter(p => {
        if (maxPrice === null) return true;
        const pn = parsePrice(p);
        return pn > 0 && pn <= maxPrice; // unpriced items can't satisfy a price cap
      })
      .map((p, idx) => {
        const text = `${p.brand || ""} ${p.name || ""} ${p.category || ""} ${p.description || ""}`.toLowerCase();
        const priceNum = parsePrice(p);

        const matchScore = Math.max(0.5, 1.0 - idx * 0.01); // prior from the API's own order
        let lifestyleBoost = 1.0;
        let registryBoost = 1.0;
        const reasons = [];

        if (rule && lifestyle !== "default") {
          const hits = rule.keywords.filter(k => text.includes(k)).length;
          const negs = rule.negative.filter(k => text.includes(k)).length;
          if (hits > 0) {
            lifestyleBoost += hits * 0.25;
            reasons.push(rule.reason);
          }
          if (negs > 0) lifestyleBoost = Math.max(0.5, lifestyleBoost - negs * 0.3);
          if (lifestyle === "budget" && (p.on_sale || p.currently_in_active_sale || (priceNum > 0 && priceNum < 300))) {
            lifestyleBoost += 0.35;
            reasons.unshift((p.on_sale || p.currently_in_active_sale) ? "On Sale" : "Under $300");
          }
          if (lifestyle === "fsa" && (p.fsa_hsa_eligible || p.fsaHsaEligible)) {
            lifestyleBoost += 0.8;
            reasons.unshift("FSA / HSA Eligible");
          }
        }

        const alreadyOnReg = registryTitles.some(rt => rt && text.includes(rt.split(" ").slice(0, 2).join(" ")));
        if (alreadyOnReg) {
          registryBoost = 0.8;
          reasons.push("✓ Already on Registry");
        } else if (hasVista && cleanQuery.includes("stroller") && /travel|compact|yoyo|butterfly|minu|adapter|cup|board/.test(text)) {
          registryBoost = 1.3;
          reasons.push("Complements Your Vista V3");
        }

        const finalScore = Number((matchScore * lifestyleBoost * registryBoost).toFixed(2));
        return {
          p, priceNum,
          matchScore: matchScore.toFixed(2),
          lifestyleBoost: lifestyleBoost.toFixed(2),
          registryBoost: registryBoost.toFixed(2),
          finalScore, reasons, alreadyOnReg
        };
      });

    if (strategy === "price") scored.sort((a, b) => (a.priceNum || Infinity) - (b.priceNum || Infinity));
    else scored.sort((a, b) => b.finalScore - a.finalScore); // stable: ties keep API order
    return scored;
  }

  return {
    LIFESTYLE_RULES, STAGE_LABELS, TYPO_FIXES,
    normalizeConversationalCatalogQuery, parsePrice, parseQuery, rankProducts
  };
});
