import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { effectiveAction, type ChatMessage, type SwarmState } from '@quell/shared';
import { CHANNEL, COMMUNITY } from '../core/community';
import { config } from '../core/config';
import { EventsService } from '../core/events.service';
import { MubitService } from '../core/mubit.service';
import { StoreService } from '../core/store.service';
import { ModerationService } from '../moderation/moderation.service';
import { CORPUS } from './corpus';
import { DEMO_BEATS, DEMO_GAP_MS } from './demo';
import { PERSONAS, SCAM_WAVE, type Persona } from './personas';

const TICK_MS = 100;
// Small batches, so lines written as replies are still on topic when they post.
const BATCH = 8;
const LOW_WATER = 4;
/** How much of the visible chat the generator reads before writing. */
const CONTEXT_LINES = 15;
const MAX_RATE = 30;
const AVOID_LIST = 20;

// Rotating angles keep generated chat from collapsing into the same few lines.
const TOPICS = [
  'a failed deploy late at night',
  'a new release that just shipped',
  'config files and environment variables',
  'rolling back a broken version',
  'CI pipelines and flaky tests',
  'Kubernetes vs simpler hosting',
  'a conference talk about Shipyard',
  'the weekend and coffee',
  'a contributor\'s first pull request',
  'pricing of cloud providers',
  'database migrations',
  'monitoring and alerts at 3am',
  'switching from another deploy tool',
  'documentation that is out of date',
  'a bug that only happens in production',
];

/**
 * Plays the community: picks personas by weight and posts their messages at the
 * chosen rate. Messages come from a per-persona buffer, topped up by a generator
 * model (unrecorded, so it never trains anything) and seeded from the corpus.
 */
@Injectable()
export class SwarmService implements OnModuleDestroy {
  private readonly log = new Logger(SwarmService.name);
  private readonly buffers = new Map<string, { author: string; text: string }[]>();
  private readonly generating = new Set<string>();
  /** Every text already posted, so the reviewer never sees the same example twice. */
  private readonly used = new Set<string>();
  private readonly recentByPersona = new Map<string, string[]>();
  private timer?: NodeJS.Timeout;
  private credit = 0;
  private state: SwarmState = { running: false, rate: 2, scamWave: false, buffered: 0, generating: false };

