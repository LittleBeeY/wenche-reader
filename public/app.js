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
import { consumeEventStream } from "./aiStream.js";
import {
  formatAnswerCitations,
  resolveAnswerReferences
} from "./answerReferences.js";
import {
  assignBlockIdsByText,
  buildRangeAnchors,
  findBlockIdsByText
} from "./selectionAnchors.js";
import {
  calculateSelectionMenuPosition,
  dismissSelectionUi
} from "./selectionUi.js";
import {
  constrainFloatingLauncherPosition,
  constrainFloatingPanelBounds,
  loadFloatingLauncherPosition,
  loadFloatingPanelBounds,
  loadPanelState,
  saveFloatingLauncherPosition,
  saveFloatingPanelBounds,
  savePanelState
} from "./panelState.js";
import {
  closeSettings,
  initSettingsHub,
  openSettings
} from "./settingsHub.js";
import {
  createDocxPreview,
  isDocxDocument,
  measureDocxPages,
  paginateRenderedDocxSections
} from "./docxPreview.js";
import {
  DEFAULT_READING_SETTINGS,
  loadReadingSettings,
  normalizeReadingSettings,
  saveReadingSettings
} from "./readingSettings.js";
import { bindDisclosureState } from "./disclosureState.js";
import { initRssMode } from "./rssView.js";

const state = {
  document: null,
  documentContext: null,
  documents: [],
  lastLocalDocumentId: null,
  sourceMode: "local",
  pages: [],
  docxPreview: null,
  archives: [],
  archiveFilter: "",
  pageIndex: 0,
  sortMode: "filename",
  searchQuery: "",
  selectedDocumentIds: new Set(),
  selection: { text: "", blockIds: [], anchors: [] },
  readerQuery: "",
  searchMatches: [],
  searchMatchIndex: -1,
  showAllHistory: false,
  knowledgeItems: [],
  aiView: "analysis",
  pendingAnnotation: null,
  activeAnnotationId: null,
  docxScrollFrame: null,
  aiController: null,
  busy: false,
  immersive: false,
  panels: loadPanelState(window.localStorage, {
    rightCollapsedDefault: window.innerWidth <= 760
  }),
  floatingAiPanelBounds: loadFloatingPanelBounds(window.localStorage),
  floatingAiLauncherPosition: loadFloatingLauncherPosition(window.localStorage),
  readingSettings: loadReadingSettings(window.localStorage)
};

if (window.innerWidth <= 760) {
  state.panels.rightCollapsed = true;
}

const appShell = document.querySelector("#app-shell");
const documentSidebar = document.querySelector("#document-sidebar");
const aiPanel = document.querySelector("#ai-panel");
const aiPanelHeader = aiPanel.querySelector(".ai-header");
const aiPanelResize = document.querySelector("#ai-panel-resize");
const documentSidebarToggle = document.querySelector("#toggle-document-sidebar");
const aiPanelToggle = document.querySelector("#toggle-ai-panel");
const fileInput = document.querySelector("#file-input");
const categoryInput = document.querySelector("#category-input");
const documentSort = document.querySelector("#document-sort");
const reader = document.querySelector("#reader");
const readerTitle = document.querySelector("#reader-title");
const documentList = document.querySelector("#document-list");
const localLibraryDisclosure = document.querySelector("#local-library-disclosure");
const localLibraryFilters = document.querySelector("#local-library-filters");
const localDocumentCount = document.querySelector("#local-document-count");
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
const libraryOrganize = document.querySelector("#library-organize");
const sidebarMore = document.querySelector("#sidebar-more");
const sidebarMoreSummary = sidebarMore.querySelector(":scope > summary");
const rssThemeControls = document.querySelector("#rss-theme-controls");
const rssThemePicker = document.querySelector("#rss-theme-picker");
const statusEl = document.querySelector("#status");
const selectionMenu = document.querySelector("#selection-menu");
const questionInput = document.querySelector("#question-input");
const aiScopeSelect = document.querySelector("#ai-scope");
const askButton = document.querySelector("#ask-button");
const answerList = document.querySelector("#answer-list");
const prevPageButton = document.querySelector("#prev-page");
const nextPageButton = document.querySelector("#next-page");
const pageIndicator = document.querySelector("#page-indicator");
const aiStatus = document.querySelector("#ai-status");
const rssAiStatus = document.querySelector("#rss-ai-status");
const aiSettingsProvider = document.querySelector("#ai-settings-provider");
const aiSettingsProviderHint = document.querySelector("#ai-settings-provider-hint");
const aiSettingsKey = document.querySelector("#ai-settings-key");
const aiSettingsKeyHint = document.querySelector("#ai-settings-key-hint");
const aiSettingsClearKey = document.querySelector("#ai-settings-clear-key");
const aiSettingsEnv = document.querySelector("#ai-settings-env");
const aiSettingsEnvText = document.querySelector("#ai-settings-env-text");
const aiSettingsUseEnv = document.querySelector("#ai-settings-use-env");
const aiSettingsBase = document.querySelector("#ai-settings-base");
const aiSettingsModel = document.querySelector("#ai-settings-model");
const aiSettingsStatus = document.querySelector("#ai-settings-status");
const aiSettingsCancel = document.querySelector("#ai-settings-cancel");
const aiSettingsTest = document.querySelector("#ai-settings-test");
const aiSettingsSave = document.querySelector("#ai-settings-save");
const explainPageButton = document.querySelector("#explain-page");
const deepPageButton = document.querySelector("#deep-page");
const readerSearchInput = document.querySelector("#reader-search-input");
const previousMatchButton = document.querySelector("#previous-match");
const nextMatchButton = document.querySelector("#next-match");
const matchIndicator = document.querySelector("#match-indicator");
const cancelAiButton = document.querySelector("#cancel-ai");
const historyToggleButton = document.querySelector("#history-toggle");
const answerHistory = document.querySelector("#answer-history");
const answerCount = document.querySelector("#answer-count");
const answerSummary = document.querySelector("#answer-summary");
const bookmarkPageButton = document.querySelector("#bookmark-page");
const analysisTab = document.querySelector("#analysis-tab");
const knowledgeTab = document.querySelector("#knowledge-tab");
const analysisView = document.querySelector("#analysis-view");
const knowledgeView = document.querySelector("#knowledge-view");
const annotationList = document.querySelector("#annotation-list");
const annotationSection = document.querySelector("#annotation-section");
const knowledgeList = document.querySelector("#knowledge-list");
const exportCurrentButton = document.querySelector("#export-current");
const exportAllButton = document.querySelector("#export-all");
const downloadBackupButton = document.querySelector("#download-backup");
const restoreBackupInput = document.querySelector("#restore-backup");
const annotationDialog = document.querySelector("#annotation-dialog");
const annotationExcerpt = document.querySelector("#annotation-excerpt");
const annotationNote = document.querySelector("#annotation-note");
const cancelAnnotationButton = document.querySelector("#cancel-annotation");
const readingSettingsPanel = document.querySelector("#reading-settings");
const decreaseFontButton = document.querySelector("#decrease-font");
const increaseFontButton = document.querySelector("#increase-font");
const fontScaleOutput = document.querySelector("#font-scale");
const resetReadingSettingsButton = document.querySelector("#reset-reading-settings");
const immersiveToggleButton = document.querySelector("#immersive-toggle");
const exitImmersiveButton = document.querySelector("#exit-immersive");
const sourceLocalButton = document.querySelector("#source-local");
const sourceRssButton = document.querySelector("#source-rss");
const coldStartCard = document.querySelector("#cold-start-card");

bindDisclosureState(localLibraryDisclosure, "local-library", { defaultOpen: true });
bindDisclosureState(localLibraryFilters, "local-library-filters");

let rssController = null;
let aiPanelGesture = null;
let suppressAiPanelToggleClick = false;
let wasNarrowViewport = window.innerWidth <= 760;
const rssHost = {
  openDocument: (documentId) =>
    loadDocument(documentId, 0, { rememberAsLocal: false }),
  reloadCurrentDocument: () =>
    state.document
      ? loadDocument(state.document.id, "saved", { rememberAsLocal: false })
      : Promise.resolve(),
  openSavedDocument: async (documentId) => {
    await setSourceMode("local");
    await loadDocument(documentId, "saved", { rememberAsLocal: true });
  },
  setStatus,
  getCurrentDocument: () => state.document,
  refreshDocuments: () => loadDocumentList(),
  collapseAiPanel: () => {
    if (!state.panels.rightCollapsed) {
      state.panels.rightCollapsed = true;
      renderPanelState();
    }
  },
  askQuestion: (question) => {
    questionInput.value = question;
    if (state.panels.rightCollapsed) {
      state.panels.rightCollapsed = false;
      renderPanelState();
    }
    runAi("custom", question);
  }
};

async function setSourceMode(mode) {
  if (state.sourceMode === mode) return;
  state.sourceMode = mode;
  const isRss = mode === "rss";
  sourceLocalButton.dataset.active = String(!isRss);
  sourceLocalButton.setAttribute("aria-selected", String(!isRss));
  sourceRssButton.dataset.active = String(isRss);
  sourceRssButton.setAttribute("aria-selected", String(isRss));
  appShell.classList.toggle("rss-mode", isRss);
  if (isRss) {
    sidebarMore.open = false;
    if (coldStartCard) coldStartCard.hidden = true;
    rssController ??= initRssMode(rssHost);
    await rssController.activate();
    rssController.onDocumentLoaded(state.document);
  } else {
    rssController?.deactivate();
    if (state.documentContext === "rss") {
      await restoreLocalDocumentContext();
    } else if (!state.document && coldStartCard) {
      coldStartCard.hidden = false;
    }
  }
  try {
    window.localStorage.setItem("wenche.sourceMode", mode);
  } catch {}
}

sourceLocalButton.addEventListener("click", () => {
  void setSourceMode("local");
});
sourceRssButton.addEventListener("click", () => {
  void setSourceMode("rss");
});

const coldStartUploadButton = document.querySelector("#cold-start-upload");
const coldStartRssButton = document.querySelector("#cold-start-rss");
coldStartUploadButton?.addEventListener("click", () => {
  fileInput.click();
});
coldStartRssButton?.addEventListener("click", () => {
  void setSourceMode("rss");
});

documentSidebarToggle.addEventListener("click", () => {
  state.panels.leftCollapsed = !state.panels.leftCollapsed;
  renderPanelState();
});

