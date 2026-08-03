import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.beforeEach(async ({ page }) => {
  const response = await page.request.get("/api/documents");
  const { documents } = await response.json();
  for (const document of documents) {
    await page.request.delete(`/api/documents/${document.id}`);
  }
});

test("keeps the left navigation compact and tucks low-frequency tools into More", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "sidebar-check.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Sidebar behavior check.")
  });

  await expect(page.locator("#source-local")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#source-local")).toHaveText("本地文档");
  await expect(page.locator("#source-rss")).toHaveText("资讯");
  await expect(page.locator("#sidebar-more")).toHaveJSProperty("open", false);
  await expect(page.locator("#local-library-filters")).toHaveJSProperty("open", false);
  await expect(page.locator("#library-organize > summary")).toBeHidden();

  await page.locator("#toggle-document-sidebar").click();
  await expect(page.locator("#document-sidebar")).toHaveCSS("width", "72px");
  await expect(page.locator("#source-local")).toBeVisible();
  await expect(page.locator(".source-nav-label").first()).toBeHidden();
  await expect(page.locator(".upload-icon")).toBeVisible();

  await page.locator("#sidebar-more > summary").click();
  await expect(page.locator("#document-sidebar")).toHaveCSS("width", "288px");
  await expect(page.locator("#sidebar-more")).toHaveJSProperty("open", true);
  await expect(page.locator("#library-organize > summary")).toContainText("管理文档");
  await expect(page.locator(".data-tools > summary")).toContainText("备份与恢复");

  await page.locator("#library-organize > summary").click();
  await expect(page.locator(".document-select").first()).toBeVisible();
  await expect(page.locator(".document-list-actions")).toBeVisible();
  await page.locator("#library-organize > summary").click();
  await expect(page.locator(".document-select").first()).toBeHidden();
});