  constructor(
    private readonly mubit: MubitService,
    private readonly moderation: ModerationService,
    private readonly events: EventsService,
    private readonly store: StoreService,
  ) {
    for (const m of store.allMessages()) if (m.source === 'swarm') this.used.add(normalise(m.text));
    for (const p of [...PERSONAS, SCAM_WAVE]) {
      this.buffers.set(
        p.id,
        shuffle((CORPUS[p.id] ?? []).map((text) => ({ author: pick(p.authors), text }))),
      );
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  get snapshot(): SwarmState {
    let buffered = 0;
    for (const b of this.buffers.values()) buffered += b.length;
    return { ...this.state, buffered, generating: this.generating.size > 0 };
  }

  update(patch: Partial<Pick<SwarmState, 'running' | 'rate' | 'scamWave'>>): SwarmState {
    if (patch.rate !== undefined) this.state.rate = Math.max(0.2, Math.min(MAX_RATE, patch.rate));
    if (patch.scamWave !== undefined) this.state.scamWave = patch.scamWave;
    if (patch.running !== undefined && patch.running !== this.state.running) {
      this.state.running = patch.running;
      clearInterval(this.timer);
      if (patch.running) this.timer = setInterval(() => this.tick(), TICK_MS);
    }
    this.broadcast();
    return this.snapshot;
  }

  /** Posts the scripted demo messages: the mistakes to teach, or their look-alikes. */
  demo(stage: 'teach' | 'again'): number {
    DEMO_BEATS.forEach((beat, i) => {
      const line = stage === 'teach' ? beat.teach : beat.again;
      setTimeout(() => {
        this.used.add(normalise(line.text));
        this.moderation.submit({
          id: randomUUID(),
          channel: CHANNEL,
          author: line.author,
          text: line.text,
          source: 'swarm',
          persona: 'demo',
          expected: beat.expected,
          createdAt: Date.now(),
        });
      }, i * DEMO_GAP_MS);
    });
    return DEMO_BEATS.length;
  }

  /**
   * A burst: raid accounts paste the same few lines over and over, among normal
   * chat. The copies hit the moderation cache, so a raid costs a handful of calls.
   */
  raid(count = 150): number {
    const raider = PERSONAS.find((p) => p.id === 'raider')!;
    const lines = shuffle([...new Set(CORPUS.raider)]).slice(0, 3);
    let posted = 0;
    for (let i = 0; i < count; i++) {
      if (i % 5 === 4) {
        if (this.post(this.choosePersona())) posted++;
        continue;
      }
      this.moderation.submit({
        id: randomUUID(),
        channel: CHANNEL,
        author: `raid_${1000 + Math.floor(Math.random() * 9000)}`,
        text: pick(lines),
        source: 'swarm',
        persona: raider.id,
        expected: raider.expected,
        createdAt: Date.now(),
      });
      posted++;
    }
    return posted;
  }

  private tick(): void {
    this.credit += (this.state.rate * TICK_MS) / 1000;
    while (this.credit >= 1) {
      this.credit -= 1;
      this.post(this.choosePersona());
    }
  }

  private post(persona: Persona): boolean {
    const next = this.take(persona) ?? this.take(PERSONAS[0]);
    if (!next) return false; // Everyone is waiting on generation; skip this beat.
    if (this.store.banFor(next.author)) return false; // Banned chatters stay quiet.
    const message: ChatMessage = {
      id: randomUUID(),
      channel: CHANNEL,
      author: next.author,
      text: next.text,
      source: 'swarm',
      persona: persona.id,
      expected: persona.expected,
      createdAt: Date.now(),
    };
    this.moderation.submit(message);
    return true;
  }

  /**
   * Next unused message for a persona. Raiders may repeat themselves (that is what
   * a raid is); the moderation cache answers those copies without a model call.
   */
  private take(persona: Persona): { author: string; text: string } | null {
    const buffer = this.buffers.get(persona.id)!;
    let next: { author: string; text: string } | undefined;
    while ((next = buffer.shift())) {
      const key = normalise(next.text);
      if (persona.id === 'raider' || !this.used.has(key)) {
        this.used.add(key);
        const recent = this.recentByPersona.get(persona.id) ?? [];
        recent.push(next.text);
        this.recentByPersona.set(persona.id, recent.slice(-AVOID_LIST));
        break;
      }
    }
    if (buffer.length < LOW_WATER) void this.refill(persona);
    return next ?? null;
  }

  private choosePersona(): Persona {
    const pool = this.state.scamWave ? [...PERSONAS, SCAM_WAVE] : PERSONAS;
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let r = Math.random() * total;
    for (const p of pool) {
      r -= p.weight;
      if (r <= 0) return p;
    }
    return pool[0];
  }

  private async refill(persona: Persona): Promise<void> {
    if (this.generating.has(persona.id)) return;
    this.generating.add(persona.id);
    this.broadcast();
    try {
      const topics = shuffle(TOPICS).slice(0, 3).join('; ');
      const avoid = (this.recentByPersona.get(persona.id) ?? []).map((t) => `- ${t}`).join('\n');
      const context = this.visibleChat();
      const cast = persona.voices
        ? Object.entries(persona.voices)
            .map(([name, voice]) => `- ${name}: ${voice}`)
            .join('\n')
        : null;
      const res = await this.mubit.client.chat.completions.create(
        {
          model: config.swarmModel,
          temperature: 1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                `You play real people in the live chat of a developer's stream. The channel: ${COMMUNITY.about} ` +
                'On stream right now the host is live-deploying Shipyard v1.0 and answering chat. ' +
                'Write like people typing fast in Twitch chat: mostly lowercase, 2 to 25 words, fragments, ' +
                'the odd typo, slang and emoji where that person would use them. Never write polished or ' +
                'essay-like sentences, never use em dashes, hashtags or "Imagine..." openers, and never ' +
                'explain the joke. Every message must differ from the others in wording, length and opening. ' +
                "A person's quirks and catchphrases show now and then, not in every line. " +
                'Only @mention people who appear in the chat shown. ' +
                'Every message must clearly be the kind the brief describes, even when it replies to someone. ' +
                'Never use slurs. Any personal details must be invented. ' +
                'Return JSON: {"messages":[{"author":"username","text":"message"}]}.',
            },
            {
              role: 'user',
              content:
                (context ? `Chat so far (oldest first):\n${context}\n\n` : '') +
                `Write the next ${BATCH} messages from ${persona.brief}\n` +
                (cast ? `Speak only as these people, each in their own voice:\n${cast}\n` : '') +
                (context
                  ? 'About half should react to the chat above: answer a question someone asked, reply to a ' +
                    'person with @name, agree or argue, carry on a joke, or react to what is on stream. ' +
                    `The rest start something new, touching on: ${topics}.`
                  : `Touch on: ${topics}.`) +
                (avoid ? `\nDo not repeat or paraphrase these recent ones:\n${avoid}` : ''),
            },
          ],
        },
        { headers: MubitService.UNRECORDED },
      );
      const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as {
        messages?: { author?: string; text?: string }[];
      };
      const castNames = persona.voices ? Object.keys(persona.voices) : null;
      const fresh = (parsed.messages ?? [])
        .filter((m) => typeof m.text === 'string' && m.text.trim())
        .map((m) => {
          const author = m.author?.trim();
          // Keep the cast consistent: a name outside it becomes one of the cast.
          const valid = author && (!castNames || castNames.includes(author));
          return { author: valid ? author : pick(castNames ?? persona.authors), text: m.text!.trim().slice(0, 300) };
        })
        .filter((m) => persona.id === 'raider' || !this.used.has(normalise(m.text)));
      this.buffers.get(persona.id)!.push(...shuffle(fresh));
    } catch (err) {
      // No corpus fallback: reposting old lines would only feed the reviewer duplicates.
      this.log.warn(`swarm generation failed for ${persona.id}: ${(err as Error).message}`);
    } finally {
      this.generating.delete(persona.id);
      this.broadcast();
    }
  }

  /** What a viewer can currently read in chat: allowed and redacted lines, as shown. */
  private visibleChat(): string {
    return this.store
      .recent(60)
      .filter((m) => m.status === 'done' && (m.source === 'mod' || ['allow', 'redact'].includes(effectiveAction(m) ?? '')))
      .slice(-CONTEXT_LINES)
      .map((m) => `${m.author}: ${m.display ?? m.text}`)
      .join('\n');
  }

  private broadcast(): void {
    this.events.emit({ type: 'swarm', data: this.snapshot });
  }
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
