// Side-panel controller. Owns the active session (an in-memory object that is
// debounce-persisted to chrome.storage), renders every tab, and talks to the
// content script / background for the in-page tools and screenshots.

import * as store from "../lib/storage.js";
import { MSG, EDGE_CASE_TEMPLATE } from "../lib/messages.js";
import { flattenTestData, fakeIdentity } from "../lib/testdata.js";
import { buildHtmlReport, buildMarkdown, buildAiPrompt } from "../lib/report.js";
import { isJiraConfigured, createJiraIssue, attachScreenshot, testJiraConnection } from "../lib/jira.js";
import { isTfsConfigured, createTfsBug, attachScreenshotTfs, testTfsConnection } from "../lib/tfs.js";
import { parseSpec } from "../lib/openapi.js";

// ---- state -----------------------------------------------------------------
let session = null; // the active session object
let pendingAnnotateTarget = null; // { kind: 'ux'|'step'|'bug', id? } awaiting an annotated screenshot
let logFilter = "errors"; // 'errors' | 'all' — which set the Report tab's log viewer shows
let liveLogs = []; // ALL network/console entries seen this panel session (in-memory only, not persisted)
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ============================================================================
// Boot
// ============================================================================
document.addEventListener("DOMContentLoaded", init);

async function init() {
  await applyTheme();
  wireTabs();
  wireHeader();
  wireSettings();
  wireSessionForm();
  wireExportImport();
  wireTools();
  wireViewportPresets();
  wireA11y();
  wireApiTester();
  wireSteps();
  wireTemplates();
  wireEdge();
  wireBugs();
  wireReport();
  wireRuntimeMessages();

  await loadSessions();
  renderStorageInfo();
}

// ============================================================================
// Theme
// ============================================================================
async function applyTheme() {
  const { theme } = await store.getSettings();
  setTheme(theme);
}
function setTheme(theme) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}

// ============================================================================
// Tabs & header
// ============================================================================
function wireTabs() {
  $("#tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    const name = tab.dataset.tab;
    $$(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
  });
}

function wireHeader() {
  $("#themeToggle").addEventListener("click", async () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    setTheme(next);
    await store.saveSettings({ theme: next });
  });
}

// ============================================================================
// Settings drawer (Jira integration)
// ============================================================================
function wireSettings() {
  const drawer = $("#settingsDrawer");

  $("#trackerTabJira").addEventListener("click", () => setTrackerTab("jira"));
  $("#trackerTabTfs").addEventListener("click", () => setTrackerTab("tfs"));

  $("#settingsToggle").addEventListener("click", async () => {
    const s = await store.getSettings();
    $("#jiraBaseUrl").value = s.jiraBaseUrl || "";
    $("#jiraProjectKey").value = s.jiraProjectKey || "";
    $("#jiraEmail").value = s.jiraEmail || "";
    $("#jiraApiToken").value = s.jiraApiToken || "";
    $("#jiraStatus").textContent = "";
    $("#tfsOrgUrl").value = s.tfsOrgUrl || "";
    $("#tfsProject").value = s.tfsProject || "";
    $("#tfsPat").value = s.tfsPat || "";
    $("#tfsApiVersion").value = s.tfsApiVersion || "6.0";
    $("#tfsStatus").textContent = "";
    // Open on whichever tracker already has credentials, so returning users
    // land where they left off rather than always on Jira.
    setTrackerTab(isTfsConfigured(s) && !isJiraConfigured(s) ? "tfs" : "jira");
    drawer.hidden = false;
  });
  $("#closeSettings").addEventListener("click", () => (drawer.hidden = true));

  $("#saveJiraSettings").addEventListener("click", async () => {
    await store.saveSettings(currentJiraFields());
    toast("Jira settings saved");
    renderBugs(); // refresh "File in Jira" availability
  });

  $("#testJiraConnection").addEventListener("click", async () => {
    const fields = currentJiraFields();
    if (!isJiraConfigured(fields)) {
      $("#jiraStatus").textContent = "Fill in all fields first.";
      return;
    }
    $("#jiraStatus").textContent = "Testing…";
    try {
      const who = await testJiraConnection(fields);
      $("#jiraStatus").textContent = `✓ Connected as ${who}`;
    } catch (e) {
      $("#jiraStatus").textContent = `✗ ${e.message}`;
    }
  });

  $("#saveTfsSettings").addEventListener("click", async () => {
    await store.saveSettings(currentTfsFields());
    toast("TFS settings saved");
    renderBugs(); // refresh "File in TFS" availability
  });

  $("#testTfsConnection").addEventListener("click", async () => {
    const fields = currentTfsFields();
    if (!isTfsConfigured(fields)) {
      $("#tfsStatus").textContent = "Fill in the org URL, project, and PAT first.";
      return;
    }
    $("#tfsStatus").textContent = "Testing…";
    try {
      const who = await testTfsConnection(fields);
      $("#tfsStatus").textContent = `✓ Connected to project "${who}"`;
    } catch (e) {
      $("#tfsStatus").textContent = `✗ ${e.message}`;
    }
  });
}

function currentJiraFields() {
  return {
    jiraBaseUrl: $("#jiraBaseUrl").value.trim(),
    jiraProjectKey: $("#jiraProjectKey").value.trim(),
    jiraEmail: $("#jiraEmail").value.trim(),
    jiraApiToken: $("#jiraApiToken").value.trim(),
  };
}

function currentTfsFields() {
  return {
    tfsOrgUrl: $("#tfsOrgUrl").value.trim(),
    tfsProject: $("#tfsProject").value.trim(),
    tfsPat: $("#tfsPat").value.trim(),
    tfsApiVersion: $("#tfsApiVersion").value.trim() || "6.0",
  };
}

function setTrackerTab(tracker) {
  $("#trackerTabJira").classList.toggle("active", tracker === "jira");
  $("#trackerTabTfs").classList.toggle("active", tracker === "tfs");
  $("#jiraSettingsPanel").hidden = tracker !== "jira";
  $("#tfsSettingsPanel").hidden = tracker !== "tfs";
}

