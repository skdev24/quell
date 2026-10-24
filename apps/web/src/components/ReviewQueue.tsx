'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Check, EyeOff, Flag, Loader2, ShieldAlert, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CorrectionInput, ModAction, ModReason, ModeratedMessage } from '@quell/shared';
import { api } from '@/lib/api';
import { ACTION_LABEL, ACTION_TONE, REASON_LABEL, nameColor, timeOf } from '@/lib/verdict';
import { MessageText } from './MessageText';
import { Button, Panel } from './primitives';

const REMOVE_REASONS: ModReason[] = ['scam', 'spam', 'harassment', 'off_topic', 'slur'];

export interface Selection {
  id: string;
  /** Opened from a chat mod icon: start straight in this correction. */
  action?: ModAction;
}

/** Everything the model held, removed or redacted, AutoMod-queue style. */
export function ReviewQueue({
  needs,
  all,
  selected,
  selection,
  onClearSelection,
  onCorrected,
}: {
  /** Messages a moderator must decide: held, or removed without high confidence. */
  needs: ModeratedMessage[];
  /** Everything the model held, removed or redacted, to double-check. */
  all: ModeratedMessage[];
  selected: ModeratedMessage | null;
  selection: Selection | null;
  onClearSelection: () => void;
  onCorrected: (note: string) => void;
}) {
  const [tab, setTab] = useState<'needs' | 'all'>('needs');
  const queue = tab === 'needs' ? needs : all;
  // While the pointer is over the list it holds still; new items wait behind a button.
  const [frozen, setFrozen] = useState<string[] | null>(null);
  const live = selected && !selected.correction ? [selected, ...queue.filter((m) => m.id !== selected.id)] : queue;
  const byId = new Map(live.map((m) => [m.id, m]));
  const items = frozen
    ? [
        ...(selected && !selected.correction && !frozen.includes(selected.id) ? [selected] : []),
        ...frozen.map((id) => byId.get(id)).filter((m): m is ModeratedMessage => !!m),
      ]
    : live;
  const waiting = frozen ? live.filter((m) => !frozen.includes(m.id)).length : 0;

  return (
    <Panel
      title="AutoMod queue"
      icon={<ShieldAlert className="size-3.5 text-dim" />}
      className="relative"
      meta={
        <div className="flex rounded-full bg-white/[0.06] p-0.5">
          {(
            [
              ['needs', 'Needs you', needs.length],
              ['all', 'All actions', all.length],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={clsx(
                'h-6 rounded-full px-2.5 text-[12px] font-semibold transition-colors',
                tab === id ? 'bg-purple text-white' : 'text-dim hover:text-fg',
              )}
            >
              {label} <span className="tnum opacity-80">{n}</span>
            </button>
          ))}
        </div>
      }
    >
      <AnimatePresence>
        {waiting > 0 && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            onClick={() => setFrozen(live.map((m) => m.id))}
            className="absolute left-1/2 top-[50px] z-10 h-[30px] -translate-x-1/2 rounded-full bg-purple px-3 text-[12px] font-semibold text-white shadow-lg shadow-black/50 hover:bg-purple-hover"
          >
            <span className="tnum">{waiting}</span> new
          </motion.button>
        )}
      </AnimatePresence>
      <div
        className="h-full overflow-y-auto overscroll-contain p-2"
        onPointerEnter={() => setFrozen(live.map((m) => m.id))}
        onPointerLeave={() => setFrozen(null)}
      >
        {items.length === 0 && (
          <div className="grid h-full place-items-center px-8 text-center">
            <div>
              <ShieldAlert className="mx-auto mb-3 size-8 text-hover" />
              <p className="text-[14px] font-semibold text-fg">All caught up</p>
              <p className="mt-1 text-[12px] leading-relaxed text-dim">
                {tab === 'needs'
                  ? 'Quell handled everything on its own. Held messages and unsure removals land here.'
                  : 'Held, removed and redacted messages show up here. Hover any chat line to correct it.'}
              </p>
            </div>
          </div>
        )}
        <AnimatePresence initial={false}>
          {items.map((m) => (
            <Card
              key={m.id}
              m={m}
              pinned={m.id === selected?.id}
              startWith={m.id === selection?.id ? selection.action : undefined}
              onDismiss={m.id === selected?.id ? onClearSelection : undefined}
              onCorrected={onCorrected}
            />
          ))}
        </AnimatePresence>
      </div>
    </Panel>
  );
}

type Draft = { action: ModAction; reason: ModReason };

function defaultDraft(m: ModeratedMessage, action: ModAction): Draft {
  const r = m.decision?.reason;
  if (action === 'allow') return { action, reason: 'ok' };
  if (action === 'redact') return { action, reason: 'personal_info' };
  return { action, reason: r && r !== 'ok' && r !== 'personal_info' ? r : action === 'flag' ? 'off_topic' : 'scam' };
}

