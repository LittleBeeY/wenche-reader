export function renderMarkdown(markdown, dependencies = browserDependencies()) {
  const source = normalizeMarkdownSource(markdown);
  const container = dependencies.document.createElement("div");
  container.innerHTML = dependencies.sanitize(dependencies.parse(source));

  for (const link of container.querySelectorAll("a[href]")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }

  return container.innerHTML;
}

export function normalizeMarkdownSource(markdown) {
  let source = typeof markdown === "string" ? markdown.trim() : "";
  if (!source.includes("\n") && source.includes("\\n")) {
    source = source.replace(/\\n/g, "\n");
  }

  const outerFence = source.match(
    /^(```|~~~)(?:markdown|md|text|plain)?[ \t]*\r?\n([\s\S]*?)\r?\n\1$/i
  );
  return outerFence ? outerFence[2].trim() : source;
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