test("reads complex HTML and persists highlights, notes, bookmarks, and AI answers", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles(
    path.join(__dirname, "fixtures", "complex-article.html")
  );

  await expect(page.locator("#reader-title")).toHaveText("复杂 HTML 测试文章");

  const frame = page.frameLocator(".reader-rich-frame");
  await expect(frame.locator("table")).toBeVisible();
  await expect(frame.locator("strong")).toHaveText("行内强调");
  expect(await frame.locator("body").evaluate(() => window.__unsafeScriptRan)).toBeUndefined();
  const richLayoutWidth = await frame.locator(".layout").evaluate(
    (element) => element.getBoundingClientRect().width
  );
  const richViewportWidth = await page.locator(".reader-rich-frame").evaluate(
    (element) => element.clientWidth
  );
  expect(richLayoutWidth).toBeLessThanOrEqual(richViewportWidth);

  await frame.locator("p").evaluate((paragraph) => {
    paragraph.scrollIntoView({ block: "center" });
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.locator("#selection-menu")).toBeVisible();
  const scrollBeforeHighlight = await frame.locator("body").evaluate(
    () => document.scrollingElement.scrollTop
  );
  await page.locator("#selection-menu [data-action='highlight']").click();
  await expect(page.frameLocator(".reader-rich-frame").locator(".saved-highlight")).toContainText(
    "行内强调"
  );
  const scrollAfterHighlight = await frame.locator("body").evaluate(
    () => document.scrollingElement.scrollTop
  );
  expect(scrollAfterHighlight).toBeCloseTo(scrollBeforeHighlight, 0);

  await frame.locator(".saved-highlight").click();
  await expect(page.locator("#selection-menu [data-action='remove-annotation']")).toHaveText(
    "取消高亮"
  );
  await page.locator("#selection-menu [data-action='remove-annotation']").click();
  await expect(frame.locator(".saved-highlight")).toHaveCount(0);
  const scrollAfterCancel = await frame.locator("body").evaluate(
    () => document.scrollingElement.scrollTop
  );
  expect(scrollAfterCancel).toBeCloseTo(scrollBeforeHighlight, 0);

  await page.locator("#file-input").setInputFiles({
    name: "e2e-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Important concept for persistent reading.\n\nSupporting evidence for the conclusion.")
  });
  await expect(page.locator("#reader-title")).toHaveText("e2e-notes.txt");

  await selectText(page, "Important concept");
  await page.locator("#selection-menu [data-action='highlight']").click();
  await expect(page.locator(".saved-highlight")).toContainText("Important concept");

  await selectText(page, "Supporting evidence");
  await page.locator("#selection-menu [data-action='note']").click();
  await page.locator("#annotation-note").fill("这条证据需要与结论一起复习。");
  await page.locator("#annotation-dialog button[type='submit']").click();

  await page.locator("#bookmark-page").click();
  await expect(page.locator("#bookmark-page")).toHaveAttribute("aria-pressed", "true");

  await selectText(page, "Important concept");
  await expect(page.locator("#ai-scope")).toHaveValue("selection");
  await page.locator("#selection-menu [data-action='direct']").click();
  const answer = page.locator(".answer-item").first();
  await expect(answer).toContainText("Important concept");
  await expect(answer.locator("small")).toContainText("选区");
  const pageReference = answer
    .locator("[data-answer-reference]")
    .filter({ hasText: "第 1 页" })
    .first();
  await expect(pageReference).toBeVisible();
  await pageReference.click();
  await expect(page.locator("#reader .doc-block").first()).toBeVisible();
  await answer.locator("button[data-save-record]").click();
  await expect(answer.locator("button[data-save-record]")).toHaveText("已沉淀");

  await page.locator("#knowledge-tab").click();
  await expect(page.locator("#annotation-list .knowledge-item")).toHaveCount(3);
  await expect(page.locator("#knowledge-list .knowledge-item")).toHaveCount(1);
  const knowledgeItemsOverlap = await page.locator("#knowledge-view").evaluate((view) => {
    const items = [...view.querySelectorAll(".knowledge-item")];
    return items.some((item, index) => {
      const previous = items[index - 1];
      return previous && previous.getBoundingClientRect().bottom > item.getBoundingClientRect().top;
    });
  });
  expect(knowledgeItemsOverlap).toBe(false);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-current").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^wenche-notes-.*\.md$/);
});

