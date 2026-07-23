/**
 * 可解释线性排序：不使用不透明单一分数决定可见性，
 * 每个推荐结果必须能还原成一到两个用户可理解的原因。
 */

export const RANKING_WEIGHTS = Object.freeze({
  topicRelevance: 0.30,
  sourceAffinity: 0.22,
  contentQuality: 0.18,
  freshness: 0.15,
  novelty: 0.10,
  formatPreference: 0.05
});

export function scoreEntry({ entry, analysis, preferences, now = Date.now() }) {
  const signals = {
    topicRelevance: topicRelevance({ entry, analysis, preferences }),
    sourceAffinity: sourceAffinity({ entry, preferences }),
    contentQuality: contentQuality(analysis),
    freshness: freshnessScore(entry, now),
    novelty: noveltyScore(entry),
    formatPreference: formatPreferenceScore({ entry, preferences })
  };
  const penalties = negativeFeedbackPenalty({ entry, preferences }) + duplicatePenalty(entry);

  const priority =
    RANKING_WEIGHTS.topicRelevance * signals.topicRelevance +
    RANKING_WEIGHTS.sourceAffinity * signals.sourceAffinity +
    RANKING_WEIGHTS.contentQuality * signals.contentQuality +
    RANKING_WEIGHTS.freshness * signals.freshness +
    RANKING_WEIGHTS.novelty * signals.novelty +
    RANKING_WEIGHTS.formatPreference * signals.formatPreference -
    penalties;

  return {
    priority: Math.round(priority * 1000) / 1000,
    signals,
    penalty: penalties,
    reasons: explainReasons({ entry, analysis, preferences, signals })
  };
}

function topicRelevance({ entry, analysis, preferences }) {
  const topics = normalizeTopics(preferences.topics);
  if (topics.length === 0) return 0.5;
  const haystack = [
    entry.title,
    ...(analysis?.topics || []),
    ...(analysis?.entities || []),
    ...(entry.categories || [])
  ].join(" ").toLowerCase();
  let best = 0;
  for (const topic of topics) {
    if (haystack.includes(topic.name.toLowerCase())) {
      best = Math.max(best, Math.min(1, topic.weight));
    }
  }
  return best;
}

function sourceAffinity({ entry, preferences }) {
  if ((preferences.blockedFeedIds || []).includes(entry.feedId)) return 0;
  if (entry.feedPriority >= 1) return 1;
  if (entry.feedPriority <= -1) return 0.2;
  return 0.5;
}

function contentQuality(analysis) {
  const quality = analysis?.qualitySignals;
  if (!quality || typeof quality !== "object") return 0.5;
  const values = ["originality", "depth", "evidence", "practicality"]
    .map((key) => Number(quality[key]))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return 0.5;
  return Math.min(1, values.reduce((sum, value) => sum + value, 0) / values.length / 100);
}

function freshnessScore(entry, now) {
  const timestamp = Date.parse(entry.publishedAt || entry.receivedAt || "") || now;
  const ageHours = Math.max(0, (now - timestamp) / 3600000);
  if (ageHours <= 6) return 1;
  if (ageHours <= 24) return 0.85;
  if (ageHours <= 48) return 0.6;
  if (ageHours <= 96) return 0.35;
  return 0.15;
}

function noveltyScore(entry) {
  // 聚类重复在 service 层通过 recentDuplicate 标记
  return entry.recentDuplicate ? 0.2 : 0.7;
}

function formatPreferenceScore({ entry, preferences }) {
  const minutes = Number(entry.estimatedReadMinutes || 0);
  if (preferences.prefersLongForm) return minutes >= 8 ? 1 : 0.4;
  return minutes > 0 && minutes <= 12 ? 0.8 : 0.5;
}

function negativeFeedbackPenalty({ entry, preferences }) {
  let penalty = 0;
  const blockedTopics = (preferences.blockedTopics || []).map((topic) => String(topic).toLowerCase());
  if (blockedTopics.some((topic) => String(entry.title || "").toLowerCase().includes(topic))) {
    penalty += 0.6;
  }
  if ((preferences.blockedFeedIds || []).includes(entry.feedId)) penalty += 1;
  if (entry.hidden) penalty += 1;
  // 已读降权在列表排序时动态生效，不写入持久化分数，
  // 避免“打开过一次就永久沉底”。
  return penalty;
}

function duplicatePenalty(entry) {
  return entry.recentDuplicate ? 0.25 : 0;
}

export function explainReasons({ entry, analysis, preferences, signals }) {
  const reasons = [];
  if (entry.feedPriority >= 1) {
    reasons.push("来自你设为重点的订阅源");
  }
  const topics = normalizeTopics(preferences.topics);
  const haystack = [entry.title, ...(analysis?.topics || [])].join(" ").toLowerCase();
  const hitTopic = topics.find((topic) => haystack.includes(topic.name.toLowerCase()));
  if (hitTopic) {
    reasons.push(`命中你关注的「${hitTopic.name}」主题`);
  }
  if (signals.freshness >= 0.85 && reasons.length < 2) {
    reasons.push("最近 24 小时内的新内容");
  }
  const quality = analysis?.qualitySignals;
  if (quality && Number(quality.depth) >= 75 && reasons.length < 2) {
    reasons.push("内容包含较深的一手分析");
  }
  if (reasons.length === 0 && analysis?.recommendationReason) {
    reasons.push(analysis.recommendationReason);
  }
  if (reasons.length === 0) {
    reasons.push("与你的订阅和阅读习惯相关");
  }
  return reasons.slice(0, 2);
}

export function normalizeTopics(topics) {
  return (Array.isArray(topics) ? topics : [])
    .map((topic) => {
      if (typeof topic === "string") return { name: topic, weight: 0.8 };
      const name = String(topic?.name || "").trim();
      if (!name) return null;
      const weight = Number(topic?.weight);
      return { name, weight: Number.isFinite(weight) ? Math.max(0.1, Math.min(1, weight)) : 0.8 };
    })
    .filter(Boolean)
    .slice(0, 50);
}

/**
 * 生成今日精选：同一来源默认不超过 2 条，保留 1 条探索性内容。
 */
export function buildBriefSelection(scoredEntries, { total = 10, perFeedMax = 2, exploreItem = true } = {}) {
  const sorted = [...scoredEntries].sort((a, b) => b.priority - a.priority);
  const picked = [];
  const feedCounts = new Map();
  const focusCount = Math.min(3, Math.max(1, Math.floor(total * 0.3)));

  for (const item of sorted) {
    if (picked.length >= total) break;
    const count = feedCounts.get(item.entry.feedId) || 0;
    if (count >= perFeedMax) continue;
    feedCounts.set(item.entry.feedId, count + 1);
    picked.push(item);
  }

  let explore = null;
  if (exploreItem && picked.length > 0) {
    explore = sorted.find(
      (item) => !picked.includes(item) && item.entry.feedPriority <= 0 && item.signals.topicRelevance < 0.6
    ) || null;
    if (explore && picked.length >= total) {
      picked[picked.length - 1] = explore;
    } else if (explore) {
      picked.push(explore);
    }
  }

  return picked.map((item, index) => ({
    entryId: item.entry.id,
    section: index < focusCount ? "focus" : (explore === item ? "explore" : "picked"),
    reason: item.reasons[0] || "",
    score: item.priority
  }));
}
