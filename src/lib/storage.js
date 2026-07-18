// Thin wrapper around chrome.storage.local for session persistence.
// A "session" is one test run against a target page. All sessions live in a
// single array; the active session is tracked by id.

const KEYS = {
  SESSIONS: "protest.sessions",
  ACTIVE: "protest.activeSessionId",
  SETTINGS: "protest.settings",
  TEMPLATES: "protest.templates",
};

const DEFAULT_SETTINGS = {
  theme: "system",
  // Jira Cloud REST v3 credentials for one-click bug filing. Stored locally
  // only — never sent anywhere except directly to jiraBaseUrl by the tester's
  // own explicit "File in Jira" click. See src/lib/jira.js.
  jiraBaseUrl: "",
  jiraProjectKey: "",
  jiraEmail: "",
  jiraApiToken: "",
  // Azure DevOps / Team Foundation Server (TFS) credentials — the same idea,
  // for teams that track work items in TFS instead of (or alongside) Jira.
  // See src/lib/tfs.js.
  tfsOrgUrl: "",
  tfsProject: "",
  tfsPat: "",
  tfsApiVersion: "6.0",
};

// ---- low-level helpers -----------------------------------------------------

function get(key, fallback) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (res) => resolve(res[key] ?? fallback));
  });
}

function set(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

// A short, collision-resistant id without pulling in a dependency.
export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- sessions --------------------------------------------------------------

export async function getSessions() {
  const sessions = await get(KEYS.SESSIONS, []);
  return sessions.map(migrateSession);
}

export async function getActiveSessionId() {
  return get(KEYS.ACTIVE, null);
}

export async function getActiveSession() {
  const [sessions, activeId] = await Promise.all([getSessions(), getActiveSessionId()]);
  return sessions.find((s) => s.id === activeId) || null;
}

export function newSessionObject(fields = {}) {
  const now = new Date().toISOString();
  return {
    id: uid("sess"),
    name: fields.name || `Session ${new Date().toLocaleString()}`,
    createdAt: now,
    updatedAt: now,
    userStoryUrl: fields.userStoryUrl || "",
    targetUrl: fields.targetUrl || "",
    testerName: fields.testerName || "",
    notes: fields.notes || "",
    screenshots: fields.screenshots || [], // UX reference screens: [{ id, name, dataUrl }]
    steps: [],
    edgeCases: [],
    findings: [],
    logs: [],
  };
}

// Older sessions stored a single `screenshot` (string|null) instead of a
// `screenshots` array. Normalize on read so the rest of the app only ever
// deals with the array form.
function migrateSession(session) {
  if (session && !Array.isArray(session.screenshots)) {
    session.screenshots = session.screenshot ? [{ id: uid("ux"), name: "UX reference", dataUrl: session.screenshot }] : [];
  }
  return session;
}

export async function saveSession(session) {
  const sessions = await getSessions();
  session.updatedAt = new Date().toISOString();
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) sessions[idx] = session;
  else sessions.push(session);
  await set({ [KEYS.SESSIONS]: sessions });
  return session;
}

export async function createSession(fields) {
  const session = newSessionObject(fields);
  await saveSession(session);
  await setActiveSession(session.id);
  return session;
}

export async function setActiveSession(id) {
  await set({ [KEYS.ACTIVE]: id });
}

export async function deleteSession(id) {
  const sessions = (await getSessions()).filter((s) => s.id !== id);
  await set({ [KEYS.SESSIONS]: sessions });
  const activeId = await getActiveSessionId();
  if (activeId === id) await setActiveSession(sessions[0]?.id ?? null);
}

// ---- settings --------------------------------------------------------------

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await get(KEYS.SETTINGS, {})) };
}

export async function saveSettings(patch) {
  const merged = { ...(await getSettings()), ...patch };
  await set({ [KEYS.SETTINGS]: merged });
  return merged;
}

// Rough storage usage helper (bytes) for the UI to warn about large images.
export function getBytesInUse() {
  return new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, (bytes) => resolve(bytes));
  });
}

// ---- reusable step templates -----------------------------------------------
// A template is a named list of step titles a tester can insert into any
// session's Steps tab (e.g. a recurring "login flow" or "checkout" checklist).

export async function getTemplates() {
  return get(KEYS.TEMPLATES, []);
}

export async function saveTemplate(template) {
  const templates = await getTemplates();
  const idx = templates.findIndex((t) => t.id === template.id);
  if (idx >= 0) templates[idx] = template;
  else templates.push(template);
  await set({ [KEYS.TEMPLATES]: templates });
  return template;
}

export async function deleteTemplate(id) {
  const templates = (await getTemplates()).filter((t) => t.id !== id);
  await set({ [KEYS.TEMPLATES]: templates });
}
