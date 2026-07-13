import assert from "node:assert/strict";
import test from "node:test";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { marked } from "marked";
import { renderMarkdown } from "../public/markdownView.js";

const window = new JSDOM("").window;
const purifier = createDOMPurify(window);
test.after(() => window.close());

function createRendererDependencies() {
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

test("unwraps a model response fenced as markdown", () => {
  const html = renderMarkdown(
    "```markdown\n### 核心含义\n\n- 第一项\n- 第二项\n```",
    createRendererDependencies()
  );

  assert.match(html, /<h3>核心含义<\/h3>/);
  assert.match(html, /<li>第一项<\/li>/);
  assert.doesNotMatch(html, /<pre>/);
});

test("keeps an inner code block inside a normal markdown answer", () => {
  const html = renderMarkdown(
    "### 示例\n\n```js\nconst value = 1;\n```",
    createRendererDependencies()
  );

  assert.match(html, /<h3>示例<\/h3>/);
  assert.match(html, /<code class="language-js">/);
});

test("removes unsafe HTML and link protocols", () => {
  const html = renderMarkdown(
    '<script>alert(1)</script><img src="x" onerror="alert(1)">\n\n[bad](javascript:alert(1))',
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
