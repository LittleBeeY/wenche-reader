import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import test from "node:test";
import { parseDocumentBuffer, sanitizeArticleHtml } from "../src/lib/documentParser.js";

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

test("parses PDF text into readable blocks", async () => {
  const result = await parseDocumentBuffer({
    originalName: "sample.pdf",
    buffer: createMinimalPdf("Hello PDF")
  });

  assert.match(result.blocks.map((block) => block.text).join(" "), /Hello PDF/);
});

test("parses DOCX paragraphs", async () => {
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ));
  zip.addFile("_rels/.rels", Buffer.from(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  ));
  zip.addFile("word/document.xml", Buffer.from(
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>'
  ));

  const result = await parseDocumentBuffer({
    originalName: "sample.docx",
    buffer: zip.toBuffer()
  });

  assert.deepEqual(result.blocks.map((block) => block.text), ["Hello DOCX"]);
});

test("preserves common DOCX styles and table structure", async () => {
  const result = await parseDocumentBuffer({
    originalName: "formatted.docx",
    buffer: createFormattedDocx()
  });

  assert.equal(result.title, "Formatted report");
  const heading = result.blocks.find((block) => block.type === "heading");
  const paragraph = result.blocks.find((block) => block.type === "paragraph");
  const table = result.blocks.find((block) => block.type === "table");

  assert.match(heading.html, /class="docx-title"/);
  assert.match(paragraph.html, /<strong>Bold<\/strong>/);
  assert.match(paragraph.html, /<em>Italic<\/em>/);
  assert.match(paragraph.html, /class="docx-underline"/);
  assert.match(table.html, /<table>/);
  assert.match(table.html, /<td><p>Cell A<\/p><\/td>/);
  assert.match(table.html, /<td><p>Cell B<\/p><\/td>/);
});

test("rejects DOCX archives with suspicious compression ratios", async () => {
  const zip = new AdmZip();
  zip.addFile("word/document.xml", Buffer.alloc(2 * 1024 * 1024, "x"));

  await assert.rejects(
    parseDocumentBuffer({ originalName: "compressed.docx", buffer: zip.toBuffer() }),
    /DOCX contains a suspicious compression ratio/
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

test("keeps safe embedded images as readable blocks", async () => {
  const result = await parseDocumentBuffer({
    originalName: "illustrated.html",
    buffer: Buffer.from(
      '<p><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="Figure one" onerror="evil()"></p>',
      "utf8"
    )
  });

  assert.equal(result.blocks[0].text, "Figure one");
  assert.match(result.blocks[0].html, /<img src="data:image\/gif;base64,/);
  assert.ok(!result.blocks[0].html.includes("onerror"));
});

test("rewrites remote and lazy article images through the local rss proxy", () => {
  const html = sanitizeArticleHtml(
    '<p><img src="/placeholder.gif" data-src="../images/figure.png" alt="Figure" onerror="evil()"></p>',
    { baseUrl: "https://example.com/posts/2026/article" }
  );

  assert.match(
    html,
    /src="\/api\/rss\/images\?url=https%3A%2F%2Fexample\.com%2Fposts%2Fimages%2Ffigure\.png"/
  );
  assert.match(html, /loading="lazy"/);
  assert.match(html, /decoding="async"/);
  assert.ok(!html.includes("data-src"));
  assert.ok(!html.includes("onerror"));
});

test("removes article image shells that have no usable source", () => {
  const html = sanitizeArticleHtml('<p>before<img alt="missing">after</p>', {
    baseUrl: "https://example.com/article"
  });

  assert.equal(html, "<p>beforeafter</p>");
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

test("parses readable EPUB chapters in file order", async () => {
  const zip = new AdmZip();
  zip.addFile("OEBPS/02.xhtml", Buffer.from("<h2>Second</h2><p>Later</p>"));
  zip.addFile("OEBPS/01.xhtml", Buffer.from("<h1>Book title</h1><p>First</p>"));

  const result = await parseDocumentBuffer({
    originalName: "book.epub",
    buffer: zip.toBuffer()
  });

  assert.equal(result.title, "Book title");
  assert.deepEqual(
    result.blocks.map((block) => block.text),
    ["Book title", "First", "Second", "Later"]
  );
});

test("rejects EPUB archives with excessive HTML entries", async () => {
  const zip = new AdmZip();
  for (let index = 0; index < 501; index += 1) {
    zip.addFile(`OEBPS/${String(index).padStart(3, "0")}.xhtml`, Buffer.from("<p>x</p>"));
  }

  await assert.rejects(
    parseDocumentBuffer({ originalName: "oversized.epub", buffer: zip.toBuffer() }),
    /more than 500 HTML documents/
  );
});

function createMinimalPdf(text) {
  assert.equal(text, "Hello PDF");
  return Buffer.from(
    "JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA2MTIgNzkyIF0gL1BhcmVudCA2IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNiAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwNzIyMTYxMTAyKzA4JzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwNzIyMTYxMTAyKzA4JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovTGVuZ3RoIDg0Cj4+CnN0cmVhbQoxIDAgMCAxIDAgMCBjbSAgQlQgL0YxIDEyIFRmIDE0LjQgVEwgRVQKQlQgMSAwIDAgMSA3MiA3MjAgVG0gKEhlbGxvIFBERikgVGogVCogRVQKIAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMDkyIDAwMDAwIG4gCjAwMDAwMDAxOTkgMDAwMDAgbiAKMDAwMDAwMDM5MiAwMDAwMCBuIAowMDAwMDAwNDYwIDAwMDAwIG4gCjAwMDAwMDA3MjEgMDAwMDAgbiAKMDAwMDAwMDc4MCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzxhZDVhMWI3OGQwMTE0MGY4NzYzZmI1ZjgyNTBjYWJhNT48YWQ1YTFiNzhkMDExNDBmODc2M2ZiNWY4MjUwY2FiYTU+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAob3BlbnNvdXJjZSkKCi9JbmZvIDUgMCBSCi9Sb290IDQgMCBSCi9TaXplIDgKPj4Kc3RhcnR4cmVmCjkxMwolJUVPRgo=",
    "base64"
  );
}

function createFormattedDocx() {
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
  ));
  zip.addFile("_rels/.rels", Buffer.from(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  ));
  zip.addFile("word/_rels/document.xml.rels", Buffer.from(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  ));
  zip.addFile("word/styles.xml", Buffer.from(
    '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>'
  ));
  zip.addFile("word/document.xml", Buffer.from(
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Formatted report</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>Italic</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Underlined</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '</w:body></w:document>'
  ));
  return zip.toBuffer();
}
