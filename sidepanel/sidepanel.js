// Side Panel Logic: Live Babylist Search API + Personalization + Chrome Built-in AI

// Query understanding + ranking live in lib/search-core.js (shared with the eval harness).
const { LIFESTYLE_RULES, STAGE_LABELS, parsePrice, parseQuery, rankProducts } = globalThis.BLSearchCore;

const ADDIE_KNOWLEDGE = {
  urban: `🏙️ **Best Strollers for an Urban Family & Walk-Up Apartments:**
1. **Babyzen YOYO3 (13.6 lbs):** Folds one-handed over the shoulder for subway stairs and walk-ups.
2. **Bugaboo Butterfly (16.1 lbs):** 1-second fold and IATA airplane overhead bin certified.
3. **UPPAbaby Minu V2:** Compact everyday fold while staying compatible with Mesa/Pipa infant seats.`,
  colic: `🍼 **Infant Gas & Acid Reflux Feeding Strategy:**
• Don't buy 4-packs of a single bottle brand upfront.
• Add the **Babylist Bottle Box Try-It Kit** ($29.99) to test Philips Avent, Dr. Brown’s Anti-Colic, MAM, and Boon side-by-side.`,
  adapter: `🔗 **Nuna Pipa + UPPAbaby Cruz / Vista Compatibility:**
Compatibility depends on the exact stroller and car seat models, so I won't guess. Check the UPPAbaby and Nuna compatibility charts (or ask Babylist's registry experts) before buying an adapter.`,
  trunk: `🚗 **Compact Car Trunk Strollers Under $300:**
1. **Ergobaby Metro+ ($299):** Compact sedan trunk fold with newborn lie-flat recline.
2. **Summer Infant 3Dlite ($99):** Lightweight umbrella fold.`,
  default: "I'm Addie! Describe your lifestyle need (e.g. 'best stroller for urban family') or click Evaluate Active Product Tab above."
};

const ADDIE_SYSTEM_PROMPT = `You are Addie, Babylist's AI Baby Registry & Gear Assistant.
Help parents pick baby gear based on lifestyle needs (urban walk-ups, small trunks, twins, colic/reflux).
Keep answers concise (3-5 bullet points), mention Babylist's 15% completion discount or Try-It Kits where helpful, and never guess adapter compatibility.`;

let chromeAiAvailability = "unavailable";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBubbleHtml(text) {
  return escapeHtml(text).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}

function formatProductName(brand, name) {
  const b = (brand || "").trim();
  const n = (name || "").trim();
  if (!b) return n;
  if (n.toLowerCase().startsWith(b.toLowerCase())) return n;
  return `${b} ${n}`;
}

async function checkChromeAIStatus() {
  const badge = document.getElementById("ai-status-badge");
  const evalMode = document.getElementById("eval-engine-mode");

  if (!globalThis.LanguageModel) {
    chromeAiAvailability = "unavailable";
    if (badge) { badge.className = "ai-badge ai-fallback"; badge.textContent = "Fallback Mode"; }
    if (evalMode) evalMode.textContent = "Hybrid Fallback";
    return "unavailable";
  }

  try {
    const availability = await Promise.race([
      LanguageModel.availability({
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }]
      }),
      new Promise(resolve => setTimeout(() => resolve("unavailable"), 2500))
    ]);
    chromeAiAvailability = availability;

    if (badge) {
      if (availability === "available") {
        badge.className = "ai-badge ai-ready";
        badge.textContent = "Gemini Nano Ready";
      } else if (availability === "downloadable" || availability === "downloading") {
        badge.className = "ai-badge ai-downloading";
        badge.textContent = "AI Downloadable";
      } else {
        badge.className = "ai-badge ai-fallback";
        badge.textContent = "Fallback Mode";
      }
    }
    if (evalMode) evalMode.textContent = availability === "available" ? "Gemini Nano" : "Hybrid Fallback";
    return availability;
  } catch (err) {
    chromeAiAvailability = "unavailable";
    if (badge) { badge.className = "ai-badge ai-fallback"; badge.textContent = "Fallback Mode"; }
    if (evalMode) evalMode.textContent = "Hybrid Fallback";
    return "unavailable";
  }
}

async function createAddieAISession(systemPrompt, onProgress) {
  const params = await LanguageModel.params();
  return await LanguageModel.create({
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
    topK: Math.min(5, params.maxTopK || 5),
    temperature: Math.min(0.6, params.maxTemperature || 1.0),
    initialPrompts: [{ role: "system", content: systemPrompt }],
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        if (onProgress) onProgress(e.total ? Math.floor((e.loaded / e.total) * 100) : 0);
      });
    }
  });
}

