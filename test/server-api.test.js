import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/server.js";

async function withTestServer(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "ai-reader-"));
  const app = createApp({
    dataDir: path.join(root, "data"),
    uploadDir: path.join(root, "uploads"),
    aiProviderConfig: options.aiProviderConfig || { provider: "mock" }
  });
  options.onRoot?.(root);
  options.onApp?.(app);

  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    app.locals.storage.close();
    await rm(root, { recursive: true, force: true });
  });

  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test("serves Markdown renderer browser dependencies", async (t) => {
  const baseUrl = await withTestServer(t);

  for (const asset of ["marked.min.js", "purify.min.js"]) {
    const response = await fetch(`${baseUrl}/vendor/${asset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /javascript/);
  }
});

test("reports ai provider status without exposing secrets", async (t) => {
  const baseUrl = await withTestServer(t, {
    aiProviderConfig: { provider: "openai-compatible", model: "example-model" }
  });

  const response = await fetch(`${baseUrl}/api/ai/status`);
  assert.equal(response.status, 200);
  const status = await response.json();

  assert.equal(status.provider, "openai-compatible");
  assert.equal(status.configured, false);
  assert.equal(status.model, "example-model");
  assert.ok(!("apiKey" in status));
});

test("uploads a document and reads normalized blocks", async (t) => {
  const baseUrl = await withTestServer(t);

  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "article.html",
      contentBase64: Buffer.from("<h1>Title</h1><p>Body text</p>").toString("base64")
    })
  });

  assert.equal(uploadResponse.status, 201);
  const uploaded = await uploadResponse.json();
  assert.ok(uploaded.id);
  assert.equal(uploaded.category, "未分类");

  const readResponse = await fetch(`${baseUrl}/api/documents/${uploaded.id}`);
  assert.equal(readResponse.status, 200);
  const document = await readResponse.json();

  assert.equal(document.title, "Title");
  assert.deepEqual(
    document.blocks.map((block) => [block.type, block.text]),
    [
      ["heading", "Title"],
      ["paragraph", "Body text"]
    ]
  );
});

test("uploads multiple documents and lists them newest first", async (t) => {
  const baseUrl = await withTestServer(t);

  const batchResponse = await fetch(`${baseUrl}/api/documents/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      category: "Research",
      documents: [
        {
          name: "first.txt",
          contentBase64: Buffer.from("First article").toString("base64")
        },
        {
          name: "second.html",
          contentBase64: Buffer.from("<h1>Second</h1><p>Second article</p>").toString("base64")
        }
      ]
    })
  });

  assert.equal(batchResponse.status, 201);
  const batch = await batchResponse.json();
  assert.equal(batch.documents.length, 2);
  assert.deepEqual(batch.errors, []);
  assert.deepEqual(
    batch.documents.map((document) => document.category),
    ["Research", "Research"]
  );

  const listResponse = await fetch(`${baseUrl}/api/documents`);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.deepEqual(
    list.documents.map((document) => document.title),
    ["Second", "first.txt"]
  );
  assert.deepEqual(
    list.documents.map((document) => document.category),
    ["Research", "Research"]
  );
});

test("creates and persists an empty named archive", async (t) => {
  const baseUrl = await withTestServer(t);

  const createResponse = await fetch(`${baseUrl}/api/archives`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "待读论文" })
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.name, "待读论文");
  assert.equal(created.documentCount, 0);

  const listResponse = await fetch(`${baseUrl}/api/archives`);
  assert.equal(listResponse.status, 200);
  const payload = await listResponse.json();
  assert.deepEqual(
    payload.archives.map((archive) => [archive.name, archive.documentCount]),
    [["待读论文", 0]]
  );
});

