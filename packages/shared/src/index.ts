// Types shared by the API and the web app. Keep this file free of runtime
// dependencies so both sides can import it without pulling anything in.

export const ACTIONS = ['allow', 'flag', 'remove', 'redact'] as const;
export type ModAction = (typeof ACTIONS)[number];

export const REASONS = [
  'ok',
  'spam',
  'scam',
  'harassment',
  'off_topic',
  'personal_info',
  'slur',
] as const;
export type ModReason = (typeof REASONS)[number];

export const CONFIDENCE = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCE)[number];

/** What the moderation model returns for one message. */
export interface ModDecision {
  action: ModAction;
  reason: ModReason;
  /** Exact substrings of the message to hide. */
  redact: string[];
  confidence: Confidence;
}

/** The action in force: a moderator's correction wins over the model's decision. */
export function effectiveAction(m: ModeratedMessage): ModAction | undefined {
  return m.correction?.action ?? m.decision?.action;
}

/** Substrings to hide for a message, following whichever decision is in force. */
export function redactedSpans(m: ModeratedMessage): string[] {
  if (m.correction) return m.correction.action === 'redact' ? m.correction.redact ?? [] : [];
  return m.decision?.action === 'redact' ? m.decision.redact.filter(Boolean) : [];
}

/** Seconds a human moderator takes to read and decide one message (an estimate). */
export const REVIEW_SECONDS = 5;

/** Whether a moderated message still needs a human: held, or removed without high confidence. */
export function needsHuman(d: ModDecision): boolean {
  return d.action === 'flag' || (d.action === 'remove' && d.confidence !== 'high');
}

export interface Verdict {
  action: ModAction;
  reason: ModReason;
}

export type MessageSource = 'swarm' | 'crowd' | 'mod';

/** The name the moderator chats under from the mod view. */
export const MOD_NAME = 'shipyard_mod';

export interface ChatMessage {
  id: string;
  channel: string;
  author: string;
  text: string;
  source: MessageSource;
  /** Swarm persona that produced the message, if any. */
  persona?: string;
  /** Ground truth for swarm messages: what this community wants done. */
  expected?: Verdict;
  /** Random id of the phone that posted it, so a ban follows the device, not the name. */
  device?: string;
  createdAt: number;
}

/**
 * A chatter kept out of chat, Twitch-style: they can still watch the stream and
 * read chat, but nothing they send is posted.
 */
export interface Ban {
  /** See banKey. */
  id: string;
  author: string;
  at: number;
  /** When a timeout ends; null for a ban that lasts until a moderator lifts it. */
  until: number | null;
}

/** Bans follow a phone when there is one, and the name otherwise (the simulated room). */
export function banKey(author: string, device?: string): string {
  return device ? `device:${device}` : `name:${author.toLowerCase()}`;
}

export function banActive(b: Ban, now = Date.now()): boolean {
  return b.until === null || b.until > now;
}

/**
 * The ban in force for a chatter. Checks the phone and the name, so a ban placed
 * on an older message without a device id still holds once the phone sends one.
 */
export function findBan(bans: Ban[], author: string, device?: string, now = Date.now()): Ban | undefined {
  const keys = [banKey(author), ...(device ? [banKey(author, device)] : [])];
  return bans.find((b) => keys.includes(b.id) && banActive(b, now));
}

export type MessageStatus = 'queued' | 'done' | 'error';

export interface ModeratedMessage extends ChatMessage {
  status: MessageStatus;
  decision?: ModDecision;
  /** The text as shown in the channel, after redaction. */
  display?: string;
  latencyMs?: number;
  /** True when the regex safety net overrode the model. */
  safetyNet?: boolean;
  /** Identical to a message judged moments ago: decision reused, no model call. */
  cached?: boolean;
  error?: string;
  /** A moderator's override. For a redact correction, `redact` lists the spans to hide. */
  correction?: Verdict & { at: number; ruleId?: string; redact?: string[] };
  /** Set when a correction's replay re-judged this message with new rules. */
  rejudged?: { at: number; before: ModDecision };
  /** The model Mubit says answered the call: the provider model, or a trained adapter once it serves. */
  servedBy?: string;
  /** Mubit's id for the call, as shown in its console. */
  mubitRequestId?: string;
}

export interface Rule {
  id: string;
  text: string;
  createdAt: number;
  fromMessageId?: string;
  /** Corrected examples sent to Mubit because of this rule. */
  examples: number;
}

export interface Metrics {
  moderated: number;
  /** Duplicates answered from the cache instead of the model. */
  cached: number;
  /** Messages settled with no human: allowed, redacted, or removed with high confidence. */
  autoHandled: number;
  /** Messages a moderator has to look at: held, or removed without high confidence. */
  needsReview: number;
  /** autoHandled / moderated. */
  autoRate: number | null;
  /** Reading time saved, assuming a moderator spends REVIEW_SECONDS per message. */
  minutesSaved: number;
  queued: number;
  errors: number;
  byAction: Record<ModAction, number>;
  latencyP50: number | null;
  latencyP95: number | null;
  throughputPerMin: number;
  tokensIn: number;
  tokensOut: number;
  /** Graded against swarm ground truth. */
  graded: number;
  accuracy: number | null;
  wrongfulRemovals: number;
  scamsCaught: number;
  scamsTotal: number;
  piiRedacted: number;
  piiTotal: number;
  corrections: number;
  /** Corrected calls replayed through Mubit (become kept examples). */
  trainingExamples: number;
  rules: number;
  /** Model calls by the model that answered them (cached duplicates excluded). */
  servedBy: Record<string, number>;
  /** Per-minute accuracy over the session, oldest first. */
  accuracySeries: number[];
}

export interface SwarmState {
  running: boolean;
  /** Messages per second. */
  rate: number;
  scamWave: boolean;
  buffered: number;
  generating: boolean;
}

/** One model setup scored on the held-out eval set. */
export interface EvalResult {
  id: string;
  label: string;
  model: string;
  /** Community rules sent with each call. */
  rules: number;
  done: number;
  total: number;
  errors: number;
  agreement: number | null;
  wronglyBlocked: number;
  scamsCaught: number;
  scamsTotal: number;
  piiHidden: number;
  piiTotal: number;
  latencyP50: number | null;
  latencyP95: number | null;
  tokensPerMessage: number | null;
  /** USD per 1,000 messages; null when the price is unknown. */
  costPer1k: number | null;
}

export interface EvalRun {
  id: string;
  startedAt: number;
  finishedAt?: number;
  status: 'preparing' | 'running' | 'done' | 'error';
  size: number;
  results: EvalResult[];
  error?: string;
}

export interface LiveState {
  messages: ModeratedMessage[];
  rules: Rule[];
  metrics: Metrics;
  swarm: SwarmState;
  task: { model: string; fingerprint: string };
  evaluation: EvalRun | null;
  bans: Ban[];
}

export type StreamEvent =
  | { type: 'reset'; data: Record<string, never> }
  | { type: 'eval'; data: EvalRun }
  | { type: 'message'; data: ModeratedMessage }
  | { type: 'rule'; data: Rule }
  | { type: 'rule-removed'; data: { id: string } }
  | { type: 'bans'; data: Ban[] }
  | { type: 'metrics'; data: Metrics }
  | { type: 'swarm'; data: SwarmState }
  | { type: 'replay'; data: { ruleId: string; sent: number } };

export interface CorrectionInput {
  action: ModAction;
  reason: ModReason;
  /** Optional override for the rule the correction creates. */
  ruleText?: string;
}
