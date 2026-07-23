import { scoreEntry } from "./rssRanking.js";

export const TRIAGE_PROMPT_VERSION = "rss-triage-v1";
const MAX_CONTEXT_CHARS = 6000;

/**
 * AI 初评：输出经过 JSON 校验的结构化结果。
 * AI 不可用或返回非 JSON 时，回退为纯确定性分析，不阻断资讯流程。
 */
export async function analyzeEntry({ entry, feed, preferences, aiProvider }) {
  const deterministic = scoreEntry({
    entry: { ...entry, feedPriority: feed?.priority ?? entry.feedPriority ?? 0 },
    analysis: null,
    preferences
  });

  const base = {
    summary: "",
    keyPoints: [],
    topics: [],
    entities: [],
    qualitySignals: {},
    relevanceScore: deterministic.priority,
    priorityScore: deterministic.priority,
    recommendationReason: deterministic.reasons[0] || "",
    confidence: 0,
    model: "",
    promptVersion: TRIAGE_PROMPT_VERSION,
    contentHash: entry.contentHash || "",
    lastError: ""
  };

  if (!aiProvider || feed?.aiExcluded) {
    return base;
  }

  const question = [
    "请对下面这条资讯做结构化初评，只输出一个 JSON 对象，不要输出其他文字。",
    '字段要求：{"summary":"一句话摘要","keyPoints":["要点"],"topics":["主题"],"entities":["实体"],"contentType":"news|analysis|tutorial|opinion|announcement","qualitySignals":{"originality":0-100,"depth":0-100,"evidence":0-100,"practicality":0-100},"recommendationReason":"为什么值得读的一句话原因","confidence":0-1}'
  ].join("\n");

  try {
    const result = await aiProvider.explain({
      mode: "custom",
      selectedText: `标题：${entry.title}`,
      context: String(entry.contentText || entry.title || "").slice(0, MAX_CONTEXT_CHARS),
      question,
      documentTitle: entry.title
    });
    const parsed = parseTriageJson(result.answer);
    if (!parsed) {
      return { ...base, model: result.provider, lastError: "AI 返回的内容不是有效的结构化结果" };
    }
    const analysis = {
      ...base,
      ...parsed,
      model: result.provider,
      confidence: clamp01(parsed.confidence ?? 0.5)
    };
    const rescored = scoreEntry({
      entry: { ...entry, feedPriority: feed?.priority ?? entry.feedPriority ?? 0 },
      analysis,
      preferences
    });
    analysis.priorityScore = rescored.priority;
    analysis.relevanceScore = rescored.priority;
    if (!analysis.recommendationReason) {
      analysis.recommendationReason = rescored.reasons[0] || "";
    }
    return analysis;
  } catch (error) {
    return { ...base, lastError: `AI 分析不可用：${error.message}` };
  }
}

export function parseTriageJson(answer) {
  const text = String(answer || "");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 300) : "",
    keyPoints: toStringArray(parsed.keyPoints, 8),
    topics: toStringArray(parsed.topics, 8),
    entities: toStringArray(parsed.entities, 12),
    contentType: typeof parsed.contentType === "string" ? parsed.contentType : "analysis",
    qualitySignals: normalizeQuality(parsed.qualitySignals),
    recommendationReason: typeof parsed.recommendationReason === "string"
      ? parsed.recommendationReason.slice(0, 200)
      : "",
    confidence: parsed.confidence
  };
}

function toStringArray(value, max) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, max);
}

function normalizeQuality(value) {
  const quality = {};
  for (const key of ["originality", "depth", "evidence", "practicality"]) {
    const score = Number(value?.[key]);
    quality[key] = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 50;
  }
  return quality;
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}