test("moves, resizes, groups, and collapses the AI panel", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#ai-panel")).toHaveCSS("position", "fixed");
  const expandedBox = await page.locator("#ai-panel").boundingBox();
  expect(expandedBox.width).toBeGreaterThan(300);
  await expect(page.locator("#ai-quick-tools")).not.toHaveAttribute("open", "");
  await expect(page.locator("#answer-history")).not.toHaveAttribute("open", "");
  await expect(page.locator("#answer-count")).toHaveText("0");
  await page.locator("#ai-quick-tools > summary").click();
  await expect(page.locator("#explain-page")).toBeVisible();
  await expect(page.locator("#deep-page")).toBeVisible();

  const headerBox = await page.locator(".ai-header").boundingBox();
  await page.mouse.move(headerBox.x + 60, headerBox.y + 24);
  await page.mouse.down();
  await page.mouse.move(headerBox.x - 100, headerBox.y - 24);
  await page.mouse.up();
  const movedBox = await page.locator("#ai-panel").boundingBox();
  expect(movedBox.x).toBeLessThan(expandedBox.x - 120);
  expect(movedBox.y).toBeLessThan(expandedBox.y - 30);

  const resizeBox = await page.locator("#ai-panel-resize").boundingBox();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x - 40, resizeBox.y - 70);
  await page.mouse.up();
  const resizedBox = await page.locator("#ai-panel").boundingBox();
  expect(resizedBox.width).toBeLessThan(movedBox.width);
  expect(resizedBox.height).toBeLessThan(movedBox.height);

  await page.reload();
  const restoredBox = await page.locator("#ai-panel").boundingBox();
  expect(restoredBox.x).toBeCloseTo(resizedBox.x, 0);
  expect(restoredBox.y).toBeCloseTo(resizedBox.y, 0);
  expect(restoredBox.width).toBeCloseTo(resizedBox.width, 0);
  expect(restoredBox.height).toBeCloseTo(resizedBox.height, 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#app-shell")).toHaveClass(/is-right-collapsed/);
  await expect(page.locator("#toggle-ai-panel")).toHaveAttribute("aria-expanded", "false");
  const mobileBox = await page.locator("#ai-panel").boundingBox();
  expect(mobileBox.width).toBe(48);
  await page.setViewportSize({ width: 1280, height: 720 });

  await expect(page.locator("#app-shell")).toHaveClass(/is-right-collapsed/);
  await expect(page.locator("#toggle-ai-panel")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#toggle-ai-panel")).toHaveText("AI");
  await expect(page.locator("#ai-panel")).toHaveCSS("width", "48px");
  const collapsedBox = await page.locator("#ai-panel").boundingBox();
  expect(collapsedBox.width).toBe(48);
  expect(collapsedBox.height).toBe(48);

  await page.mouse.move(
    collapsedBox.x + collapsedBox.width / 2,
    collapsedBox.y + collapsedBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(collapsedBox.x - 96, collapsedBox.y + 104);
  await page.mouse.up();
  await expect(page.locator("#app-shell")).toHaveClass(/is-right-collapsed/);
  const movedLauncher = await page.locator("#ai-panel").boundingBox();
  expect(movedLauncher.x).toBeLessThan(collapsedBox.x - 90);
  expect(movedLauncher.y).toBeGreaterThan(collapsedBox.y + 70);

  await page.reload();
  await expect(page.locator("#app-shell")).toHaveClass(/is-right-collapsed/);
  await expect(page.locator("#ai-panel")).toHaveCSS("width", "48px");
  const restoredLauncher = await page.locator("#ai-panel").boundingBox();
  expect(restoredLauncher.x).toBeCloseTo(movedLauncher.x, 0);
  expect(restoredLauncher.y).toBeCloseTo(movedLauncher.y, 0);
  await page.locator("#toggle-ai-panel").click();
  await expect(page.locator("#toggle-ai-panel")).toHaveAttribute("aria-expanded", "true");
});

test("adjusts and persists the reading layout", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "layout.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      `# Layout heading\n\n${"A comfortable reading layout should remain stable after refresh. ".repeat(220)}`
    )
  });

  const headingSizeBefore = await page.locator(".doc-heading").evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize)
  );
  await page.locator("#reading-settings > summary").click();
  await page.locator("#increase-font").click();
  await page.locator("#increase-font").click();
  await page.locator("[data-reading-control='contentWidth'] [data-value='wide']").click();
  await page.locator("[data-reading-control='lineHeight'] [data-value='relaxed']").click();
  await page.locator("[data-reading-control='theme'] [data-value='eye']").click();

  await expect(page.locator("#font-scale")).toHaveText("120%");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "eye");
  const lineHeight = await page.locator("#reader").evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).lineHeight)
  );
  expect(lineHeight).toBeCloseTo(46.44, 1);
  const headingSizeAfter = await page.locator(".doc-heading").evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize)
  );
  expect(headingSizeAfter / headingSizeBefore).toBeCloseTo(1.2, 2);
  expect(await page.locator("#reader").evaluate((element) => element.style.getPropertyValue("--reader-content-width")))
    .toBe("1080px");

  await page.reload();
  await expect(page.locator("#font-scale")).toHaveText("120%");
  await expect(page.locator("[data-reading-control='contentWidth'] [data-value='wide']"))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-reading-control='lineHeight'] [data-value='relaxed']"))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-reading-control='theme'] [data-value='eye']"))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "eye");

  await page.locator("#immersive-toggle").click();
  await expect(page.locator("#app-shell")).toHaveClass(/is-immersive/);
  await expect(page.locator("#document-sidebar")).toBeHidden();
  await expect(page.locator("#ai-panel")).toBeHidden();
  await expect(page.locator(".reader-heading")).toBeHidden();
  await expect(page.locator(".reader-search")).toBeHidden();
  await expect(page.locator(".page-controls")).toBeVisible();
  await expect(page.locator("#reading-settings")).toBeVisible();
  await page.locator("#reading-settings > summary").click();
  await expect(page.locator(".reading-settings-popover")).toBeVisible();
  const immersiveFontSizeBefore = await page.locator(".doc-heading").evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize)
  );
  await page.locator("#increase-font").click();
  const immersiveFontSizeAfter = await page.locator(".doc-heading").evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize)
  );
  expect(immersiveFontSizeAfter).toBeGreaterThan(immersiveFontSizeBefore);
  await page.locator("#reading-settings > summary").click();
  await expect(page.locator("#next-page")).toBeEnabled();
  await page.locator("#next-page").click();
  await expect(page.locator("#page-indicator")).toContainText("页 2/");
  await expect(page.locator("#exit-immersive")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#app-shell")).not.toHaveClass(/is-immersive/);
  await expect(page.locator(".reader-toolbar")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#reading-settings > summary").click();
  const box = await page.locator(".reading-settings-popover").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.locator("#reading-settings > summary").click();
  await page.locator("#immersive-toggle").click();
  await page.locator("#reading-settings > summary").click();
  const immersiveBox = await page.locator(".reading-settings-popover").boundingBox();
  expect(immersiveBox.x).toBeGreaterThanOrEqual(0);
  expect(immersiveBox.x + immersiveBox.width).toBeLessThanOrEqual(390);
  expect(immersiveBox.y).toBeGreaterThanOrEqual(0);
  expect(immersiveBox.y + immersiveBox.height).toBeLessThanOrEqual(844);
});

