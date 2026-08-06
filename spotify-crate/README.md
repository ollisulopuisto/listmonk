# Crate

Fifteen years of monthly Spotify playlists are a great archive and a terrible
library: they are sorted by when you filed something, which is the one thing you
never remember. Crate takes those playlists, folds them into a single searchable
collection, and lets you dig through it by artist, album, year or month.

It is a static page. No server, no build step, no account anywhere but Spotify.
Your playlists are cached in your own browser (IndexedDB) and searched locally,
so typing is instant and works offline once synced.

## What it does

- **Albums, not tracks.** You triage albums, but playlists store tracks — so the
  default view groups tracks back into the album they came from.
- **Deduplicates across months.** A record you filed in March 2019 and again in
  July 2021 is one result that tells you both, instead of two entries fifteen
  months apart. Sort by *Filed most often* to find the ones you kept returning to.
- **Keeps the chronology as a dimension, not a prison.** Every result shows which
  monthly playlists it came from; click one to pivot back into that month.
- **Search that understands the fields.** `artist:` `album:` `track:`
  `playlist:` `year:1998` `year:1990-1999` `"exact phrase"`, all combining with AND.
  Diacritics fold both ways, so `bjork` finds Björk.
- **Facets from the current results** — the artists and decades actually present
  in what you are looking at, as one-click filters.
- **Shuffle** for when you want the crate to surprise you rather than answer you.
- **Save any result set back to Spotify** as a new private playlist.

## Setup

Spotify requires every app to be registered, even a personal one. This takes
about a minute and is a one-time cost.

1. **Serve the folder.** Spotify only accepts `https://` or `http://127.0.0.1`
   redirect URIs, so opening `index.html` from disk will not work:

   ```sh
   cd spotify-crate
   npm run serve          # or: python3 -m http.server 8765 --bind 127.0.0.1
   ```

   Then open <http://127.0.0.1:8765/>.

2. **Register an app** at the [Spotify developer dashboard](https://developer.spotify.com/dashboard):
   *Create app* → any name → set the **Redirect URI** to exactly
   `http://127.0.0.1:8765/` (the app shows you the exact string, with a copy
   button) → tick **Web API** → save.

3. **Paste the Client ID** from the app's settings into Crate and sign in.

4. **Pick your playlists.** Filter by name (e.g. type `2019`, or whatever you
   call your monthly lists), *Select matching*, repeat, then **Save and sync**.

Deploying to any static host works too — GitHub Pages, Netlify, an S3 bucket.
Just register that URL as the redirect URI instead.

### If Spotify returns 403

New developer apps start in *development mode*, which only permits accounts you
have explicitly listed. Add your own account under the app's **User Management**
settings.

## Syncing

The first sync fetches every selected playlist: roughly one request per 100
tracks, so ~180 monthly playlists costs a couple of hundred requests and a
minute or two.

After that it is nearly free. Spotify stamps each playlist with a `snapshot_id`
that changes only when its contents change, so a resync re-fetches only the
months you actually touched — typically one or two.

## Privacy

The access token, the client ID and the cached playlists live in this browser
only. Nothing is sent anywhere except to Spotify's own API. Signing out clears
the token and leaves the cache, so you can still search offline. To wipe the
cache entirely, clear site data for the origin.

The app requests read access to your playlists, plus playlist-modify so the
"save as playlist" button can create new ones. It never modifies or deletes an
existing playlist.

## Tests

```sh
npm test          # search, grouping, ranking and sorting logic (node --test)

npm run serve &   # UI tests drive the real page in Chromium
npm run test:ui
```

The UI tests seed a fake synced crate into IndexedDB and block all network
access to Spotify, so they never touch a real account.

## Layout

| File | What it does |
| --- | --- |
| `index.html`, `app.css` | The page and its styling |
| `js/auth.js` | Spotify OAuth via PKCE — no client secret, no backend |
| `js/api.js` | Web API client: pagination, 429 backoff, 401 refresh-and-retry |
| `js/db.js` | IndexedDB cache, one record per playlist |
| `js/library.js` | The actual library: dedup, album grouping, query parsing, ranking, facets |
| `js/main.js` | State, sync orchestration and rendering |
