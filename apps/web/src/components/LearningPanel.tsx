'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Brain, X } from 'lucide-react';
import { REVIEW_SECONDS, type Ban, type EvalRun, type Metrics, type Rule } from '@quell/shared';
import { api } from '@/lib/api';
import { timeOf } from '@/lib/verdict';
import { Benchmark } from './Benchmark';
import { Panel } from './primitives';

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const ms = (x: number | null) => (x === null ? '—' : x >= 1000 ? `${(x / 1000).toFixed(2)}s` : `${x}ms`);

export function LearningPanel({
  metrics,
  rules,
  task,
  evaluation,
  bans,
  onNote,
}: {
  metrics: Metrics | null;
  rules: Rule[];
  task: { model: string; fingerprint: string } | null;
  evaluation: EvalRun | null;
  bans: Ban[];
  onNote: (note: string) => void;
}) {
  const m = metrics;
  return (
    <Panel
      title="Model"
      icon={<Brain className="size-3.5 text-dim" />}
      meta={m && <span className="tnum">{m.graded} graded</span>}
    >
      <div className="h-full overflow-y-auto overscroll-contain p-3">
        <Workload m={m} />

        <div className="mt-2 rounded-tw-lg bg-raised p-3.5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="label">Agrees with your mods</div>
              <div className="tnum mt-1.5 text-[36px] font-bold leading-none tracking-[-0.02em] text-fg">
                {pct(m?.accuracy ?? null)}
              </div>
            </div>
            <Sparkline values={m?.accuracySeries ?? []} />
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-dim">
            Share of chat where the model made the call your moderators would.
          </p>
        </div>

        <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          <Stat label="Wrongly blocked" value={m ? String(m.wrongfulRemovals) : '—'} tone={m && m.wrongfulRemovals > 0 ? 'text-flag' : undefined} />
          <Stat label="Scams caught" value={m ? `${m.scamsCaught}/${m.scamsTotal}` : '—'} />
          <Stat label="Info hidden" value={m ? `${m.piiRedacted}/${m.piiTotal}` : '—'} />
          <Stat label="Msgs / min" value={m ? String(m.throughputPerMin) : '—'} />
          <Stat label="Latency p50" value={ms(m?.latencyP50 ?? null)} />
          <Stat label="Duplicates" value={m ? String(m.cached) : '—'} />
        </dl>

        <Benchmark run={evaluation} />

        <div className="mt-2 rounded-tw-lg bg-raised p-3.5">
          <div className="flex items-baseline justify-between">
            <div className="label">Corrections → training</div>
            <span className="tnum text-[12px] text-dim">{m?.corrections ?? 0} corrections</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tnum text-[24px] font-bold tracking-[-0.02em] text-fg">{m?.trainingExamples ?? 0}</span>
            <span className="text-[13px] text-dim">corrected examples sent to Mubit</span>
          </div>
          <TrainingBar examples={m?.trainingExamples ?? 0} />
        </div>

        <div className="mt-2 rounded-tw-lg bg-raised p-3.5">
          <div className="flex items-baseline justify-between">
            <div className="label">Community rules</div>
            <span className="tnum text-[12px] text-dim">{rules.length}</span>
          </div>
          {rules.length === 0 ? (
            <p className="mt-2 text-[12px] leading-relaxed text-dim">
              None yet. Every correction becomes a rule here, and a training example for your model.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              <AnimatePresence initial={false}>
                {[...rules].reverse().map((r) => (
                  <motion.li
                    key={r.id}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="group relative rounded-tw border-l-2 border-purple bg-bg/60 py-2 pl-3 pr-7"
                  >
                    <p className="text-[12.5px] leading-[1.45] text-fg">{r.text}</p>
                    <p className="tnum mt-1 text-[11px] font-semibold text-purple-soft">
                      {r.examples} example{r.examples === 1 ? '' : 's'} sent
                    </p>
                    <button
                      type="button"
                      onClick={() => void api.removeRule(r.id).catch((e: Error) => onNote(e.message))}
                      className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-tw text-faint opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                      aria-label="Remove rule"
                    >
                      <X className="size-3" />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>

        {bans.length > 0 && (
          <div className="mt-2 rounded-tw-lg bg-raised p-3.5">
            <div className="flex items-baseline justify-between">
              <div className="label">Kept out of chat</div>
              <span className="tnum text-[12px] text-dim">{bans.length}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {bans.map((b) => (
                <li key={b.id} className="flex items-center gap-2 rounded-tw bg-bg/60 py-1.5 pl-3 pr-1.5 text-[12.5px]">
                  <span className="min-w-0 truncate font-semibold text-fg">{b.author}</span>
                  <span className="shrink-0 text-faint">
                    {b.until === null ? 'banned' : `timed out until ${timeOf(b.until).slice(0, 5)}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => void api.unban(b.id).catch((e: Error) => onNote(e.message))}
                    className="ml-auto h-6 shrink-0 rounded-tw px-2 text-[12px] font-semibold text-purple-soft hover:bg-white/[0.08]"
                  >
                    Unban
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {task && (
          <div className="mt-2 rounded-tw-lg bg-raised p-3.5">
            <div className="flex items-center justify-between">
              <div className="label">Mubit task</div>
              <a
                href="https://app.mubit.ai/console/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-purple-soft hover:underline"
              >
                Console <ArrowUpRight className="size-3.5" />
              </a>
            </div>
            <dl className="mt-2 space-y-1 text-[12px]">
              <Row k="Teacher" v={task.model} />
              <Row k="Fingerprint" v={task.fingerprint} />
              <Row k="Tokens" v={m ? `${fmt(m.tokensIn)} in · ${fmt(m.tokensOut)} out` : '—'} />
            </dl>
            <p className="mt-2 text-[11.5px] leading-relaxed text-dim">
              Mubit trains a Qwen3 adapter on these calls. It answers silent copies first, then a share of live chat.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** The usefulness number: how much of chat no moderator had to touch. */
function Workload({ m }: { m: Metrics | null }) {
  const rate = m?.autoRate ?? null;
  const auto = m?.autoHandled ?? 0;
  const review = m?.needsReview ?? 0;
  const corrected = m?.corrections ?? 0;
  const total = auto + review + corrected;
  const share = (n: number) => (total ? `${(n / total) * 100}%` : '0%');
  return (
    <div className="rounded-tw-lg bg-gradient-to-br from-purple/25 to-raised p-3.5 ring-1 ring-purple/30">
      <div className="label">Handled without a moderator</div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="tnum text-[36px] font-bold leading-none tracking-[-0.02em] text-fg">{pct(rate)}</div>
        <div className="pb-0.5 text-right text-[12px] leading-snug text-dim">
          <div>
            <span className="tnum font-semibold text-fg">~{m?.minutesSaved ?? 0} min</span> of reading saved
          </div>
          <div className="text-faint">at {REVIEW_SECONDS}s per message</div>
        </div>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full bg-purple-soft transition-[width] duration-500" style={{ width: share(auto) }} />
        <div className="h-full bg-flag transition-[width] duration-500" style={{ width: share(review) }} />
        <div className="h-full bg-allow transition-[width] duration-500" style={{ width: share(corrected) }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-dim">
        <Legend color="bg-purple-soft" label="Automatic" value={auto} />
        <Legend color="bg-flag" label="Needs a mod" value={review} />
        <Legend color="bg-allow" label="Corrected" value={corrected} />
      </div>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx('size-2 rounded-full', color)} />
      {label} <span className="tnum font-semibold text-fg">{value}</span>
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-tw-lg bg-raised px-3 py-2.5">
      <dt className="truncate text-[11px] font-semibold text-dim">{label}</dt>
      <dd className={clsx('tnum mt-0.5 text-[18px] font-bold tracking-[-0.01em] text-fg', tone)}>{value}</dd>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-dim">{k}</dt>
      <dd className="truncate font-mono text-[11.5px] text-fg">{v}</dd>
    </div>
  );
}

/** Progress towards the next adapter version (Mubit retrains every 25 new kept examples). */
function TrainingBar({ examples }: { examples: number }) {
  const step = 25;
  const into = examples % step;
  const batches = Math.floor(examples / step);
  return (
    <div className="mt-3">
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
        <motion.div
          className="h-full rounded-full bg-purple"
          animate={{ width: `${(into / step) * 100}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
      <p className="tnum mt-1.5 text-[12px] text-dim">
        {into}/{step} towards the next version · {batches} batch{batches === 1 ? '' : 'es'} complete
      </p>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 120;
  const h = 40;
  if (values.length < 2) return <div className="h-10 w-[120px]" />;
  const min = Math.min(...values, 0.5);
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / (max - min || 1)) * (h - 6)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-purple)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--color-purple)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w} ${h} L0 ${h} Z`} fill="url(#spark)" />
      <path d={d} fill="none" stroke="var(--color-purple-soft)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill="var(--color-purple-soft)" />
    </svg>
  );
}

function fmt(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