// ============================================================================
// Sessions
// ============================================================================
async function loadSessions() {
  const sessions = await store.getSessions();
  let active = await store.getActiveSession();
  if (!active && sessions.length) {
    active = sessions[0];
    await store.setActiveSession(active.id);
  }
  if (!active) {
    active = await store.createSession({ testerName: "" });
  }
  session = active;
  renderSessionSelect(sessions.length ? sessions : [session]);
  fillForm();
  renderAll();
}

function renderSessionSelect(sessions) {
  const sel = $("#sessionSelect");
  sel.innerHTML = "";
  sessions.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    opt.selected = s.id === session.id;
    sel.appendChild(opt);
  });
}

function wireSessionForm() {
  $("#newSessionBtn").addEventListener("click", async () => {
    session = await store.createSession({ testerName: session?.testerName || "" });
    await loadSessions();
    toast("New session created");
  });

  $("#sessionSelect").addEventListener("change", async (e) => {
    await store.setActiveSession(e.target.value);
    session = await store.getActiveSession();
    fillForm();
    renderAll();
  });

  $("#deleteSessionBtn").addEventListener("click", async () => {
    if (!confirm(`Delete session "${session.name}"? This cannot be undone.`)) return;
    await store.deleteSession(session.id);
    await loadSessions();
    toast("Session deleted");
  });

  // Bind text fields with debounced autosave.
  const map = {
    fName: "name",
    fStory: "userStoryUrl",
    fTarget: "targetUrl",
    fTester: "testerName",
    fNotes: "notes",
  };
  for (const [id, key] of Object.entries(map)) {
    $("#" + id).addEventListener("input", (e) => {
      session[key] = e.target.value;
      if (key === "name") {
        $("#sessionName").textContent = e.target.value || "Untitled session";
        const opt = $("#sessionSelect").selectedOptions[0];
        if (opt) opt.textContent = e.target.value;
      }
      persistSoon();
    });
  }

  $("#useCurrentUrl").addEventListener("click", async () => {
    const tab = await getActiveTab();
    if (tab?.url) {
      $("#fTarget").value = tab.url;
      session.targetUrl = tab.url;
      persistSoon();
    }
  });

  wireUxDropzone();
}

function fillForm() {
  $("#fName").value = session.name || "";
  $("#fStory").value = session.userStoryUrl || "";
  $("#fTarget").value = session.targetUrl || "";
  $("#fTester").value = session.testerName || "";
  $("#fNotes").value = session.notes || "";
  $("#sessionName").textContent = session.name || "Untitled session";
  renderUxPreview();
}

// ---- session export / import -----------------------------------------------
function wireExportImport() {
  $("#exportSessionBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const safe = (session.name || "session").replace(/[^a-z0-9-_]+/gi, "_");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}.protest.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Session exported");
  });

  $("#importSessionBtn").addEventListener("click", () => $("#importSessionFile").click());
  $("#importSessionFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const screenshots = Array.isArray(data.screenshots)
        ? data.screenshots
        : data.screenshot // older export format — a single dataURL
        ? [{ id: store.uid("ux"), name: "UX reference", dataUrl: data.screenshot }]
        : [];
      const imported = store.newSessionObject({
        name: `${data.name || "Imported session"} (imported)`,
        userStoryUrl: data.userStoryUrl,
        targetUrl: data.targetUrl,
        testerName: data.testerName,
        notes: data.notes,
        screenshots,
      });
      imported.steps = Array.isArray(data.steps) ? data.steps : [];
      imported.edgeCases = Array.isArray(data.edgeCases) ? data.edgeCases : [];
      imported.findings = Array.isArray(data.findings) ? data.findings : [];
      imported.logs = Array.isArray(data.logs) ? data.logs : [];
      await store.saveSession(imported);
      await store.setActiveSession(imported.id);
      await loadSessions();
      toast("Session imported");
    } catch (err) {
      toast("Invalid session file");
    }
  });
}

// ---- UX reference gallery (multiple screens per session) -------------------
function wireUxDropzone() {
  const dz = $("#uxDrop");
  const file = $("#uxFile");
  $("#uxBrowse").addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    [...file.files].forEach((f) => addUxImage(f));
    file.value = ""; // allow re-selecting the same file(s) later
  });

  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
    })
  );
  dz.addEventListener("drop", (e) => {
    [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")).forEach((f) => addUxImage(f));
  });
  // Paste one or more images anywhere in the panel.
  document.addEventListener("paste", (e) => {
    [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith("image/")).forEach((i) => addUxImage(i.getAsFile()));
  });
}

async function addUxImage(file) {
  try {
    const dataUrl = await resizeImage(file, 1600, 0.85);
    session.screenshots = session.screenshots || [];
    session.screenshots.push({
      id: store.uid("ux"),
      name: (file.name || "UX reference").replace(/\.[a-z0-9]+$/i, ""),
      dataUrl,
    });
    renderUxPreview();
    persistSoon();
    renderStorageInfo();
    toast("UX reference added");
  } catch (e) {
    toast("Could not read image");
  }
}

function renderUxPreview() {
  const gallery = $("#uxGallery");
  gallery.innerHTML = "";
  const shots = session.screenshots || [];
  if (!shots.length) {
    gallery.innerHTML = `<p class="muted tiny">No UX reference screens yet.</p>`;
  } else {
    shots.forEach((shot) => {
      const item = document.createElement("div");
      item.className = "ux-gallery-item";
      item.innerHTML = `
        <img src="${shot.dataUrl}" alt="${escapeHtml(shot.name)}"/>
        <input class="ux-name" value="${escapeHtml(shot.name)}" title="Rename this screen" />
        <button class="ux-remove" title="Remove">✕</button>`;
      item.querySelector(".ux-name").addEventListener("input", (e) => {
        shot.name = e.target.value;
        persistSoon();
        renderOverlaySourceSelect();
      });
      item.querySelector(".ux-remove").addEventListener("click", () => {
        session.screenshots = session.screenshots.filter((x) => x.id !== shot.id);
        renderUxPreview();
        persistSoon();
        renderStorageInfo();
      });
      gallery.appendChild(item);
    });
  }
  renderOverlaySourceSelect();
}

