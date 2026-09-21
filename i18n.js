/*
  PDF Ink to SVG — internationalisation
  https://github.com/joegasper/pdf-ink-to-svg

  SPDX-License-Identifier: MIT
  Copyright (c) 2026 Joe Gasper

  English lives in index.html as the default markup, so the page reads
  correctly before any script runs. Every language, English included, also has
  a JSON file under ./locales/ — English because the strings built in code
  (status messages, card captions) need a source too.

  A key that a locale file does not define leaves the existing markup alone,
  so a partial translation degrades to English instead of showing raw keys.

  Adding a language means two things: drop a JSON file in ./locales/ and add
  one entry to LANGUAGES below. Nothing else in the app needs to change.
*/

export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
];

const STORAGE_KEY = "pdf-ink-to-svg:lang";

/** Right-to-left scripts. Listed here so a future ar/he/fa file just works. */
const RTL = new Set(["ar", "he", "fa", "ur"]);

let strings = {};
let active = "en";

/* --------------------------------------------------------------------------
   Lookup
   -------------------------------------------------------------------------- */

/**
 * Look up a translated string.
 *
 * Values may be a plain string, or an object of plural categories
 * ({ one, other, ... }) selected with Intl.PluralRules when `count` is given.
 * Placeholders are written {like_this} and filled from `vars`.
 *
 * Falls back to the key itself, which makes a missing translation obvious in
 * testing rather than rendering an empty element.
 */
export function t(key, vars = {}) {
  let value = strings[key];

  if (value && typeof value === "object") {
    const category = typeof vars.count === "number"
      ? new Intl.PluralRules(active).select(vars.count)
      : "other";
    value = value[category] ?? value.other ?? Object.values(value)[0];
  }
  if (typeof value !== "string") return key;

  return value.replace(/\{(\w+)\}/g, (match, name) => {
    if (!(name in vars)) return match;
    const v = vars[name];
    return typeof v === "number" ? formatNumber(v) : String(v);
  });
}

/** Does this locale define the key? Used for optional terms like PDF subtypes. */
export function has(key) {
  return key in strings;
}

export function formatNumber(n) {
  return n.toLocaleString(active);
}

export function currentLanguage() {
  return active;
}

/** Join a list the way the active language does ("a, b and c"). */
export function formatList(items) {
  try {
    return new Intl.ListFormat(active, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

/* --------------------------------------------------------------------------
   Applying translations to the page
   -------------------------------------------------------------------------- */

/**
 * Replace the text of every translatable element under `root`.
 *
 *   data-i18n        -> textContent
 *   data-i18n-title  -> title attribute
 *   data-i18n-label  -> aria-label attribute
 *   data-i18n-rich   -> textContent around preserved child elements; the
 *                       string names each child with a {placeholder} matching
 *                       that child's data-slot value
 *
 * Rich strings are assembled from text nodes and elements that already exist
 * in the markup, never by setting innerHTML, so a locale file can reorder a
 * link or move emphasis without being able to inject markup.
 */
export function applyTo(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    if (has(el.dataset.i18n)) el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    if (has(el.dataset.i18nTitle)) el.title = t(el.dataset.i18nTitle);
  }
  for (const el of root.querySelectorAll("[data-i18n-label]")) {
    if (has(el.dataset.i18nLabel)) el.setAttribute("aria-label", t(el.dataset.i18nLabel));
  }
  for (const el of root.querySelectorAll("[data-i18n-rich]")) {
    if (has(el.dataset.i18nRich)) applyRich(el, t(el.dataset.i18nRich));
  }
}

function applyRich(el, text) {
  const slots = new Map();
  for (const child of el.querySelectorAll("[data-slot]")) {
    slots.set(child.dataset.slot, child);
  }
  const fragment = document.createDocumentFragment();
  // Split on {placeholder} and interleave text with the preserved elements.
  for (const part of text.split(/(\{\w+\})/g)) {
    const name = part.startsWith("{") && part.endsWith("}") ? part.slice(1, -1) : null;
    const slot = name && slots.get(name);
    if (slot) {
      const label = strings[`${el.dataset.i18nRich}.${name}`];
      if (typeof label === "string") slot.textContent = label;
      fragment.appendChild(slot);
    } else if (part) {
      fragment.appendChild(document.createTextNode(part));
    }
  }
  el.replaceChildren(fragment);
}

/* --------------------------------------------------------------------------
   Loading and switching
   -------------------------------------------------------------------------- */

function stored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(code) {
  try {
    if (code === detect(true)) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* Preference won't persist; the app is otherwise unaffected. */
  }
}

const supported = (code) => LANGUAGES.some((l) => l.code === code);

/** Best match from the browser's language list, ignoring any saved choice. */
function detect(ignoreStored = false) {
  if (!ignoreStored) {
    const saved = stored();
    if (saved && supported(saved)) return saved;
  }
  for (const tag of navigator.languages ?? [navigator.language ?? "en"]) {
    const base = String(tag).toLowerCase().split("-")[0];
    if (supported(base)) return base;
  }
  return "en";
}

async function load(code) {
  const res = await fetch(`./locales/${code}.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`locale ${code}: HTTP ${res.status}`);
  return await res.json();
}

/**
 * Switch the page to a language. Falls back to English if the file is missing
 * or malformed, because a half-translated page is worse than an English one.
 */
export async function setLanguage(code, { persist = true } = {}) {
  const target = supported(code) ? code : "en";
  try {
    strings = await load(target);
    active = target;
  } catch (err) {
    // A missing or malformed file leaves the English markup in place rather
    // than half-translating the page.
    console.error(`pdf-ink-to-svg: could not load locale "${target}"`, err);
    if (target !== "en") return setLanguage("en", { persist });
    strings = {};
    active = "en";
  }

  const html = document.documentElement;
  html.lang = active;
  html.dir = RTL.has(active) ? "rtl" : "ltr";

  applyTo(document);
  if (has("meta.title")) document.title = t("meta.title");
  if (has("meta.description")) {
    document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
  }

  if (persist) remember(active);
  document.dispatchEvent(new CustomEvent("languagechange", { detail: { language: active } }));
  return active;
}

/** Populate the picker and wire it up. Call once, after the DOM exists. */
export function initLanguagePicker(select) {
  if (!select) return;
  select.replaceChildren(
    ...LANGUAGES.map(({ code, name }) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = name;
      option.lang = code;           // so a screen reader pronounces it natively
      return option;
    }),
  );
  select.value = active;
  select.addEventListener("change", () => setLanguage(select.value));
}

/** Resolve the starting language and apply it. */
export function init() {
  return setLanguage(detect(), { persist: false });
}
