// Paste into the DevTools console on the app's page, then run:  inspectPdf()
// It opens a file picker and lists every annotation pdf.js can see.
async function inspectPdf() {
  const pdfjs = await import("./vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";
  const input = Object.assign(document.createElement("input"), { type: "file", accept: ".pdf" });
  input.click();
  const file = await new Promise((r) => (input.onchange = () => r(input.files[0])));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  console.log(`${file.name}: ${doc.numPages} page(s), pdf.js ${pdfjs.version}`);
  for (let i = 1; i <= doc.numPages; i++) {
    const annots = await (await doc.getPage(i)).getAnnotations();
    console.log(`page ${i}: ${annots.length} annotation(s)`);
    console.table(annots.map((a) => ({
      subtype: a.subtype,
      strokes: a.inkLists?.length ?? "",
      hidden: !!a.hidden,
      hasAppearance: !!a.appearance,
      rect: a.rect?.map((n) => Math.round(n)).join(", "),
    })));
  }
}