test("renames and deletes an empty archive", async (t) => {
  const baseUrl = await withTestServer(t);
  const createResponse = await fetch(`${baseUrl}/api/archives`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "旧名称" })
  });
  const created = await createResponse.json();

  const renameResponse = await fetch(`${baseUrl}/api/archives/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "新名称" })
  });
  assert.equal(renameResponse.status, 200);
  assert.equal((await renameResponse.json()).name, "新名称");

  const deleteResponse = await fetch(`${baseUrl}/api/archives/${created.id}`, {
    method: "DELETE"
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual((await deleteResponse.json()).deleted, true);

  const archives = await (await fetch(`${baseUrl}/api/archives`)).json();
  assert.deepEqual(archives.archives, []);
});

test("does not delete an archive that still contains documents", async (t) => {
  const baseUrl = await withTestServer(t);
  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "kept.txt",
      category: "保留归档",
      contentBase64: Buffer.from("Keep me").toString("base64")
    })
  });
  assert.equal(uploadResponse.status, 201);
  const archives = await (await fetch(`${baseUrl}/api/archives`)).json();

  const deleteResponse = await fetch(
    `${baseUrl}/api/archives/${archives.archives[0].id}`,
    { method: "DELETE" }
  );
  assert.equal(deleteResponse.status, 409);
});

test("batch archives selected documents into a category", async (t) => {
  const baseUrl = await withTestServer(t);
  const uploadResponse = await fetch(`${baseUrl}/api/documents/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documents: [
        { name: "one.txt", contentBase64: Buffer.from("One").toString("base64") },
        { name: "two.txt", contentBase64: Buffer.from("Two").toString("base64") },
        { name: "three.txt", contentBase64: Buffer.from("Three").toString("base64") }
      ]
    })
  });
  const uploaded = await uploadResponse.json();
  const ids = [uploaded.documents[0].id, uploaded.documents[2].id];

  const archiveResponse = await fetch(`${baseUrl}/api/documents/batch-category`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, category: "重点阅读" })
  });

  assert.equal(archiveResponse.status, 200);
  assert.deepEqual(await archiveResponse.json(), {
    updated: true,
    ids,
    category: "重点阅读",
    count: 2
  });

  const listResponse = await fetch(`${baseUrl}/api/documents`);
  const list = await listResponse.json();
  const categories = new Map(list.documents.map((document) => [document.id, document.category]));
  assert.equal(categories.get(ids[0]), "重点阅读");
  assert.equal(categories.get(ids[1]), "重点阅读");
  assert.equal(categories.get(uploaded.documents[1].id), "未分类");

  const archivesResponse = await fetch(`${baseUrl}/api/archives`);
  const archives = await archivesResponse.json();
  assert.deepEqual(
    archives.archives.map((archive) => [archive.name, archive.documentCount]),
    [["重点阅读", 2]]
  );
});

test("rejects batch archive without a category", async (t) => {
  const baseUrl = await withTestServer(t);
  const response = await fetch(`${baseUrl}/api/documents/batch-category`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: [1], category: "   " })
  });

  assert.equal(response.status, 400);
});

test("deletes a document, its ai history, blocks, and uploaded file", async (t) => {
  let root;
  let app;
  const baseUrl = await withTestServer(t, {
    onRoot(value) {
      root = value;
    },
    onApp(value) {
      app = value;
    }
  });

  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "delete-me.txt",
      contentBase64: Buffer.from("Delete this article.").toString("base64")
    })
  });
  const uploaded = await uploadResponse.json();

  await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: uploaded.id,
      selection: { text: "Delete", blockIds: [uploaded.blocks[0].id] }
    })
  });

  const deleteResponse = await fetch(`${baseUrl}/api/documents/${uploaded.id}`, {
    method: "DELETE"
  });
  assert.equal(deleteResponse.status, 200);

  const readResponse = await fetch(`${baseUrl}/api/documents/${uploaded.id}`);
  assert.equal(readResponse.status, 404);

  const listResponse = await fetch(`${baseUrl}/api/documents`);
  const list = await listResponse.json();
  assert.deepEqual(list.documents, []);
  assert.deepEqual(await readdir(path.join(root, "uploads")), []);
  assert.equal(
    app.locals.storage.db.prepare("SELECT COUNT(*) AS count FROM blocks").get()
      .count,
    0
  );
  assert.equal(
    app.locals.storage.db
      .prepare("SELECT COUNT(*) AS count FROM ai_records")
      .get().count,
    0
  );
});

