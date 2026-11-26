// Hosts Babylist's public "Add to Babylist" screen (the same /bookmarklet/ page that
// https://www.babylist.com/add.js shows on retailer sites) inside an overlay.
// Running it from an extension page means store sites' CSP can't block the frame.

const BABYLIST_ORIGIN = "https://www.babylist.com";

function buildBabylistAddUrl(params) {
  const qs = new URLSearchParams();
  // Babylist's form shows the add modal directly when force_modal is set, instead of first
  // checking iframe storage access and possibly trying to open a popup window.
  qs.set("force_modal", "1");
  qs.set("title", params.get("title") || "");
  const priceNum = String(params.get("price") || "").replace(/[^0-9.]/g, "");
  if (priceNum) qs.set("price", priceNum);
  if (params.get("url")) qs.set("url", params.get("url"));
  if (params.get("image")) qs.append("imgs[]", params.get("image"));
  return `${BABYLIST_ORIGIN}/bookmarklet/?${qs.toString()}`;
}

function notifyParent(kind) {
  // The content script / side panel that created this frame (overlay.js) handles these.
  window.parent.postMessage({ blAddOverlay: kind }, "*");
}
function closeOverlay() { notifyParent("close"); }

const params = new URLSearchParams(location.search);
const addUrl = buildBabylistAddUrl(params);
const frameEl = document.getElementById("bl-frame");
// autosubmit.js (injected into Babylist's screen) only acts when the URL carries this fragment.
frameEl.src = params.get("auto") === "1" ? `${addUrl}#bl-ext-auto` : addUrl;
document.getElementById("bl-open-tab").href = addUrl;
document.getElementById("bl-open-tab").addEventListener("click", () => setTimeout(closeOverlay, 0));
document.getElementById("bl-close").addEventListener("click", closeOverlay);

// Babylist's modal posts {"type":"buffermessage"} (JSON string) to its parent when it's
// closed or the item is saved; add.js removes its iframe on that message, so we do the same.
window.addEventListener("message", (e) => {
  if (e.origin !== BABYLIST_ORIGIN || typeof e.data !== "string") return;
  let msg = null;
  try { msg = JSON.parse(e.data); } catch (err) { return; }
  if (msg?.type === "bl-ext-autosubmit") {
    if (msg.done) notifyParent(msg.ok ? "added" : "needs-user");
    else window.parent.postMessage({ blAddOverlay: "stage", stage: msg.stage }, "*");
  }
  else if (msg?.type === "buffermessage") closeOverlay();
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlay(); });