sidebarMoreSummary.addEventListener("click", (event) => {
  if (!state.panels.leftCollapsed) return;
  event.preventDefault();
  state.panels.leftCollapsed = false;
  renderPanelState();
  sidebarMore.open = true;
});

document.addEventListener("click", (event) => {
  if (sidebarMore.open && !sidebarMore.contains(event.target)) {
    sidebarMore.open = false;
  }
});

aiPanelToggle.addEventListener("click", () => {
  if (suppressAiPanelToggleClick) {
    suppressAiPanelToggleClick = false;
    return;
  }
  state.panels.rightCollapsed = !state.panels.rightCollapsed;
  renderPanelState();
});

setupFloatingAiPanel();

libraryOrganize.addEventListener("toggle", () => {
  documentSidebar.classList.toggle("is-organizing", libraryOrganize.open);
  if (!libraryOrganize.open && state.selectedDocumentIds.size > 0) {
    state.selectedDocumentIds.clear();
    renderDocumentList();
  }
  updateSelectionActions();
});

immersiveToggleButton.addEventListener("click", () => setImmersive(true));
exitImmersiveButton.addEventListener("click", () => setImmersive(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.immersive) setImmersive(false);
});

fileInput.addEventListener("change", async (event) => {
  const files = [...(event.target.files || [])];
  if (files.length === 0) return;
  await uploadFiles(files);
  fileInput.value = "";
});

document
  .querySelector("#sidebar-settings-open")
  ?.addEventListener("click", () => openSettings("data"));
document
  .querySelector("#rss-open-settings")
  ?.addEventListener("click", () => {
    document.querySelector(".rss-article-more")?.removeAttribute("open");
    openSettings("rss");
  });

reader.addEventListener("mouseup", () => {
  setTimeout(captureSelection, 0);
});

reader.addEventListener("click", (event) => {
  const mark = event.target?.closest?.("[data-annotation-id]");
  if (mark && reader.contains(mark)) showAnnotationMenu(mark);
});

reader.addEventListener("scroll", syncDocxPageFromScroll);

window.addEventListener("resize", () => {
  const isNarrowViewport = window.innerWidth <= 760;
  if (isNarrowViewport && !wasNarrowViewport && !state.panels.rightCollapsed) {
    state.panels.rightCollapsed = true;
    renderPanelState();
  }
  wasNarrowViewport = isNarrowViewport;
  fitFloatingAiPanelToViewport();
  fitFloatingAiLauncherToViewport();
  applyReadingSettingsToFrame(reader.querySelector(".reader-rich-frame"));
  applyDocxReadingScale();
});

appShell.addEventListener("transitionend", (event) => {
  if (event.target !== appShell || event.propertyName !== "grid-template-columns") return;
  applyReadingSettingsToFrame(reader.querySelector(".reader-rich-frame"));
  applyDocxReadingScale();
});

document.addEventListener("mousedown", (event) => {
  if (!selectionMenu.contains(event.target)) {
    const preserveSelection = aiPanel.contains(event.target);
    dismissSelectionUi({
      menu: selectionMenu,
      browserSelection: window.getSelection(),
      state,
      preserveSelection
    });
    if (!preserveSelection && aiScopeSelect.value === "selection") {
      aiScopeSelect.value = "document";
    }
    if (!preserveSelection) {
      aiScopeSelect.querySelector("[value='selection']").disabled = true;
    }
    state.activeAnnotationId = null;
    selectionMenu.dataset.mode = "selection";
  }
});

selectionMenu.addEventListener("click", async (event) => {
  const action = event.target?.dataset?.action;
  if (!action) return;
  selectionMenu.hidden = true;

  if (action === "remove-annotation") {
    const annotationId = state.activeAnnotationId;
    state.activeAnnotationId = null;
    if (annotationId) await deleteAnnotation(annotationId);
    return;
  }

  if (action === "highlight") {
    await createAnnotation("highlight");
    return;
  }
  if (action === "note") {
    openAnnotationDialog();
    return;
  }
  expandAiPanel();
  aiScopeSelect.value = "selection";

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

bookmarkPageButton.addEventListener("click", async () => {
  await togglePageBookmark();
});

analysisTab.addEventListener("click", () => showAiView("analysis"));
knowledgeTab.addEventListener("click", async () => {
  showAiView("knowledge");
  await loadKnowledgeItems();
});

answerList.addEventListener("click", async (event) => {
  const referenceButton = event.target.closest("button[data-answer-reference]");
  if (referenceButton) {
    await navigateToAnswerReference(referenceButton);
    return;
  }
  const button = event.target.closest("button[data-save-record]");
  if (!button) return;
  const record = state.document?.aiRecords?.find(
    (item) => Number(item.id) === Number(button.dataset.saveRecord)
  );
  if (!record) return;
  if (record.saved) {
    showAiView("knowledge");
    await loadKnowledgeItems();
    return;
  }
  await saveAiRecord(record, {
    saved: true,
    title: defaultKnowledgeTitle(record),
    note: ""
  });
});

knowledgeList.addEventListener("click", async (event) => {
  const referenceButton = event.target.closest("button[data-answer-reference]");
  if (referenceButton) {
    await navigateToAnswerReference(referenceButton);
    return;
  }
  const actionButton = event.target.closest("button[data-knowledge-action]");
  if (!actionButton) return;
  const item = state.knowledgeItems.find(
    (record) => Number(record.id) === Number(actionButton.dataset.recordId)
  );
  if (!item) return;
  const card = actionButton.closest(".knowledge-item");
  if (actionButton.dataset.knowledgeAction === "remove") {
    await saveAiRecord(item, { saved: false, title: "", note: "" });
    return;
  }
  await saveAiRecord(item, {
    saved: true,
    title: card.querySelector("[data-knowledge-title]").value.trim(),
    note: card.querySelector("[data-knowledge-note]").value.trim()
  });
});

annotationList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-annotation-action]");
  if (!button) return;
  const annotation = state.document?.annotations?.find(
    (item) => Number(item.id) === Number(button.dataset.annotationId)
  );
  if (!annotation) return;
  if (button.dataset.annotationAction === "jump") {
    showPage(annotation.pageIndex);
    return;
  }
  if (button.dataset.annotationAction === "delete") {
    await deleteAnnotation(annotation.id);
    return;
  }
  const card = button.closest(".knowledge-item");
  await updateAnnotation(annotation.id, card.querySelector("textarea").value.trim());
});

exportCurrentButton.addEventListener("click", () => {
  if (state.document) downloadFrom(`/api/export/markdown?documentId=${state.document.id}`);
});
exportAllButton.addEventListener("click", () => downloadFrom("/api/export/markdown"));
downloadBackupButton.addEventListener("click", () => downloadFrom("/api/backup"));
restoreBackupInput.addEventListener("change", async () => {
  const file = restoreBackupInput.files?.[0];
  if (file) await restoreBackup(file);
  restoreBackupInput.value = "";
});

annotationDialog.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!annotationNote.value.trim()) return;
  annotationDialog.close();
  await createAnnotation("note", annotationNote.value.trim(), state.pendingAnnotation);
  state.pendingAnnotation = null;
});
cancelAnnotationButton.addEventListener("click", () => {
  state.pendingAnnotation = null;
  annotationDialog.close();
});

decreaseFontButton.addEventListener("click", () => {
  updateReadingSettings({ fontScale: state.readingSettings.fontScale - 10 });
});

increaseFontButton.addEventListener("click", () => {
  updateReadingSettings({ fontScale: state.readingSettings.fontScale + 10 });
});

readingSettingsPanel.addEventListener("click", (event) => {
  const option = event.target.closest("button[data-value]");
  if (!option) return;
  const control = option.closest("[data-reading-control]")?.dataset.readingControl;
  if (!control) return;
  updateReadingSettings({ [control]: option.dataset.value });
});

rssThemeControls.addEventListener("click", (event) => {
  const option = event.target.closest("button[data-rss-theme]");
  if (!option) return;
  updateReadingSettings({ theme: option.dataset.rssTheme });
  rssThemePicker.open = false;
});

resetReadingSettingsButton.addEventListener("click", () => {
  state.readingSettings = { ...DEFAULT_READING_SETTINGS };
  applyReadingSettings();
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

renderPanelState();
applyReadingSettings();
showAiView("analysis");
initSettingsHub();

// 启动数据加载不能放在模块顶层 await：那会挂起后续所有监听器注册，
// 导致窗口已显示但点击（如 AI 接口设置）没有反应。改为末尾统一启动。
async function initializeReader() {
  await loadAiStatus();
  await loadDocumentList();
  const lastDocumentId = getLastDocumentId(window.localStorage);
  if (state.documents.some((document) => Number(document.id) === lastDocumentId)) {
    await loadDocument(lastDocumentId);
  }
  if (coldStartCard) coldStartCard.hidden = Boolean(state.document);
  updatePaginationControls();
  updateSearchControls();
  try {
    if (window.localStorage.getItem("wenche.sourceMode") === "rss") {
      await setSourceMode("rss");
    }
  } catch {}
}

function renderPanelState() {
  const { leftCollapsed, rightCollapsed } = state.panels;
  appShell.classList.toggle("is-left-collapsed", leftCollapsed);
  appShell.classList.toggle("is-right-collapsed", rightCollapsed);

  updatePanelToggle(documentSidebarToggle, {
    collapsed: leftCollapsed,
    collapseLabel: "收起导航栏",
    expandLabel: "展开导航栏",
    collapseIcon: "‹",
    expandIcon: "›"
  });
  updatePanelToggle(aiPanelToggle, {
    collapsed: rightCollapsed,
    collapseLabel: "收起 AI 面板",
    expandLabel: "展开 AI 面板",
    collapseIcon: "›",
    expandIcon: "AI"
  });
  if (leftCollapsed) sidebarMore.open = false;
  savePanelState(window.localStorage, state.panels);
  requestAnimationFrame(() => {
    if (rightCollapsed) {
      fitFloatingAiLauncherToViewport();
    } else {
      fitFloatingAiPanelToViewport();
    }
    applyReadingSettingsToFrame(reader.querySelector(".reader-rich-frame"));
    applyDocxReadingScale();
  });
}

function setupFloatingAiPanel() {
  if (state.floatingAiPanelBounds) {
    applyFloatingAiPanelBounds(state.floatingAiPanelBounds);
  }
  if (state.floatingAiLauncherPosition) {
    applyFloatingAiLauncherPosition(state.floatingAiLauncherPosition);
  }

  aiPanelToggle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !state.panels.rightCollapsed) return;
    beginAiLauncherGesture(event);
    event.stopPropagation();
  });
  aiPanelToggle.addEventListener("pointermove", (event) => {
    if (aiPanelGesture?.type !== "launcher") return;
    updateAiPanelGesture(event);
    event.stopPropagation();
  });
  aiPanelToggle.addEventListener("pointerup", (event) => {
    if (aiPanelGesture?.type !== "launcher") return;
    finishAiPanelGesture(event);
    event.stopPropagation();
  });
  aiPanelToggle.addEventListener("pointercancel", (event) => {
    if (aiPanelGesture?.type !== "launcher") return;
    finishAiPanelGesture(event);
    event.stopPropagation();
  });

  aiPanelHeader.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      window.innerWidth <= 760 ||
      state.panels.rightCollapsed ||
      event.target.closest("button, a, input, select, textarea")
    ) {
      return;
    }
    beginAiPanelGesture("move", event, aiPanelHeader);
  });
  aiPanelHeader.addEventListener("pointermove", updateAiPanelGesture);
  aiPanelHeader.addEventListener("pointerup", finishAiPanelGesture);
  aiPanelHeader.addEventListener("pointercancel", finishAiPanelGesture);

  aiPanelResize.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || window.innerWidth <= 760 || state.panels.rightCollapsed) return;
    beginAiPanelGesture("resize", event, aiPanelResize);
  });
  aiPanelResize.addEventListener("pointermove", updateAiPanelGesture);
  aiPanelResize.addEventListener("pointerup", finishAiPanelGesture);
  aiPanelResize.addEventListener("pointercancel", finishAiPanelGesture);
  aiPanelResize.addEventListener("keydown", (event) => {
    if (
      window.innerWidth <= 760 ||
      state.panels.rightCollapsed ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();
    const rect = aiPanel.getBoundingClientRect();
    const step = event.shiftKey ? 32 : 16;
    const widthDelta =
      event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const heightDelta =
      event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    applyFloatingAiPanelBounds({
      left: rect.left,
      top: rect.top,
      width: rect.width + widthDelta,
      height: rect.height + heightDelta
    });
    saveFloatingPanelBounds(window.localStorage, state.floatingAiPanelBounds);
  });
}