function Card({
  m,
  pinned,
  startWith,
  onDismiss,
  onCorrected,
}: {
  m: ModeratedMessage;
  pinned: boolean;
  startWith?: ModAction;
  onDismiss?: () => void;
  onCorrected: (note: string) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rule, setRule] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = m.decision;

  const open = (next: Draft) => {
    setDraft(next);
    setRule(suggestRule(m, next));
    setError(null);
  };

  useEffect(() => {
    if (startWith) open(defaultDraft(m, startWith));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith]);

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const input: CorrectionInput = { ...draft, ruleText: rule };
      const res = await api.correct(m.id, input);
      onCorrected(`Rule added · re-judging ${res.replaying} message${res.replaying === 1 ? '' : 's'} through Mubit`);
      onDismiss?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tone = d ? ACTION_TONE[d.action] : null;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 32, transition: { duration: 0.16 } }}
      transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
      className={clsx('mb-2 overflow-hidden rounded-tw-lg bg-raised', pinned && 'ring-2 ring-purple')}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <span className={clsx('size-2 rounded-full', tone?.dot ?? 'bg-faint')} />
        <span className="text-[12px] font-semibold text-fg">
          {d ? `${ACTION_LABEL[d.action]} · ${REASON_LABEL[d.reason]}` : 'Not judged'}
        </span>
        <span className="text-[12px] text-faint">
          {d?.confidence} confidence{m.safetyNet && ' · safety net'}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="tnum text-[11px] text-faint">{timeOf(m.createdAt)}</span>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="grid size-6 place-items-center rounded-tw text-dim hover:bg-white/[0.08] hover:text-fg"
              aria-label="Close"
            >
              <X className="size-3.5" />
            </button>
          )}
        </span>
      </div>

      <p className="mx-3 mt-2 break-words rounded-tw bg-bg/60 px-3 py-2 text-[13px] leading-5">
        <span className="font-bold" style={{ color: nameColor(m.author) }}>
          {m.author}
        </span>
        <span className="text-fg">: </span>
        <span className="text-fg">
          <MessageText m={m} />
        </span>
      </p>

      {!draft ? (
        <div className="flex flex-wrap items-center gap-1 px-3 pb-3 pt-2.5">
          <Button variant="primary" onClick={() => open(defaultDraft(m, 'allow'))}>
            <Check className="size-4" /> Allow
          </Button>
          <Button onClick={() => open(defaultDraft(m, 'remove'))}>
            <Trash2 className="size-4 text-remove" /> Remove
          </Button>
          <Button onClick={() => open(defaultDraft(m, 'redact'))}>
            <EyeOff className="size-4 text-redact" /> Redact
          </Button>
          <Button variant="ghost" onClick={() => open(defaultDraft(m, 'flag'))}>
            <Flag className="size-4 text-flag" /> Hold
          </Button>
        </div>
      ) : (
        <div className="mx-3 mb-3 mt-2.5 border-t border-line pt-2.5">
          <p className="mb-2 text-[12px] font-semibold text-fg">
            Correct to <span className={ACTION_TONE[draft.action].text}>{ACTION_LABEL[draft.action].toLowerCase()}</span>
          </p>
          {(draft.action === 'remove' || draft.action === 'flag') && (
            <div className="mb-2.5 flex flex-wrap gap-1">
              {REMOVE_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    const next = { ...draft, reason: r };
                    setDraft(next);
                    setRule(suggestRule(m, next));
                  }}
                  className={clsx(
                    'h-6 rounded-full px-2.5 text-[12px] font-semibold transition-colors',
                    draft.reason === r ? 'bg-purple text-white' : 'bg-white/[0.08] text-dim hover:text-fg',
                  )}
                >
                  {REASON_LABEL[r]}
                </button>
              ))}
            </div>
          )}
          <label className="label mb-1.5 flex items-center gap-1.5 normal-case tracking-normal">
            <Sparkles className="size-3.5 text-purple-soft" /> Rule the model will learn
          </label>
          <textarea
            value={rule}
            onChange={(e) => setRule(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-tw bg-bg px-3 py-2 text-[13px] leading-5 text-fg outline-none ring-1 ring-line transition focus:ring-2 focus:ring-purple"
          />
          {error && <p className="mt-1.5 text-[12px] text-remove">{error}</p>}
          <div className="mt-2 flex items-center justify-end gap-1">
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy || !rule.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Teach the model
            </Button>
          </div>
        </div>
      )}
    </motion.article>
  );
}

function suggestRule(m: ModeratedMessage, d: Draft): string {
  const snippet = m.text.length > 90 ? `${m.text.slice(0, 87)}…` : m.text;
  switch (d.action) {
    case 'allow':
      return `Messages like "${snippet}" are normal in this community. Allow them.`;
    case 'remove':
      return `Messages like "${snippet}" are ${REASON_LABEL[d.reason].toLowerCase()}. Remove them.`;
    case 'flag':
      return `Messages like "${snippet}" need a human moderator. Flag them.`;
    case 'redact':
      return `Messages like "${snippet}" contain personal information. Redact that part and allow the rest.`;
  }
}
