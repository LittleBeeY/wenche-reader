import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "../src/lib/storage.js";
import { parseOpml } from "../src/lib/rss/opml.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.join(projectRoot, "data");

const opmlFile = process.argv[2] || path.join(dataDir, "bestblogs_articles.opml");

console.log("📂 读取 OPML 文件:", opmlFile);
const xml = readFileSync(opmlFile, "utf-8");

const parsed = parseOpml(xml);
console.log(`📊 共 ${parsed.items.length} 个 RSS 源\n`);

console.log("🗄️  初始化存储...");
const storage = new Storage({ dataDir });

// 统计已存在
let existingCount = 0;
for (const item of parsed.items) {
  if (storage.getRssFeedByUrl(item.feedUrl)) existingCount++;
}
if (existingCount > 0) {
  console.log(`⚠️  其中 ${existingCount} 个源已存在，将跳过\n`);
}

// 按文件夹分组
const folderCache = new Map();
const results = { imported: 0, skipped: 0 };

console.log("📥 批量导入 RSS 源（仅写入数据库，不联网抓取）...\n");

for (let i = 0; i < parsed.items.length; i++) {
  const item = parsed.items[i];
  const num = String(i + 1).padStart(3, " ");
  const label = `[${num}/${parsed.items.length}] ${item.title.slice(0, 55)}`;

  // 跳过已存在的
  if (storage.getRssFeedByUrl(item.feedUrl)) {
    console.log(`${label} ⏭️  已存在，跳过`);
    results.skipped++;
    continue;
  }

  // 自动创建/查找文件夹
  let folderId = null;
  if (item.folderName) {
    if (!folderCache.has(item.folderName)) {
      const existing = storage.listRssFolders().find((f) => f.name === item.folderName);
      const folder = existing || storage.createRssFolder(item.folderName);
      folderCache.set(item.folderName, folder.id);
    }
    folderId = folderCache.get(item.folderName);
  }

  // 直接插入数据库（不联网）
  try {
    storage.createRssFeed({
      folderId,
      title: item.title,
      feedUrl: item.feedUrl,
      priority: 0,
      fetchIntervalMinutes: 60
    });
    console.log(`${label} ✅ 已导入`);
    results.imported++;
  } catch (error) {
    const msg = error.message || String(error);
    console.log(`${label} ❌ ${msg.slice(0, 40)}`);
  }
}

console.log(`\n${"=".repeat(50)}`);
console.log("🎉 导入完成!");
console.log(`  ✅ 新增: ${results.imported} 个`);
console.log(`  ⏭️  跳过 (已存在): ${results.skipped} 个`);
console.log("");
console.log("💡 提示：启动服务器后，RSS 源会自动在后台刷新拉取文章。");
console.log("   也可以进入 RSS 管理页面手动点击「刷新全部」。");

process.exit(0);
