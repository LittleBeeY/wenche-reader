import {
  filterDocuments,
  getAdjacentDocument,
  getArchiveDocumentIds,
  getRemainingAdjacentDocument,
  groupDocuments,
  resolveLinkedDocument,
  sortDocuments
} from "./documentOrder.js";
import {
  getLastDocumentId,
  getSavedPageIndex,
  saveReadingProgress
} from "./readingProgress.js";
import { paginateBlocks } from "./pagination.js";
import { findDocumentMatches } from "./documentSearch.js";
import { formatAnswerMeta, getVisibleRecords } from "./historyView.js";
import { renderMarkdown } from "./markdownView.js";
import {
  calculateSelectionMenuPosition,
  dismissSelectionUi
} from "./selectionUi.js";

const state = {
  document: null,
  documents: [],
  pages: [],
  archives: [],
  archiveFilter: "",
  pageIndex: 0,
  sortMode: "filename",
  searchQuery: "",
  selectedDocumentIds: new Set(),
  selection: { text: "", blockIds: [] },
  readerQuery: "",
  searchMatches: [],
  searchMatchIndex: -1,
  showAllHistory: false,
  aiController: null,
  busy: false
};

const fileInput = document.querySelector("#file-input");
const categoryInput = document.querySelector("#category-input");
const documentSort = document.querySelector("#document-sort");
const reader = document.querySelector("#reader");
const readerTitle = document.querySelector("#reader-title");
const documentTitle = document.querySelector("#document-title");
const documentList = document.querySelector("#document-list");
const documentSearch = document.querySelector("#document-search");
const selectVisibleButton = document.querySelector("#select-visible");
const deleteSelectedButton = document.querySelector("#delete-selected");
const archiveCategoryInput = document.querySelector("#archive-category");
const categoryOptions = document.querySelector("#category-options");
const archiveSelectedButton = document.querySelector("#archive-selected");
const archiveStatus = document.querySelector("#archive-status");
const newArchiveNameInput = document.querySelector("#new-archive-name");
const createArchiveButton = document.querySelector("#create-archive");
const archiveList = document.querySelector("#archive-list");
const renameArchiveButton = document.querySelector("#rename-archive");
const deleteArchiveButton = document.querySelector("#delete-archive");
const statusEl = document.querySelector("#status");
const selectionMenu = document.querySelector("#selection-menu");
const questionInput = document.querySelector("#question-input");
const askButton = document.querySelector("#ask-button");
const answerList = document.querySelector("#answer-list");
const prevPageButton = document.querySelector("#prev-page");
const nextPageButton = document.querySelector("#next-page");
const pageIndicator = document.querySelector("#page-indicator");
const aiStatus = document.querySelector("#ai-status");
const explainPageButton = document.querySelector("#explain-page");
const deepPageButton = document.querySelector("#deep-page");
const readerSearchInput = document.querySelector("#reader-search-input");
const previousMatchButton = document.querySelector("#previous-match");
const nextMatchButton = document.querySelector("#next-match");
const matchIndicator = document.querySelector("#match-indicator");
const cancelAiButton = document.querySelector("#cancel-ai");
const historyToggleButton = document.querySelector("#history-toggle");

fileInput.addEventListener("change", async (event) => {
  const files = [...(event.target.files || [])];
  if (files.length === 0) return;
  await uploadFiles(files);
  fileInput.value = "";
});

reader.addEventListener("mouseup", () => {
  setTimeout(captureSelection, 0);
});

document.addEventListener("mousedown", (event) => {
  if (!selectionMenu.contains(event.target)) {
    dismissSelectionUi({
      menu: selectionMenu,
      browserSelection: window.getSelection(),
      state
    });
  }
});

selectionMenu.addEventListener("click", async (event) => {
  const action = event.target?.dataset?.action;
  if (!action) return;
  selectionMenu.hidden = true;

  if (action === "custom") {
    questionInput.focus();
    return;
  }

  await runAi(action);
});

askButton.addEventListener("click", async () => {
  await runAi("custom", questionInput.value.trim());
});

explainPageButton.addEventListener("click", async () => {
  await runAiForCurrentPage("direct");
});

deepPageButton.addEventListener("click", async () => {
  await runAiForCurrentPage("deep");
});

documentSort.addEventListener("change", () => {
  state.sortMode = documentSort.value;
  renderDocumentList();
  updatePaginationControls();
});

documentSearch.addEventListener("input", () => {
  state.searchQuery = documentSearch.value;
  renderDocumentList();
});

