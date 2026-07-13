import assert from "node:assert/strict";
import test from "node:test";
import { parseDocumentBuffer } from "../src/lib/documentParser.js";

test("parses txt into ordered paragraph blocks", async () => {
  const result = await parseDocumentBuffer({
    originalName: "sample.txt",
    buffer: Buffer.from("First paragraph.\n\nSecond paragraph.", "utf8")
  });

  assert.equal(result.title, "sample.txt");
  assert.deepEqual(
    result.blocks.map((block) => block.text),
    ["First paragraph.", "Second paragraph."]
  );
  assert.deepEqual(
    result.blocks.map((block) => block.type),
    ["paragraph", "paragraph"]
  );
});

test("parses markdown headings and paragraphs", async () => {
  const result = await parseDocumentBuffer({
    originalName: "note.md",
    buffer: Buffer.from("# Main title\n\nFirst body.\n\n## Section\n\nSecond body.", "utf8")
  });

  assert.deepEqual(
    result.blocks.map((block) => [block.type, block.text]),
    [
      ["heading", "Main title"],
      ["paragraph", "First body."],
      ["heading", "Section"],
      ["paragraph", "Second body."]
    ]
  );
});

test("sanitizes html and extracts readable blocks", async () => {
  const result = await parseDocumentBuffer({
    originalName: "article.html",
    buffer: Buffer.from(
      "<h1 onclick=\"evil()\">Title</h1><script>alert(1)</script><p>Body <strong>important</strong></p><iframe src=\"x\"></iframe>",
      "utf8"
    )
  });

  assert.equal(result.title, "Title");
  assert.deepEqual(
    result.blocks.map((block) => [block.type, block.text]),
    [
      ["heading", "Title"],
      ["paragraph", "Body important"]
    ]
  );
  assert.ok(!result.sanitizedHtml.includes("<script"));
  assert.ok(!result.sanitizedHtml.includes("onclick"));
  assert.ok(!result.sanitizedHtml.includes("<iframe"));
});

test("preserves sanitized html tables and inline formatting", async () => {
  const result = await parseDocumentBuffer({
    originalName: "report.html",
    buffer: Buffer.from(
      "<h1>Report</h1><p>Important <strong>result</strong></p><table onclick=\"evil()\"><thead><tr><th>Name</th><th>Score</th></tr></thead><tbody><tr><td>Alice</td><td><em>95</em></td></tr></tbody></table>",
      "utf8"
    )
  });

  const table = result.blocks.find((block) => block.type === "table");
  const paragraph = result.blocks.find((block) => block.type === "paragraph");
  assert.match(paragraph.html, /<strong>result<\/strong>/);
  assert.match(table.html, /<table>/);
  assert.match(table.html, /<th>Name<\/th>/);
  assert.match(table.html, /<td><em>95<\/em><\/td>/);
  assert.ok(!table.html.includes("onclick"));
});

test("preserves safe html layout css while removing active content", async () => {
  const result = await parseDocumentBuffer({
    originalName: "cards.html",
    buffer: Buffer.from(
      "<style>.grid{display:grid;grid-template-columns:1fr 1fr;background-image:url(https://tracker.test/x)}</style><div class=\"grid\" onclick=\"evil()\"><span>A</span><span>B</span></div><script>evil()</script>",
      "utf8"
    )
  });

  assert.match(result.renderHtml, /class="grid"/);
  assert.match(result.renderHtml, /display:grid/);
  assert.ok(!result.renderHtml.includes("onclick"));
  assert.ok(!result.renderHtml.includes("<script"));
  assert.ok(!result.renderHtml.includes("tracker.test"));
});

test("preserves markdown tables as structured html", async () => {
  const result = await parseDocumentBuffer({
    originalName: "data.md",
    buffer: Buffer.from(
      "# Data\n\n| Name | Score |\n| --- | ---: |\n| Alice | **95** |",
      "utf8"
    )
  });

  const table = result.blocks.find((block) => block.type === "table");
  assert.ok(table);
  assert.match(table.html, /<th>Name<\/th>/);
  assert.match(table.html, /<strong>95<\/strong>/);
});
