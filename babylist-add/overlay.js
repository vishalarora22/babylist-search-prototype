// Shared by the content script and the side panel: adds an item to the shopper's real
// Babylist registry through Babylist's own "Add to Babylist" screen (babylist-add/frame.html).
// The screen loads hidden and is submitted automatically; it is only shown if the user has
// to act (signed out, or Babylist needs a field filled in).
function blShowAddOverlay(item) {
  document.getElementById("bl-add-overlay")?.remove();
  document.getElementById("bl-add-toast")?.remove();

  const qs = new URLSearchParams();
  qs.set("title", item.title || "");
  if (item.price) qs.set("price", item.price);
  if (item.url) qs.set("url", item.url);
  if (item.image) qs.set("image", item.image);
  qs.set("auto", "1");

  const frame = document.createElement("iframe");
  frame.id = "bl-add-overlay";
  frame.src = `${chrome.runtime.getURL("babylist-add/frame.html")}?${qs.toString()}`;
  frame.setAttribute("allowtransparency", "true");
  frame.title = "Add to Babylist";
  frame.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;" +
    "background:transparent;color-scheme:normal;opacity:0;pointer-events:none;";
  document.body.appendChild(frame);

  const toast = document.createElement("div");
  toast.id = "bl-add-toast";
  toast.setAttribute("role", "status");
  toast.style.cssText =
    "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;" +
    "background:#6e3264;color:#fff;font:600 14px system-ui,sans-serif;padding:10px 16px;" +
    "border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.2);max-width:90vw;";
  toast.textContent = "Adding to your Babylist registry…";
  document.body.appendChild(toast);

  const showFrame = () => {
    frame.style.opacity = "1";
    frame.style.pointerEvents = "auto";
    toast.remove();
  };
  const finish = (text) => {
    frame.remove();
    if (!text) return toast.remove();
    toast.textContent = text;
    setTimeout(() => toast.remove(), 3500);
  };

  // Safety nets: if autosubmit.js never starts (stage "loaded"), or never finishes, let the
  // user finish in Babylist's screen instead of leaving the toast spinning.
  let fallback = setTimeout(showFrame, 7000);
  const STAGE_TEXT = {
    loaded: "Adding to your Babylist registry… (form loading)",
    "form-ready": "Adding to your Babylist registry… (saving)",
    clicked: "Adding to your Babylist registry… (saving)"
  };
  const extOrigin = new URL(chrome.runtime.getURL("")).origin;
  const onMsg = (e) => {
    if (e.origin !== extOrigin || !e.data?.blAddOverlay) return;
    const kind = e.data.blAddOverlay;
    if (kind === "stage") {
      if (e.data.stage === "loaded") { clearTimeout(fallback); fallback = setTimeout(showFrame, 15000); }
      if (toast.isConnected && STAGE_TEXT[e.data.stage]) toast.textContent = STAGE_TEXT[e.data.stage];
      return;
    }
    if (kind === "needs-user") {
      clearTimeout(fallback);
      showFrame();
      return;
    }
    clearTimeout(fallback);
    window.removeEventListener("message", onMsg);
    if (kind === "added") {
      finish(`✓ Added to your Babylist registry`);
      // Local copy (for "on your registry" hints) only once Babylist confirmed the save.
      chrome.runtime.sendMessage({ action: "add_external_item", item }).catch(() => {});
    } else {
      finish(null); // "close": the user closed Babylist's screen
    }
  };
  window.addEventListener("message", onMsg);
}
