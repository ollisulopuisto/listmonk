// Drives the real sync path against a mocked Spotify Web API: pagination,
// incremental snapshot_id refetching, and export.
//
//   node --test spotify-crate/tests/sync.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8765';

// --- fake Spotify ----------------------------------------------------------

// An inline 1x1 gif: real album art would leave the browser and fail.
const COVER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function makeTrack(n, albumIdx) {
  return {
    id: `tr${n}`,
    uri: `spotify:track:tr${n}`,
    name: `Track ${n}`,
    duration_ms: 200000,
    popularity: 50,
    artists: [{ id: `ar${albumIdx}`, name: `Artist ${albumIdx}` }],
    album: {
      id: `alb${albumIdx}`,
      name: `Album ${albumIdx}`,
      release_date: `${1990 + albumIdx}-05-01`,
      images: [{ url: COVER, width: 64, height: 64 }],
    },
  };
}

const server = {
  // p1 holds 150 tracks so the tracks endpoint has to paginate.
  playlists: [
    { id: 'p1', name: 'Kuukausi 2019-01', snapshot: 'a1', count: 150 },
    { id: 'p2', name: 'Kuukausi 2019-02', snapshot: 'b1', count: 10 },
    { id: 'p3', name: 'Not a monthly list', snapshot: 'c1', count: 5 },
  ],
  counters: { catalog: 0, trackPages: 0, trackFetchesByPlaylist: {}, created: [], added: [] },
};

// The progress modal may open and close faster than a poll can see, so wait on
// the banner sync() writes when it finishes.
function waitForSync(page) {
  return page.waitForFunction(() => {
    const b = document.getElementById('banner');
    return !b.hidden && /Synced|Created|cancelled/.test(b.textContent);
  }, null, { timeout: 20000 });
}

function clearBanner(page) {
  return page.evaluate(() => { document.getElementById('banner').hidden = true; });
}

function resetCounters() {
  server.counters.catalog = 0;
  server.counters.trackPages = 0;
  server.counters.trackFetchesByPlaylist = {};
}

function json(route, body) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });
}

async function installMock(page) {
  await page.route('**://accounts.spotify.com/api/token', (route) => json(route, {
    access_token: 'fresh-token', token_type: 'Bearer', expires_in: 3600,
  }));

  await page.route('**://api.spotify.com/**', async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;

    if (pathname === '/v1/me') return json(route, { id: 'me', display_name: 'Me' });

    if (pathname === '/v1/me/playlists') {
      server.counters.catalog += 1;
      return json(route, {
        total: server.playlists.length,
        next: null,
        items: server.playlists.map((p) => ({
          id: p.id,
          name: p.name,
          snapshot_id: p.snapshot,
          tracks: { total: p.count },
          owner: { id: 'me', display_name: 'Me' },
          images: [],
          external_urls: { spotify: `${BASE_URL}/#${p.id}` },
        })),
      });
    }

    const tracksMatch = pathname.match(/^\/v1\/playlists\/([^/]+)\/tracks$/);
    if (tracksMatch && route.request().method() === 'GET') {
      const id = tracksMatch[1];
      const pl = server.playlists.find((p) => p.id === id);
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 100);

      server.counters.trackPages += 1;
      const byPl = server.counters.trackFetchesByPlaylist;
      if (offset === 0) byPl[id] = (byPl[id] || 0) + 1;

      const items = [];
      for (let i = offset; i < Math.min(offset + limit, pl.count); i += 1) {
        items.push({
          added_at: `2019-0${pl.id === 'p1' ? 1 : 2}-1${i % 9}T10:00:00Z`,
          is_local: false,
          track: makeTrack(i, i % 4),
        });
      }
      const nextOffset = offset + limit;
      return json(route, {
        total: pl.count,
        next: nextOffset < pl.count
          ? `https://api.spotify.com/v1/playlists/${id}/tracks?offset=${nextOffset}&limit=${limit}`
          : null,
        items,
      });
    }

    if (pathname === '/v1/users/me/playlists' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      server.counters.created.push(body);
      return json(route, {
        id: 'new1', name: body.name, external_urls: { spotify: `${BASE_URL}/#created` },
      });
    }

    if (pathname === '/v1/playlists/new1/tracks' && route.request().method() === 'POST') {
      server.counters.added.push(route.request().postDataJSON().uris);
      return json(route, { snapshot_id: 'z1' });
    }

    return route.fulfill({ status: 404, body: '{}' });
  });
}