test("batch deletes documents, their ai history, blocks, and uploaded files", async (t) => {
  let root;
  let app;
  const baseUrl = await withTestServer(t, {
    onRoot(value) {
      root = value;
    },
    onApp(value) {
      app = value;
    }
  });

  const batchResponse = await fetch(`${baseUrl}/api/documents/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      category: "Batch",
      documents: [
        {
          name: "one.txt",
          contentBase64: Buffer.from("First article").toString("base64")
        },
        {
          name: "two.txt",
          contentBase64: Buffer.from("Second article").toString("base64")
        },
        {
          name: "three.txt",
          contentBase64: Buffer.from("Third article").toString("base64")
        }
      ]
    })
  });
  const batch = await batchResponse.json();
  const [first, second, third] = batch.documents;

  await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: first.id,
      selection: { text: "First", blockIds: [first.blocks[0].id] }
    })
  });

  const deleteResponse = await fetch(`${baseUrl}/api/documents/batch-delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: [first.id, third.id] })
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), {
    deleted: true,
    ids: [first.id, third.id],
    count: 2
  });

  const listResponse = await fetch(`${baseUrl}/api/documents`);
  const list = await listResponse.json();
  assert.deepEqual(
    list.documents.map((document) => document.id),
    [second.id]
  );
  assert.deepEqual(await readdir(path.join(root, "uploads")), [
    await path.basename(app.locals.storage.getDocument(second.id).filePath)
  ]);
  assert.equal(
    app.locals.storage.db.prepare("SELECT COUNT(*) AS count FROM documents").get()
      .count,
    1
  );
  assert.equal(
    app.locals.storage.db.prepare("SELECT COUNT(*) AS count FROM blocks").get()
      .count,
    1
  );
  assert.equal(
    app.locals.storage.db
      .prepare("SELECT COUNT(*) AS count FROM ai_records")
      .get().count,
    0
  );
});

test("explains a selection and persists ai history", async (t) => {
  const baseUrl = await withTestServer(t);

  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "article.txt",
      contentBase64: Buffer.from("Background block.\n\nCore concept block.\n\nConclusion block.", "utf8").toString("base64")
    })
  });
  const uploaded = await uploadResponse.json();

  const explainResponse = await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: uploaded.id,
      mode: "deep",
      selection: { text: "Core concept", blockIds: [2] }
    })
  });

  assert.equal(explainResponse.status, 200);
  const explanation = await explainResponse.json();
  assert.match(explanation.answer, /Core concept/);
  assert.equal(explanation.provider, "mock");

  const documentResponse = await fetch(`${baseUrl}/api/documents/${uploaded.id}`);
  const document = await documentResponse.json();
  assert.equal(document.aiRecords.length, 1);
  assert.equal(document.aiRecords[0].mode, "deep");
});

test("explains the current page when block ids are provided without a text selection", async (t) => {
  const baseUrl = await withTestServer(t);

  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "article.txt",
      contentBase64: Buffer.from("Page block one.\n\nPage block two.", "utf8").toString("base64")
    })
  });
  const uploaded = await uploadResponse.json();

  const explainResponse = await fetch(`${baseUrl}/api/ai/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: uploaded.id,
      mode: "direct",
      selection: { text: "Current page", blockIds: uploaded.blocks.map((block) => block.id) }
    })
  });

  assert.equal(explainResponse.status, 200);
  const explanation = await explainResponse.json();
  assert.match(explanation.answer, /Current page/);
  assert.match(explanation.answer, /Page block one/);
});

test("answers a custom question with document context when no text is selected", async (t) => {
  const baseUrl = await withTestServer(t);

  const uploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "photosynthesis.txt",
      contentBase64: Buffer.from(
        "The introduction is general.\n\n光合作用把光能转化为化学能。\n\nThe conclusion is brief.",
        "utf8"
      ).toString("base64")
    })
  });
  const uploaded = await uploadResponse.json();

  const askResponse = await fetch(`${baseUrl}/api/ai/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: uploaded.id,
      mode: "custom",
      question: "文章如何解释光合作用？"
    })
  });

  assert.equal(askResponse.status, 200);
  const answer = await askResponse.json();
  assert.match(answer.answer, /光合作用把光能转化为化学能/);
});