// Cache successful catalog responses so re-ranking (profile/registry changes) doesn't refetch.
const catalogCache = new Map();

async function fetchLiveBabylistCatalog(query) {
  const cached = catalogCache.get(query);
  if (cached) return { ...cached, latencyMs: 0 };
  const result = await fetchLiveBabylistCatalogUncached(query);
  if (!result.apiError) catalogCache.set(query, result);
  return result;
}

async function fetchLiveBabylistCatalogUncached(query) {
  const start = performance.now();
  let products = [];
  let guides = [];
  let apiError = null;

  try {
    const [prodResp, guideResp] = await Promise.all([
      fetch(`https://www.babylist.com/api/v3/products?heroes=true&search_term=${encodeURIComponent(query)}`),
      fetch(`https://www.babylist.com/api/v3/search?q=${encodeURIComponent(query)}&event_location=Store`)
    ]);
    if (!prodResp.ok) throw new Error(`HTTP ${prodResp.status}`);
    const prodJson = await prodResp.json();
    const guideJson = guideResp.ok ? await guideResp.json() : { results: [] };
    products = prodJson?.data?.hero_products || prodJson?.data?.heroProducts || [];

    let inGuides = false;
    for (const item of guideJson?.results || []) {
      if (item.type === "section_heading") inGuides = (item.title === "Guides");
      else if (inGuides && item.type === "suggested_result_text") guides.push(item);
    }
  } catch (err) {
    console.warn("Live Babylist API fetch failed:", err);
    apiError = err.message;
  }

  return {
    products,
    guides: guides.slice(0, 3),
    latencyMs: Math.round(performance.now() - start),
    apiError
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  checkChromeAIStatus();

  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");
  function switchTab(tabId) {
    tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
    tabPanes.forEach(p => p.classList.toggle("active", p.id === `tab-${tabId}`));
  }
  tabBtns.forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

  const searchInput = document.getElementById("uni-search-input");
  const searchBtn = document.getElementById("uni-search-btn");
  const lifestyleSelect = document.getElementById("sp-lifestyle-select");
  const strategySelect = document.getElementById("ranking-strategy-select");
  const resultsContainer = document.getElementById("search-results-list");
  const evalRows = document.getElementById("eval-score-rows");
  const nlpIntentBadge = document.getElementById("nlp-intent-badge");
  const t3LifestyleSelect = document.getElementById("t3-lifestyle-select");
  const t3StageSelect = document.getElementById("t3-stage-select");

  let cachedProfile = { lifestyle: "urban", stage: "expecting_t2" };

  async function getState() {
    const data = await chrome.storage.local.get(["parentProfile", "savedRegistryItems"]);
    if (data.parentProfile) cachedProfile = { ...cachedProfile, ...data.parentProfile };
    return {
      parentProfile: cachedProfile,
      savedRegistryItems: data.savedRegistryItems || []
    };
  }

  // Registry writes go through the background worker (single serialized writer).
  // The storage.onChanged listener below refreshes the list and results afterwards.
  async function saveItemToRegistry(title, price, store, category, url, image) {
    return chrome.runtime.sendMessage({
      action: "add_external_item",
      item: { title, price, store, category, url, image }
    });
  }

  // Real registry add via Babylist's own add screen; see babylist-add/overlay.js.
  function showBabylistAddOverlay(item) {
    blShowAddOverlay(item);
  }

  async function removeItemFromRegistry(id) {
    return chrome.runtime.sendMessage({ action: "remove_registry_item", id });
  }

  async function loadSavedRegistry() {
    const container = document.getElementById("saved-registry-list");
    const countEl = document.getElementById("reg-saved-count");
    const summaryEl = document.getElementById("profile-summary-text");
    const stageLabelEl = document.getElementById("profile-stage-label");
    const { parentProfile, savedRegistryItems } = await getState();

    const lifestyleLabel = LIFESTYLE_RULES[parentProfile.lifestyle]?.label || "Standard";
    const stageLabel = STAGE_LABELS[parentProfile.stage] || parentProfile.stage;

    if (countEl) countEl.innerText = `${savedRegistryItems.length} item${savedRegistryItems.length === 1 ? "" : "s"}`;
    if (summaryEl) summaryEl.innerText = `${lifestyleLabel} • ${stageLabel}`;
    if (stageLabelEl) stageLabelEl.innerText = stageLabel;
    if (lifestyleSelect) lifestyleSelect.value = parentProfile.lifestyle;
    if (t3LifestyleSelect) t3LifestyleSelect.value = parentProfile.lifestyle;
    if (t3StageSelect) t3StageSelect.value = parentProfile.stage;

    if (!container) return;
    container.innerHTML = "";
    savedRegistryItems.forEach(item => {
      const row = document.createElement("div");
      row.className = "missing-item";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.store)} • ${escapeHtml(item.price)}</p>
        </div>
        <button type="button" class="btn-remove-item" title="Remove from registry">✕</button>
      `;
      row.querySelector(".btn-remove-item").addEventListener("click", () => removeItemFromRegistry(item.id));
      container.appendChild(row);
    });
  }

  // Each search gets a sequence number; a response that arrives after a newer search started is dropped.
  let searchSeq = 0;

  async function executeUniversalSearch(q) {
    const mySeq = ++searchSeq;
    const parsed = parseQuery(q !== undefined ? q : searchInput.value);
    const { raw: rawQuery, maxPrice, cleanQuery, catalogQuery } = parsed;
    searchInput.value = parsed.typoFixedFrom ? parsed.query : rawQuery;
    const typoBanner = parsed.typoFixedFrom
      ? `⚡ Auto-healed typo "${escapeHtml(parsed.typoFixedFrom)}" → "${escapeHtml(parsed.query)}"`
      : "";

    resultsContainer.innerHTML = `<div class="product-card" style="text-align:center; color:#64748b;">Searching Babylist live catalog for "${escapeHtml(catalogQuery)}"...</div>`;

    const [{ products, guides, latencyMs, apiError }, { parentProfile, savedRegistryItems }] = await Promise.all([
      fetchLiveBabylistCatalog(catalogQuery),
      getState()
    ]);
    if (mySeq !== searchSeq) return;

    const lifestyle = lifestyleSelect ? lifestyleSelect.value : parentProfile.lifestyle;
    const strategy = strategySelect ? strategySelect.value : "balanced";
    const registryTitles = savedRegistryItems.map(i => (i.title || "").toLowerCase());
    const hasVista = registryTitles.some(t => t.includes("vista"));

    if (nlpIntentBadge) {
      const chips = [];
      if (typoBanner) chips.push(typoBanner);
      if (maxPrice !== null) chips.push(`🧠 Constraint: Max Price ≤ $${maxPrice}`);
      if (catalogQuery !== cleanQuery && cleanQuery) chips.push(`💬 NLP Query → "${escapeHtml(catalogQuery)}"`);
      if (chips.length > 0) {
        nlpIntentBadge.style.display = "block";
        nlpIntentBadge.innerHTML = chips.join(" • ");
      } else {
        nlpIntentBadge.style.display = "none";
      }
    }

    const scored = rankProducts(products, { lifestyle, strategy, registryTitles, cleanQuery, maxPrice });

    const latEl = document.getElementById("eval-latency");
    const candEl = document.getElementById("eval-candidates");
    if (latEl) latEl.textContent = `${latencyMs}ms`;
    if (candEl) candEl.textContent = String(scored.length);
    if (evalRows) {
      evalRows.innerHTML = "";
      scored.slice(0, 8).forEach(item => {
        const row = document.createElement("div");
        row.className = "eval-row";
        row.innerHTML = `
          <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(formatProductName(item.p.brand, item.p.name))}</span>
          <span>${item.matchScore}</span>
          <span>${item.lifestyleBoost}x</span>
          <span>${item.registryBoost}x</span>
          <strong>${item.finalScore}</strong>
        `;
        evalRows.appendChild(row);
      });
    }

    resultsContainer.innerHTML = "";

    if (apiError) {
      resultsContainer.innerHTML = `
        <div class="product-card" style="border-left:3px solid #ef4444;">
          <div class="prod-title">Unable to reach Babylist API (${escapeHtml(apiError)})</div>
          <p style="font-size:11px; color:#64748b;">Check your network connection or search directly below.</p>
        </div>
      `;
    }

    if (guides.length > 0) {
      const gCard = document.createElement("div");
      gCard.className = "product-card";
      gCard.style.borderLeft = "3px solid #0284c7";
      gCard.innerHTML = `
        <div class="card-header-row">
          <div class="prod-title">📚 Expert Guides for "${escapeHtml(catalogQuery)}"</div>
          <span class="store-tag tag-guide">Babylist Guides</span>
        </div>
        <div class="price-matrix">
          ${guides.map(g => `<div class="matrix-row"><a href="https://www.babylist.com${escapeHtml(g.url)}" target="_blank" style="color:#0369a1; text-decoration:none; font-weight:600;">${escapeHtml(g.title.replace(/\*\*/g, ""))} ↗</a></div>`).join("")}
        </div>
      `;
      resultsContainer.appendChild(gCard);
    }

    if (scored.length === 0) {
      resultsContainer.innerHTML += `
        <div class="product-card" style="text-align:center; padding:16px;">
          <div class="prod-title">0 Babylist Shop results for "${escapeHtml(rawQuery)}"</div>
          <p style="font-size:11px; color:#64748b; margin:4px 0 8px 0;">Use Universal Registry Bridge to search external stores:</p>
          <div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap;">
            <a href="https://www.amazon.com/s?k=${encodeURIComponent(rawQuery)}" target="_blank" class="btn-add" style="text-decoration:none; background:#ff9900; color:#111;">Amazon ↗</a>
            <a href="https://www.target.com/s?searchTerm=${encodeURIComponent(rawQuery)}" target="_blank" class="btn-add" style="text-decoration:none; background:#cc0000;">Target ↗</a>
            <a href="https://www.ikea.com/us/en/search/?q=${encodeURIComponent(rawQuery)}" target="_blank" class="btn-add" style="text-decoration:none; background:#0058a3;">IKEA ↗</a>
          </div>
        </div>
      `;
    } else {
      scored.slice(0, 12).forEach((item, idx) => {
        const p = item.p;
        const card = document.createElement("div");
        card.className = "product-card";
        const displayName = formatProductName(p.brand, p.name);
        const reasonTag = item.reasons[0] ? `<span style="font-size:10px; color:${item.alreadyOnReg ? '#059669' : '#e11d48'}; font-weight:700;">#${idx + 1} • ${escapeHtml(item.reasons[0])}</span>` : "";
        const completionPrice = item.priceNum > 0 ? `$${(item.priceNum * 0.85).toFixed(2)}` : "";
        const displayPrice = item.priceNum > 0 ? `$${item.priceNum.toFixed(2)}` : (p.hero_price || "--");
        const prodUrl = p.hero_url || (p.hero_path ? `https://www.babylist.com${p.hero_path}` : "https://www.babylist.com/store");
        const revCount = p.review_count ?? p.reviewCount ?? 0;

        card.innerHTML = `
          <div class="card-header-row">
            <div class="prod-title"><a href="${escapeHtml(prodUrl)}" target="_blank" style="color:inherit; text-decoration:none;">${escapeHtml(displayName)}</a></div>
            <span class="store-tag tag-1p">Babylist Shop</span>
          </div>
          ${reasonTag}
          <div class="price-matrix">
            <div class="matrix-row top-deal">
              <span>Babylist Shop: <strong>${escapeHtml(displayPrice)}</strong></span>
              <span>${completionPrice ? `w/ completion discount (if eligible): ${escapeHtml(completionPrice)}` : ""}</span>
            </div>
            <div class="matrix-row">
              <span>Rating: ${p.rating ? `${p.rating}★ (${revCount} reviews)` : "New"}</span>
              <a href="https://www.amazon.com/s?k=${encodeURIComponent(displayName)}" target="_blank" style="color:#b45309; text-decoration:none;">Compare Amazon ↗</a>
            </div>
          </div>
          <div class="card-action-row">
            <button type="button" class="btn-add" ${item.alreadyOnReg ? 'style="background:#10b981;" disabled' : ""}>${item.alreadyOnReg ? "✓ Already on Registry" : "+ Add to Babylist Registry"}</button>
            <span class="ranking-signal-badge">Score: ${item.finalScore}</span>
          </div>
        `;

        card.querySelector(".btn-add").addEventListener("click", async (e) => {
          const imgUrl = p.images?.thumbnail_url || p.images?.url || p.thumbnail_url || p.image_url || "";
          // Babylist's own add screen does the real registry add; we also keep a local copy.
          // overlay.js saves the local copy once Babylist confirms the add.
          showBabylistAddOverlay({ title: displayName, price: displayPrice, url: prodUrl, image: imgUrl, store: "Babylist Shop (1P)", category: p.category || "Gear" });
        });

        resultsContainer.appendChild(card);
      });
    }

    const regBox = document.getElementById("registry-aware-box");
    if (regBox) {
      regBox.innerHTML = hasVista && cleanQuery.includes("stroller")
        ? `<strong>Registry Search Interceptor:</strong><p style="margin:3px 0 0 0; color:#701a75;">Detected <em>UPPAbaby Vista V3</em> on your registry. Promoted lightweight travel strollers &amp; compatible accessories first.</p>`
        : `<strong>Registry Search Interceptor:</strong><p style="margin:3px 0 0 0; color:#701a75;">Re-ranked ${scored.length} live Babylist results for <strong>${escapeHtml(LIFESTYLE_RULES[lifestyle]?.label || "Standard")}</strong> (${escapeHtml(STAGE_LABELS[parentProfile.stage] || parentProfile.stage)}).</p>`;
    }
  }

  searchBtn.addEventListener("click", () => executeUniversalSearch());
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") executeUniversalSearch(); });
  strategySelect?.addEventListener("change", () => executeUniversalSearch());

  // Only writes storage; the onChanged listener re-renders and re-searches exactly once.
  async function updateProfile(partial) {
    cachedProfile = { ...cachedProfile, ...partial };
    await chrome.storage.local.set({ parentProfile: cachedProfile });
  }

  async function consumePendingSearchQuery() {
    const { pendingSearchQuery, pendingTimestamp } = await chrome.storage.local.get(["pendingSearchQuery", "pendingTimestamp"]);
    if (!pendingSearchQuery) return null;
    await chrome.storage.local.remove(["pendingSearchQuery", "pendingTimestamp"]);
    // Ignore stale queries left over from a popup session that never opened the panel.
    if (!pendingTimestamp || Date.now() - pendingTimestamp > 60000) return null;
    return String(pendingSearchQuery).trim() || null;
  }

  lifestyleSelect?.addEventListener("change", (e) => updateProfile({ lifestyle: e.target.value }));
  t3LifestyleSelect?.addEventListener("change", (e) => updateProfile({ lifestyle: e.target.value }));
  t3StageSelect?.addEventListener("change", (e) => updateProfile({ stage: e.target.value }));

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    if (changes.pendingSearchQuery?.newValue) {
      const pq = await consumePendingSearchQuery();
      if (pq) {
        searchInput.value = pq;
        switchTab("universal-search");
        executeUniversalSearch(pq);
      }
      return;
    }
    if (changes.parentProfile || changes.savedRegistryItems) {
      await loadSavedRegistry();
      executeUniversalSearch();
    }
  });

  // Sync initial Side Panel query with active Babylist search tab if open
  let initialQuery = "stroller";
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.url && activeTab.url.includes("babylist.com")) {
      const q = new URL(activeTab.url).searchParams.get("search_term");
      if (q && q.trim()) {
        initialQuery = q.trim();
        searchInput.value = initialQuery;
      }
    }
  } catch (e) {}

  // A query typed in the toolbar popup takes priority over the active tab's query.
  const pendingQuery = await consumePendingSearchQuery().catch(() => null);
  if (pendingQuery) {
    initialQuery = pendingQuery;
    searchInput.value = pendingQuery;
  }

  await loadSavedRegistry();
  executeUniversalSearch(initialQuery);

  // Conversational Addie AI
  const addieThread = document.getElementById("addie-thread");
  const addieInput = document.getElementById("addie-input");
  const addieBtn = document.getElementById("addie-send-btn");
  const analyzePageBtn = document.getElementById("analyze-page-btn");

  function appendChat(text, isUser = false) {
    const msg = document.createElement("div");
    msg.className = `chat-msg ${isUser ? "user" : "bot"}`;
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.innerHTML = formatBubbleHtml(text);
    msg.appendChild(bubble);
    addieThread.appendChild(msg);
    addieThread.scrollTop = addieThread.scrollHeight;
    return bubble;
  }

  function getFallbackAnswer(q) {
    const lower = q.toLowerCase();
    if (lower.includes("urban") || lower.includes("walk-up")) return ADDIE_KNOWLEDGE.urban;
    if (lower.includes("colic") || lower.includes("reflux")) return ADDIE_KNOWLEDGE.colic;
    if (lower.includes("adapter") || lower.includes("pipa")) return ADDIE_KNOWLEDGE.adapter;
    if (lower.includes("trunk") || lower.includes("under $300")) return ADDIE_KNOWLEDGE.trunk;
    return ADDIE_KNOWLEDGE.default;
  }

  // "downloadable"/"downloading" models can still be used: LanguageModel.create() from a click
  // starts (or joins) the download. Without that call the model would never be fetched.
  function canUseChromeAI(availability) {
    return Boolean(globalThis.LanguageModel) &&
      (availability === "available" || availability === "downloadable" || availability === "downloading");
  }

  async function streamAddieAnswer(bubble, systemPrompt, prompt, availability) {
    let session = null;
    try {
      if (availability !== "available") bubble.innerHTML = formatBubbleHtml("⬇️ Downloading Gemini Nano (first use only)...");
      session = await createAddieAISession(systemPrompt, (pct) => {
        bubble.innerHTML = formatBubbleHtml(`⬇️ Downloading Gemini Nano... ${pct}%`);
      });
      if (availability !== "available") checkChromeAIStatus(); // refresh header badge
      bubble.innerHTML = formatBubbleHtml("✨ Thinking with Chrome Gemini Nano...");
      let accumulated = "";
      for await (const chunk of session.promptStreaming(prompt)) {
        accumulated += chunk;
        bubble.innerHTML = formatBubbleHtml(accumulated);
        addieThread.scrollTop = addieThread.scrollHeight;
      }
      return true;
    } catch (err) {
      console.warn("Chrome AI failed, using fallback:", err);
      return false;
    } finally {
      if (session) session.destroy();
    }
  }

  async function handleNeedQuery(text) {
    const q = (text || addieInput.value || "").trim();
    if (!q) return;
    appendChat(q, true);
    addieInput.value = "";

    const availability = await checkChromeAIStatus();
    if (canUseChromeAI(availability)) {
      const bubble = appendChat("✨ Thinking with Chrome Gemini Nano...", false);
      const ok = await streamAddieAnswer(bubble, ADDIE_SYSTEM_PROMPT, q, availability);
      if (!ok) bubble.innerHTML = formatBubbleHtml(getFallbackAnswer(q));
    } else {
      setTimeout(() => appendChat(getFallbackAnswer(q), false), 200);
    }
  }

  analyzePageBtn?.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https:\/\/(www\.babylist\.com|[^/]*\.(amazon|target|walmart|ikea)\.com)\//i.test(tab.url)) {
      appendChat("Open a product or search page on Babylist, Amazon, Target, Walmart, or IKEA first.", false);
      return;
    }

    appendChat(`Evaluate active tab: ${tab.title || tab.url}`, true);
    const bubble = appendChat("✨ Reading active page...", false);

    let pageText = "";
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll("script, style, nav, footer").forEach(el => el.remove());
          return clone.innerText.replace(/\s+/g, " ").substring(0, 3500);
        }
      });
      pageText = result || "";
    } catch (err) {
      bubble.textContent = "Could not read page text. Reload the webpage tab and try again.";
      return;
    }

    const availability = await checkChromeAIStatus();
    if (canUseChromeAI(availability)) {
      const ok = await streamAddieAnswer(
        bubble,
        `${ADDIE_SYSTEM_PROMPT}\nEvaluate this baby gear page for an expecting parent (pros, cons, safety/stage fit).`,
        `Page content:\n\n${pageText}`,
        availability
      );
      if (ok) return;
    }

    const { parentProfile } = await getState();
    const host = new URL(tab.url).hostname;
    const priceFound = pageText.match(/\$\d+(?:\.\d{2})?/)?.[0] || "Check page price";
    const isBabylist = host.includes("babylist.com");
    bubble.innerHTML = formatBubbleHtml(
      `**Page Evaluation (${host}):**\n` +
      `• **Detected Price:** ${priceFound}${isBabylist ? " (may qualify for Babylist's registry completion discount)" : " (Can be added via Universal Registry)"}\n` +
      `• **Active Profile Fit:** Evaluated for **${LIFESTYLE_RULES[parentProfile.lifestyle]?.label || "Standard"}** (${STAGE_LABELS[parentProfile.stage] || parentProfile.stage}).\n` +
      `• **Snippet:** ${pageText.slice(0, 180)}...`
    );
  });

  addieBtn.addEventListener("click", () => handleNeedQuery());
  addieInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleNeedQuery(); });
  document.querySelectorAll(".chip").forEach(c => c.addEventListener("click", () => handleNeedQuery(c.dataset.need)));
});