// --- harness ---------------------------------------------------------------

let browser;
let page;
const errors = [];

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await installMock(page);
  await page.goto(BASE_URL);
  // Signed in, but nothing cached: the app should offer the picker.
  await page.evaluate(() => {
    localStorage.setItem('crate.clientId', 'b'.repeat(32));
    localStorage.setItem('crate.tokens', JSON.stringify({
      accessToken: 'stale', refreshToken: 'refresh', expiresAt: Date.now() - 1000,
    }));
  });
  await page.reload();
});

test.after(async () => { await browser.close(); });

test('an empty crate opens the picker and lists the account playlists', async () => {
  await page.waitForSelector('#pickerBackdrop:not([hidden])');
  assert.equal(await page.locator('.picker-row').count(), 3);
  // The expired access token was silently refreshed to get here.
  assert.ok(server.counters.catalog >= 1);
});

test('the picker filter selects only the monthly playlists', async () => {
  await page.fill('#pickerFilter', 'Kuukausi');
  await page.waitForFunction(() => document.querySelectorAll('.picker-row').length === 2);
  await page.click('#btnPickMatching');
  await page.waitForFunction(
    () => document.getElementById('pickerCount').textContent.includes('2 playlists selected'),
  );
});

test('the first sync paginates through every selected playlist', async () => {
  resetCounters();
  await clearBanner(page);
  await page.click('#btnPickerSave');
  await waitForSync(page);

  // p1 has 150 tracks => 2 pages; p2 has 10 => 1 page. p3 was not selected.
  assert.equal(server.counters.trackPages, 3);
  assert.deepEqual(server.counters.trackFetchesByPlaylist, { p1: 1, p2: 1 });

  await page.waitForSelector('.album');
  assert.match(await page.textContent('#count'), /from 2 playlists/);
});

test('the unselected playlist stays out of the library', async () => {
  await page.fill('#q', 'playlist:"Not a monthly"');
  await page.waitForSelector('.empty');
  assert.match(await page.textContent('.empty'), /Nothing matches/);
  await page.click('#btnReset');
  await page.waitForSelector('.album');
});

test('re-syncing an unchanged crate fetches no tracks at all', async () => {
  resetCounters();
  await clearBanner(page);
  await page.click('#btnSync');
  await waitForSync(page);

  assert.equal(server.counters.catalog, 1, 'the catalog is still checked');
  assert.equal(server.counters.trackPages, 0, 'but no playlist is re-read');
  assert.match(await page.textContent('#banner'), /0 refetched, 2 unchanged/);
});

test('a changed snapshot_id refetches only that playlist', async () => {
  resetCounters();
  await clearBanner(page);
  server.playlists.find((p) => p.id === 'p2').snapshot = 'b2';

  await page.click('#btnSync');
  await waitForSync(page);

  assert.deepEqual(server.counters.trackFetchesByPlaylist, { p2: 1 });
  assert.equal(server.counters.trackPages, 1);
  assert.match(await page.textContent('#banner'), /1 refetched, 1 unchanged/);
});

test('exporting the current results creates a playlist in batches of 100', async () => {
  server.counters.created = [];
  server.counters.added = [];

  await clearBanner(page);
  // The name prompt is a real window.prompt; answer it without a dialog handler.
  await page.evaluate(() => { window.prompt = (msg, def) => def; });

  await page.fill('#q', 'artist:"Artist 1"');
  await page.waitForFunction(() => document.querySelectorAll('.album').length === 1);
  await page.click('#btnExport');
  await waitForSync(page);

  assert.match(await page.textContent('#banner'), /Created/);
  assert.equal(server.counters.created.length, 1);
  assert.equal(server.counters.created[0].public, false, 'exports are private');
  assert.ok(server.counters.added.length >= 1);

  const all = server.counters.added.flat();
  assert.ok(all.length > 0);
  assert.ok(server.counters.added.every((b) => b.length <= 100), 'batched to Spotify\'s limit');
  assert.equal(new Set(all).size, all.length, 'no duplicate URIs');
});

test('the cache survives a reload without touching the network', async () => {
  resetCounters();
  await page.reload();
  await page.waitForSelector('.album');
  assert.equal(server.counters.catalog, 0, 'no API call needed to browse');
  assert.match(await page.textContent('#count'), /from 2 playlists/);
});

test('nothing threw along the way', () => {
  assert.deepEqual(errors, []);
});
