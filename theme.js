/*
  PDF Ink to SVG — light / dark / system theme
  https://github.com/joegasper/pdf-ink-to-svg

  SPDX-License-Identifier: MIT
  Copyright (c) 2026 Joe Gasper

  Loaded synchronously in <head> so the stored choice is applied before the
  first paint. A deferred or module script would run after the page renders
  and produce a visible flash of the wrong theme.

  The whole palette is built on CSS light-dark(), which follows the
  `color-scheme` property. So all this has to do is set one attribute on
  <html>; the stylesheet does the rest.
*/

(() => {
  const KEY = "pdf-ink-to-svg:theme";
  const MODES = ["light", "system", "dark"];

  /** localStorage throws in some privacy modes; the app must still work. */
  function read() {
    try {
      const v = localStorage.getItem(KEY);
      return MODES.includes(v) ? v : "system";
    } catch {
      return "system";
    }
  }

  function save(mode) {
    try {
      if (mode === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch {
      /* Preference simply won't persist. Not worth bothering the user. */
    }
  }

  function apply(mode) {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
  }

  let mode = read();
  apply(mode);

  // Wire up the control once the markup exists.
  document.addEventListener("DOMContentLoaded", () => {
    const group = document.getElementById("theme-toggle");
    if (!group) return;
    const buttons = [...group.querySelectorAll("[data-mode]")];

    function select(next, { focus = false } = {}) {
      mode = next;
      apply(mode);
      save(mode);
      for (const b of buttons) {
        const on = b.dataset.mode === mode;
        b.setAttribute("aria-checked", String(on));
        // Roving tabindex: the group is one tab stop, arrows move within it.
        b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      }
    }

    group.addEventListener("click", (e) => {
      const button = e.target.closest("[data-mode]");
      if (button) select(button.dataset.mode);
    });

    group.addEventListener("keydown", (e) => {
      const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
      if (delta) {
        e.preventDefault();
        const i = MODES.indexOf(mode);
        select(MODES[(i + delta + MODES.length) % MODES.length], { focus: true });
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        select(e.key === "Home" ? MODES[0] : MODES.at(-1), { focus: true });
      }
    });

    select(mode);
  });
})();
