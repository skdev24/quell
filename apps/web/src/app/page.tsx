'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Brain, MessageSquare, ShieldAlert, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { banActive, findBan, needsHuman, type ModAction, type ModeratedMessage } from '@quell/shared';
import { Chat } from '@/components/Chat';
import { LearningPanel } from '@/components/LearningPanel';
import { ReviewQueue, type Selection } from '@/components/ReviewQueue';
import { StreamHeader } from '@/components/StreamHeader';
import { TopBar } from '@/components/TopBar';
import { api } from '@/lib/api';
import { useLive } from '@/lib/useLive';

const QUEUE_LIMIT = 60;
/** A column fills its grid cell on wide screens and the whole main area on small ones. */
const column = 'min-h-0 flex-1 flex-col lg:flex [&>section]:flex-1';

export default function ModView() {
  const live = useLive();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [view, setView] = useState<'queue' | 'model' | 'chat'>('queue');
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

  const banOf = (m: ModeratedMessage) => findBan(live.bans, m.author, m.device);
  const ban = (id: string, minutes: number | null) => {
    const author = live.byId[id]?.author ?? 'They';
    api
      .ban(id, minutes)
      .then(() => flash(minutes ? `${author} is timed out for ${minutes} minutes` : `${author} is banned from chat`))
      .catch((e: Error) => flash(e.message));
  };
  const unban = (banId: string) => void api.unban(banId).catch((e: Error) => flash(e.message));

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
      {/* Three columns on laptops and up; one panel at a time with a tab bar below that. */}
      <main className="flex min-h-0 flex-1 flex-col p-2.5 pb-[calc(64px+env(safe-area-inset-bottom))] lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_300px] xl:grid-cols-[minmax(300px,1fr)_minmax(0,1.1fr)_minmax(320px,380px)] lg:gap-2.5 lg:pb-2.5">
        <div className={clsx(column, view === 'queue' ? 'flex' : 'hidden')}>
          <ReviewQueue
            needs={needs}
            all={all}
            selected={selected}
            selection={selection}
            lookup={(id) => live.byId[id]}
            banOf={banOf}
            onBan={ban}
            onUnban={unban}
            onClearSelection={() => setSelection(null)}
            onCorrected={flash}
          />
        </div>
        <div className={clsx(column, 'gap-2.5', view === 'model' ? 'flex' : 'hidden')}>
          <div className="hidden xl:block">
            <StreamHeader live={!!live.swarm?.running} chatters={chatters} since={since} />
          </div>
          <LearningPanel
            metrics={live.metrics}
            rules={live.rules}
            task={live.task}
            evaluation={live.evaluation}
            bans={live.bans.filter((b) => banActive(b))}
            onNote={flash}
          />
        </div>
        <div className={clsx(column, view === 'chat' ? 'flex' : 'hidden')}>
          <Chat
            messages={messages}
            selectedId={selection?.id ?? null}
            banOf={banOf}
            onBan={ban}
            onSelect={(id: string, action?: ModAction) => {
              setSelection({ id, action, at: Date.now() });
              // On small screens the correction opens in the queue, so go there.
              setView('queue');
            }}
          />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden">
        {(
          [
            ['queue', 'Queue', ShieldAlert, needs.length],
            ['model', 'Model', Brain, null],
            ['chat', 'Chat', MessageSquare, null],
          ] as const
        ).map(([id, label, Icon, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={clsx(
              'relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[12px] font-semibold',
              view === id ? 'text-fg' : 'text-dim',
            )}
          >
            {view === id && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-purple" />}
            <Icon className="size-5" />
            {label}
            {count ? (
              <span className="tnum absolute right-[calc(50%-26px)] top-2 min-w-5 rounded-full bg-purple px-1.5 text-[11px] leading-5 text-white">
                {count}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <AnimatePresence>
        {note && (
          <motion.div
            key={note.id}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none fixed bottom-20 left-1/2 z-50 lg:bottom-5 flex -translate-x-1/2 items-center gap-2 rounded-tw-lg bg-raised px-4 py-2.5 text-[13px] font-semibold text-fg shadow-2xl shadow-black/70 ring-1 ring-purple/50"
          >
            <Sparkles className="size-4 text-purple-soft" />
            {note.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