function renderOverlaySourceSelect() {
  const sel = $("#overlaySource");
  if (!sel) return;
  const shots = session.screenshots || [];
  const prevValue = sel.value;
  sel.innerHTML = "";
  if (!shots.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No UX references — add one in the Session tab";
    sel.appendChild(opt);
    return;
  }
  shots.forEach((shot) => {
    const opt = document.createElement("option");
    opt.value = shot.id;
    opt.textContent = shot.name || "UX reference";
    sel.appendChild(opt);
  });
  if (shots.some((s) => s.id === prevValue)) sel.value = prevValue;
}

// ============================================================================
// Tools
// ============================================================================
function wireTools() {
  $("#toggleInspector").addEventListener("click", () => sendToTab(MSG.TOGGLE_INSPECTOR));
  $("#pickElement").addEventListener("click", () => sendToTab(MSG.START_ELEMENT_PICK));

  $("#toggleOverlay").addEventListener("click", async () => {
    const shots = session.screenshots || [];
    if (!shots.length) return toast("Add a UX reference first (Session tab)");
    const shot = shots.find((s) => s.id === $("#overlaySource").value) || shots[0];
    const res = await sendToTab(MSG.TOGGLE_OVERLAY, { dataUrl: shot.dataUrl });
    if (res?.ok) $("#overlayHint").textContent = res.visible ? "Overlay shown — drag the bar to reposition." : "Overlay hidden.";
  });

  $("#captureBtn").addEventListener("click", () => {
    pendingAnnotateTarget = { kind: "bug" };
    captureAndAnnotate();
  });
  $("#captureFullPageBtn").addEventListener("click", () => captureFullPageAndAnnotate());

  $("#fillIdentity").addEventListener("click", () => fillIdentity());

  // Test-data list.
  renderDataList();
  $("#dataSearch").addEventListener("input", (e) => renderDataList(e.target.value));
}

// ---- viewport presets -------------------------------------------------------
function wireViewportPresets() {
  $$("[data-viewport]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const [w, h] = btn.dataset.viewport.split("x").map(Number);
      const tab = await getActiveTab();
      if (!tab) return;
      chrome.windows.update(tab.windowId, { width: w, height: h }, () => {
        if (chrome.runtime.lastError) toast("Couldn't resize the window");
        else toast(`Resized window to ${w}×${h} (approximate — window chrome takes some of that space)`);
      });
    });
  });
}

// ---- accessibility quick-check ----------------------------------------------
let lastA11yResults = null;

function wireA11y() {
  $("#runA11yBtn").addEventListener("click", async () => {
    const btn = $("#runA11yBtn");
    btn.disabled = true;
    btn.textContent = "Scanning…";
    const res = await sendToTab(MSG.RUN_A11Y_SCAN);
    btn.disabled = false;
    btn.textContent = "Run scan";
    if (!res?.ok) return toast(res?.reason || "Scan failed on this page");
    lastA11yResults = res.issues;
    renderA11yResults(res.issues, res.truncated);
  });

  $("#copyA11yBtn").addEventListener("click", async () => {
    if (!lastA11yResults?.length) return toast("Run a scan first");
    const text = lastA11yResults
      .map((i) => `[${i.severity.toUpperCase()}] ${i.rule}: ${i.message}${i.selector ? ` (${i.selector})` : ""}`)
      .join("\n");
    await navigator.clipboard.writeText(text);
    toast("Results copied");
  });
}

function renderA11yResults(issues, truncated) {
  const box = $("#a11yResults");
  box.innerHTML = "";
  if (!issues.length) {
    box.innerHTML = `<p class="muted tiny">No issues found by the heuristic scan. 🎉</p>`;
    return;
  }
  issues.forEach((issue) => {
    const el = document.createElement("div");
    el.className = "a11y-item";
    const sevBadge = issue.severity === "high" ? "fail" : issue.severity === "low" ? "untested" : "blocked";
    el.innerHTML = `
      <div class="a11y-head"><span class="badge ${sevBadge}">${escapeHtml(issue.severity)}</span> ${escapeHtml(issue.rule)}</div>
      <p class="a11y-msg">${escapeHtml(issue.message)}</p>
      ${issue.selector ? `<div class="a11y-selector">${escapeHtml(issue.selector)}</div>` : ""}`;
    box.appendChild(el);
  });
  if (truncated) {
    const note = document.createElement("p");
    note.className = "muted tiny";
    note.textContent = "Results capped at 60 — there may be more issues on this page.";
    box.appendChild(note);
  }
}

// ---- API tester (Swagger / OpenAPI) -----------------------------------------
let apiSpec = null; // { baseUrl, endpoints } — see lib/openapi.js
let lastApiRequest = null; // { method, url, headers, body } — for "Copy as curl"

function wireApiTester() {
  $("#loadApiSpecUrl").addEventListener("click", loadApiSpecFromUrl);
  $("#loadApiSpecJson").addEventListener("click", loadApiSpecFromTextarea);
  $("#apiEndpointSelect").addEventListener("change", renderApiParams);
  $("#sendApiRequest").addEventListener("click", sendApiRequest);
  $("#copyCurl").addEventListener("click", copyCurl);
}

async function loadApiSpecFromUrl() {
  const url = $("#apiSpecUrl").value.trim();
  if (!url) return toast("Enter a spec URL");
  $("#apiSpecStatus").textContent = "Loading…";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applySpec(await res.json());
  } catch (e) {
    $("#apiSpecStatus").textContent = `✗ ${e.message}. Only JSON specs are supported — if yours is YAML, convert it or paste the JSON below.`;
  }
}

function loadApiSpecFromTextarea() {
  const text = $("#apiSpecJson").value.trim();
  if (!text) return toast("Paste a spec first");
  try {
    applySpec(JSON.parse(text));
  } catch (e) {
    $("#apiSpecStatus").textContent = "✗ Invalid JSON";
  }
}

