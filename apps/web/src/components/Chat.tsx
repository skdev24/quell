'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, Check, EyeOff, MessageSquare, Sparkles, Trash2, Users } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ModAction, ModeratedMessage } from '@quell/shared';
import { api } from '@/lib/api';
import { ACTION_LABEL, nameColor, timeOf } from '@/lib/verdict';
import { MessageText } from './MessageText';
import { Panel } from './primitives';

/** Twitch-style chat column: compact lines, coloured names, mod actions on hover. */
export function Chat({
  messages,
  selectedId,
  onSelect,
}: {
  messages: ModeratedMessage[];
  selectedId: string | null;
  onSelect: (id: string, action?: ModAction) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const lastId = useRef<string | undefined>(undefined);
  const [unseen, setUnseen] = useState(0);

  // Track the newest message by id, not the count: the list is capped, so its
  // length stops changing once chat is busy.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const newest = messages[messages.length - 1]?.id;
    const at = lastId.current ? messages.findIndex((m) => m.id === lastId.current) : -1;
    const added = newest === lastId.current ? 0 : at >= 0 ? messages.length - 1 - at : messages.length;
    lastId.current = newest;
    if (pinned) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    } else if (added > 0) {
      setUnseen((n) => n + added);
    }
  }, [messages, pinned]);

  const chatters = new Set(messages.map((m) => m.author)).size;

  return (
    <Panel
      title="Chat"
      icon={<MessageSquare className="size-3.5 text-dim" />}
      className="relative"
      meta={
        <span className="inline-flex items-center gap-1 tnum">
          <Users className="size-3.5" /> {chatters}
        </span>
      }
    >
      <div className="flex h-full flex-col">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2"
        >
          {messages.length === 0 && (
            <p className="px-5 py-3 text-[13px] text-dim">Welcome to the chat room!</p>
          )}
          {messages.map((m) => (
            <Line key={m.id} m={m} selected={m.id === selectedId} onSelect={onSelect} />
          ))}
        </div>

        <AnimatePresence>
          {!pinned && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })}
              className="absolute bottom-[86px] left-1/2 inline-flex h-[30px] -translate-x-1/2 items-center gap-1.5 rounded-full bg-raised px-3 text-[12px] font-semibold text-fg shadow-lg shadow-black/50 hover:bg-hover"
            >
              <ArrowDown className="size-3.5" />
              {unseen > 0 ? `${unseen} new messages` : 'Chat paused due to scroll'}
            </motion.button>
          )}
        </AnimatePresence>

        <ChatInput />
      </div>
    </Panel>
  );
}

function Line({
  m,
  selected,
  onSelect,
}: {
  m: ModeratedMessage;
  selected: boolean;
  onSelect: (id: string, action?: ModAction) => void;
}) {
  const action = m.correction?.action ?? m.decision?.action;
  const removed = action === 'remove';
  const held = action === 'flag';

  return (
    <div
      className={clsx(
        'group relative px-5 py-[5px] text-[13px] leading-5 transition-colors',
        selected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]',
        held && 'border-l-2 border-flag/70 bg-flag/[0.06] pl-[18px]',
      )}
    >
      {/* Inline mod actions, like Twitch's mod icons. */}
      <span className="absolute right-3 top-1 hidden items-center gap-0.5 rounded-tw bg-raised p-0.5 shadow-lg shadow-black/40 group-focus-within:flex group-hover:flex">
        <ModIcon label="Fine here" onClick={() => onSelect(m.id, 'allow')}>
          <Check className="size-3.5 text-allow" />
        </ModIcon>
        <ModIcon label="Remove" onClick={() => onSelect(m.id, 'remove')}>
          <Trash2 className="size-3.5 text-remove" />
        </ModIcon>
        <ModIcon label="Redact" onClick={() => onSelect(m.id, 'redact')}>
          <EyeOff className="size-3.5 text-redact" />
        </ModIcon>
      </span>

      <span className="tnum mr-1.5 text-[12px] text-faint">{timeOf(m.createdAt).slice(0, 5)}</span>
      {m.source === 'crowd' && (
        <span
          title="Posted from the room"
          className="mr-1 inline-grid size-[18px] translate-y-[3px] place-items-center rounded-[3px] bg-purple text-[10px] font-bold text-white"
        >
          ★
        </span>
      )}
      <button
        type="button"
        onClick={() => onSelect(m.id)}
        className="font-bold hover:underline"
        style={{ color: nameColor(m.author) }}
      >
        {m.author}
      </button>
      <span className="text-fg">: </span>
      {removed ? (
        <span className="italic text-faint">
          <span className="line-through decoration-faint/60">{m.text}</span>
          <span className="not-italic"> · removed by Quell</span>
        </span>
      ) : (
        // Unchecked text is blurred: it may contain personal details not yet redacted.
        <span
          className={clsx('break-words text-fg', m.status === 'queued' && 'checking select-none rounded-[3px] text-dim blur-[3px]')}
        >
          <MessageText m={m} />
        </span>
      )}

      {(held || m.correction || m.rejudged || m.cached || m.status === 'error') && (
        <span className="ml-2 inline-flex translate-y-[-1px] items-center gap-1 align-middle text-[11px] font-semibold">
          {held && !m.correction && <span className="text-flag">Held for review</span>}
          {m.correction && (
            <span className="inline-flex items-center gap-1 text-purple-soft">
              <Sparkles className="size-3" /> Taught · {ACTION_LABEL[m.correction.action].toLowerCase()}
            </span>
          )}
          {!m.correction && m.rejudged && <span className="text-purple-soft">Re-judged</span>}
          {m.cached && <span className="text-faint">duplicate</span>}
          {m.status === 'error' && <span className="text-remove">error</span>}
        </span>
      )}
    </div>
  );
}

function ModIcon({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-[3px] hover:bg-white/[0.1]"
    >
      {children}
    </button>
  );
}

/** Send a message into the channel as the moderator; it is moderated like any other. */
function ChatInput() {
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await api.ingest('you', value);
      setText('');
      setNote(null);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <div className="flex items-center rounded-tw bg-raised px-3 ring-1 ring-transparent transition focus-within:bg-bg focus-within:ring-purple">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send()}
          maxLength={300}
          placeholder="Send a message"
          aria-label="Send a message"
          className="h-10 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="truncate pr-2 text-[11px] text-remove">{note}</span>
        <button
          type="button"
          onClick={() => void send()}
          disabled={!text.trim() || busy}
          className="h-[30px] rounded-tw bg-purple disabled:opacity-40 px-3 text-[13px] font-semibold text-white hover:bg-purple-hover"
        >
          Chat
        </button>
      </div>
    </div>
  );
}
