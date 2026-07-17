// Report generation: turns a session object into (a) a standalone, printable
// HTML document, (b) Jira-flavoured Markdown, and (c) an AI prompt for
// brainstorming edge cases. Everything here is pure — no DOM/chrome access —
// so it is easy to unit test later.

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The "user story" field accepts either a link (Jira/Confluence/requirements
// doc) or the story text itself pasted directly — render each appropriately.
function isUrl(str) {
  return /^(https?:\/\/|www\.)/i.test((str || "").trim());
}

function renderUserStoryHtml(text) {
  if (isUrl(text)) return `User story: <a href="${esc(text)}">${esc(text)}</a><br/>`;
  return `User story:<br/><span class="story-text">${esc(text).replace(/\n/g, "<br/>")}</span><br/>`;
}

function statusBadge(status) {
  const map = {
    pass: ["PASS", "#0f9d58", "#e6f4ea"],
    fail: ["FAIL", "#d93025", "#fce8e6"],
    blocked: ["BLOCKED", "#e37400", "#fef7e0"],
    untested: ["UNTESTED", "#5f6368", "#f1f3f4"],
  };
  const [label, fg, bg] = map[status] || map.untested;
  return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;color:${fg};background:${bg}">${label}</span>`;
}

function severityBadge(sev) {
  const map = {
    critical: "#d93025",
    high: "#e8710a",
    medium: "#f9ab00",
    low: "#1a73e8",
  };
  const color = map[sev] || "#5f6368";
  return `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:12px;font-weight:700;color:#fff;background:${color}">${esc((sev || "info").toUpperCase())}</span>`;
}

function summarize(session) {
  const steps = session.steps || [];
  return {
    total: steps.length,
    pass: steps.filter((s) => s.status === "pass").length,
    fail: steps.filter((s) => s.status === "fail").length,
    blocked: steps.filter((s) => s.status === "blocked").length,
    findings: (session.findings || []).length,
    edgeChecked: (session.edgeCases || []).filter((e) => e.checked).length,
    edgeTotal: (session.edgeCases || []).length,
  };
}

// ---- HTML report -----------------------------------------------------------

export function buildHtmlReport(session) {
  const s = summarize(session);
  const generated = new Date().toLocaleString();

  const stepsHtml = (session.steps || [])
    .map(
      (step, i) => `
      <div class="card">
        <div class="card-head">
          <div><span class="num">${i + 1}</span> ${esc(step.title || "Untitled step")}</div>
          ${statusBadge(step.status)}
        </div>
        ${step.notes ? `<p class="notes">${esc(step.notes)}</p>` : ""}
        ${step.screenshot ? `<img class="shot" src="${step.screenshot}" alt="Step ${i + 1} screenshot"/>` : ""}
      </div>`
    )
    .join("");

  const findingsHtml = (session.findings || [])
    .map(
      (f) => `
      <div class="card">
        <div class="card-head">
          <div>${esc(f.title || "Finding")}</div>
          ${severityBadge(f.severity)}
        </div>
        ${f.description ? `<p class="notes">${esc(f.description)}</p>` : ""}
        ${f.screenshot ? `<img class="shot" src="${f.screenshot}" alt="Finding screenshot"/>` : ""}
      </div>`
    )
    .join("") || `<p class="muted">No bugs recorded — nice.</p>`;

  const edgeHtml = (session.edgeCases || [])
    .map(
      (e) => `<li class="${e.checked ? "done" : ""}">${e.checked ? "✓" : "○"} ${esc(e.label)}${e.notes ? ` — <span class="muted">${esc(e.notes)}</span>` : ""}</li>`
    )
    .join("") || `<li class="muted">No edge cases tracked.</li>`;

  const logsHtml = (session.logs || [])
    .slice(0, 100)
    .map(
      (l) => `<tr><td>${esc(l.type)}</td><td>${esc(l.level || "")}</td><td class="mono">${esc(l.message || "")}</td></tr>`
    )
    .join("") || `<tr><td colspan="3" class="muted">No console/network issues captured.</td></tr>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>QA Report — ${esc(session.name)}</title>
<style>
  :root{--bg:#f6f8fa;--card:#fff;--ink:#1f2328;--muted:#656d76;--line:#d0d7de;--brand:#4f46e5}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
  .wrap{max-width:900px;margin:0 auto;padding:32px 20px 64px}
  header{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border-radius:16px;padding:28px 30px;margin-bottom:24px}
  header h1{margin:0 0 6px;font-size:26px}
  header .meta{opacity:.9;font-size:14px}
  a{color:#fff;text-decoration:underline}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:24px 0}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;text-align:center}
  .stat b{display:block;font-size:26px;line-height:1.1}
  .stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  h2{font-size:18px;margin:32px 0 12px;padding-bottom:8px;border-bottom:2px solid var(--line)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px}
  .card-head{display:flex;justify-content:space-between;align-items:center;gap:12px;font-weight:600}
  .num{display:inline-block;min-width:22px;height:22px;line-height:22px;text-align:center;background:var(--brand);color:#fff;border-radius:6px;font-size:12px;margin-right:6px}
  .notes{margin:10px 0 0;color:var(--muted);white-space:pre-wrap}
  .shot{display:block;max-width:100%;border:1px solid var(--line);border-radius:8px;margin-top:12px}
  ul.edge{list-style:none;padding:0;columns:2;gap:24px}
  ul.edge li{margin:4px 0;break-inside:avoid}
  ul.edge li.done{color:#0f9d58}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);font-size:13px}
  th{background:#f1f3f4}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-word}
  .muted{color:var(--muted)}
  .story-text{display:inline-block;margin-top:4px}
  .ref{display:flex;gap:20px;flex-wrap:wrap}
  .ref figure{margin:0;flex:1;min-width:260px}
  .ref img{max-width:100%;border:1px solid var(--line);border-radius:8px}
  footer{margin-top:40px;text-align:center;color:var(--muted);font-size:12px}
  @media print{body{background:#fff}header{-webkit-print-color-adjust:exact;print-color-adjust:exact}.card,.stat{break-inside:avoid}}
</style></head>
<body><div class="wrap">
  <header>
    <h1>${esc(session.name)}</h1>
    <div class="meta">
      Tester: <b>${esc(session.testerName || "—")}</b> &nbsp;•&nbsp; Generated: ${esc(generated)}<br/>
      ${session.userStoryUrl ? renderUserStoryHtml(session.userStoryUrl) : ""}
      ${session.targetUrl ? `Target page: <a href="${esc(session.targetUrl)}">${esc(session.targetUrl)}</a>` : ""}
    </div>
  </header>

  <div class="grid">
    <div class="stat"><b>${s.total}</b><span>Steps</span></div>
    <div class="stat"><b style="color:#0f9d58">${s.pass}</b><span>Passed</span></div>
    <div class="stat"><b style="color:#d93025">${s.fail}</b><span>Failed</span></div>
    <div class="stat"><b style="color:#e37400">${s.blocked}</b><span>Blocked</span></div>
    <div class="stat"><b>${s.findings}</b><span>Bugs</span></div>
    <div class="stat"><b>${s.edgeChecked}/${s.edgeTotal}</b><span>Edge cases</span></div>
  </div>

  ${session.notes ? `<h2>Notes</h2><div class="card"><p class="notes">${esc(session.notes)}</p></div>` : ""}

  ${session.screenshot ? `<h2>UX reference</h2><div class="ref"><figure><img src="${session.screenshot}" alt="UX reference"/></figure></div>` : ""}

  <h2>Test steps</h2>
  ${stepsHtml || `<p class="muted">No steps recorded.</p>`}

  <h2>Findings &amp; bugs</h2>
  ${findingsHtml}

  <h2>Edge cases tested</h2>
  <ul class="edge">${edgeHtml}</ul>

  <h2>Console &amp; network log</h2>
  <table><thead><tr><th>Type</th><th>Level</th><th>Message</th></tr></thead><tbody>${logsHtml}</tbody></table>

  <footer>Generated by ProTest QA · ${esc(generated)}</footer>
</div></body></html>`;
}

// ---- Jira / Markdown -------------------------------------------------------

export function buildMarkdown(session) {
  const s = summarize(session);
  const lines = [];
  lines.push(`# QA Report: ${session.name}`);
  lines.push("");
  lines.push(`- **Tester:** ${session.testerName || "—"}`);
  if (session.userStoryUrl) {
    if (isUrl(session.userStoryUrl)) lines.push(`- **User story:** ${session.userStoryUrl}`);
    else lines.push(`- **User story:**`, "", `> ${session.userStoryUrl.split("\n").join("\n> ")}`, "");
  }
  if (session.targetUrl) lines.push(`- **Target page:** ${session.targetUrl}`);
  lines.push(`- **Result:** ${s.pass} passed · ${s.fail} failed · ${s.blocked} blocked · ${s.findings} bugs`);
  lines.push("");
  if (session.notes) {
    lines.push(`## Notes`, "", session.notes, "");
  }
  lines.push(`## Test steps`, "");
  (session.steps || []).forEach((st, i) => {
    const mark = { pass: "✅", fail: "❌", blocked: "⛔", untested: "⬜" }[st.status] || "⬜";
    lines.push(`${i + 1}. ${mark} **${st.title || "Untitled"}**${st.notes ? ` — ${st.notes}` : ""}`);
  });
  if (!(session.steps || []).length) lines.push("_No steps recorded._");
  lines.push("");
  lines.push(`## Findings`, "");
  (session.findings || []).forEach((f) => {
    lines.push(`- \`${(f.severity || "info").toUpperCase()}\` **${f.title || "Finding"}**${f.description ? ` — ${f.description}` : ""}`);
  });
  if (!(session.findings || []).length) lines.push("_No bugs recorded._");
  lines.push("");
  lines.push(`## Edge cases`, "");
  (session.edgeCases || []).forEach((e) => {
    lines.push(`- [${e.checked ? "x" : " "}] ${e.label}${e.notes ? ` — ${e.notes}` : ""}`);
  });
  lines.push("");
  return lines.join("\n");
}

// ---- AI prompt helper ------------------------------------------------------

export function buildAiPrompt(session) {
  return `You are a senior QA engineer. Given the user story and page below, generate a
thorough list of edge cases, negative tests, and boundary conditions to verify.
Group them by category (validation, security, performance, accessibility, state/flow,
localization). For each, give: the test idea, the exact input to try, and the expected
correct behaviour.

USER STORY: ${session.userStoryUrl || "(not provided)"}
TARGET PAGE: ${session.targetUrl || "(url not provided)"}
TESTER NOTES: ${session.notes || "(none)"}

Return the result as a Markdown checklist I can paste into my test tool.`;
}
