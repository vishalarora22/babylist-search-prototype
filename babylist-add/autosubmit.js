// Runs in the page (MAIN world) of https://www.babylist.com/bookmarklet/ — Babylist's own
// "Add to Babylist" screen — but only when the extension opened it for a one-click add
// (frame.js adds the "#bl-ext-auto" fragment to the URL; a fragment never reaches Babylist's
// server). It clicks Babylist's own save button, so Babylist's code does the save, and
// reports each step plus whether the save request succeeded.
//
// Babylist's form (display-bookmarklet.js) saves with jQuery:
//   $("#btn-save").click → $.ajax({ url: "/registry/save_item", type: "POST", ... })
(() => {
  if (location.hash !== "#bl-ext-auto" || window.top === window) return;

  const post = (msg) => window.parent.postMessage(JSON.stringify({ type: "bl-ext-autosubmit", ...msg }), "*");
  const stage = (name) => post({ stage: name });
  let reported = false;
  const report = (msg) => {
    if (reported) return;
    reported = true;
    post({ stage: msg.ok ? "saved" : `failed:${msg.reason || msg.status}`, ...msg, done: true });
  };
  stage("loaded");

  const isSaveRequest = (url, method) =>
    String(method).toUpperCase() === "POST" &&
    /\/registry\/save_item(?:[?#]|$)|\/api\/v3\/registries\/[^/]+\/reg_items(?:[?#]|$)/.test(String(url));

  // jQuery $.ajax uses XMLHttpRequest.
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__blWatch = isSaveRequest(url, method);
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__blWatch) {
      this.addEventListener("loadend", () => {
        const ok = this.status >= 200 && this.status < 300;
        report(ok ? { ok: true, status: this.status } : { ok: false, status: this.status, reason: "save-failed" });
      });
    }
    return origSend.apply(this, arguments);
  };

  // In case a newer version of the form switches to fetch.
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = (init && init.method) || (input && input.method) || "GET";
    const watch = isSaveRequest(url, method);
    try {
      const res = await origFetch.apply(this, arguments);
      if (watch) report({ ok: res.ok, status: res.status });
      return res;
    } catch (err) {
      if (watch) report({ ok: false, reason: "network" });
      throw err;
    }
  };

  const findSaveButton = () =>
    document.getElementById("btn-save") ||
    Array.from(document.querySelectorAll("button, input[type=submit]")).find((b) =>
      /^add to (babylist|registry)$/i.test((b.textContent || b.value || "").trim())
    );

  const started = Date.now();
  let clickedAt = 0;
  const timer = setInterval(() => {
    if (reported) return clearInterval(timer);
    if (clickedAt) {
      // Clicked but no save request went out (e.g. a validation error): hand over to the user.
      if (Date.now() - clickedAt > 5000) { clearInterval(timer); report({ ok: false, reason: "no-save" }); }
      return;
    }
    const btn = findSaveButton();
    const ready = btn && !btn.disabled && btn.offsetParent !== null;
    if (ready) {
      stage("form-ready");
      clickedAt = Date.now();
      btn.click();
      stage("clicked");
    } else if (Date.now() - started > 8000) {
      // No add form (e.g. Babylist is asking the user to sign in).
      clearInterval(timer);
      report({ ok: false, reason: "no-form" });
    }
  }, 250);
})();
