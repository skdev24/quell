import { Sword } from 'lucide-react';
import type { MessageSource } from '@quell/shared';
import { Tip } from './primitives';

/**
 * Chat badge in front of a name, Twitch-style: the green sword for moderators,
 * a star for people chatting from their phone in the room.
 */
export function SourceBadge({ source }: { source: MessageSource }) {
  if (source === 'mod') {
    return (
      <Tip label="Moderator">
        <span className="mr-1 inline-grid size-[18px] translate-y-[3px] place-items-center rounded-[3px] bg-[#00ad03] text-white">
          <Sword className="size-3" strokeWidth={2.5} />
        </span>
      </Tip>
    );
  }
  if (source === 'crowd') {
    return (
      <Tip label="Watching in the room">
        <span className="mr-1 inline-grid size-[18px] translate-y-[3px] place-items-center rounded-[3px] bg-purple text-[10px] font-bold text-white">
          ★
        </span>
      </Tip>
    );
  }
  return null;
}