function applySpec(json) {
  try {
    apiSpec = parseSpec(json);
  } catch (e) {
    $("#apiSpecStatus").textContent = `✗ ${e.message}`;
    return;
  }
  if (!apiSpec.endpoints.length) {
    $("#apiSpecStatus").textContent = "Parsed, but no endpoints were found.";
    return;
  }
  $("#apiSpecStatus").textContent = `✓ Loaded ${apiSpec.endpoints.length} endpoint${apiSpec.endpoints.length > 1 ? "s" : ""}`;
  $("#apiBaseUrl").value = apiSpec.baseUrl || "";
  const sel = $("#apiEndpointSelect");
  sel.innerHTML = "";
  apiSpec.endpoints.forEach((ep, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${ep.method} ${ep.path}${ep.summary ? " — " + ep.summary : ""}`;
    sel.appendChild(opt);
  });
  $("#apiTesterBody").hidden = false;
  $("#apiResponse").innerHTML = "";
  renderApiParams();
}

function currentEndpoint() {
  if (!apiSpec) return null;
  const idx = parseInt($("#apiEndpointSelect").value, 10);
  return apiSpec.endpoints[idx] || null;
}

function renderApiParams() {
  const ep = currentEndpoint();
  const list = $("#apiParamsList");
  list.innerHTML = "";
  if (!ep) return;

  ep.parameters.forEach((p) => {
    const exampleVal = p.example ?? p.schema?.example ?? "";
    const defaultVal = p.default ?? p.schema?.default ?? "";
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `
      <label>${escapeHtml(p.name)} <span class="muted tiny">(${escapeHtml(p.in)}${p.required ? ", required" : ""})</span></label>
      <input class="input sm" data-param="${escapeHtml(p.name)}" data-in="${escapeHtml(p.in)}"
        placeholder="${escapeHtml(exampleVal)}" value="${escapeHtml(defaultVal)}" />`;
    list.appendChild(field);
  });

  const showBody = ["POST", "PUT", "PATCH"].includes(ep.method) || ep.bodyExample != null;
  $("#apiBodyField").hidden = !showBody;
  if (showBody) $("#apiBodyJson").value = ep.bodyExample != null ? JSON.stringify(ep.bodyExample, null, 2) : "{}";
}

function collectParamValues() {
  const values = {};
  $$("#apiParamsList [data-param]").forEach((input) => {
    values[input.dataset.param] = { value: input.value, in: input.dataset.in };
  });
  return values;
}

function parseExtraHeaders() {
  const headers = {};
  $("#apiExtraHeaders").value.split("\n").forEach((line) => {
    const idx = line.indexOf(":");
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) headers[key] = val;
  });
  return headers;
}

async function sendApiRequest() {
  const ep = currentEndpoint();
  if (!ep) return toast("Load a spec and pick an endpoint first");
  const values = collectParamValues();
  const baseUrl = $("#apiBaseUrl").value.trim().replace(/\/+$/, "");

  let path = ep.path;
  const query = new URLSearchParams();
  const headers = parseExtraHeaders();
  Object.entries(values).forEach(([name, { value, in: loc }]) => {
    if (!value) return;
    if (loc === "path") path = path.replace(`{${name}}`, encodeURIComponent(value));
    else if (loc === "query") query.set(name, value);
    else if (loc === "header") headers[name] = value;
  });

  const qs = query.toString();
  const url = `${baseUrl}${path}${qs ? `?${qs}` : ""}`;

  let body;
  const showBody = !$("#apiBodyField").hidden;
  if (showBody) {
    const raw = $("#apiBodyJson").value.trim();
    if (raw) {
      try {
        JSON.parse(raw); // validate before sending
      } catch (e) {
        return toast("Request body is not valid JSON");
      }
      body = raw;
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
    }
  }

  lastApiRequest = { method: ep.method, url, headers, body };

  const btn = $("#sendApiRequest");
  btn.disabled = true;
  btn.textContent = "Sending…";
  const start = Date.now();
  try {
    const res = await fetch(url, { method: ep.method, headers, body });
    const duration = Date.now() - start;
    const text = await res.text();
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch (_) {
      /* not JSON — show as-is */
    }
    renderApiResponse({ status: res.status, statusText: res.statusText, duration, body: pretty, ok: res.ok });
  } catch (e) {
    renderApiResponse({ status: 0, statusText: e.message, duration: Date.now() - start, body: "", ok: false });
  } finally {
    btn.disabled = false;
    btn.textContent = "Send request";
  }
}

function renderApiResponse({ status, statusText, duration, body, ok }) {
  const box = $("#apiResponse");
  const truncated = body.length > 5000 ? body.slice(0, 5000) + "\n…[truncated]" : body;
  box.innerHTML = `
    <div class="api-status ${ok ? "ok" : "err"}">${status || "ERR"} ${escapeHtml(statusText || "")} — ${duration}ms</div>
    <div class="api-body">${escapeHtml(truncated || "(empty body)")}</div>
    <button class="btn sm" id="saveApiAsBug" style="margin-top: 6px">Save as bug</button>`;
  $("#saveApiAsBug").addEventListener("click", () => {
    const ep = currentEndpoint();
    session.findings.push({
      id: store.uid("bug"),
      title: `API: ${ep.method} ${ep.path} → ${status}`,
      severity: ok ? "low" : "high",
      description: `URL: ${lastApiRequest.url}\nStatus: ${status} ${statusText} (${duration}ms)\n\nResponse:\n${truncated}`,
      screenshot: null,
      createdAt: new Date().toISOString(),
    });
    renderBugs();
    persistSoon();
    toast("Saved as a bug finding");
  });
}

function copyCurl() {
  if (!lastApiRequest) return toast("Send a request first");
  const { method, url, headers, body } = lastApiRequest;
  let cmd = `curl -X ${method} '${url}'`;
  Object.entries(headers || {}).forEach(([k, v]) => {
    cmd += ` \\\n  -H '${k}: ${v}'`;
  });
  if (body) cmd += ` \\\n  -d '${body.replace(/'/g, `'\\''`)}'`;
  navigator.clipboard.writeText(cmd);
  toast("curl command copied");
}

