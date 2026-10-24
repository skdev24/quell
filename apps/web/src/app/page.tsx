'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { needsHuman, type ModAction } from '@quell/shared';
import { Chat } from '@/components/Chat';
import { LearningPanel } from '@/components/LearningPanel';
import { ReviewQueue, type Selection } from '@/components/ReviewQueue';
import { StreamHeader } from '@/components/StreamHeader';
import { TopBar } from '@/components/TopBar';
import { useLive } from '@/lib/useLive';

const QUEUE_LIMIT = 60;

export default function ModView() {
  const live = useLive();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [note, setNote] = useState<{ text: string; id: number } | null>(null);

  const messages = useMemo(() => live.order.map((id) => live.byId[id]).filter(Boolean), [live.order, live.byId]);
  const all = useMemo(
    () =>
      messages
        .filter((m) => m.status === 'done' && m.decision && m.decision.action !== 'allow' && !m.correction && !m.cached)
        .slice(-QUEUE_LIMIT)
        .reverse(),
    [messages],
  );
  const needs = useMemo(
    () =>
      messages
        .filter((m) => m.status === 'done' && m.decision && !m.correction && !m.cached && needsHuman(m.decision))
        .reverse(),
    [messages],
  );
  const selected = selection ? live.byId[selection.id] ?? null : null;
  const chatters = useMemo(() => new Set(messages.map((m) => m.author)).size, [messages]);
  const since = messages.length ? messages[0].createdAt : null;

  const flash = (text: string) => setNote({ text, id: Date.now() });

  useEffect(() => {
    if (live.lastReplay) flash(`${live.lastReplay.sent} corrected examples recorded by Mubit`);
  }, [live.lastReplay]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3800);
    return () => clearTimeout(t);
  }, [note]);

  return (
    <div className="flex h-screen flex-col">
      <TopBar swarm={live.swarm} connected={live.connected} queued={live.metrics?.queued ?? 0} onNote={flash} />
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(320px,1fr)_minmax(0,1.15fr)_minmax(340px,380px)] gap-2.5 p-2.5">
        <ReviewQueue
          needs={needs}
          all={all}
          selected={selected}
          selection={selection}
          onClearSelection={() => setSelection(null)}
          onCorrected={flash}
        />
        <div className="flex min-h-0 flex-col gap-2.5">
          <StreamHeader live={!!live.swarm?.running} chatters={chatters} since={since} />
          <LearningPanel metrics={live.metrics} rules={live.rules} task={live.task} evaluation={live.evaluation} />
        </div>
        <Chat
          messages={messages}
          selectedId={selection?.id ?? null}
          onSelect={(id: string, action?: ModAction) => setSelection({ id, action })}
        />
      </main>

      <AnimatePresence>
        {note && (
          <motion.div
            key={note.id}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-tw-lg bg-raised px-4 py-2.5 text-[13px] font-semibold text-fg shadow-2xl shadow-black/70 ring-1 ring-purple/50"
          >
            <Sparkles className="size-4 text-purple-soft" />
            {note.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