selectVisibleButton.addEventListener("click", () => {
  toggleVisibleDocumentSelection();
});

archiveCategoryInput.addEventListener("input", () => {
  updateSelectionActions();
});

newArchiveNameInput.addEventListener("input", () => {
  createArchiveButton.disabled = state.busy || !newArchiveNameInput.value.trim();
});

newArchiveNameInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && newArchiveNameInput.value.trim()) {
    event.preventDefault();
    await createArchive();
  }
});

createArchiveButton.addEventListener("click", async () => {
  await createArchive();
});

archiveSelectedButton.addEventListener("click", async () => {
  await archiveSelectedDocuments();
});

renameArchiveButton.addEventListener("click", async () => {
  await renameSelectedArchive();
});

deleteArchiveButton.addEventListener("click", async () => {
  await deleteSelectedArchive();
});

deleteSelectedButton.addEventListener("click", async () => {
  await deleteSelectedDocuments();
});

readerSearchInput.addEventListener("input", () => {
  updateReaderSearch(readerSearchInput.value);
});

readerSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    goToSearchMatch(event.shiftKey ? -1 : 1);
  }
});

previousMatchButton.addEventListener("click", () => goToSearchMatch(-1));
nextMatchButton.addEventListener("click", () => goToSearchMatch(1));

cancelAiButton.addEventListener("click", () => {
  state.aiController?.abort();
});

historyToggleButton.addEventListener("click", () => {
  state.showAllHistory = !state.showAllHistory;
  renderHistory(state.document?.aiRecords || []);
});

prevPageButton.addEventListener("click", async () => {
  if (state.pageIndex > 0) {
    showPage(state.pageIndex - 1);
    return;
  }

  const previousDocument = getAdjacentDocument(
    state.documents,
    state.document?.id,
    -1,
    state.sortMode
  );
  if (previousDocument) await loadDocument(previousDocument.id, "last");
});

nextPageButton.addEventListener("click", async () => {
  if (state.pageIndex < state.pages.length - 1) {
    showPage(state.pageIndex + 1);
    return;
  }

  const nextDocument = getAdjacentDocument(
    state.documents,
    state.document?.id,
    1,
    state.sortMode
  );
  if (nextDocument) await loadDocument(nextDocument.id, "first");
});

await loadAiStatus();
await loadDocumentList();
const lastDocumentId = getLastDocumentId(window.localStorage);
if (state.documents.some((document) => Number(document.id) === lastDocumentId)) {
  await loadDocument(lastDocumentId);
}
updatePaginationControls();
updateSearchControls();

async function loadAiStatus() {
  try {
    const response = await fetch("/api/ai/status");
    const status = await readJson(response);
    aiStatus.classList.toggle("is-warning", !status.configured);
    if (status.provider === "mock") {
      aiStatus.textContent = "AI 接口：Mock 模式，功能可试用，但不是真实大模型回答。";
      return;
    }
    aiStatus.textContent = status.configured
      ? `AI 接口：${status.provider} 已配置，模型 ${status.model}`
      : `AI 接口：${status.provider} 未配置 API Key，当前无法调用真实模型。`;
  } catch (error) {
    aiStatus.classList.add("is-warning");
    aiStatus.textContent = `AI 接口检查失败：${error.message}`;
  }
}

async function uploadFiles(files) {
  setBusy(true, files.length > 1 ? `正在上传 ${files.length} 篇文章` : "正在上传");
  try {
    const documents = [];
    for (const file of files) {
      documents.push({
        name: file.name,
        mimeType: file.type,
        contentBase64: await fileToBase64(file)
      });
    }

    const response = await fetch("/api/documents/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: categoryInput.value.trim(),
        documents
      })
    });
    const payload = await readJson(response);
    if (payload.errors?.length) {
      setStatus(`部分文件失败：${payload.errors.map((error) => error.name).join(", ")}`, true);
    } else {
      setStatus("");
    }

    await loadDocumentList();
    if (payload.documents?.[0]) {
      const firstDocument = sortDocuments(payload.documents, state.sortMode)[0];
      await loadDocument(firstDocument.id, "first");
    }
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function loadDocumentList() {
  const [documentsResponse, archivesResponse] = await Promise.all([
    fetch("/api/documents"),
    fetch("/api/archives")
  ]);
  const payload = await readJson(documentsResponse);
  const archivePayload = await readJson(archivesResponse);
  state.documents = payload.documents || [];
  state.archives = archivePayload.archives || [];
  const existingIds = new Set(state.documents.map((document) => Number(document.id)));
  state.selectedDocumentIds = new Set(
    [...state.selectedDocumentIds].filter((id) => existingIds.has(Number(id)))
  );
  renderArchiveControls();
  renderDocumentList();
}

