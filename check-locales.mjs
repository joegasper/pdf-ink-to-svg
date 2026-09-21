#!/usr/bin/env node
/*
  PDF Ink to SVG — locale checker
  https://github.com/joegasper/pdf-ink-to-svg

  SPDX-License-Identifier: MIT
  Copyright (c) 2026 Joe Gasper

  Compares every file in ./locales against en.json and reports missing keys,
  extra keys, and placeholders that don't match. Run with:  node check-locales.mjs
  It is a convenience for translators, not part of the app.
*/

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "locales";
const reference = JSON.parse(readFileSync(join(DIR, "en.json"), "utf8"));

/** Every {placeholder} used by a value, whether it's a string or plural set. */
function placeholders(value) {
  const text = typeof value === "string" ? value : Object.values(value ?? {}).join(" ");
  return new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

let failed = false;

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "en.json")) {
  const code = file.replace(/\.json$/, "");
  const locale = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  const problems = [];

  for (const key of Object.keys(reference)) {
    if (!(key in locale)) {
      problems.push(`missing: ${key}`);
      continue;
    }
    const want = placeholders(reference[key]);
    const got = placeholders(locale[key]);
    for (const name of want) {
      if (!got.has(name)) problems.push(`${key}: placeholder {${name}} is missing`);
    }
    for (const name of got) {
      if (!want.has(name)) problems.push(`${key}: unexpected placeholder {${name}}`);
    }
  }
  for (const key of Object.keys(locale)) {
    if (!(key in reference)) problems.push(`not in en.json: ${key}`);
  }

  if (problems.length) {
    failed = true;
    console.error(`${code}: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  ${p}`);
  } else {
    console.log(`${code}: OK (${Object.keys(locale).length} keys)`);
  }
}

process.exit(failed ? 1 : 0);
