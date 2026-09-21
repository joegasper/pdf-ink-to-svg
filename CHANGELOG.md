# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [Versioning](README.md#versioning) for what counts as a breaking change in
an app that has no API.

## [Unreleased]

## [0.1.0] - 2026-09-20

First public release.

### Added

- Extract PDF ink annotations (`/Ink`) to SVG, preserving stroke colour, width, and opacity.
- Recover **flattened** handwriting: strokes moved from `/InkList` into the page content, including inside Form XObjects, are rebuilt from the page's drawing operators. Verified against a flattened test document, which returned the same five strokes and 362 points as the original annotation.
- Read several PDFs at once, by drag and drop or file picker.
- Result cards with an SVG preview, stroke and point counts, an **Annotation** or **Flattened** badge, and a per-file download; **Download all** when there is more than one.
- **Keep page coordinates** option, exporting an SVG the size of the full page for overlay work instead of one cropped to the ink.
- Diagnostics that name what was found when nothing could be extracted — embedded images, stamps, form fields, hidden ink — rather than reporting a bare failure.
- Light, dark, and system themes, with the choice remembered between visits and applied before first paint.
- English and Spanish interfaces, with `Intl` plurals and list formatting, a language picker, and automatic detection from the browser. Right-to-left languages are supported by the layout.
- `check-locales.mjs`, which validates locale files against `en.json`.
- `inspect-pdf.js`, a DevTools helper that lists a PDF's annotations.

### Security

- Everything runs locally. A Content Security Policy restricts all resources to the app's own origin, and pdf.js is vendored rather than loaded from a CDN, so the page makes no third-party requests.
- The only data stored is the theme and language preference, in `localStorage`.

### Dependencies

- pdf.js 6.3.289 (Apache-2.0), vendored in `vendor/pdfjs/`.

[Unreleased]: https://github.com/joegasper/pdf-ink-to-svg/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/joegasper/pdf-ink-to-svg/releases/tag/v0.1.0
