// Runs in the page's MAIN world at document_start so it can observe real page
// activity (console, errors, fetch/XHR). It CANNOT use chrome.* APIs, so it
// forwards everything to the ISOLATED content script via window.postMessage.
// content.js relays those messages to the extension.

(() => {
  if (window.__protestMonitorLoaded) return;
  window.__protestMonitorLoaded = true;

  const CHANNEL = "__PROTEST_LOG__";

  function emit(entry) {
    try {
      window.postMessage({ __protest: CHANNEL, entry: { ...entry, ts: Date.now() } }, "*");
    } catch (_) {
      /* posting failed (e.g. non-cloneable data) — ignore */
    }
  }

  // --- uncaught errors ---
  window.addEventListener("error", (e) => {
    emit({
      type: "console",
      level: "error",
      message: `${e.message} @ ${e.filename || ""}:${e.lineno || 0}`,
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason && (e.reason.message || String(e.reason));
    emit({ type: "console", level: "error", message: `Unhandled promise rejection: ${reason}` });
  });

  // --- console.error / console.warn passthrough ---
  ["error", "warn"].forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      try {
        emit({
          type: "console",
          level,
          message: args
            .map((a) => (typeof a === "string" ? a : safeStringify(a)))
            .join(" ")
            .slice(0, 1000),
        });
      } catch (_) {}
      return original(...args);
    };
  });

  // --- fetch: log every request (success and failure) with timing + a
  // truncated text/json body preview, so the side panel's Network log can
  // show full traffic, not just errors. ---
  if (window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      const method = ((args[1] && args[1].method) || (args[0] && args[0].method) || "GET").toUpperCase();
      const start = Date.now();
      try {
        const res = await originalFetch(...args);
        const duration = Date.now() - start;
        const body = await safeBodyPreview(res.clone());
        emit({
          type: "network",
          level: res.ok ? "info" : "error",
          message: `${method} ${res.status} ${res.statusText} — ${url} (${duration}ms)`,
          detail: { method, url, status: res.status, duration, body },
        });
        return res;
      } catch (err) {
        const duration = Date.now() - start;
        emit({
          type: "network",
          level: "error",
          message: `${method} FAILED — ${url} (${err.message})`,
          detail: { method, url, status: 0, duration, body: null },
        });
        throw err;
      }
    };
  }

  async function safeBodyPreview(res) {
    try {
      const ct = res.headers.get("content-type") || "";
      if (!/json|text/i.test(ct)) return null;
      const len = parseInt(res.headers.get("content-length") || "0", 10);
      if (len && len > 200000) return "[body too large to preview]";
      const text = await res.text();
      return text.length > 2000 ? text.slice(0, 2000) + "…" : text;
    } catch (_) {
      return null;
    }
  }

  // --- XHR: same full logging (success + failure) with timing/body preview ---
  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR) {
    const open = OrigXHR.prototype.open;
    const send = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function (method, url, ...rest) {
      this.__protestUrl = url;
      this.__protestMethod = (method || "GET").toUpperCase();
      return open.call(this, method, url, ...rest);
    };
    OrigXHR.prototype.send = function (...args) {
      const start = Date.now();
      this.addEventListener("loadend", () => {
        const duration = Date.now() - start;
        const ok = this.status >= 200 && this.status < 400;
        let body = null;
        try {
          const ct = this.getResponseHeader("content-type") || "";
          if (/json|text/i.test(ct) && typeof this.responseText === "string") {
            body = this.responseText.length > 2000 ? this.responseText.slice(0, 2000) + "…" : this.responseText;
          }
        } catch (_) {
          /* responseType wasn't text — skip preview */
        }
        emit({
          type: "network",
          level: ok ? "info" : "error",
          message: `${this.__protestMethod || "GET"} ${this.status || 0} — ${this.__protestUrl || ""} (${duration}ms)`,
          detail: { method: this.__protestMethod, url: this.__protestUrl, status: this.status, duration, body },
        });
      });
      return send.apply(this, args);
    };
  }

  function safeStringify(obj) {
    try {
      return JSON.stringify(obj);
    } catch (_) {
      return String(obj);
    }
  }
})();
