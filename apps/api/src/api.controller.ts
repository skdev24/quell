import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Ip,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { Observable, map, merge, interval } from 'rxjs';
import { MOD_NAME, banKey, type Ban, type CorrectionInput, type LiveState, type SwarmState } from '@quell/shared';
import { CHANNEL } from './core/community';
import { EventsService } from './core/events.service';
import { StoreService } from './core/store.service';
import { CorrectionsService } from './moderation/corrections.service';
import { EvalService } from './moderation/eval.service';
import { TASK_FINGERPRINT, TASK_MODEL } from './moderation/frozen';
import { MetricsService } from './moderation/metrics.service';
import { ModerationService } from './moderation/moderation.service';
import { SwarmService } from './swarm/swarm.service';

const CROWD_GAP_MS = 2500;
const MAX_LENGTH = 300;

@Controller()
export class ApiController {
  private readonly lastPost = new Map<string, number>();
  // Hard block-list for crowd input: abusive text never reaches the screen.
  private readonly profanity = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

  constructor(
    private readonly store: StoreService,
    private readonly events: EventsService,
    private readonly moderation: ModerationService,
    private readonly corrections: CorrectionsService,
    private readonly metrics: MetricsService,
    private readonly swarm: SwarmService,
    private readonly evals: EvalService,
  ) {}

  @Get('state')
  state(): LiveState {
    return {
      messages: this.store.recent(250),
      rules: this.store.rules,
      metrics: this.metrics.compute(),
      swarm: this.swarm.snapshot,
      task: { model: TASK_MODEL, fingerprint: TASK_FINGERPRINT },
      evaluation: this.evals.latest,
      bans: this.store.activeBans(),
    };
  }

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const events = this.events.stream.pipe(map((e) => ({ type: e.type, data: e.data }) as MessageEvent));
    // Comment-style heartbeat keeps proxies from closing an idle stream.
    const heartbeat = interval(15_000).pipe(map(() => ({ type: 'ping', data: {} }) as MessageEvent));
    return merge(events, heartbeat);
  }

  @Post('ingest')
  ingest(@Body() body: { author?: string; text?: string; device?: string }, @Ip() ip: string) {
    const text = (body.text ?? '').trim();
    const author = (body.author ?? '').trim().slice(0, 24) || 'guest';
    const device = typeof body.device === 'string' ? body.device.slice(0, 64) || undefined : undefined;
    const ban = this.store.banFor(author, device);
    if (ban) throw new ForbiddenException(banNotice(ban));
    if (!text) throw new BadRequestException('Message is empty.');
    if (text.length > MAX_LENGTH) throw new BadRequestException(`Keep it under ${MAX_LENGTH} characters.`);
    const last = this.lastPost.get(ip) ?? 0;
    if (Date.now() - last < CROWD_GAP_MS) {
      throw new HttpException('Slow down a little.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.lastPost.set(ip, Date.now());
    if (this.profanity.hasMatch(text) || this.profanity.hasMatch(author)) {
      throw new BadRequestException('That one was blocked before it reached the channel.');
    }
    const m = this.moderation.submit({
      id: randomUUID(),
      channel: CHANNEL,
      author,
      text,
      source: 'crowd',
      device,
      createdAt: Date.now(),
    });
    return { id: m.id };
  }

  /**
   * The moderator speaking in chat. Like Twitch, mods aren't held by AutoMod, so
   * this skips the model: no call, and nothing for Mubit to learn from.
   */
  @Post('mod/say')
  say(@Body() body: { text?: string }) {
    const text = (body.text ?? '').trim();
    if (!text) throw new BadRequestException('Message is empty.');
    if (text.length > MAX_LENGTH) throw new BadRequestException(`Keep it under ${MAX_LENGTH} characters.`);
    const m = { id: randomUUID(), channel: CHANNEL, author: MOD_NAME, text, source: 'mod' as const, createdAt: Date.now() };
    const done = { ...m, status: 'done' as const };
    this.store.putMessage(done);
    this.events.emit({ type: 'message', data: done });
    return { id: m.id };
  }

  /** Times out (minutes) or bans (no minutes) whoever posted a message. They can still watch. */
  @Post('messages/:id/ban')
  ban(@Param('id') id: string, @Body() body: { minutes?: number | null }) {
    const m = this.store.getMessage(id);
    if (!m) throw new NotFoundException('No such message.');
    if (m.source === 'mod') throw new BadRequestException("Moderators can't be timed out or banned.");
    const minutes = Number(body?.minutes);
    const ban: Ban = {
      id: banKey(m.author, m.device),
      author: m.author,
      at: Date.now(),
      until: minutes > 0 ? Date.now() + Math.min(minutes, 24 * 60) * 60_000 : null,
    };
    this.store.putBan(ban);
    this.events.emit({ type: 'bans', data: this.store.activeBans() });
    return ban;
  }

  @Delete('bans/:id')
  unban(@Param('id') id: string) {
    if (!this.store.removeBan(id)) throw new NotFoundException('No such ban.');
    this.events.emit({ type: 'bans', data: this.store.activeBans() });
    return { ok: true };
  }

  @Post('messages/:id/correct')
  correct(@Param('id') id: string, @Body() body: CorrectionInput) {
    return this.corrections.correct(id, body);
  }

  @Delete('rules/:id')
  removeRule(@Param('id') id: string) {
    this.corrections.removeRule(id);
    return { ok: true };
  }

  @Post('swarm')
  updateSwarm(@Body() body: Partial<Pick<SwarmState, 'running' | 'rate' | 'scamWave'>>) {
    return this.swarm.update(body);
  }

  /** Scores GPT before and after corrections, and an untrained open model, on the held-out set. */
  @Post('eval')
  evaluate() {
    return this.evals.start();
  }

  /** Addresses other devices on the same network can use to reach this laptop. */
  @Get('info')
  info() {
    const lan = Object.values(networkInterfaces())
      .flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => a!.address);
    return { lan };
  }

  /** Scripted demo beats: 'teach' posts known mistakes, 'again' posts new look-alikes. */
  @Post('demo/:stage')
  demo(@Param('stage') stage: string) {
    if (stage === 'reset') {
      this.swarm.update({ running: false, scamWave: false });
      this.store.reset();
      this.moderation.clearCache();
      this.events.emit({ type: 'reset', data: {} });
      return { ok: true };
    }
    if (stage !== 'teach' && stage !== 'again') throw new BadRequestException('Unknown demo stage.');
    return { posted: this.swarm.demo(stage) };
  }

  @Post('swarm/raid')
  raid(@Body() body: { count?: number }) {
    const count = Math.max(10, Math.min(500, Number(body?.count) || 150));
    return { posted: this.swarm.raid(count) };
  }
}

function banNotice(ban: Ban): string {
  if (ban.until === null) return 'A moderator banned you from chat. You can still watch.';
  const minutes = Math.max(1, Math.ceil((ban.until - Date.now()) / 60_000));
  return `You're timed out for ${minutes} more minute${minutes === 1 ? '' : 's'}.`;
}