// ---- full-page (scrolling) screenshot ---------------------------------------
async function captureFullPageAndAnnotate() {
  const statusEl = $("#fullPageStatus");
  const btn = $("#captureFullPageBtn");
  btn.disabled = true;
  statusEl.textContent = "Preparing…";
  try {
    const tab = await getActiveTab();
    if (!tab) throw new Error("No active tab");
    if (/^(chrome|edge|about|chrome-extension|https:\/\/chrome\.google\.com\/webstore)/.test(tab.url || "")) {
      throw new Error("Can't capture browser/system pages");
    }

    await sendToTab(MSG.SET_CAPTURE_MODE, { enabled: true });
    const info = await sendToTab(MSG.GET_SCROLL_INFO);
    if (!info?.ok) throw new Error("Could not read page dimensions");

    const { scrollHeight, viewportWidth, viewportHeight, dpr } = info;
    const MAX_SLICES = 15;
    const positions = [0];
    let y = 0;
    while (y + viewportHeight < scrollHeight && positions.length < MAX_SLICES) {
      y += viewportHeight;
      positions.push(y);
    }
    const lastPos = Math.max(0, scrollHeight - viewportHeight);
    if (positions[positions.length - 1] !== lastPos && positions.length < MAX_SLICES) positions.push(lastPos);

    const slices = [];
    for (let i = 0; i < positions.length; i++) {
      statusEl.textContent = `Capturing ${i + 1}/${positions.length}…`;
      await sendToTab(MSG.SCROLL_TO, { x: 0, y: positions[i] });
      await sleep(450); // let sticky/lazy content settle, and respect captureVisibleTab's rate limit
      const dataUrl = await captureVisibleTabDirect(tab.windowId);
      slices.push({ y: positions[i], dataUrl });
    }

    await sendToTab(MSG.RESTORE_SCROLL);
    await sendToTab(MSG.SET_CAPTURE_MODE, { enabled: false });

    if (positions.length >= MAX_SLICES) toast(`Page is very tall — capped at ${MAX_SLICES} slices`);

    statusEl.textContent = "Stitching…";
    const stitched = await stitchSlices(slices, viewportWidth, scrollHeight, dpr);
    statusEl.textContent = "";

    pendingAnnotateTarget = { kind: "bug" };
    chrome.runtime.sendMessage({ type: MSG.OPEN_ANNOTATOR, dataUrl: stitched, pageUrl: tab.url });
  } catch (e) {
    statusEl.textContent = "";
    toast(e.message || "Full-page capture failed");
    await sendToTab(MSG.SET_CAPTURE_MODE, { enabled: false }).catch(() => {});
  } finally {
    btn.disabled = false;
  }
}

function captureVisibleTabDirect(windowId, attempt = 0) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(dataUrl);
    });
  }).catch(async (e) => {
    if (attempt < 3 && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(e.message)) {
      await sleep(600);
      return captureVisibleTabDirect(windowId, attempt + 1);
    }
    throw e;
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Loads each slice as an <img>, draws it at its scroll offset on a canvas
// sized to the full page, and returns the flattened PNG data URL.
function stitchSlices(slices, width, totalHeight, dpr) {
  return new Promise((resolve, reject) => {
    if (!slices.length) return reject(new Error("Nothing captured"));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(totalHeight * dpr);
    const ctx = canvas.getContext("2d");
    let loaded = 0;
    slices.forEach((slice) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, Math.round(slice.y * dpr));
        loaded++;
        if (loaded === slices.length) resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Failed to load a captured slice"));
      img.src = slice.dataUrl;
    });
  });
}

function renderDataList(filter = "") {
  const list = $("#dataList");
  list.innerHTML = "";
  const q = filter.toLowerCase();
  let lastGroup = "";
  flattenTestData()
    .filter((d) => !q || d.label.toLowerCase().includes(q) || d.value.toLowerCase().includes(q) || d.group.toLowerCase().includes(q))
    .forEach((d) => {
      if (d.group !== lastGroup) {
        lastGroup = d.group;
        const g = document.createElement("div");
        g.className = "data-group-label";
        g.textContent = d.group;
        list.appendChild(g);
      }
      const row = document.createElement("div");
      row.className = "data-item";
      row.title = "Click to inject";
      row.innerHTML = `<span class="dlabel">${escapeHtml(d.label)}</span><span class="dval">${escapeHtml(d.value || "∅")}</span>`;
      row.addEventListener("click", () => injectValue(d.value));
      list.appendChild(row);
    });
}

async function injectValue(value) {
  const scope = $("#injectScope").value;
  const res = await sendToTab(MSG.INJECT_TEST_DATA, { value, scope });
  if (res?.ok) toast(`Injected into ${res.count} field${res.count > 1 ? "s" : ""}`);
  else toast(res?.reason || "No editable field found");
}

async function fillIdentity() {
  const identity = fakeIdentity(Date.now());
  // The content script maps each form field to a role (email, phone, name…)
  // and fills the whole form in one pass.
  const res = await sendToTab(MSG.INJECT_IDENTITY, { identity });
  if (res?.ok) toast(`Filled ${res.count} field${res.count > 1 ? "s" : ""} (${identity.fullName})`);
  else toast(res?.reason || "No recognizable form fields found");
}

// ============================================================================
// Steps
// ============================================================================
function wireSteps() {
  $("#addStep").addEventListener("click", addStep);
  $("#stepTitle").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addStep();
  });
}

function addStep() {
  const title = $("#stepTitle").value.trim();
  if (!title) return;
  session.steps.push({ id: store.uid("step"), title, status: "untested", notes: "", screenshot: null, createdAt: new Date().toISOString() });
  $("#stepTitle").value = "";
  renderSteps();
  persistSoon();
}

