# Spotify Web Controller

A local web controller for Spotify Desktop powered by a Spicetify extension. Control playback, queue, search, and view lyrics on any device in your local network.

## Features

- **Remote Playback:** Control play, pause, skip, volume, shuffle, repeat, and seek.
- **Search & Queue:** Search Spotify tracks and manage the play queue (with drag-and-drop).
- **Lyrics:** Synced lyrics view with cached lookup.
- **Responsive Design:** Premium mobile-friendly UI.

## Requirements

- Node.js (v18+)
- Spotify Desktop
- [Spicetify](https://spicetify.app/) installed and configured

## Getting Started

1. **Install dependencies:**
   ```bash
   cd web-controller
   npm install
   ```

2. **Run the controller:**
   From the project root:
   ```bash
   node index.js
   ```
   *This automatically registers the extension with Spicetify and starts the local server.*

3. **Access the Web UI:**
   Open `http://localhost:8080` on your desktop, or use the local network IP printed in the console to open it from your phone.

## Troubleshooting

- **Spotify shows offline:** Ensure Spotify Desktop is running and you have run the start command (`node index.js`) which applies the Spicetify extension.
- **Not loading from mobile:** Ensure both your computer and phone are on the same Wi-Fi network and check your firewall settings for port `8080`.

