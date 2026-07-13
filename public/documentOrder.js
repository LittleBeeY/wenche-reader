const collator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base"
});

export function filterDocuments(documents, query = "") {
  const normalizedQuery = String(query).trim().toLocaleLowerCase("zh-CN");
  if (!normalizedQuery) return documents || [];

  return (documents || []).filter((document) =>
    [document.title, document.originalName, document.category].some((value) =>
      String(value || "").toLocaleLowerCase("zh-CN").includes(normalizedQuery)
    )
  );
}

export function getArchiveDocumentIds(selectedIds, currentDocumentId) {
  const selected = [...(selectedIds || [])]
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (selected.length > 0) return [...new Set(selected)];

  const current = Number(currentDocumentId);
  return Number.isInteger(current) && current > 0 ? [current] : [];
}

export function resolveLinkedDocument(documents, currentDocument, href) {
  const fileName = linkedFileName(href);
  if (!fileName) return null;

  const normalizedName = fileName.toLocaleLowerCase("zh-CN");
  const matches = (documents || []).filter(
    (document) =>
      String(document.originalName || "").toLocaleLowerCase("zh-CN") ===
      normalizedName
  );
  if (matches.length === 0) return null;

  const currentCategory = currentDocument?.category?.trim() || "未分类";
  return (
    matches.find(
      (document) =>
        (document.category?.trim() || "未分类") === currentCategory
    ) || (matches.length === 1 ? matches[0] : null)
  );
}

function linkedFileName(href) {
  const value = String(href || "").trim();
  if (!value || value.startsWith("#") || value.startsWith("//")) return "";
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return "";

  const path = value.split(/[?#]/, 1)[0].replace(/\\/g, "/");
  const encodedName = path.split("/").filter(Boolean).pop() || "";
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

export function sortDocuments(documents, mode = "filename") {
  return [...(documents || [])].sort((left, right) => {
    if (mode === "import") {
      return Number(left.id) - Number(right.id);
    }

    const leftValue = mode === "title" ? left.title : left.originalName;
    const rightValue = mode === "title" ? right.title : right.originalName;
    return (
      collator.compare(leftValue || "", rightValue || "") ||
      Number(left.id) - Number(right.id)
    );
  });
}

export function groupDocuments(documents, mode = "filename") {
  const groups = new Map();
  for (const document of documents || []) {
    const category = document.category?.trim() || "未分类";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(document);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === "未分类") return 1;
      if (right === "未分类") return -1;
      return collator.compare(left, right);
    })
    .map(([category, categoryDocuments]) => ({
      category,
      documents: sortDocuments(categoryDocuments, mode)
    }));
}

export function getAdjacentDocument(
  documents,
  currentDocumentId,
  direction,
  mode = "filename"
) {
  const current = (documents || []).find(
    (document) => Number(document.id) === Number(currentDocumentId)
  );
  if (!current) return null;

  const category = current.category?.trim() || "未分类";
  const ordered = sortDocuments(
    documents.filter(
      (document) => (document.category?.trim() || "未分类") === category
    ),
    mode
  );
  const currentIndex = ordered.findIndex(
    (document) => Number(document.id) === Number(currentDocumentId)
  );
  return ordered[currentIndex + Math.sign(direction)] || null;
}

export function getRemainingAdjacentDocument(
  documents,
  currentDocumentId,
  deletedIds,
  mode = "filename"
) {
  const deleted = new Set((deletedIds || []).map((id) => Number(id)));
  const current = (documents || []).find(
    (document) => Number(document.id) === Number(currentDocumentId)
  );
  if (!current) return null;

  const category = current.category?.trim() || "未分类";
  const ordered = sortDocuments(
    documents.filter(
      (document) => (document.category?.trim() || "未分类") === category
    ),
    mode
  );
  const currentIndex = ordered.findIndex(
    (document) => Number(document.id) === Number(currentDocumentId)
  );

  for (let index = currentIndex + 1; index < ordered.length; index += 1) {
    if (!deleted.has(Number(ordered[index].id))) return ordered[index];
  }
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (!deleted.has(Number(ordered[index].id))) return ordered[index];
  }
  return null;
}
