import clsx from 'clsx';
import { Ship } from 'lucide-react';

/**
 * Shipyard's channel picture: a ship mark in a ring that turns red while live,
 * as on Twitch. An icon rather than an emoji, so it looks the same on every phone.
 */
export function ChannelAvatar({ size, live, ring = 3 }: { size: number; live: boolean; ring?: number }) {
  return (
    <span
      className={clsx('block shrink-0 rounded-full', live ? 'bg-live' : 'bg-hover')}
      style={{ width: size, height: size, padding: ring }}
    >
      <span className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-[#2b1d63] to-[#170f36]">
        <Ship className="text-purple-soft" style={{ width: size * 0.46, height: size * 0.46 }} strokeWidth={2} />
      </span>
    </span>
  );
}
