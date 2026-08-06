// Browser smoke test. Seeds a fake synced crate into IndexedDB, then drives the
// real UI — no Spotify calls are made.
//
//   node --test spotify-crate/tests/ui.test.mjs
//
// Expects the app to be served at BASE_URL (default http://127.0.0.1:8765).

import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8765';

const ARTISTS = ['Radiohead', 'Aphex Twin', 'Björk', 'Boards of Canada', 'Talk Talk', 'Slowdive'];
const ALBUMS = [
  ['Kid A', 2000], ['Drukqs', 2001], ['Homogenic', 1997],
  ['Music Has the Right to Children', 1998], ['Laughing Stock', 1991], ['Souvlaki', 1993],
];

// 24 monthly playlists, each holding a handful of albums; one album is
// deliberately filed twice so the "filed 2x" path gets exercised.
function fakeCrate() {
  const playlists = [];
  for (let i = 0; i < 24; i += 1) {
    const year = 2019 + Math.floor(i / 12);
    const month = String((i % 12) + 1).padStart(2, '0');
    const tracks = [];

    for (let j = 0; j < 4; j += 1) {
      const idx = (i + j) % ALBUMS.length;
      const [albumName, year0] = ALBUMS[idx];
      for (let k = 0; k < 3; k += 1) {
        tracks.push({
          id: `t-${idx}-${k}`,
          uri: `spotify:track:t-${idx}-${k}`,
          name: `${albumName} track ${k + 1}`,
          durationMs: 180000 + k * 1000,
          popularity: 40,
          artists: [{ id: `a-${idx}`, name: ARTISTS[idx] }],
          albumId: `al-${idx}`,
          albumName,
          releaseDate: `${year0}-01-01`,
          albumImage: null,
          addedAt: `${year}-${month}-1${k}T10:00:00Z`,
        });
      }
    }

    playlists.push({
      id: `p${i}`,
      name: `Kuukausi ${year}-${month}`,
      snapshotId: `snap-${i}`,
      total: tracks.length,
      owner: 'me',
      ownerId: 'me',
      image: null,
      url: null,
      tracks,
    });
  }
  return playlists;
}