async function loadDocument(id, targetPage = "saved") {
  setBusy(true, "正在读取");
  try {
    const response = await fetch(`/api/documents/${id}`);
    const payload = await readJson(response);
    state.document = payload;
    state.pages = payload.renderHtml
      ? [{
          number: 1,
          blocks: payload.blocks,
          blockIds: payload.blocks.map((block) => block.id)
        }]
      : paginateBlocks(payload.blocks, { charsPerPage: 2800 });
    state.selection = { text: "", blockIds: [] };
    state.readerQuery = "";
    state.searchMatches = [];
    state.searchMatchIndex = -1;
    state.showAllHistory = false;
    readerSearchInput.value = "";
    updateSearchControls();
    renderDocumentHeader(payload);
    const targetPageIndex = targetPage === "last"
      ? state.pages.length - 1
      : targetPage === "saved"
        ? getSavedPageIndex(window.localStorage, payload.id)
        : 0;
    showPage(targetPageIndex);
    renderHistory(payload.aiRecords || []);
    setStatus("");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function runAi(mode, question = "") {
  if (!state.document) {
    setStatus("请先上传或选择文档", true);
    return;
  }
  if (mode === "custom" && !question) {
    questionInput.focus();
    return;
  }

  const controller = new AbortController();
  state.aiController = controller;
  cancelAiButton.hidden = false;
  setBusy(true, "AI 正在解析");
  try {
    const endpoint = mode === "custom" ? "/api/ai/ask" : "/api/ai/explain";
    const currentPage = state.pages[state.pageIndex];
    const selection = mode === "custom" && !state.selection.text && !state.selection.blockIds.length
      ? { text: "", blockIds: currentPage?.blockIds || [] }
      : state.selection;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        documentId: state.document.id,
        mode,
        selection,
        question
      })
    });
    const payload = await readJson(response);
    questionInput.value = "";
    await refreshDocumentHistory();
    setStatus("");
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("已取消 AI 解析");
    } else {
      setStatus(error.message, true);
    }
  } finally {
    if (state.aiController === controller) state.aiController = null;
    cancelAiButton.hidden = true;
    setBusy(false);
  }
}

async function runAiForCurrentPage(mode) {
  if (!state.document) {
    setStatus("请先上传或选择文档", true);
    return;
  }

  const page = state.pages[state.pageIndex];
  const text = page.blocks.map((block) => block.text).join("\n\n").slice(0, 1200);
  state.selection = {
    text: text ? `当前页：${text}` : "当前页",
    blockIds: page.blockIds
  };

  await runAi(mode);
}

function updateReaderSearch(value) {
  state.readerQuery = String(value || "").trim();
  state.searchMatches = findDocumentMatches(state.pages, state.readerQuery);
  state.searchMatchIndex = state.searchMatches.length > 0 ? 0 : -1;
  updateSearchControls();

  if (state.searchMatches.length > 0) {
    showPage(state.searchMatches[0].pageIndex);
  } else if (state.document) {
    showPage(state.pageIndex);
  }
}

function goToSearchMatch(direction) {
  if (state.searchMatches.length === 0) return;
  state.searchMatchIndex =
    (state.searchMatchIndex + Math.sign(direction) + state.searchMatches.length) %
    state.searchMatches.length;
  const match = state.searchMatches[state.searchMatchIndex];
  updateSearchControls();

  if (match.pageIndex !== state.pageIndex) {
    showPage(match.pageIndex);
    return;
  }

  const frame = reader.querySelector(".reader-rich-frame");
  if (frame) {
    frame.contentWindow?.find(
      state.readerQuery,
      false,
      direction < 0,
      true
    );
  } else {
    highlightReaderMatches();
  }
}

function updateSearchControls() {
  const total = state.searchMatches.length;
  const current = total > 0 ? state.searchMatchIndex + 1 : 0;
  matchIndicator.textContent = `${current} / ${total}`;
  previousMatchButton.disabled = state.busy || total === 0;
  nextMatchButton.disabled = state.busy || total === 0;
  readerSearchInput.disabled = state.busy || !state.document;
}

async function refreshDocumentHistory() {
  if (!state.document) return;
  const response = await fetch(`/api/documents/${state.document.id}`);
  const payload = await readJson(response);
  state.document = payload;
  renderHistory(payload.aiRecords);
}

