'use client';

import { Check, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChannelAvatar } from './ChannelAvatar';

/** Twitch-style channel bar: who is live, what the stream is, how busy chat is. */
export function StreamHeader({
  live,
  chatters,
  since,
}: {
  live: boolean;
  chatters: number;
  since: number | null;
}) {
  const now = useNow();
  return (
    <div className="flex items-center gap-4 rounded-tw-lg bg-panel px-4 py-3.5">
      <div className="relative shrink-0">
        <ChannelAvatar size={56} live={live} />
        {live && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-[3px] bg-live px-1 text-[10px] font-bold uppercase leading-[16px] text-white">
            Live
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-fg">Shipyard</h1>
          <span className="grid size-4 place-items-center rounded-full bg-purple text-[9px] text-white" title="Verified">
            <Check className="size-2.5" strokeWidth={3.5} />
          </span>
        </div>
        <p className="mt-0.5 truncate text-[14px] font-semibold text-fg">Office hours: shipping v1.0 live, ask us anything</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-purple-soft">Software and Game Development</span>
          {['DevOps', 'OpenSource', 'English'].map((t) => (
            <span key={t} className="rounded-full bg-white/[0.08] px-2 text-[12px] font-semibold leading-5 text-dim">
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="inline-flex items-center gap-1 text-[14px] font-semibold text-remove">
          <User className="size-4" />
          <span className="tnum">{chatters}</span>
        </div>
        <div className="tnum mt-0.5 text-[13px] text-dim">{since && live ? uptime(now - since) : 'Offline'}</div>
      </div>
    </div>
  );
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function uptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