async function seed(page, playlists) {
  await page.evaluate(async (pls) => {
    localStorage.setItem('crate.clientId', 'a'.repeat(32));
    localStorage.setItem('crate.tokens', JSON.stringify({
      accessToken: 'fake', refreshToken: 'fake-refresh', expiresAt: Date.now() + 3600e3,
    }));

    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('spotify-crate', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('playlists')) d.createObjectStore('playlists', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    await new Promise((resolve, reject) => {
      const t = db.transaction(['playlists', 'meta'], 'readwrite');
      const store = t.objectStore('playlists');
      pls.forEach((p) => store.put(p));
      const meta = t.objectStore('meta');
      meta.put(pls.map((p) => p.id), 'selectedPlaylistIds');
      meta.put(new Date().toISOString(), 'lastSync');
      meta.put(pls.map(({ tracks, ...rest }) => rest), 'catalog');
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }, playlists);
}

// Waiting on a count alone is racy: the previous query may already show the
// right number of albums, so the wait passes against a stale grid. Wait for the
// exact titles instead.
function showsAlbums(page, names) {
  return page.waitForFunction((expected) => {
    const got = [...document.querySelectorAll('.album .album-title')]
      .map((e) => e.textContent);
    return got.length === expected.length
      && expected.every((n) => got.some((g) => g.includes(n)));
  }, names);
}

const ALL_ALBUMS = ALBUMS.map(([name]) => name);

let browser;
let page;
const consoleErrors = [];

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // Fail loudly rather than silently hitting the network.
  await page.route('**://api.spotify.com/**', (r) => r.abort());
  await page.route('**://accounts.spotify.com/**', (r) => r.abort());

  await page.goto(BASE_URL);
  await seed(page, fakeCrate());
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
});

test.after(async () => {
  await browser.close();
});

test('signed-out visitors get setup instructions with the exact redirect URI', async () => {
  const fresh = await browser.newPage();
  await fresh.goto(`${BASE_URL}?t=setup`);
  await fresh.waitForSelector('#setup:not([hidden])');
  assert.equal(await fresh.textContent('#redirectUri'), `${BASE_URL}/`);
  await fresh.close();
});

test('a synced crate renders as albums, deduplicated across months', async () => {
  await page.waitForSelector('.album');
  // 6 distinct albums across 24 playlists, not 24 x 4 entries.
  assert.equal(await page.locator('.album').count(), 6);

  const count = await page.textContent('#count');
  assert.match(count, /18 tracks/);
  assert.match(count, /6 albums/);
  assert.match(count, /24 playlists/);
});

test('an album filed in many months says so', async () => {
  const pill = page.locator('.album', { hasText: 'Kid A' }).locator('.pill.hot');
  assert.match(await pill.textContent(), /filed \d+×/);
});

test('free-text search narrows the grid', async () => {
  await page.fill('#q', 'bjork');
  await showsAlbums(page, ['Homogenic']);
  assert.match(await page.textContent('.album .album-artist'), /Björk/);
});

test('field-scoped search works from the UI', async () => {
  await page.fill('#q', 'artist:"Boards of Canada"');
  await showsAlbums(page, ['Music Has the Right to Children']);

  await page.fill('#q', 'year:1991');
  await showsAlbums(page, ['Laughing Stock']);
});

test('a query matching nothing shows the empty state, not a broken grid', async () => {
  await page.fill('#q', 'zzzznothing');
  await page.waitForSelector('.empty');
  assert.match(await page.textContent('.empty'), /Nothing matches/);
});

test('reset clears the query and restores every album', async () => {
  await page.click('#btnReset');
  await showsAlbums(page, ALL_ALBUMS);
  assert.equal(await page.inputValue('#q'), '');
});

test('clicking an artist facet appends a scoped term', async () => {
  await page.locator('#facetArtists .facet-item', { hasText: 'Slowdive' }).click();
  await showsAlbums(page, ['Souvlaki']);
  assert.equal(await page.inputValue('#q'), 'artist:"Slowdive"');
  await page.click('#btnReset');
});

test('a decade facet fills the release-year range', async () => {
  await page.locator('#facetDecades .facet-item', { hasText: '1990s' }).click();
  await showsAlbums(page, ['Homogenic', 'Music Has the Right to Children', 'Laughing Stock', 'Souvlaki']);
  assert.equal(await page.inputValue('#yearFrom'), '1990');
  assert.equal(await page.inputValue('#yearTo'), '1999');
  // The active filter is shown as a dismissible chip.
  assert.match(await page.textContent('#activeFilters'), /Released 1990–1999/);
  await page.click('#btnReset');
});

test('clicking a month tag pivots to that single playlist', async () => {
  await page.locator('.album').first().locator('.month-tag')
    .first()
    .click();
  await page.waitForSelector('#activeFilters:not([hidden])');
  assert.match(await page.textContent('#activeFilters'), /Playlist: Kuukausi/);

  // Dismissing the chip restores the full crate.
  await page.locator('#activeFilters .chip').first().click();
  await showsAlbums(page, ALL_ALBUMS);
});

test('the tracks view lists individual tracks', async () => {
  await page.click('.seg[data-view="tracks"]');
  await page.waitForSelector('.row');
  assert.equal(await page.locator('.row').count(), 18);
  await page.click('.seg[data-view="albums"]');
  await page.waitForSelector('.album');
});

test('expanding an album reveals its tracks', async () => {
  const album = page.locator('.album', { hasText: 'Souvlaki' });
  await album.locator('.linkbtn').click();
  await album.locator('.tracklist').waitFor();
  assert.equal(await album.locator('.tracklist li').count(), 3);
  await album.locator('.linkbtn').click();
});

test('selecting an album selects all of its tracks', async () => {
  await page.locator('.album', { hasText: 'Kid A' }).locator('.tick').click();
  await page.waitForSelector('#selectionInfo:not([hidden])');
  assert.match(await page.textContent('#selectionInfo'), /3 tracks selected/);
  assert.match(await page.textContent('#btnExport'), /Save 3 to a playlist/);

  await page.click('#btnClearSel');
  await page.waitForSelector('#selectionInfo[hidden]', { state: 'hidden' });
});

test('select-all covers every album currently matched', async () => {
  await page.fill('#q', 'artist:aphex');
  await showsAlbums(page, ['Drukqs']);
  await page.click('#btnSelectAll');
  assert.match(await page.textContent('#selectionInfo'), /3 tracks selected/);
  await page.click('#btnReset');
});

test('sorting by release year reorders the grid', async () => {
  await page.selectOption('#sort', 'releaseOld');
  await page.waitForFunction(
    () => document.querySelector('.album .album-title').textContent.includes('Laughing Stock'),
  );

  await page.selectOption('#sort', 'release');
  await page.waitForFunction(
    () => document.querySelector('.album .album-title').textContent.includes('Drukqs'),
  );
  await page.selectOption('#sort', 'relevance');
});

test('surprise me shuffles without losing anything', async () => {
  const order = async () => page.locator('.album .album-title').allTextContents();

  await page.click('#btnShuffle');
  const first = await order();
  await page.click('#btnShuffle');
  const second = await order();

  assert.equal(first.length, 6);
  assert.deepEqual([...first].sort(), [...second].sort(), 'same albums');
  await page.selectOption('#sort', 'relevance');
});

test('pressing / focuses the search box', async () => {
  await page.locator('body').click();
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'q');
});

test('the playlist picker lists every playlist and filters by name', async () => {
  await page.click('#btnPlaylists');
  await page.waitForSelector('#pickerBackdrop:not([hidden])');
  assert.equal(await page.locator('.picker-row').count(), 24);

  await page.fill('#pickerFilter', '2020');
  await page.waitForFunction(() => document.querySelectorAll('.picker-row').length === 12);

  await page.click('#btnUnpickMatching');
  await page.waitForFunction(
    () => document.getElementById('pickerCount').textContent.includes('12 playlists selected'),
  );

  await page.click('#btnPickerClose');
  await page.waitForSelector('#pickerBackdrop[hidden]', { state: 'hidden' });
});

test('nothing threw along the way', () => {
  assert.deepEqual(consoleErrors, []);
});