function beginAiPanelGesture(type, event, target) {
  const rect = aiPanel.getBoundingClientRect();
  aiPanelGesture = {
    type,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    bounds: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    }
  };
  target.setPointerCapture(event.pointerId);
  aiPanel.classList.add(type === "resize" ? "is-resizing" : "is-dragging");
  event.preventDefault();
}

function beginAiLauncherGesture(event) {
  const rect = aiPanel.getBoundingClientRect();
  aiPanelGesture = {
    type: "launcher",
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    bounds: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    }
  };
  aiPanelToggle.setPointerCapture(event.pointerId);
  aiPanel.classList.add("is-dragging");
  event.preventDefault();
}

function updateAiPanelGesture(event) {
  if (!aiPanelGesture || event.pointerId !== aiPanelGesture.pointerId) return;
  const deltaX = event.clientX - aiPanelGesture.startX;
  const deltaY = event.clientY - aiPanelGesture.startY;
  const { bounds, type } = aiPanelGesture;
  if (type === "launcher") {
    aiPanelGesture.moved ||= Math.hypot(deltaX, deltaY) > 4;
    applyFloatingAiLauncherPosition({
      left: bounds.left + deltaX,
      top: bounds.top + deltaY
    });
  } else {
    applyFloatingAiPanelBounds(
      type === "move"
        ? {
            ...bounds,
            left: bounds.left + deltaX,
            top: bounds.top + deltaY
          }
        : {
            ...bounds,
            width: bounds.width + deltaX,
            height: bounds.height + deltaY
          }
    );
  }
  event.preventDefault();
}

function finishAiPanelGesture(event) {
  if (!aiPanelGesture || event.pointerId !== aiPanelGesture.pointerId) return;
  const finishedGesture = aiPanelGesture;
  aiPanelGesture = null;
  aiPanel.classList.remove("is-dragging", "is-resizing");
  if (finishedGesture.type === "launcher") {
    suppressAiPanelToggleClick = finishedGesture.moved && event.type === "pointerup";
    if (suppressAiPanelToggleClick) {
      window.setTimeout(() => {
        suppressAiPanelToggleClick = false;
      }, 0);
    }
    saveFloatingLauncherPosition(window.localStorage, state.floatingAiLauncherPosition);
  } else {
    saveFloatingPanelBounds(window.localStorage, state.floatingAiPanelBounds);
    applyDocxReadingScale();
  }
}

function applyFloatingAiPanelBounds(bounds) {
  const constrained = constrainFloatingPanelBounds(
    bounds,
    { width: window.innerWidth, height: window.innerHeight }
  );
  state.floatingAiPanelBounds = constrained;
  aiPanel.style.setProperty("--ai-panel-left", `${constrained.left}px`);
  aiPanel.style.setProperty("--ai-panel-right", "auto");
  aiPanel.style.setProperty("--ai-panel-top", `${constrained.top}px`);
  aiPanel.style.setProperty("--ai-panel-width", `${constrained.width}px`);
  aiPanel.style.setProperty("--ai-panel-height", `${constrained.height}px`);
}

function fitFloatingAiPanelToViewport() {
  if (window.innerWidth <= 760 || !state.floatingAiPanelBounds) return;
  applyFloatingAiPanelBounds(state.floatingAiPanelBounds);
  saveFloatingPanelBounds(window.localStorage, state.floatingAiPanelBounds);
}

function applyFloatingAiLauncherPosition(position) {
  const constrained = constrainFloatingLauncherPosition(
    position,
    { width: window.innerWidth, height: window.innerHeight }
  );
  state.floatingAiLauncherPosition = constrained;
  aiPanel.style.setProperty("--ai-launcher-left", `${constrained.left}px`);
  aiPanel.style.setProperty("--ai-launcher-right", "auto");
  aiPanel.style.setProperty("--ai-launcher-top", `${constrained.top}px`);
}

function fitFloatingAiLauncherToViewport() {
  if (!state.floatingAiLauncherPosition) return;
  applyFloatingAiLauncherPosition(state.floatingAiLauncherPosition);
  saveFloatingLauncherPosition(window.localStorage, state.floatingAiLauncherPosition);
}

function updateReadingSettings(changes) {
  state.readingSettings = normalizeReadingSettings({
    ...state.readingSettings,
    ...changes
  });
  applyReadingSettings();
}

function applyReadingSettings() {
  const { fontScale, contentWidth, lineHeight, theme } = state.readingSettings;
  const widthMap = { narrow: "680px", standard: "820px", wide: "1080px" };
  const lineHeightMap = { compact: 1.55, comfortable: 1.9, relaxed: 2.15 };

  reader.style.setProperty("--reader-font-scale", String(fontScale / 100));
  reader.style.setProperty("--reader-content-width", widthMap[contentWidth]);
  reader.style.setProperty("--reader-line-height", String(lineHeightMap[lineHeight]));
  document.documentElement.dataset.theme = theme;
  // 浏览器标签栏/地址栏颜色跟随主题，避免"深空内容 + 浅色外壳"的割裂
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    const themeColors = { light: "#e9efef", eye: "#e8efe8", night: "#10171c" };
    metaThemeColor.setAttribute("content", themeColors[theme] || themeColors.light);
  }
  applyDocxReadingScale();
  applyReadingSettingsToFrame(reader.querySelector(".reader-rich-frame"));

  fontScaleOutput.textContent = `${fontScale}%`;
  decreaseFontButton.disabled = fontScale <= 80;
  increaseFontButton.disabled = fontScale >= 160;
  for (const control of readingSettingsPanel.querySelectorAll("[data-reading-control]")) {
    const controlName = control.dataset.readingControl;
    const currentValue = state.readingSettings[controlName];
    for (const button of control.querySelectorAll("button[data-value]")) {
      const active = button.dataset.value === currentValue;
      button.dataset.active = String(active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = Boolean(state.docxPreview && controlName !== "theme");
    }
  }
  for (const button of rssThemeControls.querySelectorAll("button[data-rss-theme]")) {
    const active = button.dataset.rssTheme === theme;
    button.dataset.active = String(active);
    button.setAttribute("aria-pressed", String(active));
  }
  saveReadingSettings(window.localStorage, state.readingSettings);
}

function applyDocxReadingScale() {
  const host = reader.querySelector(".docx-preview-host");
  const page =
    host?.querySelector("section.docx:not([hidden])") ||
    host?.querySelector("section.docx");
  if (!host || !page) return;
  const readerStyle = getComputedStyle(reader);
  const availableWidth = Math.max(
    1,
    reader.clientWidth -
      Number.parseFloat(readerStyle.paddingLeft) -
      Number.parseFloat(readerStyle.paddingRight)
  );
  const pageWidth = page.offsetWidth || page.getBoundingClientRect().width;
  if (!pageWidth) return;
  const fitScale = Math.min(1, availableWidth / pageWidth);
  host.style.setProperty(
    "--docx-preview-zoom",
    String(fitScale * (state.readingSettings.fontScale / 100))
  );
}

function applyReadingSettingsToFrame(frame) {
  const frameDocument = frame?.contentDocument;
  if (!frameDocument?.head || !frameDocument.body) return;
  const { fontScale, contentWidth, lineHeight, theme } = state.readingSettings;
  const widthMap = { narrow: 900, standard: 1200, wide: 1440 };
  const lineHeightMap = { compact: 1.55, comfortable: 1.9, relaxed: 2.15 };
  const themeMap = {
    light: {
      background: "#ffffff",
      color: "#18211e",
      filter: "none",
      mediaFilter: "none",
      scheme: "light"
    },
    eye: {
      background: "#faf7ed",
      color: "#2c332e",
      filter: "sepia(0.1) saturate(0.94) brightness(0.98)",
      mediaFilter: "none",
      scheme: "light"
    },
    night: {
      background: "#f3f5f4",
      color: "#18211e",
      filter: "invert(0.86) hue-rotate(180deg) brightness(0.9)",
      mediaFilter: "invert(1) hue-rotate(180deg)",
      scheme: "dark"
    }
  };
  const frameTheme = themeMap[theme] || themeMap.light;
  let style = frameDocument.querySelector("#wenche-reading-settings");
  if (!style) {
    style = frameDocument.createElement("style");
    style.id = "wenche-reading-settings";
    frameDocument.head.append(style);
  }
  style.textContent = `
    html {
      background: ${frameTheme.background} !important;
      color-scheme: ${frameTheme.scheme};
      overflow-x: hidden !important;
    }
    body {
      background: ${frameTheme.background} !important;
      color: ${frameTheme.color} !important;
      box-sizing: border-box !important;
      filter: ${frameTheme.filter};
      line-height: ${lineHeightMap[lineHeight]} !important;
      margin-left: auto !important;
      margin-right: auto !important;
      max-width: none !important;
      width: auto !important;
      zoom: 1;
    }
    img { height: auto; max-width: 100%; }
    img, video, canvas, svg { filter: ${frameTheme.mediaFilter}; }
  `;

  const availableWidth = Math.max(320, frame.clientWidth - 16);
  const sourceWidth = Math.max(
    availableWidth,
    frameDocument.body.scrollWidth,
    frameDocument.documentElement.scrollWidth
  );
  const targetWidth = Math.min(availableWidth, widthMap[contentWidth]);
  const fitScale = Math.min(1, targetWidth / sourceWidth);
  const zoom = fitScale * (fontScale / 100);
  style.textContent += `
    body {
      width: ${Math.round(targetWidth / zoom)}px !important;
      zoom: ${zoom};
    }
  `;
}

