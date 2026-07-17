// Minimal Jira Cloud REST v3 client for filing bugs found during a QA session.
// Auth is Basic (account email + API token) — the same scheme Jira Cloud's
// REST API expects for tokens created at id.atlassian.com/manage-profile/security/api-tokens.
//
// This module only performs a request when the caller (the side panel, in
// direct response to the tester clicking "File in Jira" on a specific bug)
// invokes it. It never runs automatically.

function authHeader(settings) {
  const token = btoa(`${settings.jiraEmail}:${settings.jiraApiToken}`);
  return `Basic ${token}`;
}

function baseOf(settings) {
  return settings.jiraBaseUrl.replace(/\/+$/, "");
}

// Jira Cloud's v3 issue API requires the description in Atlassian Document
// Format rather than plain text. This builds the minimal doc structure needed
// for a paragraph-per-blank-line bug description.
function toADF(text) {
  const paragraphs = (text || "").split(/\n{2,}/).filter((p) => p.trim().length);
  const content = (paragraphs.length ? paragraphs : [""]).map((p) => ({
    type: "paragraph",
    content: p ? [{ type: "text", text: p }] : [],
  }));
  return { type: "doc", version: 1, content };
}

export function isJiraConfigured(settings) {
  return !!(settings.jiraBaseUrl && settings.jiraProjectKey && settings.jiraEmail && settings.jiraApiToken);
}

export async function testJiraConnection(settings) {
  const res = await fetch(`${baseOf(settings)}/rest/api/3/myself`, {
    headers: { Authorization: authHeader(settings), Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Connection failed (HTTP ${res.status}). Check the URL, email, and API token.`);
  const me = await res.json();
  return me.displayName || me.emailAddress || "Connected";
}

export async function createJiraIssue(settings, bug) {
  const body = {
    fields: {
      project: { key: settings.jiraProjectKey },
      summary: bug.title || "QA finding",
      description: toADF(`${bug.description || "(no description provided)"}\n\nSeverity: ${(bug.severity || "medium").toUpperCase()}\nFiled via ProTest QA.`),
      issuetype: { name: "Bug" },
      labels: ["protest-qa", `severity-${bug.severity || "medium"}`],
    },
  };
  const res = await fetch(`${baseOf(settings)}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: authHeader(settings),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.errorMessages?.join("; ") || (data?.errors && JSON.stringify(data.errors)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return { key: data.key, url: `${baseOf(settings)}/browse/${data.key}` };
}

// Best-effort — a failed attachment upload should not roll back issue creation,
// so callers should catch this separately from createJiraIssue.
export async function attachScreenshot(settings, issueKey, dataUrl) {
  if (!dataUrl) return;
  const blob = await (await fetch(dataUrl)).blob();
  const form = new FormData();
  form.append("file", blob, `evidence-${Date.now()}.png`);
  const res = await fetch(`${baseOf(settings)}/rest/api/3/issue/${issueKey}/attachments`, {
    method: "POST",
    headers: {
      Authorization: authHeader(settings),
      "X-Atlassian-Token": "no-check",
      Accept: "application/json",
    },
    body: form,
  });
  if (!res.ok) throw new Error(`Attachment upload failed (HTTP ${res.status})`);
}
