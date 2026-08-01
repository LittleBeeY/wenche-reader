export function getVisibleRecords(records, limit = 3) {
  return (records || []).slice(0, limit);
}

export function formatAnswerMeta({
  provider,
  model,
  scope,
  inputTokens,
  outputTokens,
  latencyMs,
  selectedText
}, maxSelectedLength = 80) {
  const parts = [];
  if (model || provider) parts.push(model || provider);
  if (scope) parts.push(scopeLabel(scope));
  if (Number(inputTokens) || Number(outputTokens)) {
    parts.push(`${Number(inputTokens) || 0}→${Number(outputTokens) || 0} tokens`);
  }
  if (Number(latencyMs)) parts.push(`${(Number(latencyMs) / 1000).toFixed(1)}s`);
  if (selectedText) parts.push(truncate(selectedText.replace(/\s+/g, " "), maxSelectedLength));
  return parts.join(" · ");
}

function scopeLabel(scope) {
  if (scope === "page") return "当前页";
  if (scope === "section") return "当前章节";
  if (scope === "document") return "全文";
  return "选区";
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