test("renders DOCX page styles and scales the complete page", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "styled.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: createStyledDocx()
  });

  const firstPage = page.locator(".docx-preview-host section.docx:not([hidden])");
  await expect(firstPage).toContainText("Guide header");
  await expect(firstPage).toContainText("Blue heading");
  await expect(page.locator("#page-indicator")).toContainText("文档 1/1 · 页 1/");
  const totalPages = Number(
    (await page.locator("#page-indicator").textContent()).match(/页 \d+\/(\d+)/)?.[1]
  );
  expect(totalPages).toBeGreaterThan(2);
  await expect(firstPage.locator("footer")).toContainText("第 1 页");
  expect(await page.locator(".docx-preview-host section.docx").count()).toBe(totalPages);
  const pageOverflow = await page.locator(".docx-preview-host section.docx").evaluateAll(
    (sections) => sections.some((section) => {
      section.hidden = false;
      const article = [...section.children].find((child) => child.tagName === "ARTICLE");
      const footer = [...section.children].find((child) => child.tagName === "FOOTER");
      return article.getBoundingClientRect().bottom > footer.getBoundingClientRect().top + 1;
    })
  );
  expect(pageOverflow).toBe(false);
  await page.locator(".docx-preview-host section.docx").evaluateAll((sections) => {
    sections.forEach((section, index) => {
      section.hidden = index !== 0;
    });
  });

  const heading = firstPage.getByText("Blue heading", { exact: true });
  const headingColor = await heading.evaluate((element) => getComputedStyle(element).color);
  expect(headingColor).toBe("rgb(47, 117, 181)");
  await expect(firstPage.locator("table td").first()).toHaveCSS(
    "background-color",
    "rgb(217, 234, 247)"
  );

  const headingBefore = await heading.boundingBox();
  const body = firstPage.getByText("Body paragraph", { exact: true });
  const bodyBefore = await body.boundingBox();
  await page.locator("#reading-settings > summary").click();
  await page.locator("#increase-font").click();
  const headingAfter = await heading.boundingBox();
  const bodyAfter = await body.boundingBox();
  expect(headingAfter.width / headingBefore.width).toBeCloseTo(1.1, 1);
  expect(bodyAfter.width / bodyBefore.width).toBeCloseTo(1.1, 1);

  await selectTextIn(page, firstPage, "Body paragraph");
  await page.locator("#selection-menu [data-action='direct']").click();
  await expect(page.locator(".answer-item").first()).toContainText("Body paragraph");

  await page.locator("#reader-search-input").fill("Second page");
  await expect(page.locator("#page-indicator")).toContainText(`页 2/${totalPages}`);
  await expect(page.locator(".docx-preview-host .reader-search-hit.is-active")).toHaveText(
    "Second page"
  );
  await page.locator("#next-page").click();
  await expect(page.locator("#page-indicator")).toContainText(`页 3/${totalPages}`);
  await expect(page.locator(".docx-preview-host section.docx:not([hidden]) footer")).toContainText(
    "第 3 页"
  );

  await page.locator("#reset-reading-settings").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => page.locator("#reader").evaluate((element) => {
    const style = getComputedStyle(element);
    const availableWidth =
      element.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight);
    const section = element.querySelector(".docx-preview-host section.docx:not([hidden])");
    return section.getBoundingClientRect().width <= availableWidth + 1;
  })).toBe(true);
});

