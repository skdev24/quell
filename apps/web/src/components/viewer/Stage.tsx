'use client';

import { Check, ShieldCheck, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Metrics } from '@quell/shared';
import { ChannelAvatar } from '../ChannelAvatar';

// What's "on stream": the team shipping v1.0 from a terminal.
const LOG = [
  '$ shipyard deploy --env production',
  '→ building image shipyard/api:1.0.0',
  '✓ image built in 41s',
  '→ running migrations (3 pending)',
  '✓ migrations applied',
  '→ blue/green: starting green (4 instances)',
  '✓ health checks passing 4/4',
  '→ shifting traffic 10% … 50% … 100%',
  '✓ v1.0.0 is live',
  '$ shipyard logs --follow',
  '200 GET /healthz 3ms',
  '200 GET /v1/deploys 18ms',
  '201 POST /v1/deploys 142ms',
];

/** The player area: a live terminal, LIVE badge, viewers and Quell's protection stats. */
export function Stage({ live, viewers, metrics }: { live: boolean; viewers: number; metrics: Metrics | null }) {
  const [lines, setLines] = useState(4);
  useEffect(() => {
    const t = setInterval(() => setLines((n) => (n >= LOG.length + 6 ? 4 : n + 1)), 1600);
    return () => clearInterval(t);
  }, []);

  const removed = metrics ? metrics.byAction.remove + metrics.byAction.flag : 0;

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-[#0b0716] lg:rounded-tw-lg">
      {/* Soft brand glow behind the terminal. */}
      <div className="absolute -left-1/4 -top-1/3 h-[120%] w-[80%] rounded-full bg-purple/25 blur-[90px]" />
      <div className="absolute -bottom-1/3 right-0 h-[90%] w-[60%] rounded-full bg-[#1f69ff]/15 blur-[90px]" />

      <div className="absolute inset-x-[6%] bottom-[16%] top-[16%] overflow-hidden rounded-tw-lg bg-black/60 font-mono text-[clamp(9px,1.6vw,14px)] leading-[1.6] ring-1 ring-white/10 backdrop-blur">
        <div className="flex h-[2.2em] items-center gap-1.5 border-b border-white/10 px-3">
          <span className="size-[0.7em] rounded-full bg-[#ff5f57]" />
          <span className="size-[0.7em] rounded-full bg-[#febc2e]" />
          <span className="size-[0.7em] rounded-full bg-[#28c840]" />
          <span className="ml-2 text-white/40">shipyard — production</span>
        </div>
        <div className="flex flex-col justify-end px-3 py-2">
          {LOG.slice(Math.max(0, Math.min(lines, LOG.length) - 9), Math.min(lines, LOG.length)).map((l) => (
            <div key={l} className={l.startsWith('✓') ? 'text-allow' : l.startsWith('$') ? 'text-white' : 'text-white/60'}>
              {l}
            </div>
          ))}
          <div className="text-white">
            <span className="inline-block h-[1em] w-[0.55em] translate-y-[0.15em] animate-pulse bg-white/80" />
          </div>
        </div>
      </div>

      <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5 sm:left-3 sm:top-3">
        {live ? (
          <span className="rounded-[3px] bg-live px-1.5 text-[12px] font-bold uppercase leading-5 text-white">Live</span>
        ) : (
          <span className="rounded-[3px] bg-black/60 px-1.5 text-[12px] font-bold uppercase leading-5 text-white/80">Offline</span>
        )}
        <span className="inline-flex items-center gap-1 rounded-[3px] bg-black/60 px-1.5 text-[12px] font-semibold leading-5 text-white">
          <User className="size-3" /> <span className="tnum">{viewers}</span>
        </span>
      </div>

      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 sm:bottom-3 sm:left-3 sm:right-3">
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11.5px] font-semibold text-white backdrop-blur sm:text-[12px]">
          <ShieldCheck className="size-3.5 shrink-0 text-purple-soft" />
          <span className="truncate">
            Protected by Quell · <span className="tnum">{metrics?.moderated ?? 0}</span> checked ·{' '}
            <span className="tnum">{removed}</span> stopped
          </span>
        </span>
      </div>
    </div>
  );
}

/** Channel row under the player, as on Twitch. */
export function ChannelInfo({ live }: { live: boolean }) {
  return (
    <div className="flex items-start gap-3 px-3 py-3 lg:px-0">
      <ChannelAvatar size={48} ring={2} live={live} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h1 className="text-[16px] font-bold sm:text-[18px]">Shipyard</h1>
          <span className="grid size-4 place-items-center rounded-full bg-purple text-[9px] text-white" title="Verified">
            <Check className="size-2.5" strokeWidth={3.5} />
          </span>
        </div>
        <p className="mt-0.5 text-[14px] font-semibold leading-snug text-fg">Office hours: shipping v1.0 live, ask us anything</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-purple-soft">Software and Game Development</span>
          {/* Tags are a desktop nicety; on phones chat gets the space. */}
          {['DevOps', 'OpenSource'].map((t) => (
            <span key={t} className="hidden rounded-full bg-white/[0.08] px-2 text-[12px] font-semibold leading-5 text-dim sm:inline">
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
