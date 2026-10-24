import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { REVIEW_SECONDS, needsHuman, type Metrics, type ModAction } from '@quell/shared';
import { EventsService } from '../core/events.service';
import { StoreService } from '../core/store.service';
import { ModerationService } from './moderation.service';

const SERIES_MINUTES = 30;

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly store: StoreService,
    private readonly events: EventsService,
    private readonly moderation: ModerationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.events.emit({ type: 'metrics', data: this.compute() }), 1000);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  compute(): Metrics {
    const all = this.store.allMessages();
    const done = all.filter((m) => m.status === 'done' && m.decision);
    const byAction: Record<ModAction, number> = { allow: 0, flag: 0, remove: 0, redact: 0 };
    for (const m of done) byAction[m.decision!.action]++;

    const latencies = done
      .filter((m) => !m.cached)
      .slice(-300)
      .map((m) => m.latencyMs ?? 0)
      .sort((a, b) => a - b);
    const pct = (p: number) => (latencies.length ? latencies[Math.floor((latencies.length - 1) * p)] : null);

    const now = Date.now();
    const graded = done.filter((m) => m.expected);
    const correct = graded.filter((m) => m.decision!.action === m.expected!.action);
    const scams = graded.filter((m) => m.expected!.reason === 'scam');
    const pii = graded.filter((m) => m.expected!.action === 'redact');

    // Accuracy per minute over the last half hour, for the trend line.
    const series: number[] = [];
    for (let i = SERIES_MINUTES - 1; i >= 0; i--) {
      const from = now - (i + 1) * 60_000;
      const to = now - i * 60_000;
      const bucket = graded.filter((m) => m.createdAt >= from && m.createdAt < to);
      if (bucket.length >= 3) {
        series.push(bucket.filter((m) => m.decision!.action === m.expected!.action).length / bucket.length);
      }
    }

    const needsReview = done.filter((m) => !m.correction && needsHuman(m.decision!)).length;
    const autoHandled = done.length - needsReview - done.filter((m) => m.correction).length;

    return {
      moderated: done.length,
      cached: done.filter((m) => m.cached).length,
      autoHandled,
      needsReview,
      autoRate: done.length ? autoHandled / done.length : null,
      minutesSaved: Math.round((autoHandled * REVIEW_SECONDS) / 60),
      queued: this.moderation.queued,
      errors: all.filter((m) => m.status === 'error').length,
      byAction,
      latencyP50: pct(0.5),
      latencyP95: pct(0.95),
      throughputPerMin: done.filter((m) => m.createdAt > now - 60_000).length,
      tokensIn: this.store.counters.tokensIn,
      tokensOut: this.store.counters.tokensOut,
      graded: graded.length,
      accuracy: graded.length ? correct.length / graded.length : null,
      wrongfulRemovals: graded.filter(
        (m) => m.expected!.action === 'allow' && (m.decision!.action === 'remove' || m.decision!.action === 'flag'),
      ).length,
      scamsCaught: scams.filter((m) => m.decision!.action === 'remove').length,
      scamsTotal: scams.length,
      piiRedacted: pii.filter((m) => m.decision!.action === 'redact').length,
      piiTotal: pii.length,
      corrections: this.store.counters.corrections,
      trainingExamples: this.store.counters.trainingExamples,
      rules: this.store.rules.length,
      accuracySeries: series,
    };
  }
}
