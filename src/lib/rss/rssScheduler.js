/**
 * 单进程 RSS 调度器：不引入外部任务队列。
 * 仅在主服务 listen 成功后启动；测试中的 createApp() 不启动调度。
 */
export class RssScheduler {
  constructor({ rssService, intervalMs = 60000, startupDelayMs = 5000, concurrency = 4 }) {
    this.rssService = rssService;
    this.intervalMs = intervalMs;
    this.startupDelayMs = startupDelayMs;
    this.concurrency = concurrency;
    this.timer = null;
    this.startupTimer = null;
    this.ticking = false;
  }

  start() {
    if (this.timer || this.startupTimer) return;
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      this.tick();
    }, this.startupDelayMs);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.startupTimer.unref?.();
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.rssService.refreshDueFeeds({ concurrency: this.concurrency });
      await this.rssService.runAutoAnalysis({ limit: 5 });
    } catch (error) {
      console.error("[rss] scheduler tick failed:", error.message);
    } finally {
      this.ticking = false;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.timer = null;
    this.startupTimer = null;
  }
}
