/*
  PDF Ink to SVG — application logic
  https://github.com/joegasper/pdf-ink-to-svg

  SPDX-License-Identifier: MIT
  Copyright (c) 2026 Joe Gasper

  Everything runs in the browser. Files are read with the File API, parsed by
  pdf.js (Apache-2.0, vendored in ./vendor/pdfjs), and never leave the page.
*/

import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";
import { t, has, formatList, applyTo, init as initI18n, initLanguagePicker } from "./i18n.js";
import { VERSION } from "./version.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

// pdf.js 6.x calls Map.prototype.getOrInsertComputed (a TC39 proposal) from
// getOperatorList(). Browsers that predate it throw, so supply it if missing.
if (!Map.prototype.getOrInsertComputed) {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    value(key, compute) {
      if (!this.has(key)) this.set(key, compute(key));
      return this.get(key);
    },
    writable: true, configurable: true,
  });
}

const SVG_NS = "http://www.w3.org/2000/svg";

const ui = {
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("file-input"),
  keepPageSize: document.getElementById("opt-page-size"),
  status: document.getElementById("status"),
  resultsHeader: document.getElementById("results-header"),
  cards: document.getElementById("cards"),
  cardTemplate: document.getElementById("card-template"),
  flattenedNote: document.getElementById("flattened-note"),
  langSelect: document.getElementById("lang-select"),
  versionLink: document.getElementById("version-link"),
  downloadAll: document.getElementById("download-all"),
  clear: document.getElementById("clear"),
};

/** Extracted results currently on screen: { name, svgText, blobUrl, kind, item } */
let results = [];

/**
 * The last summary, kept as the values that produced it rather than as
 * finished text, so switching language re-renders it properly.
 */
let lastSummary = null;

/* --------------------------------------------------------------------------
   Ink annotation -> SVG
   -------------------------------------------------------------------------- */

/**
 * Convert one pdf.js Ink annotation into an SVG element.
 *
 * PDF coordinates use points (1/72 in) with the origin at the bottom-left
 * of the page, so y is flipped against the page's top edge.
 *
 * @param {object} annot  Annotation from page.getAnnotations() (subtype "Ink")
 * @param {number[]} view Page box [x0, y0, x1, y1] from page.view
 * @param {{ keepPageSize: boolean }} opts
 * @returns {{ svg: SVGSVGElement, strokes: number, points: number }}
 */
