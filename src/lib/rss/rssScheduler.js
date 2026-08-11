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
    this.lastBriefDate = "";
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
      await this.ensureTodayBrief();
    } catch (error) {
      console.error("[rss] scheduler tick failed:", error.message);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * 每天自动生成一次今日精选：仅当日期变化且当天尚未成功生成时执行。
   * 生成成功（或当天已有精选）后记录日期；无候选或失败时不记录，
   * 下个 tick 会继续尝试，直到当天产出精选。
   */
  async ensureTodayBrief() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastBriefDate === today) return;
    try {
      const brief = await this.rssService.generateTodayBrief();
      if (brief) this.lastBriefDate = today;
    } catch (error) {
      console.error("[rss] daily brief generation failed:", error.message);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.timer = null;
    this.startupTimer = null;
  }
}
