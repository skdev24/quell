import { Injectable, Logger } from '@nestjs/common';
import {
  ACTIONS,
  CONFIDENCE,
  REASONS,
  type ChatMessage,
  type ModDecision,
  type ModeratedMessage,
} from '@quell/shared';
import { COMMUNITY } from '../core/community';
import { config } from '../core/config';
import { EventsService } from '../core/events.service';
import { MubitService } from '../core/mubit.service';
import { StoreService } from '../core/store.service';
import { RESPONSE_FORMAT, SYSTEM_PROMPT, TASK_MODEL } from './frozen';
import { mask, personalInfo, prescan } from './prescan';

const MAX_RULES_IN_PROMPT = 40;
/** How long an identical message reuses an earlier decision. */
const DUPLICATE_WINDOW_MS = 10 * 60_000;

export interface Judgement {
  decision: ModDecision;
  display: string;
  safetyNet: boolean;
  latencyMs: number;
  usage: { tokensIn: number; tokensOut: number; costUsd: number | null };
  /** What Mubit reports for the call: the model that answered, and its request id. */
  servedBy?: string;
  mubitRequestId?: string;
}

/**
 * Runs the moderation task. One message is one recorded call, so every call
 * Mubit sees is a clean example of the task. A bounded worker pool keeps
 * bursts (raids) inside the provider's concurrency limits.
 */
@Injectable()
export class ModerationService {
  private readonly log = new Logger(ModerationService.name);
  private readonly queue: (() => Promise<void>)[] = [];
  private active = 0;
  /**
   * Raids repeat the same text hundreds of times. Judging each copy would be slow,
   * and would hand Mubit's reviewer (which reads a limited number of calls a day)
   * identical examples. A copy seen recently under the same rules reuses the decision.
   */
  private readonly recentDecisions = new Map<string, { at: number; judgement: Judgement }>();
  /** Copies arriving while the first one is still being judged wait for it. */
  private readonly inFlight = new Map<string, Promise<Judgement>>();

  constructor(
    private readonly mubit: MubitService,
    private readonly store: StoreService,
    private readonly events: EventsService,
  ) {}

  get queued(): number {
    return this.queue.length + this.active;
  }

  /** Adds a message to the channel and queues it for moderation. */
  submit(message: ChatMessage): ModeratedMessage {
    const m: ModeratedMessage = { ...message, status: 'queued' };
    const key = this.duplicateKey(m.text);
    const hit = this.recentDecisions.get(key);
    const pending = this.inFlight.get(key);

    if (hit && Date.now() - hit.at < DUPLICATE_WINDOW_MS) {
      this.finish(m, hit.judgement, true);
      return m;
    }
    this.store.putMessage(m);
    this.events.emit({ type: 'message', data: m });

    if (pending) {
      pending.then(
        (j) => this.finish(m, j, true),
        (err) => this.fail(m, err),
      );
      return m;
    }

    const judgement = new Promise<Judgement>((resolve, reject) => {
      this.schedule(() => this.judge(m).then(resolve, reject));
    });
    this.inFlight.set(key, judgement);
    judgement
      .then(
        (j) => {
          this.recentDecisions.set(key, { at: Date.now(), judgement: j });
          this.finish(m, j, false);
        },
        (err) => this.fail(m, err),
      )
      .finally(() => this.inFlight.delete(key));
    return m;
  }

  private finish(m: ModeratedMessage, j: Judgement, cached: boolean): void {
    Object.assign(m, {
      status: 'done',
      decision: { ...j.decision, redact: [...j.decision.redact] },
      display: j.display,
      safetyNet: j.safetyNet,
      latencyMs: cached ? 0 : j.latencyMs,
      cached: cached || undefined,
      servedBy: j.servedBy,
      mubitRequestId: cached ? undefined : j.mubitRequestId,
    });
    this.store.putMessage(m);
    this.events.emit({ type: 'message', data: m });
  }

  private fail(m: ModeratedMessage, err: unknown): void {
    m.status = 'error';
    m.error = err instanceof Error ? err.message : String(err);
    this.log.warn(`moderation failed for ${m.id}: ${m.error}`);
    this.store.putMessage(m);
    this.events.emit({ type: 'message', data: m });
  }

  /**
   * Re-judges a message with the current rules, as a recorded call. With the
   * moderator's rule now in the prompt, the provider answers the way the
   * community wants, and that answer is what Mubit keeps as a training example.
   */
  rejudge(m: ModeratedMessage): Promise<Judgement> {
    return new Promise((resolve, reject) => {
      this.schedule(() => this.judge(m).then(resolve, reject));
    });
  }

  clearCache(): void {
    this.recentDecisions.clear();
  }