async function selectText(page, text) {
  await page.locator(".doc-block").filter({ hasText: text }).first().evaluate((block, needle) => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.nodeValue.indexOf(needle);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + needle.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      block.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return;
    }
    throw new Error(`Could not select text: ${needle}`);
  }, text);
  await expect(page.locator("#selection-menu")).toBeVisible();
}

async function selectTextIn(page, root, text) {
  await root.evaluate((element, needle) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.nodeValue.indexOf(needle);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + needle.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return;
    }
    throw new Error(`Could not select text: ${needle}`);
  }, text);
  await expect(page.locator("#selection-menu")).toBeVisible();
}

function createStyledDocx() {
  const zip = new AdmZip();
  const longSecondPage = Array.from(
    { length: 48 },
    (_, index) => `<w:p><w:r><w:t>Long page paragraph ${index + 1}</w:t></w:r></w:p>`
  ).join("");
  zip.addFile("[Content_Types].xml", Buffer.from(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'
  ));
  zip.addFile("_rels/.rels", Buffer.from(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  ));
  zip.addFile("word/_rels/document.xml.rels", Buffer.from(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'
  ));
  zip.addFile("word/styles.xml", Buffer.from(
    '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="160"/></w:pPr><w:rPr><w:b/><w:color w:val="2F75B5"/><w:sz w:val="32"/></w:rPr></w:style></w:styles>'
  ));
  zip.addFile("word/header1.xml", Buffer.from(
    '<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:rPr><w:color w:val="7F8C8D"/><w:sz w:val="18"/></w:rPr><w:t>Guide header</w:t></w:r></w:p></w:hdr>'
  ));
  zip.addFile("word/footer1.xml", Buffer.from(
    '<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t xml:space="preserve">Test guide | 第 </w:t></w:r><w:r><w:t xml:space="preserve"> 页</w:t></w:r></w:p></w:ftr>'
  ));
  zip.addFile("word/document.xml", Buffer.from(
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Blue heading</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Body paragraph</w:t></w:r></w:p>' +
      '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tr><w:tc><w:tcPr><w:shd w:fill="D9EAF7"/></w:tcPr><w:p><w:r><w:t>Styled cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
      '<w:p><w:r><w:t>Second page</w:t></w:r></w:p>' +
      longSecondPage +
      '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="540" w:footer="540"/></w:sectPr>' +
      '</w:body></w:document>'
  ));
  return zip.toBuffer();
}