function renderDocumentList() {
  const visibleDocuments = getVisibleDocuments();
  if (visibleDocuments.length === 0) {
    documentList.replaceChildren(
      emptyText(
        state.documents.length === 0
          ? "暂无文档"
          : state.archiveFilter
            ? "该归档暂无文章"
            : "没有匹配的文档"
      )
    );
    updateSelectionActions();
    return;
  }

  const groups = groupDocuments(visibleDocuments, state.sortMode);
  documentList.replaceChildren(
    ...groups.map((group) => {
      const section = document.createElement("section");
      section.className = "document-group";

      const heading = document.createElement("h3");
      heading.textContent = `${group.category} · ${group.documents.length}`;

      const items = document.createElement("div");
      items.className = "document-group-items";
      items.append(
        ...group.documents.map((documentData) =>
          createDocumentListItem(documentData)
        )
      );

      section.append(heading, items);
      return section;
    })
  );
  updateSelectionActions();
}

function getVisibleDocuments() {
  const searched = filterDocuments(state.documents, state.searchQuery);
  return state.archiveFilter
    ? searched.filter(
        (document) =>
          (document.category?.trim() || "未分类") === state.archiveFilter
      )
    : searched;
}

function createDocumentListItem(documentData) {
  const row = document.createElement("div");
  row.className = "document-list-row";

  const checkbox = document.createElement("input");
  checkbox.className = "document-select";
  checkbox.type = "checkbox";
  checkbox.checked = state.selectedDocumentIds.has(Number(documentData.id));
  checkbox.disabled = state.busy;
  checkbox.setAttribute("aria-label", `选择 ${documentData.title}`);
  checkbox.addEventListener("change", () => {
    const id = Number(documentData.id);
    if (checkbox.checked) {
      state.selectedDocumentIds.add(id);
    } else {
      state.selectedDocumentIds.delete(id);
    }
    updateSelectionActions();
  });

  const button = document.createElement("button");
  button.className = "document-list-item";
  button.type = "button";
  button.disabled = state.busy;
  button.dataset.active = String(state.document?.id === documentData.id);
  button.addEventListener("click", () => loadDocument(documentData.id));

  const title = document.createElement("span");
  title.textContent = documentData.title;
  const meta = document.createElement("small");
  meta.textContent = `${documentData.originalName} · ${documentData.blockCount} 段`;

  button.append(title, meta);

  const deleteButton = document.createElement("button");
  deleteButton.className = "delete-document-button";
  deleteButton.type = "button";
  deleteButton.disabled = state.busy;
  deleteButton.textContent = "×";
  deleteButton.title = `删除 ${documentData.title}`;
  deleteButton.setAttribute("aria-label", `删除 ${documentData.title}`);
  deleteButton.addEventListener("click", () => deleteDocument(documentData));

  row.append(checkbox, button, deleteButton);
  return row;
}

function toggleVisibleDocumentSelection() {
  const visibleIds = getVisibleDocuments().map(
    (document) => Number(document.id)
  );
  const allSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => state.selectedDocumentIds.has(id));

  for (const id of visibleIds) {
    if (allSelected) {
      state.selectedDocumentIds.delete(id);
    } else {
      state.selectedDocumentIds.add(id);
    }
  }
  renderDocumentList();
}

