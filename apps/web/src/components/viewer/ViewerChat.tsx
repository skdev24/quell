'use client';

import clsx from 'clsx';
import { ArrowDown, Ban as BanIcon, Clock, Loader2, MessageSquare, ShieldAlert, ShieldCheck, ShieldX, Users } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { findBan, type Ban, type ModeratedMessage } from '@quell/shared';
import { api } from '@/lib/api';
import { REASON_LABEL, nameColor, timeOf } from '@/lib/verdict';
import { SourceBadge } from '../Badge';
import { MessageText, mentions } from '../MessageText';

const SLOW_MODE_S = 3;

interface Notice {
  id: number;
  text: string;
}

/**
 * Chat as a viewer sees it. Like Twitch AutoMod, held and removed messages never
 * reach other viewers; only their sender is told what happened.
 */
export function ViewerChat({
  messages,
  me,
  device,
  bans,
  mine,
  onSent,
  onLeave,
  viewers,
}: {
  messages: ModeratedMessage[];
  me: string;
  device: string;
  bans: Ban[];
  mine: Set<string>;
  onSent: (id: string) => void;
  onLeave: () => void;
  viewers: number;
}) {
  const visible = messages.filter((m) => isVisible(m, mine.has(m.id)));
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [text, setText] = useState('');
  const [slowUntil, setSlowUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [lastSent, setLastSent] = useState<{ id: string; at: number } | null>(null);
  const noticeId = useRef(0);
  const cooldown = Math.max(0, Math.ceil((slowUntil - now) / 1000));
  const ban = findBan(bans, me, device || undefined, now);

  // One clock drives slow mode and the status banner; it stops with the component.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useLayoutEffect(() => {
    if (pinned && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, notices, pinned]);

  // Twitch-style @ completion: chatters seen recently whose name starts with what's typed.
  const typing = /(?:^|\s)@([A-Za-z0-9_]*)$/.exec(text)?.[1];
  const suggestions =
    typing === undefined
      ? []
      : [...new Set([...visible].reverse().map((m) => m.author))]
          .filter((a) => a !== me && /^[A-Za-z0-9_]+$/.test(a) && a.toLowerCase().startsWith(typing.toLowerCase()))
          .slice(0, 5);
  const complete = (name: string) => setText((t) => t.replace(/@[A-Za-z0-9_]*$/, `@${name} `));

  const notify = (t: string) => setNotices((n) => [...n.slice(-4), { id: ++noticeId.current, text: t }]);

  const send = async () => {
    const value = text.trim();
    if (!value || cooldown > 0 || sending || ban) return;
    setSending(true);
    try {
      const { id } = await api.ingest(me, value, device || undefined);
      onSent(id);
      // Timed by this device's clock, so a phone a few seconds off the laptop still works.
      setLastSent({ id, at: Date.now() });
      setText('');
      setPinned(true);
      setSlowUntil(Date.now() + SLOW_MODE_S * 1000);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-panel lg:rounded-tw-lg">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.04em] text-fg">
          <MessageSquare className="size-4 text-dim" /> Stream chat
        </h2>
        <span className="inline-flex items-center gap-1 text-[12px] text-dim">
          <Users className="size-3.5" />
          <span className="tnum">{viewers}</span>
        </span>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
          className="h-full overflow-y-auto overscroll-contain py-2"
        >
          <p className="px-3 pb-1 text-[13px] text-dim">Welcome to the chat room!</p>
          {visible.map((m) => (
            <Line key={m.id} m={m} own={mine.has(m.id)} mentioned={!mine.has(m.id) && mentions(m.text, me)} />
          ))}
          {notices.map((n) => (
            <p key={n.id} className="px-3 py-1 text-[13px] italic text-dim">
              {n.text}
            </p>
          ))}
        </div>
        {!pinned && (
          <button
            type="button"
            onClick={() => {
              setPinned(true);
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
            }}
            className="absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-raised px-3.5 text-[13px] font-semibold text-fg shadow-lg shadow-black/60 ring-1 ring-line"
          >
            <ArrowDown className="size-4" /> More messages below
          </button>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-3 pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))]">
        <LatestStatus messages={messages} sent={lastSent} now={now} />
        {!ban && suggestions.length > 0 && (
          <ul
            role="listbox"
            aria-label="Mention someone"
            className="mb-2 overflow-hidden rounded-tw bg-raised py-1 shadow-lg shadow-black/50 ring-1 ring-line-strong"
          >
            {suggestions.map((name, i) => (
              <li key={name} role="option" aria-selected={i === 0}>
                <button
                  type="button"
                  // Keeps focus (and the phone keyboard) in the input.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => complete(name)}
                  className={clsx(
                    'flex h-9 w-full items-center px-3 text-left text-[14px] font-bold hover:bg-white/[0.08] lg:h-8 lg:text-[13px]',
                    i === 0 && 'bg-white/[0.06]',
                  )}
                  style={{ color: nameColor(name) }}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {ban ? (
          <BanNotice ban={ban} now={now} />
        ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex items-center gap-2"
        >
          <div className="flex min-w-0 flex-1 items-center rounded-tw bg-raised ring-1 ring-transparent transition focus-within:bg-bg focus-within:ring-2 focus-within:ring-purple">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (suggestions.length && (e.key === 'Tab' || e.key === 'Enter')) {
                  e.preventDefault();
                  complete(suggestions[0]);
                }
              }}
              autoComplete="off"
              // Chat is full of names, links and slang: autocorrect only mangles it.
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={300}
              enterKeyHint="send"
              placeholder="Send a message"
              aria-label="Send a message"
              className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[16px] text-fg outline-none placeholder:text-faint lg:text-[14px]"
            />
          </div>
          <button
            type="submit"
            disabled={!text.trim() || cooldown > 0 || sending}
            className="tnum inline-flex h-11 min-w-[64px] items-center justify-center rounded-tw bg-purple px-3.5 text-[14px] font-semibold text-white transition-colors hover:bg-purple-hover disabled:opacity-40"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : cooldown > 0 ? `${cooldown}s` : 'Chat'}
          </button>
        </form>
        )}
        <div className="mt-2 flex items-center justify-between text-[12px] text-faint">
          <span className="truncate">
            Chatting as{' '}
            <span className="font-bold" style={{ color: nameColor(me) }}>
              {me}
            </span>
            {cooldown > 0 && <span> · slow mode</span>}
          </span>
          <button type="button" onClick={onLeave} className="shrink-0 font-semibold text-purple-soft hover:underline">
            Change name
          </button>
        </div>
      </div>
    </section>
  );
}

/** Twitch-style: a banned viewer keeps the stream and chat, only the input is locked. */
function BanNotice({ ban, now }: { ban: Ban; now: number }) {
  const left = ban.until === null ? 0 : Math.max(0, Math.ceil((ban.until - now) / 1000));
  return (
    <div className="flex h-11 items-center gap-2.5 rounded-tw bg-remove/10 px-3 text-[13px] font-semibold text-remove">
      {ban.until === null ? <BanIcon className="size-4 shrink-0" /> : <Clock className="size-4 shrink-0" />}
      <span className="min-w-0 truncate">
        {ban.until === null ? (
          'A moderator banned you from chat'
        ) : (
          <>
            You&apos;re timed out ·{' '}
            <span className="tnum">
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
            </span>{' '}
            left
          </>
        )}
      </span>
      <span className="ml-auto shrink-0 text-[12px] font-medium text-faint">You can still watch</span>
    </div>
  );
}

const STATUS_MS = 8000;

/**
 * In a fast chat your own line scrolls away in seconds, so the fate of your latest
 * message stays pinned above the input for a moment.
 */
function LatestStatus({
  messages,
  sent,
  now,
}: {
  messages: ModeratedMessage[];
  sent: { id: string; at: number } | null;
  now: number;
}) {
  if (!sent || now - sent.at > STATUS_MS) return null;
  const latest = messages.find((m) => m.id === sent.id);
  if (!latest) return null;
  const action = latest.correction?.action ?? latest.decision?.action;
  const reason = latest.correction?.reason ?? latest.decision?.reason;

  let tone = 'bg-white/[0.06] text-dim';
  let icon = <Loader2 className="size-3.5 shrink-0 animate-spin" />;
  let text = 'Checking your message…';
  if (latest.status === 'done') {
    if (action === 'remove') {
      tone = 'bg-remove/10 text-remove';
      icon = <ShieldX className="size-3.5 shrink-0" />;
      text = `Your message was removed${reason && reason !== 'ok' ? ` · ${REASON_LABEL[reason]}` : ''}. Only you can see it.`;
    } else if (action === 'flag') {
      tone = 'bg-flag/10 text-flag';
      icon = <ShieldAlert className="size-3.5 shrink-0" />;
      text = 'Your message is held for review by moderators.';
    } else if (action === 'redact') {
      tone = 'bg-redact/10 text-redact';
      icon = <ShieldCheck className="size-3.5 shrink-0" />;
      text = 'Sent. Part of it was hidden to protect someone’s privacy.';
    } else {
      tone = 'bg-allow/10 text-allow';
      icon = <ShieldCheck className="size-3.5 shrink-0" />;
      text = 'Sent to chat.';
    }
  } else if (latest.status === 'error') {
    tone = 'bg-remove/10 text-remove';
    icon = <ShieldX className="size-3.5 shrink-0" />;
    text = 'Something went wrong sending that. Try again.';
  }

  return (
    <div className={clsx('mb-2 flex items-start gap-2 rounded-tw px-2.5 py-2 text-[13px] font-semibold leading-snug', tone)}>
      <span className="mt-px">{icon}</span>
      <span className="min-w-0">{text}</span>
    </div>
  );
}

/** What a viewer may see. Senders always see their own messages and their fate. */
function isVisible(m: ModeratedMessage, own: boolean): boolean {
  if (own || m.source === 'mod') return true;
  if (m.status !== 'done') return false;
  const action = m.correction?.action ?? m.decision?.action;
  return action === 'allow' || action === 'redact';
}

function Line({ m, own, mentioned }: { m: ModeratedMessage; own: boolean; mentioned: boolean }) {
  const action = m.correction?.action ?? m.decision?.action;
  const reason = m.correction?.reason ?? m.decision?.reason;
  const blocked = own && (action === 'remove' || action === 'flag');

  return (
    <div
      className={clsx(
        'px-3 py-[5px] text-[14px] leading-[22px] lg:text-[13px] lg:leading-5',
        own && 'bg-white/[0.04]',
        // Like Twitch, a line that @mentions you stands out.
        mentioned && 'border-l-2 border-purple bg-purple/[0.14] pl-[10px]',
      )}
    >
      <span className="tnum mr-1.5 text-[12px] text-faint">{timeOf(m.createdAt).slice(0, 5)}</span>
      <SourceBadge source={m.source} />
      <span className="font-bold" style={{ color: nameColor(m.author) }}>
        {m.author}
      </span>
      <span className="text-fg">: </span>
      <span
        className={clsx(
          'break-words',
          m.status === 'queued' ? 'text-dim' : blocked ? 'text-faint line-through decoration-faint/50' : 'text-fg',
        )}
      >
        <MessageText m={m} />
      </span>

      {own && m.status === 'queued' && (
        <span className="ml-1.5 inline-flex items-center gap-1 align-middle text-[12px] text-faint">
          <Loader2 className="size-3 animate-spin" /> checking
        </span>
      )}
      {own && action === 'flag' && (
        <span className="mt-1 flex items-start gap-1.5 rounded-tw bg-flag/10 px-2 py-1.5 text-[12.5px] leading-snug text-flag">
          <ShieldAlert className="mt-px size-3.5 shrink-0" />
          Held for review by moderators. Others can&apos;t see it unless a mod allows it.
        </span>
      )}
      {own && action === 'remove' && (
        <span className="mt-1 flex items-start gap-1.5 rounded-tw bg-remove/10 px-2 py-1.5 text-[12.5px] leading-snug text-remove">
          <ShieldX className="mt-px size-3.5 shrink-0" />
          Removed by Quell{reason && reason !== 'ok' ? ` · ${REASON_LABEL[reason]}` : ''}. Only you can see this.
        </span>
      )}
      {own && action === 'redact' && (
        <span className="mt-1 block text-[12.5px] text-redact">Part of your message was hidden to protect someone&apos;s privacy.</span>
      )}
    </div>
  );
}
