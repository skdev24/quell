import type { Verdict } from '@quell/shared';

export interface Persona {
  id: string;
  weight: number;
  /** What this community wants done with messages like this persona's. */
  expected: Verdict;
  /** Brief for the generator model. */
  brief: string;
  authors: string[];
  /** How each author talks, so the same name always sounds like the same person. */
  voices?: Record<string, string>;
}

// Shipyard's real norms live here, as ground truth. The moderation model never
// sees this file: it only learns these norms from moderator corrections.
export const PERSONAS: Persona[] = [
  {
    id: 'regular',
    weight: 30,
    expected: { action: 'allow', reason: 'ok' },
    brief:
      'a long-time member using the server\'s in-jokes: "gm", "ship it 🚢", "lgtm", "wagmi", ":shipit:", "yolo deploy friday", "works on my machine", "rm -rf node_modules and pray". Casual, lowercase, emoji.',
    authors: ['mira', 'devon_k', 'tobi', 'ana.codes', 'raj', 'lena', 'kofi', 'sam_w', 'yuki', 'ollie'],
    voices: {
      mira: 'cheerful, says gm to everyone, ☕ and 🚢 emoji',
      devon_k: 'dry senior SRE, few words, no emoji',
      tobi: 'excitable junior, lots of "omg" and "lmao"',
      'ana.codes': 'helpful, links docs, ends with :shipit:',
      raj: 'night owl, always deploying at 2am',
      lena: 'sarcastic about YAML and config files',
      kofi: 'hypes every release and win, sometimes in caps',
      sam_w: 'asks follow-up questions, curious',
      yuki: 'short replies, "real", "same", "+1"',
      ollie: 'British, "cheers", "mate", dry jokes',
    },
  },
  {
    id: 'dark_humor',
    weight: 10,
    expected: { action: 'allow', reason: 'ok' },
    brief:
      'a developer making violent-sounding but harmless dev jokes common on this server, e.g. "kill -9 the intern\'s process", "I\'m going to murder this flaky test", "just drop the prod db lol", "nuke the cache from orbit". Never aimed at a real person.',
    authors: ['grim_ops', 'nadia', 'felix', 'chen_dev', 'bo'],
    voices: {
      grim_ops: 'deadpan ops gallows humour',
      nadia: 'threatens flaky tests and CI, never people',
      felix: 'over-the-top dramatic about bugs',
      chen_dev: 'calm but jokes about nuking things',
      bo: 'one-liners, all lowercase',
    },
  },
  {
    id: 'helper',
    weight: 14,
    expected: { action: 'allow', reason: 'ok' },
    brief:
      'a member asking or answering a real technical question about deploying with Shipyard (configs, CLI errors, rollbacks, env vars), sometimes sharing a github.com link to an issue.',
    authors: ['priya', 'marco', 'hannah', 'jules', 'ade'],
    voices: {
      priya: 'maintainer-ish, precise answers with flags and env vars',
      marco: 'asks real questions with the exact error text',
      hannah: 'answers with "try X, fixed it for me"',
      jules: 'links github issues and PRs',
      ade: 'new to Shipyard, asks beginner questions politely',
    },
  },
  {
    id: 'banter',
    weight: 8,
    expected: { action: 'allow', reason: 'ok' },
    brief:
      'friendly roasting between regulars: "ratio", "skill issue", "touch grass", "imagine using yaml in 2026". Teasing, not hostile.',
    authors: ['zed', 'kat', 'luis', 'mo'],
    voices: {
      zed: 'roasts friends with "skill issue"',
      kat: 'quick comebacks, "ratio"',
      luis: 'teases about yaml and windows',
      mo: '"touch grass", laughs at own jokes',
    },
  },
  {
    id: 'troll',
    weight: 6,
    expected: { action: 'flag', reason: 'off_topic' },
    brief:
      'a troll posting low-effort bait or off-topic provocation ("vercel is better, this project is dead", politics, "who even uses this"). Annoying but not abusive.',
    authors: ['xX_real_Xx', 'nobody123', 'just_asking'],
    voices: {
      xX_real_Xx: 'says other tools are better, baits',
      nobody123: 'low effort "who even uses this"',
      just_asking: 'drags in politics and off-topic drama as "just asking"',
    },
  },
  {
    id: 'harasser',
    weight: 4,
    expected: { action: 'remove', reason: 'harassment' },
    brief:
      'someone attacking another member personally and repeatedly ("@mira you are useless, quit coding", "nobody wants you here"). No slurs or profanity.',
    authors: ['angry_dev', 'r3vng'],
    voices: {
      angry_dev: 'picks on one regular from recent chat by @name, belittling their skills',
      r3vng: 'holds a grudge against someone in chat and keeps telling them to leave',
    },
  },
  {
    id: 'scammer',
    weight: 7,
    expected: { action: 'remove', reason: 'scam' },
    brief:
      'a scam bot: fake airdrops, "DM me for free credits", fake support asking for API keys or seed phrases, crypto wallet addresses, shortened links. Friendly tone, urgency.',
    authors: ['Shipyard_Support', 'airdrop_bot', 'admin.helper', 'crypto_kate'],
    voices: {
      Shipyard_Support: 'fake official support, asks for API keys "to verify"',
      airdrop_bot: 'airdrop with a short link and urgency',
      'admin.helper': 'replies to someone\'s question offering to help in DMs',
      crypto_kate: 'friendly, pushes a wallet address and "free credits"',
    },
  },
  {
    id: 'raider',
    weight: 3,
    expected: { action: 'remove', reason: 'spam' },
    brief: 'a raid spammer repeating the same short message with an invite link, caps, and emoji.',
    authors: ['raid_7781', 'raid_0193', 'raid_4420'],
  },
  {
    id: 'doxxer',
    weight: 4,
    expected: { action: 'redact', reason: 'personal_info' },
    brief:
      'someone posting another person\'s (made-up) home address, phone number or personal email in an otherwise ordinary sentence.',
    authors: ['loose_lips', 'tea_spiller'],
    voices: {
      loose_lips: 'gossips about another member and drops their made-up address or phone',
      tea_spiller: 'spills "tea" with a made-up personal email or address in passing',
    },
  },
];

/** Added on top of the others while the "new scam wave" is on. */
export const SCAM_WAVE: Persona = {
  id: 'scam_wave',
  weight: 24,
  expected: { action: 'remove', reason: 'scam' },
  brief:
    'a NEW scam campaign: fake "Shipyard Pro lifetime licence giveaway" and "Shipyard Season 2 rewards" posts that link to look-alike sites (shipyard-pro.app, claim-shipyard.xyz) and ask people to "verify" with their GitHub token. Looks official, uses the project\'s own words.',
  authors: ['ShipyardTeam', 'shipyard.rewards', 'mod_announcements'],
};
