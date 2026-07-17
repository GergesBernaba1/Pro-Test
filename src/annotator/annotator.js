// Screenshot annotation editor. Loads the captured screenshot handed off by the
// background worker, lets the tester draw rectangles / arrows / text / blur
// redactions on a canvas, then saves the flattened result back to the session.

import { MSG } from "../lib/messages.js";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const stage = document.getElementById("stage");
const textInput = document.getElementById("textInput");

let baseImage = null; // the original screenshot (never mutated)
let shapes = []; // committed annotations
let tool = "rect";
let color = "#f43f5e";
let draft = null; // shape currently being drawn
let pageUrl = "";

// ============================================================================
// Boot: fetch the screenshot payload from the background worker.
// ============================================================================
chrome.runtime.sendMessage({ type: MSG.GET_ANNOTATOR_PAYLOAD }, (res) => {
  if (!res?.payload?.dataUrl) {
    document.getElementById("loading").textContent = "No screenshot to annotate.";
    return;
  }
  pageUrl = res.payload.pageUrl || "";
  const img = new Image();
  img.onload = () => {
    baseImage = img;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    document.getElementById("loading").hidden = true;
    render();
  };
  img.src = res.payload.dataUrl;
});

// ============================================================================
// Toolbar wiring
// ============================================================================
document.getElementById("tools").addEventListener("click", (e) => {
  const b = e.target.closest(".tool");
  if (!b) return;
  tool = b.dataset.tool;
  document.querySelectorAll(".tool").forEach((t) => t.classList.toggle("active", t === b));
});

document.getElementById("colors").addEventListener("click", (e) => {
  const b = e.target.closest(".swatch");
  if (!b) return;
  color = b.dataset.color;
  document.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("active", s === b));
});

document.getElementById("undoBtn").addEventListener("click", () => {
  shapes.pop();
  render();
});
document.getElementById("clearBtn").addEventListener("click", () => {
  shapes = [];
  render();
});
document.getElementById("downloadBtn").addEventListener("click", download);
document.getElementById("saveBtn").addEventListener("click", save);

// ============================================================================
// Drawing interaction
// ============================================================================
function pos(e) {
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
}

canvas.addEventListener("mousedown", (e) => {
  if (!baseImage) return;
  const p = pos(e);
  if (tool === "text") return placeText(p, e);
  draft = { type: tool, color, x: p.x, y: p.y, w: 0, h: 0 };
});

canvas.addEventListener("mousemove", (e) => {
  if (!draft) return;
  const p = pos(e);
  draft.w = p.x - draft.x;
  draft.h = p.y - draft.y;
  render();
  drawShape(draft);
});

window.addEventListener("mouseup", () => {
  if (!draft) return;
  // Ignore accidental micro-drags.
  if (Math.abs(draft.w) > 3 || Math.abs(draft.h) > 3) shapes.push(draft);
  draft = null;
  render();
});

function placeText(p, e) {
  textInput.hidden = false;
  textInput.value = "";
  textInput.style.left = `${e.clientX}px`;
  textInput.style.top = `${e.clientY}px`;
  textInput.style.color = color;
  textInput.focus();
  const commit = () => {
    const val = textInput.value.trim();
    textInput.hidden = true;
    if (val) shapes.push({ type: "text", color, x: p.x, y: p.y, text: val });
    render();
    textInput.removeEventListener("blur", commit);
  };
  textInput.addEventListener("blur", commit);
  textInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") commit();
    if (ev.key === "Escape") {
      textInput.hidden = true;
      textInput.removeEventListener("blur", commit);
    }
  });
}

// ============================================================================
// Rendering
// ============================================================================
function render() {
  if (!baseImage) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseImage, 0, 0);
  shapes.forEach(drawShape);
}

function drawShape(s) {
  const lw = Math.max(2, Math.round(canvas.width / 400));
  ctx.lineWidth = lw;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;

  if (s.type === "rect") {
    ctx.strokeRect(s.x, s.y, s.w, s.h);
  } else if (s.type === "arrow") {
    drawArrow(s.x, s.y, s.x + s.w, s.y + s.h, lw);
  } else if (s.type === "text") {
    const size = Math.max(16, Math.round(canvas.width / 45));
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textBaseline = "top";
    // subtle backing for legibility
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    const w = ctx.measureText(s.text).width;
    ctx.fillRect(s.x - 3, s.y - 2, w + 6, size + 6);
    ctx.restore();
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, s.x, s.y);
  } else if (s.type === "blur") {
    drawBlur(s);
  }
}

function drawArrow(x1, y1, x2, y2, lw) {
  const head = Math.max(10, lw * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawBlur(s) {
  // Normalize negative width/height.
  const x = Math.min(s.x, s.x + s.w);
  const y = Math.min(s.y, s.y + s.h);
  const w = Math.abs(s.w);
  const h = Math.abs(s.h);
  if (w < 2 || h < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.filter = "blur(12px)";
  ctx.drawImage(baseImage, 0, 0);
  ctx.restore();
}

// ============================================================================
// Save / download
// ============================================================================
function toDataUrl() {
  render();
  return canvas.toDataURL("image/png");
}

function save() {
  const dataUrl = toDataUrl();
  chrome.runtime.sendMessage({ type: MSG.ANNOTATOR_SAVE, dataUrl }, () => {
    const btn = document.getElementById("saveBtn");
    btn.textContent = "✓ Saved — you can close this tab";
    btn.disabled = true;
    // Best effort: extension-opened tabs can usually self-close.
    setTimeout(() => window.close(), 600);
  });
}

function download() {
  const a = document.createElement("a");
  a.href = toDataUrl();
  a.download = `protest-screenshot-${Date.now()}.png`;
  a.click();
}
