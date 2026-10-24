'use client';

import { useEffect, useReducer } from 'react';
import type { Ban, LiveState, Metrics, ModeratedMessage, Rule, StreamEvent, SwarmState } from '@quell/shared';
import { api, apiBase } from './api';

const KEEP = 400;

export interface Live {
  connected: boolean;
  ready: boolean;
  order: string[];
  byId: Record<string, ModeratedMessage>;
  rules: Rule[];
  bans: Ban[];
  metrics: Metrics | null;
  swarm: SwarmState | null;
  task: LiveState['task'] | null;
  evaluation: LiveState['evaluation'];
  lastReplay: { ruleId: string; sent: number; at: number } | null;
}

type Action =
  | { type: 'init'; state: LiveState }
  | { type: 'connected'; value: boolean }
  | StreamEvent;

const initial: Live = {
  connected: false,
  ready: false,
  order: [],
  byId: {},
  rules: [],
  bans: [],
  metrics: null,
  swarm: null,
  task: null,
  evaluation: null,
  lastReplay: null,
};

function reduce(s: Live, a: Action): Live {
  switch (a.type) {
    case 'init': {
      const byId: Record<string, ModeratedMessage> = {};
      for (const m of a.state.messages) byId[m.id] = m;
      return {
        ...s,
        ready: true,
        byId,
        order: a.state.messages.map((m) => m.id),
        rules: a.state.rules,
        bans: a.state.bans ?? [],
        metrics: a.state.metrics,
        swarm: a.state.swarm,
        task: a.state.task,
        evaluation: a.state.evaluation,
      };
    }
    case 'eval':
      return { ...s, evaluation: a.data };
    case 'reset':
      // The fresh snapshot arrives as an 'init' right after.
      return { ...s, order: [], byId: {}, rules: [], bans: [], lastReplay: null };
    case 'connected':
      return { ...s, connected: a.value };
    case 'message': {
      const existing = s.byId[a.data.id];
      // A replayed event can be older than the snapshot; never undo a decision.
      if (existing?.status === 'done' && a.data.status === 'queued') return s;
      const exists = !!existing;
      let order = exists ? s.order : [...s.order, a.data.id];
      const byId = { ...s.byId, [a.data.id]: a.data };
      if (order.length > KEEP) {
        const dropped = order.slice(0, order.length - KEEP);
        order = order.slice(-KEEP);
        for (const id of dropped) delete byId[id];
      }
      return { ...s, order, byId };
    }
    case 'rule': {
      const i = s.rules.findIndex((r) => r.id === a.data.id);
      const rules = i >= 0 ? s.rules.map((r) => (r.id === a.data.id ? a.data : r)) : [...s.rules, a.data];
      return { ...s, rules };
    }
    case 'bans':
      return { ...s, bans: a.data };
    case 'rule-removed':
      return { ...s, rules: s.rules.filter((r) => r.id !== a.data.id) };
    case 'metrics':
      return { ...s, metrics: a.data };
    case 'swarm':
      return { ...s, swarm: a.data };
    case 'replay':
      return { ...s, lastReplay: { ...a.data, at: Date.now() } };
  }
}

const EVENT_TYPES = ['message', 'rule', 'rule-removed', 'bans', 'metrics', 'swarm', 'replay', 'eval', 'reset'] as const;

/**
 * Snapshot from /state plus live updates over server-sent events. Events that
 * arrive while a snapshot is loading are held and replayed on top of it, and the
 * snapshot is reloaded after a reset or a dropped connection, so nothing is lost.
 */
export function useLive(): Live {
  const [state, dispatch] = useReducer(reduce, initial);

  useEffect(() => {
    let cancelled = false;
    let syncing = false;
    let held: StreamEvent[] = [];
    let generation = 0;

    const sync = () => {
      const mine = ++generation;
      syncing = true;
      held = [];
      api
        .state()
        .then((s) => {
          // A newer sync has started since; let that one win.
          if (cancelled || mine !== generation) return;
          dispatch({ type: 'init', state: s });
          for (const e of held) dispatch(e);
        })
        .catch(() => undefined)
        .finally(() => {
          if (mine === generation) {
            syncing = false;
            held = [];
          }
        });
    };

    const source = new EventSource(`${apiBase()}/stream`);
    let dropped = false;
    source.onopen = () => {
      dispatch({ type: 'connected', value: true });
      if (dropped) sync(); // Events were missed while disconnected.
      dropped = false;
    };
    source.onerror = () => {
      dropped = true;
      dispatch({ type: 'connected', value: false });
    };
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (e) => {
        const event = { type, data: JSON.parse((e as MessageEvent).data) } as StreamEvent;
        if (type === 'reset') {
          dispatch(event);
          sync();
        } else if (syncing) {
          held.push(event);
        } else {
          dispatch(event);
        }
      });
    }
    sync();

    return () => {
      cancelled = true;
      source.close();
    };
  }, []);

  return state;
}
