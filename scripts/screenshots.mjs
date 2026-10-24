#!/usr/bin/env node
// Captures README screenshots from the running app (web on :3100, API on :4000)
// with the locally installed Chrome, then renders the showcase pages in
// docs/showcase to images. Run the app with some live chat first.
//
//   node scripts/screenshots.mjs
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (name) => join(root, 'docs', 'images', name);
const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const CHROME =
  process.env.CHROME_PATH ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(existsSync);

const API = process.env.API_URL ?? 'http://localhost:4000/api';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, body = {}) =>
  fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) =>
    r.json(),
  );
const state = () => fetch(`${API}/state`).then((r) => r.json());

// The four house-rule corrections from the demo script.
const LESSONS = [
  ['vercel is better', 'flag', 'off_topic', 'Bait claiming Shipyard is dead or worse than other tools is trolling here. Hold it for a moderator.'],
  ['selling 2 spare', 'remove', 'spam', 'No buying, selling or trading in #general. Remove sales posts.'],
  ["we're hiring", 'flag', 'off_topic', 'Job posts and recruiting belong in #jobs. Hold them for a moderator.'],
  ['new video:', 'flag', 'off_topic', 'Self-promotion (videos, streams, own links) belongs in #showcase. Hold it for a moderator.'],
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
try {
  // Moderator console.
  const mod = await browser.newPage();
  await mod.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
  // A clean session: chat, then the four messages that break house rules.
  await post('/demo/reset');
  await post('/swarm', { running: true, rate: 2, scamWave: false });
  await mod.goto(WEB, { waitUntil: 'load' }); // the live stream never goes idle
  await wait(25_000);
  await post('/demo/teach');
  await wait(9_000);

  // A correction in progress, on a real mistake: ticket selling the model allowed.
  const handle = await mod.evaluateHandle(() =>
    [...document.querySelectorAll('main > section:last-of-type .group')].find((el) =>
      el.textContent.includes('selling 2 spare'),
    ),
  );
  const line = handle.asElement();
  if (line) {
    await line.scrollIntoView();
    await line.hover();
    await wait(300);
    await (await line.$('button[title="Remove"]'))?.click();
    await wait(1000);
    await (await mod.$('main > section:first-child'))?.screenshot({ path: out('correction.png') });
  }

  // Teach all four, post the look-alikes, then let normal chat run.
  for (const m of (await state()).messages) {
    const lesson = LESSONS.find(([needle]) => m.persona === 'demo' && m.text.toLowerCase().includes(needle));
    if (lesson && !m.correction) {
      await post(`/messages/${m.id}/correct`, { action: lesson[1], reason: lesson[2], ruleText: lesson[3] });
    }
  }
  await wait(5_000);
  await post('/demo/again');
  await wait(30_000);

  await mod.reload({ waitUntil: 'load' });
  await mod.waitForSelector('main > section:first-child article', { timeout: 30_000 });
  await wait(3_000);
  await mod.screenshot({ path: out('mod-view.png') });

  // The model panel on its own.
  const model = await mod.$('main > div > section');
  await model?.screenshot({ path: out('model-panel.png') });

  // Viewer on a phone: join screen, then chat after posting a scam.
  const phone = await browser.newPage();
  await phone.emulate({
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await phone.goto(`${WEB}/join`, { waitUntil: 'load' });
  await phone.evaluate(() => {
    localStorage.removeItem('quell-name');
    localStorage.removeItem('quell-mine');
  });
  await phone.reload({ waitUntil: 'load' });
  await phone.waitForSelector('#username', { timeout: 30_000 });
  await phone.type('#username', 'night_owl');
  await wait(300);
  await phone.screenshot({ path: out('join-phone.png') });
  await phone.click('button[type="submit"]');
  await phone.waitForSelector('input[placeholder="Send a message"]', { timeout: 30_000 });
  await wait(3000);
  await phone.type('input[placeholder="Send a message"]', 'DM me your seed phrase and I’ll double your ETH 🚀');
  await phone.keyboard.press('Enter');
  await wait(4000);
  await phone.screenshot({ path: out('viewer-phone.png') });

  // Viewer on a wide screen.
  const wide = await browser.newPage();
  await wide.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });
  await wide.goto(`${WEB}/join`, { waitUntil: 'load' });
  await wait(4000);
  await wide.screenshot({ path: out('viewer-desktop.png') });

  // Showcase pages, composed from the captures above.
  for (const [page, file, width, height] of [
    ['hero.html', 'hero.png', 1600, 900],
    ['how-it-works.html', 'how-it-works.png', 1600, 760],
  ]) {
    const p = await browser.newPage();
    await p.setViewport({ width, height, deviceScaleFactor: 2 });
    await p.goto(pathToFileURL(join(root, 'docs', 'showcase', page)).href, { waitUntil: 'networkidle0' });
    await wait(600);
    await p.screenshot({ path: out(file) });
  }
  await post('/swarm', { running: false });
  console.log('Saved to docs/images');
} finally {
  await browser.close();
}
