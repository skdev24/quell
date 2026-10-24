'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Clapperboard, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from './primitives';

interface Step {
  title: string;
  hint: string;
  run: () => Promise<unknown>;
}

const STEPS: Step[] = [
  {
    title: 'Go live',
    hint: 'Chat starts at 2 messages a second.',
    run: () => api.swarm({ running: true, rate: 2 }),
  },
  {
    title: 'Post the mistakes',
    hint: 'Troll bait, ticket selling, recruiting and self-promo break house rules the model can’t know. Correct them from chat.',
    run: () => api.demo('teach'),
  },
  {
    title: 'Post look-alikes',
    hint: 'New messages like the ones you corrected. Watch them come out right.',
    run: () => api.demo('again'),
  },
  {
    title: 'Scam wave',
    hint: 'A scam campaign the model has never seen.',
    run: () => api.swarm({ scamWave: true }),
  },
  {
    title: 'Raid',
    hint: '150 messages at once, cleared in seconds.',
    run: () => api.raid(150),
  },
];

/** The presenter's script: each step makes one moment of the demo happen on cue. */
export function DemoMenu({ onNote }: { onNote: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<number[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirmReset(false);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const run = async (i: number) => {
    try {
      await STEPS[i].run();
      setDone((d) => [...new Set([...d, i])]);
      onNote(STEPS[i].title);
    } catch (e) {
      onNote((e as Error).message);
    }
  };

  const reset = async () => {
    try {
      await api.demo('reset');
      setDone([]);
      onNote('Demo reset: chat, rules and counters cleared');
    } catch (e) {
      onNote((e as Error).message);
    } finally {
      setConfirmReset(false);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button pill variant={open ? 'secondary' : 'ghost'} active={open} onClick={() => setOpen((o) => !o)}>
        <Clapperboard className="size-4" /> <span className="max-sm:hidden">Demo</span> <ChevronDown className="size-3.5" />
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-[38px] z-30 w-[340px] rounded-tw-lg bg-raised p-1.5 shadow-2xl shadow-black/70 ring-1 ring-line"
          >
            <p className="label px-2.5 pb-1.5 pt-1">Demo script</p>
            {STEPS.map((s, i) => (
              <button
                key={s.title}
                type="button"
                onClick={() => void run(i)}
                className="flex w-full gap-3 rounded-tw px-2.5 py-2 text-left hover:bg-white/[0.08]"
              >
                <span
                  className={clsx(
                    'mt-px grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                    done.includes(i) ? 'bg-allow/20 text-allow' : 'bg-purple text-white',
                  )}
                >
                  {done.includes(i) ? <Check className="size-3" /> : i + 1}
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-fg">{s.title}</span>
                  <span className="block text-[12px] leading-snug text-dim">{s.hint}</span>
                </span>
              </button>
            ))}
            <div className="mt-1 border-t border-line pt-1">
              {confirmReset ? (
                <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                  <span className="text-[12px] text-dim">Clear chat, rules and counters?</span>
                  <span className="flex gap-1">
                    <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                      Cancel
                    </Button>
                    <Button onClick={() => void reset()} className="text-remove">
                      Reset
                    </Button>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="flex w-full items-center gap-3 rounded-tw px-2.5 py-2 text-left text-[13px] font-semibold text-dim hover:bg-white/[0.08] hover:text-fg"
                >
                  <RotateCcw className="size-4" /> Reset demo
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
