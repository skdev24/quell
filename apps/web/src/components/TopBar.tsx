'use client';

import clsx from 'clsx';
import { Pause, Play, Siren, Waves } from 'lucide-react';
import type { SwarmState } from '@quell/shared';
import { api } from '@/lib/api';
import { DemoMenu } from './DemoMenu';
import { JoinQR } from './JoinQR';
import { Button } from './primitives';

const RATES = [1, 3, 8, 20];

export function TopBar({
  swarm,
  connected,
  queued,
  onNote,
}: {
  swarm: SwarmState | null;
  connected: boolean;
  queued: number;
  onNote: (note: string) => void;
}) {
  const running = swarm?.running ?? false;
  return (
    <header className="relative z-10 flex h-[50px] shrink-0 items-center gap-2 sm:gap-3 bg-panel px-3 shadow-[0_1px_2px_rgb(0_0_0/0.9),0_0_2px_rgb(0_0_0/0.9)]">
      <div className="flex items-center gap-2.5 pl-1">
        <Logo />
        <span className="text-[16px] font-bold tracking-[-0.01em] text-fg">Quell</span>
        <span className="hidden rounded-tw bg-white/[0.08] px-1.5 text-[11px] xl:inline font-semibold uppercase leading-5 tracking-wide text-dim">
          Mod view
        </span>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        <JoinQR />
        <DemoMenu onNote={onNote} />
        <span className="mx-1 hidden h-5 w-px bg-line-strong sm:block" />
        <Button
          variant={running ? 'secondary' : 'primary'}
          pill
          onClick={() => void api.swarm({ running: !running }).catch((e: Error) => onNote(e.message))}
          title="Start or pause the simulated community"
        >
          {running ? <Pause className="size-4" /> : <Play className="size-4" />}
          <span className="whitespace-nowrap">{running ? 'Pause chat' : 'Go live'}</span>
        </Button>
        <div className="h-[30px] items-center rounded-full bg-white/[0.08] p-0.5 max-lg:hidden flex">
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => void api.swarm({ rate: r }).catch((e: Error) => onNote(e.message))}
              className={clsx(
                'tnum h-[26px] rounded-full px-2.5 text-[12px] font-semibold transition-colors',
                swarm?.rate === r ? 'bg-purple text-white' : 'text-dim hover:text-fg',
              )}
            >
              {r}/s
            </button>
          ))}
        </div>
        <Button
          pill
          onClick={() =>
            void api
              .raid(150)
              .then((r) => onNote(`Raid incoming: ${r.posted} messages`))
              .catch((e: Error) => onNote(e.message))
          }
          className="max-lg:hidden"
          title="Flood the channel with a raid"
        >
          <Siren className="size-4 text-remove" /> Raid
        </Button>
        <Button
          pill
          active={swarm?.scamWave}
          onClick={() =>
            void api
              .swarm({ scamWave: !swarm?.scamWave })
              .then((s) => onNote(s.scamWave ? 'A new scam campaign started' : 'Scam campaign ended'))
              .catch((e: Error) => onNote(e.message))
          }
          title="Start a scam campaign the model hasn't seen"
          className="max-lg:hidden"
        >
          <Waves className={clsx('size-4', swarm?.scamWave ? 'text-remove' : 'text-dim')} /> Scam wave
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-3 pl-1 pr-1 text-[12px] text-dim">
        {queued > 0 && <span className="tnum hidden xl:inline">{queued} queued</span>}
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <span className={clsx('relative size-2 rounded-full', connected ? 'bg-allow' : 'bg-remove')}>
            {connected && running && <span className="absolute inset-0 animate-ping rounded-full bg-allow/60" />}
          </span>
          <span className="max-lg:sr-only">{connected ? 'Connected' : 'Offline'}</span>
        </span>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <rect width="26" height="26" rx="6" fill="#9147ff" />
      <path d="M6.5 13.5c3-4.4 10-4.4 13 0" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M10 17.2c1.7-1.9 4.3-1.9 6 0" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