  /** Rules are part of the key, so a new correction never serves a stale decision. */
  private duplicateKey(text: string): string {
    const rulesVersion = this.store.rules.map((r) => r.id).join(',');
    return `${rulesVersion}|${text.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  }

  private schedule(job: () => Promise<void>): void {
    this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    while (this.active < config.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.active++;
      job().finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  /**
   * Judges a message for evaluation only: never recorded, so it can't train the
   * task or leak into Mubit's test cases. Can run the same prompt on another model.
   */
  evaluate(m: ChatMessage, opts: Omit<JudgeOptions, 'recorded'>): Promise<Judgement> {
    return new Promise((resolve, reject) => {
      this.schedule(() => this.judge(m, { ...opts, recorded: false }).then(resolve, reject));
    });
  }

  private async judge(m: ChatMessage, opts: JudgeOptions = {}): Promise<Judgement> {
    const recorded = opts.recorded ?? true;
    const detected = prescan(m.text);
    const recent =
      opts.recent ??
      this.store
        .recent(12)
        .filter((r) => r.channel === m.channel && r.id !== m.id && r.createdAt <= m.createdAt)
        .slice(-3)
        .map((r) => `${r.author}: ${r.text}`);

    const payload = {
      community: COMMUNITY,
      channel: m.channel,
      author: { name: m.author, new_account: m.persona === 'raider' || m.persona === 'scammer' },
      recent,
      message: m.text,
      detected,
      community_rules: opts.rules ?? this.store.rules.slice(-MAX_RULES_IN_PROMPT).map((r) => r.text),
    };
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: JSON.stringify(payload) },
    ];
    const headers = recorded ? undefined : MubitService.UNRECORDED;

    const started = Date.now();
    let res;
    let mubitRequestId: string | undefined;
    if (opts.openRouterModel) {
      // Same prompt on an open model via OpenRouter (still through Mubit).
      res = await this.mubit.openrouter.chat.completions
        .create({ model: opts.openRouterModel, messages, response_format: RESPONSE_FORMAT, temperature: 0 }, { headers })
        .catch(() =>
          // Not every provider supports strict schemas; fall back to plain JSON mode.
          this.mubit.openrouter.chat.completions.create(
            { model: opts.openRouterModel!, messages, response_format: { type: 'json_object' }, temperature: 0 },
            { headers },
          ),
        );
    } else {
      const { data, response } = await this.mubit.client.chat.completions
        .create(
          {
            model: TASK_MODEL,
            messages,
            response_format: RESPONSE_FORMAT,
            // Settings don't split a Mubit task; this keeps a reasoning model fast enough for chat.
            reasoning_effort: 'none' as 'low',
          },
          { headers },
        )
        .withResponse();
      res = data;
      mubitRequestId = response.headers.get('x-middleware-request-id') ?? undefined;
    }
    const latencyMs = Date.now() - started;
    const usage = {
      tokensIn: res.usage?.prompt_tokens ?? 0,
      tokensOut: res.usage?.completion_tokens ?? 0,
      // OpenRouter reports what the call cost; OpenAI does not.
      costUsd: (res.usage as { cost?: number } | undefined)?.cost ?? null,
    };
    if (recorded) {
      this.store.bump('tokensIn', usage.tokensIn);
      this.store.bump('tokensOut', usage.tokensOut);
    }

    const decision = parseDecision(res.choices[0]?.message?.content ?? '', m.text);

    // Safety net: personal information is never shown, whatever the model said.
    const pii = personalInfo(detected).filter((s) => m.text.includes(s));
    let safetyNet = false;
    if (pii.length && decision.action === 'allow') {
      decision.action = 'redact';
      decision.reason = 'personal_info';
      safetyNet = true;
    }
    if (decision.action === 'redact') {
      decision.redact = [...new Set([...decision.redact, ...pii])];
    }

    const display = decision.action === 'redact' ? mask(m.text, decision.redact) : m.text;
    // Mubit names the model that actually answered: the provider today, a trained adapter once it serves.
    return { decision, display, safetyNet, latencyMs, usage, servedBy: res.model, mubitRequestId };
  }
}

export interface JudgeOptions {
  /** Recorded calls are what Mubit trains on. Defaults to true. */
  recorded?: boolean;
  /** Rules to send instead of the community's current ones. */
  rules?: string[];
  /** Preceding chat to send instead of the live channel's. */
  recent?: string[];
  /** Run the same prompt on this OpenRouter model instead of the teacher. */
  openRouterModel?: string;
}

function parseDecision(raw: string, text: string): ModDecision {
  try {
    const d = JSON.parse(raw) as Partial<ModDecision>;
    const action = ACTIONS.includes(d.action as never) ? d.action! : 'flag';
    const reason = REASONS.includes(d.reason as never) ? d.reason! : action === 'allow' ? 'ok' : 'spam';
    const confidence = CONFIDENCE.includes(d.confidence as never) ? d.confidence! : 'low';
    // Only keep spans that really occur in the message.
    const redact = Array.isArray(d.redact) ? d.redact.filter((s) => typeof s === 'string' && text.includes(s)) : [];
    return { action, reason, redact, confidence };
  } catch {
    return { action: 'flag', reason: 'spam', redact: [], confidence: 'low' };
  }
}
