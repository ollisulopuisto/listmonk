import { db } from './db.js';
import { api, SpotifyError } from './api.js';
import * as auth from './auth.js';
import {
  buildLibrary, groupAlbums, search, sortResults, facets, SORTS,
} from './library.js';

// --- tiny DOM helper -------------------------------------------------------
// Building nodes instead of innerHTML means a track called
// `<script>alert(1)</script>` is just an oddly named track.

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const $ = (id) => document.getElementById(id);

// --- formatting ------------------------------------------------------------

function duration(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function monthLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', year: 'numeric' });
}

function dateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// --- state -----------------------------------------------------------------

const PAGE = 60;
const LS_PREFS = 'crate.prefs';

const state = {
  cached: [],          // playlist records from IndexedDB, tracks included
  catalog: [],         // every playlist on the account (picker source)
  selectedPlaylists: new Set(),
  library: { tracks: [] },
  view: 'albums',
  sort: 'relevance',
  query: '',
  filters: { playlistIds: null, yearFrom: null, yearTo: null, addedFrom: null, addedTo: null },
  selection: new Set(),
  expanded: new Set(),
  shuffleSeed: 1,
  rendered: PAGE,
  items: [],
  matched: [],
  lastSync: null,
  cancelSync: false,
  me: null,
};

function savePrefs() {
  localStorage.setItem(LS_PREFS, JSON.stringify({ view: state.view, sort: state.sort }));
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_PREFS));
    if (p && p.view) state.view = p.view;
    if (p && p.sort) state.sort = p.sort;
  } catch { /* first run */ }
}

// --- banners ---------------------------------------------------------------

let bannerTimer = null;

