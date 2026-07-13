export function getVisibleRecords(records, limit = 3) {
  return (records || []).slice(0, limit);
}

export function formatAnswerMeta({ provider, selectedText }, maxSelectedLength = 80) {
  const parts = [];
  if (provider) parts.push(provider);
  if (selectedText) parts.push(truncate(selectedText.replace(/\s+/g, " "), maxSelectedLength));
  return parts.join(" · ");
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
