// Popup Logic

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("popup-search-input");
  const searchBtn = document.getElementById("popup-search-btn");
  const openPanelBtn = document.getElementById("open-panel-btn");

  // Look up the window id ahead of time: chrome.sidePanel.open() must run while the
  // click's user gesture is still active, so the click handler can't wait on other calls first.
  let windowId = null;
  chrome.windows.getCurrent().then((win) => { windowId = win.id; }).catch(() => {});

  function openSidePanel(query = "") {
    if (query) {
      // The side panel reads this on load, or picks it up via storage.onChanged if already open.
      chrome.storage.local.set({ pendingSearchQuery: query, pendingTimestamp: Date.now() });
    }
    if (windowId === null) return;
    chrome.sidePanel
      .open({ windowId })
      .then(() => window.close())
      .catch((err) => console.error("sidePanel.open failed:", err));
  }

  openPanelBtn.addEventListener("click", () => openSidePanel());

  function executeSearch() {
    const q = input.value.trim();
    if (!q) return;
    openSidePanel(q);
  }

  searchBtn.addEventListener("click", executeSearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") executeSearch();
  });
});