function banner(message, kind = 'error') {
  const el = $('banner');
  clearTimeout(bannerTimer);
  if (!message) { el.hidden = true; return; }
  el.textContent = message;
  el.className = kind === 'ok' ? 'banner ok' : 'banner';
  el.hidden = false;
  if (kind === 'ok') bannerTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

function describeError(err) {
  if (err instanceof SpotifyError && err.status === 403) {
    return `Spotify refused the request (403). If your developer app is in development mode, `
      + `add your own Spotify account under the app's "User Management" settings. (${err.message})`;
  }
  return err && err.message ? err.message : String(err);
}

// --- progress overlay ------------------------------------------------------

function showProgress(title) {
  state.cancelSync = false;
  $('progressTitle').textContent = title;
  $('progressText').textContent = '';
  $('progressBar').style.width = '0%';
  $('progressBackdrop').hidden = false;
}

function setProgress(text, done, total) {
  $('progressText').textContent = text;
  if (total > 0) $('progressBar').style.width = `${Math.round((done / total) * 100)}%`;
}

function hideProgress() {
  $('progressBackdrop').hidden = true;
}

// --- sync ------------------------------------------------------------------

async function loadCache() {
  state.cached = await db.getAllPlaylists();
  const saved = await db.getMeta('selectedPlaylistIds');
  state.selectedPlaylists = new Set(saved || state.cached.map((p) => p.id));
  state.lastSync = await db.getMeta('lastSync');
  state.library = buildLibrary(
    state.cached.filter((p) => state.selectedPlaylists.has(p.id)),
  );
}

async function fetchCatalog() {
  showProgress('Reading your playlists');
  try {
    state.catalog = await api.myPlaylists((n, total) => {
      setProgress(`${n} of ${total || '?'} playlists`, n, total);
    });
    await db.setMeta('catalog', state.catalog);
  } finally {
    hideProgress();
  }
  return state.catalog;
}

async function sync({ full = false } = {}) {
  const wanted = [...state.selectedPlaylists];
  if (!wanted.length) {
    banner('No playlists selected yet — pick the monthly ones first.');
    return;
  }

  showProgress('Syncing your crate');

  try {
    if (!state.catalog.length) {
      state.catalog = (await db.getMeta('catalog')) || [];
    }
    // Refresh the catalog so snapshot IDs (and any new months) are current.
    setProgress('Checking for changes…', 0, 0);
    state.catalog = await api.myPlaylists();
    await db.setMeta('catalog', state.catalog);

    const byId = new Map(state.catalog.map((p) => [p.id, p]));
    const cachedById = new Map(state.cached.map((p) => [p.id, p]));

    // Drop anything no longer in the crate so it stops polluting search.
    for (const cached of state.cached) {
      if (!state.selectedPlaylists.has(cached.id)) {
        await db.deletePlaylist(cached.id);
      }
    }

    let done = 0;
    let fetched = 0;

    for (const id of wanted) {
      if (state.cancelSync) break;

      const meta = byId.get(id);
      const cached = cachedById.get(id);
      done += 1;

      if (!meta) {
        // Deleted or no longer visible on the account; keep whatever we cached.
        continue;
      }

      // snapshot_id changes whenever a playlist's contents change. Unchanged
      // playlists cost nothing, which is what makes a 180-playlist resync cheap.
      const unchanged = cached && cached.snapshotId === meta.snapshotId && !full;
      if (unchanged) {
        setProgress(`${meta.name} — unchanged (${done}/${wanted.length})`, done, wanted.length);
        continue;
      }

      setProgress(`${meta.name} (${done}/${wanted.length})`, done, wanted.length);
      const tracks = await api.playlistTracks(id);
      await db.putPlaylist({ ...meta, tracks, syncedAt: new Date().toISOString() });
      fetched += 1;
    }

    state.lastSync = new Date().toISOString();
    await db.setMeta('lastSync', state.lastSync);
    await db.setMeta('selectedPlaylistIds', [...state.selectedPlaylists]);
    await loadCache();

    banner(
      state.cancelSync
        ? 'Sync cancelled — kept what had already been fetched.'
        : `Synced ${plural(wanted.length, 'playlist', 'playlists')}`
          + ` (${fetched} refetched, ${wanted.length - fetched} unchanged),`
          + ` ${plural(state.library.tracks.length, 'unique track', 'unique tracks')}.`,
      'ok',
    );
  } catch (err) {
    banner(describeError(err));
  } finally {
    hideProgress();
    render();
  }
}

// --- playlist picker -------------------------------------------------------

let pickerDraft = new Set();

function renderPicker() {
  const filter = $('pickerFilter').value.trim().toLowerCase();
  const list = $('pickerList');
  list.textContent = '';

  const visible = state.catalog.filter(
    (p) => !filter || p.name.toLowerCase().includes(filter),
  );

  if (!visible.length) {
    list.append(h('div', { class: 'empty', text: 'No playlists match that filter.' }));
  }

  for (const p of visible) {
    const box = h('input', {
      type: 'checkbox',
      id: `pick-${p.id}`,
      checked: pickerDraft.has(p.id),
      onchange: (e) => {
        if (e.target.checked) pickerDraft.add(p.id);
        else pickerDraft.delete(p.id);
        updatePickerCount();
      },
    });
    list.append(h(
      'div',
      { class: 'picker-row' },
      box,
      h('label', { for: `pick-${p.id}`, text: p.name }),
      h('span', { class: 'n', text: `${p.total}` }),
    ));
  }

  updatePickerCount();
}

function updatePickerCount() {
  const tracks = state.catalog
    .filter((p) => pickerDraft.has(p.id))
    .reduce((sum, p) => sum + p.total, 0);
  $('pickerCount').textContent = `${plural(pickerDraft.size, 'playlist', 'playlists')} selected`
    + ` · about ${plural(tracks, 'track', 'tracks')}`;
}

async function openPicker() {
  try {
    if (!state.catalog.length) {
      state.catalog = (await db.getMeta('catalog')) || [];
    }
    if (!state.catalog.length) await fetchCatalog();
  } catch (err) {
    banner(describeError(err));
    return;
  }
  pickerDraft = new Set(state.selectedPlaylists);
  $('pickerFilter').value = '';
  renderPicker();
  $('pickerBackdrop').hidden = false;
  $('pickerFilter').focus();
}

function matchingIds() {
  const filter = $('pickerFilter').value.trim().toLowerCase();
  return state.catalog
    .filter((p) => !filter || p.name.toLowerCase().includes(filter))
    .map((p) => p.id);
}

// --- rendering -------------------------------------------------------------

function tickButton(isOn, onToggle, label) {
  return h('button', {
    class: 'tick',
    'aria-pressed': isOn ? 'true' : 'false',
    'aria-label': label,
    title: label,
    onclick: (e) => { e.stopPropagation(); onToggle(); },
  }, '✓');
}

function monthTags(sources) {
  const shown = sources.slice(-3).reverse();
  const extra = sources.length - shown.length;

  return h(
    'div',
    { class: 'months' },
    shown.map((s) => h('button', {
      class: 'month-tag',
      title: `Only show ${s.playlistName}${s.addedAt ? ` · added ${new Date(s.addedAt).toLocaleDateString()}` : ''}`,
      onclick: () => filterToPlaylist(s.playlistId),
      text: s.playlistName,
    })),
    extra > 0 ? h('span', { class: 'month-tag', text: `+${extra} more` }) : null,
  );
}

function albumCard(album) {
  const trackIds = album.tracks.map((t) => t.id);
  const allSelected = trackIds.every((id) => state.selection.has(id));
  const isOpen = state.expanded.has(album.id);
  const filings = album.sourceList.length;

  const art = album.image
    ? h('img', { src: album.image, alt: '', loading: 'lazy' })
    : h('div', { class: 'noart', text: '♫' });

  return h(
    'article',
    { class: `album${allSelected ? ' is-selected' : ''}` },
    h(
      'div',
      { class: 'album-art' },
      tickButton(allSelected, () => {
        if (allSelected) trackIds.forEach((id) => state.selection.delete(id));
        else trackIds.forEach((id) => state.selection.add(id));
        render();
      }, allSelected ? 'Deselect album' : 'Select album'),
      art,
    ),
    h(
      'div',
      { class: 'album-meta' },
      album.id.startsWith('noalbum:')
        ? h('div', { class: 'album-title', text: album.name || 'Unknown album' })
        : h('a', {
          class: 'album-title',
          href: `https://open.spotify.com/album/${album.id}`,
          target: '_blank',
          rel: 'noreferrer',
          text: album.name || 'Unknown album',
        }),
      h('div', { class: 'album-artist', text: album.artistLine }),
      h(
        'div',
        { class: 'album-sub' },
        album.year ? h('span', { class: 'pill', text: album.year }) : null,
        h('span', {
          class: filings > 1 ? 'pill hot' : 'pill',
          title: filings > 1 ? 'You filed this in more than one month' : '',
          text: filings > 1 ? `filed ${filings}×` : monthLabel(album.lastAdded),
        }),
        h('span', { class: 'pill', text: plural(album.tracks.length, 'track', 'tracks') }),
      ),
      monthTags(album.sourceList),
      h(
        'div',
        { class: 'album-actions' },
        h('button', {
          class: 'linkbtn',
          text: isOpen ? 'Hide tracks' : `Show ${album.tracks.length} track${album.tracks.length === 1 ? '' : 's'}`,
          onclick: () => {
            if (isOpen) state.expanded.delete(album.id);
            else state.expanded.add(album.id);
            render();
          },
        }),
      ),
      isOpen ? h(
        'ul',
        { class: 'tracklist' },
        album.tracks.map((t) => h(
          'li',
          {},
          h('a', {
            href: `https://open.spotify.com/track/${t.id}`,
            target: '_blank',
            rel: 'noreferrer',
            text: t.name,
          }),
          h('span', { class: 'dur', text: duration(t.durationMs) }),
        )),
      ) : null,
    ),
  );
}

function trackRow(t) {
  const selected = state.selection.has(t.id);
  const last = t.sources[t.sources.length - 1];

  return h(
    'div',
    { class: `row${selected ? ' is-selected' : ''}` },
    tickButton(selected, () => {
      if (selected) state.selection.delete(t.id);
      else state.selection.add(t.id);
      render();
    }, selected ? 'Deselect track' : 'Select track'),
    t.albumImage
      ? h('img', { src: t.albumImage, alt: '', loading: 'lazy' })
      : h('div', { class: 'cell', text: '' }),
    h('div', { class: 'cell' }, h('a', {
      href: `https://open.spotify.com/track/${t.id}`,
      target: '_blank',
      rel: 'noreferrer',
      text: t.name,
    })),
    h('div', { class: 'cell sub', text: t.artistLine }),
    h('div', { class: 'num hide-sm', text: t.year || '' }),
    h(
      'div',
      { class: 'cell sub hide-sm', title: `Filed ${dateLabel(last && last.addedAt)}` },
      h('button', {
        class: 'linkbtn',
        title: 'Only show this playlist',
        onclick: () => filterToPlaylist(last.playlistId),
        text: last ? last.playlistName : '',
      }),
      t.sources.length > 1 ? h('span', { class: 'sub', text: ` +${t.sources.length - 1}` }) : null,
    ),
    h('div', { class: 'num', text: duration(t.durationMs) }),
  );
}

function renderFacets() {
  const f = facets(state.matched);

  const artistBox = $('facetArtists');
  artistBox.textContent = '';
  if (f.artists.length > 1) {
    artistBox.append(h('h3', { text: 'Artists here' }));
    artistBox.append(h(
      'ul',
      {},
      f.artists.map(([name, n]) => h('li', {}, h('button', {
        class: 'facet-item',
        title: name,
        onclick: () => addTerm(`artist:"${name}"`),
      }, h('span', { class: 'lbl', text: name }), h('span', { class: 'n', text: n })))),
    ));
  }

  const decadeBox = $('facetDecades');
  decadeBox.textContent = '';
  if (f.decades.length > 1) {
    decadeBox.append(h('h3', { text: 'Decades' }));
    decadeBox.append(h(
      'ul',
      {},
      f.decades.map(([decade, n]) => h('li', {}, h('button', {
        class: 'facet-item',
        onclick: () => {
          $('yearFrom').value = decade;
          $('yearTo').value = decade + 9;
          readFilters();
          render();
        },
      }, h('span', { class: 'lbl', text: `${decade}s` }), h('span', { class: 'n', text: n })))),
    ));
  }
}

function renderActiveFilters() {
  const box = $('activeFilters');
  box.textContent = '';
  const chips = [];

  if (state.filters.playlistIds && state.filters.playlistIds.size) {
    const names = state.cached
      .filter((p) => state.filters.playlistIds.has(p.id))
      .map((p) => p.name);
    chips.push([`Playlist: ${names.join(', ') || '?'}`, () => {
      state.filters.playlistIds = null;
      render();
    }]);
  }

  const { yearFrom, yearTo, addedFrom, addedTo } = state.filters;
  if (yearFrom !== null || yearTo !== null) {
    chips.push([`Released ${yearFrom ?? '…'}–${yearTo ?? '…'}`, () => {
      $('yearFrom').value = '';
      $('yearTo').value = '';
      readFilters();
      render();
    }]);
  }
  if (addedFrom !== null || addedTo !== null) {
    chips.push([`Filed ${addedFrom ?? '…'}–${addedTo ?? '…'}`, () => {
      $('addedFrom').value = '';
      $('addedTo').value = '';
      readFilters();
      render();
    }]);
  }

  for (const [label, onClear] of chips) {
    box.append(h('button', { class: 'chip', onclick: onClear },
      h('span', { text: label }), h('span', { class: 'x', text: '×' })));
  }
  box.hidden = chips.length === 0;
}

function renderResults() {
  const box = $('results');
  box.textContent = '';

  if (!state.library.tracks.length) {
    box.append(h(
      'div',
      { class: 'empty' },
      h('h2', { text: 'Your crate is empty' }),
      h('p', { text: 'Choose which playlists belong in it, then sync.' }),
      h('p', {}, h('button', { class: 'btn btn-primary', onclick: openPicker, text: 'Choose playlists' })),
    ));
    return;
  }

  if (!state.items.length) {
    box.append(h(
      'div',
      { class: 'empty' },
      h('h2', { text: 'Nothing matches' }),
      h('p', { text: 'Try fewer words, or drop a filter.' }),
    ));
    return;
  }

  const slice = state.items.slice(0, state.rendered);

  if (state.view === 'albums') {
    box.append(h('div', { class: 'grid' }, slice.map(albumCard)));
  } else {
    box.append(h('div', { class: 'rows' }, slice.map(trackRow)));
  }

  if (state.items.length > state.rendered) {
    box.append(h('div', { class: 'empty' }, h('button', {
      class: 'btn',
      text: `Show more (${(state.items.length - state.rendered).toLocaleString()} left)`,
      onclick: () => { state.rendered += PAGE; render(); },
    })));
  }
}

function selectedTrackIds() {
  if (state.selection.size) {
    // Keep the on-screen order rather than Set insertion order.
    const inOrder = [];
    const seen = new Set();
    const pool = state.view === 'albums'
      ? state.items.flatMap((a) => a.tracks)
      : state.items;
    for (const t of pool) {
      if (state.selection.has(t.id) && !seen.has(t.id)) { seen.add(t.id); inOrder.push(t.id); }
    }
    // Anything selected then filtered out of view still counts.
    for (const id of state.selection) if (!seen.has(id)) inOrder.push(id);
    return inOrder;
  }
  return state.view === 'albums'
    ? state.items.flatMap((a) => a.tracks).map((t) => t.id)
    : state.items.map((t) => t.id);
}

function renderCounts() {
  const nAlbums = state.view === 'albums'
    ? state.items.length
    : groupAlbums(state.matched).length;

  $('count').textContent = state.library.tracks.length
    ? `${plural(state.matched.length, 'track', 'tracks')} · ${plural(nAlbums, 'album', 'albums')}`
      + ` · from ${plural(state.selectedPlaylists.size, 'playlist', 'playlists')}`
      + (state.lastSync ? ` · synced ${dateLabel(state.lastSync)}` : '')
    : '';

  const hasSel = state.selection.size > 0;
  $('selectionInfo').hidden = !hasSel;
  $('selectionInfo').textContent = hasSel ? `${plural(state.selection.size, 'track', 'tracks')} selected` : '';
  $('btnClearSel').hidden = !hasSel;
  $('btnSelectAll').hidden = !state.items.length;
  $('btnExport').hidden = !state.items.length;
  $('btnExport').textContent = hasSel
    ? `Save ${state.selection.size} to a playlist`
    : 'Save these results as a playlist';
}

function render() {
  state.matched = search(state.library.tracks, state.query, state.filters);
  state.items = state.view === 'albums'
    ? sortResults(groupAlbums(state.matched), state.sort, state.shuffleSeed)
    : sortResults(state.matched, state.sort, state.shuffleSeed);

  renderActiveFilters();
  renderResults();
  renderFacets();
  renderCounts();
}

// --- interactions ----------------------------------------------------------

function addTerm(term) {
  const q = $('q').value.trim();
  if (q.includes(term)) return;
  $('q').value = q ? `${q} ${term}` : term;
  state.query = $('q').value;
  state.rendered = PAGE;
  $('btnClear').hidden = !state.query;
  render();
}

function filterToPlaylist(id) {
  state.filters.playlistIds = new Set([id]);
  state.rendered = PAGE;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function numOrNull(input) {
  const v = parseInt(input.value, 10);
  return Number.isFinite(v) ? v : null;
}

function readFilters() {
  state.filters.yearFrom = numOrNull($('yearFrom'));
  state.filters.yearTo = numOrNull($('yearTo'));
  state.filters.addedFrom = numOrNull($('addedFrom'));
  state.filters.addedTo = numOrNull($('addedTo'));
  state.rendered = PAGE;
}

async function exportPlaylist() {
  const ids = selectedTrackIds();
  if (!ids.length) return;

  const byId = new Map(state.library.tracks.map((t) => [t.id, t]));
  const uris = ids.map((id) => byId.get(id)).filter(Boolean).map((t) => t.uri);

  // Spotify caps a playlist at 10,000 tracks.
  const capped = uris.slice(0, 10000);
  const suffix = state.query ? ` — ${state.query}` : '';
  const name = window.prompt(
    `Name for the new playlist (${plural(capped.length, 'track', 'tracks')}):`,
    `Crate${suffix}`.slice(0, 100),
  );
  if (name === null) return;

  showProgress('Creating playlist');
  try {
    if (!state.me) state.me = await api.me();
    const playlist = await api.createPlaylist(state.me.id, {
      name: name.trim() || 'Crate',
      description: `Built with Crate from ${state.selectedPlaylists.size} playlists`
        + `${state.query ? ` · query: ${state.query}` : ''}`,
      isPublic: false,
    });
    await api.addTracks(playlist.id, capped, (done, total) => {
      setProgress(`${done} of ${total} tracks`, done, total);
    });
    hideProgress();
    banner(`Created “${playlist.name}” with ${plural(capped.length, 'track', 'tracks')}.`, 'ok');
    if (playlist.external_urls && playlist.external_urls.spotify) {
      window.open(playlist.external_urls.spotify, '_blank', 'noreferrer');
    }
  } catch (err) {
    banner(describeError(err));
  } finally {
    hideProgress();
  }
}

// --- wiring ----------------------------------------------------------------

function showSetup(show) {
  $('setup').hidden = !show;
  $('app').hidden = show;
  for (const id of ['btnPlaylists', 'btnSync', 'btnSignOut']) $(id).hidden = show;
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function wire() {
  $('redirectUri').textContent = auth.redirectUri();
  if (window.location.protocol === 'file:') {
    $('redirectHint').textContent = 'Heads up: Spotify will not accept a file:// redirect. '
      + 'Serve this folder over http://127.0.0.1 instead — see the README.';
  } else if (!/^https:|^http:\/\/(127\.0\.0\.1|\[::1\])/.test(window.location.origin)) {
    $('redirectHint').textContent = 'Spotify only accepts https:// or http://127.0.0.1 redirect URIs.';
  }

  $('clientId').value = auth.getClientId();

  $('btnCopyRedirect').onclick = async () => {
    await navigator.clipboard.writeText(auth.redirectUri());
    banner('Redirect URI copied.', 'ok');
  };

  $('btnSignIn').onclick = async () => {
    const id = $('clientId').value.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) {
      banner('That does not look like a Spotify client ID (32 hex characters).');
      return;
    }
    auth.setClientId(id);
    try {
      await auth.login();
    } catch (err) {
      banner(describeError(err));
    }
  };

  $('btnSignOut').onclick = () => {
    auth.logout();
    showSetup(true);
    banner('Signed out. Your cached crate is still here.', 'ok');
  };

  $('btnPlaylists').onclick = openPicker;
  $('btnSync').onclick = () => sync();

  // search
  const onQuery = debounce(() => {
    state.query = $('q').value;
    state.rendered = PAGE;
    $('btnClear').hidden = !state.query;
    render();
  }, 120);
  $('q').addEventListener('input', onQuery);

  $('btnClear').onclick = () => {
    $('q').value = '';
    state.query = '';
    state.rendered = PAGE;
    $('btnClear').hidden = true;
    render();
    $('q').focus();
  };

  // view toggle
  for (const seg of document.querySelectorAll('.seg')) {
    seg.onclick = () => {
      document.querySelectorAll('.seg').forEach((s) => s.classList.remove('is-active'));
      seg.classList.add('is-active');
      state.view = seg.dataset.view;
      state.rendered = PAGE;
      savePrefs();
      render();
    };
  }

  // sort
  const sortSel = $('sort');
  for (const [key, def] of Object.entries(SORTS)) {
    sortSel.append(h('option', { value: key, text: def.label }));
  }
  sortSel.value = state.sort;
  sortSel.onchange = () => {
    state.sort = sortSel.value;
    state.rendered = PAGE;
    savePrefs();
    render();
  };

  for (const id of ['yearFrom', 'yearTo', 'addedFrom', 'addedTo']) {
    $(id).addEventListener('input', debounce(() => { readFilters(); render(); }, 200));
  }

  $('btnShuffle').onclick = () => {
    state.shuffleSeed = Math.floor(Math.random() * 1e9) + 1;
    state.sort = 'random';
    sortSel.value = 'random';
    state.rendered = PAGE;
    render();
  };

  $('btnReset').onclick = () => {
    $('q').value = '';
    ['yearFrom', 'yearTo', 'addedFrom', 'addedTo'].forEach((id) => { $(id).value = ''; });
    state.query = '';
    state.filters.playlistIds = null;
    readFilters();
    state.selection.clear();
    state.expanded.clear();
    $('btnClear').hidden = true;
    render();
  };

  $('btnSelectAll').onclick = () => {
    const pool = state.view === 'albums'
      ? state.items.flatMap((a) => a.tracks)
      : state.items;
    pool.forEach((t) => state.selection.add(t.id));
    render();
  };

  $('btnClearSel').onclick = () => { state.selection.clear(); render(); };
  $('btnExport').onclick = exportPlaylist;

  // picker
  $('btnPickerClose').onclick = () => { $('pickerBackdrop').hidden = true; };
  $('pickerFilter').addEventListener('input', debounce(renderPicker, 150));
  $('btnPickMatching').onclick = () => {
    matchingIds().forEach((id) => pickerDraft.add(id));
    renderPicker();
  };
  $('btnUnpickMatching').onclick = () => {
    matchingIds().forEach((id) => pickerDraft.delete(id));
    renderPicker();
  };
  $('btnPickerSave').onclick = async () => {
    state.selectedPlaylists = new Set(pickerDraft);
    await db.setMeta('selectedPlaylistIds', [...state.selectedPlaylists]);
    $('pickerBackdrop').hidden = true;
    await sync();
  };

  $('btnCancelSync').onclick = () => { state.cancelSync = true; };

  // Infinite scroll: cheaper than virtualising, and good enough for 60 at a time.
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && state.items.length > state.rendered) {
      state.rendered += PAGE;
      render();
    }
  }, { rootMargin: '600px' });
  io.observe($('sentinel'));

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('q') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      $('q').focus();
      $('q').select();
    } else if (e.key === 'Escape') {
      if (!$('pickerBackdrop').hidden) $('pickerBackdrop').hidden = true;
      else if (document.activeElement === $('q')) $('btnClear').click();
    }
  });
}

async function start() {
  loadPrefs();
  wire();

  document.querySelectorAll('.seg').forEach((s) => {
    s.classList.toggle('is-active', s.dataset.view === state.view);
  });
  $('sort').value = state.sort;

  try {
    await auth.handleRedirect();
  } catch (err) {
    banner(describeError(err));
  }

  await loadCache();

  if (!auth.isLoggedIn()) {
    // The cache still works offline, so show it rather than a login wall.
    if (state.library.tracks.length) {
      showSetup(false);
      $('brandSub').textContent = 'offline — sign in again to sync';
      render();
    } else {
      showSetup(true);
    }
    return;
  }

  showSetup(false);
  $('brandSub').textContent = state.lastSync
    ? `${plural(state.library.tracks.length, 'track', 'tracks')} across `
      + `${plural(state.selectedPlaylists.size, 'playlist', 'playlists')}`
    : 'your monthly playlists, as one library';

  render();

  if (!state.cached.length) {
    banner('Signed in. Now choose which playlists make up your crate.', 'ok');
    await openPicker();
  }
}

start();
