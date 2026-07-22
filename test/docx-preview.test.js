import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  createDocxPreview,
  isDocxDocument,
  normalizeDocxText
} from "../public/docxPreview.js";

test("recognizes DOCX documents by their original file name", () => {
  assert.equal(isDocxDocument({ originalName: "Report.DOCX" }), true);
  assert.equal(isDocxDocument({ originalName: "Report.pdf" }), false);
});

test("creates searchable page models from high fidelity DOCX output", async () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  let receivedOptions;
  const preview = await createDocxPreview({
    documentId: 42,
    ownerDocument: dom.window.document,
    fetchImpl: async (url) => {
      assert.equal(url, "/api/documents/42/source");
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    },
    renderAsync: async (_buffer, host, _styles, options) => {
      receivedOptions = options;
      host.innerHTML = [
        '<div class="docx-wrapper">',
        '<section class="docx"> First  page </section>',
        '<section class="docx"> Second\npage </section>',
        "</div>"
      ].join("");
    }
  });

  assert.equal(receivedOptions.renderHeaders, true);
  assert.equal(receivedOptions.renderFooters, true);
  assert.equal(receivedOptions.ignoreLastRenderedPageBreak, false);
  assert.equal(receivedOptions.renderAltChunks, false);
  assert.equal(preview.sections.length, 2);
  assert.deepEqual(preview.pages.map((page) => page.text), ["First page", "Second page"]);
  assert.deepEqual(preview.pages.map((page) => page.blocks[0].id), [-1, -2]);
});

test("normalizes DOCX page text for search and AI context", () => {
  assert.equal(normalizeDocxText(" heading\n\n body  "), "heading body");
});
