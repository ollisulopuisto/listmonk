// Run with: node --test spotify-crate/tests/library.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalize, buildLibrary, groupAlbums, parseQuery, search, sortResults, facets,
} from '../js/library.js';

function track(over = {}) {
  return {
    id: 't1',
    uri: 'spotify:track:t1',
    name: 'Idioteque',
    durationMs: 200000,
    popularity: 50,
    artists: [{ id: 'a1', name: 'Radiohead' }],
    albumId: 'al1',
    albumName: 'Kid A',
    releaseDate: '2000-10-02',
    albumImage: null,
    addedAt: '2019-03-04T10:00:00Z',
    ...over,
  };
}

function playlist(id, name, tracks) {
  return { id, name, snapshotId: `s-${id}`, total: tracks.length, tracks };
}

const CRATE = [
  playlist('p1', 'Kuukausi 2019-03', [
    track(),
    track({
      id: 't2', name: 'Everything In Its Right Place', addedAt: '2019-03-05T10:00:00Z',
    }),
    track({
      id: 't3',
      name: 'Windowlicker',
      artists: [{ id: 'a2', name: 'Aphex Twin' }],
      albumId: 'al2',
      albumName: 'Windowlicker',
      releaseDate: '1999-03-22',
      addedAt: '2019-03-06T10:00:00Z',
    }),
  ]),
  playlist('p2', 'Kuukausi 2021-07', [
    // Same track, filed again two years later.
    track({ addedAt: '2021-07-11T10:00:00Z' }),
    track({
      id: 't4',
      name: 'Jynweythek Ylow',
      artists: [{ id: 'a2', name: 'Aphex Twin' }],
      albumId: 'al3',
      albumName: 'Drukqs',
      releaseDate: '2001-10-22',
      addedAt: '2021-07-12T10:00:00Z',
    }),
    track({
      id: 't5',
      name: 'Jóga',
      artists: [{ id: 'a3', name: 'Björk' }],
      albumId: 'al4',
      albumName: 'Homogenic',
      releaseDate: '1997-09-22',
      addedAt: '2021-07-13T10:00:00Z',
    }),
  ]),
];

test('normalize folds diacritics, case and punctuation', () => {
  assert.equal(normalize('Björk'), 'bjork');
  assert.equal(normalize('Godspeed You! Black Emperor'), 'godspeed you black emperor');
  assert.equal(normalize('  Kid   A '), 'kid a');
  // Non-Latin scripts survive instead of normalizing to nothing.
  assert.equal(normalize('サカナクション'), 'サカナクション');
});

test('a track filed in several months collapses to one entry', () => {
  const { tracks } = buildLibrary(CRATE);
  assert.equal(tracks.length, 5, 'five distinct tracks across two playlists');

  const idioteque = tracks.find((t) => t.id === 't1');
  assert.equal(idioteque.sources.length, 2);
  assert.deepEqual(
    idioteque.sources.map((s) => s.playlistName),
    ['Kuukausi 2019-03', 'Kuukausi 2021-07'],
    'sources are ordered oldest first',
  );
  assert.equal(idioteque.firstAdded, '2019-03-04T10:00:00Z');
  assert.equal(idioteque.lastAdded, '2021-07-11T10:00:00Z');
});

test('free text matches across track, artist and album', () => {
  const { tracks } = buildLibrary(CRATE);
  assert.equal(search(tracks, 'radiohead').length, 2, 'artist name');
  assert.equal(search(tracks, 'kid a').length, 2, 'album name');
  assert.equal(search(tracks, 'windowlicker').length, 1, 'track name');
  assert.equal(search(tracks, '').length, 5, 'empty query matches everything');
});

test('diacritics are searchable both ways', () => {
  const { tracks } = buildLibrary(CRATE);
  assert.equal(search(tracks, 'bjork').length, 1);
  assert.equal(search(tracks, 'Björk').length, 1);
  assert.equal(search(tracks, 'joga').length, 1);
});

test('terms combine with AND', () => {
  const { tracks } = buildLibrary(CRATE);
  assert.equal(search(tracks, 'aphex drukqs').length, 1);
  assert.equal(search(tracks, 'aphex radiohead').length, 0);
});

test('field-scoped terms only look at their field', () => {
  const { tracks } = buildLibrary(CRATE);
  assert.equal(search(tracks, 'artist:aphex').length, 2);
  assert.equal(search(tracks, 'album:windowlicker').length, 1);
  assert.equal(search(tracks, 'track:windowlicker').length, 1);
  // "Windowlicker" is both an album and a track here, so scoping matters.
  assert.equal(search(tracks, 'artist:windowlicker').length, 0);
  assert.equal(search(tracks, 'playlist:2019').length, 3);
});

test('a quoted phrase stays attached to its field prefix', () => {
  const { tracks } = buildLibrary([
    playlist('p', 'x', [
      track({
        id: 'm1',
        name: 'Roygbiv',
        artists: [{ id: 'boc', name: 'Boards of Canada' }],
        albumId: 'mhtrtc',
        albumName: 'Music Has the Right to Children',
        releaseDate: '1998-04-20',
      }),
      // Shares the words "of" and "canada", so a lexer that split the phrase
      // into loose AND terms would wrongly match this too.
      track({
        id: 'm2',
        name: 'Canada',
        artists: [{ id: 'oth', name: 'Boards of Ontario' }],
        albumId: 'other',
        albumName: 'Other',
        releaseDate: '2004-01-01',
      }),
    ]),
  ]);

  assert.deepEqual(
    parseQuery('artist:"Boards of Canada"').terms,
    [{ field: 'hayArtist', value: 'boards of canada' }],
    'one field term, not three',
  );
  assert.deepEqual(search(tracks, 'artist:"Boards of Canada"').map((t) => t.id), ['m1']);
  assert.deepEqual(search(tracks, 'album:"Music Has the Right"').map((t) => t.id), ['m1']);
});

