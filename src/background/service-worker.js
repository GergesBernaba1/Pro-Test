// Background service worker (MV3, ES module).
// Responsibilities:
//   • open the side panel when the toolbar icon or a keyboard command fires
//   • capture screenshots of the visible tab (privileged API)
//   • relay page logs from content scripts to the side panel
//   • hold a short-lived payload handoff for the annotation editor tab

import { MSG } from "../lib/messages.js";

// In-memory handoff for the annotator. The editor tab opens, then asks the
// worker for "the image I should annotate". Kept in memory only (cleared on
// worker restart) so we never persist large blobs we don't need.
let annotatorPayload = null;

// ---- side panel wiring -----------------------------------------------------

// Clicking the toolbar icon opens the side panel for that tab.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.warn("[ProTest] setPanelBehavior:", e));
});

// ---- keyboard commands -----------------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab) return;

  if (command === "open-tester") {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (e) {
      console.warn("[ProTest] sidePanel.open:", e);
    }
  }

  if (command === "capture-screenshot") {
    const dataUrl = await captureVisibleTab(tab.windowId);
    if (dataUrl) openAnnotator(dataUrl, tab.url);
  }

  if (command === "toggle-inspector") {
    safeSendToTab(tab.id, { type: MSG.TOGGLE_INSPECTOR });
  }
});

// ---- message router --------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only the types below need a background response. PAGE_LOG / ELEMENT_PICKED /
  // ANNOTATOR_SAVE already reach the side panel directly (runtime messages are
  // delivered to every extension context), so the worker does not relay them.
  const handled = [MSG.CAPTURE_SCREENSHOT, MSG.OPEN_ANNOTATOR, MSG.GET_ANNOTATOR_PAYLOAD];
  if (!handled.includes(msg?.type)) return false;

  (async () => {
    switch (msg.type) {
      case MSG.CAPTURE_SCREENSHOT: {
        const tab = msg.tabId ? await getTab(msg.tabId) : await getActiveTab();
        const dataUrl = await captureVisibleTab(tab?.windowId);
        if (msg.annotate && dataUrl) openAnnotator(dataUrl, tab?.url);
        sendResponse({ ok: !!dataUrl, dataUrl });
        break;
      }
      case MSG.OPEN_ANNOTATOR: {
        openAnnotator(msg.dataUrl, msg.pageUrl);
        sendResponse({ ok: true });
        break;
      }
      case MSG.GET_ANNOTATOR_PAYLOAD: {
        sendResponse({ ok: true, payload: annotatorPayload });
        break;
      }
    }
  })();

  return true; // keep the message channel open for the async sendResponse
});

// ---- helpers ---------------------------------------------------------------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

function getTab(tabId) {
  return chrome.tabs.get(tabId).catch(() => null);
}

async function captureVisibleTab(windowId) {
  try {
    const opts = { format: "png" };
    return windowId != null
      ? await chrome.tabs.captureVisibleTab(windowId, opts)
      : await chrome.tabs.captureVisibleTab(opts);
  } catch (e) {
    console.warn("[ProTest] captureVisibleTab failed:", e.message);
    return null;
  }
}

function openAnnotator(dataUrl, pageUrl) {
  annotatorPayload = { dataUrl, pageUrl: pageUrl || "", ts: Date.now() };
  chrome.tabs.create({ url: chrome.runtime.getURL("src/annotator/annotator.html") });
}

function safeSendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}
