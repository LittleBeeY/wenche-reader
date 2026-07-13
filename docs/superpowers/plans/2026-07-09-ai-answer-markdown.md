# AI Answer Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render common Markdown in AI answers with safe, compact formatting.

**Architecture:** A focused browser module converts Markdown with `marked` and sanitizes the result with `DOMPurify`. The existing answer history remains plain Markdown in storage; only the answer body is rendered as sanitized HTML in the browser.

**Tech Stack:** Browser ES modules, marked, DOMPurify, jsdom, Node test runner, CSS

---

## File Structure

- Create `public/markdownView.js`: convert and sanitize one AI answer.
- Create `test/markdown-view.test.js`: exercise real Markdown parsing and sanitizing.
- Modify `public/index.html`: load the browser builds of marked and DOMPurify.
- Modify `public/app.js`: render only `record.answer` through the Markdown module.
- Modify `public/styles.css`: scope Markdown presentation to `.answer-body`.
- Modify `src/server.js`: expose the two browser dependency files under `/vendor`.
- Modify `package.json` and `package-lock.json`: add runtime and test dependencies.

### Task 1: Safe Markdown Renderer

**Files:**
- Create: `public/markdownView.js`
- Create: `test/markdown-view.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the required packages**

Run:

```powershell
npm.cmd install marked dompurify
npm.cmd install --save-dev jsdom
```

Expected: dependencies are recorded in `package.json` and `package-lock.json`.

- [ ] **Step 2: Write the failing renderer tests**

Create `test/markdown-view.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { marked } from "marked";
import { renderMarkdown } from "../public/markdownView.js";

function createRendererDependencies() {
  const window = new JSDOM("").window;
  const purifier = createDOMPurify(window);
  return {
    parse: (markdown) => marked.parse(markdown),
    sanitize: (html) => purifier.sanitize(html),
    document: window.document
  };
}

test("renders common Markdown structures", () => {
  const html = renderMarkdown(
    "### Heading\n\n**Bold**\n\n- one\n- two\n\n```js\nconst x = 1;\n```",
    createRendererDependencies()
  );

  assert.match(html, /<h3>Heading<\/h3>/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<code class="language-js">/);
});

test("removes unsafe HTML and link protocols", () => {
  const html = renderMarkdown(
    '<script>alert(1)</script><img src="x" onerror="alert(1)"> [bad](javascript:alert(1))',
    createRendererDependencies()
  );

  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror/i);
  assert.doesNotMatch(html, /javascript:/i);
});

test("opens sanitized links safely in a new tab", () => {
  const html = renderMarkdown(
    "[source](https://example.com)",
    createRendererDependencies()
  );

  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```powershell
node --test test/markdown-view.test.js
```

Expected: FAIL because `public/markdownView.js` does not exist.

- [ ] **Step 4: Add the minimal renderer**

Create `public/markdownView.js`:

```js
export function renderMarkdown(markdown, dependencies = browserDependencies()) {
  const source = typeof markdown === "string" ? markdown : "";
  const container = dependencies.document.createElement("div");
  container.innerHTML = dependencies.sanitize(dependencies.parse(source));
  for (const link of container.querySelectorAll("a[href]")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  return container.innerHTML;
}

function browserDependencies() {
  if (!window.marked?.parse || !window.DOMPurify?.sanitize) {
    throw new Error("Markdown renderer is unavailable");
  }
  return {
    parse: (markdown) => window.marked.parse(markdown),
    sanitize: (html) => window.DOMPurify.sanitize(html),
    document: window.document
  };
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
node --test test/markdown-view.test.js
```

Expected: 3 tests pass.

### Task 2: Answer Panel Integration

**Files:**
- Modify: `src/server.js`
- Modify: `public/index.html`
- Modify: `public/app.js`

- [ ] **Step 1: Expose browser dependency builds**

In `src/server.js`, after `app.use(express.static(...))`, add exact-file routes:

```js
app.get("/vendor/marked.min.js", (req, res) => {
  res.sendFile(path.join(projectRoot, "node_modules", "marked", "lib", "marked.umd.js"));
});
app.get("/vendor/purify.min.js", (req, res) => {
  res.sendFile(path.join(projectRoot, "node_modules", "dompurify", "dist", "purify.min.js"));
});
```

- [ ] **Step 2: Load the dependency scripts before the app**

In `public/index.html`, replace the final app script with:

```html
<script src="/vendor/marked.min.js"></script>
<script src="/vendor/purify.min.js"></script>
<script src="/app.js" type="module"></script>
```

- [ ] **Step 3: Render answer Markdown**

At the top of `public/app.js`, import:

```js
import { renderMarkdown } from "./markdownView.js";
```

In `createAnswerElement`, replace the plain paragraph:

```js
const body = document.createElement("div");
body.className = "answer-body";
body.innerHTML = renderMarkdown(record.answer);
```

The value assigned to `innerHTML` is the sanitized output from
`renderMarkdown`; all other fields continue using `textContent`.

- [ ] **Step 4: Verify syntax**

Run:

```powershell
node --check public/markdownView.js
node --check public/app.js
node --check src/server.js
```

Expected: all commands exit with code 0.

### Task 3: Scoped Formatting and Regression Verification

**Files:**
- Modify: `public/styles.css`
- Test: `test/markdown-view.test.js`

- [ ] **Step 1: Replace the old answer paragraph rule**

Replace `.answer-item p` with scoped Markdown rules:

```css
.answer-body {
  font-size: 14px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.answer-body > :first-child {
  margin-top: 0;
}

.answer-body > :last-child {
  margin-bottom: 0;
}

.answer-body h1,
.answer-body h2,
.answer-body h3,
.answer-body h4,
.answer-body h5,
.answer-body h6 {
  font-size: 15px;
  line-height: 1.4;
  margin: 16px 0 8px;
}

.answer-body p,
.answer-body ul,
.answer-body ol,
.answer-body blockquote,
.answer-body pre {
  margin: 8px 0;
}

.answer-body ul,
.answer-body ol {
  padding-left: 22px;
}

.answer-body blockquote {
  border-left: 3px solid var(--line);
  color: var(--muted);
  padding-left: 10px;
}

.answer-body code {
  background: #f0f2f1;
  border-radius: 4px;
  font-family: Consolas, "Courier New", monospace;
  padding: 2px 4px;
}

.answer-body pre {
  background: #f0f2f1;
  border-radius: 6px;
  overflow-x: auto;
  padding: 10px;
}

.answer-body pre code {
  padding: 0;
}

.answer-body a {
  color: var(--teal-dark);
}
```

- [ ] **Step 2: Run the focused and complete test suites**

Run:

```powershell
node --test test/markdown-view.test.js
npm.cmd test
```

Expected: Markdown tests pass and the complete suite has zero failures.

- [ ] **Step 3: Confirm dependency assets exist**

Run:

```powershell
Test-Path node_modules\marked\lib\marked.umd.js
Test-Path node_modules\dompurify\dist\purify.min.js
```

Expected: both commands print `True`.

## Commit Note

The workspace contains an empty `.git` directory rather than valid Git
metadata, so commit steps cannot run. Do not initialize or replace repository
metadata without an explicit user request.
