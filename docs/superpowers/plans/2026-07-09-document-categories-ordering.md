# Document Categories and Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group imported files into persistent categories and navigate them in a user-selected order.

**Architecture:** SQLite stores one category per document. A pure browser module owns sorting, grouping, and adjacent-document lookup; both the list and page controls consume that same ordered data.

**Tech Stack:** Node.js, Express, SQLite, browser ES modules, CSS, Node test runner

---

### Task 1: Ordering Logic

**Files:**
- Create: `public/documentOrder.js`
- Create: `test/document-order.test.js`

- [ ] Write failing tests for natural filename ordering, title/import ordering,
  grouped output, and adjacent lookup limited to one category.
- [ ] Run `node --test test\document-order.test.js` and verify the missing module failure.
- [ ] Implement `sortDocuments`, `groupDocuments`, and `getAdjacentDocument`.
- [ ] Run the focused test and verify all ordering tests pass.

### Task 2: Persistent Categories

**Files:**
- Modify: `src/lib/storage.js`
- Modify: `src/server.js`
- Modify: `test/server-api.test.js`

- [ ] Extend the batch API test with `category: "Research"` and assert every
  created/listed document carries that category.
- [ ] Add a single-upload assertion for the `未分类` default.
- [ ] Run the API tests and verify they fail because category is absent.
- [ ] Add the guarded SQLite column migration, storage reads/writes, and API
  category normalization.
- [ ] Run the API tests and verify they pass.

### Task 3: Grouped List and Controls

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] Add category input and sort select controls.
- [ ] Send the category with batch uploads.
- [ ] Render category sections using `groupDocuments`.
- [ ] On sort changes, rerender the list and pagination state.
- [ ] Display document position and page position in the page indicator.

### Task 4: Cross-Document Navigation

**Files:**
- Modify: `public/app.js`

- [ ] Make Previous/Next load adjacent documents at file boundaries.
- [ ] Open the first page when moving forward and the last page when moving
  backward.
- [ ] Disable controls only when neither an internal page nor an adjacent
  document exists.
- [ ] Run syntax checks, focused tests, and `npm.cmd test`.

## Commit Note

The workspace has no valid Git metadata. Do not initialize or replace it
without an explicit user request.