function expandAiPanel() {
  if (state.immersive) setImmersive(false);
  if (!state.panels.rightCollapsed) return;
  state.panels.rightCollapsed = false;
  renderPanelState();
}

function setImmersive(immersive) {
  state.immersive = Boolean(immersive);
  appShell.classList.toggle("is-immersive", state.immersive);
  immersiveToggleButton.setAttribute("aria-pressed", String(state.immersive));
  immersiveToggleButton.title = state.immersive ? "退出沉浸阅读" : "进入沉浸阅读";
  immersiveToggleButton.setAttribute("aria-label", immersiveToggleButton.title);
  exitImmersiveButton.hidden = !state.immersive;
  if (state.immersive) readingSettingsPanel.removeAttribute("open");
  requestAnimationFrame(() => {
    applyReadingSettingsToFrame(reader.querySelector(".reader-rich-frame"));
    applyDocxReadingScale();
  });
}

function updatePanelToggle(button, options) {
  const label = options.collapsed ? options.expandLabel : options.collapseLabel;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-expanded", String(!options.collapsed));
  const icon = button.querySelector("span");
  if (icon.classList.contains("aside-toggle-icon")) {
    icon.classList.toggle("is-flipped", options.collapsed);
  } else {
    icon.textContent = options.collapsed ? options.expandIcon : options.collapseIcon;
  }
}

function updateAiStatusSurfaces(status) {
  aiStatus.classList.toggle("is-warning", !status.configured);
  if (status.provider === "mock") {
    aiStatus.textContent = "AI 接口：Mock 模式，点击配置真实模型。";
  } else {
    aiStatus.textContent = status.configured
      ? `AI 接口：${status.provider} 已配置，模型 ${status.model}`
      : `AI 接口：${status.provider} 未配置完整，点击配置。`;
  }
  if (rssAiStatus) {
    const summary = status.provider === "mock"
      ? "AI：Mock 模式，点击配置真实模型"
      : status.configured
        ? `AI：${status.provider} 已配置（${status.model}）`
        : `AI：${status.provider} 未配置完整，点击配置`;
    rssAiStatus.title = summary;
    rssAiStatus.setAttribute("aria-label", summary);
    rssAiStatus.classList.toggle("is-warning", !status.configured);
  }
}

async function loadAiStatus() {
  try {
    const response = await fetch("/api/ai/status");
    const status = await readJson(response);
    updateAiStatusSurfaces(status);
  } catch (error) {
    aiStatus.classList.add("is-warning");
    aiStatus.textContent = `AI 接口检查失败：${error.message}`;
    if (rssAiStatus) {
      rssAiStatus.title = `AI 接口检查失败：${error.message}`;
      rssAiStatus.classList.add("is-warning");
    }
  }
}

let aiProviderOptions = [];
let aiSettingsHasKey = false;
let aiSettingsClearKeyRequested = false;
let aiSettingsEnvInUse = false;

async function loadAiSettingsForm({ preserveInput = false } = {}) {
  aiSettingsStatus.textContent = preserveInput ? "正在刷新…" : "正在加载…";
  aiSettingsStatus.classList.remove("is-error");
  if (!preserveInput) {
    aiSettingsKey.value = "";
    aiSettingsClearKeyRequested = false;
    aiSettingsClearKey.disabled = false;
    aiSettingsEnvInUse = false;
  }
  try {
    const settings = await readJson(await fetch("/api/ai/settings"));
    aiProviderOptions = settings.providers || [];
    aiSettingsHasKey = Boolean(settings.hasApiKey);
    let envState = { available: false, inUse: false };
    if (window.wencheDesktop) {
      envState = await window.wencheDesktop.getAiEnvState();
      aiSettingsEnvInUse = envState.inUse === true;
      if (aiSettingsEnvInUse) aiSettingsHasKey = true;
    }
    const previousProvider = aiSettingsProvider.value;
    fillProviderSelect(settings.provider);
    if (
      preserveInput &&
      previousProvider &&
      aiSettingsProvider.querySelector(`option[value="${previousProvider}"]`)
    ) {
      aiSettingsProvider.value = previousProvider;
    }
    applyProviderDefaults(settings.provider);
    renderAiSettingsEnv(envState);
    if (settings.provider !== "mock") {
      if (settings.baseUrl) aiSettingsBase.value = settings.baseUrl;
      if (settings.model) aiSettingsModel.value = settings.model;
    }
    aiSettingsStatus.textContent = "";
  } catch (error) {
    aiStatus.classList.add("is-warning");
    aiStatus.textContent = `AI 设置加载失败：${error.message}`;
  }
}

async function openAiSettingsDialog() {
  await loadAiSettingsForm();
  openSettings("ai");
}

function fillProviderSelect(currentProvider) {
  aiSettingsProvider.innerHTML = "";
  for (const option of aiProviderOptions) {
    const element = document.createElement("option");
    element.value = option.key;
    element.textContent = option.label;
    if (option.description) element.title = option.description;
    if (option.key === currentProvider) element.selected = true;
    aiSettingsProvider.appendChild(element);
  }
  showProviderDescription(currentProvider);
}

function showProviderDescription(selectedKey) {
  const option = aiProviderOptions.find((item) => item.key === selectedKey) || null;
  aiSettingsProviderHint.textContent = option?.description || "";
}

function applyProviderDefaults(selectedKey) {
  const option = aiProviderOptions.find((item) => item.key === selectedKey) || null;
  const mockMode = selectedKey === "mock";
  aiSettingsBase.value = mockMode ? "" : option?.baseUrl || "";
  aiSettingsModel.value = mockMode ? "" : option?.model || "";
  aiSettingsBase.disabled = mockMode;
  aiSettingsModel.disabled = mockMode;
  aiSettingsKey.disabled = mockMode;
  aiSettingsKeyHint.textContent = mockMode ? "" : (aiSettingsHasKey ? "已配置，留空保持不变" : "未配置");
  aiSettingsClearKey.hidden = mockMode || !aiSettingsHasKey || aiSettingsEnvInUse;
  showProviderDescription(selectedKey);
}

function renderAiSettingsEnv(envState) {
  if (!aiSettingsEnv || !window.wencheDesktop) {
    if (aiSettingsEnv) aiSettingsEnv.hidden = true;
    return;
  }
  const available = envState.available === true;
  const inUse = envState.inUse === true;
  aiSettingsEnv.hidden = !available && !inUse;
  if (!available && !inUse) return;
  aiSettingsEnvText.textContent = inUse
    ? "当前 Key 来自环境变量（仅当前会话，不保存到本机）"
    : "检测到环境变量 AI_API_KEY（仅当前会话，不会保存到本机）";
  aiSettingsUseEnv.hidden = inUse;
}

async function useEnvAiKey() {
  if (!window.wencheDesktop) return;
  aiSettingsUseEnv.disabled = true;
  aiSettingsStatus.textContent = "正在应用环境变量 Key…";
  try {
    const result = await window.wencheDesktop.applyEnvAiConfig();
    if (!result?.accepted) {
      aiSettingsStatus.textContent = "无法应用环境变量 Key";
      aiSettingsStatus.classList.add("is-error");
      return;
    }
    aiSettingsEnvInUse = true;
    aiSettingsHasKey = true;
    // 环境变量配置可能带自己的 provider/baseUrl/model，应用后重新读取，
    // 避免对话框仍显示旧的已保存配置。
    const settings = await readJson(await fetch("/api/ai/settings"));
    fillProviderSelect(settings.provider);
    applyProviderDefaults(settings.provider);
    if (settings.provider !== "mock") {
      if (settings.baseUrl) aiSettingsBase.value = settings.baseUrl;
      if (settings.model) aiSettingsModel.value = settings.model;
    }
    renderAiSettingsEnv({ available: true, inUse: true });
    aiSettingsKeyHint.textContent = "已配置（环境变量，留空保持不变）";
    aiSettingsClearKey.hidden = true;
    aiSettingsStatus.textContent = "已应用环境变量 Key（仅当前会话，不保存到本机）";
    await loadAiStatus();
  } catch (error) {
    aiSettingsStatus.textContent = `应用失败：${error.message}`;
    aiSettingsStatus.classList.add("is-error");
  } finally {
    aiSettingsUseEnv.disabled = false;
  }
}

