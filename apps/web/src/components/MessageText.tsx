import { Fragment } from 'react';
import { redactedSpans, type ModeratedMessage } from '@quell/shared';

/** @name, as typed in chat: letters, digits and underscores, like a Twitch login. */
export const MENTION = /(@[A-Za-z0-9_]{1,24})/g;

/** Whether a message @mentions this name. */
export function mentions(text: string, name: string): boolean {
  const lower = `@${name.toLowerCase()}`;
  return (text.match(MENTION) ?? []).some((m) => m.toLowerCase() === lower);
}

/**
 * Renders a message with redacted spans as solid bars, so nothing leaks on
 * screen, and @mentions in bold like Twitch.
 */
export function MessageText({ m }: { m: ModeratedMessage }) {
  const spans = redactedSpans(m);
  if (!spans.length) return <Mentions text={m.text} />;

  const pattern = new RegExp(`(${spans.map(escape).join('|')})`, 'g');
  return (
    <>
      {m.text.split(pattern).map((part, i) =>
        spans.includes(part) ? (
          <span
            key={i}
            title="Redacted"
            className="mx-px inline-block h-[1.05em] max-w-full translate-y-[2px] rounded-[3px] bg-redact/25 align-baseline ring-1 ring-inset ring-redact/30"
            style={{ width: `${Math.min(part.length, 16) * 0.55}em` }}
          />
        ) : (
          <Mentions key={i} text={part} />
        ),
      )}
    </>
  );
}

function Mentions({ text }: { text: string }) {
  return (
    <>
      {text.split(MENTION).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="font-bold text-fg">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
