const CITATION_PATTERN = /\[cite:(B\d+)\]/g;

export function validateAnswerCitations(answer, sources = []) {
  const allowed = new Set(
    (sources || []).map((source) => String(source?.id || "")).filter(Boolean)
  );
  const citedSourceIds = [];
  let invalidCitationCount = 0;
  const normalizedAnswer = String(answer || "").replace(
    CITATION_PATTERN,
    (marker, sourceId) => {
      if (!allowed.has(sourceId)) {
        invalidCitationCount += 1;
        return "";
      }
      if (!citedSourceIds.includes(sourceId)) citedSourceIds.push(sourceId);
      return marker;
    }
  );
  return {
    answer: normalizedAnswer.replace(/[ \t]+\n/g, "\n").trim(),
    citedSourceIds,
    invalidCitationCount
  };
}

export function extractCitationIds(answer) {
  return [...String(answer || "").matchAll(CITATION_PATTERN)]
    .map((match) => match[1])
    .filter((sourceId, index, values) => values.indexOf(sourceId) === index);
}
