# PDF Ink to SVG

Extract handwriting (signatures, pen marks, stylus notes) from a PDF as clean, scalable SVG files — both live ink annotations and handwriting that has been **flattened** into the page. Runs entirely in the browser.

## How it works

1. Drop one or more PDFs onto the page, or pick them with the file chooser.
2. Each page is read twice with [pdf.js](https://mozilla.github.io/pdf.js/):
   - **Ink annotations.** Every `/Ink` annotation's `/InkList` becomes an SVG, keeping the original color, stroke width, and opacity.
   - **Flattened ink.** The page's own drawing operators are scanned for stroked paths that look hand-drawn. Annotations are excluded from this pass so nothing is reported twice.
3. Each result is shown on a card, badged **Annotation** or **Flattened**, with a **Download SVG** button. With more than one result, **Download all** saves them in turn.

Output files are named `<pdf name>-page<N>-ink<M>.svg` or `<pdf name>-page<N>-flattened<M>.svg`.

### Why flattening usually doesn't destroy the ink

Flattening an annotation generally does not rasterize it. The strokes are moved out of `/InkList` and into the page content as ordinary `m`/`l` path operators, often inside a Form XObject with its own `/Matrix`. The geometry survives intact — on the test document, the flattened signature came back with exactly the same five strokes and 362 points as the original annotation, and a stroke width of 1.48 pt against the original 1.5 pt.

### How flattened ink is identified

Handwriting is a long, wandering polyline; page furniture (rules, borders, table cells, underlines) is two or three points. A path can start a drawing if one of its subpaths has at least 12 vertices; once a drawing is under way, shorter strokes drawn alongside it are kept too, so the dot on an "i" isn't dropped. Strokes are grouped into one result per Form XObject, or by proximity in the operator list outside of one.

This is a heuristic, and it has one honest failure mode: a dense vector graphic such as a chart line looks exactly like a pen stroke. Those will show up as **Flattened** results. The card preview is there so you can see what you got before downloading.

By default each SVG is cropped to the ink with a small margin. Check **Keep page coordinates** to get an SVG the size of the full page instead, which is useful for overlaying the ink back onto a rendering of the page.

## Languages

The interface ships in English and Spanish. The language is picked from the browser's language list on first visit, and the globe control in the header overrides that; the choice is remembered in `localStorage` under `pdf-ink-to-svg:lang`. Switching language re-renders the results already on screen — no need to re-read the PDF.

Adding a language takes two steps:

1. Copy `locales/en.json` to `locales/<code>.json` and translate the values. Keys and `{placeholders}` must stay exactly as they are.
2. Add one entry to `LANGUAGES` in `i18n.js`.

Then run `node check-locales.mjs`, which reports missing keys, stray keys, and mismatched placeholders against `en.json`.

Notes for translators:

- Counted nouns are objects of plural categories (`{ "one": …, "other": … }`) selected with `Intl.PluralRules`, so a language with more categories can add `few`, `many`, and so on.
- Two strings contain a `{placeholder}` that stands for an element rather than text — `{badge}` for the bold word in the flattened-results note, `{pdfjs}` for the pdf.js link in the footer. Move them where the sentence needs them; they are never inserted as markup.
- A key a locale omits falls back to the English already in `index.html`, so a partial translation is safe to ship.
- Right-to-left languages are supported: add the code to `RTL` in `i18n.js` and the page sets `dir="rtl"`. The layout uses logical CSS properties throughout.
- Output file names stay in ASCII (`<pdf name>-page2-ink1.svg`) in every language, so they remain predictable across systems.

## Privacy

Everything happens in the browser tab. The PDF is read with the File API and parsed locally; nothing is uploaded or sent anywhere. The page ships with a strict Content Security Policy that only allows resources from its own origin, and the pdf.js library is included in the repository rather than loaded from a CDN, so once the page has loaded it makes no further network requests.

Two small preferences do persist, both in `localStorage`: `pdf-ink-to-svg:theme` (`light` or `dark`; choosing **System** removes the key) and `pdf-ink-to-svg:lang` (a language code; matching the browser's own language removes the key). If `localStorage` is unavailable, as in some private-browsing modes, both controls still work for the session and simply don't remember.

Locale files are fetched from the app's own origin, which the Content Security Policy already permits; no other request is ever made.

## Running it

It is plain HTML, CSS, and JavaScript with no build step. Because `app.js` is an ES module it needs to be served over HTTP rather than opened from `file://`:

```sh
python3 -m http.server 8080
# then open http://localhost:8080/
```

Any static host works (GitHub Pages, Azure Static Web Apps, IIS, Apache, nginx). Serve `.mjs` files with the `text/javascript` MIME type.

## Rebranding

The colors live at the top of `styles.css` under **Brand tokens**. Each token has a light and a dark value using `light-dark()`, and the browser picks one based on `color-scheme`. Contrast ratios were checked against WCAG 2.1 AA; re-check them if you change the palette. The `--paper` color behind each preview is intentionally fixed so dark ink stays visible in dark mode.

The theme control works by setting `data-theme="light"` or `data-theme="dark"` on `<html>`, which flips `color-scheme`; with no attribute the page follows the operating system. Because every color is a `light-dark()` token, no other CSS has to know the theme exists.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Page structure and CSP |
| `styles.css` | Styles and brand tokens |
| `app.js` | File handling, ink extraction, card rendering |
| `theme.js` | Light / dark / system toggle, loaded early to avoid a flash |
| `i18n.js` | Translation lookup, plurals, language picker |
| `locales/` | One JSON file per language; `en.json` is the reference |
| `check-locales.mjs` | Optional: validates locale files against `en.json` |
| `inspect-pdf.js` | Optional DevTools helper for listing a PDF's annotations |
| `vendor/pdfjs/` | pdf.js (`pdf.min.mjs`, `pdf.worker.min.mjs`) and its Apache-2.0 license |

## Updating pdf.js

```sh
npm pack pdfjs-dist@latest
tar -xzf pdfjs-dist-*.tgz
cp package/build/pdf.min.mjs package/build/pdf.worker.min.mjs vendor/pdfjs/
cp package/LICENSE vendor/pdfjs/LICENSE
```

## Troubleshooting

**Nothing was extracted.** The app reports what it did find, which usually tells you why:

- *no ink and embedded images present* — the handwriting was almost certainly scanned or rasterized into one of those images. That turns strokes into pixels, and pixels can't be recovered as vectors; tracing in a drawing program is the only route from there.
- *no ink and no images* — if handwriting is visible, it was drawn some other way, most often text set in a script font.
- *stamps or form fields instead* — the signature was placed as a stamp or a digital signature field rather than drawn as ink. Acrobat's "Fill & Sign > Add signature" and most e-signature services work this way. Chrome, Edge, macOS Preview, and tablet pen input produce real ink annotations.
- *ink without point data* — rare; the annotation only carries a pre-rendered appearance.

To see the raw list yourself, load `inspect-pdf.js` in DevTools (see the file for instructions) and run `inspectPdf()`.

## Versioning

The version is in `version.js` and shown in the footer, so you can always tell what a cached copy is actually running. Releases are recorded in [CHANGELOG.md](CHANGELOG.md) and tagged `vX.Y.Z` in git.

The project follows [Semantic Versioning](https://semver.org/). An app with no API still has a public surface, and this is what the version promises about:

| Surface | Example |
| --- | --- |
| SVG output and file names | `<pdf>-page2-ink1.svg`, cropped-to-ink by default |
| Locale file schema | key names and `{placeholders}` in `locales/*.json` |
| Brand tokens in `styles.css` | `--accent`, `--paper`, and the rest |
| `localStorage` keys | `pdf-ink-to-svg:theme`, `pdf-ink-to-svg:lang` |
| Deployment shape | static files, no build step |

Renaming a token, changing the output file-name pattern, or removing a locale key is a **major** change, because it breaks someone's fork, theme, or translation. New features are **minor**; fixes and pdf.js updates that don't change behaviour are **patch**.

While the version is `0.x`, those surfaces may still move — that is what the leading zero is for.

## Releasing

Releasing does not save your work — that already happened. Changes are committed
as you make them, each with its line added under `[Unreleased]` in
`CHANGELOG.md`. A release is one small extra commit that only promotes those
notes to a version and bumps `version.js`, plus a tag on it.

That commit changes two files, but the tag still captures the whole app: a git
commit is a snapshot of every file in the repository, not a list of what
changed. Checking out `v0.2.0` later gives you all of it.

Replace `0.2.0` below with the version being released. The number comes from
what is in `[Unreleased]`: fixes only is a patch, anything new and
backward-compatible is a minor, a change to one of the surfaces listed under
[Versioning](#versioning) is a major.

For the very first release, see [The first release](#the-first-release) instead.

1. Make sure everything you mean to ship is committed and nothing else is
   pending, then check the locale files:

   ```sh
   git status
   node check-locales.mjs
   ```

   `git status` should report *nothing to commit, working tree clean*. If it
   lists changed files, commit them (with their changelog lines) or discard
   them first. Releasing with uncommitted changes means the tag won't match
   what you tested.

2. In `CHANGELOG.md`, rename the `[Unreleased]` heading to `## [0.2.0] - YYYY-MM-DD`,
   add a fresh empty `## [Unreleased]` above it, and update the link definitions at
   the bottom so `[Unreleased]` compares against the new tag:

   ```markdown
   [Unreleased]: https://github.com/joegasper/pdf-ink-to-svg/compare/v0.2.0...HEAD
   [0.2.0]: https://github.com/joegasper/pdf-ink-to-svg/compare/v0.1.0...v0.2.0
   ```

3. Set `VERSION` in `version.js` to the same number.

4. Commit both files together, so the version and the changelog can never
   disagree:

   ```sh
   git add CHANGELOG.md version.js
   git commit -m "Release v0.2.0"
   ```

5. Tag that commit and push. The message is what makes it an *annotated* tag,
   which matters because `--follow-tags` pushes only those:

   ```sh
   git tag -a v0.2.0 -m "v0.2.0"
   git push --follow-tags
   ```

6. Confirm the tag reached the remote — a tag that stays local is the usual way
   a release goes missing:

   ```sh
   git ls-remote --tags origin
   ```

7. Create the GitHub release. Pushing a tag does not do this — a tag is a git
   concept, a Release is a GitHub page built on top of one. On the repository's
   **Releases** page, choose **Draft a new release** (or **Create a new
   release** the first time), then:

   - **Choose a tag:** pick the existing `v0.2.0` from the list. Don't type a
     new name — anything that doesn't match exactly makes GitHub create a
     second tag on the current commit, and the changelog links will point at
     the wrong one.
   - **Release title:** `v0.2.0`.
   - **Description:** paste that version's section from `CHANGELOG.md`. Skip
     **Generate release notes**; it builds notes from commit messages and will
     drift from the changelog.
   - Leave **Set as a pre-release** unticked, so it shows as **Latest**.
   - Attach nothing. GitHub adds **Source code (zip)** and **(tar.gz)** to every
     release, and for a static app with no build step that archive is the
     deployable app.
   - **Publish release.**

### Doing steps 4 to 6 in VS Code

Committing and syncing works as usual, but tags need two extra commands and the
Sync button will not push them. There is a `git.followTagsWhenSync` setting
meant to change that, but it is unreliable, so push tags explicitly:

1. Commit and sync the changelog and version change first, so the tag lands on
   the right commit.
2. Command Palette (`Ctrl+Shift+P`) → **Git: Create Tag** → name `v0.2.0` → give
   it a message, which is what makes it annotated.
3. Command Palette → **Git: Push Tags** (or **Git: Push (Follow Tags)**).
4. Check `https://github.com/joegasper/pdf-ink-to-svg/tags` shows the new tag.

### The first release

The first push is the exception: nothing has been committed yet, so there is no
separate release commit — the whole app goes in as one commit, and that commit
is tagged. `version.js` already says `0.1.0` and `CHANGELOG.md` already has a
dated `[0.1.0]` section, so steps 2 and 3 above are done; just check the date in
the changelog is the day you tag.

Create the empty repository on GitHub first (no README, licence, or
`.gitignore` — the project already has them), then from the project folder:

```sh
git init                        # skip if the folder is already a repository
git status                      # review what is about to go in
git add .
git commit -m "Initial release v0.1.0"
git branch -M main              # make sure the branch is called main
git remote add origin https://github.com/joegasper/pdf-ink-to-svg.git
git tag -a v0.1.0 -m "v0.1.0"
git push -u origin main --follow-tags
git ls-remote --tags origin     # confirm v0.1.0 arrived
```

`-u` links your local `main` to GitHub's, so later pushes and VS Code's Sync
button know where to go. `vendor/pdfjs/` is committed on purpose; it is the
app's only dependency and there is no build step to fetch it.

In VS Code, **Publish Branch** in the Source Control panel can create the
repository and push in one go, but it won't push the tag. Follow it with **Git:
Create Tag** and **Git: Push Tags** as above.

Finally, create the GitHub release for `v0.1.0` exactly as in step 7. The
repository's Releases page will say *There aren't any releases here* until you
do; that is expected even when the tag pushed correctly.

From then on, every release uses the numbered steps.

## Limitations

- Raster images are never read. Handwriting that was scanned or rasterized is pixels, not strokes, and nothing can recover it as vectors.
- Flattened detection is a heuristic; dense vector artwork can be picked up as if it were handwriting (see above).
- Clipping paths are ignored in the flattened pass, so a stroke that the page clips will be exported whole.
- Pages with a `/Rotate` value are exported in unrotated page coordinates.
- A non-uniform transform is baked into the coordinates and the stroke width becomes the geometric mean of the two scale factors, so a deliberately squashed pen nib loses its asymmetry.
- Ink annotation points are joined with straight segments; pen input is dense enough that this looks smooth, but very sparse strokes will look angular.

## Browser note

pdf.js 6.x calls `Map.prototype.getOrInsertComputed` from `getOperatorList()`. It's a recent addition, so `app.js` supplies a small polyfill when the browser doesn't have it.

## License

MIT, see [LICENSE](LICENSE). pdf.js is licensed separately under Apache-2.0, see [vendor/pdfjs/LICENSE](vendor/pdfjs/LICENSE).