function inkToSvg(annot, view, opts) {
  const [vx0, , vx1, vy1] = view;
  const pageWidth = vx1 - vx0;
  const pageHeight = vy1 - view[1];

  const strokes = annot.inkLists.map(toPointPairs).map((pts) =>
    pts.map(([x, y]) => [x - vx0, vy1 - y]),
  );

  const width = annot.borderStyle?.width > 0 ? annot.borderStyle.width : 1;
  const opacity = typeof annot.opacity === "number" ? annot.opacity : 1;
  const color = toCssColor(annot.color);

  // Bounding box: either the full page, or the ink plus a small margin.
  let minX = 0, minY = 0, boxW = pageWidth, boxH = pageHeight;
  if (!opts.keepPageSize) {
    const pad = width / 2 + 2;
    const xs = strokes.flat().map((p) => p[0]);
    const ys = strokes.flat().map((p) => p[1]);
    minX = Math.min(...xs) - pad;
    minY = Math.min(...ys) - pad;
    boxW = Math.max(...xs) - minX + pad;
    boxH = Math.max(...ys) - minY + pad;
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `0 0 ${fmt(boxW)} ${fmt(boxH)}`);
  svg.setAttribute("width", `${fmt(boxW)}pt`);
  svg.setAttribute("height", `${fmt(boxH)}pt`);

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("fill", "none");
  g.setAttribute("stroke", color);
  g.setAttribute("stroke-width", fmt(width));
  if (opacity < 1) g.setAttribute("stroke-opacity", fmt(opacity));
  g.setAttribute("stroke-linecap", "round");
  g.setAttribute("stroke-linejoin", "round");

  let points = 0;
  for (const pts of strokes) {
    if (pts.length === 0) continue;
    points += pts.length;
    const path = document.createElementNS(SVG_NS, "path");
    const d = pts
      .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${fmt(x - minX)} ${fmt(y - minY)}`)
      .join(" ");
    path.setAttribute("d", d);
    g.appendChild(path);
  }
  svg.appendChild(g);

  return { svg, strokes: strokes.length, points };
}

/** pdf.js gives a flat [x, y, x, y, ...] list; older builds gave [{x, y}]. */
function toPointPairs(list) {
  if (list.length && typeof list[0] === "object") {
    return Array.from(list, (p) => [p.x, p.y]);
  }
  const out = [];
  for (let i = 0; i + 1 < list.length; i += 2) out.push([list[i], list[i + 1]]);
  return out;
}

/** pdf.js reports color as RGB 0–255 (Uint8ClampedArray), or null. */
function toCssColor(c) {
  if (!c || c.length < 3) return "#000000";
  return "#" + Array.from(c, (v) => v.toString(16).padStart(2, "0")).join("");
}

function fmt(n) {
  return Number(n.toFixed(2)).toString();
}

/* --------------------------------------------------------------------------
   Flattened ink -> SVG

   When an ink annotation is flattened, the strokes are usually not rasterized.
   They are moved into the page content as ordinary path operators, often
   inside a Form XObject. pdf.js exposes those through getOperatorList(), with
   transforms already composed and colors already normalised to RGB.
   -------------------------------------------------------------------------- */

// pdf.js encodes a path as [opcode, ...coords, opcode, ...coords, ...].
const DRAW = { MOVE: 0, LINE: 1, CUBIC: 2, QUADRATIC: 3, CLOSE: 4 };
const ARITY = { 0: 2, 1: 2, 2: 6, 3: 4, 4: 0 };
const LETTER = { 0: "M", 1: "L", 2: "C", 3: "Q", 4: "Z" };

// constructPath's first argument is the painting operator. These paint a line.
const STROKING = new Set([
  pdfjsLib.OPS.stroke,
  pdfjsLib.OPS.closeStroke,
  pdfjsLib.OPS.fillStroke,
  pdfjsLib.OPS.eoFillStroke,
  pdfjsLib.OPS.closeFillStroke,
  pdfjsLib.OPS.closeEOFillStroke,
]);

/**
 * Handwriting is a long, wandering polyline. Page furniture — rules, borders,
 * table cells, underlines — is two or three points. A minimum vertex count
 * separates the two without having to guess what the drawing depicts.
 *
 * The threshold decides whether a path can *start* a drawing. Once one is
 * under way, shorter strokes drawn alongside it are kept too: the dot on an
 * "i" or a short crossbar is only a few points, and dropping those would
 * quietly mangle the signature.
 */
const MIN_VERTICES = 12;

function matrixMultiply(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/** Count the vertices in one pdf.js path array. */
function countVertices(path) {
  let n = 0;
  for (let i = 0; i < path.length; ) {
    const op = path[i++];
    const arity = ARITY[op];
    if (arity === undefined) break;
    i += arity;
    if (op !== DRAW.CLOSE) n++;
  }
  return n;
}

/**
 * Turn one pdf.js path array into SVG path data, mapping every coordinate
 * through the current transform and flipping y against the page height.
 */
function pathToSvgData(path, ctm, pageHeight, bounds) {
  const parts = [];
  for (let i = 0; i < path.length; ) {
    const op = path[i++];
    const arity = ARITY[op];
    if (arity === undefined) break;
    const coords = [];
    for (let k = 0; k < arity; k += 2) {
      const x = path[i + k];
      const y = path[i + k + 1];
      const X = ctm[0] * x + ctm[2] * y + ctm[4];
      const Y = pageHeight - (ctm[1] * x + ctm[3] * y + ctm[5]);
      coords.push(`${fmt(X)} ${fmt(Y)}`);
      bounds.add(X, Y);
    }
    i += arity;
    parts.push(LETTER[op] + (coords.length ? " " + coords.join(" ") : ""));
  }
  return parts.join(" ");
}

class Bounds {
  constructor() {
    this.minX = Infinity; this.minY = Infinity;
    this.maxX = -Infinity; this.maxY = -Infinity;
  }
  add(x, y) {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }
  get valid() {
    return Number.isFinite(this.minX);
  }
}

/**
 * Scan a page's drawing operators for stroked paths that look hand-drawn, and
 * group the ones drawn together into a single result.
 *
 * @returns {Promise<{ groups: Array<object>, images: number }>}
 */
async function extractFlattenedInk(page) {
  // Annotations are excluded here; anything with an /InkList is handled by the
  // annotation pass, and leaving them enabled would report the same ink twice.
  const opList = await page.getOperatorList({
    annotationMode: pdfjsLib.AnnotationMode.DISABLE,
  });
  const OPS = pdfjsLib.OPS;

  const [vx0, vy0, , vy1] = page.view;
  const pageHeight = vy1 - vy0;

  let state = {
    ctm: [1, 0, 0, 1, -vx0, -vy0],
    color: "#000000",
    width: 1,
    cap: "round",
    join: "round",
    alpha: 1,
  };
  const stack = [];
  const caps = ["butt", "round", "square"];
  const joins = ["miter", "round", "bevel"];

  const groups = [];
  let current = null;
  let formDepth = 0;
  let formSerial = 0;
  let images = 0;
  let lastIndex = -Infinity;

  const closeGroup = () => { current = null; };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    switch (fn) {
      case OPS.save:
        stack.push({ ...state });
        break;
      case OPS.restore:
        if (stack.length) state = stack.pop();
        break;
      case OPS.transform:
        state.ctm = matrixMultiply(args, state.ctm);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ...state });
        formDepth++;
        formSerial++;
        state.ctm = matrixMultiply(args[0], state.ctm);
        break;
      case OPS.paintFormXObjectEnd:
        if (stack.length) state = stack.pop();
        formDepth = Math.max(0, formDepth - 1);
        closeGroup();
        break;
      case OPS.setLineWidth:
        state.width = args[0];
        break;
      case OPS.setLineCap:
        state.cap = caps[args[0]] ?? "round";
        break;
      case OPS.setLineJoin:
        state.join = joins[args[0]] ?? "round";
        break;
      case OPS.setStrokeRGBColor:
        // pdf.js resolves every colour space to an RGB string for us.
        state.color = typeof args[0] === "string" ? args[0] : state.color;
        break;
      case OPS.setGState:
        for (const [key, value] of args[0] ?? []) {
          if (key === "LW") state.width = value;
          else if (key === "CA") state.alpha = value;
          else if (key === "LC") state.cap = caps[value] ?? state.cap;
          else if (key === "LJ") state.join = joins[value] ?? state.join;
        }
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
        images++;
        closeGroup();
        break;
      case OPS.constructPath: {
        const [paintOp, paths] = args;
        if (!STROKING.has(paintOp) || !paths?.length) break;

        let vertices = 0;
        let longest = 0;
        for (const path of paths) {
          const n = countVertices(path);
          vertices += n;
          if (n > longest) longest = n;
        }
        if (!vertices) break;

        // Strokes drawn close together belong to one piece of handwriting.
        // A form XObject is a hard boundary; outside one, fall back to
        // proximity in the operator list.
        const continues = Boolean(current)
          && (formDepth > 0 ? current.formSerial === formSerial : i - lastIndex <= 40)
          && current.color === state.color;

        // Long enough to be handwriting on its own, or part of one already found.
        const substantial = longest >= MIN_VERTICES;
        if (!substantial && !continues) break;

        if (!continues) {
          current = {
            formSerial, color: state.color, alpha: state.alpha,
            cap: state.cap, join: state.join,
            width: state.width, ctm: state.ctm,
            paths: [], strokes: 0, points: 0, bounds: new Bounds(),
          };
          groups.push(current);
        }
        for (const path of paths) {
          current.paths.push(pathToSvgData(path, state.ctm, pageHeight, current.bounds));
          current.strokes++;
        }
        current.points += vertices;
        // A stroke's width is in user space; the transform scales it. For a
        // non-uniform transform the geometric mean is the usable single value.
        const scale = Math.sqrt(Math.abs(state.ctm[0] * state.ctm[3] - state.ctm[1] * state.ctm[2])) || 1;
        current.strokeWidth = Math.max(state.width * scale, 0.1);
        // Only a substantial stroke extends the proximity window, so a run of
        // short segments cannot daisy-chain a group across a whole page.
        if (substantial) lastIndex = i;
        break;
      }
      default:
        break;
    }
  }

  return { groups: groups.filter((g) => g.bounds.valid), images, pageHeight,
           pageWidth: page.view[2] - vx0 };
}

/** Build an SVG element from a group of flattened strokes. */
function flattenedToSvg(group, opts) {
  const pad = group.strokeWidth / 2 + 2;
  let x0 = 0, y0 = 0, w = group.pageWidth, h = group.pageHeight;
  if (!opts.keepPageSize) {
    x0 = group.bounds.minX - pad;
    y0 = group.bounds.minY - pad;
    w = group.bounds.maxX - x0 + pad;
    h = group.bounds.maxY - y0 + pad;
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `${fmt(x0)} ${fmt(y0)} ${fmt(w)} ${fmt(h)}`);
  svg.setAttribute("width", `${fmt(w)}pt`);
  svg.setAttribute("height", `${fmt(h)}pt`);

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("fill", "none");
  g.setAttribute("stroke", group.color);
  g.setAttribute("stroke-width", fmt(group.strokeWidth));
  if (group.alpha < 1) g.setAttribute("stroke-opacity", fmt(group.alpha));
  g.setAttribute("stroke-linecap", group.cap);
  g.setAttribute("stroke-linejoin", group.join);

  for (const d of group.paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    g.appendChild(path);
  }
  svg.appendChild(g);
  return svg;
}

/* --------------------------------------------------------------------------
   PDF processing
   -------------------------------------------------------------------------- */

/**
 * Read a PDF and return one result per piece of ink — both real ink
 * annotations and strokes flattened into the page content — plus a tally of
 * the other annotation types and images present, so an empty result can be
 * explained rather than just reported.
 * @param {File} file
 * @returns {Promise<{ items: Array<object>, others: Map<string, number>, images: number }>}
 */
async function extractInk(file, opts) {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjsLib.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  const base = file.name.replace(/\.pdf$/i, "") || "ink";
  const found = [];
  const others = new Map();
  let images = 0;
  const tally = (key, kind = "") => {
    const id = kind ? `${key}\u0000${kind}` : key;
    others.set(id, (others.get(id) ?? 0) + 1);
  };

  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const annots = await page.getAnnotations();
      let n = 0;
      for (const annot of annots) {
        if (annot.subtype !== "Ink") {
          // Recorded as a key plus the raw PDF subtype, so the message can be
          // translated and pluralised rather than assembled from English.
          tally(annot.subtype === "Widget" ? "annot.formField" : "annot.other",
                annot.subtype || "unknown");
          continue;
        }
        if (!annot.inkLists?.length) {
          tally("annot.inkNoPoints");
          continue;
        }
        if (annot.hidden) {
          tally("annot.hiddenInk");
          continue;
        }
        n++;
        const { svg, strokes, points } = inkToSvg(annot, page.view, opts);
        found.push({
          name: `${base}-page${pageNo}-ink${n}.svg`,
          page: pageNo,
          index: n,
          kind: "annotation",
          strokes,
          points,
          svg,
        });
      }

      // Second pass: strokes drawn into the page itself, i.e. flattened ink.
      const flat = await extractFlattenedInk(page);
      images += flat.images;
      let f = 0;
      for (const group of flat.groups) {
        group.pageWidth = flat.pageWidth;
        group.pageHeight = flat.pageHeight;
        f++;
        found.push({
          name: `${base}-page${pageNo}-flattened${f}.svg`,
          page: pageNo,
          index: f,
          kind: "flattened",
          strokes: group.strokes,
          points: group.points,
          svg: flattenedToSvg(group, opts),
        });
      }

      page.cleanup?.();
    }
  } finally {
    await task.destroy();
  }
  return { items: found, others, images };
}

/* --------------------------------------------------------------------------
   UI
   -------------------------------------------------------------------------- */

function setStatus(message, { error = false, list = [] } = {}) {
  ui.status.textContent = "";
  ui.status.classList.toggle("is-error", error);
  if (!message) return;
  ui.status.append(message);
  if (list.length) {
    const ul = document.createElement("ul");
    for (const item of list) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    }
    ui.status.appendChild(ul);
  }
}

function addCard(item) {
  const svgText = new XMLSerializer().serializeToString(item.svg);
  const blobUrl = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
  results.push({ name: item.name, svgText, blobUrl, kind: item.kind, item });

  const card = ui.cardTemplate.content.firstElementChild.cloneNode(true);
  // Template contents are not part of the document, so they are translated
  // here rather than by the page-wide pass.
  applyTo(card);

  // Preview: same SVG, sized by CSS instead of fixed points.
  const preview = item.svg.cloneNode(true);
  preview.removeAttribute("width");
  preview.removeAttribute("height");
  preview.setAttribute("role", "img");
  preview.setAttribute("aria-label", t("card.previewLabel", {
    source: t(`source.${item.kind}`),
    index: item.index,
    page: item.page,
  }));
  card.querySelector(".paper").appendChild(preview);

  card.querySelector(".card-title").textContent = item.name;
  card.querySelector(".card-meta").textContent = t("card.meta", {
    page: item.page,
    strokes: unit("unit.stroke", item.strokes),
    points: unit("unit.point", item.points),
  });

  const badge = card.querySelector(".card-badge");
  badge.textContent = t(`badge.${item.kind}`);
  badge.classList.add(item.kind === "flattened" ? "badge-flat" : "badge-annot");
  badge.title = t(`badge.${item.kind}.title`);

  const link = card.querySelector(".card-download");
  link.href = blobUrl;
  link.download = item.name;
  link.setAttribute("aria-label", t("card.downloadLabel", { name: item.name }));

  ui.cards.appendChild(card);
}

/** A counted noun in the active language, e.g. "5 strokes" / "5 trazos". */
function unit(key, count) {
  return t(key, { count });
}

function refreshHeader() {
  ui.resultsHeader.hidden = results.length === 0;
  ui.downloadAll.hidden = results.length < 2;
  ui.flattenedNote.hidden = !results.some((r) => r.kind === "flattened");
}

function clearResults() {
  discardCards();
  lastSummary = null;
  refreshHeader();
  setStatus("");
}

function discardCards() {
  for (const r of results) URL.revokeObjectURL(r.blobUrl);
  results = [];
  ui.cards.textContent = "";
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(
    (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name),
  );
  const skipped = fileList.length - files.length;
  if (files.length === 0) {
    lastSummary = { added: 0, flattened: 0, skipped, problems: [] };
    setStatus(t("status.onlyPdf"), { error: true });
    lastSummary = null;
    return;
  }

  const opts = { keepPageSize: ui.keepPageSize.checked };
  const problems = [];
  let added = 0;
  let flattened = 0;

  setStatus(t("status.reading", { files: unit("unit.file", files.length) }));
  ui.dropzone.setAttribute("aria-busy", "true");

  for (const file of files) {
    try {
      const { items, others, images } = await extractInk(file, opts);
      if (items.length === 0) {
        problems.push({ kind: "noInk", file: file.name, others, images });
        continue;
      }
      for (const item of items) addCard(item);
      added += items.length;
      flattened += items.filter((i) => i.kind === "flattened").length;
    } catch (err) {
      console.error(`pdf-ink-to-svg: ${file.name}`, err);
      problems.push({ kind: "error", file: file.name, error: err });
    }
  }

  ui.dropzone.removeAttribute("aria-busy");
  refreshHeader();

  lastSummary = { added, flattened, skipped, problems };
  renderSummary();
}

/** Compose and show the summary from `lastSummary`, in the current language. */
function renderSummary() {
  if (!lastSummary) return;
  const { added, flattened, skipped, problems } = lastSummary;

  const parts = [];
  if (added) {
    parts.push(t("status.extracted", { count: added }));
    if (flattened === added) parts.push(t("status.allFlattened"));
    else if (flattened) parts.push(t("status.someFlattened", { count: flattened }));
  }
  if (skipped) parts.push(t("status.skipped", { files: unit("unit.nonPdf", skipped) }));

  setStatus(parts.join(" ") || t("status.nothing"), {
    error: added === 0,
    list: problems.map(describeProblem),
  });
}

/** Problems are stored as their causes, so they translate on the fly too. */
function describeProblem(p) {
  const reason = p.kind === "error"
    ? describeError(p.error)
    : explainNoInk(p.others, p.images);
  return t("problem.prefix", { file: p.file, reason });
}

/**
 * Say why a PDF produced nothing. Naming what *was* found is far more useful
 * than a bare "no ink": it distinguishes a flattened signature from a stamp,
 * a form field, or ink the PDF marks as hidden.
 */
function explainNoInk(others, images) {
  const imageNote = images ? t("noInk.imageNote", { images: unit("unit.image", images) }) : "";

  if (others.size === 0) {
    return t("noInk.none") + (imageNote || t("noInk.noneHint"));
  }
  const found = [...others].map(([id, count]) => {
    const [key, kind] = id.split("\u0000");
    return t(key, { count, kind: kind ? describeSubtype(kind) : "" });
  });
  return t("noInk.others", { list: formatList(found) }) + imageNote;
}

/** Translate a PDF annotation subtype if the locale names it, else use it raw. */
function describeSubtype(subtype) {
  const key = `subtype.${subtype.toLowerCase()}`;
  return has(key) ? t(key) : subtype.toLowerCase();
}

function describeError(err) {
  switch (err?.name) {
    case "PasswordException":
      return t("error.password");
    case "InvalidPDFException":
      return t("error.invalid");
    default:
      return t("error.unknown");
  }
}

/**
 * Show the running version in the footer and log it with the pdf.js build.
 * When someone reports a problem, "what does the footer say?" is the fastest
 * way to find out what they are actually running — a static app can sit in a
 * browser cache long after the site has moved on.
 */
function showVersion() {
  if (!ui.versionLink) return;
  ui.versionLink.textContent = `v${VERSION}`;
  ui.versionLink.setAttribute("aria-label", t("footer.version", { version: VERSION }));
}

console.info(`pdf-ink-to-svg v${VERSION} · pdf.js ${pdfjsLib.version}`);

/** Download every result in turn. Browsers may ask permission for multiple downloads. */
async function downloadAll() {
  for (const r of results) {
    const a = document.createElement("a");
    a.href = r.blobUrl;
    a.download = r.name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/* --------------------------------------------------------------------------
   Events
   -------------------------------------------------------------------------- */

ui.fileInput.addEventListener("change", () => {
  if (ui.fileInput.files.length) handleFiles(ui.fileInput.files);
  ui.fileInput.value = ""; // allow picking the same file again
});

ui.dropzone.addEventListener("submit", (e) => e.preventDefault());

for (const type of ["dragenter", "dragover"]) {
  ui.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    ui.dropzone.classList.add("is-dragover");
  });
}
for (const type of ["dragleave", "drop"]) {
  ui.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    if (type === "dragleave" && ui.dropzone.contains(e.relatedTarget)) return;
    ui.dropzone.classList.remove("is-dragover");
  });
}
ui.dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
});

// Dropping outside the zone should not navigate away from the page.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

ui.downloadAll.addEventListener("click", downloadAll);
ui.clear.addEventListener("click", clearResults);

refreshHeader();

await initI18n();
initLanguagePicker(ui.langSelect);
showVersion();

// Re-label the version when the language changes (the number itself doesn't
// change, but its accessible description does).
document.addEventListener("languagechange", showVersion);

// Cards and the summary are built in script rather than markup, so they are
// rebuilt when the language changes; results themselves are untouched.
document.addEventListener("languagechange", () => {
  const items = results.map((r) => r.item);
  discardCards();
  for (const item of items) addCard(item);
  refreshHeader();
  renderSummary();
});
