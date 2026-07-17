// Report viewer: an extension page that renders a session's report and can
// auto-open the print dialog (Save as PDF). It reuses the single report builder
// in lib/report.js and injects the result via the DOM (assigning innerHTML does
// NOT execute scripts, so we stay within the extension-pages CSP).

import * as store from "../lib/storage.js";
import { buildHtmlReport } from "../lib/report.js";

const params = new URLSearchParams(location.search);
const sessionId = params.get("id");
const wantsPrint = params.get("print") === "1";

(async () => {
  const sessions = await store.getSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    document.getElementById("loading").textContent = "Report not found — the session may have been deleted.";
    return;
  }

  // Build the full HTML once, then transplant its <style>/<title> and body into
  // this page's document.
  const html = buildHtmlReport(session);
  const parsed = new DOMParser().parseFromString(html, "text/html");

  parsed.head.querySelectorAll("style, title").forEach((node) => document.head.appendChild(node.cloneNode(true)));
  document.title = parsed.title || "QA Report";
  document.body.innerHTML = parsed.body.innerHTML;

  if (wantsPrint) {
    // Wait for images to lay out before invoking print.
    setTimeout(() => window.print(), 500);
  }
})();
