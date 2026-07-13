import assert from "node:assert/strict";
import test from "node:test";
import {
  filterDocuments,
  getArchiveDocumentIds,
  resolveLinkedDocument,
  getAdjacentDocument,
  getRemainingAdjacentDocument,
  groupDocuments,
  sortDocuments
} from "../public/documentOrder.js";

test("resolves relative html links to uploaded documents in the same archive", () => {
  const documents = [
    { id: 1, originalName: "01.html", category: "课程 A" },
    { id: 2, originalName: "01.html", category: "课程 B" },
    { id: 3, originalName: "index.html", category: "课程 B" }
  ];

  assert.equal(
    resolveLinkedDocument(documents, documents[2], "./01.html#lesson").id,
    2
  );
  assert.equal(resolveLinkedDocument(documents, documents[2], "#lesson"), null);
  assert.equal(
    resolveLinkedDocument(documents, documents[2], "https://example.com/01.html"),
    null
  );
});

test("uses selected documents for archive and falls back to the current document", () => {
  assert.deepEqual(getArchiveDocumentIds(new Set([2, 3]), 1), [2, 3]);
  assert.deepEqual(getArchiveDocumentIds(new Set(), 7), [7]);
  assert.deepEqual(getArchiveDocumentIds(new Set(), null), []);
});

test("filters documents by title, filename, or category", () => {
  const documents = [
    { id: 1, title: "量子力学导论", originalName: "chapter-01.html", category: "物理" },
    { id: 2, title: "Research Notes", originalName: "biology.md", category: "课程资料" }
  ];

  assert.deepEqual(filterDocuments(documents, "量子").map((item) => item.id), [1]);
  assert.deepEqual(filterDocuments(documents, "biology").map((item) => item.id), [2]);
  assert.deepEqual(filterDocuments(documents, "物理").map((item) => item.id), [1]);
  assert.deepEqual(filterDocuments(documents, "  "), documents);
});

const documents = [
  { id: 3, title: "第三页", originalName: "10.html", category: "课程" },
  { id: 1, title: "第一页", originalName: "1.html", category: "课程" },
  { id: 2, title: "第二页", originalName: "2.html", category: "课程" },
  { id: 4, title: "附录", originalName: "appendix.html", category: "资料" }
];

test("sorts numbered file names naturally", () => {
  assert.deepEqual(
    sortDocuments(documents.slice(0, 3), "filename").map((document) => document.id),
    [1, 2, 3]
  );
});

test("supports title and import order", () => {
  assert.deepEqual(
    sortDocuments(documents.slice(0, 3), "title").map((document) => document.title),
    ["第二页", "第三页", "第一页"]
  );
  assert.deepEqual(
    sortDocuments([documents[0], documents[2], documents[1]], "import").map(
      (document) => document.id
    ),
    [1, 2, 3]
  );
});

test("groups documents by category with unclassified documents last", () => {
  const groups = groupDocuments(
    [...documents, { id: 5, title: "散页", originalName: "loose.html", category: "未分类" }],
    "filename"
  );

  assert.deepEqual(
    groups.map((group) => group.category),
    ["课程", "资料", "未分类"]
  );
  assert.deepEqual(
    groups[0].documents.map((document) => document.id),
    [1, 2, 3]
  );
});

test("finds adjacent documents only inside the current category", () => {
  assert.equal(getAdjacentDocument(documents, 2, 1, "filename").id, 3);
  assert.equal(getAdjacentDocument(documents, 2, -1, "filename").id, 1);
  assert.equal(getAdjacentDocument(documents, 3, 1, "filename"), null);
  assert.equal(getAdjacentDocument(documents, 4, -1, "filename"), null);
});

test("finds an adjacent document while skipping deleted documents", () => {
  assert.equal(
    getRemainingAdjacentDocument(documents, 2, [2, 3], "filename").id,
    1
  );
  assert.equal(
    getRemainingAdjacentDocument(documents, 2, [1, 2], "filename").id,
    3
  );
});

test("returns null when all documents in the category are deleted", () => {
  assert.equal(
    getRemainingAdjacentDocument(documents, 2, [1, 2, 3], "filename"),
    null
  );
});
