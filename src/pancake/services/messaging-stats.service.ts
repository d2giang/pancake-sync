import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

const FLUSH_INTERVAL_MS = Number(
  process.env.MESSAGING_LOG_SUMMARY_INTERVAL_MS || 30000,
);

/**
 * Rolls up per-message "processed" logs into one summary line per interval
 * instead of one line per message — a single active conversation can easily
 * produce dozens of messages a minute, which drowned the console even after
 * trimming each line down to one.
 */
@Injectable()
export class MessagingStatsService {
  private readonly logger = new Logger('MessagingStats');

  private count = 0;
  private okCount = 0;
  private failedCount = 0;
  private totalDurationMs = 0;
  private maxDurationMs = 0;
  private conversationIds = new Set<string>();

  record(input: {
    conversationId: string;
    ok: boolean;
    durationMs: number;
  }) {
    this.count += 1;
    if (input.ok) {
      this.okCount += 1;
    } else {
      this.failedCount += 1;
    }
    this.totalDurationMs += input.durationMs;
    this.maxDurationMs = Math.max(this.maxDurationMs, input.durationMs);
    this.conversationIds.add(input.conversationId);
  }

  @Interval(FLUSH_INTERVAL_MS)
  private flush() {
    if (this.count === 0) return;

    const avgMs = Math.round(this.totalDurationMs / this.count);

    this.logger.log(
      `Pancake messaging summary last ~${Math.round(FLUSH_INTERVAL_MS / 1000)}s: ` +
        `messages=${this.count} conversations=${this.conversationIds.size} ` +
        `ok=${this.okCount} failed=${this.failedCount} avg=${avgMs}ms max=${this.maxDurationMs}ms`,
    );

    this.count = 0;
    this.okCount = 0;
    this.failedCount = 0;
    this.totalDurationMs = 0;
    this.maxDurationMs = 0;
    this.conversationIds.clear();
  }
}