test('year filters accept a single year or a range', () => {
  const { tracks } = buildLibrary(CRATE);
  assert.equal(search(tracks, 'year:2000').length, 2);
  assert.equal(search(tracks, 'year:1997-1999').length, 2);
  assert.equal(search(tracks, 'year:1990-2001 artist:aphex').length, 2);
  assert.deepEqual(parseQuery('year:1990..1999').years, [[1990, 1999]]);
});

test('quoted phrases stay together', () => {
  const { tracks } = buildLibrary(CRATE);
  assert.equal(search(tracks, '"in its right"').length, 1);
  assert.equal(search(tracks, '"right place in its"').length, 0);
});

test('word-start matches outrank mid-word ones', () => {
  const { tracks } = buildLibrary([
    playlist('p', 'x', [
      track({ id: 'x1', name: 'War Pigs', albumName: 'Paranoid', albumId: 'b1' }),
      track({ id: 'x2', name: 'Software Slump', albumName: 'Grandaddy', albumId: 'b2' }),
    ]),
  ]);
  const ranked = sortResults(search(tracks, 'war'), 'relevance');
  assert.equal(ranked[0].name, 'War Pigs');
});

test('filters narrow by playlist, release year and filing year', () => {
  const { tracks } = buildLibrary(CRATE);

  assert.equal(search(tracks, '', { playlistIds: new Set(['p2']) }).length, 3);
  assert.equal(search(tracks, '', { yearFrom: 2000 }).length, 3);
  assert.equal(search(tracks, '', { yearTo: 1999 }).length, 2);
  assert.equal(search(tracks, '', { addedFrom: 2021 }).length, 3);
  // t1 is in both playlists, so filtering to 2019 still finds it.
  assert.equal(search(tracks, '', { addedTo: 2019 }).length, 3);
});

test('albums group their matching tracks and pick a majority artist', () => {
  const { tracks } = buildLibrary(CRATE);
  const albums = groupAlbums(search(tracks, ''));
  assert.equal(albums.length, 4);

  const kidA = albums.find((a) => a.id === 'al1');
  assert.equal(kidA.tracks.length, 2);
  assert.equal(kidA.artistLine, 'Radiohead');
  assert.equal(kidA.year, 2000);
  // Kid A was filed in two different months; both are kept, deduplicated.
  assert.equal(kidA.sourceList.length, 2);
});

test('albums with a guest-heavy track keep the majority artist', () => {
  const { tracks } = buildLibrary([
    playlist('p', 'x', [
      track({ id: 'g1', name: 'One', albumId: 'c1', albumName: 'Comp' }),
      track({ id: 'g2', name: 'Two', albumId: 'c1', albumName: 'Comp' }),
      track({
        id: 'g3',
        name: 'Three',
        albumId: 'c1',
        albumName: 'Comp',
        artists: [{ id: 'a9', name: 'Guest' }],
      }),
    ]),
  ]);
  const [album] = groupAlbums(search(tracks, ''));
  assert.equal(album.artists[0], 'Radiohead');
});

test('sorts order as advertised', () => {
  const { tracks } = buildLibrary(CRATE);
  const all = search(tracks, '');

  assert.equal(sortResults(all, 'newest')[0].lastAdded, '2021-07-13T10:00:00Z');
  assert.equal(sortResults(all, 'oldest')[0].firstAdded, '2019-03-04T10:00:00Z');
  assert.equal(sortResults(all, 'artist')[0].artistLine, 'Aphex Twin');
  assert.equal(sortResults(all, 'release')[0].year, 2001);
  assert.equal(sortResults(all, 'releaseOld')[0].year, 1997);
  // The one track filed twice is the most-revisited.
  assert.equal(sortResults(all, 'revisited')[0].id, 't1');
});

test('shuffle is stable for a seed and changes with it', () => {
  const { tracks } = buildLibrary(CRATE);
  const all = search(tracks, '');
  const a = sortResults(all, 'random', 7).map((t) => t.id);
  const b = sortResults(all, 'random', 7).map((t) => t.id);
  const c = sortResults(all, 'random', 99).map((t) => t.id);

  assert.deepEqual(a, b, 'same seed, same order');
  assert.deepEqual([...a].sort(), [...all.map((t) => t.id)].sort(), 'nothing lost');
  assert.notDeepEqual(a, c, 'a new seed reshuffles');
});

test('facets describe the current result set only', () => {
  const { tracks } = buildLibrary(CRATE);
  const f = facets(search(tracks, 'artist:aphex'));
  assert.deepEqual(f.artists, [['Aphex Twin', 2]]);
  assert.deepEqual(f.decades.map((d) => d[0]), [2000, 1990]);
});

test('unknown field prefixes fall back to free text', () => {
  const { tracks } = buildLibrary(CRATE);
  // "genre:" is not supported, so this must not silently match everything.
  assert.equal(search(tracks, 'genre:techno').length, 0);
});