async function archiveSelectedDocuments() {
  const ids = getArchiveDocumentIds(
    state.selectedDocumentIds,
    state.document?.id
  );
  const category = archiveCategoryInput.value.trim();
  if (ids.length === 0 || !category) {
    if (!category) archiveCategoryInput.focus();
    return;
  }

  archiveStatus.textContent = "正在保存分类";
  archiveStatus.classList.remove("is-error", "is-success");
  setBusy(true, `正在归档 ${ids.length} 篇文档`);
  try {
    const response = await fetch("/api/documents/batch-category", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, category })
    });
    await readJson(response);
    if (state.document && ids.includes(Number(state.document.id))) {
      state.document.category = category;
    }
    state.selectedDocumentIds.clear();
    await loadDocumentList();
    updatePaginationControls();
    archiveStatus.textContent = `已保存到“${category}”`;
    archiveStatus.classList.add("is-success");
    setStatus(`已归档 ${ids.length} 篇文档到“${category}”`);
  } catch (error) {
    archiveStatus.textContent = `保存失败：${error.message}`;
    archiveStatus.classList.add("is-error");
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function createArchive() {
  const name = newArchiveNameInput.value.trim();
  if (!name) return;

  archiveStatus.textContent = "正在创建归档";
  archiveStatus.classList.remove("is-error", "is-success");
  setBusy(true, "正在创建归档");
  try {
    const response = await fetch("/api/archives", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name })
    });
    const archive = await readJson(response);
    newArchiveNameInput.value = "";
    await loadDocumentList();
    archiveCategoryInput.value = archive.name;
    archiveStatus.textContent = `已创建归档“${archive.name}”`;
    archiveStatus.classList.add("is-success");
    updateSelectionActions();
    setStatus("");
  } catch (error) {
    archiveStatus.textContent = `创建失败：${error.message}`;
    archiveStatus.classList.add("is-error");
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function renameSelectedArchive() {
  const archive = selectedArchive();
  if (!archive) return;
  const name = window.prompt("输入新的归档名称", archive.name)?.trim();
  if (!name || name === archive.name) return;

  setBusy(true, "正在重命名归档");
  try {
    const response = await fetch(`/api/archives/${archive.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name })
    });
    const renamed = await readJson(response);
    if (state.archiveFilter === archive.name) state.archiveFilter = renamed.name;
    if (state.document?.category === archive.name) {
      state.document.category = renamed.name;
    }
    await loadDocumentList();
    archiveCategoryInput.value = renamed.name;
    archiveStatus.textContent = `已重命名为“${renamed.name}”`;
    archiveStatus.className = "archive-status is-success";
    setStatus("");
  } catch (error) {
    archiveStatus.textContent = `重命名失败：${error.message}`;
    archiveStatus.className = "archive-status is-error";
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function deleteSelectedArchive() {
  const archive = selectedArchive();
  if (!archive) return;
  if (archive.documentCount > 0) {
    archiveStatus.textContent = "请先将归档内文章移出或删除";
    archiveStatus.className = "archive-status is-error";
    return;
  }
  if (!window.confirm(`确定删除空归档“${archive.name}”吗？`)) return;

  setBusy(true, "正在删除归档");
  try {
    const response = await fetch(`/api/archives/${archive.id}`, {
      method: "DELETE"
    });
    await readJson(response);
    if (state.archiveFilter === archive.name) state.archiveFilter = "";
    archiveCategoryInput.value = "";
    await loadDocumentList();
    archiveStatus.textContent = `已删除归档“${archive.name}”`;
    archiveStatus.className = "archive-status is-success";
    setStatus("");
  } catch (error) {
    archiveStatus.textContent = `删除失败：${error.message}`;
    archiveStatus.className = "archive-status is-error";
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function selectedArchive() {
  return state.archives.find(
    (archive) => archive.name === archiveCategoryInput.value
  );
}

function renderArchiveControls() {
  const selectedArchive = archiveCategoryInput.value;
  archiveCategoryInput.replaceChildren(
    createOption("", "选择归档"),
    createOption("未分类", "未分类"),
    ...state.archives.map((archive) =>
      createOption(archive.name, `${archive.name} (${archive.documentCount})`)
    )
  );
  if ([...archiveCategoryInput.options].some((option) => option.value === selectedArchive)) {
    archiveCategoryInput.value = selectedArchive;
  }

  categoryOptions.replaceChildren(
    ...state.archives.map((archive) => {
      const option = document.createElement("option");
      option.value = archive.name;
      return option;
    })
  );

  const unclassifiedCount = state.documents.filter(
    (document) => (document.category?.trim() || "未分类") === "未分类"
  ).length;
  archiveList.replaceChildren(
    createArchiveLocation("", "全部", state.documents.length),
    createArchiveLocation("未分类", "未分类", unclassifiedCount),
    ...state.archives.map((archive) =>
      createArchiveLocation(archive.name, archive.name, archive.documentCount)
    )
  );
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function createArchiveLocation(value, label, count) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "archive-location";
  button.dataset.active = String(state.archiveFilter === value);
  button.textContent = `${label} ${count}`;
  button.addEventListener("click", () => {
    state.archiveFilter = value;
    renderArchiveControls();
    renderDocumentList();
  });
  return button;
}

async function deleteDocument(documentData) {
  const confirmed = window.confirm(
    `确定删除“${documentData.title}”吗？原文件和 AI 解析记录也会删除。`
  );
  if (!confirmed) return;

  await deleteDocuments([Number(documentData.id)], {
    useBatchEndpoint: false
  });
}

async function deleteSelectedDocuments() {
  const ids = [...state.selectedDocumentIds];
  if (ids.length === 0) return;

  const confirmed = window.confirm(
    `确定删除选中的 ${ids.length} 篇文档吗？原文件和 AI 解析记录也会删除。`
  );
  if (!confirmed) return;

  await deleteDocuments(ids, { useBatchEndpoint: true });
}

async function deleteDocuments(ids, { useBatchEndpoint }) {
  const deletedIds = [...new Set(ids.map((id) => Number(id)))];
  const deletingCurrent =
    state.document && deletedIds.includes(Number(state.document.id));
  const fallbackDocument = deletingCurrent
    ? getRemainingAdjacentDocument(
        state.documents,
        state.document.id,
        deletedIds,
        state.sortMode
      )
    : null;

  setBusy(true, "正在删除");
  try {
    const response = useBatchEndpoint
      ? await fetch("/api/documents/batch-delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: deletedIds })
        })
      : await fetch(`/api/documents/${deletedIds[0]}`, {
          method: "DELETE"
        });
    await readJson(response);
    for (const id of deletedIds) {
      state.selectedDocumentIds.delete(id);
    }
    await loadDocumentList();

    if (deletingCurrent) {
      const fallbackStillExists = state.documents.find(
        (document) => Number(document.id) === Number(fallbackDocument?.id)
      );
      if (fallbackStillExists) {
        await loadDocument(fallbackStillExists.id);
      } else {
        clearDocumentView();
      }
    }
    setStatus("");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function updateSelectionActions() {
  const count = state.selectedDocumentIds.size;
  const archiveIds = getArchiveDocumentIds(
    state.selectedDocumentIds,
    state.document?.id
  );
  const visibleIds = getVisibleDocuments().map(
    (document) => Number(document.id)
  );
  const allVisibleSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => state.selectedDocumentIds.has(id));
  deleteSelectedButton.disabled = state.busy || count === 0;
  deleteSelectedButton.textContent = count > 0 ? `删除所选 (${count})` : "删除所选";
  selectVisibleButton.disabled = state.busy || visibleIds.length === 0;
  selectVisibleButton.textContent = allVisibleSelected ? "取消全选" : "全选结果";
  archiveSelectedButton.disabled =
    state.busy || archiveIds.length === 0 || !archiveCategoryInput.value.trim();
  archiveSelectedButton.textContent = count > 0
    ? `放入 (${count})`
    : state.document
      ? "放入当前"
      : "放入归档";
  createArchiveButton.disabled = state.busy || !newArchiveNameInput.value.trim();
  const archive = selectedArchive();
  renameArchiveButton.disabled = state.busy || !archive;
  deleteArchiveButton.disabled =
    state.busy || !archive || archive.documentCount > 0;
}

function clearDocumentView() {
  state.document = null;
  state.pages = [];
  state.pageIndex = 0;
  state.selection = { text: "", blockIds: [] };
  state.readerQuery = "";
  state.searchMatches = [];
  state.searchMatchIndex = -1;
  readerSearchInput.value = "";
  readerTitle.textContent = "上传一篇文章开始阅读";
  documentTitle.textContent = "未选择";
  reader.replaceChildren();
  renderHistory([]);
  renderDocumentList();
  updatePaginationControls();
  updateSearchControls();
}

function renderDocumentHeader(documentData) {
  readerTitle.textContent = documentData.title;
  documentTitle.textContent = documentData.title;
  renderDocumentList();
}

function showPage(pageIndex) {
  if (state.pages.length === 0) return;
  state.pageIndex = Math.min(Math.max(pageIndex, 0), state.pages.length - 1);
  state.selection = { text: "", blockIds: [] };
  selectionMenu.hidden = true;

  if (state.document.renderHtml) {
    renderRichHtmlDocument();
    saveReadingProgress(window.localStorage, state.document.id, state.pageIndex);
    updatePaginationControls();
    return;
  }

  reader.classList.remove("has-rich-document");
  const page = state.pages[state.pageIndex];
  reader.replaceChildren(
    ...page.blocks.map((block) => {
      const tag = block.html ? "div" : block.type === "heading" ? "h3" : "p";
      const element = document.createElement(tag);
      element.className = `doc-block doc-${block.type}`;
      element.dataset.blockId = block.id;
      if (block.html) {
        element.innerHTML = window.DOMPurify.sanitize(block.html);
      } else {
        element.textContent = block.text;
      }
      return element;
    })
  );
  reader.scrollTop = 0;
  highlightReaderMatches();
  saveReadingProgress(window.localStorage, state.document.id, state.pageIndex);
  updatePaginationControls();
}

function renderRichHtmlDocument() {
  reader.classList.add("has-rich-document");
  const frame = document.createElement("iframe");
  frame.className = "reader-rich-frame";
  frame.title = state.document.title;
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.srcdoc = state.document.renderHtml;
  frame.addEventListener("load", () => {
    const frameDocument = frame.contentDocument;
    if (!frameDocument) return;
    frameDocument.addEventListener("mouseup", () => {
      setTimeout(() => captureFrameSelection(frame), 0);
    });
    frameDocument.addEventListener("mousedown", () => {
      selectionMenu.hidden = true;
      state.selection = { text: "", blockIds: [] };
    });
    frameDocument.addEventListener("click", (event) => {
      handleRichDocumentLink(event, frame);
    });
    if (state.readerQuery) {
      frame.contentWindow?.find(state.readerQuery, false, false, true);
    }
  });
  reader.replaceChildren(frame);
}

function highlightReaderMatches() {
  if (!state.readerQuery || state.searchMatches.length === 0) return;

  const activeMatch = state.searchMatches[state.searchMatchIndex];
  const pageMatches = state.searchMatches.filter(
    (match) => match.pageIndex === state.pageIndex
  );
  for (const block of reader.querySelectorAll(".doc-block")) {
    const marks = highlightTextNodes(block, state.readerQuery);
    const blockId = Number(block.dataset.blockId);
    const activeOccurrence = pageMatches
      .filter((match) => match.blockId === blockId)
      .findIndex((match) => match === activeMatch);
    if (activeOccurrence >= 0 && marks[activeOccurrence]) {
      marks[activeOccurrence].classList.add("is-active");
      marks[activeOccurrence].scrollIntoView({ block: "center" });
    }
  }
}

function highlightTextNodes(root, query) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode);

  const marks = [];
  const needle = query.toLocaleLowerCase("zh-CN");
  for (const node of nodes) {
    const text = node.nodeValue || "";
    const normalized = text.toLocaleLowerCase("zh-CN");
    let start = normalized.indexOf(needle);
    if (start < 0) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    while (start >= 0) {
      fragment.append(text.slice(cursor, start));
      const mark = document.createElement("mark");
      mark.className = "reader-search-hit";
      mark.textContent = text.slice(start, start + query.length);
      fragment.append(mark);
      marks.push(mark);
      cursor = start + query.length;
      start = normalized.indexOf(needle, cursor);
    }
    fragment.append(text.slice(cursor));
    node.replaceWith(fragment);
  }
  return marks;
}

async function handleRichDocumentLink(event, frame) {
  const anchor = event.target?.closest?.("a[href]");
  if (!anchor) return;

  const href = anchor.getAttribute("href")?.trim() || "";
  if (href.startsWith("#")) {
    event.preventDefault();
    const targetId = decodeURIComponent(href.slice(1));
    frame.contentDocument?.getElementById(targetId)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
    return;
  }

  const linkedDocument = resolveLinkedDocument(
    state.documents,
    state.document,
    href
  );
  if (linkedDocument) {
    event.preventDefault();
    await loadDocument(linkedDocument.id, "first");
    return;
  }

  if (/^https?:\/\//i.test(href)) {
    event.preventDefault();
    window.open(anchor.href, "_blank", "noopener,noreferrer");
    return;
  }

  event.preventDefault();
  setStatus(`未找到链接对应的已上传文章：${href}`, true);
}

function captureFrameSelection(frame) {
  const selection = frame.contentWindow?.getSelection();
  const text = selection?.toString().trim() || "";
  if (!text || !selection.rangeCount) return;

  const rangeRect = selection.getRangeAt(0).getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const excerpt = text.slice(0, 80);
  const blockIds = state.document.blocks
    .filter((block) => block.text.includes(excerpt))
    .map((block) => Number(block.id));

  showSelectionMenu({
    text,
    blockIds,
    rect: {
      left: frameRect.left + rangeRect.left,
      width: rangeRect.width,
      bottom: frameRect.top + rangeRect.bottom
    }
  });
}

function updatePaginationControls() {
  const total = state.pages.length;
  const current = total === 0 ? 0 : state.pageIndex + 1;
  const categoryDocuments = state.document
    ? sortDocuments(
        state.documents.filter(
          (document) =>
            (document.category || "未分类") ===
            (state.document.category || "未分类")
        ),
        state.sortMode
      )
    : [];
  const documentIndex = categoryDocuments.findIndex(
    (document) => Number(document.id) === Number(state.document?.id)
  );
  pageIndicator.textContent = state.document
    ? `${documentIndex + 1}/${categoryDocuments.length} · ${current}/${total}`
    : `${current} / ${total}`;

  const previousDocument = getAdjacentDocument(
    state.documents,
    state.document?.id,
    -1,
    state.sortMode
  );
  const nextDocument = getAdjacentDocument(
    state.documents,
    state.document?.id,
    1,
    state.sortMode
  );
  prevPageButton.disabled =
    state.busy || (!previousDocument && state.pageIndex === 0);
  nextPageButton.disabled =
    state.busy || (!nextDocument && state.pageIndex >= total - 1);
  explainPageButton.disabled = state.busy || !state.document;
  deepPageButton.disabled = state.busy || !state.document;
}

function renderHistory(records) {
  const recordList = records || [];
  const visibleRecords = getVisibleRecords(
    recordList,
    state.showAllHistory ? recordList.length : 3
  );
  historyToggleButton.hidden = recordList.length <= 3;
  historyToggleButton.textContent = state.showAllHistory
    ? "收起"
    : `查看全部 (${recordList.length})`;
  if (!visibleRecords.length) {
    answerList.replaceChildren(emptyText("选中文字后开始解析"));
    return;
  }

  answerList.replaceChildren(
    ...visibleRecords.map((record) =>
      createAnswerElement({
        mode: record.mode,
        answer: record.answer,
        provider: record.provider,
        selectedText: record.selectedText,
        createdAt: record.createdAt
      })
    )
  );
}

function createAnswerElement(record) {
  const item = document.createElement("section");
  item.className = "answer-item";
  item.dataset.mode = record.mode;

  const title = document.createElement("strong");
  title.textContent = modeLabel(record.mode);

  const body = document.createElement("div");
  body.className = "answer-body";
  body.innerHTML = renderMarkdown(record.answer);

  const meta = document.createElement("small");
  meta.textContent = formatAnswerMeta(record);

  item.append(title, body, meta);
  return item;
}

function captureSelection() {
  const selection = window.getSelection();
  const text = selection?.toString().trim() || "";
  if (!text || !selection.rangeCount) {
    return;
  }

  const range = selection.getRangeAt(0);
  if (!reader.contains(range.commonAncestorContainer)) {
    return;
  }

  const blockIds = [...reader.querySelectorAll(".doc-block")]
    .filter((block) => range.intersectsNode(block))
    .map((block) => Number(block.dataset.blockId));
  const rect = range.getBoundingClientRect();

  showSelectionMenu({ text, blockIds, rect });
}

function showSelectionMenu({ text, blockIds, rect }) {
  state.selection = { text, blockIds };
  selectionMenu.hidden = false;
  selectionMenu.classList.remove("is-docked");

  const menuRect = selectionMenu.getBoundingClientRect();
  const position = calculateSelectionMenuPosition({
    selectionRect: rect,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    menuWidth: menuRect.width,
    menuHeight: menuRect.height
  });

  selectionMenu.classList.toggle("is-docked", position.docked);
  selectionMenu.style.left = `${position.left}px`;
  selectionMenu.style.top = `${position.top}px`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const readerInstance = new FileReader();
    readerInstance.onerror = () => reject(new Error("文件读取失败"));
    readerInstance.onload = () => {
      const result = String(readerInstance.result || "");
      resolve(result.split(",")[1] || "");
    };
    readerInstance.readAsDataURL(file);
  });
}

async function readJson(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `请求失败：${response.status}`);
  }
  return payload;
}

function modeLabel(mode) {
  if (mode === "deep") return "深入解析";
  if (mode === "custom") return "自定义问题";
  return "直接解析";
}

function emptyText(text) {
  const element = document.createElement("p");
  element.className = "empty-text";
  element.textContent = text;
  return element;
}

function setBusy(busy, label = "") {
  state.busy = busy;
  fileInput.disabled = busy;
  documentSearch.disabled = busy;
  archiveCategoryInput.disabled = busy;
  newArchiveNameInput.disabled = busy;
  askButton.disabled = busy;
  for (const control of documentList.querySelectorAll("button, input")) {
    control.disabled = busy;
  }
  for (const control of archiveList.querySelectorAll("button")) {
    control.disabled = busy;
  }
  updateSelectionActions();
  updatePaginationControls();
  updateSearchControls();
  setStatus(label);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}
