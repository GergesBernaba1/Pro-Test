// Central catalog of message "type" strings passed between the side panel,
// the background service worker, and content scripts. Keeping them in one
// place avoids typos and makes the message flow easy to follow.

export const MSG = {
  // sidepanel/background -> content script (in-page tools)
  PING: "protest/ping",
  TOGGLE_INSPECTOR: "protest/toggle-inspector",
  START_ELEMENT_PICK: "protest/start-element-pick",
  INJECT_TEST_DATA: "protest/inject-test-data",
  INJECT_IDENTITY: "protest/inject-identity",
  RUN_EDGE_SWEEP: "protest/run-edge-sweep",
  STOP_EDGE_SWEEP: "protest/stop-edge-sweep",
  GET_SCREEN_MODEL: "protest/get-screen-model",
  RUN_GENERATED_CASES: "protest/run-generated-cases",
  STOP_GENERATED_CASES: "protest/stop-generated-cases",
  TOGGLE_OVERLAY: "protest/toggle-overlay",
  UPDATE_OVERLAY: "protest/update-overlay",
  CLEAR_TOOLS: "protest/clear-tools",
  GET_PAGE_INFO: "protest/get-page-info",
  GET_SCROLL_INFO: "protest/get-scroll-info",
  SCROLL_TO: "protest/scroll-to",
  RESTORE_SCROLL: "protest/restore-scroll",
  SET_CAPTURE_MODE: "protest/set-capture-mode",
  RUN_A11Y_SCAN: "protest/run-a11y-scan",

  // content script -> sidepanel/background (events from the page)
  ELEMENT_PICKED: "protest/element-picked",
  PAGE_LOG: "protest/page-log", // console / network events forwarded up

  // anything -> background
  CAPTURE_SCREENSHOT: "protest/capture-screenshot",
  OPEN_ANNOTATOR: "protest/open-annotator",
  ANNOTATOR_SAVE: "protest/annotator-save",
  ANNOTATOR_READY: "protest/annotator-ready",
  GET_ANNOTATOR_PAYLOAD: "protest/get-annotator-payload",

  // background -> sidepanel broadcast
  BROADCAST: "protest/broadcast",
};

// Common edge-case categories reused by the checklist and the AI-prompt helper.
export const EDGE_CASE_TEMPLATE = [
  { group: "Empty & boundary", items: ["Empty / blank input", "Single character", "Maximum length + 1", "Whitespace-only value"] },
  { group: "Numbers", items: ["Negative number", "Zero", "Very large number", "Decimal / float precision", "Leading zeros"] },
  { group: "Text & encoding", items: ["Special characters !@#$%^&*", "Unicode / emoji 😀", "Right-to-left text", "Very long text (5k+ chars)"] },
  { group: "Security", items: ["XSS payload <script>", "SQL-like input ' OR 1=1 --", "HTML injection <b>", "Path traversal ../.."] },
  { group: "Format", items: ["Invalid email", "Invalid date", "Future / past date", "Wrong file type upload"] },
  { group: "State & flow", items: ["Double submit", "Back button after submit", "Concurrent edit", "Session timeout / logged out"] },
  { group: "Responsive & a11y", items: ["Mobile viewport", "Keyboard-only navigation", "Zoom 200%", "Screen-reader labels present"] },
];
