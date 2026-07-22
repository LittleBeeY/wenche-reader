export function isDocxDocument(documentData) {
  return String(documentData?.originalName || "").toLowerCase().endsWith(".docx");
}

export async function createDocxPreview({
  documentId,
  renderAsync,
  fetchImpl = fetch,
  ownerDocument = document
}) {
  if (typeof renderAsync !== "function") {
    throw new Error("Word 原排版渲染器未加载");
  }

  const response = await fetchImpl(`/api/documents/${documentId}/source`);
  if (!response.ok) {
    throw new Error(`读取 Word 原文件失败 (${response.status})`);
  }

  const host = ownerDocument.createElement("div");
  host.className = "docx-preview-host";
  await renderAsync(await response.arrayBuffer(), host, host, {
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderComments: false,
    renderAltChunks: false,
    useBase64URL: true
  });

  const sections = [...host.querySelectorAll(".docx-wrapper > section.docx")];
  if (sections.length === 0) {
    throw new Error("Word 原文件没有可显示的页面");
  }

  const pages = sections.map((section, index) => {
    section.dataset.docxPage = String(index);
    const text = normalizeDocxText(section.textContent);
    return {
      number: index + 1,
      blocks: [{ id: -(index + 1), text }],
      blockIds: [],
      text
    };
  });

  return { host, sections, pages };
}

export function paginateRenderedDocxSections(host, sourceSections, ownerDocument = document) {
  const visualSections = [];
  for (const [sourceIndex, sourceSection] of sourceSections.entries()) {
    const sourceArticle = directChild(sourceSection, "ARTICLE");
    if (!sourceArticle) {
      visualSections.push(sourceSection);
      continue;
    }

    const contentNodes = [...sourceArticle.childNodes].filter(
      (node) => node.nodeType !== 3 || node.nodeValue?.trim()
    );
    const template = sourceSection.cloneNode(true);
    directChild(template, "ARTICLE")?.replaceChildren();
    const pageHeight =
      positiveNumber(ownerDocument.defaultView?.getComputedStyle(sourceSection).minHeight) ||
      positiveNumber(sourceSection.getBoundingClientRect().height) ||
      1;
    let sourcePageIndex = 0;
    let page = insertPageShell();

    for (const node of contentNodes) {
      const pageArticle = directChild(page, "ARTICLE");
      pageArticle.append(node);
      if (!docxPageOverflows(page) || pageArticle.childNodes.length === 1) continue;

      node.remove();
      page = insertPageShell();
      directChild(page, "ARTICLE").append(node);
    }

    sourceSection.remove();
    const sourcePages = visualSections.filter(
      (section) => Number(section.dataset.docxSourceSection) === sourceIndex
    );
    for (const section of sourcePages) {
      section.dataset.docxSourcePageCount = String(sourcePages.length);
    }

    function insertPageShell() {
      const nextPage = template.cloneNode(true);
      nextPage.hidden = false;
      nextPage.style.height = `${pageHeight}px`;
      nextPage.style.minHeight = `${pageHeight}px`;
      nextPage.style.overflow = "hidden";
      nextPage.dataset.docxSourceSection = String(sourceIndex);
      nextPage.dataset.docxSourcePage = String(sourcePageIndex++);
      sourceSection.parentNode.insertBefore(nextPage, sourceSection);
      visualSections.push(nextPage);
      return nextPage;
    }
  }

  for (const [index, section] of visualSections.entries()) {
    section.dataset.docxPage = String(index);
    fillDocxPageNumber(section, index + 1, ownerDocument);
  }
  return visualSections;
}

export function measureDocxPages(sections, ownerDocument = document) {
  return sections.map((section, index) => {
    const pageHeight =
      positiveNumber(ownerDocument.defaultView?.getComputedStyle(section).minHeight) ||
      positiveNumber(section.getBoundingClientRect().height) ||
      1;
    const text = collectDocxPageText(
      section,
      [{ pageHeight }],
      ownerDocument
    )[0] || "";
    return {
      number: index + 1,
      sectionIndex: index,
      sectionPageIndex: 0,
      sectionPageCount: 1,
      offsetTop: 0,
      pageHeight,
      blocks: [{ id: -(index + 1), text }],
      blockIds: [],
      text
    };
  });
}

export function normalizeDocxText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function collectDocxPageText(section, spans, ownerDocument) {
  const pageTexts = spans.map(() => []);
  const showText = ownerDocument.defaultView?.NodeFilter?.SHOW_TEXT || NodeFilter.SHOW_TEXT;
  const sectionTop = section.getBoundingClientRect().top;
  const walker = ownerDocument.createTreeWalker(section, showText);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = normalizeDocxText(node.nodeValue);
    if (!text) continue;
    const range = ownerDocument.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect?.();
    if (!rect || !Number.isFinite(rect.top)) continue;
    const pageIndex = Math.min(
      spans.length - 1,
      Math.max(0, Math.floor((rect.top - sectionTop) / spans[0].pageHeight))
    );
    pageTexts[pageIndex].push(text);
  }

  if (pageTexts.some((parts) => parts.length > 0)) {
    return pageTexts.map((parts) => normalizeDocxText(parts.join(" ")));
  }

  const text = normalizeDocxText(section.textContent);
  if (spans.length === 1 || !text) return [text];
  const chunkSize = Math.ceil(text.length / spans.length);
  return spans.map((_, index) => text.slice(index * chunkSize, (index + 1) * chunkSize).trim());
}

function positiveNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function directChild(element, tagName) {
  return [...(element?.children || [])].find((child) => child.tagName === tagName);
}

function docxPageOverflows(section) {
  const article = directChild(section, "ARTICLE");
  const footer = directChild(section, "FOOTER");
  if (!article || !footer) return section.scrollHeight > section.clientHeight + 1;
  return (
    article.getBoundingClientRect().bottom > footer.getBoundingClientRect().top + 0.5 ||
    section.scrollHeight > section.clientHeight + 1
  );
}

function fillDocxPageNumber(section, pageNumber, ownerDocument) {
  const footer = directChild(section, "FOOTER");
  if (!footer || /第\s*\d+\s*页/.test(footer.textContent || "")) return;
  const showText = ownerDocument.defaultView?.NodeFilter?.SHOW_TEXT || NodeFilter.SHOW_TEXT;
  const walker = ownerDocument.createTreeWalker(footer, showText);
  let pageSuffix = null;
  while (walker.nextNode()) {
    if (/^\s*页/.test(walker.currentNode.nodeValue || "")) pageSuffix = walker.currentNode;
  }
  if (!pageSuffix || !/第\s*$/.test(footer.textContent.slice(0, footer.textContent.indexOf(pageSuffix.nodeValue)))) {
    return;
  }
  const number = ownerDocument.createElement("span");
  number.className = "wenche-docx-page-number";
  number.textContent = String(pageNumber);
  pageSuffix.parentNode.before(number);
}
