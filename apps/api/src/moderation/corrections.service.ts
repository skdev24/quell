import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CorrectionInput, ModAction, ModReason, ModeratedMessage, Rule } from '@quell/shared';
import { ACTIONS, REASONS } from '@quell/shared';
import { EventsService } from '../core/events.service';
import { MubitService } from '../core/mubit.service';
import { StoreService } from '../core/store.service';
import { ModerationService } from './moderation.service';
import { mask, personalInfo, prescan } from './prescan';

const REPLAY_LIMIT = 24;
const CANDIDATES = 300;
const EMBED_MODEL = 'text-embedding-3-small';
/** Cosine similarity a message needs to the corrected message or the rule. */
const SIMILARITY = 0.38;
/** Word-overlap fallback if embeddings are unavailable. */
const JACCARD = 0.3;

const REASON_WORDS: Record<ModReason, string> = {
  ok: 'fine',
  spam: 'spam',
  scam: 'scams',
  harassment: 'harassment',
  off_topic: 'off-topic',
  personal_info: 'personal information',
  slur: 'slurs',
};

/**
 * Turns a moderator's correction into a model update, the way Mubit works today:
 * 1. the correction becomes a community rule, sent in every later call;
 * 2. the corrected message and similar recent ones are re-judged with that rule,
 *    as recorded calls. The provider now answers as the moderator wants, so each
 *    re-judged call is a kept example of the corrected behaviour for the next
 *    adapter version.
 */
@Injectable()
export class CorrectionsService {
  constructor(
    private readonly store: StoreService,
    private readonly events: EventsService,
    private readonly moderation: ModerationService,
    private readonly mubit: MubitService,
  ) {}

  async correct(messageId: string, input: CorrectionInput): Promise<{ rule: Rule; replaying: number }> {
    if (!ACTIONS.includes(input.action) || !REASONS.includes(input.reason)) {
      throw new BadRequestException('Unknown action or reason.');
    }
    const message = this.store.getMessage(messageId);
    if (!message) throw new NotFoundException('No such message.');

    const rule: Rule = {
      id: randomUUID(),
      text: input.ruleText?.trim() || ruleFor(message, input),
      createdAt: Date.now(),
      fromMessageId: message.id,
      examples: 0,
    };
    this.store.putRule(rule);
    this.events.emit({ type: 'rule', data: rule });

    message.correction = { action: input.action, reason: input.reason, at: Date.now(), ruleId: rule.id };
    if (input.action === 'redact') {
      // Hide the personal details the scanner finds, or the model already marked;
      // with neither, hide the whole message rather than show something a mod hid.
      const spans = [
        ...new Set([...personalInfo(prescan(message.text)), ...(message.decision?.redact ?? [])]),
      ].filter((s) => s && message.text.includes(s));
      message.correction.redact = spans.length ? spans : [message.text];
      message.display = mask(message.text, message.correction.redact);
    }
    this.store.putMessage(message);
    this.events.emit({ type: 'message', data: message });
    this.store.bump('corrections');

    const targets = [message, ...(await this.similarTo(message, rule))];
    void this.replay(rule, targets, input.action);
    return { rule, replaying: targets.length };
  }

  removeRule(id: string): void {
    if (!this.store.removeRule(id)) throw new NotFoundException('No such rule.');
    this.events.emit({ type: 'rule-removed', data: { id } });
  }

  /**
   * Recent messages that mean the same kind of thing as the corrected one or its
   * rule. Embeddings go through Mubit unrecorded, so they never form a task.
   */
  private async similarTo(m: ModeratedMessage, rule: Rule): Promise<ModeratedMessage[]> {
    const pool = this.store
      .recent(CANDIDATES + 50)
      .filter((o) => o.id !== m.id && o.status === 'done' && !o.correction)
      .slice(-CANDIDATES);
    if (!pool.length) return [];

    let scored: { o: ModeratedMessage; score: number }[];
    try {
      const res = await this.mubit.client.embeddings.create(
        { model: EMBED_MODEL, input: [m.text, rule.text, ...pool.map((o) => o.text)] },
        { headers: MubitService.UNRECORDED },
      );
      const [msgVec, ruleVec, ...vecs] = res.data.map((d) => d.embedding);
      scored = pool
        .map((o, i) => ({ o, score: Math.max(cosine(msgVec, vecs[i]), cosine(ruleVec, vecs[i])) }))
        .filter((x) => x.score >= SIMILARITY);
    } catch {
      const words = tokens(m.text);
      scored = pool
        .map((o) => ({ o, score: jaccard(words, tokens(o.text)) }))
        .filter((x) => x.score >= JACCARD);
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, REPLAY_LIMIT)
      .map((x) => x.o);
  }

  private async replay(rule: Rule, targets: ModeratedMessage[], taught: ModAction): Promise<void> {
    await Promise.all(
      targets.map(async (t) => {
        try {
          const j = await this.moderation.rejudge(t);
          rule.examples++;
          this.store.bump('trainingExamples');
          // The channel only shows re-judgements that follow what the moderator taught.
          if (!t.correction && t.decision && t.decision.action !== taught && j.decision.action === taught) {
            t.rejudged = { at: Date.now(), before: t.decision };
            Object.assign(t, { decision: j.decision, display: j.display, safetyNet: j.safetyNet });
            this.store.putMessage(t);
            this.events.emit({ type: 'message', data: t });
          }
        } catch {
          // A failed replay just means one fewer example.
        }
      }),
    );
    this.store.putRule(rule);
    this.events.emit({ type: 'rule', data: rule });
    this.events.emit({ type: 'replay', data: { ruleId: rule.id, sent: rule.examples } });
  }
}

function ruleFor(m: ModeratedMessage, c: CorrectionInput): string {
  const snippet = m.text.length > 90 ? `${m.text.slice(0, 87)}…` : m.text;
  switch (c.action) {
    case 'allow':
      return `Messages like "${snippet}" are normal in this community. Allow them.`;
    case 'remove':
      return `Messages like "${snippet}" are ${REASON_WORDS[c.reason]}. Remove them.`;
    case 'flag':
      return `Messages like "${snippet}" need a human moderator. Flag them.`;
    case 'redact':
      return `Messages like "${snippet}" contain ${REASON_WORDS[c.reason]}. Redact that part and allow the rest.`;
  }
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' link ')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1),
  );
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}