async function saveAiSettings() {
  const payload = {
    provider: aiSettingsProvider.value,
    apiKey: aiSettingsKey.value,
    baseUrl: aiSettingsBase.value,
    model: aiSettingsModel.value,
    clearKey: aiSettingsClearKeyRequested
  };
  aiSettingsSave.disabled = true;
  aiSettingsStatus.textContent = "正在保存…";
  try {
    const result = await readJson(await fetch("/api/ai/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }));
    closeSettings();
    await loadAiStatus();
    setStatus(`AI 接口已切换为 ${result.provider}${result.configured ? `（${result.model}）` : "，但配置不完整"}`);
  } catch (error) {
    aiSettingsStatus.textContent = `保存失败：${error.message}`;
    aiSettingsStatus.classList.add("is-error");
  } finally {
    aiSettingsSave.disabled = false;
  }
}

async function testAiConnection() {
  const payload = {
    provider: aiSettingsProvider.value,
    apiKey: aiSettingsKey.value,
    baseUrl: aiSettingsBase.value,
    model: aiSettingsModel.value
  };
  aiSettingsTest.disabled = true;
  aiSettingsStatus.textContent = "正在测试连接…";
  aiSettingsStatus.classList.remove("is-error");
  try {
    const result = await readJson(await fetch("/api/ai/settings/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }));
    aiSettingsStatus.textContent = result.message;
    aiSettingsStatus.classList.toggle("is-error", !result.ok);
  } catch (error) {
    aiSettingsStatus.textContent = `测试失败：${error.message}`;
    aiSettingsStatus.classList.add("is-error");
  } finally {
    aiSettingsTest.disabled = false;
  }
}

aiStatus.addEventListener("click", openAiSettingsDialog);
aiStatus.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openAiSettingsDialog();
  }
});
rssAiStatus?.addEventListener("click", openAiSettingsDialog);
document.addEventListener("wenche:settings-section", (event) => {
  if (
    event.detail?.section === "ai" &&
    document.querySelector("#settings-dialog")?.open
  ) {
    void loadAiSettingsForm({ preserveInput: true });
  }
});
aiSettingsProvider.addEventListener("change", () => applyProviderDefaults(aiSettingsProvider.value));
aiSettingsCancel.addEventListener("click", closeSettings);
aiSettingsTest.addEventListener("click", testAiConnection);
aiSettingsSave.addEventListener("click", saveAiSettings);
aiSettingsUseEnv?.addEventListener("click", useEnvAiKey);
aiSettingsClearKey.addEventListener("click", () => {
  aiSettingsClearKeyRequested = true;
  aiSettingsKey.value = "";
  aiSettingsKeyHint.textContent = "已选择清除，保存后生效";
  aiSettingsClearKey.disabled = true;
});
// method="dialog" 的表单在输入框按 Enter 会直接关闭对话框而不保存，
// 这里把 Enter 语义改为「保存」，避免用户以为已保存。
document.querySelector("#ai-settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveAiSettings();
});

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
  localDocumentCount.textContent = String(state.documents.length);
  const existingIds = new Set(state.documents.map((document) => Number(document.id)));
  if (
    state.lastLocalDocumentId !== null &&
    !existingIds.has(Number(state.lastLocalDocumentId))
  ) {
    state.lastLocalDocumentId = null;
  }
  if (state.lastLocalDocumentId === null) {
    const persistedDocumentId = getLastDocumentId(window.localStorage);
    if (existingIds.has(Number(persistedDocumentId))) {
      state.lastLocalDocumentId = Number(persistedDocumentId);
    }
  }
  state.selectedDocumentIds = new Set(
    [...state.selectedDocumentIds].filter((id) => existingIds.has(Number(id)))
  );
  renderArchiveControls();
  renderDocumentList();
}

async function loadDocument(
  id,
  targetPage = "saved",
  { rememberAsLocal = state.sourceMode === "local" } = {}
) {
  setBusy(true, "正在读取");
  try {
    const response = await fetch(`/api/documents/${id}`);
    const payload = await readJson(response);
    state.document = payload;
    const isVisibleLocalDocument =
      rememberAsLocal &&
      state.documents.some((document) => Number(document.id) === Number(payload.id));
    state.documentContext = isVisibleLocalDocument ? "local" : "rss";
    if (isVisibleLocalDocument) {
      state.lastLocalDocumentId = Number(payload.id);
    }
    state.docxPreview = null;
    let loadWarning = "";
    const semanticPages = payload.renderHtml
      ? [{
          number: 1,
          blocks: payload.blocks,
          blockIds: payload.blocks.map((block) => block.id)
        }]
      : paginateBlocks(payload.blocks, { charsPerPage: 2800 });
    state.pages = semanticPages;
    if (isDocxDocument(payload)) {
      setBusy(true, "正在还原 Word 排版");
      try {
        state.docxPreview = await createDocxPreview({
          documentId: payload.id,
          renderAsync: window.docx?.renderAsync
        });
        reader.classList.remove("has-rich-document");
        reader.classList.add("has-docx-preview");
        reader.replaceChildren(state.docxPreview.host);
        for (const section of state.docxPreview.sections) section.hidden = false;
        state.docxPreview.sections = paginateRenderedDocxSections(
          state.docxPreview.host,
          state.docxPreview.sections
        );
        state.docxPreview.pages = measureDocxPages(state.docxPreview.sections);
        state.pages = state.docxPreview.pages;
        assignBlockIdsByText(state.docxPreview.host, payload.blocks);
      } catch (error) {
        loadWarning = `${error.message}，已切换到阅读版`;
      }
    }
    state.selection = { text: "", blockIds: [], anchors: [] };
    aiScopeSelect.querySelector("[value='selection']").disabled = true;
    aiScopeSelect.value = "document";
    state.activeAnnotationId = null;
    state.readerQuery = "";
    state.searchMatches = [];
    state.searchMatchIndex = -1;
    state.showAllHistory = false;
    readerSearchInput.value = "";
    updateSearchControls();
    renderDocumentHeader(payload);
    const targetPageIndex = Number.isInteger(targetPage)
      ? targetPage
      : targetPage === "last"
        ? state.pages.length - 1
        : targetPage === "saved"
          ? getSavedPageIndex(window.localStorage, payload.id)
          : 0;
    applyReadingSettings();
    showPage(targetPageIndex);
    renderHistory(payload.aiRecords || []);
    renderAnnotations();
    rssController?.onDocumentLoaded(payload);
    exportCurrentButton.disabled = false;
    setStatus(loadWarning, Boolean(loadWarning));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function runAi(mode, question = "", scopeOverride = "") {
  if (!state.document) {
    setStatus("请先上传或选择文档", true);
    return;
  }
  if (mode === "custom" && !question) {
    questionInput.focus();
    return;
  }

  const controller = new AbortController();
  showAiView("analysis");
  state.aiController = controller;
  cancelAiButton.hidden = false;
  setBusy(true, "AI 正在解析");
  const scope = scopeOverride || (
    mode === "custom"
      ? aiScopeSelect.value
      : state.selection.text || state.selection.blockIds.length
        ? "selection"
        : "page"
  );
  const currentPage = state.pages[state.pageIndex];
  const selection = buildAiSelection(scope, currentPage);
  if (scope === "selection" && !selection.text && !selection.blockIds.length) {
    setStatus("请先选中文字，或把回答范围改为当前页、当前章节或全文", true);
    cancelAiButton.hidden = true;
    state.aiController = null;
    setBusy(false);
    return;
  }
  const streamingAnswer = createStreamingAnswer(mode, scope);
  try {
    const endpoint = mode === "custom" ? "/api/ai/ask" : "/api/ai/explain";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        documentId: state.document.id,
        mode,
        scope,
        selection,
        question
      })
    });
    let answer = "";
    let sources = [];
    await consumeEventStream(response, (event, payload) => {
      if (event === "start") {
        sources = payload.sources || [];
      } else if (event === "delta") {
        answer += payload.delta;
        updateStreamingAnswer(streamingAnswer, answer, sources);
      } else if (event === "done") {
        sources = payload.sources || sources;
        if (payload.answer) answer = payload.answer;
        updateStreamingAnswer(streamingAnswer, answer, sources);
      }
    });
    questionInput.value = "";
    await refreshDocumentHistory();
    setStatus("");
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("已取消 AI 解析");
      finishStreamingAnswer(streamingAnswer, "已取消", false);
    } else {
      setStatus(error.message, true);
      finishStreamingAnswer(streamingAnswer, error.message, true);
    }
  } finally {
    if (state.aiController === controller) state.aiController = null;
    cancelAiButton.hidden = true;
    setBusy(false);
  }
}

function buildAiSelection(scope, currentPage) {
  if (scope === "document") {
    return { text: "", blockIds: [], anchors: [], pageIndex: null };
  }
  if (scope === "page") {
    return {
      text: "",
      blockIds: currentPage?.blockIds || [],
      anchors: [],
      pageIndex: state.pageIndex
    };
  }
  if (scope === "section" && !state.selection.blockIds.length) {
    return {
      text: "",
      blockIds: currentPage?.blockIds || [],
      anchors: [],
      pageIndex: state.pageIndex
    };
  }
  return {
    text: state.selection.text || "",
    blockIds: state.selection.blockIds || [],
    anchors: state.selection.anchors || [],
    pageIndex: state.selection.pageIndex ?? state.pageIndex
  };
}

function createStreamingAnswer(mode, scope) {
  answerHistory.open = true;
  answerSummary.textContent = "正在生成回答";
  answerCount.textContent = String((state.document?.aiRecords?.length || 0) + 1);
  if (!answerList.querySelector(".answer-item")) answerList.replaceChildren();
  const item = document.createElement("section");
  item.className = "answer-item is-streaming";
  item.dataset.mode = mode;
  const header = document.createElement("div");
  header.className = "answer-item-header";
  const title = document.createElement("strong");
  title.textContent = `${modeLabel(mode)} · ${scopeLabel(scope)} · 正在生成`;
  const signal = document.createElement("span");
  signal.className = "streaming-signal";
  signal.setAttribute("aria-label", "AI 正在生成回答");
  header.append(title, signal);
  const body = document.createElement("div");
  body.className = "answer-body streaming-answer-body";
  body.textContent = "正在连接模型…";
  item.append(header, body);
  answerList.prepend(item);
  return { item, title, body, signal, frame: null, pendingAnswer: "", pendingSources: [] };
}

function updateStreamingAnswer(streamingAnswer, answer, sources = []) {
  streamingAnswer.pendingAnswer = answer;
  streamingAnswer.pendingSources = sources;
  if (streamingAnswer.frame) return;
  streamingAnswer.frame = requestAnimationFrame(() => {
    streamingAnswer.frame = null;
    const nearBottom =
      answerList.scrollHeight - answerList.scrollTop - answerList.clientHeight < 100;
    streamingAnswer.body.innerHTML = renderMarkdown(
      formatAnswerCitations(
        streamingAnswer.pendingAnswer,
        streamingAnswer.pendingSources
      )
    );
    if (nearBottom) answerList.scrollTop = answerList.scrollHeight;
  });
}

function finishStreamingAnswer(streamingAnswer, message, isError) {
  streamingAnswer.item.classList.remove("is-streaming");
  streamingAnswer.item.classList.toggle("is-stream-error", isError);
  streamingAnswer.signal.remove();
  streamingAnswer.title.textContent = message;
  if (!streamingAnswer.body.textContent.trim() || streamingAnswer.body.textContent === "正在连接模型…") {
    streamingAnswer.body.textContent = message;
  }
}