function renderSteps() {
  const list = $("#stepsList");
  list.innerHTML = "";
  if (!session.steps.length) {
    list.innerHTML = `<p class="muted tiny">No steps yet. Add your first test step above.</p>`;
    return;
  }
  session.steps.forEach((step, i) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-head">
        <span class="badge ${step.status}">${step.status}</span>
        <span class="title">${i + 1}. ${escapeHtml(step.title)}</span>
        <button class="btn ghost sm" data-act="del">✕</button>
      </div>
      <div class="item-body">
        <div class="status-group">
          <button class="status-btn pass ${step.status === "pass" ? "on" : ""}" data-status="pass">PASS</button>
          <button class="status-btn fail ${step.status === "fail" ? "on" : ""}" data-status="fail">FAIL</button>
          <button class="status-btn blocked ${step.status === "blocked" ? "on" : ""}" data-status="blocked">BLOCK</button>
          <span class="spacer"></span>
          <button class="btn sm" data-act="shot">📸</button>
        </div>
        <textarea class="input sm" data-act="notes" placeholder="Notes / actual result…" style="margin-top:8px">${escapeHtml(step.notes)}</textarea>
        ${step.screenshot ? `<img class="thumb" src="${step.screenshot}" alt="step screenshot"/>` : ""}
      </div>`;

    el.querySelectorAll(".status-btn").forEach((b) =>
      b.addEventListener("click", () => {
        step.status = step.status === b.dataset.status ? "untested" : b.dataset.status;
        renderSteps();
        persistSoon();
      })
    );
    el.querySelector('[data-act="notes"]').addEventListener("input", (e) => {
      step.notes = e.target.value;
      persistSoon();
    });
    el.querySelector('[data-act="del"]').addEventListener("click", () => {
      session.steps = session.steps.filter((s) => s.id !== step.id);
      renderSteps();
      persistSoon();
    });
    el.querySelector('[data-act="shot"]').addEventListener("click", () => {
      pendingAnnotateTarget = { kind: "step", id: step.id };
      captureAndAnnotate();
    });
    list.appendChild(el);
  });
}

// ---- reusable step templates -------------------------------------------------
function wireTemplates() {
  $("#insertTemplateBtn").addEventListener("click", async () => {
    const id = $("#templateSelect").value;
    if (!id) return toast("No template selected");
    const templates = await store.getTemplates();
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    tpl.steps.forEach((s) => {
      session.steps.push({ id: store.uid("step"), title: s.title, status: "untested", notes: "", screenshot: null, createdAt: new Date().toISOString() });
    });
    renderSteps();
    persistSoon();
    toast(`Inserted ${tpl.steps.length} step${tpl.steps.length > 1 ? "s" : ""} from "${tpl.name}"`);
  });

  $("#deleteTemplateBtn").addEventListener("click", async () => {
    const id = $("#templateSelect").value;
    if (!id) return;
    if (!confirm("Delete this template?")) return;
    await store.deleteTemplate(id);
    await renderTemplateSelect();
    toast("Template deleted");
  });

  $("#saveTemplateBtn").addEventListener("click", async () => {
    const name = $("#templateName").value.trim();
    if (!name) return toast("Give the template a name");
    if (!session.steps.length) return toast("No steps to save — add some steps first");
    const tpl = { id: store.uid("tpl"), name, steps: session.steps.map((s) => ({ title: s.title })) };
    await store.saveTemplate(tpl);
    $("#templateName").value = "";
    await renderTemplateSelect(tpl.id);
    toast(`Saved template "${name}"`);
  });

  renderTemplateSelect();
}

async function renderTemplateSelect(selectId) {
  const templates = await store.getTemplates();
  const sel = $("#templateSelect");
  sel.innerHTML = "";
  if (!templates.length) {
    const opt = document.createElement("option");
    opt.textContent = "No templates saved yet";
    opt.value = "";
    sel.appendChild(opt);
    return;
  }
  templates.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = `${t.name} (${t.steps.length})`;
    if (t.id === selectId) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ============================================================================
// Edge cases
// ============================================================================
function wireEdge() {
  $("#loadEdgeTemplate").addEventListener("click", () => {
    const existing = new Set(session.edgeCases.map((e) => e.label));
    EDGE_CASE_TEMPLATE.forEach((grp) =>
      grp.items.forEach((label) => {
        if (!existing.has(label)) session.edgeCases.push({ id: store.uid("edge"), group: grp.group, label, checked: false, notes: "" });
      })
    );
    renderEdge();
    persistSoon();
  });
  $("#clearEdge").addEventListener("click", () => {
    if (!confirm("Clear all edge-case items?")) return;
    session.edgeCases = [];
    renderEdge();
    persistSoon();
  });
}

function renderEdge() {
  const list = $("#edgeList");
  list.innerHTML = "";
  if (!session.edgeCases.length) {
    list.innerHTML = `<p class="muted tiny">Load the checklist template to get started, or add cases as you find them.</p>`;
    return;
  }
  let lastGroup = "";
  session.edgeCases.forEach((ec) => {
    if (ec.group !== lastGroup) {
      lastGroup = ec.group;
      const t = document.createElement("div");
      t.className = "edge-group-title";
      t.textContent = ec.group || "Other";
      list.appendChild(t);
    }
    const row = document.createElement("div");
    row.className = "edge-item";
    row.innerHTML = `
      <input type="checkbox" ${ec.checked ? "checked" : ""} />
      <label>${escapeHtml(ec.label)}</label>
      <button class="btn ghost sm" data-act="del">✕</button>`;
    row.querySelector("input").addEventListener("change", (e) => {
      ec.checked = e.target.checked;
      persistSoon();
    });
    row.querySelector('[data-act="del"]').addEventListener("click", () => {
      session.edgeCases = session.edgeCases.filter((x) => x.id !== ec.id);
      renderEdge();
      persistSoon();
    });
    list.appendChild(row);
  });
}

// ============================================================================
// Bugs
// ============================================================================
let bugShotBuffer = null; // screenshot staged for the next bug

function wireBugs() {
  $("#addBug").addEventListener("click", addBug);
  $("#bugCapture").addEventListener("click", () => {
    pendingAnnotateTarget = { kind: "bug-staging" };
    captureAndAnnotate();
  });
}

function addBug() {
  const title = $("#bugTitle").value.trim();
  if (!title) return toast("Give the bug a title");
  session.findings.push({
    id: store.uid("bug"),
    title,
    severity: $("#bugSeverity").value,
    description: $("#bugDesc").value.trim(),
    screenshot: bugShotBuffer,
    createdAt: new Date().toISOString(),
  });
  $("#bugTitle").value = "";
  $("#bugDesc").value = "";
  bugShotBuffer = null;
  $("#bugShotPreview").hidden = true;
  renderBugs();
  persistSoon();
  toast("Bug added");
}

async function renderBugs() {
  const list = $("#bugsList");
  list.innerHTML = "";
  if (!session.findings.length) {
    list.innerHTML = `<p class="muted tiny">No bugs recorded yet.</p>`;
    return;
  }

  // Only offer "File in X" for a tracker that's actually configured — an
  // already-filed bug still shows its link either way.
  const settings = await store.getSettings();
  const jiraReady = isJiraConfigured(settings);
  const tfsReady = isTfsConfigured(settings);

  session.findings.forEach((bug) => {
    const el = document.createElement("div");
    el.className = "item";

    const trackerLinks = [];
    if (bug.jiraUrl) {
      trackerLinks.push(`<a class="jira-link" href="${escapeHtml(bug.jiraUrl)}" target="_blank" rel="noopener">Jira: ${escapeHtml(bug.jiraKey)}</a>`);
    } else if (jiraReady) {
      trackerLinks.push(`<button class="btn sm" data-act="file-jira">File in Jira</button>`);
    }
    if (bug.tfsUrl) {
      trackerLinks.push(`<a class="jira-link" href="${escapeHtml(bug.tfsUrl)}" target="_blank" rel="noopener">TFS: #${escapeHtml(bug.tfsId)}</a>`);
    } else if (tfsReady) {
      trackerLinks.push(`<button class="btn sm" data-act="file-tfs">File in TFS</button>`);
    }

    el.innerHTML = `
      <div class="item-head">
        <span class="badge ${bug.severity === "critical" || bug.severity === "high" ? "fail" : "blocked"}">${bug.severity}</span>
        <span class="title">${escapeHtml(bug.title)}</span>
        <button class="btn ghost sm" data-act="del">✕</button>
      </div>
      ${bug.description ? `<div class="item-body"><p class="muted tiny" style="white-space:pre-wrap">${escapeHtml(bug.description)}</p></div>` : ""}
      ${bug.screenshot ? `<img class="thumb" src="${bug.screenshot}" alt="bug screenshot"/>` : ""}
      ${trackerLinks.length ? `<div class="jira-row">${trackerLinks.join("")}</div>` : ""}`;
    el.querySelector('[data-act="del"]').addEventListener("click", () => {
      session.findings = session.findings.filter((b) => b.id !== bug.id);
      renderBugs();
      persistSoon();
    });
    const jiraBtn = el.querySelector('[data-act="file-jira"]');
    if (jiraBtn) jiraBtn.addEventListener("click", () => fileBugInJira(bug, jiraBtn));
    const tfsBtn = el.querySelector('[data-act="file-tfs"]');
    if (tfsBtn) tfsBtn.addEventListener("click", () => fileBugInTfs(bug, tfsBtn));
    list.appendChild(el);
  });
}

