// Background Service Worker (Manifest V3)

// The toolbar button opens popup/popup.html (manifest default_popup); the popup opens the side panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((err) => console.error("setPanelBehavior error:", err));

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get([
    "parentProfile",
    "savedRegistryItems"
  ]);

  if (!existing.parentProfile) {
    await chrome.storage.local.set({
      parentProfile: {
        lifestyle: "urban",
        stage: "expecting_t2",
        maxBudget: null
      }
    });
  }

  if (!existing.savedRegistryItems) {
    await chrome.storage.local.set({
      savedRegistryItems: [
        {
          id: "item-1",
          title: "UPPAbaby Vista V3 Stroller - Declan",
          price: "$999.99",
          store: "Babylist Shop (1P)",
          category: "Strolling"
        },
        {
          id: "item-2",
          title: "IKEA Antilop High Chair with Tray",
          price: "$29.99",
          store: "IKEA",
          category: "Feeding"
        }
      ]
    });
  }
});

// All registry writes go through this worker. Writes run one at a time so two
// read-modify-write cycles (e.g. side panel + content script) can't drop an item.
let registryWriteQueue = Promise.resolve();
function enqueueRegistryWrite(fn) {
  const run = registryWriteQueue.then(fn, fn);
  registryWriteQueue = run.catch(() => {});
  return run;
}

async function addRegistryItem(item) {
  if (!item || !item.title) throw new Error("Invalid product payload");
  const { savedRegistryItems = [] } = await chrome.storage.local.get("savedRegistryItems");
  const titleKey = String(item.title).trim().toLowerCase();
  const exists = savedRegistryItems.some(
    (i) => (item.url && i.url === item.url) || String(i.title || "").trim().toLowerCase() === titleKey
  );
  if (!exists) {
    savedRegistryItems.unshift({
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: item.title,
      price: item.price || "$--",
      store: item.store || "External Retailer",
      url: item.url || "",
      image: item.image || "",
      category: item.category || "General Gear"
    });
    await chrome.storage.local.set({ savedRegistryItems });
  }
  return { success: true, count: savedRegistryItems.length, deduplicated: exists };
}

async function removeRegistryItem(id) {
  const { savedRegistryItems = [] } = await chrome.storage.local.get("savedRegistryItems");
  const updated = savedRegistryItems.filter((i) => i.id !== id);
  await chrome.storage.local.set({ savedRegistryItems: updated });
  return { success: true, count: updated.length };
}

// The real registry add happens in Babylist's own add screen, shown as an in-page overlay
// (babylist-add/frame.html) by the caller. This only keeps the extension's local copy,
// used for "on your registry" hints and re-ranking.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let task = null;
  if (message.action === "add_external_item") task = () => addRegistryItem(message.item);
  else if (message.action === "remove_registry_item") task = () => removeRegistryItem(message.id);
  if (!task) return false;

  enqueueRegistryWrite(task)
    .then(sendResponse)
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true;
});
