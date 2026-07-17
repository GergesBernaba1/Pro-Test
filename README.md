# ProTest QA — Web Testing & QA Companion

A Manifest V3 Chrome extension that helps QA testers and developers test web
features faster: run edge-case checklists, inject test data into forms, overlay
a UX reference on the live page, capture annotated screenshots, record test
steps with pass/fail evidence, and export a polished HTML / PDF / Jira-Markdown
report — all from a side panel that lives next to the page under test.

> Suggested product name: **ProTest QA** (the brief proposed "EdgeTestr QA").
> Rename freely in `manifest.json` → `name`.

---

## ✨ Features

| Area | What you get |
|------|--------------|
| **Session management** | Create/load/delete sessions, each with a **User Story field that accepts either a link or the story text itself**, a Target URL, tester name, notes, and a UX reference screenshot. Everything auto-saves to `chrome.storage.local`. |
| **Element inspector** | Hover to highlight any element; click to copy a stable CSS selector. |
| **Test-data injector** (Bug Magnet style) | One click fills the focused field (or every field) with edge-case values: empty/whitespace, long text, numbers, special chars, emoji/RTL, inert XSS/SQL probes, format strings, and more. |
| **Fake identity fill** | Smart-fills a whole form (name, email, phone, password, address…) by matching field roles. |
| **UX overlay** | Overlays your uploaded reference screenshot semi-transparently on the live page — adjust opacity, scale, drag to align, or switch to `difference` blend to spot pixel diffs. |
| **Screenshot + annotator** | Capture the visible tab and mark it up with rectangles, arrows, text, and **blur/redaction**, then attach it to a step or bug. |
| **Test steps** | Record steps with PASS / FAIL / BLOCKED status, notes, and screenshots. |
| **Edge-case checklist** | Load a categorized template (validation, security, a11y, responsive…) and tick items off. |
| **Bug log** | Capture findings with severity + description + screenshot. |
| **Console/network capture** | Automatically records JS errors and failed fetch/XHR requests on the target page. |
| **Reports** | Generate a beautiful standalone **HTML** report, **download** it, **print/Save-as-PDF**, or **copy Jira-flavoured Markdown**. |
| **AI helper** | One-click copy of a ready-made "generate edge cases for this user story" prompt. |
| **Dark / light theme** | Toggle in the header; preference is remembered. |
| **Full-page screenshot** | Scrolls and stitches the whole page (not just the viewport) into one image, then opens it in the annotator. |
| **Session export / import** | Export a session to a `.json` file to share with a teammate or back up; import it back in on any machine. |
| **Accessibility quick-check** | A lightweight heuristic scanner: missing `alt` text, unlabeled form fields, empty link/button names, duplicate ids, missing `lang`/`<title>`, and low text-contrast (WCAG AA). Not a full audit — see caveat below. |
| **Jira / TFS bug filing** | One click on a bug turns it into a real Jira issue **or an Azure DevOps / TFS work item** (with the screenshot attached), using credentials you configure in **⚙ Settings**. Both trackers can be configured at once — each bug gets independent "File in Jira" and "File in TFS" buttons. |
| **Viewport presets** | Resize the browser window to mobile/tablet/desktop breakpoints for quick responsive checks. |
| **Full network log** | The Report tab's log viewer can show **every** request (not just failures) with method, status, timing, and an expandable body preview — kept in memory only, not persisted. |
| **Step templates** | Save a session's steps as a reusable named template (e.g. "Login flow") and insert it into any future session. |
| **API tester (Swagger/OpenAPI)** | Load a Swagger 2.0 / OpenAPI 3.x spec (by URL or pasted JSON), pick an endpoint, fill in parameters/headers/body, and send a real request from the panel — status, timing, and response body included. Send a failing call straight to the bug log, or copy it as a `curl` command. |

---

## 🚀 Load it unpacked (development)

1. Open **`chrome://extensions`** (works in Edge at `edge://extensions` too).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select this project folder (the one containing `manifest.json`).
5. Pin **ProTest QA** from the puzzle-piece menu.
6. Click the icon (or press the shortcut) to open the side panel.

