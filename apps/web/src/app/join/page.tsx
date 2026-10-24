'use client';

import { useEffect, useMemo, useState } from 'react';
import { JoinGate } from '@/components/viewer/JoinGate';
import { ChannelInfo, Stage } from '@/components/viewer/Stage';
import { ViewerChat } from '@/components/viewer/ViewerChat';
import { useLive } from '@/lib/useLive';

const NAME_KEY = 'quell-name';
const MINE_KEY = 'quell-mine';
const DEVICE_KEY = 'quell-device';

/**
 * The viewer page the room opens from the QR code: Twitch-style player and chat,
 * stacked on phones, side by side on wide screens.
 */
export default function Watch() {
  const live = useLive();
  const [me, setMe] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [device, setDevice] = useState('');

  useEffect(() => {
    setMe(storageGet(NAME_KEY));
    // A random id for this phone, so a ban sticks when someone changes their name.
    let id = storageGet(DEVICE_KEY);
    if (!id) {
      id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      storageSet(DEVICE_KEY, id);
    }
    setDevice(id);
    try {
      setMine(new Set(JSON.parse(storageGet(MINE_KEY) ?? '[]') as string[]));
    } catch {
      // Unreadable history just means no "your message" markers.
    }
    setReady(true);
  }, []);

  const messages = useMemo(() => live.order.map((id) => live.byId[id]).filter(Boolean), [live.order, live.byId]);
  const viewers = useMemo(() => new Set(messages.map((m) => m.author)).size + 1, [messages]);

  if (!ready) return <div className="min-h-[100dvh] bg-bg" />;
  if (!me) {
    return (
      <JoinGate
        onJoin={(name) => {
          storageSet(NAME_KEY, name);
          setMe(name);
        }}
      />
    );
  }

  const running = !!live.swarm?.running;
  return (
    <div className="flex h-[100dvh] flex-col bg-bg lg:flex-row lg:gap-3 lg:p-3">
      <div className="shrink-0 lg:min-w-0 lg:flex-1 lg:overflow-y-auto">
        <Stage live={running} viewers={viewers} metrics={live.metrics} />
        <ChannelInfo live={running} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:w-[360px] lg:flex-none">
        <ViewerChat
          messages={messages}
          me={me}
          device={device}
          bans={live.bans}
          mine={mine}
          viewers={viewers}
          onSent={(id) =>
            setMine((prev) => {
              const next = new Set(prev).add(id);
              storageSet(MINE_KEY, JSON.stringify([...next].slice(-200)));
              return next;
            })
          }
          onLeave={() => {
            storageSet(NAME_KEY, '');
            setMe(null);
          }}
        />
      </div>
    </div>
  );
}

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key) || null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing: the name just isn't remembered.
  }
}
