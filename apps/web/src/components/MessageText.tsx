import { redactedSpans, type ModeratedMessage } from '@quell/shared';

/** Renders a message with redacted spans as solid bars, so nothing leaks on screen. */
export function MessageText({ m }: { m: ModeratedMessage }) {
  const spans = redactedSpans(m);
  if (!spans.length) return <>{m.text}</>;

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
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