No build step, no `npm install` — it's plain ES modules + CSS and runs as-is.
Requires **Chrome/Edge 114+** (for the side panel + MV3 `world: "MAIN"` script).

### Keyboard shortcuts

| Action | Default | Notes |
|--------|---------|-------|
| Open the panel | `Ctrl+Shift+Y` | |
| Capture + annotate screenshot | `Ctrl+Shift+U` | |
| Toggle element inspector | `Ctrl+Shift+K` | |

> The brief asked for `Ctrl+Shift+T` / `Ctrl+Shift+S`, but Chrome reserves those
> (reopen-tab / save-page). Re-map any shortcut at **`chrome://extensions/shortcuts`**.

---

## 🧭 Suggested workflow

1. **Start a session** — paste the Jira/user-story URL and the target page URL, add your name, and drop in the UX screenshot (drag, paste, or browse).
2. **Go to the target page** and open the panel.
3. **Test** — use the inspector, inject edge-case data, and toggle the UX overlay to compare against the design.
4. **Capture evidence** — screenshot + annotate, attach to steps/bugs, set pass/fail.
5. **Generate the report** — open/download HTML, Save-as-PDF, or copy Markdown into Jira.

---

## 📁 Project structure

```
Pro-Test/
├── manifest.json                 # MV3 manifest (permissions, entry points, commands)
├── README.md
├── assets/
│   └── icons/                    # 16/32/48/128 PNG icons
└── src/
    ├── background/
    │   └── service-worker.js     # commands, screenshot capture, annotator handoff
    ├── content/
    │   ├── monitor.js            # MAIN world: captures console/fetch/XHR errors
    │   ├── content.js            # ISOLATED world: inspector, injector, UX overlay
    │   └── content.css           # in-page tool styles
    ├── sidepanel/
    │   ├── sidepanel.html        # tabbed side-panel UI
    │   ├── sidepanel.css
    │   └── sidepanel.js          # main controller
    ├── annotator/
    │   ├── annotator.html        # screenshot editor
    │   ├── annotator.css
    │   └── annotator.js          # canvas: rect / arrow / text / blur
    ├── report/
    │   ├── report.html           # report viewer (CSP-safe print/PDF)
    │   └── report.js

    ├── lib/
    │   ├── messages.js           # shared message-type constants + edge-case template
    │   ├── storage.js            # chrome.storage session + template helpers
    │   ├── testdata.js           # Bug Magnet test-data catalog + fake identities
    │   ├── report.js             # HTML / Markdown / AI-prompt generators
    │   ├── jira.js                # Jira Cloud REST v3 client (issue + attachment)
    │   ├── tfs.js                  # Azure DevOps / TFS REST client (work item + attachment)
    │   └── openapi.js             # Swagger 2.0 / OpenAPI 3.x parser for the API tester
    └── styles/
        └── theme.css             # design tokens + shared primitives (dark/light)
```

### How the pieces talk

- **`monitor.js`** runs in the page's MAIN world at `document_start` and wraps
  `console.error/warn`, `window.onerror`, `fetch`, and `XHR`. It can't use
  `chrome.*`, so it `postMessage`s events to…
- **`content.js`** (ISOLATED world), which relays those logs to the extension and
  executes tool commands (inspector, injector, overlay) sent from the panel.
- **`sidepanel.js`** owns the active session and sends commands to the active
  tab, injecting `content.js` on demand if a page loaded before the extension.
- **`service-worker.js`** handles privileged work: `captureVisibleTab`, opening
  the annotator tab, and handing the screenshot to it.

---

## 🔒 Permissions & privacy

- `sidePanel`, `tabs`, `activeTab`, `scripting` — open the panel and run the
  in-page tools on the tab you're testing.
- `storage` + `unlimitedStorage` — save sessions and screenshots **locally**.
- `host_permissions: <all_urls>` — needed for `captureVisibleTab` and to run the
  tools on any page under test.

