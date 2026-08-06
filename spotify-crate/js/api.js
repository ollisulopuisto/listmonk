// Thin Spotify Web API client: auth headers, 429 backoff, 401 refresh-and-retry,
// and cursor pagination.

import { getAccessToken } from './auth.js';

const BASE = 'https://api.spotify.com/v1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SpotifyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body = null, retriedAuth = false, attempt = 0 } = {}) {
  const token = await getAccessToken({ force: retriedAuth });
  const url = path.startsWith('http') ? path : BASE + path;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !retriedAuth) {
    return request(path, { method, body, retriedAuth: true, attempt });
  }

  if (res.status === 429) {
    // Spotify tells us exactly how long to wait; honour it rather than guessing.
    const wait = Number(res.headers.get('Retry-After') || 2) + 1;
    await sleep(wait * 1000);
    return request(path, { method, body, retriedAuth, attempt });
  }

  if (res.status >= 500 && attempt < 3) {
    await sleep(2 ** attempt * 1000);
    return request(path, { method, body, retriedAuth, attempt: attempt + 1 });
  }

  if (res.status === 204 || res.headers.get('Content-Length') === '0') return null;

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = (data && data.error && (data.error.message || data.error)) || res.statusText;
    throw new SpotifyError(res.status, String(message));
  }

  return data;
}

// Walk a paged endpoint to exhaustion, reporting progress as it goes.
async function paged(path, onPage) {
  let next = path;
  const out = [];
  while (next) {
    // eslint-disable-next-line no-await-in-loop
    const page = await request(next);
    if (!page) break;
    out.push(...(page.items || []));
    if (onPage) onPage(out.length, page.total);
    next = page.next;
  }
  return out;
}

export const api = {
  me() {
    return request('/me');
  },

  // The user's own playlists, plus those they follow.
  async myPlaylists(onProgress) {
    const items = await paged('/me/playlists?limit=50', onProgress);
    return items.filter(Boolean).map((p) => ({
      id: p.id,
      name: p.name,
      snapshotId: p.snapshot_id,
      total: p.tracks ? p.tracks.total : 0,
      owner: p.owner ? p.owner.display_name || p.owner.id : '',
      ownerId: p.owner ? p.owner.id : '',
      image: p.images && p.images.length ? p.images[p.images.length - 1].url : null,
      url: p.external_urls ? p.external_urls.spotify : null,
    }));
  },

  // `fields` trims the response hard — with ~180 playlists this is the
  // difference between a few MB and a few tens of MB over the wire.
  async playlistTracks(playlistId, onProgress) {
    const fields = [
      'next',
      'total',
      'items(added_at,is_local,track(id,uri,name,duration_ms,popularity,'
        + 'artists(id,name),album(id,name,release_date,images)))',
    ].join(',');

    const items = await paged(
      `/playlists/${playlistId}/tracks?limit=100&fields=${encodeURIComponent(fields)}`,
      onProgress,
    );

    return items
      .filter((it) => it && it.track && it.track.id && !it.is_local)
      .map((it) => {
        const t = it.track;
        const album = t.album || {};
        const images = album.images || [];
        return {
          id: t.id,
          uri: t.uri,
          name: t.name,
          durationMs: t.duration_ms || 0,
          popularity: typeof t.popularity === 'number' ? t.popularity : null,
          artists: (t.artists || []).map((a) => ({ id: a.id, name: a.name })),
          albumId: album.id || null,
          albumName: album.name || '',
          releaseDate: album.release_date || '',
          albumImage: images.length ? images[images.length - 1].url : null,
          addedAt: it.added_at || null,
        };
      });
  },

  createPlaylist(userId, { name, description, isPublic }) {
    return request(`/users/${encodeURIComponent(userId)}/playlists`, {
      method: 'POST',
      body: { name, description, public: Boolean(isPublic) },
    });
  },

  async addTracks(playlistId, uris, onProgress) {
    for (let i = 0; i < uris.length; i += 100) {
      const batch = uris.slice(i, i + 100);
      // eslint-disable-next-line no-await-in-loop
      await request(`/playlists/${playlistId}/tracks`, { method: 'POST', body: { uris: batch } });
      if (onProgress) onProgress(Math.min(i + batch.length, uris.length), uris.length);
    }
  },
};
