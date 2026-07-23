// ISOLATED-world content script: the in-page toolkit.
// It (1) relays page logs from monitor.js up to the background, and
// (2) executes commands sent from the side panel: element inspector,
// test-data injection, and the UX screenshot overlay.
//
// Content scripts declared in the manifest are not ES modules, so message-type
// strings are inlined here (kept in sync with src/lib/messages.js).

(() => {
  if (!extensionRuntimeAvailable()) return;

  if (window.__protestOnMessage) {
    try {
      chrome.runtime.onMessage.removeListener(window.__protestOnMessage);
    } catch (_) {
      // The previous extension context may have been invalidated by reload/update.
    }
  }
  window.__protestContentLoaded = true;

  const MSG = {
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
    ELEMENT_PICKED: "protest/element-picked",
    PAGE_LOG: "protest/page-log",
  };

  const stopRequested = {
    edgeSweep: false,
    generatedCases: false,
  };

  // ---- relay logs from the MAIN-world monitor -----------------------------
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data && data.__protest === "__PROTEST_LOG__" && data.entry) {
      safeRuntimeSend({ type: MSG.PAGE_LOG, entry: data.entry });
    }
  });

  // ---- command handler ----------------------------------------------------
  const onRuntimeMessage = (msg, sender, sendResponse) => {
    switch (msg?.type) {
      case MSG.PING:
        sendResponse({ ok: true, url: location.href, title: document.title });
        return true;
      case MSG.TOGGLE_INSPECTOR:
        inspector.toggle();
        sendResponse({ ok: true, active: inspector.active });
        return true;
      case MSG.START_ELEMENT_PICK:
        inspector.enable(true);
        sendResponse({ ok: true });
        return true;
      case MSG.INJECT_TEST_DATA:
        sendResponse(injectTestData(msg.value, msg.scope));
        return true;
      case MSG.INJECT_IDENTITY:
        sendResponse(injectIdentity(msg.identity));
        return true;
      case MSG.RUN_EDGE_SWEEP:
        (async () => {
          try {
            sendResponse(await runEdgeSweep(msg.cases || [], msg.options || {}));
          } catch (err) {
            sendResponse({ ok: false, reason: err.message || "Edge sweep failed" });
          }
        })();
        return true;
      case MSG.STOP_EDGE_SWEEP:
        stopRequested.edgeSweep = true;
        sendResponse({ ok: true });
        return true;
      case MSG.GET_SCREEN_MODEL:
        sendResponse(getScreenModel());
        return true;
      case MSG.RUN_GENERATED_CASES:
        (async () => {
          try {
            sendResponse(await runGeneratedCases(msg.cases || []));
          } catch (err) {
            sendResponse({ ok: false, reason: err.message || "Generated case run failed" });
          }
        })();
        return true;
      case MSG.STOP_GENERATED_CASES:
        stopRequested.generatedCases = true;
        sendResponse({ ok: true });
        return true;
      case MSG.TOGGLE_OVERLAY:
        overlay.toggle(msg.dataUrl);
        sendResponse({ ok: true, visible: overlay.visible });
        return true;
      case MSG.UPDATE_OVERLAY:
        overlay.update(msg.props);
        sendResponse({ ok: true });
        return true;
      case MSG.CLEAR_TOOLS:
        inspector.disable();
        overlay.hide();
        sendResponse({ ok: true });
        return true;
      case MSG.GET_PAGE_INFO:
        sendResponse({
          ok: true,
          url: location.href,
          title: document.title,
          inputs: document.querySelectorAll("input,textarea,select").length,
          viewport: { w: innerWidth, h: innerHeight },
        });
        return true;
      case MSG.GET_SCROLL_INFO:
        sendResponse(scrollState.get());
        return true;
      case MSG.SCROLL_TO:
        window.scrollTo(msg.x || 0, msg.y || 0);
        sendResponse({ ok: true });
        return true;
      case MSG.RESTORE_SCROLL:
        scrollState.restore();
        sendResponse({ ok: true });
        return true;
      case MSG.SET_CAPTURE_MODE:
        document.documentElement.classList.toggle("protest-capturing", !!msg.enabled);
        sendResponse({ ok: true });
        return true;
      case MSG.RUN_A11Y_SCAN:
        sendResponse(runA11yScan());
        return true;
      default:
        return false;
    }
  };
  try {
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  } catch (_) {
    return;
  }
  window.__protestOnMessage = onRuntimeMessage;

  // ======================================================================
  // Element inspector / highlighter
  // ======================================================================
  const inspector = (() => {
    let active = false;
    let pickOnce = false;
    const box = document.createElement("div");
    box.className = "protest-hl";
    const label = document.createElement("div");
    label.className = "protest-hl-label";
    box.appendChild(label);

    function onMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === box || box.contains(el)) return;
      const r = el.getBoundingClientRect();
      Object.assign(box.style, {
        top: `${r.top + scrollY}px`,
        left: `${r.left + scrollX}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      label.textContent = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} · ${Math.round(r.width)}×${Math.round(r.height)}`;
    }

    function onClick(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const selector = cssPath(el);
      safeRuntimeSend({
        type: MSG.ELEMENT_PICKED,
        selector,
        text: (el.textContent || "").trim().slice(0, 120),
        tag: el.tagName.toLowerCase(),
      });
      if (pickOnce) disable();
    }

    function enable(once = false) {
      pickOnce = once;
      if (active) return;
      active = true;
      document.body.appendChild(box);
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("click", onClick, true);
      document.body.style.cursor = "crosshair";
    }
    function disable() {
      active = false;
      box.remove();
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.body.style.cursor = "";
    }
    function toggle() {
      active ? disable() : enable(false);
    }
    return { enable, disable, toggle, get active() { return active; } };
  })();

  // Build a reasonably-stable CSS selector for an element.
  function cssPath(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const cls = [...node.classList].filter((c) => !c.startsWith("protest")).slice(0, 2);
      if (cls.length) part += "." + cls.map((c) => CSS.escape(c)).join(".");
      const parent = node.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node.id) { parts[0] = `#${CSS.escape(node.id)}`; break; }
      node = parent;
    }
    return parts.join(" > ");
  }

  // ======================================================================
  // Test-data injector (Bug Magnet style)
  // ======================================================================
  function injectTestData(value, scope) {
    let targets = [];
    if (scope === "focused") {
      const a = document.activeElement;
      if (isEditable(a)) targets = [a];
    } else {
      targets = editableTargets();
    }
    if (!targets.length) return { ok: false, reason: "No editable field found. Click into a field first." };

    targets.forEach((el) => {
      setEditableValue(el, value);
      flash(el);
    });
    return { ok: true, count: targets.length };
  }

  async function runEdgeSweep(cases, options) {
    stopRequested.edgeSweep = false;
    const targets = editableTargets();
    if (!targets.length && !options.clickActions) return { ok: false, reason: "No editable fields found on this page. Enable visible actions or use Actions only mode." };

    const values = options.actionOnly || !targets.length ? [{ label: "Visible actions", value: "" }] : cases.filter((c) => c && "value" in c);
    if (!values.length) return { ok: false, reason: "No test cases were provided." };

    const sampleFailures = [];
    let filled = 0;
    let clicks = 0;
    let maxActions = 0;
    let completedCases = 0;

    for (const testCase of values) {
      if (stopRequested.edgeSweep) break;
      try {
        if (!options.actionOnly) {
          editableTargets().forEach((el) => {
            setEditableValue(el, testCase.value);
            filled++;
          });
        }
        if (options.clickActions) {
          const actions = actionTargets();
          maxActions = Math.max(maxActions, actions.length);
          for (const action of actions) {
            if (stopRequested.edgeSweep) break;
            flash(action);
            action.click();
            clicks++;
            await sleep(180);
          }
        } else {
          await sleep(25);
        }
        completedCases++;
      } catch (err) {
        sampleFailures.push(`${testCase.label || "case"}: ${err.message || err}`);
      }
    }

    return {
      ok: true,
      cases: completedCases,
      totalCases: values.length,
      stopped: stopRequested.edgeSweep,
      fields: targets.length,
      filled,
      actions: maxActions,
      clicks,
      failures: sampleFailures.slice(0, 5),
    };
  }

  function isEditable(el) {
    return (
      el &&
      ((el.tagName === "INPUT" && !["checkbox", "radio", "submit", "button", "file", "hidden"].includes(el.type)) ||
        el.tagName === "TEXTAREA" ||
        el.isContentEditable) &&
      !el.disabled &&
      !el.readOnly
    );
  }

  function editableTargets() {
    return [...document.querySelectorAll("input,textarea,[contenteditable=true]")].filter(isEditable);
  }

  function setEditableValue(el, value) {
    if (el.isContentEditable) {
      el.textContent = value;
    } else {
      el.value = value;
    }
    // Fire the events frameworks (React/Vue/Angular) listen for.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function actionTargets() {
    const selector = [
      "button",
      'input[type="button"]',
      'input[type="submit"]',
      'input[type="reset"]',
      "a[href]",
      '[role="button"]',
      '[role="menuitem"]',
      '[tabindex]:not([tabindex="-1"])',
      "[routerlink]",
      "[ng-reflect-router-link]",
      "[onclick]",
      ".cursor-pointer",
      ".mat-mdc-button",
      ".mat-mdc-raised-button",
      ".mat-mdc-unelevated-button",
      ".mat-mdc-outlined-button",
      ".mat-mdc-icon-button",
      ".mat-mdc-menu-item",
      ".mat-mdc-list-item",
    ].join(",");

    const candidates = [...document.querySelectorAll(selector), ...[...document.querySelectorAll("body *")].filter((el) => getComputedStyle(el).cursor === "pointer")];
    const seen = new Set();
    return candidates.filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      if (el === document.body || el === document.documentElement) return false;
      if (isEditable(el) || el.disabled || el.getAttribute("aria-disabled") === "true") return false;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || style.pointerEvents === "none") return false;
      if (el.closest("[hidden], [aria-hidden='true']")) return false;
      return true;
    }).slice(0, 40);
  }

  function getScreenModel() {
    const fields = editableTargets().map((el, i) => ({
      index: i,
      selector: cssPath(el),
      label: fieldLabel(el),
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      required: !!el.required || el.getAttribute("aria-required") === "true",
    }));
    const actions = actionTargets().map((el, i) => ({
      index: i,
      selector: cssPath(el),
      label: actionLabel(el) || `Action ${i + 1}`,
      tag: el.tagName.toLowerCase(),
      kind: actionKind(el),
    }));
    return {
      ok: true,
      url: location.href,
      title: document.title,
      heading: firstText("h1,h2,[role='heading']"),
      fields,
      actions,
    };
  }

  async function runGeneratedCases(cases) {
    stopRequested.generatedCases = false;
    const results = [];
    for (const testCase of cases.filter((c) => c?.enabled !== false)) {
      if (stopRequested.generatedCases) break;
      const started = Date.now();
      try {
        const outcome = await runGeneratedCase(testCase);
        results.push({ id: testCase.id, title: testCase.title, status: outcome.ok ? "pass" : "blocked", notes: outcome.notes, duration: Date.now() - started });
      } catch (err) {
        results.push({ id: testCase.id, title: testCase.title, status: "fail", notes: err.message || String(err), duration: Date.now() - started });
      }
    }
    return { ok: true, stopped: stopRequested.generatedCases, results };
  }

  async function runGeneratedCase(testCase) {
    const notes = [];
    for (const step of testCase.steps || []) {
      if (stopRequested.generatedCases) return { ok: false, notes: "Stopped by tester." };
      if (step.action === "click") {
        const el = findAction(step);
        if (!el) return { ok: false, notes: `Could not find action: ${step.label || step.selector || "unknown"}` };
        flash(el);
        el.click();
        notes.push(`Clicked ${actionLabel(el) || step.label || step.selector}`);
        await sleep(350);
      } else if (step.action === "fill") {
        const fields = editableTargets();
        if (!fields.length) return { ok: false, notes: "No editable fields found." };
        fields.forEach((el) => {
          setEditableValue(el, valueForField(el, step.value || "valid"));
          flash(el);
        });
        notes.push(`Filled ${fields.length} field(s).`);
        await sleep(150);
      } else if (step.action === "validate") {
        notes.push(step.expect || "Validated visible result manually.");
        await sleep(100);
      }
    }
    return { ok: true, notes: notes.join("\n") || "Completed." };
  }

  function findAction(step) {
    if (step.selector) {
      const el = document.querySelector(step.selector);
      if (el) return el;
    }
    const wanted = normalizeText(step.label || "");
    return actionTargets().find((el) => normalizeText(actionLabel(el)).includes(wanted) || wanted.includes(normalizeText(actionLabel(el))));
  }

  function fieldLabel(el) {
    const idLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : "";
    return (idLabel || el.closest("label")?.textContent || el.getAttribute("aria-label") || el.placeholder || el.name || el.id || "").trim();
  }

  function actionLabel(el) {
    return (el.getAttribute("aria-label") || el.title || el.value || el.textContent || "").trim().replace(/\s+/g, " ");
  }

  function actionKind(el) {
    const label = normalizeText(actionLabel(el));
    if (/add|create|new|إضافة|جديد/.test(label)) return "create";
    if (/save|submit|حفظ|ارسال/.test(label)) return "submit";
    if (/search|بحث/.test(label)) return "search";
    if (/edit|تعديل/.test(label)) return "edit";
    if (/delete|remove|حذف/.test(label)) return "delete";
    return "navigate";
  }

  function valueForField(el, variant) {
    const hint = normalizeText(`${fieldLabel(el)} ${el.name || ""} ${el.id || ""} ${el.type || ""}`);
    if (variant === "empty") return "";
    if (/email|بريد/.test(hint)) return "qa.tester@example.com";
    if (/phone|mobile|جوال|هاتف/.test(hint)) return "+966500000000";
    if (/number|count|رقم|عدد/.test(hint) || el.type === "number") return "123";
    if (/desc|description|وصف/.test(hint)) return "وصف اختبار آلي";
    return "اختبار آلي";
  }

  function firstText(selector) {
    return (document.querySelector(selector)?.textContent || "").trim().replace(/\s+/g, " ");
  }

  function normalizeText(text = "") {
    return String(text).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Smart-fill a whole form with a fake identity by matching each field's
  // type / name / id / placeholder / autocomplete against known field roles.
  function injectIdentity(identity) {
    const fields = [...document.querySelectorAll("input, textarea, select")];
    // Ordered rules: first match wins for a given field.
    const rules = [
      [/pass(word|wd)/i, identity.password],
      [/e-?mail/i, identity.email],
      [/(^|[^a-z])tel|phone|mobile/i, identity.phone],
      [/first.?name|given.?name|fname/i, identity.firstName],
      [/last.?name|surname|family.?name|lname/i, identity.lastName],
      [/user.?name|login|handle/i, identity.username],
      [/full.?name|your.?name|(^|[^a-z])name([^a-z]|$)/i, identity.fullName],
      [/address|street|addr/i, identity.address],
      [/city|town/i, identity.city],
      [/zip|postal|postcode/i, identity.zip],
    ];
    let count = 0;
    fields.forEach((el) => {
      if (el.type && ["checkbox", "radio", "submit", "button", "file", "hidden"].includes(el.type)) return;
      if (el.disabled || el.readOnly) return;
      // Match on the combined descriptor of the field.
      const hint = `${el.name} ${el.id} ${el.placeholder || ""} ${el.autocomplete || ""} ${el.getAttribute("aria-label") || ""} ${el.type || ""}`;
      // Direct type shortcuts.
      let value = null;
      if (el.type === "email") value = identity.email;
      else if (el.type === "tel") value = identity.phone;
      else if (el.type === "password") value = identity.password;
      else {
        const rule = rules.find(([re]) => re.test(hint));
        if (rule) value = rule[1];
      }
      if (value == null) return;
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      flash(el);
      count++;
    });
    return count ? { ok: true, count } : { ok: false, reason: "No recognizable form fields found on this page." };
  }

  function flash(el) {
    const prev = el.style.outline;
    el.style.outline = "2px solid #4f46e5";
    el.style.outlineOffset = "1px";
    setTimeout(() => (el.style.outline = prev), 600);
  }

  // ======================================================================
  // UX screenshot overlay (compare reference vs live page)
  // ======================================================================
  const overlay = (() => {
    let root = null;
    let props = { opacity: 0.5, scale: 1, x: 0, y: 0, blend: "normal" };
    let visible = false;

    function ensure(dataUrl) {
      if (root) return;
      root = document.createElement("div");
      root.className = "protest-overlay";
      const img = document.createElement("img");
      img.src = dataUrl;
      img.draggable = false;
      root.appendChild(img);

      const bar = document.createElement("div");
      bar.className = "protest-overlay-bar";
      bar.innerHTML = `<span class="protest-grip">⋮⋮ UX overlay</span>
        <button data-act="opacity-">–opacity</button>
        <button data-act="opacity+">+opacity</button>
        <button data-act="scale-">–size</button>
        <button data-act="scale+">+size</button>
        <button data-act="blend">difference</button>
        <button data-act="close">✕</button>`;
      root.appendChild(bar);
      document.body.appendChild(root);

      // Drag by the bar.
      let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      bar.addEventListener("mousedown", (e) => {
        if (e.target.tagName === "BUTTON") return;
        dragging = true; sx = e.clientX; sy = e.clientY; ox = props.x; oy = props.y;
        e.preventDefault();
      });
      document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        props.x = ox + (e.clientX - sx);
        props.y = oy + (e.clientY - sy);
        apply();
      });
      document.addEventListener("mouseup", () => (dragging = false));

      bar.addEventListener("click", (e) => {
        const act = e.target.getAttribute("data-act");
        if (!act) return;
        if (act === "opacity+") props.opacity = Math.min(1, props.opacity + 0.1);
        if (act === "opacity-") props.opacity = Math.max(0.05, props.opacity - 0.1);
        if (act === "scale+") props.scale = Math.min(3, props.scale + 0.1);
        if (act === "scale-") props.scale = Math.max(0.2, props.scale - 0.1);
        if (act === "blend") props.blend = props.blend === "normal" ? "difference" : "normal";
        if (act === "close") return hide();
        apply();
      });
    }

    function apply() {
      if (!root) return;
      const img = root.querySelector("img");
      img.style.opacity = props.opacity;
      img.style.mixBlendMode = props.blend;
      root.style.transform = `translate(${props.x}px, ${props.y}px) scale(${props.scale})`;
    }

    function show(dataUrl) {
      if (!dataUrl) return;
      ensure(dataUrl);
      root.style.display = "block";
      visible = true;
      apply();
    }
    function hide() {
      if (root) root.style.display = "none";
      visible = false;
    }
    function toggle(dataUrl) {
      visible ? hide() : show(dataUrl);
    }
    function update(patch) {
      props = { ...props, ...patch };
      apply();
    }
    return { show, hide, toggle, update, get visible() { return visible; } };
  })();

  // ======================================================================
  // Scroll state (for full-page screenshot stitching)
  // ======================================================================
  const scrollState = (() => {
    let original = { x: 0, y: 0 };
    function get() {
      original = { x: scrollX, y: scrollY };
      const de = document.documentElement;
      return {
        ok: true,
        scrollHeight: Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        dpr: devicePixelRatio || 1,
      };
    }
    function restore() {
      window.scrollTo(original.x, original.y);
    }
    return { get, restore };
  })();

  // ======================================================================
  // Accessibility quick-check — a lightweight heuristic scanner, not a full
  // WCAG audit. Flags common, high-signal issues a tester can act on
  // immediately: missing alt text, unlabeled fields, empty link/button
  // names, duplicate ids, missing lang/title, and low text contrast.
  // ======================================================================
  function runA11yScan() {
    const issues = [];
    const MAX = 60;

    function add(severity, rule, message, el) {
      if (issues.length >= MAX) return;
      issues.push({ severity, rule, message, selector: el ? cssPath(el) : "" });
    }

    if (!document.documentElement.getAttribute("lang")) {
      add("medium", "html-lang", "The <html> element has no lang attribute — screen readers may mispronounce content.", document.documentElement);
    }
    if (!document.title || !document.title.trim()) {
      add("medium", "page-title", "The page has no <title>.", null);
    }

    document.querySelectorAll("img").forEach((img) => {
      if (!img.hasAttribute("alt")) add("high", "img-alt", "Image is missing an alt attribute.", img);
    });

    document.querySelectorAll("input, textarea, select").forEach((el) => {
      if (el.type === "hidden" || el.disabled) return;
      const hasLabel =
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
        el.closest("label") ||
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        el.getAttribute("title");
      if (!hasLabel) add("high", "input-label", `<${el.tagName.toLowerCase()}${el.type ? ` type="${el.type}"` : ""}> has no associated label.`, el);
    });

    document.querySelectorAll("button, a[href]").forEach((el) => {
      const text = (el.textContent || "").trim();
      const hasAccName = text || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.querySelector("img[alt]");
      if (!hasAccName) add("high", "accessible-name", `<${el.tagName.toLowerCase()}> has no visible text or accessible name.`, el);
    });

    const idCounts = new Map();
    document.querySelectorAll("[id]").forEach((el) => idCounts.set(el.id, (idCounts.get(el.id) || 0) + 1));
    idCounts.forEach((count, id) => {
      if (count > 1) add("low", "duplicate-id", `The id "${id}" is used ${count} times on this page.`, document.getElementById(id));
    });

    checkContrast(add);

    return { ok: true, issues, truncated: issues.length >= MAX };
  }

  function checkContrast(add) {
    const candidates = [...document.querySelectorAll("body *")]
      .filter((el) => {
        if (el.children.length > 0) return false; // leaf text elements only
        if (!el.textContent || !el.textContent.trim()) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0;
      })
      .slice(0, 400);

    let checked = 0;
    for (const el of candidates) {
      if (checked >= 150) break; // perf cap — this is a heuristic sample, not exhaustive
      const style = getComputedStyle(el);
      const fg = parseColor(style.color);
      if (!fg) continue;
      const bg = getEffectiveBackground(el);
      if (!bg) continue;
      const ratio = contrastRatio(fg, bg);
      const size = parseFloat(style.fontSize) || 16;
      const weight = parseInt(style.fontWeight, 10) || 400;
      const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
      const min = isLarge ? 3 : 4.5;
      checked++;
      if (ratio < min) {
        add("medium", "contrast", `Text contrast ratio ${ratio.toFixed(2)}:1 is below the WCAG AA minimum of ${min}:1.`, el);
      }
    }
  }

  function parseColor(str) {
    const m = str && str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((s) => parseFloat(s));
    if (parts.length >= 4 && parts[3] === 0) return null; // fully transparent — keep looking
    return parts.slice(0, 3);
  }

  function getEffectiveBackground(el) {
    let node = el;
    while (node) {
      const bg = parseColor(getComputedStyle(node).backgroundColor);
      if (bg) return bg;
      node = node.parentElement;
    }
    return [255, 255, 255];
  }

  function luminance([r, g, b]) {
    const a = [r, g, b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }

  function contrastRatio(c1, c2) {
    const l1 = luminance(c1) + 0.05;
    const l2 = luminance(c2) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
  }

  // Let the side panel know we're alive on load.
  safeRuntimeSend({ type: MSG.PAGE_LOG, entry: { type: "system", level: "info", message: "ProTest content ready", ts: Date.now() } });

  function extensionRuntimeAvailable() {
    try {
      return !!chrome?.runtime?.id;
    } catch (_) {
      return false;
    }
  }

  function safeRuntimeSend(message) {
    try {
      if (!extensionRuntimeAvailable()) return;
      const result = chrome.runtime.sendMessage(message);
      if (result?.catch) result.catch(() => {});
    } catch (_) {
      // Ignore stale content scripts after extension reload/update.
    }
  }
})();
