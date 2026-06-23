# Spotify Web Controller

A local web controller for Spotify Desktop powered by a Spicetify extension.

The project runs a small Node.js web server that serves a browser UI and relays WebSocket messages between the browser and Spotify Desktop. The Spicetify extension runs inside Spotify, reads player/queue state, performs player commands, and keeps the web UI in sync.

## Features

- Remote playback controls: play/pause, previous, next, seek, shuffle, repeat, and volume.
- Live now-playing display with album art and ambient background glow.
- Search Spotify tracks from the web UI.
- Play tracks immediately or add them to the queue.
- Queue view with `Now Playing`, `Next In Queue`, and `Next Up`.
- Drag-and-drop queue reordering on desktop and touch reordering on mobile.
- Mobile queue bottom sheet.
- Lyrics panel with synced highlighting.
- Mobile lyrics toggle that swaps the vinyl art for lyrics.
- Server-side lyrics cache with SHA-256 refresh checks.

## Project Structure

```text
.
├── spicetify-extension/
│   └── web-controller.js        # Extension loaded by Spicetify inside Spotify Desktop
└── web-controller/
    ├── server.js                # Express + WebSocket relay server
    ├── package.json
    ├── public/
    │   ├── index.html           # Browser UI markup
    │   ├── app.js               # Browser WebSocket client and UI logic
    │   └── style.css            # Responsive player, queue, and lyrics styling
    └── storage/
        ├── .gitignore
        └── lyrics-cache.json    # Runtime cache, generated automatically
```

## Requirements

- Node.js 18 or newer.
- Spotify Desktop.
- Spicetify installed and configured.

Spicetify extension docs:
https://spicetify.app/docs/development/extensions#getting-started

## Install

Install server dependencies:

```bash
cd web-controller
npm install
```

## Run The Web Server

Run everything from the project root:

```bash
node index.js
```

This starts the web server, copies `spicetify-extension/web-controller.js` into the Spicetify `Extensions` directory, runs `spicetify config extensions web-controller.js`, runs `spicetify apply`, and then starts `spicetify auto`.

Or start only the local web controller server:

```bash
cd web-controller
npm start
```

By default, the server listens on port `8080`.

Open the controller locally:

```text
http://localhost:8080
```

The server also prints local network URLs so you can open the controller from a phone on the same network.

## Install The Spicetify Extension

Copy or link the extension file into your Spicetify extensions folder:

```bash
cp spicetify-extension/web-controller.js "$(spicetify path userdata)/Extensions/web-controller.js"
```

Enable and apply it:

```bash
spicetify config extensions web-controller.js
spicetify apply
```

Then open Spotify Desktop. The web UI will show as connected once the extension connects to `ws://localhost:8080/spotify`.

## How It Works

There are two WebSocket paths:

- `/spotify`: used by the Spicetify extension running inside Spotify Desktop.
- `/client`: used by browser clients that open the web controller.

The web server relays player commands from the browser to Spotify and relays player, queue, search, progress, volume, and lyrics updates back to all connected browser clients.

## Lyrics Cache

Lyrics are cached by the web server in:

```text
web-controller/storage/lyrics-cache.json
```

When the current track changes:

1. The server checks local lyrics storage using the track key.
2. If cached lyrics exist, they are sent immediately to the browser.
3. In the background, the server fetches fresh lyrics from LRCLIB.
4. The server hashes the normalized lyrics payload with SHA-256.
5. If the fresh hash differs from the cached hash, the cache is updated and clients receive the new lyrics.

This keeps lyrics fast after the first fetch while still allowing the cache to refresh when provider data changes.

The generated cache file is ignored by Git.

## Mobile Behavior

On smaller screens:

- The queue moves into a bottom-sheet modal.
- The queue button appears in the volume row.
- The lyrics button appears beside the track title and artist.
- Tapping the lyrics button replaces the vinyl cover with the synced lyrics view.
- Queue reordering uses touch gestures.

## Useful Commands

Run syntax checks:

```bash
node --check web-controller/server.js
node --check web-controller/public/app.js
node --check spicetify-extension/web-controller.js
```

Start the server:

```bash
cd web-controller
npm start
```

## Troubleshooting

If the web UI says Spotify is offline:

- Make sure Spotify Desktop is open.
- Make sure the Spicetify extension is installed and enabled.
- Restart the web server.
- Run `spicetify apply` after changing extension files.

If lyrics do not appear:

- Play a normal Spotify track, not a podcast or local file.
- Check whether `web-controller/storage/lyrics-cache.json` is being created.
- Some tracks may not have lyrics available from LRCLIB.

If controls do not work from another device:

- Make sure the phone/computer is on the same network.
- Use the local IP URL printed by the server.
- Check that the machine running the server allows inbound connections on port `8080`.