async function fileBugInJira(bug, btn) {
  const settings = await store.getSettings();
  if (!isJiraConfigured(settings)) return toast("Configure Jira in Settings (⚙) first");
  if (!confirm(`File "${bug.title}" as a new Bug in project ${settings.jiraProjectKey}?`)) return;
  btn.disabled = true;
  btn.textContent = "Filing…";
  try {
    const { key, url } = await createJiraIssue(settings, bug);
    if (bug.screenshot) {
      try {
        await attachScreenshot(settings, key, bug.screenshot);
      } catch (attachErr) {
        toast(`Issue ${key} created, but the screenshot attachment failed`);
      }
    }
    bug.jiraKey = key;
    bug.jiraUrl = url;
    renderBugs();
    persistSoon();
    toast(`Filed as ${key}`);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "File in Jira";
    toast(`Jira error: ${e.message}`);
  }
}

async function fileBugInTfs(bug, btn) {
  const settings = await store.getSettings();
  if (!isTfsConfigured(settings)) return toast("Configure Azure DevOps / TFS in Settings (⚙) first");
  if (!confirm(`File "${bug.title}" as a new Bug work item in project ${settings.tfsProject}?`)) return;
  btn.disabled = true;
  btn.textContent = "Filing…";
  try {
    const { id, url } = await createTfsBug(settings, bug);
    if (bug.screenshot) {
      try {
        await attachScreenshotTfs(settings, id, bug.screenshot);
      } catch (attachErr) {
        toast(`Work item #${id} created, but the screenshot attachment failed`);
      }
    }
    bug.tfsId = id;
    bug.tfsUrl = url;
    renderBugs();
    persistSoon();
    toast(`Filed as #${id}`);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "File in TFS";
    toast(`TFS error: ${e.message}`);
  }
}

// ============================================================================
// Report
// ============================================================================
function wireReport() {
  $("#openReport").addEventListener("click", () => openReport(false));
  $("#printPdf").addEventListener("click", () => openReport(true));
  $("#downloadReport").addEventListener("click", downloadReport);
  $("#copyMd").addEventListener("click", async () => {
    await navigator.clipboard.writeText(buildMarkdown(session));
    toast("Markdown copied for Jira");
  });
  $("#copyAiPrompt").addEventListener("click", async () => {
    await navigator.clipboard.writeText(buildAiPrompt(session));
    toast("AI prompt copied");
  });
  $("#clearLogs").addEventListener("click", () => {
    if (logFilter === "errors") {
      session.logs = [];
      persistSoon();
    } else {
      liveLogs = [];
    }
    renderLogs();
  });
  $("#logFilterErrors").addEventListener("click", () => setLogFilter("errors"));
  $("#logFilterAll").addEventListener("click", () => setLogFilter("all"));
}

function setLogFilter(filter) {
  logFilter = filter;
  $("#logFilterErrors").classList.toggle("active", filter === "errors");
  $("#logFilterErrors").classList.toggle("ghost", filter !== "errors");
  $("#logFilterAll").classList.toggle("active", filter === "all");
  $("#logFilterAll").classList.toggle("ghost", filter !== "all");
  renderLogs();
}

async function openReport(print) {
  // Flush any pending edits so the report reflects the latest state, then open
  // the viewer page (an extension page — CSP-safe, unlike a blob tab).
  await store.saveSession(session);
  const url = chrome.runtime.getURL(`src/report/report.html?id=${encodeURIComponent(session.id)}${print ? "&print=1" : ""}`);
  chrome.tabs.create({ url });
}

function downloadReport() {
  const html = buildHtmlReport(session);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const safe = (session.name || "qa-report").replace(/[^a-z0-9-_]+/gi, "_");
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast("Report downloaded");
}

