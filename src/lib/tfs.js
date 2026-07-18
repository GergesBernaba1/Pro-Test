// Minimal Azure DevOps / Team Foundation Server (TFS) REST client for filing
// bugs found during a QA session — the TFS counterpart to lib/jira.js.
// Auth is Basic with an empty username and a Personal Access Token (PAT) as
// the password, the scheme both Azure DevOps Services and on-premises TFS
// expect for PAT-based auth.
//
// Like the Jira client, this only runs when the tester explicitly clicks
// "File in TFS" on a specific bug — never automatically.

function authHeader(settings) {
  return `Basic ${btoa(`:${settings.tfsPat}`)}`;
}

function baseOf(settings) {
  return settings.tfsOrgUrl.replace(/\/+$/, "");
}

function apiVersion(settings) {
  return settings.tfsApiVersion || "6.0";
}

function projectSegment(settings) {
  return encodeURIComponent(settings.tfsProject);
}

export function isTfsConfigured(settings) {
  return !!(settings.tfsOrgUrl && settings.tfsProject && settings.tfsPat);
}

// Builds an actionable message for a failed auth attempt. A 401 here almost
// always means one of two on-premises-specific things (Azure DevOps Services
// PATs "just work"; on-prem TFS is where this bites):
//  1. The org/collection URL is missing the collection segment, e.g.
//     https://tfs.company.com needs to be https://tfs.company.com/tfs/DefaultCollection
//  2. The IIS site only accepts Windows auth (NTLM/Negotiate) and Basic auth
//     (which is what PATs use) has not been enabled server-side — a server
//     admin setting this extension cannot work around.
async function describeAuthFailure(res, settings) {
  if (res.status !== 401) return `Connection failed (HTTP ${res.status}). Check the org/collection URL, project name, and PAT.`;

  const challenge = res.headers.get("www-authenticate") || "";
  const looksLikeMissingCollection = !/\/(tfs|DefaultCollection)\b/i.test(settings.tfsOrgUrl) && !/dev\.azure\.com/i.test(settings.tfsOrgUrl);

  const hints = [];
  if (/ntlm|negotiate/i.test(challenge)) {
    hints.push(
      "This server responded asking for Windows authentication (NTLM/Negotiate), not a token. " +
        "On-premises TFS needs Basic authentication explicitly enabled on the server (IIS) for PATs to work here — check with your TFS admin, or use Jira instead if that's not possible."
    );
  }
  if (looksLikeMissingCollection) {
    hints.push(
      `The URL "${settings.tfsOrgUrl}" doesn't look like it includes a collection. On-premises TFS usually needs one, e.g. https://tfs.company.com/tfs/DefaultCollection — try adding it.`
    );
  }
  if (!hints.length) {
    hints.push("Double-check the PAT is valid, hasn't expired, and has the \"Work Items (Read & Write)\" scope.");
  }
  return `Connection failed (HTTP 401 Unauthorized). ${hints.join(" ")}`;
}

export async function testTfsConnection(settings) {
  const url = `${baseOf(settings)}/_apis/projects/${projectSegment(settings)}?api-version=${apiVersion(settings)}`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader(settings), Accept: "application/json" },
  });
  if (!res.ok) throw new Error(await describeAuthFailure(res, settings));
  const data = await res.json();
  return data.name || "Connected";
}

function severityToTfs(sev) {
  return { critical: "1 - Critical", high: "2 - High", medium: "3 - Medium", low: "4 - Low" }[sev] || "3 - Medium";
}

function descHtml(bug) {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div>${esc(bug.description || "(no description provided)").replace(/\n/g, "<br/>")}</div><div>Filed via ProTest QA.</div>`;
}

export async function createTfsBug(settings, bug) {
  const ops = [
    { op: "add", path: "/fields/System.Title", value: bug.title || "QA finding" },
    { op: "add", path: "/fields/System.Description", value: descHtml(bug) },
    { op: "add", path: "/fields/Microsoft.VSTS.Common.Severity", value: severityToTfs(bug.severity) },
    { op: "add", path: "/fields/System.Tags", value: "protest-qa" },
  ];
  const url = `${baseOf(settings)}/${projectSegment(settings)}/_apis/wit/workitems/$Bug?api-version=${apiVersion(settings)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(settings),
      "Content-Type": "application/json-patch+json",
      Accept: "application/json",
    },
    body: JSON.stringify(ops),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 401 ? await describeAuthFailure(res, settings) : data?.message || `HTTP ${res.status}`);
  return {
    id: data.id,
    url: data._links?.html?.href || `${baseOf(settings)}/${projectSegment(settings)}/_workitems/edit/${data.id}`,
  };
}

// Best-effort — a failed attachment upload should not roll back work-item
// creation, so callers should catch this separately from createTfsBug.
export async function attachScreenshotTfs(settings, workItemId, dataUrl) {
  if (!dataUrl) return;
  const blob = await (await fetch(dataUrl)).blob();
  const uploadUrl = `${baseOf(settings)}/${projectSegment(settings)}/_apis/wit/attachments?fileName=evidence-${Date.now()}.png&api-version=${apiVersion(settings)}`;
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: authHeader(settings), "Content-Type": "application/octet-stream" },
    body: blob,
  });
  const uploadData = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) throw new Error(`Attachment upload failed (HTTP ${uploadRes.status})`);

  const patchUrl = `${baseOf(settings)}/${projectSegment(settings)}/_apis/wit/workitems/${workItemId}?api-version=${apiVersion(settings)}`;
  const patchRes = await fetch(patchUrl, {
    method: "PATCH",
    headers: { Authorization: authHeader(settings), "Content-Type": "application/json-patch+json" },
    body: JSON.stringify([
      { op: "add", path: "/relations/-", value: { rel: "AttachedFile", url: uploadData.url, attributes: { comment: "QA screenshot" } } },
    ]),
  });
  if (!patchRes.ok) throw new Error(`Attaching screenshot to work item failed (HTTP ${patchRes.status})`);
}
