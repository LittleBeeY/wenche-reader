# Document Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely delete an uploaded document and all data owned by it.

**Architecture:** Express validates and removes the original file, then Storage transactionally deletes AI records, blocks, and document metadata. The document list exposes a confirmed delete action and selects a nearby document after success.

**Tech Stack:** Node.js, Express, SQLite, browser JavaScript, CSS, Node test runner

---

### Task 1: Deletion API

**Files:**
- Modify: `test/server-api.test.js`
- Modify: `src/lib/storage.js`
- Modify: `src/server.js`

- [ ] Write a failing API test that uploads, deletes, verifies 404, verifies an
  empty list, and verifies the upload directory is empty.
- [ ] Run the focused test and confirm DELETE currently returns 404.
- [ ] Add `Storage.deleteDocument(id)` with an explicit transaction.
- [ ] Add `DELETE /api/documents/:id` with upload-directory path validation.
- [ ] Run the focused API test and confirm it passes.

### Task 2: Delete Control

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] Render each document as a row containing its open button and delete
  button.
- [ ] Confirm before DELETE, refresh the list, and open the sorted adjacent
  document when deleting the current item.
- [ ] Clear the reader when no document remains.
- [ ] Add compact destructive-button styling.

### Task 3: Verification

- [ ] Run frontend and backend syntax checks.
- [ ] Run `npm.cmd test`.
- [ ] Restart the owned local service and verify `/api/documents` returns 200.

## Commit Note

The workspace has no valid Git metadata, so no commit or worktree operation is
available.
