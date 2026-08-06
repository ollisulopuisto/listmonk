// Turns the raw cached playlists into one searchable library.
//
// The whole point of this app: the same album keeps showing up across months,
// and chronological order buries it. Here a track exists once, carrying the
// list of months it was filed under.

// Fold diacritics and punctuation away so "Björk", "Bjork" and "BJÖRK" all
// meet in the middle, and so "Godspeed You! Black Emperor" is one token run.
export function normalize(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Keep any Unicode letter or digit, not just ASCII, so Japanese or Cyrillic
    // titles stay searchable instead of normalizing down to an empty string.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function yearOf(releaseDate) {
  const y = parseInt((releaseDate || '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

export function buildLibrary(playlists) {
  const byTrack = new Map();

  for (const pl of playlists) {
    for (const t of pl.tracks || []) {
      let entry = byTrack.get(t.id);

      if (!entry) {
        const artistNames = t.artists.map((a) => a.name);
        entry = {
          id: t.id,
          uri: t.uri,
          name: t.name,
          artists: artistNames,
          artistIds: t.artists.map((a) => a.id).filter(Boolean),
          artistLine: artistNames.join(', '),
          albumId: t.albumId || `noalbum:${t.id}`,
          albumName: t.albumName,
          albumImage: t.albumImage,
          year: yearOf(t.releaseDate),
          durationMs: t.durationMs,
          popularity: t.popularity,
          sources: [],
          hayTrack: normalize(t.name),
          hayArtist: normalize(artistNames.join(' ')),
          hayAlbum: normalize(t.albumName),
        };
        entry.hayAll = `${entry.hayTrack} ${entry.hayArtist} ${entry.hayAlbum}`;
        byTrack.set(t.id, entry);
      }

      entry.sources.push({
        playlistId: pl.id,
        playlistName: pl.name,
        addedAt: t.addedAt,
      });
    }
  }

  const tracks = [...byTrack.values()];

  for (const t of tracks) {
    t.sources.sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
    t.firstAdded = t.sources[0] ? t.sources[0].addedAt : null;
    t.lastAdded = t.sources[t.sources.length - 1] ? t.sources[t.sources.length - 1].addedAt : null;
    t.playlistIds = new Set(t.sources.map((s) => s.playlistId));
    t.hayPlaylist = normalize(t.sources.map((s) => s.playlistName).join(' '));
  }

  return { tracks };
}

// Group matched tracks into albums. Album metadata comes from its tracks, so an
// album partially present in the crate still shows up with what we have.
export function groupAlbums(tracks) {
  const byAlbum = new Map();

  for (const t of tracks) {
    let a = byAlbum.get(t.albumId);
    if (!a) {
      a = {
        id: t.albumId,
        name: t.albumName,
        image: t.albumImage,
        year: t.year,
        artistCounts: new Map(),
        tracks: [],
        sources: new Map(),
        score: 0,
      };
      byAlbum.set(t.albumId, a);
    }

    a.tracks.push(t);
    a.score = Math.max(a.score, t.score || 0);
    for (const name of t.artists) {
      a.artistCounts.set(name, (a.artistCounts.get(name) || 0) + 1);
    }
    for (const s of t.sources) {
      if (!a.sources.has(s.playlistId)) a.sources.set(s.playlistId, s);
    }
  }

  const albums = [...byAlbum.values()];

  for (const a of albums) {
    // An album's artist is whoever appears on most of its tracks — this keeps
    // compilations and guest-heavy records from being labelled by a feature.
    a.artists = [...a.artistCounts.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map((e) => e[0]);
    a.artistLine = a.artists.join(', ');
    delete a.artistCounts;

    a.sourceList = [...a.sources.values()]
      .sort((x, y) => String(x.addedAt).localeCompare(String(y.addedAt)));
    delete a.sources;

    a.firstAdded = a.sourceList[0] ? a.sourceList[0].addedAt : null;
    a.lastAdded = a.sourceList.length
      ? a.sourceList[a.sourceList.length - 1].addedAt : null;
    a.tracks.sort((x, y) => x.name.localeCompare(y.name));
  }

  return albums;
}

// --- query parsing ---------------------------------------------------------

const FIELD_ALIASES = {
  artist: 'hayArtist',
  by: 'hayArtist',
  album: 'hayAlbum',
  track: 'hayTrack',
  title: 'hayTrack',
  song: 'hayTrack',
  playlist: 'hayPlaylist',
  list: 'hayPlaylist',
  month: 'hayPlaylist',
};

// Splits on whitespace, but keeps "quoted phrases" together and — crucially —
// keeps a quoted phrase attached to its field prefix. Without the first
// alternative, `artist:"Boards of Canada"` would fall apart into
// `artist:"Boards`, `of`, `Canada"`, quietly turning a precise field lookup
// into a loose three-word AND.
function lex(query) {
  const re = /([a-zA-Z]+):"([^"]*)"|([a-zA-Z]+):(\S*)|"([^"]*)"|(\S+)/g;
  const out = [];
  let m = re.exec(query);

  while (m) {
    if (m[1] !== undefined) out.push({ key: m[1], text: m[2] });
    else if (m[3] !== undefined) out.push({ key: m[3], text: m[4] });
    else if (m[5] !== undefined) out.push({ key: null, text: m[5] });
    else out.push({ key: null, text: m[6] });
    m = re.exec(query);
  }

  return out;
}

export function parseQuery(query) {
  const terms = [];
  const years = [];

  for (const tok of lex(query)) {
    const key = tok.key && tok.key.toLowerCase();

    if (key === 'year') {
      const range = tok.text.match(/^(\d{4})\s*(?:-|\.\.)\s*(\d{4})$/);
      if (range) years.push([Number(range[1]), Number(range[2])]);
      else if (/^\d{4}$/.test(tok.text)) years.push([Number(tok.text), Number(tok.text)]);
      continue;
    }

    const field = key && FIELD_ALIASES[key];
    if (field) {
      const value = normalize(tok.text);
      if (value) terms.push({ field, value });
      continue;
    }

    // An unrecognised prefix is not a field — search for it literally, so a
    // typo like `atrist:aphex` finds nothing rather than everything.
    const value = normalize(key ? `${key}:${tok.text}` : tok.text);
    if (value) terms.push({ field: 'hayAll', value });
  }

  return { terms, years };
}

// Every term must match (AND). Word-start hits score above mid-word hits, so
// "war" ranks "War Pigs" above "Software".
function scoreTerm(hay, value) {
  const at = hay.indexOf(value);
  if (at === -1) return 0;
  if (hay === value) return 12;
  if (at === 0) return 6;
  if (hay[at - 1] === ' ') return 4;
  return 1;
}

export function search(tracks, query, filters = {}) {
  const { terms, years } = parseQuery(query);
  const {
    playlistIds = null,
    yearFrom = null,
    yearTo = null,
    addedFrom = null,
    addedTo = null,
  } = filters;

  const results = [];

  for (const t of tracks) {
    if (playlistIds && playlistIds.size) {
      let hit = false;
      for (const id of t.playlistIds) {
        if (playlistIds.has(id)) { hit = true; break; }
      }
      if (!hit) continue;
    }

    if (yearFrom !== null && (t.year === null || t.year < yearFrom)) continue;
    if (yearTo !== null && (t.year === null || t.year > yearTo)) continue;

    if (addedFrom !== null || addedTo !== null) {
      const addedYears = t.sources
        .map((s) => (s.addedAt ? Number(s.addedAt.slice(0, 4)) : null))
        .filter((y) => y !== null);
      const inRange = addedYears.some((y) => (addedFrom === null || y >= addedFrom)
        && (addedTo === null || y <= addedTo));
      if (!inRange) continue;
    }

    if (years.length) {
      const ok = years.some(([lo, hi]) => t.year !== null && t.year >= lo && t.year <= hi);
      if (!ok) continue;
    }

    let score = 0;
    let matched = true;

    for (const term of terms) {
      const s = scoreTerm(t[term.field], term.value);
      if (!s) { matched = false; break; }
      score += term.field === 'hayAll' ? s : s * 1.5;
    }

    if (!matched) continue;

    // A track filed in several months is one you kept coming back to.
    score += Math.min(t.sources.length - 1, 4) * 0.5;

    t.score = score;
    results.push(t);
  }

  return results;
}

// --- sorting ---------------------------------------------------------------

function cmpText(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

export const SORTS = {
  relevance: {
    label: 'Best match',
    fn: (a, b) => (b.score || 0) - (a.score || 0)
      || String(b.lastAdded).localeCompare(String(a.lastAdded)),
  },
  newest: {
    label: 'Recently filed',
    fn: (a, b) => String(b.lastAdded).localeCompare(String(a.lastAdded)),
  },
  oldest: {
    label: 'Filed longest ago',
    fn: (a, b) => String(a.firstAdded).localeCompare(String(b.firstAdded)),
  },
  artist: {
    label: 'Artist A–Z',
    fn: (a, b) => cmpText(a.artistLine, b.artistLine) || cmpText(a.name, b.name),
  },
  release: {
    label: 'Release year, newest',
    fn: (a, b) => (b.year || 0) - (a.year || 0) || cmpText(a.artistLine, b.artistLine),
  },
  releaseOld: {
    label: 'Release year, oldest',
    fn: (a, b) => (a.year || 9999) - (b.year || 9999) || cmpText(a.artistLine, b.artistLine),
  },
  revisited: {
    label: 'Filed most often',
    fn: (a, b) => (b.sourceList || b.sources).length - (a.sourceList || a.sources).length
      || String(b.lastAdded).localeCompare(String(a.lastAdded)),
  },
  random: { label: 'Shuffle', fn: null },
};

export function sortResults(items, key, seed = 1) {
  if (key === 'random') {
    // Deterministic shuffle: a hash of (id, seed) keeps the order stable across
    // re-renders but reshuffles when the user asks for a new roll.
    const keyed = items.map((it) => {
      let h = seed;
      const s = String(it.id);
      for (let i = 0; i < s.length; i += 1) {
        h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
      }
      return [(h >>> 0) / 4294967296, it];
    });
    keyed.sort((a, b) => a[0] - b[0]);
    return keyed.map((k) => k[1]);
  }

  const sort = SORTS[key] || SORTS.relevance;
  return items.slice().sort(sort.fn);
}

// Facets over the *current* result set, so they narrow what you are looking at
// rather than describing the whole crate.
export function facets(tracks, limit = 12) {
  const artists = new Map();
  const decades = new Map();

  for (const t of tracks) {
    for (const name of t.artists) artists.set(name, (artists.get(name) || 0) + 1);
    if (t.year !== null) {
      const d = Math.floor(t.year / 10) * 10;
      decades.set(d, (decades.get(d) || 0) + 1);
    }
  }

  return {
    artists: [...artists.entries()].sort((a, b) => b[1] - a[1] || cmpText(a[0], b[0])).slice(0, limit),
    decades: [...decades.entries()].sort((a, b) => b[0] - a[0]),
  };
}