function renderLogs() {
  const list = $("#logsList");
  list.innerHTML = "";

  if (logFilter === "errors") {
    const logs = session.logs || [];
    $("#logCount").textContent = logs.length ? `${logs.length} error/warning entries — saved to the report` : "";
    if (!logs.length) {
      list.innerHTML = `<p class="muted tiny">No console/network errors captured on the target page.</p>`;
      return;
    }
    logs.slice(-100).reverse().forEach((l) => list.appendChild(buildLogRow(l)));
  } else {
    $("#logCount").textContent = liveLogs.length ? `${liveLogs.length} live requests — this panel session only, not saved` : "";
    if (!liveLogs.length) {
      list.innerHTML = `<p class="muted tiny">No network activity yet. Reload the target page or interact with it.</p>`;
      return;
    }
    liveLogs.slice(-200).reverse().forEach((l) => list.appendChild(buildLogRow(l)));
  }
}

function buildLogRow(l) {
  const row = document.createElement("div");
  const bodyText = l.detail && l.detail.body;
  row.className = `log-row ${l.level || ""} ${bodyText ? "expandable" : ""}`;
  const main = document.createElement("div");
  main.className = "log-main";
  main.innerHTML = `<span class="lvl">${escapeHtml((l.level || l.type || "log").toUpperCase())}</span><span class="msg">${escapeHtml(l.message || "")}</span>`;
  row.appendChild(main);
  if (bodyText) {
    const body = document.createElement("div");
    body.className = "log-body";
    body.hidden = true;
    body.textContent = bodyText;
    row.appendChild(body);
    row.addEventListener("click", () => (body.hidden = !body.hidden));
  }
  return row;
}

// ============================================================================
// Runtime messages (from content scripts / background / annotator)
// ============================================================================
function wireRuntimeMessages() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.ELEMENT_PICKED) {
      addPickedElement(msg);
    } else if (msg?.type === MSG.PAGE_LOG) {
      const entry = msg.entry;
      if (!entry) return;
      // Every request/console entry goes into the ephemeral live buffer...
      liveLogs.push(entry);
      if (liveLogs.length > 300) liveLogs = liveLogs.slice(-300);
      // ...but only errors/warnings are persisted into the session (and report).
      if (entry.level === "error" || entry.level === "warn") {
        session.logs = session.logs || [];
        session.logs.push(entry);
        if (session.logs.length > 300) session.logs = session.logs.slice(-300);
        persistSoon();
      }
      renderLogs();
    } else if (msg?.type === MSG.ANNOTATOR_SAVE) {
      applyAnnotatedScreenshot(msg.dataUrl);
    }
  });
}

function addPickedElement(msg) {
  const list = $("#pickedList");
  const item = document.createElement("div");
  item.className = "picked-item";
  item.innerHTML = `<code>${escapeHtml(msg.selector)}</code><button class="btn ghost sm" title="Copy">⧉</button>`;
  item.querySelector("button").addEventListener("click", async () => {
    await navigator.clipboard.writeText(msg.selector);
    toast("Selector copied");
  });
  list.prepend(item);
  toast(`Picked <${msg.tag}>`);
}

function applyAnnotatedScreenshot(dataUrl) {
  if (!pendingAnnotateTarget || !dataUrl) return;
  const t = pendingAnnotateTarget;
  if (t.kind === "step") {
    const step = session.steps.find((s) => s.id === t.id);
    if (step) step.screenshot = dataUrl;
    renderSteps();
    toast("Screenshot attached to step");
  } else if (t.kind === "bug-staging") {
    bugShotBuffer = dataUrl;
    $("#bugShotPreview").src = dataUrl;
    $("#bugShotPreview").hidden = false;
    toast("Screenshot staged — add the bug to save it");
  } else if (t.kind === "bug") {
    session.findings.push({ id: store.uid("bug"), title: "Screenshot", severity: "medium", description: "", screenshot: dataUrl, createdAt: new Date().toISOString() });
    renderBugs();
    toast("Screenshot saved as a bug entry");
  } else if (t.kind === "ux") {
    session.screenshots = session.screenshots || [];
    session.screenshots.push({ id: store.uid("ux"), name: "Annotated capture", dataUrl });
    renderUxPreview();
  }
  pendingAnnotateTarget = null;
  persistSoon();
  renderStorageInfo();
}

// ============================================================================
// Shared helpers
// ============================================================================
function renderAll() {
  renderSteps();
  renderEdge();
  renderBugs();
  renderLogs();
  $("#aiPromptPreview").value = buildAiPrompt(session);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

// Send a message to the content script in the active tab, injecting it first if
// it hasn't loaded (e.g. the page loaded before the extension, or SPA nav).
async function sendToTab(type, extra = {}) {
  const tab = await getActiveTab();
  if (!tab) return { ok: false, reason: "No active tab" };
  if (/^(chrome|edge|about|chrome-extension|https:\/\/chrome\.google\.com\/webstore)/.test(tab.url || "")) {
    toast("This tool can't run on browser/system pages");
    return { ok: false, reason: "restricted page" };
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
  } catch (_) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content/content.js"] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["src/content/content.css"] });
      return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
    } catch (e2) {
      toast("Couldn't reach the page — try reloading the tab");
      return { ok: false, reason: e2.message };
    }
  }
}

function captureAndAnnotate() {
  // Hide the inspector highlight / UX-overlay chrome so they don't show up in
  // the evidence, then restore them once the background has grabbed the tab.
  sendToTab(MSG.SET_CAPTURE_MODE, { enabled: true }).finally(() => {
    chrome.runtime.sendMessage({ type: MSG.CAPTURE_SCREENSHOT, annotate: true }, (res) => {
      sendToTab(MSG.SET_CAPTURE_MODE, { enabled: false });
      if (chrome.runtime.lastError || !res?.ok) toast("Capture failed on this page");
    });
  });
}

// Debounced persistence so rapid typing doesn't hammer storage.
let saveTimer = null;
function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.saveSession(session).catch((e) => toast("Save failed: " + e.message)), 400);
}

async function renderStorageInfo() {
  const bytes = await store.getBytesInUse();
  const mb = (bytes / (1024 * 1024)).toFixed(2);
  $("#storageInfo").textContent = `Local storage used: ${mb} MB`;
}

// Downscale/compress an image File (or Blob) to a data URL.
function resizeImage(file, maxW = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 2200);
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
