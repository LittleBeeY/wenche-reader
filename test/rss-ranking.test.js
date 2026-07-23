import assert from "node:assert/strict";
import test from "node:test";
import { buildBriefSelection, scoreEntry } from "../src/lib/rss/rssRanking.js";

const baseEntry = {
  id: 1,
  feedId: 1,
  feedPriority: 0,
  title: "Agent 工程实践新案例",
  publishedAt: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  estimatedReadMinutes: 6,
  readState: "unread",
  hidden: false
};

const prefs = {
  topics: [{ name: "Agent", weight: 1 }],
  blockedTopics: [],
  blockedFeedIds: [],
  prefersLongForm: false
};

test("priority feed and topic hits raise the score and produce reasons", () => {
  const scored = scoreEntry({
    entry: { ...baseEntry, feedPriority: 1 },
    analysis: { topics: ["Agent"], qualitySignals: { depth: 80 } },
    preferences: prefs
  });
  assert.ok(scored.priority > 0.7, `priority ${scored.priority} should be high`);
  assert.ok(scored.reasons.some((reason) => reason.includes("重点")));
  assert.ok(scored.reasons.some((reason) => reason.includes("Agent")));
});

test("blocked topics and sources pull the score down", () => {
  const blocked = scoreEntry({
    entry: baseEntry,
    analysis: null,
    preferences: { ...prefs, blockedTopics: ["Agent"], blockedFeedIds: [1] }
  });
  assert.ok(blocked.priority < 0, `priority ${blocked.priority} should be negative`);
});

test("every recommendation resolves to at least one readable reason", () => {
  const scored = scoreEntry({ entry: { ...baseEntry, title: "杂谈" }, analysis: null, preferences: { topics: [] } });
  assert.ok(scored.reasons.length >= 1);
  assert.ok(scored.reasons[0].length > 0);
});

test("hidden entries rank below visible ones and read state is not persisted into scores", () => {
  const visible = scoreEntry({ entry: baseEntry, analysis: null, preferences: prefs });
  const hidden = scoreEntry({ entry: { ...baseEntry, hidden: true }, analysis: null, preferences: prefs });
  assert.ok(visible.priority > hidden.priority);
  // 已读状态不写入持久化分数，避免打开过的条目永久沉底（排序层动态降权）
  const read = scoreEntry({ entry: { ...baseEntry, readState: "read" }, analysis: null, preferences: prefs });
  assert.equal(read.priority, visible.priority);
});

test("brief selection keeps at most two entries per feed", () => {
  const scored = [1, 2, 3, 4, 5].map((id) => ({
    entry: { ...baseEntry, id, feedId: id <= 3 ? 1 : id, feedPriority: 0 },
    analysis: null,
    priority: 1 - id * 0.01,
    signals: { topicRelevance: 1 },
    reasons: ["r"]
  }));
  const selection = buildBriefSelection(scored, { total: 4, perFeedMax: 2, exploreItem: false });
  const feedOne = selection.filter((item) => scored.find((s) => s.entry.id === item.entryId).entry.feedId === 1);
  assert.ok(feedOne.length <= 2);
  assert.equal(selection.filter((item) => item.section === "focus").length, 1);
});

test("brief selection includes focus section and keeps reasons", () => {
  const scored = Array.from({ length: 12 }, (_, index) => ({
    entry: { ...baseEntry, id: index + 1, feedId: index + 1 },
    analysis: null,
    priority: 1 - index * 0.05,
    signals: { topicRelevance: 1 },
    reasons: [`原因 ${index + 1}`]
  }));
  const selection = buildBriefSelection(scored, { total: 10, exploreItem: false });
  assert.equal(selection.length, 10);
  assert.equal(selection.filter((item) => item.section === "focus").length, 3);
  assert.ok(selection.every((item) => item.reason.length > 0));
});