**All data stays on your machine** in `chrome.storage.local`, *except* the one
feature that's explicitly cross-boundary by design: **Jira filing**. Clicking
"File in Jira" (or "File in TFS") on a bug sends that bug's
title/description/severity/screenshot directly from your browser to the Jira
base URL, or the Azure DevOps/TFS organization URL, you configured — using
the email + API token (Jira) or Personal Access Token (TFS) entered in
**⚙ Settings**, both over Basic Auth per each platform's own REST API. Nothing
is sent anywhere else, and nothing is sent automatically — only on that
explicit per-bug click, with a confirmation dialog first. Your Jira/TFS
credentials are stored unencrypted in `chrome.storage.local`, same as
everything else the extension keeps — don't use this on a shared machine you
don't trust. The two integrations are independent; configure one, both, or
neither.

The "AI edge-case ideas" feature only *copies a prompt to your clipboard* — it
does not call any API. The XSS/SQL entries in the test-data catalog are
**inert probe strings** you paste into your own app to verify it
escapes/validates input; they execute nothing by themselves. The **Network
log's "All requests" view** can capture response bodies (truncated to 2KB,
text/JSON only) to help debug API-heavy features — this is kept in memory
only for the current panel session and is never written to disk or included
in the exported report; only the persisted error/warning log is.

Browser/system pages (`chrome://`, the Web Store, `edge://`) block content
scripts and screenshots — the panel will tell you when a tool can't run there.

---

## ⚠️ Feature caveats

- **Full-page screenshot** captures up to 15 viewport-height slices (a ~450ms
  gap between each, to respect Chrome's screenshot rate limit) and stitches
  them client-side. Extremely tall infinite-scroll pages will be truncated —
  you'll get a toast saying so.
- **Viewport presets** resize the actual browser *window* via
  `chrome.windows.update`; this is an approximation, not pixel-perfect device
  emulation (window chrome eats a bit of the requested size). True emulation
  would need the `debugger` permission, which shows an intrusive "this
  extension is debugging your browser" banner — skipped deliberately to keep
  the extension lightweight and non-alarming.
- **Accessibility quick-check** is a heuristic scanner covering the highest-signal,
  most common issues (missing alt text, unlabeled inputs, empty link/button
  names, duplicate ids, missing `lang`/title, contrast). It is **not** a
  replacement for a full WCAG audit tool like axe-core.
- **TFS/Azure DevOps filing** targets the modern `_apis/wit/workitems` REST API
  with a configurable `api-version` (default `6.0`). Azure DevOps Services and
  recent Azure DevOps Server / TFS versions are REST-compatible with this; very
  old on-prem TFS installations (2015/2017-era) may need a lower API version —
  adjust the "API version" field in **⚙ Settings** if "Test connection" fails.
- **API tester** parses **JSON** Swagger/OpenAPI specs only — YAML specs need to
  be converted first (most Swagger UIs expose a `?format=json` or `.json`
  variant of the same spec). `$ref` resolution is shallow and depth-capped
  (covers the common case; very complex `allOf`/`oneOf` schemas may produce an
  incomplete example body — the body is always editable before sending).
  Requests go straight from the side panel to the API using the same
  `<all_urls>` host permission that powers screenshots and Jira filing — no
  separate proxy or extra permission involved. Auth (bearer tokens, API keys)
  is entered manually as an extra header; the spec's declared security
  schemes aren't auto-applied.

---

## 🛠️ Ideas to iterate on

- Persist the live network log across panel closes (move capture into the worker).
- Wire the AI prompt to a real API (e.g. the Claude API) behind a settings key.
- Pixel-perfect device emulation via the `debugger` API (opt-in, with the banner).
- Migrate the UI to React + TypeScript + Tailwind with a Vite/CRXJS build if the
  project grows — the current vanilla modules map cleanly onto components.

---

## Regenerating the icons

The PNG icons were generated with `System.Drawing`. To re-create them, re-run the
icon-generation step (a purple rounded square with a white check) or drop your own
`icon16/32/48/128.png` into `assets/icons/`.
