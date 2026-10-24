'use client';

import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { nameColor } from '@/lib/verdict';
import { ChannelAvatar } from '../ChannelAvatar';

const RULES = [
  'Be kind. Roasting friends is fine, attacking people is not.',
  'No buying, selling or trading.',
  'Job posts go in #jobs, self-promo in #showcase.',
  'Never share anyone’s personal details.',
];

const VALID = /^[a-zA-Z0-9_]{3,24}$/;

/** Twitch-style "join chat" step: choose a username, read the house rules. */
export function JoinGate({ onJoin }: { onJoin: (name: string) => void }) {
  const [name, setName] = useState('');
  const valid = VALID.test(name);
  const showError = name.length > 0 && !valid;

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-bg px-4 py-[max(24px,env(safe-area-inset-top))]">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center gap-3">
          <ChannelAvatar size={56} live />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[18px] font-bold">Shipyard</span>
              <span className="rounded-[3px] bg-live px-1.5 text-[11px] font-bold uppercase leading-[18px] text-white">Live</span>
            </div>
            <p className="truncate text-[14px] text-dim">Office hours: shipping v1.0 live</p>
          </div>
        </div>

        <div className="mt-6 rounded-tw-lg bg-panel p-5 ring-1 ring-line">
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">Join the chat</h1>
          <p className="mt-1 text-[14px] text-dim">Pick a username to chat with everyone watching.</p>

          <label htmlFor="username" className="label mt-5 block">
            Username
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) onJoin(name);
            }}
          >
            <div className="mt-2 flex items-center rounded-tw bg-raised ring-1 ring-transparent transition focus-within:bg-bg focus-within:ring-2 focus-within:ring-purple">
              <span className="pl-3 text-[16px] text-faint">@</span>
              <input
                id="username"
                value={name}
                onChange={(e) => setName(e.target.value.replace(/\s/g, ''))}
                maxLength={24}
                autoComplete="nickname"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="your_name"
                className="h-12 min-w-0 flex-1 bg-transparent px-1.5 text-[16px] text-fg outline-none placeholder:text-faint"
              />
            </div>
            <p className={`mt-1.5 min-h-[18px] text-[12px] ${showError ? 'text-remove' : 'text-faint'}`}>
              {showError ? '3–24 letters, numbers or underscores' : name && valid ? (
                <>
                  You&apos;ll appear as{' '}
                  <span className="font-bold" style={{ color: nameColor(name) }}>
                    {name}
                  </span>
                </>
              ) : (
                ' '
              )}
            </p>

            <div className="mt-3 rounded-tw bg-bg/60 p-3.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-fg">
                <ShieldCheck className="size-4 text-purple-soft" /> Chat rules
              </div>
              <ul className="mt-2 space-y-1.5">
                {RULES.map((r) => (
                  <li key={r} className="flex gap-2 text-[13px] leading-snug text-dim">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-purple-soft" />
                    {r}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[12px] text-faint">Moderated live by Quell, an AI that learns from this channel’s mods.</p>
            </div>

            <button
              type="submit"
              disabled={!valid}
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-tw bg-purple text-[15px] font-semibold text-white transition-colors hover:bg-purple-hover disabled:opacity-40"
            >
              Agree and join chat <ArrowRight className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
