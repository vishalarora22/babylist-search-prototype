// Babylist Personalized Universal Search & External Store Capture Content Script

(function () {
  const hostname = window.location.hostname;

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
      reason: "Multi-Child / Modular Expandable"
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

  const TYPO_MAP = {
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

  // After the extension is reloaded/updated, this copy of the script keeps running in
  // already-open tabs but every chrome.* call throws "Extension context invalidated".
  // Detect that, stop our timers and remove our UI (the new copy takes over on page reload).
  const timers = [];
  function extAlive() {
    try { return Boolean(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }
  function teardownIfOrphaned() {
    if (extAlive()) return false;
    timers.forEach(clearInterval);
    timers.length = 0;
    ["bl-universal-sidepanel-launcher", "bl-header-ask-addie", "bl-personalized-bar",
      "bl-inpage-drawer", "bl-external-capture-widget", "bl-add-overlay", "bl-add-toast"]
      .forEach((id) => document.getElementById(id)?.remove());
    return true;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatProductName(brand, name) {
    const b = (brand || "").trim();
    let n = (name || "").trim();
    if (!b) return n;
    const escapedB = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    n = n.replace(new RegExp(`^(${escapedB}\\s+)+`, "i"), `${b} `);
    if (n.toLowerCase().startsWith(b.toLowerCase())) return n;
    return `${b} ${n}`;
  }

  function scoreProductForProfile(apiItem, text, searchTerm, parentProfile, registryTitles, hasVistaOnRegistry) {
    const rule = LIFESTYLE_RULES[parentProfile.lifestyle];
    let score = 0;
    const reasons = [];

    const alreadyRegistered = registryTitles.some(rt => rt && text.includes(rt.split(" ").slice(0, 2).join(" ")));
    if (alreadyRegistered) score -= 5;

    if (rule && parentProfile.lifestyle !== "default") {
      let posHits = 0;
      for (const kw of rule.keywords) {
        if (text.includes(kw)) posHits++;
      }
      let negHits = 0;
      for (const nkw of rule.negative) {
        if (text.includes(nkw)) negHits++;
      }
      if (posHits > 0) {
        score += posHits * 25;
        reasons.push(`✨ ${rule.reason}`);
      }
      if (negHits > 0) score -= negHits * 30;
      if (parentProfile.lifestyle === "budget") {
        const priceStr = String(apiItem?.hero_price || apiItem?.heroPrice || "999").replace(/[^0-9.]/g, "");
        const priceNum = parseFloat(priceStr) || 999;
        if (apiItem?.on_sale || apiItem?.currently_in_active_sale) {
          score += 30;
          reasons.unshift("🏷️ On Sale");
        }
        if (priceNum > 0 && priceNum < 300) {
          score += 25;
          reasons.unshift("💰 Under $300");
        }
      }
      if (parentProfile.lifestyle === "fsa" && (apiItem?.fsa_hsa_eligible || apiItem?.fsaHsaEligible)) {
        score += 60;
        reasons.unshift("🏥 FSA / HSA Eligible");
      }
    }

    if (!alreadyRegistered && hasVistaOnRegistry && searchTerm.toLowerCase().includes("stroller") && /adapter|board|cup|rain|travel|yoyo|minu|butterfly/.test(text)) {
      score += 35;
      reasons.push("🎯 Complements Your Vista V3");
    }

    if (apiItem) {
      const revCount = apiItem.review_count ?? apiItem.reviewCount ?? 0;
      if (apiItem.rating >= 4.6 && revCount >= 30) {
        score += 15;
        if (reasons.length === 0) reasons.push(`⭐ ${apiItem.rating} (${revCount})`);
      }
    }

    return { score, reasons, alreadyRegistered };
  }

  // ============================================================================
  // PART 1: EXTERNAL STORE 1-CLICK CAPTURE (Amazon, Target, Walmart, IKEA)
  // ============================================================================
  function initExternalStoreCapture() {
    const refreshWidget = () => {
      const product = extractExternalProductMetadata();
      const existing = document.getElementById("bl-external-capture-widget");
      if (existing && existing.dataset.productUrl === product?.url && existing.dataset.productTitle === product?.title) return;
      existing?.remove();
      if (product && product.title) injectExternalCaptureWidget(product);
    };
    setTimeout(refreshWidget, 1200);

    // Target/Walmart navigate client-side without reloading, so re-read the product
    // whenever the URL changes instead of keeping the first page's widget.
    let prevHref = window.location.href;
    timers.push(setInterval(() => {
      if (teardownIfOrphaned()) return;
      if (window.location.href === prevHref) return;
      prevHref = window.location.href;
      document.getElementById("bl-external-capture-widget")?.remove();
      setTimeout(refreshWidget, 1200);
    }, 1000));
  }

  function extractExternalProductMetadata() {
    let title = "";
    let price = "";
    let image = "";
    let storeName = "Online Store";

    const ldJsonTags = document.querySelectorAll('script[type="application/ld+json"]');
    for (const tag of ldJsonTags) {
      try {
        const data = JSON.parse(tag.textContent);
        const p = Array.isArray(data) ? data.find(d => d?.["@type"] === "Product") : (data?.["@type"] === "Product" ? data : null);
        if (p) {
          title = p.name || title;
          if (p.offers) {
            const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
            const rawPrice = offer?.price ?? offer?.lowPrice;
            if (rawPrice !== undefined && rawPrice !== null && rawPrice !== "") {
              price = String(rawPrice).startsWith("$") ? String(rawPrice) : `$${rawPrice}`;
            }
          }
          if (p.image) {
            const imgObj = Array.isArray(p.image) ? p.image[0] : p.image;
            image = typeof imgObj === "string" ? imgObj : (imgObj?.contentUrl || imgObj?.url || "");
          }
        }
      } catch (e) {}
    }

    if (hostname.includes("amazon.com")) {
      storeName = "Amazon";
      title = title || document.getElementById("productTitle")?.innerText?.trim();
      price = price || document.querySelector(".a-price .a-offscreen")?.innerText?.trim() ||
                       document.querySelector("#priceblock_ourprice")?.innerText?.trim();
      image = image || document.querySelector("#landingImage")?.src;
    } else if (hostname.includes("target.com")) {
      storeName = "Target";
      title = title || document.querySelector("[data-test='product-title']")?.innerText?.trim();
      price = price || document.querySelector("[data-test='product-price']")?.innerText?.trim();
      image = image || document.querySelector("img[alt*='product']")?.src;
    } else if (hostname.includes("walmart.com")) {
      storeName = "Walmart";
      title = title || document.querySelector("h1[itemprop='name']")?.innerText?.trim();
      price = price || document.querySelector("[itemprop='price']")?.innerText?.trim();
    } else if (hostname.includes("ikea.com")) {
      storeName = "IKEA";
      title = title || document.querySelector(".pip-header-section__title--big")?.innerText?.trim();
      price = price || document.querySelector(".pip-temp-price__sr-text")?.innerText?.trim();
    }

    if (!title) return null;

    return {
      title: title.slice(0, 120),
      price: price || "$--",
      image: image || "",
      url: window.location.href,
      store: storeName
    };
  }

  function injectExternalCaptureWidget(product) {
    if (document.getElementById("bl-external-capture-widget")) return;

    const widget = document.createElement("div");
    widget.id = "bl-external-capture-widget";
    widget.className = "bl-capture-floating";
    widget.dataset.productUrl = product.url;
    widget.dataset.productTitle = product.title;
    widget.innerHTML = `
      <div class="bl-capture-header">
        <span class="bl-logo-dot">👶</span>
        <strong>Add to Babylist</strong>
        <span class="bl-store-tag">${escapeHtml(product.store)}</span>
      </div>
      <div class="bl-capture-body">
        <div class="bl-product-name">${escapeHtml(product.title)}</div>
        <div class="bl-price-row">
          <span class="bl-price-badge">${escapeHtml(product.price)}</span>
          <span class="bl-compare-note">Babylist Universal Registry</span>
        </div>
        <button type="button" id="bl-confirm-add-btn" class="bl-capture-btn">
          ✨ Add to My Babylist Registry
        </button>
        <div id="bl-capture-msg" class="bl-success-msg" style="display:none;"></div>
      </div>
    `;

    document.body.appendChild(widget);

    document.getElementById("bl-confirm-add-btn")?.addEventListener("click", async () => {
      // The overlay adds it to the real registry and shows its own status toast.
      showBabylistAddOverlay(product);
    });
  }

  // ============================================================================
  // PART 2: LIVE PERSONALIZED SEARCH & UNIVERSAL ENGINE ON BABYLIST.COM
  // ============================================================================
  let lastRunKey = "";
  let personalizeSeq = 0;
  let cachedApiProducts = {};
  let cachedGuides = {};

  function initBabylistPersonalization() {
    injectFloatingPill();
    injectHeaderAskAddie();
    checkAndPersonalizeSearch();

    let prevHref = window.location.href;
    timers.push(setInterval(() => {
      if (teardownIfOrphaned()) return;
      injectHeaderAskAddie();
      const hasSearchTerm = new URLSearchParams(window.location.search).has("search_term");
      if (window.location.href !== prevHref) {
        prevHref = window.location.href;
        lastRunKey = "";
        setTimeout(() => {
          injectHeaderAskAddie();
          checkAndPersonalizeSearch();
        }, 600);
      } else if (window.location.pathname.includes("/store") && hasSearchTerm && !document.getElementById("bl-personalized-bar")) {
        checkAndPersonalizeSearch();
      }
    }, 800));

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && (changes.parentProfile || changes.savedRegistryItems)) {
          lastRunKey = "";
          checkAndPersonalizeSearch();
        }
      });
    }
  }

  async function getStorageState() {
    const defaults = {
      parentProfile: { lifestyle: "urban", stage: "expecting_t2" },
      savedRegistryItems: []
    };
    if (!extAlive() || !chrome?.storage?.local) return defaults;
    let data;
    try {
      data = await chrome.storage.local.get(["parentProfile", "savedRegistryItems"]);
    } catch (e) {
      // Extension was reloaded mid-call; this script copy is orphaned.
      teardownIfOrphaned();
      return defaults;
    }
    return {
      parentProfile: data.parentProfile || { lifestyle: "urban", stage: "expecting_t2" },
      savedRegistryItems: data.savedRegistryItems || []
    };
  }

  async function fetchBabylistContext(searchTerm) {
    if (!searchTerm) return { products: [], guides: [] };
    if (!cachedApiProducts[searchTerm]) {
      try {
        const res = await fetch(`${window.location.origin}/api/v3/products?heroes=true&search_term=${encodeURIComponent(searchTerm)}`);
        if (res.ok) {
          const json = await res.json();
          cachedApiProducts[searchTerm] = json?.data?.hero_products || json?.data?.heroProducts || [];
        } else {
          return { products: [], guides: [] };
        }
      } catch (e) {
        return { products: [], guides: [] };
      }
    }
    if (!cachedGuides[searchTerm]) {
      try {
        const res = await fetch(`${window.location.origin}/api/v3/search?q=${encodeURIComponent(searchTerm)}&event_location=Store`);
        if (res.ok) {
          const json = await res.json();
          const items = json?.results || [];
          let inGuides = false;
          const guides = [];
          for (const item of items) {
            if (item.type === "section_heading") {
              inGuides = (item.title === "Guides");
            } else if (inGuides && item.type === "suggested_result_text") {
              guides.push(item);
            }
          }
          cachedGuides[searchTerm] = guides.slice(0, 3);
        }
      } catch (e) {}
    }
    return {
      products: cachedApiProducts[searchTerm] || [],
      guides: cachedGuides[searchTerm] || []
    };
  }

  async function checkAndPersonalizeSearch() {
    if (!window.location.pathname.includes("/store")) return;

    const params = new URLSearchParams(window.location.search);
    const searchTerm = (params.get("search_term") || "").trim();
    if (!searchTerm) return;

    const grid = document.querySelector('[class*="product-grid__ProductGrid__"]');
    const titleWrapper = document.querySelector('[class*="search-page__titleWrapper"]') || document.querySelector("main h1")?.parentElement;
    const cards = Array.from(document.querySelectorAll('[class*="product-grid__ProductGrid__grid-item--product"]'));
    const isZeroResults = document.body.innerText.includes("no products matching");

    if (!titleWrapper && !grid && !isZeroResults) return;

    const { parentProfile, savedRegistryItems } = await getStorageState();
    const runKey = `${window.location.pathname}|${searchTerm}|${parentProfile.lifestyle}|${parentProfile.stage}|${cards.length}|${savedRegistryItems.length}`;
    if (runKey === lastRunKey) return;
    lastRunKey = runKey;
    const mySeq = ++personalizeSeq;

    const { products: apiProducts, guides } = await fetchBabylistContext(searchTerm);
    // A newer run (profile change, navigation) started while we were fetching; let it win.
    if (mySeq !== personalizeSeq) return;
    const effectiveZeroResults = isZeroResults || apiProducts.length === 0;

    const productByUrl = new Map();
    for (const p of apiProducts) {
      const u = p.hero_path || p.hero_url || p.heroUrl;
      if (u) {
        try {
          const path = new URL(u, window.location.origin).pathname;
          productByUrl.set(path, p);
        } catch (e) {}
      }
    }

    const scored = [];
    const registryTitles = savedRegistryItems.map(i => (i.title || "").toLowerCase());
    const hasVistaOnRegistry = registryTitles.some(t => t.includes("vista"));

    cards.forEach((card, idx) => {
      const link = card.querySelector('a[href*="/gp/"]');
      const href = link ? link.getAttribute("href") : "";
      // Normalize to a bare pathname so "/gp/x?foo=1" or "https://www.babylist.com/gp/x" match the map keys.
      let hrefPath = "";
      try { hrefPath = href ? new URL(href, window.location.origin).pathname : ""; } catch (e) {}
      const apiItem = hrefPath ? productByUrl.get(hrefPath) : null;
      const text = (apiItem ? `${apiItem.brand} ${apiItem.name} ${apiItem.category} ${apiItem.description || ""}` : card.innerText).toLowerCase();

      const { score, reasons, alreadyRegistered } = scoreProductForProfile(
        apiItem, text, searchTerm, parentProfile, registryTitles, hasVistaOnRegistry
      );

      scored.push({ card, idx, score, reasons, alreadyRegistered });
    });

    const promoted = scored.filter(s => s.score > 15).sort((a, b) => b.score - a.score);
    const promotedSet = new Set(promoted.slice(0, 12).map(p => p.card));

    requestAnimationFrame(() => {
      if (parentProfile.lifestyle === "default") {
        cards.forEach(c => {
          c.style.order = "";
          c.classList.remove("bl-personalized-card");
          c.querySelector(".bl-card-badge")?.remove();
        });
      } else {
        scored.forEach(item => {
          item.card.querySelector(".bl-card-badge")?.remove();
          item.card.classList.remove("bl-personalized-card");
          if (promotedSet.has(item.card)) {
            const pIndex = promoted.findIndex(p => p.card === item.card);
            item.card.style.order = String(-1000 + pIndex);
            item.card.classList.add("bl-personalized-card");
            const badge = document.createElement("div");
            badge.className = "bl-card-badge";
            badge.textContent = `#${pIndex + 1} For You • ${item.reasons[0] || "Top Match"}`;
            item.card.prepend(badge);
          } else {
            item.card.style.order = String(item.idx);
            if (item.alreadyRegistered) {
              const badge = document.createElement("div");
              badge.className = "bl-card-badge bl-badge-registered";
              badge.textContent = "✓ On Your Registry";
              item.card.style.position = "relative";
              item.card.prepend(badge);
            }
          }
        });
      }
    });

    renderPersonalizationBar({
      searchTerm,
      parentProfile,
      totalCards: cards.length,
      promotedCount: Math.min(promoted.length, 12),
      guides,
      isZeroResults: effectiveZeroResults,
      titleWrapper,
      grid
    });
  }

  function renderPersonalizationBar({ searchTerm, parentProfile, totalCards, promotedCount, guides, isZeroResults, titleWrapper, grid }) {
    let bar = document.getElementById("bl-personalized-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "bl-personalized-bar";
      bar.className = "bl-personalized-bar";
      const anchor = titleWrapper || grid;
      if (anchor && anchor.parentNode) {
        if (titleWrapper) {
          titleWrapper.parentNode.insertBefore(bar, titleWrapper.nextSibling);
        } else {
          grid.parentNode.insertBefore(bar, grid);
        }
      } else {
        document.body.prepend(bar);
      }
    }

    const lower = searchTerm.toLowerCase();
    const typoFix = TYPO_MAP[lower];

    const guidesHtml = guides.length > 0
      ? `<div class="bl-guides-strip">
           <span class="bl-strip-label">📚 Blended Expert Guides:</span>
           ${guides.map(g => `<a href="${escapeHtml(g.url)}" class="bl-guide-pill">${escapeHtml(g.title.replace(/\*\*/g, ""))} ↗</a>`).join("")}
         </div>`
      : "";

    const typoHtml = (typoFix && isZeroResults)
      ? `<div class="bl-typo-alert">
           ⚡ Typo detected: <a href="/store/search?search_term=${encodeURIComponent(typoFix)}&unified_search=true">Search for <strong>"${escapeHtml(typoFix)}"</strong> instead →</a>
         </div>`
      : "";

    const bridgeHtml = isZeroResults
      ? `<div class="bl-zero-bridge">
           <strong>🌐 Universal Registry Bridge:</strong> "${escapeHtml(searchTerm)}" isn't in the Babylist Shop—search external stores to add it to your registry:
           <div class="bl-ext-row">
             <a href="https://www.amazon.com/s?k=${encodeURIComponent(searchTerm)}" target="_blank" class="bl-ext-chip">Amazon ↗</a>
             <a href="https://www.target.com/s?searchTerm=${encodeURIComponent(searchTerm)}" target="_blank" class="bl-ext-chip">Target ↗</a>
             <a href="https://www.ikea.com/us/en/search/?q=${encodeURIComponent(searchTerm)}" target="_blank" class="bl-ext-chip">IKEA ↗</a>
           </div>
         </div>`
      : "";

    bar.innerHTML = `
      <div class="bl-bar-top">
        <div class="bl-bar-title">
          <span class="bl-ai-dot">✨</span>
          <strong>Babylist Personalized Search</strong>
          <span class="bl-bar-stats">${isZeroResults ? "0 Babylist Shop results" : `${totalCards} items scored • ${parentProfile.lifestyle === "default" ? "Standard Order" : `${promotedCount} promoted for your profile`}`}</span>
        </div>
        <div class="bl-bar-controls">
          <label>Lifestyle:
            <select id="bl-page-lifestyle">
              <option value="urban" ${parentProfile.lifestyle === "urban" ? "selected" : ""}>🏙️ Urban / Walk-Up</option>
              <option value="travel" ${parentProfile.lifestyle === "travel" ? "selected" : ""}>✈️ Frequent Flyer</option>
              <option value="twins" ${parentProfile.lifestyle === "twins" ? "selected" : ""}>👶 Twins / Siblings</option>
              <option value="budget" ${parentProfile.lifestyle === "budget" ? "selected" : ""}>💰 Budget &amp; Value</option>
              <option value="fsa" ${parentProfile.lifestyle === "fsa" ? "selected" : ""}>🏥 FSA / HSA Eligible</option>
              <option value="default" ${parentProfile.lifestyle === "default" ? "selected" : ""}>🌐 Standard (Off)</option>
            </select>
          </label>
          <label>Stage:
            <select id="bl-page-stage">
              <option value="expecting_t2" ${parentProfile.stage === "expecting_t2" ? "selected" : ""}>Expecting (2nd Tri)</option>
              <option value="newborn" ${parentProfile.stage === "newborn" ? "selected" : ""}>Newborn (0–3m)</option>
              <option value="infant" ${parentProfile.stage === "infant" ? "selected" : ""}>Infant (3–9m)</option>
              <option value="toddler" ${parentProfile.stage === "toddler" ? "selected" : ""}>Toddler (9m+)</option>
            </select>
          </label>
        </div>
      </div>
      ${typoHtml}
      ${bridgeHtml}
      ${guidesHtml}
    `;

    document.getElementById("bl-page-lifestyle")?.addEventListener("change", async (e) => {
      // storage.onChanged (in initBabylistPersonalization) re-runs personalization once.
      const updated = { ...parentProfile, lifestyle: e.target.value };
      try { await chrome.storage.local.set({ parentProfile: updated }); } catch (err) { teardownIfOrphaned(); }
    });

    document.getElementById("bl-page-stage")?.addEventListener("change", async (e) => {
      const updated = { ...parentProfile, stage: e.target.value };
      try { await chrome.storage.local.set({ parentProfile: updated }); } catch (err) { teardownIfOrphaned(); }
    });
  }

  function getLiveHeaderSearchValue() {
    const inputs = Array.from(document.querySelectorAll('[class*="SearchBarInput__input"]'));
    for (const inp of inputs) {
      const rect = inp.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && inp.value && inp.value.trim()) {
        return inp.value.trim();
      }
    }
    return "";
  }

  function injectHeaderAskAddie() {
    const existing = document.getElementById("bl-header-ask-addie");
    if (existing && existing.isConnected) return;
    if (existing && !existing.isConnected) existing.remove();

    const slots = Array.from(document.querySelectorAll('[class*="GlobalNav__Search__"]'));
    const visibleSlot = slots.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!visibleSlot) return;

    visibleSlot.classList.add("bl-search-nav-slot");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "bl-header-ask-addie";
    btn.className = "bl-header-ask-addie";
    btn.setAttribute("aria-label", "Ask Addie about your Babylist search");
    btn.innerHTML = `<span class="bl-header-sparkle" aria-hidden="true">✨</span><span>Ask Addie</span>`;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleInPageDrawer({
        anchorEl: btn,
        mode: "header",
        initialQuery: getLiveHeaderSearchValue()
      });
    });

    visibleSlot.appendChild(btn);
  }

  function syncDrawerOpenState(isOpen) {
    const headerBtn = document.getElementById("bl-header-ask-addie");
    if (headerBtn) headerBtn.classList.toggle("is-open", isOpen);
  }

  function injectFloatingPill() {
    if (document.getElementById("bl-universal-sidepanel-launcher")) return;

    const launcher = document.createElement("button");
    launcher.id = "bl-universal-sidepanel-launcher";
    launcher.className = "bl-addie-launcher";
    launcher.innerHTML = `<span class="bl-sparkle">✨</span><span>Ask Addie</span>`;
    launcher.addEventListener("click", () => toggleInPageDrawer({ mode: "floating" }));
    document.body.appendChild(launcher);
  }

  function renderStarRowHtml(rating) {
    const num = Number(rating) || 0;
    const full = Math.round(num);
    let stars = "";
    for (let i = 0; i < 5; i++) {
      const fill = i < full ? "#f59e0b" : "#e5e7eb";
      stars += `<svg width="11" height="11" viewBox="0 0 20 20" fill="${fill}" aria-hidden="true"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.16c.969 0 1.371 1.24.588 1.81l-3.367 2.448a1 1 0 00-.364 1.118l1.286 3.957c.3.921-.755 1.688-1.54 1.118l-3.367-2.448a1 1 0 00-1.175 0l-3.367 2.448c-.784.57-1.838-.197-1.539-1.118l1.286-3.957a1 1 0 00-.364-1.118L2.065 9.384c-.783-.57-.38-1.81.588-1.81h4.16a1 1 0 00.95-.69l1.286-3.957z"/></svg>`;
    }
    return `<span class="bl-c-stars">${stars}</span>`;
  }

  // Real registry add via Babylist's own add screen; see babylist-add/overlay.js.
  function showBabylistAddOverlay(item) {
    blShowAddOverlay(item);
  }

  // The background worker is the only writer of the local copy (it serializes writes and dedupes).
  async function saveRegistryItemLocal(item) {
    try {
      const res = await chrome.runtime.sendMessage({ action: "add_external_item", item });
      return res || { success: false, error: "No response from extension" };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  const CORE_GEAR_KEYWORDS = [
    "compact stroller", "double stroller", "stroller", "car seat", "bassinet",
    "crib", "anti-colic bottle", "bottle", "diaper bag", "diaper",
    "breast pump", "pump", "monitor", "high chair", "carrier",
    "pacifier", "mattress", "wagon", "swing", "bouncer", "swaddle", "try-it kits"
  ];

  const DRAWER_STOP_WORDS = new Set([
    "what", "which", "where", "how", "why", "is", "are", "do", "does", "can",
    "you", "have", "any", "should", "i", "buy", "get", "find", "pick", "picks",
    "choose", "compare", "vs", "versus", "show", "me", "tell", "about",
    "recommend", "suggest", "options", "option", "ideas", "items",
    "sell", "stock", "offer", "carry", "keep", "got", "available", "babylist", "please",
    "best", "good", "top", "great", "for", "a", "an", "the", "my", "our", "with",
    "in", "on", "to", "of", "newborn", "baby", "infant", "toddler", "family",
    "city", "urban", "small", "cheap", "under", "looking", "need", "want"
  ]);

  function normalizeDrawerCatalogQuery(rawText) {
    const trimmed = rawText.trim();
    if (!trimmed || /[<>]/.test(trimmed)) return trimmed;

    let cleanedPunct = trimmed.replace(/[?!.,]+$/g, "").trim();
    // Strip leading conversational question frames ("do you carry ...", "does babylist sell ...")
    // before checking tokens so phrases like "carry cot" outside questions still stay intact.
    const noFrame = cleanedPunct.replace(
      /^(?:(?:hey|hi)\s+addie[\s,]+)?(?:do\s+you(?:\s+guys)?|does\s+babylist|can\s+(?:i|you)|could\s+you|would\s+you|where\s+can\s+i)\s+(?:carry|sell|have|stock|offer|keep|get|find|buy|recommend|suggest)\s+/i,
      ""
    ).trim();
    if (noFrame) cleanedPunct = noFrame;

    const tokens = cleanedPunct.split(/\s+/).map((tok) => {
      const low = tok.toLowerCase();
      return TYPO_MAP[low] || tok;
    });
    const healed = tokens.join(" ");
    const lower = healed.toLowerCase();

    if (/urban|walk-up|subway|city/.test(lower) && lower.includes("stroller")) return "compact stroller";
    if (/trunk|sedan/.test(lower) && lower.includes("stroller")) return "compact stroller";
    if (/twin|double|sibling/.test(lower) && lower.includes("stroller")) return "double stroller";
    if (/colic|reflux|gas/.test(lower)) return "anti-colic bottle";
    if (/adapter|pipa/.test(lower)) return "nuna adapter";
    if (/try-it|try it|sample box/.test(lower)) return "Try-it Kits";

    const filteredTokens = tokens.filter((w) => w.length >= 2 && !DRAWER_STOP_WORDS.has(w.toLowerCase()));
    if (filteredTokens.length > 0) return filteredTokens.join(" ");

    const matchedGear = CORE_GEAR_KEYWORDS.find((kw) => lower.includes(kw));
    return matchedGear || healed;
  }

  function buildAddieConversationalCopy({ rawQ, apiQuery, ranked, totalCount, maxPrice, parentProfile, hasVistaOnRegistry }) {
    const lower = rawQ.toLowerCase();
    const profileLabel = LIFESTYLE_RULES[parentProfile.lifestyle]?.label || "Standard";

    if (ranked.length === 0) {
      if (maxPrice !== null) {
        return `I couldn't find any <strong>${escapeHtml(apiQuery)}</strong> options under $${maxPrice} in the Babylist Shop right now. You can widen your budget or search universal stores like Amazon, Target, or IKEA below.`;
      }
      return `We don't sell <strong>${escapeHtml(apiQuery)}</strong> directly in the Babylist Shop, but since Babylist is a universal registry, you can check Amazon, Target, or IKEA below to add it in one click:`;
    }

    if (/urban|walk-up|subway|city/.test(lower)) {
      return `For city walk-ups (${escapeHtml(profileLabel)}), prioritize strollers under 17 lbs with a one-hand fold like the Nuna TRVL or Joolz Aer2. Here are our top ${ranked.length} matches—want to compare fold weights?`;
    }
    if (/colic|reflux|gas/.test(lower)) {
      return `Instead of buying multi-packs upfront, most Babylist parents test our Bottle Box Try-It Kit alongside vented anti-colic picks like Philips Avent and Lansinoh:`;
    }
    if (/twin|double|sibling/.test(lower)) {
      return `For twins or siblings, modular tandems and narrow doubles keep doorways easy. Here are top expandable strollers from the Babylist Shop:`;
    }
    if (/adapter|pipa/.test(lower)) {
      return `Car seat adapter fit depends on the exact stroller and seat models, so I won't guess. Here are matching adapters from the Babylist Shop. Confirm fit on each product page before adding:`;
    }
    if (/trunk|sedan|compact/.test(lower)) {
      return `For small trunks, ultra-compact cabin-fold strollers pack down flat in seconds. Here are the highest-rated matches for your ${escapeHtml(profileLabel)} profile:`;
    }

    const best = ranked[0];
    const bestName = formatProductName(best.product.brand, best.product.name);
    const registryNote = hasVistaOnRegistry && lower.includes("stroller")
      ? " We prioritized compact options that pair nicely with your Vista V3."
      : "";
    return `We carry <strong>${totalCount} ${escapeHtml(apiQuery)}</strong> option${totalCount === 1 ? "" : "s"} in the Babylist Shop.${registryNote} Based on your <strong>${escapeHtml(profileLabel)}</strong> profile, <strong>${escapeHtml(bestName)}</strong> is the top match—which would you like to add to your registry?`;
  }

  function renderProductCarouselHtml(cards, isExternal, rawQ, apiQuery) {
    const extTargetQ = /[<>]/.test(rawQ) ? rawQ : (apiQuery || rawQ);
    const cardHtml = isExternal
      ? [
          { store: "Amazon", color: "#ea580c", url: `https://www.amazon.com/s?k=${encodeURIComponent(extTargetQ)}`, label: `Check "${extTargetQ}" on Amazon` },
          { store: "Target", color: "#dc2626", url: `https://www.target.com/s?searchTerm=${encodeURIComponent(extTargetQ)}`, label: `Check "${extTargetQ}" on Target` },
          { store: "IKEA", color: "#0369a1", url: `https://www.ikea.com/us/en/search/?q=${encodeURIComponent(extTargetQ)}`, label: `Check "${extTargetQ}" on IKEA` }
        ].map((ext) => `
          <div class="bl-c-card">
            <div class="bl-c-img-box">
              <span class="bl-c-store-logo" style="color:${ext.color};">${ext.store}</span>
            </div>
            <span class="bl-c-badge bl-c-badge--rose">🌐 Universal Store</span>
            <a href="${escapeHtml(ext.url)}" target="_blank" class="bl-c-title">${escapeHtml(ext.label)}</a>
            <a href="${escapeHtml(ext.url)}" target="_blank" class="bl-c-cta">Check store ↗</a>
          </div>
        `).join("")
      : cards.map((entry) => {
          const p = entry.product;
          const dispName = formatProductName(p.brand, p.name);
          const dispPrice = p.hero_price || (p.heroPrice ? `$${p.heroPrice}` : "--");
          const href = p.hero_url || (p.hero_path ? `https://www.babylist.com${p.hero_path}` : "https://www.babylist.com/store");
          const imgUrl = p.images?.thumbnail_url || p.images?.url || p.thumbnail_url || p.image_url || "";
          const revCount = p.review_count ?? p.reviewCount ?? 0;
          const badgeText = entry.alreadyRegistered
            ? "✓ On Registry"
            : (entry.reasons[0] || (p.rating >= 4.5 ? "⭐ Highly rated" : "Babylist Pick"));
          const isRoseBadge = !entry.alreadyRegistered && Boolean(entry.reasons[0]);

          return `
            <div class="bl-c-card" data-title="${escapeHtml(dispName)}" data-price="${escapeHtml(dispPrice)}" data-url="${escapeHtml(href)}" data-image="${escapeHtml(imgUrl)}">
              <div class="bl-c-img-box">
                ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(dispName)}" loading="lazy" />` : `<span style="font-size:24px;">👶</span>`}
              </div>
              <span class="bl-c-badge ${isRoseBadge ? "bl-c-badge--rose" : ""}">${escapeHtml(badgeText)}</span>
              <div class="bl-c-price">${escapeHtml(dispPrice)}</div>
              <a href="${escapeHtml(href)}" target="_blank" class="bl-c-title" title="${escapeHtml(dispName)}">${escapeHtml(dispName)}</a>
              <div class="bl-c-rating">
                ${renderStarRowHtml(p.rating || 4.5)}
                <span>${revCount > 0 ? `${revCount} reviews` : "Babylist Shop"}</span>
              </div>
              <button type="button" class="bl-c-cta bl-c-reg-btn ${entry.alreadyRegistered ? "bl-c-cta--added" : ""}" ${entry.alreadyRegistered ? "disabled" : ""}>
                ${entry.alreadyRegistered ? "✓ On Registry" : "+ Add to Registry"}
              </button>
            </div>
          `;
        }).join("");

    return `
      <div class="bl-carousel-wrap">
        <div class="bl-carousel-track">${cardHtml}</div>
        <button type="button" class="bl-carousel-next" aria-label="Scroll products right">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    `;
  }

  async function toggleInPageDrawer(opts = {}) {
    const mode = opts.mode || "floating";
    const existing = document.getElementById("bl-inpage-drawer");
    if (existing) {
      const sameMode = existing.dataset.anchorMode === mode;
      existing.remove();
      syncDrawerOpenState(false);
      if (sameMode) return;
    }

    const params = new URLSearchParams(window.location.search);
    const liveOrParamQuery = (opts.initialQuery || getLiveHeaderSearchValue() || params.get("search_term") || "").trim();
    const { parentProfile, savedRegistryItems } = await getStorageState();

    document.getElementById("bl-inpage-drawer")?.remove();

    const drawer = document.createElement("div");
    drawer.id = "bl-inpage-drawer";
    drawer.dataset.anchorMode = mode;
    drawer.className = mode === "header" ? "bl-addie-panel bl-addie-panel--header" : "bl-addie-panel";

    const positionHeaderPanel = () => {
      if (mode !== "header" || !opts.anchorEl || !opts.anchorEl.isConnected) return;
      const rect = opts.anchorEl.getBoundingClientRect();
      const docClientW = document.documentElement.clientWidth;
      const top = Math.max(12, Math.round(rect.bottom + window.scrollY + 8));
      const right = Math.round(Math.max(16, Math.min(docClientW - rect.right, docClientW - 420)));
      const availH = Math.max(420, Math.min(600, window.innerHeight - Math.max(0, rect.bottom) - 24));
      drawer.style.top = `${top}px`;
      drawer.style.right = `${right}px`;
      drawer.style.height = `${availH}px`;
    };

    positionHeaderPanel();

    const profileLabel = LIFESTYLE_RULES[parentProfile.lifestyle]?.label || "Standard";

    drawer.innerHTML = `
      <div class="bl-chat-header">
        <div class="bl-chat-title-wrap">
          <div class="bl-chat-title-row">
            <strong>Ask Addie</strong>
            <span class="bl-beta-pill">Beta</span>
          </div>
          <span class="bl-chat-sub">${escapeHtml(profileLabel)} • ${savedRegistryItems.length} Registry Item${savedRegistryItems.length === 1 ? "" : "s"}</span>
        </div>
        <div class="bl-chat-actions">
          <button type="button" id="bl-chat-reset" class="bl-icon-btn bl-icon-btn--compose" title="New conversation" aria-label="New conversation">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button type="button" id="bl-drawer-close" class="bl-icon-btn" title="Close" aria-label="Close Ask Addie">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div id="bl-chat-thread" class="bl-chat-thread"></div>

      <div class="bl-chat-footer">
        <div class="bl-pill-input-box">
          <input type="text" id="bl-drawer-input" placeholder="Ask Addie for shopping help" />
          <button type="button" id="bl-drawer-go" class="bl-send-circle" aria-label="Send message">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(drawer);
    syncDrawerOpenState(mode === "header");

    const thread = document.getElementById("bl-chat-thread");
    const inpField = document.getElementById("bl-drawer-input");
    const goBtn = document.getElementById("bl-drawer-go");

    const closeDrawer = () => {
      if (mode === "header") window.removeEventListener("resize", positionHeaderPanel);
      drawer.remove();
      syncDrawerOpenState(false);
    };
    if (mode === "header") window.addEventListener("resize", positionHeaderPanel);

    const renderGreeting = () => {
      thread.innerHTML = `
        <div class="bl-msg-bot">
          <div class="bl-bot-copy">
            Hi! I'm <strong>Addie</strong>, your Babylist shopping assistant. Ask me about strollers, feeding, registry compatibility, or items from other stores.
          </div>
          <div class="bl-starter-chips">
            <button type="button" class="bl-starter-chip" data-q="What is the best stroller for city?">Best city stroller</button>
            <button type="button" class="bl-starter-chip" data-q="Stroller under $200">Stroller under $200</button>
            <button type="button" class="bl-starter-chip" data-q="Try-it Kits">Try-it kits</button>
            <button type="button" class="bl-starter-chip" data-q="Do you have PS5?">Do you carry PS5?</button>
          </div>
        </div>
      `;
      thread.querySelectorAll(".bl-starter-chip").forEach((chip) => {
        chip.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          sendChatTurn(chip.dataset.q || "");
        });
      });
    };

    const bindTurnInteractions = (botNode) => {
      const track = botNode.querySelector(".bl-carousel-track");
      const nextBtn = botNode.querySelector(".bl-carousel-next");
      if (track && nextBtn) {
        nextBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          track.scrollBy({ left: 196, behavior: "smooth" });
        });
      }

      botNode.querySelectorAll(".bl-c-reg-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const card = btn.closest(".bl-c-card");
          if (!card) return;
          const item = {
            title: card.dataset.title || "Babylist Item",
            price: card.dataset.price || "$--",
            url: card.dataset.url || window.location.href,
            image: card.dataset.image || "",
            store: "Babylist Shop (1P)"
          };
          // Babylist's own add screen does the real registry add; button stays clickable
          // so the shopper can reopen it if they closed it without saving.
          showBabylistAddOverlay(item);
        });
      });

      botNode.querySelectorAll(".bl-thumb-btn").forEach((tBtn) => {
        tBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const row = tBtn.closest(".bl-feedback-row");
          row.querySelectorAll(".bl-thumb-btn").forEach((b) => b.classList.remove("is-active"));
          tBtn.classList.add("is-active");
          const ack = row.querySelector(".bl-feedback-ack");
          if (ack) ack.textContent = "Thanks for your feedback!";
        });
      });
    };

    const sendChatTurn = async (overrideText) => {
      const rawQ = (overrideText !== undefined ? overrideText : inpField.value).trim();
      if (!rawQ) {
        const hintEl = document.createElement("div");
        hintEl.className = "bl-msg-bot";
        hintEl.innerHTML = `<div class="bl-bot-copy" style="color:#6b7280;">Enter a product name, typo, price limit (e.g., <em>stroller under $300</em>), or question for Addie.</div>`;
        thread.appendChild(hintEl);
        thread.scrollTop = thread.scrollHeight;
        return;
      }

      inpField.value = "";

      const userBubble = document.createElement("div");
      userBubble.className = "bl-msg-user";
      userBubble.textContent = rawQ;
      thread.appendChild(userBubble);

      const botNode = document.createElement("div");
      botNode.className = "bl-msg-bot";
      botNode.innerHTML = `<div class="bl-bot-copy" style="color:#6b7280;">Searching Babylist catalog for your profile...</div>`;
      thread.appendChild(botNode);
      thread.scrollTop = thread.scrollHeight;

      const lowerRaw = rawQ.toLowerCase();
      const notes = [];
      let workingQ = rawQ;

      if (TYPO_MAP[lowerRaw]) {
        workingQ = TYPO_MAP[lowerRaw];
        notes.push(`⚡ Auto-healed "${escapeHtml(rawQ)}" → "${escapeHtml(workingQ)}"`);
      }

      const priceMatch = workingQ.match(/(?:under|below|<)\s*\$?(\d+)/i);
      const maxPrice = priceMatch ? parseInt(priceMatch[1], 10) : null;
      const cleanQ = priceMatch ? workingQ.replace(priceMatch[0], "").trim() : workingQ;
      if (maxPrice !== null) notes.push(`Max Price ≤ $${maxPrice}`);

      let apiQuery = normalizeDrawerCatalogQuery(cleanQ || "stroller");
      let { products, guides } = await fetchBabylistContext(apiQuery);

      if (products.length === 0 && !/[<>]/.test(cleanQ)) {
        const lowerClean = cleanQ.toLowerCase();
        const fallbackGear = CORE_GEAR_KEYWORDS.find((kw) => lowerClean.includes(kw));
        if (fallbackGear && fallbackGear !== apiQuery.toLowerCase()) {
          apiQuery = fallbackGear;
          ({ products, guides } = await fetchBabylistContext(apiQuery));
        }
      }

      let filteredProducts = maxPrice !== null
        ? products.filter((p) => {
            const val = parseFloat(String(p.hero_price || p.heroPrice || "").replace(/[^0-9.]/g, ""));
            return Number.isFinite(val) && val > 0 && val <= maxPrice;
          })
        : products;

      // Guard against Babylist OR/description false-positives on small off-catalog sets (e.g. "iphone" matching cup holders)
      const qStems = apiQuery.toLowerCase().split(/\s+/).map((w) => w.replace(/s$/i, "")).filter((w) => w.length >= 3);
      if (filteredProducts.length > 0 && filteredProducts.length <= 5 && qStems.length > 0 && !/^(?:Try-it Kits|nuna adapter)$/i.test(apiQuery)) {
        filteredProducts = filteredProducts.filter((p) => {
          const hay = `${p.brand || ""} ${p.name || ""} ${p.category || ""}`.toLowerCase();
          return qStems.some((st) => hay.includes(st));
        });
      }

      const latestState = await getStorageState();
      const activeProfile = latestState.parentProfile;
      const activeRegistry = latestState.savedRegistryItems;
      const registryTitles = activeRegistry.map((i) => (i.title || "").toLowerCase());
      const hasVistaOnRegistry = registryTitles.some((t) => t.includes("vista"));
      const ranked = filteredProducts.map((p, idx) => {
        const titleLower = `${p.brand || ""} ${p.name || ""}`.toLowerCase();
        const text = `${titleLower} ${p.category || ""} ${p.description || ""}`.toLowerCase();
        const perf = scoreProductForProfile(p, text, apiQuery, activeProfile, registryTitles, hasVistaOnRegistry);
        const titleWordHits = qStems.filter((w) => titleLower.includes(w)).length;
        const relevanceBonus = Math.max(0, 30 - idx * 1.2);
        const totalScore = perf.score + titleWordHits * 65 + relevanceBonus;
        return { product: p, totalScore, reasons: perf.reasons, alreadyRegistered: perf.alreadyRegistered };
      }).sort((a, b) => b.totalScore - a.totalScore);

      const topCards = ranked.slice(0, 6);
      const replyCopy = buildAddieConversationalCopy({
        rawQ,
        apiQuery,
        ranked: topCards,
        totalCount: filteredProducts.length,
        maxPrice,
        parentProfile: activeProfile,
        hasVistaOnRegistry
      });

      const fullSearchUrl = `/store/search?search_term=${encodeURIComponent(apiQuery)}&unified_search=true`;

      botNode.innerHTML = `
        ${notes.map((n) => `<span class="bl-bot-note">${n}</span>`).join("")}
        <div class="bl-bot-copy">${replyCopy}</div>
        ${renderProductCarouselHtml(topCards, topCards.length === 0, rawQ, apiQuery)}
        <div class="bl-bot-links">
          ${topCards.length > 0 ? `<a href="${escapeHtml(fullSearchUrl)}">🔎 View all ${filteredProducts.length} matches on Babylist →</a>` : ""}
          ${guides.length ? `<a href="${escapeHtml(guides[0].url)}" target="_blank">📚 Guide: ${escapeHtml(guides[0].title.replace(/\*\*/g, ""))} ↗</a>` : ""}
        </div>
        <div class="bl-feedback-row">
          <button type="button" class="bl-thumb-btn" data-val="up" title="Helpful" aria-label="Thumbs up">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
          </button>
          <button type="button" class="bl-thumb-btn" data-val="down" title="Not helpful" aria-label="Thumbs down">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
          </button>
          <span class="bl-feedback-ack"></span>
        </div>
      `;

      bindTurnInteractions(botNode);
      thread.scrollTop = Math.max(0, userBubble.offsetTop - 12);
    };

    document.getElementById("bl-drawer-close").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
    });

    document.getElementById("bl-chat-reset").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      renderGreeting();
      inpField.focus({ preventScroll: true });
    });

    goBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendChatTurn();
    });

    inpField.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        sendChatTurn();
      } else if (e.key === "Escape") {
        closeDrawer();
      }
    });

    renderGreeting();
    if (liveOrParamQuery) {
      await sendChatTurn(`Show picks for ${liveOrParamQuery}`);
    }
    inpField.focus({ preventScroll: true });
  }

  // Start last, after every const/let above is initialized.
  if (!hostname.includes("babylist.com")) {
    initExternalStoreCapture();
  } else {
    initBabylistPersonalization();
  }
})();
