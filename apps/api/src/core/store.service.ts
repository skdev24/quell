import { Injectable } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { banActive, findBan, type Ban, type ModeratedMessage, type Rule } from '@quell/shared';
import { config } from './config';

const KEEP_IN_MEMORY = 4000;

/**
 * Session state. Everything lives in memory for the live view and is written
 * through to SQLite (Node's built-in driver) so a restart keeps rules and history.
 */
@Injectable()
export class StoreService {
  private readonly db: DatabaseSync;
  private readonly saveMessage: StatementSync;
  private readonly saveRule: StatementSync;
  private readonly deleteRule: StatementSync;
  private readonly saveCounter: StatementSync;
  private readonly saveBan: StatementSync;
  private readonly deleteBan: StatementSync;

  private readonly messages = new Map<string, ModeratedMessage>();
  private order: string[] = [];
  rules: Rule[] = [];
  private bans = new Map<string, Ban>();
  readonly counters = { corrections: 0, trainingExamples: 0, tokensIn: 0, tokensOut: 0 };

  constructor() {
    mkdirSync(config.dataDir, { recursive: true });
    this.db = new DatabaseSync(join(config.dataDir, 'quell.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, created_at INTEGER, json TEXT);
      CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, created_at INTEGER, json TEXT);
      CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER);
      CREATE TABLE IF NOT EXISTS bans (id TEXT PRIMARY KEY, json TEXT);
    `);
    this.saveMessage = this.db.prepare(
      'INSERT OR REPLACE INTO messages (id, created_at, json) VALUES (?, ?, ?)',
    );
    this.saveRule = this.db.prepare('INSERT OR REPLACE INTO rules (id, created_at, json) VALUES (?, ?, ?)');
    this.deleteRule = this.db.prepare('DELETE FROM rules WHERE id = ?');
    this.saveCounter = this.db.prepare('INSERT OR REPLACE INTO counters (name, value) VALUES (?, ?)');
    this.saveBan = this.db.prepare('INSERT OR REPLACE INTO bans (id, json) VALUES (?, ?)');
    this.deleteBan = this.db.prepare('DELETE FROM bans WHERE id = ?');
    this.load();
  }

  private load(): void {
    const rows = this.db
      .prepare('SELECT json FROM messages ORDER BY created_at DESC LIMIT ?')
      .all(KEEP_IN_MEMORY) as { json: string }[];
    for (const row of rows.reverse()) {
      const m = JSON.parse(row.json) as ModeratedMessage;
      // Anything still queued when the server stopped will never finish.
      if (m.status === 'queued') m.status = 'error';
      this.messages.set(m.id, m);
      this.order.push(m.id);
    }
    const rules = this.db.prepare('SELECT json FROM rules ORDER BY created_at').all() as { json: string }[];
    this.rules = rules.map((r) => JSON.parse(r.json) as Rule);
    const counters = this.db.prepare('SELECT name, value FROM counters').all() as { name: string; value: number }[];
    for (const c of counters) {
      if (c.name in this.counters) this.counters[c.name as keyof typeof this.counters] = c.value;
    }
    for (const row of this.db.prepare('SELECT json FROM bans').all() as { json: string }[]) {
      const ban = JSON.parse(row.json) as Ban;
      this.bans.set(ban.id, ban);
    }
  }

  putMessage(m: ModeratedMessage): void {
    if (!this.messages.has(m.id)) {
      this.order.push(m.id);
      if (this.order.length > KEEP_IN_MEMORY) {
        const dropped = this.order.splice(0, this.order.length - KEEP_IN_MEMORY);
        for (const id of dropped) this.messages.delete(id);
      }
    }
    this.messages.set(m.id, m);
    this.saveMessage.run(m.id, m.createdAt, JSON.stringify(m));
  }

  getMessage(id: string): ModeratedMessage | undefined {
    return this.messages.get(id);
  }

  /** Newest last. */
  recent(limit: number): ModeratedMessage[] {
    return this.order.slice(-limit).map((id) => this.messages.get(id)!);
  }

  allMessages(): ModeratedMessage[] {
    return this.order.map((id) => this.messages.get(id)!);
  }

  putRule(rule: Rule): void {
    const i = this.rules.findIndex((r) => r.id === rule.id);
    if (i >= 0) this.rules[i] = rule;
    else this.rules.push(rule);
    this.saveRule.run(rule.id, rule.createdAt, JSON.stringify(rule));
  }

  removeRule(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    this.deleteRule.run(id);
    return this.rules.length !== before;
  }

  /** Bans still in force; expired timeouts are dropped as they're found. */
  activeBans(): Ban[] {
    const now = Date.now();
    for (const b of this.bans.values()) if (!banActive(b, now)) this.removeBan(b.id);
    return [...this.bans.values()];
  }

  banFor(author: string, device?: string): Ban | undefined {
    return findBan([...this.bans.values()], author, device);
  }

  putBan(ban: Ban): void {
    this.bans.set(ban.id, ban);
    this.saveBan.run(ban.id, JSON.stringify(ban));
  }

  removeBan(id: string): boolean {
    this.deleteBan.run(id);
    return this.bans.delete(id);
  }

  /** Clears chat, rules, bans and counters for a fresh demo. The Mubit task lock is untouched. */
  reset(): void {
    this.db.exec('DELETE FROM messages; DELETE FROM rules; DELETE FROM counters; DELETE FROM bans;');
    this.bans.clear();
    this.messages.clear();
    this.order = [];
    this.rules = [];
    for (const name of Object.keys(this.counters) as (keyof StoreService['counters'])[]) this.counters[name] = 0;
  }

  bump(name: keyof StoreService['counters'], by = 1): void {
    this.counters[name] += by;
    this.saveCounter.run(name, this.counters[name]);
  }
}
