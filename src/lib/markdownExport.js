const ANNOTATION_LABELS = Object.freeze({
  highlight: "高亮",
  note: "批注",
  bookmark: "书签"
});

const MODE_LABELS = Object.freeze({
  direct: "解析",
  deep: "深入解析",
  custom: "自定义提问"
});

export function buildReadingMarkdown({ documents, annotations, aiRecords, createdAt }) {
  const lines = [
    "# 文澈阅读沉淀",
    "",
    `导出时间：${formatDate(createdAt)}`,
    ""
  ];

  for (const document of documents) {
    const documentAnnotations = annotations.filter(
      (annotation) => Number(annotation.documentId) === Number(document.id)
    );
    const savedAnswers = aiRecords.filter(
      (record) => Number(record.documentId) === Number(document.id) && record.saved
    );
    if (documentAnnotations.length === 0 && savedAnswers.length === 0) continue;

    lines.push(`# ${document.title}`, "");
    lines.push(`- 归档：${document.category || "未分类"}`);
    lines.push(`- 原文件：${document.originalName}`);
    lines.push("");

    if (documentAnnotations.length > 0) {
      lines.push("## 阅读标注", "");
      for (const annotation of documentAnnotations) {
        const label = ANNOTATION_LABELS[annotation.kind] || "标注";
        lines.push(`### ${label} · 第 ${Number(annotation.pageIndex) + 1} 页`, "");
        if (annotation.selectedText) {
          lines.push(...quoteMarkdown(annotation.selectedText), "");
        }
        if (annotation.note) lines.push(annotation.note, "");
        lines.push(`记录时间：${formatDate(annotation.createdAt)}`, "");
      }
    }

    if (savedAnswers.length > 0) {
      lines.push("## AI 回答沉淀", "");
      for (const record of savedAnswers) {
        lines.push(`### ${record.savedTitle || MODE_LABELS[record.mode] || "AI 回答"}`, "");
        if (record.selectedText) {
          lines.push("原文选区：", "", ...quoteMarkdown(record.selectedText), "");
        }
        if (record.question) lines.push(`问题：${record.question}`, "");
        lines.push(record.answer.trim(), "");
        if (record.savedNote) lines.push(`补充笔记：${record.savedNote}`, "");
        lines.push(`沉淀时间：${formatDate(record.savedAt || record.createdAt)}`, "");
      }
    }
  }

  if (lines.length === 4) {
    lines.push("当前范围内还没有阅读标注或已沉淀的 AI 回答。", "");
  }
  return `${lines.join("\n").trim()}\n`;
}

function quoteMarkdown(value) {
  return String(value)
    .split(/\r?\n/)
    .map((line) => `> ${line}`);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || "") : date.toISOString();
}