async function runAiForCurrentPage(mode) {
  if (!state.document) {
    setStatus("请先上传或选择文档", true);
    return;
  }

  aiScopeSelect.value = "page";
  await runAi(mode, "", "page");
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
  renderAnnotations();
}

function renderDocumentList() {
  const visibleDocuments = getVisibleDocuments();
  if (visibleDocuments.length === 0) {
    documentList.replaceChildren(
      emptyText(
        state.documents.length === 0
          ? "暂无文档"
          : state.archiveFilter
            ? "该文件夹中暂无文档"
            : "没有匹配的文档"
      )
    );
    updateSelectionActions();
    return;
  }

  const groups = groupDocuments(visibleDocuments, state.sortMode);
  documentList.replaceChildren(
    ...groups.map((group) => {
      const section = document.createElement("details");
      section.className = "document-group";
      const activeCategory = state.document?.category?.trim() || "未分类";
      bindDisclosureState(section, `local-group:${group.category}`, {
        defaultOpen:
          group.category === activeCategory ||
          group.category === state.archiveFilter ||
          groups.length === 1
      });

      const heading = document.createElement("summary");
      const headingLabel = document.createElement("span");
      headingLabel.textContent = categoryLabel(group.category);
      const headingCount = document.createElement("span");
      headingCount.className = "document-group-count";
      headingCount.textContent = String(group.documents.length);
      heading.append(headingLabel, headingCount);

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

  archiveStatus.textContent = "正在移动文档";
  archiveStatus.classList.remove("is-error", "is-success");
  setBusy(true, `正在移动 ${ids.length} 篇文档`);
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
    archiveStatus.textContent = `已移动到“${categoryLabel(category)}”`;
    archiveStatus.classList.add("is-success");
    setStatus(`已将 ${ids.length} 篇文档移动到“${categoryLabel(category)}”`);
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

  archiveStatus.textContent = "正在创建文件夹";
  archiveStatus.classList.remove("is-error", "is-success");
  setBusy(true, "正在创建文件夹");
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
    archiveStatus.textContent = `已创建文件夹“${archive.name}”`;
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
  const name = window.prompt("输入新的文件夹名称", archive.name)?.trim();
  if (!name || name === archive.name) return;

  setBusy(true, "正在重命名文件夹");
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
    archiveStatus.textContent = "请先移动或删除该文件夹中的文档";
    archiveStatus.className = "archive-status is-error";
    return;
  }
  if (!window.confirm(`确定删除空文件夹“${archive.name}”吗？`)) return;

  setBusy(true, "正在删除文件夹");
  try {
    const response = await fetch(`/api/archives/${archive.id}`, {
      method: "DELETE"
    });
    await readJson(response);
    if (state.archiveFilter === archive.name) state.archiveFilter = "";
    archiveCategoryInput.value = "";
    await loadDocumentList();
    archiveStatus.textContent = `已删除文件夹“${archive.name}”`;
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
    createOption("", "移动到文件夹…"),
    createOption("未分类", "无文件夹"),
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
    createArchiveLocation("", "全部文档", state.documents.length),
    createArchiveLocation("未分类", "无文件夹", unclassifiedCount),
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

function categoryLabel(category) {
  return category === "未分类" ? "无文件夹" : category;
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
  deleteSelectedButton.textContent = count > 0 ? `批量删除 (${count})` : "批量删除";
  selectVisibleButton.disabled = state.busy || visibleIds.length === 0;
  selectVisibleButton.textContent = allVisibleSelected ? "取消选择" : "选择当前列表";
  archiveSelectedButton.disabled =
    state.busy || archiveIds.length === 0 || !archiveCategoryInput.value.trim();
  archiveSelectedButton.textContent = count > 0
    ? `移动 (${count})`
    : state.document
      ? "移动当前文档"
      : "移动";
  createArchiveButton.disabled = state.busy || !newArchiveNameInput.value.trim();
  const archive = selectedArchive();
  renameArchiveButton.disabled = state.busy || !archive;
  deleteArchiveButton.disabled =
    state.busy || !archive || archive.documentCount > 0;
}

function clearDocumentView() {
  state.document = null;
  state.documentContext = null;
  state.pages = [];
  state.docxPreview = null;
  state.pageIndex = 0;
  state.selection = { text: "", blockIds: [], anchors: [] };
  state.readerQuery = "";
  state.searchMatches = [];
  state.searchMatchIndex = -1;
  readerSearchInput.value = "";
  applyReadingSettings();
  readerTitle.textContent = "上传一篇文章开始阅读";
  reader.replaceChildren();
  if (coldStartCard) coldStartCard.hidden = false;
  renderHistory([]);
  renderAnnotations();
  exportCurrentButton.disabled = true;
  renderDocumentList();
  updatePaginationControls();
  updateSearchControls();
}

async function restoreLocalDocumentContext() {
  const localDocument = state.documents.find(
    (document) => Number(document.id) === Number(state.lastLocalDocumentId)
  );
  clearDocumentView();
  if (localDocument) {
    await loadDocument(localDocument.id, "saved", { rememberAsLocal: true });
  }
}

function saveCurrentReadingProgress() {
  if (!state.document) return;
  saveReadingProgress(
    window.localStorage,
    state.document.id,
    state.pageIndex,
    { rememberDocument: state.documentContext === "local" }
  );
}

function renderDocumentHeader(documentData) {
  readerTitle.textContent = documentData.title;
  if (coldStartCard) coldStartCard.hidden = true;
  renderDocumentList();
}

function showPage(pageIndex, { preserveScroll = false } = {}) {
  if (state.pages.length === 0) return;
  const previousScrollTop = reader.scrollTop;
  state.pageIndex = Math.min(Math.max(pageIndex, 0), state.pages.length - 1);
  state.selection = { text: "", blockIds: [], anchors: [] };
  state.activeAnnotationId = null;
  selectionMenu.hidden = true;

  if (state.docxPreview) {
    renderDocxPage({ preserveScroll });
    saveCurrentReadingProgress();
    updatePaginationControls();
    return;
  }

  if (state.document.renderHtml) {
    renderRichHtmlDocument();
    saveCurrentReadingProgress();
    updatePaginationControls();
    return;
  }

  reader.classList.remove("has-rich-document", "has-docx-preview");
  const page = state.pages[state.pageIndex];
  reader.replaceChildren(
    ...page.blocks.map((block) => {
      const tag = block.html ? "div" : block.type === "heading" ? "h3" : "p";
      const element = document.createElement(tag);
      element.className = `doc-block doc-${block.type}`;
      element.dataset.blockId = block.id;
      if (block.html) {
        element.innerHTML = window.DOMPurify.sanitize(block.html);
        if (block.type === "heading") {
          const heading = element.querySelector("h1, h2, h3, h4, h5, h6");
          if (heading) element.dataset.headingLevel = heading.tagName.slice(1);
        }
      } else {
        element.textContent = block.text;
      }
      return element;
    })
  );
  reader.scrollTop = preserveScroll ? previousScrollTop : 0;
  highlightReaderMatches();
  applySavedAnnotations(reader);
  saveCurrentReadingProgress();
  updatePaginationControls();
}

function renderDocxPage({ preserveScroll = false } = {}) {
  reader.classList.remove("has-rich-document");
  reader.classList.add("has-docx-preview");
  const { host, sections } = state.docxPreview;
  const page = state.pages[state.pageIndex];
  const sectionIndex = page?.sectionIndex ?? state.pageIndex;
  for (const [index, section] of sections.entries()) {
    section.hidden = index !== sectionIndex;
  }
  if (reader.firstElementChild !== host) reader.replaceChildren(host);
  const currentSection = sections[sectionIndex];
  clearInlineMarks(currentSection, ".reader-search-hit");
  clearAnnotationDecorations(currentSection);
  applySavedAnnotations(currentSection);
  highlightReaderMatches();
  applyReadingSettings();
  if (!preserveScroll) {
    const zoom = state.readingSettings.fontScale / 100;
    reader.scrollTop = (page?.offsetTop || 0) * zoom;
  }
}

function syncDocxPageFromScroll() {
  if (!state.docxPreview || state.pages.length === 0) return;
  if (state.docxScrollFrame) cancelAnimationFrame(state.docxScrollFrame);
  state.docxScrollFrame = requestAnimationFrame(() => {
    state.docxScrollFrame = null;
    const currentPage = state.pages[state.pageIndex];
    if (!currentPage) return;
    const zoom = state.readingSettings.fontScale / 100;
    const sectionPageIndex = Math.min(
      currentPage.sectionPageCount - 1,
      Math.max(0, Math.floor((reader.scrollTop / zoom + 1) / currentPage.pageHeight))
    );
    const nextPageIndex = state.pages.findIndex(
      (page) =>
        page.sectionIndex === currentPage.sectionIndex &&
        page.sectionPageIndex === sectionPageIndex
    );
    if (nextPageIndex < 0 || nextPageIndex === state.pageIndex) return;
    state.pageIndex = nextPageIndex;
    saveCurrentReadingProgress();
    updatePaginationControls();
  });
}

function renderRichHtmlDocument() {
  reader.classList.remove("has-docx-preview");
  reader.classList.add("has-rich-document");
  const frame = document.createElement("iframe");
  frame.className = "reader-rich-frame";
  frame.title = state.document.title;
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.srcdoc = state.document.renderHtml;
  frame.addEventListener("load", () => {
    const frameDocument = frame.contentDocument;
    if (!frameDocument) return;
    assignBlockIdsByText(frameDocument.body, state.document.blocks);
    frameDocument.addEventListener("mouseup", () => {
      setTimeout(() => captureFrameSelection(frame), 0);
    });
    frameDocument.addEventListener("mousedown", () => {
      selectionMenu.hidden = true;
      state.selection = { text: "", blockIds: [], anchors: [] };
      aiScopeSelect.querySelector("[value='selection']").disabled = true;
      if (aiScopeSelect.value === "selection") aiScopeSelect.value = "document";
      state.activeAnnotationId = null;
    });
    frameDocument.addEventListener("click", (event) => {
      const mark = event.target?.closest?.("[data-annotation-id]");
      if (mark) {
        showAnnotationMenu(mark, frame);
        return;
      }
      handleRichDocumentLink(event, frame);
    });
    if (state.readerQuery) {
      frame.contentWindow?.find(state.readerQuery, false, false, true);
    }
    applyReadingSettingsToFrame(frame);
    applySavedAnnotations(frameDocument.body, frameDocument);
  });
  reader.replaceChildren(frame);
}

function highlightReaderMatches() {
  if (!state.readerQuery || state.searchMatches.length === 0) return;

  const activeMatch = state.searchMatches[state.searchMatchIndex];
  const pageMatches = state.searchMatches.filter(
    (match) => match.pageIndex === state.pageIndex
  );
  if (state.docxPreview) {
    const sectionIndex = state.pages[state.pageIndex]?.sectionIndex ?? state.pageIndex;
    const marks = highlightTextNodes(
      state.docxPreview.sections[sectionIndex],
      state.readerQuery
    );
    const activeOccurrence = pageMatches.findIndex((match) => match === activeMatch);
    if (activeOccurrence >= 0 && marks[activeOccurrence]) {
      marks[activeOccurrence].classList.add("is-active");
      marks[activeOccurrence].scrollIntoView({ block: "center" });
    }
    return;
  }
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

function clearInlineMarks(root, selector) {
  if (!root) return;
  for (const mark of root.querySelectorAll(selector)) {
    const parent = mark.parentNode;
    mark.replaceWith(...mark.childNodes);
    parent?.normalize();
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

  const range = selection.getRangeAt(0);
  const rangeRect = range.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const anchors = buildRangeAnchors(range, frame.contentDocument.body);
  const blockIds = anchors.length > 0
    ? anchors.map((anchor) => anchor.blockId)
    : findBlockIdsByText(state.document.blocks, text);

  showSelectionMenu({
    text,
    blockIds,
    anchors,
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
  rssController?.onReaderPageChanged(state.pageIndex, total);
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
  pageIndicator.textContent = state.document?.sourceType === "rss"
    ? `第 ${current} / ${total} 页`
    : state.document
      ? `文档 ${documentIndex + 1}/${categoryDocuments.length} · 页 ${current}/${total}`
      : `页 ${current}/${total}`;

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
  bookmarkPageButton.disabled = state.busy || !state.document;
  const bookmark = state.document?.annotations?.find(
    (annotation) => annotation.kind === "bookmark" && annotation.pageIndex === state.pageIndex
  );
  bookmarkPageButton.classList.toggle("is-active", Boolean(bookmark));
  bookmarkPageButton.setAttribute("aria-pressed", String(Boolean(bookmark)));
  bookmarkPageButton.title = bookmark ? "取消当前页书签" : "收藏当前页";
  bookmarkPageButton.setAttribute("aria-label", bookmarkPageButton.title);
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
  answerCount.textContent = String(recordList.length);
  answerSummary.textContent = recordList.length
    ? `最近显示 ${visibleRecords.length} 条`
    : "暂无记录";
  if (!visibleRecords.length) {
    answerHistory.open = false;
    answerList.replaceChildren(emptyText("暂无解析记录"));
    return;
  }

  answerList.replaceChildren(
    ...visibleRecords.map((record) =>
      createAnswerElement(record)
    )
  );
}

function createAnswerElement(record) {
  const item = document.createElement("section");
  item.className = "answer-item";
  item.dataset.mode = record.mode;

  const header = document.createElement("div");
  header.className = "answer-item-header";
  const title = document.createElement("strong");
  title.textContent = modeLabel(record.mode);
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.dataset.saveRecord = record.id;
  saveButton.textContent = record.saved ? "已沉淀" : "沉淀";
  saveButton.title = record.saved ? "在沉淀视图中查看" : "保存这条回答";
  header.append(title, saveButton);

  const body = document.createElement("div");
  body.className = "answer-body";
  body.innerHTML = renderMarkdown(
    formatAnswerCitations(record.answer, record.contextSources)
  );

  const meta = document.createElement("small");
  meta.textContent = formatAnswerMeta(record);

  item.append(header, body, createAnswerReferences(record), meta);
  return item;
}

function createAnswerReferences(record) {
  const isCurrentDocument = Number(record.documentId || state.document?.id) === Number(state.document?.id);
  const references = resolveAnswerReferences(
    record,
    isCurrentDocument ? state.document?.blocks || [] : [],
    isCurrentDocument ? state.pages : []
  );
  const group = document.createElement("div");
  group.className = "answer-references";
  if (references.length === 0) {
    group.hidden = true;
    return group;
  }
  const label = document.createElement("span");
  label.textContent = "原文定位";
  group.append(label);
  for (const reference of references) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.answerReference = "";
    button.dataset.documentId = record.documentId || state.document?.id || "";
    button.dataset.pageIndex = String(reference.pageIndex);
    button.dataset.blockId = reference.blockId ?? "";
    button.dataset.selectedText = String(record.selectedText || "").slice(0, 160);
    button.textContent = reference.label;
    group.append(button);
  }
  return group;
}

async function navigateToAnswerReference(button) {
  const documentId = Number(button.dataset.documentId);
  const pageIndex = Math.max(0, Number(button.dataset.pageIndex) || 0);
  const blockId = Number(button.dataset.blockId) || null;
  if (!state.document || Number(state.document.id) !== documentId) {
    await loadDocument(documentId, pageIndex);
  } else {
    showPage(pageIndex);
  }
  requestAnimationFrame(() => flashAnswerReference(blockId));
}

function flashAnswerReference(blockId) {
  const richFrame = reader.querySelector(".reader-rich-frame");
  const target = blockId
    ? reader.querySelector(`[data-block-id="${blockId}"]`) ||
      richFrame?.contentDocument?.querySelector(`[data-block-id="${blockId}"]`)
    : state.docxPreview
      ? reader.querySelector("section.docx:not([hidden])")
      : richFrame || reader;
  if (!target) return;
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.classList.add("is-citation-target");
  window.setTimeout(() => target.classList.remove("is-citation-target"), 1800);
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
  const anchors = buildRangeAnchors(range, reader);
  const rect = range.getBoundingClientRect();

  showSelectionMenu({
    text,
    blockIds: anchors.length > 0
      ? anchors.map((anchor) => anchor.blockId)
      : blockIds,
    anchors,
    rect
  });
}

function showSelectionMenu({ text, blockIds, anchors = [], rect }) {
  state.selection = {
    text,
    blockIds: [...new Set(blockIds)],
    anchors,
    pageIndex: state.pageIndex
  };
  aiScopeSelect.querySelector("[value='selection']").disabled = false;
  aiScopeSelect.value = "selection";
  state.activeAnnotationId = null;
  selectionMenu.dataset.mode = "selection";
  positionSelectionMenu(rect);
}

function showAnnotationMenu(target, frame = null) {
  const annotationId = Number(target.dataset.annotationId);
  const annotation = state.document?.annotations?.find(
    (item) => Number(item.id) === annotationId
  );
  if (!annotation) return;
  const targetRect = target.getBoundingClientRect();
  const frameRect = frame?.getBoundingClientRect();
  const rect = frameRect
    ? {
        left: frameRect.left + targetRect.left,
        width: targetRect.width,
        bottom: frameRect.top + targetRect.bottom
      }
    : targetRect;
  state.activeAnnotationId = annotationId;
  state.selection = {
    text: annotation.selectedText || "",
    blockIds: annotation.blockIds || [],
    anchors: [],
    pageIndex: annotation.pageIndex
  };
  aiScopeSelect.querySelector("[value='selection']").disabled = false;
  selectionMenu.dataset.mode = "annotation";
  const removeButton = selectionMenu.querySelector("[data-action='remove-annotation']");
  removeButton.textContent = annotation.kind === "highlight" ? "取消高亮" : "删除批注";
  positionSelectionMenu(rect);
}

function positionSelectionMenu(rect) {
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

function showAiView(view) {
  state.aiView = view === "knowledge" ? "knowledge" : "analysis";
  const showingKnowledge = state.aiView === "knowledge";
  analysisView.hidden = showingKnowledge;
  knowledgeView.hidden = !showingKnowledge;
  analysisTab.setAttribute("aria-selected", String(!showingKnowledge));
  knowledgeTab.setAttribute("aria-selected", String(showingKnowledge));
  analysisTab.dataset.active = String(!showingKnowledge);
  knowledgeTab.dataset.active = String(showingKnowledge);
  if (showingKnowledge) renderAnnotations();
}

function openAnnotationDialog() {
  if (!state.selection.text) return;
  state.pendingAnnotation = {
    text: state.selection.text,
    blockIds: [...state.selection.blockIds]
  };
  annotationExcerpt.textContent = state.selection.text.slice(0, 260);
  annotationNote.value = "";
  annotationDialog.showModal();
  annotationNote.focus();
}

async function createAnnotation(kind, note = "", sourceSelection = null) {
  if (!state.document) return;
  const selection = sourceSelection || state.selection;
  setBusy(true, kind === "note" ? "正在保存批注" : "正在保存高亮");
  try {
    const response = await fetch("/api/annotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentId: state.document.id,
        kind,
        pageIndex: state.pageIndex,
        selectedText: selection.text,
        blockIds: selection.blockIds,
        note,
        color: "yellow"
      })
    });
    const annotation = await readJson(response);
    state.document.annotations = [annotation, ...(state.document.annotations || [])];
    refreshCurrentAnnotations();
    renderAnnotations();
    setStatus(kind === "note" ? "批注已保存" : "高亮已保存");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function togglePageBookmark() {
  if (!state.document) return;
  const bookmark = state.document.annotations?.find(
    (annotation) => annotation.kind === "bookmark" && annotation.pageIndex === state.pageIndex
  );
  if (bookmark) {
    await deleteAnnotation(bookmark.id);
    return;
  }
  setBusy(true, "正在保存书签");
  try {
    const response = await fetch("/api/annotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentId: state.document.id,
        kind: "bookmark",
        pageIndex: state.pageIndex,
        selectedText: "",
        blockIds: state.pages[state.pageIndex]?.blockIds || []
      })
    });
    const annotation = await readJson(response);
    state.document.annotations = [annotation, ...(state.document.annotations || [])];
    renderAnnotations();
    updatePaginationControls();
    setStatus("书签已保存");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function updateAnnotation(id, note) {
  setBusy(true, "正在更新批注");
  try {
    const response = await fetch(`/api/annotations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note })
    });
    const updated = await readJson(response);
    state.document.annotations = state.document.annotations.map((annotation) =>
      Number(annotation.id) === Number(id) ? updated : annotation
    );
    renderAnnotations();
    setStatus("标注已更新");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function deleteAnnotation(id) {
  setBusy(true, "正在删除标注");
  try {
    const response = await fetch(`/api/annotations/${id}`, { method: "DELETE" });
    await readJson(response);
    state.document.annotations = state.document.annotations.filter(
      (annotation) => Number(annotation.id) !== Number(id)
    );
    refreshCurrentAnnotations();
    renderAnnotations();
    setStatus("标注已删除");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function renderAnnotations() {
  const annotations = state.document?.annotations || [];
  annotationSection.hidden = annotations.length === 0;
  if (annotations.length === 0) {
    annotationList.replaceChildren(emptyText(state.document ? "当前文章暂无标注" : "请先选择文章"));
    return;
  }
  annotationList.replaceChildren(...annotations.map(createAnnotationElement));
}

function createAnnotationElement(annotation) {
  const item = document.createElement("article");
  item.className = "knowledge-item";
  item.dataset.kind = annotation.kind;

  const header = document.createElement("div");
  header.className = "knowledge-item-header";
  const title = document.createElement("strong");
  title.textContent = annotationKindLabel(annotation.kind);
  const jump = document.createElement("button");
  jump.type = "button";
  jump.dataset.annotationAction = "jump";
  jump.dataset.annotationId = annotation.id;
  jump.textContent = `第 ${annotation.pageIndex + 1} 页`;
  header.append(title, jump);
  item.append(header);

  if (annotation.selectedText) {
    const excerpt = document.createElement("blockquote");
    excerpt.textContent = annotation.selectedText;
    item.append(excerpt);
  }

  const note = document.createElement("textarea");
  note.rows = 3;
  note.maxLength = 20000;
  note.placeholder = annotation.kind === "bookmark" ? "添加书签备注" : "补充笔记";
  note.value = annotation.note || "";
  item.append(note);

  const actions = document.createElement("div");
  actions.className = "knowledge-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.dataset.annotationAction = "save";
  save.dataset.annotationId = annotation.id;
  save.textContent = "保存";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.dataset.annotationAction = "delete";
  remove.dataset.annotationId = annotation.id;
  remove.textContent = "删除";
  actions.append(save, remove);
  item.append(actions);
  return item;
}

async function loadKnowledgeItems() {
  try {
    const response = await fetch("/api/knowledge");
    const payload = await readJson(response);
    state.knowledgeItems = payload.items || [];
    renderKnowledgeItems();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderKnowledgeItems() {
  if (state.knowledgeItems.length === 0) {
    knowledgeList.replaceChildren(emptyText("还没有沉淀 AI 回答"));
    return;
  }
  knowledgeList.replaceChildren(...state.knowledgeItems.map(createKnowledgeElement));
}

function createKnowledgeElement(record) {
  const item = document.createElement("article");
  item.className = "knowledge-item";

  const title = document.createElement("input");
  title.type = "text";
  title.maxLength = 160;
  title.value = record.savedTitle || defaultKnowledgeTitle(record);
  title.dataset.knowledgeTitle = "";

  const source = document.createElement("small");
  source.textContent = `${record.documentTitle} · ${modeLabel(record.mode)}`;

  if (record.selectedText) {
    const excerpt = document.createElement("blockquote");
    excerpt.textContent = record.selectedText;
    item.append(title, source, excerpt);
  } else {
    item.append(title, source);
  }

  const answer = document.createElement("div");
  answer.className = "knowledge-answer answer-body";
  answer.innerHTML = renderMarkdown(record.answer);
  const references = createAnswerReferences(record);

  const note = document.createElement("textarea");
  note.rows = 3;
  note.maxLength = 20000;
  note.placeholder = "补充自己的理解或后续行动";
  note.value = record.savedNote || "";
  note.dataset.knowledgeNote = "";

  const actions = document.createElement("div");
  actions.className = "knowledge-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.dataset.knowledgeAction = "save";
  save.dataset.recordId = record.id;
  save.textContent = "保存修改";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.dataset.knowledgeAction = "remove";
  remove.dataset.recordId = record.id;
  remove.textContent = "移出沉淀";
  actions.append(save, remove);
  item.append(answer, references, note, actions);
  return item;
}

async function saveAiRecord(record, values) {
  setBusy(true, values.saved ? "正在保存沉淀" : "正在移出沉淀");
  try {
    const response = await fetch(`/api/ai/records/${record.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values)
    });
    const updated = await readJson(response);
    if (state.document && Number(record.documentId || state.document.id) === Number(state.document.id)) {
      state.document.aiRecords = state.document.aiRecords.map((item) =>
        Number(item.id) === Number(updated.id) ? updated : item
      );
      renderHistory(state.document.aiRecords);
    }
    await loadKnowledgeItems();
    setStatus(values.saved ? "AI 回答已沉淀" : "已移出沉淀");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function defaultKnowledgeTitle(record) {
  const excerpt = String(record.selectedText || record.question || "").replace(/\s+/g, " ").trim();
  return excerpt ? `${modeLabel(record.mode)} · ${excerpt.slice(0, 42)}` : modeLabel(record.mode);
}

function annotationKindLabel(kind) {
  return kind === "note" ? "批注" : kind === "bookmark" ? "书签" : "高亮";
}

function applySavedAnnotations(root, ownerDocument = document) {
  const annotations = (state.document?.annotations || []).filter(
    (annotation) => annotation.kind !== "bookmark" && annotationBelongsToRoot(annotation, root)
  );
  for (const annotation of annotations) {
    if (root === reader && annotation.blockIds?.length) {
      const blocks = annotation.blockIds
        .map((id) => root.querySelector(`[data-block-id="${id}"]`))
        .filter(Boolean);
      if (blocks.length === 1 && annotation.selectedText) {
        const highlighted = highlightExactText(
          blocks[0],
          annotation.selectedText,
          annotation.color,
          ownerDocument,
          annotation.id
        );
        if (!highlighted) {
          blocks[0].classList.add("has-saved-highlight");
          blocks[0].dataset.annotationId = String(annotation.id);
        }
      } else {
        for (const block of blocks) {
          block.classList.add("has-saved-highlight");
          block.dataset.annotationId = String(annotation.id);
        }
      }
      for (const block of blocks) {
        if (annotation.kind === "note") block.classList.add("has-saved-note");
        if (annotation.note) block.title = annotation.note;
      }
      continue;
    }
    if (annotation.selectedText) {
      highlightExactText(
        root,
        annotation.selectedText,
        annotation.color,
        ownerDocument,
        annotation.id
      );
    }
  }
}

function annotationBelongsToRoot(annotation, root) {
  if (!state.docxPreview) return annotation.pageIndex === state.pageIndex;
  const currentPage = state.pages[state.pageIndex];
  const annotationPage = state.pages[annotation.pageIndex];
  const currentSection = state.docxPreview.sections[currentPage?.sectionIndex];
  return root === currentSection && annotationPage?.sectionIndex === currentPage?.sectionIndex;
}

function refreshCurrentAnnotations() {
  const frame = reader.querySelector(".reader-rich-frame");
  if (frame?.contentDocument?.body) {
    const scrollX = frame.contentWindow?.scrollX || 0;
    const scrollY = frame.contentWindow?.scrollY || 0;
    clearAnnotationDecorations(frame.contentDocument.body);
    applySavedAnnotations(frame.contentDocument.body, frame.contentDocument);
    frame.contentWindow?.scrollTo(scrollX, scrollY);
    return;
  }

  const scrollTop = reader.scrollTop;
  const root = state.docxPreview
    ? state.docxPreview.sections[state.pages[state.pageIndex]?.sectionIndex]
    : reader;
  clearAnnotationDecorations(root);
  applySavedAnnotations(root);
  reader.scrollTop = scrollTop;
}

function clearAnnotationDecorations(root) {
  if (!root) return;
  clearInlineMarks(root, ".saved-highlight");
  for (const element of root.querySelectorAll(
    ".has-saved-highlight, .has-saved-note, [data-annotation-id]"
  )) {
    element.classList.remove("has-saved-highlight", "has-saved-note");
    element.removeAttribute("data-annotation-id");
    if (element.classList.contains("doc-block")) element.removeAttribute("title");
  }
}

function highlightExactText(root, selectedText, color, ownerDocument, annotationId) {
  const needle = String(selectedText).trim();
  if (!needle) return false;
  const showText = ownerDocument.defaultView?.NodeFilter?.SHOW_TEXT || NodeFilter.SHOW_TEXT;
  const walker = ownerDocument.createTreeWalker(root, showText);
  const nodes = [];
  let combinedText = "";
  while (walker.nextNode()) {
    const node = walker.currentNode;
    nodes.push({ node, start: combinedText.length });
    combinedText += node.nodeValue || "";
  }
  const matchStart = combinedText.indexOf(needle);
  if (matchStart < 0) return false;
  const matchEnd = matchStart + needle.length;
  const startEntry = [...nodes].reverse().find((entry) => entry.start <= matchStart);
  const endEntry = [...nodes].reverse().find((entry) => entry.start < matchEnd);
  if (!startEntry || !endEntry) return false;

  const range = ownerDocument.createRange();
  range.setStart(startEntry.node, matchStart - startEntry.start);
  range.setEnd(endEntry.node, matchEnd - endEntry.start);
  const mark = ownerDocument.createElement("mark");
  mark.className = "saved-highlight";
  mark.dataset.color = color || "yellow";
  mark.dataset.annotationId = String(annotationId);
  mark.append(range.extractContents());
  range.insertNode(mark);
  return true;
}

function downloadFrom(url) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}

async function restoreBackup(file) {
  if (!window.confirm("恢复会替换当前全部文章、标注和 AI 记录。确定继续吗？")) return;
  setBusy(true, "正在恢复备份");
  try {
    const snapshot = JSON.parse(await file.text());
    const response = await fetch("/api/backup/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot)
    });
    const result = await readJson(response);
    clearDocumentView();
    await loadDocumentList();
    if (state.documents[0]) await loadDocument(state.documents[0].id, "first");
    await loadKnowledgeItems();
    setStatus(`已恢复 ${result.documentCount} 篇文章`);
  } catch (error) {
    setStatus(`恢复失败：${error.message}`, true);
  } finally {
    setBusy(false);
  }
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

function scopeLabel(scope) {
  if (scope === "page") return "当前页";
  if (scope === "section") return "当前章节";
  if (scope === "document") return "全文";
  return "选区";
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

void initializeReader();
