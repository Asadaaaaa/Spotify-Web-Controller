const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const Haikunator = require('haikunator');

const haikunator = new Haikunator({
    defaults: {
        tokenLength: 4
    }
});

class SpotifyWebControllerServer {
    constructor(port = 8080) {
        this.port = process.env.PORT || port;
        this.httpsPort = 8443;
        this.app = express();
        this.server = http.createServer(this.app);

        const keyPath = path.join(__dirname, 'key.pem');
        const certPath = path.join(__dirname, 'cert.pem');
        this.isHttps = fs.existsSync(keyPath) && fs.existsSync(certPath);

        if (this.isHttps) {
            const options = {
                key: fs.readFileSync(keyPath),
                cert: fs.readFileSync(certPath)
            };
            this.httpsServer = https.createServer(options, this.app);
        } else {
            this.httpsServer = null;
        }

        this.wss = new WebSocket.Server({ noServer: true });

        this.spotifySocket = null;
        this.clientSockets = new Set();
        this.cacheDir = path.join(__dirname, 'storage');
        this.lyricsCachePath = path.join(this.cacheDir, 'lyrics-cache.json');
        this.lyricsCache = this.loadLyricsCache();
        this.lyricsRefreshInFlight = new Set();
        this.LYRICS_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

        this.deviceNamesPath = path.join(this.cacheDir, 'device-names.json');
        this.deviceNames = this.loadDeviceNames();

        // --- Blocked Keywords Filter ---
        // Path and in-memory store for blocked keywords.
        // Default keywords are seeded on first run (when no file exists).
        // Used to block songs by title/artist match (case-insensitive, min 5 chars).
        this.blockedKeywordsPath = path.join(this.cacheDir, 'blocked-keywords.json');
        this.blockedKeywords = this.loadBlockedKeywords();

        this.initMiddleware();
        this.initWebSocket();
    }

    loadDeviceNames() {
        try {
            if (fs.existsSync(this.deviceNamesPath)) {
                return JSON.parse(fs.readFileSync(this.deviceNamesPath, 'utf8'));
            }
        } catch (e) {
            console.error('Failed to load device names:', e);
        }
        return {};
    }

    saveDeviceNames() {
        try {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            fs.writeFileSync(this.deviceNamesPath, JSON.stringify(this.deviceNames, null, 2));
        } catch (e) {
            console.error('Failed to save device names:', e);
        }
    }

    /**
     * Load blocked keywords from local server storage.
     * If the file does not exist yet, seed with sensible defaults.
     * Each keyword must be at least 5 characters long; matching is case-insensitive
     * and uses substring (wildcard-style) comparison against track title and artist.
     */
    loadBlockedKeywords() {
        const defaults = ["Baon Cikadap", "Lagu Jorok", "Oke Gas", "Jokowi"];
        try {
            if (!fs.existsSync(this.blockedKeywordsPath)) {
                const seed = { keywords: defaults };
                fs.mkdirSync(this.cacheDir, { recursive: true });
                fs.writeFileSync(this.blockedKeywordsPath, JSON.stringify(seed, null, 2));
                return seed;
            }
            const raw = fs.readFileSync(this.blockedKeywordsPath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                keywords: Array.isArray(parsed?.keywords) ? parsed.keywords : defaults
            };
        } catch (err) {
            console.error('Failed to load blocked keywords:', err);
            return { keywords: defaults };
        }
    }

    /**
     * Persist blocked keywords to local disk.
     */
    saveBlockedKeywords() {
        try {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            fs.writeFileSync(this.blockedKeywordsPath, JSON.stringify(this.blockedKeywords, null, 2));
        } catch (err) {
            console.error('Failed to save blocked keywords:', err);
        }
    }

    /**
     * Load persisted lyrics cache from local server storage.
     */
    loadLyricsCache() {
        try {
            if (!fs.existsSync(this.lyricsCachePath)) {
                return { version: 1, lyrics: {} };
            }

            const raw = fs.readFileSync(this.lyricsCachePath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                version: 1,
                lyrics: parsed.lyrics && typeof parsed.lyrics === 'object' ? parsed.lyrics : {}
            };
        } catch (err) {
            console.error('Failed to load lyrics cache:', err);
            return { version: 1, lyrics: {} };
        }
    }

    /**
     * Persist lyrics cache to local disk.
     */
    saveLyricsCache() {
        try {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            fs.writeFileSync(this.lyricsCachePath, JSON.stringify(this.lyricsCache, null, 2));
        } catch (err) {
            console.error('Failed to save lyrics cache:', err);
        }
    }

    getTrackKey(track) {
        if (!track) return '';
        return [
            track.uri || '',
            track.title || '',
            track.artist || '',
            track.album || ''
        ].join('|');
    }

    hashLyricsPayload(payload) {
        const canonical = JSON.stringify({
            title: payload?.title || '',
            artist: payload?.artist || '',
            album: payload?.album || '',
            source: payload?.source || '',
            synced: !!payload?.synced,
            lines: Array.isArray(payload?.lines) ? payload.lines : [],
            rawText: payload?.rawText || ''
        });
        return crypto.createHash('sha256').update(canonical).digest('hex');
    }

    parseSyncedLyrics(text) {
        if (!text || typeof text !== 'string') return [];

        const lines = [];
        for (const row of text.split(/\r?\n/)) {
            const matches = [...row.matchAll(/\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
            if (matches.length === 0) continue;

            const lyricText = row.replace(/\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/g, '').trim();
            if (!lyricText) continue;

            for (const match of matches) {
                const minutes = parseInt(match[1], 10);
                const seconds = parseInt(match[2], 10);
                const fraction = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
                lines.push({
                    time: (minutes * 60 * 1000) + (seconds * 1000) + fraction,
                    text: lyricText
                });
            }
        }

        return lines.sort((a, b) => a.time - b.time);
    }

    parsePlainLyrics(text) {
        if (!text || typeof text !== 'string') return [];
        return text
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(text => ({ time: -1, text }));
    }

    async fetchLyricsFromProvider(track) {
        if (!track?.title || !track?.artist) return null;

        const query = new URLSearchParams({
            track_name: track.title,
            artist_name: track.artist
        });
        if (track.album) query.set('album_name', track.album);
        if (track.duration) query.set('duration', String(Math.round(track.duration / 1000)));

        const resp = await fetch(`https://lrclib.net/api/get?${query.toString()}`, {
            headers: { accept: 'application/json' }
        });

        if (!resp.ok) {
            if (resp.status === 404) return null;
            throw new Error(`LRCLIB HTTP ${resp.status}`);
        }

        const json = await resp.json();
        let lines = [];
        let synced = false;

        if (json?.syncedLyrics) {
            lines = this.parseSyncedLyrics(json.syncedLyrics);
            synced = lines.length > 0;
        }
        if (lines.length === 0 && json?.plainLyrics) {
            lines = this.parsePlainLyrics(json.plainLyrics);
        }
        if (lines.length === 0 && typeof json?.lyrics === 'string') {
            lines = this.parsePlainLyrics(json.lyrics);
        }

        return {
            loading: false,
            trackKey: this.getTrackKey(track),
            title: track.title,
            artist: track.artist,
            album: track.album || '',
            source: 'LRCLIB',
            synced,
            lines,
            rawText: json?.plainLyrics || json?.lyrics || ''
        };
    }

    cacheLyricsPayload(payload) {
        if (!payload?.trackKey) return false;

        const normalizedPayload = {
            loading: false,
            trackKey: payload.trackKey,
            title: payload.title || '',
            artist: payload.artist || '',
            album: payload.album || '',
            source: payload.source || 'LRCLIB',
            synced: !!payload.synced,
            lines: Array.isArray(payload.lines) ? payload.lines : [],
            rawText: payload.rawText || ''
        };
        const hash = this.hashLyricsPayload(normalizedPayload);
        const existing = this.lyricsCache.lyrics[normalizedPayload.trackKey];

        this.lyricsCache.lyrics[normalizedPayload.trackKey] = {
            hash,
            updatedAt: existing?.updatedAt && existing.hash === hash ? existing.updatedAt : new Date().toISOString(),
            lastCheckedAt: new Date().toISOString(),
            payload: normalizedPayload
        };
        this.saveLyricsCache();

        return !existing || existing.hash !== hash;
    }

    sendCachedLyrics(track, ws = null) {
        const trackKey = this.getTrackKey(track);
        const cached = this.lyricsCache.lyrics[trackKey];
        if (!cached?.payload) return false;

        const message = {
            type: 'lyrics',
            data: {
                ...cached.payload,
                loading: false,
                cached: true
            }
        };

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        } else {
            this.broadcastToClients(message);
        }

        return true;
    }

    async refreshLyricsCache(track) {
        const trackKey = this.getTrackKey(track);
        if (!trackKey || this.lyricsRefreshInFlight.has(trackKey)) return;

        const cached = this.lyricsCache.lyrics[trackKey];
        const lastChecked = cached?.lastCheckedAt ? new Date(cached.lastCheckedAt).getTime() : 0;
        const isFresh = lastChecked && (Date.now() - lastChecked < this.LYRICS_REFRESH_INTERVAL_MS);
        if (cached && isFresh) return;

        this.lyricsRefreshInFlight.add(trackKey);
        try {
            const lyrics = await this.fetchLyricsFromProvider(track);
            const payload = lyrics || {
                loading: false,
                trackKey,
                title: track?.title || '',
                artist: track?.artist || '',
                album: track?.album || '',
                source: 'LRCLIB',
                synced: false,
                lines: [],
                rawText: ''
            };

            const changed = this.cacheLyricsPayload(payload);
            if (changed) {
                this.broadcastToClients({ type: 'lyrics', data: { ...payload, cached: false } });
            }
        } catch (err) {
            console.error('Failed to refresh lyrics cache:', err);
        } finally {
            this.lyricsRefreshInFlight.delete(trackKey);
        }
    }

    handlePlaybackState(data) {
        if (!data?.track) return;

        const hadCache = this.sendCachedLyrics(data.track);
        if (!hadCache) {
            this.broadcastToClients({
                type: 'lyrics',
                data: {
                    loading: true,
                    trackKey: this.getTrackKey(data.track),
                    title: data.track.title || '',
                    artist: data.track.artist || ''
                }
            });
        }

        this.refreshLyricsCache(data.track);
    }

    /**
     * Set up HTTP route middlewares
     */
    initMiddleware() {
        this.app.use(express.static(path.join(__dirname, 'public')));
    }

    /**
     * Bind connection events and HTTP connection upgrades to WS
     */
    initWebSocket() {
        const handleUpgrade = (request, socket, head) => {
            const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

            if (pathname === '/spotify') {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit('connection', ws, request, 'spotify');
                });
            } else if (pathname === '/client') {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit('connection', ws, request, 'client');
                });
            } else {
                socket.destroy();
            }
        };

        this.server.on('upgrade', handleUpgrade);
        if (this.httpsServer) {
            this.httpsServer.on('upgrade', handleUpgrade);
        }

        this.wss.on('connection', (ws, request, type) => {
            if (type === 'spotify') {
                this.handleSpotifyConnection(ws);
            } else if (type === 'client') {
                this.handleClientConnection(ws, request);
            }
        });
    }

    /**
     * Manage Spicetify Extension connection and relays
     */
    handleSpotifyConnection(ws) {
        console.log('Spotify Extension connected!');
        this.spotifySocket = ws;

        // Notify all web clients that Spotify is online
        this.broadcastToClients({ type: 'spotify_online', data: true });

        ws.on('message', (message) => {
            try {
                const parsed = JSON.parse(message);
                console.log(`[Spotify -> Server] type: ${parsed.type}, clientId: ${parsed.clientId || 'none'}`);
                if (parsed.type === 'lyrics') {
                    if (parsed.data && !parsed.data.loading) {
                        const changed = this.cacheLyricsPayload(parsed.data);
                        if (changed) this.broadcastToClients(parsed);
                    }
                    return;
                }

                // If message has a clientId, send it only to that client
                if (parsed.clientId) {
                    this.sendToClient(parsed.clientId, parsed);
                    return;
                }

                // Enrich track information with requestedBy before broadcasting
                if (parsed.type === 'state' && parsed.data?.track) {
                    const uri = parsed.data.track.uri;
                    if (this.trackRequesters && this.trackRequesters[uri]) {
                        parsed.data.track.requestedBy = this.trackRequesters[uri];
                    }
                } else if (parsed.type === 'queue' && parsed.data) {
                    if (!this.trackRequesters) this.trackRequesters = {};
                    if (parsed.data.current && this.trackRequesters[parsed.data.current.uri]) {
                        parsed.data.current.requestedBy = this.trackRequesters[parsed.data.current.uri];
                    }
                    ['next', 'nextInQueue', 'nextUp', 'prev'].forEach(key => {
                        if (Array.isArray(parsed.data[key])) {
                            parsed.data[key].forEach(track => {
                                if (track && this.trackRequesters[track.uri]) {
                                    track.requestedBy = this.trackRequesters[track.uri];
                                }
                            });
                        }
                    });
                }

                // Relay everything from Spotify to all Web Clients
                this.broadcastToClients(parsed);

                if (parsed.type === 'state') {
                    this.handlePlaybackState(parsed.data);
                }
            } catch (err) {
                console.error('Error parsing message from Spotify:', err);
            }
        });

        ws.on('close', () => {
            console.log('Spotify Extension disconnected!');
            this.spotifySocket = null;
            this.broadcastToClients({ type: 'spotify_online', data: false });
        });

        ws.on('error', (err) => {
            console.error('Spotify socket error:', err);
        });
    }

    handleClientConnection(ws, request) {
        console.log('Web Client connected!');
        ws.clientId = crypto.randomUUID();
        
        // Extract persistent deviceId from request query parameters
        let deviceId = 'unknown';
        try {
            const urlObj = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
            deviceId = urlObj.searchParams.get('deviceId') || crypto.randomUUID();
        } catch (e) {
            console.error('Failed to parse connection URL query params:', e);
            deviceId = crypto.randomUUID();
        }
        ws.deviceId = deviceId;

        // Resolve or generate a readable random name using Haikunator
        if (!this.deviceNames[deviceId]) {
            this.deviceNames[deviceId] = haikunator.haikunate();
            this.saveDeviceNames();
        }
        ws.clientName = this.deviceNames[deviceId];
        
        // Parse User-Agent to extract device type and OS
        const ua = (request && request.headers && request.headers['user-agent']) || '';
        
        // Detect Device Type
        let device = 'Web Browser';
        if (/tablet|ipad|playbook|silk/i.test(ua)) {
            device = 'Tablet';
        } else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle/i.test(ua)) {
            device = 'Mobile';
        } else {
            device = 'Desktop';
        }
        
        // Detect OS
        let os = '';
        if (ua.indexOf('Win') !== -1) os = 'Windows';
        else if (ua.indexOf('Mac') !== -1) os = 'macOS';
        else if (/Android/i.test(ua)) os = 'Android';
        else if (ua.indexOf('X11') !== -1 || ua.indexOf('Linux') !== -1) os = 'Linux';
        else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
        
        ws.clientDevice = os ? `${device} (${os})` : device;
        
        this.clientSockets.add(ws);

        // Send current online status of Spotify to the client
        ws.send(JSON.stringify({ type: 'spotify_online', data: this.spotifySocket !== null }));

        // Notify client of their registration details
        ws.send(JSON.stringify({
            type: 'client_registered',
            data: {
                clientId: ws.clientId,
                name: ws.clientName,
                device: ws.clientDevice
            }
        }));

        // Send current blocked keywords list to the new client so the UI can enforce filtering immediately
        ws.send(JSON.stringify({
            type: 'blocked_keywords',
            data: { keywords: this.blockedKeywords.keywords }
        }));

        // Request full state from Spotify if it's connected, so new client gets immediate update
        if (this.spotifySocket && this.spotifySocket.readyState === WebSocket.OPEN) {
            this.spotifySocket.send(JSON.stringify({ type: 'request_state' }));
        }

        // Broadcast initial client list including this new client
        this.broadcastClientList();

        ws.on('message', (message) => {
            try {
                const parsed = JSON.parse(message);

                // Handle client registration / profile update (fallback)
                if (parsed.type === 'register_client') {
                    if (parsed.data) {
                        if (parsed.data.device) ws.clientDevice = parsed.data.device;
                        
                        this.broadcastClientList();
                    }
                    return;
                }

                // Handle request for device action history
                if (parsed.type === 'get_history') {
                    const targetId = parsed.data && parsed.data.targetDeviceId;
                    const historyFile = path.join(this.cacheDir, 'action-history.json');
                    let history = [];
                    if (fs.existsSync(historyFile)) {
                        try {
                            const allHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
                            // Filter history by targetId, limit to last 50 actions for UI
                            history = allHistory
                                .filter(entry => entry.deviceId === targetId)
                                .slice(-50)
                                .reverse();
                        } catch (e) {
                            history = [];
                        }
                    }
                    ws.send(JSON.stringify({
                        type: 'device_history',
                        data: {
                            deviceId: targetId,
                            history: history
                        }
                    }));
                    return;
                }

                // --- Blocked Keywords Handlers ---
                // Client requests the current blocked keywords list
                if (parsed.type === 'get_blocked_keywords') {
                    ws.send(JSON.stringify({
                        type: 'blocked_keywords',
                        data: { keywords: this.blockedKeywords.keywords }
                    }));
                    return;
                }

                // Client submits an updated blocked keywords list
                if (parsed.type === 'update_blocked_keywords') {
                    const newKeywords = Array.isArray(parsed?.data?.keywords)
                        ? parsed.data.keywords.filter(kw => typeof kw === 'string' && kw.trim().length >= 5)
                        : [];
                    // Persist to disk
                    this.blockedKeywords.keywords = newKeywords;
                    this.saveBlockedKeywords();
                    // Broadcast the updated list to ALL connected clients so filtering is in sync everywhere
                    this.broadcastToClients({
                        type: 'blocked_keywords',
                        data: { keywords: newKeywords }
                    });
                    console.log(`[Blocked Keywords] Updated by ${ws.clientName}. Count: ${newKeywords.length}`);
                    return;
                }

                // Attach client ID to request so we can route back to this specific client
                parsed.clientId = ws.clientId;
                console.log(`[Client -> Server] type: ${parsed.type}, clientId: ${parsed.clientId}`);

                // Track who requested which song
                if (parsed.type === 'add_queue' && typeof parsed.data === 'string') {
                    if (!this.trackRequesters) this.trackRequesters = {};
                    // Extract URI and store requester name
                    this.trackRequesters[parsed.data] = ws.clientName;
                }

                // Log actions of interest (skip, queue, drag/reorder)
                if (['add_queue', 'reorder_queue', 'next', 'back'].includes(parsed.type)) {
                    this.logAction(ws.deviceId || 'unknown', ws.clientName || 'unknown', parsed.type, parsed.data);
                }

                // Relay commands from Web Client to Spotify
                if (this.spotifySocket && this.spotifySocket.readyState === WebSocket.OPEN) {
                    this.spotifySocket.send(JSON.stringify(parsed));
                } else {
                    console.log('Command ignored: Spotify is not connected.');
                    ws.send(JSON.stringify({ type: 'error', data: 'Spotify is not connected.', clientId: ws.clientId }));
                }
            } catch (err) {
                console.error('Error parsing message from Client:', err);
            }
        });

        ws.on('close', () => {
            console.log('Web Client disconnected.');
            this.clientSockets.delete(ws);
            this.broadcastClientList();
        });

        ws.on('error', (err) => {
            console.error('Client socket error:', err);
            this.clientSockets.delete(ws);
            this.broadcastClientList();
        });
    }

    /**
     * Persist client action history to local storage
     */
    logAction(deviceId, clientName, action, data) {
        try {
            const historyFile = path.join(this.cacheDir, 'action-history.json');
            let history = [];
            if (fs.existsSync(historyFile)) {
                try {
                    history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
                } catch (e) {
                    history = [];
                }
            }

            const logEntry = {
                timestamp: new Date().toISOString(),
                deviceId,
                clientName,
                action,
                details: data || null
            };

            history.push(logEntry);

            // Filter history to keep only entries from the last 3 days
            const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
            history = history.filter(entry => {
                if (!entry.timestamp) return false;
                const entryTime = new Date(entry.timestamp).getTime();
                return entryTime >= threeDaysAgo;
            });

            // Cap the logs size to 1000 items as a secondary safety check
            if (history.length > 1000) {
                history = history.slice(-1000);
            }

            fs.mkdirSync(this.cacheDir, { recursive: true });
            fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
            console.log(`[History Log] Device: ${deviceId} (${clientName}) -> Action: ${action}`);
        } catch (err) {
            console.error('Failed to log action:', err);
        }
    }

    /**
     * Broadcast list of all active connected clients
     */
    broadcastClientList() {
        const list = Array.from(this.clientSockets).map(client => ({
            clientId: client.clientId,
            name: client.clientName,
            device: client.clientDevice,
            deviceId: client.deviceId
        }));
        this.broadcastToClients({
            type: 'client_list',
            data: list
        });
    }

    /**
     * Send WebSocket event to a specific client by ID
     */
    sendToClient(clientId, messageObj) {
        const payload = JSON.stringify(messageObj);
        for (const client of this.clientSockets) {
            if (client.clientId === clientId && client.readyState === WebSocket.OPEN) {
                client.send(payload);
                break;
            }
        }
    }

    /**
     * Broadcast WebSocket events to all active Web Clients
     */
    broadcastToClients(messageObj) {
        const payload = JSON.stringify(messageObj);
        for (const client of this.clientSockets) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }

    /**
     * Utility to resolve local IP interfaces for remote connections
     */
    getLocalIPs() {
        const interfaces = os.networkInterfaces();
        const ips = [];
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                // Skip loopback and non-IPv4 addresses
                if (iface.family === 'IPv4' && !iface.internal) {
                    ips.push(iface.address);
                }
            }
        }
        return ips;
    }

    /**
     * Start Express server listening
     */
    start() {
        // Start HTTP Server
        this.server.listen(this.port, () => {
            console.log('\n======================================================');
            console.log(`Spotify Web Controller Server (HTTP) is running on port ${this.port}`);
            console.log('======================================================');
            console.log(`Access locally: http://localhost:${this.port}`);
            
            const localIPs = this.getLocalIPs();
            if (localIPs.length > 0) {
                console.log('\nTo control Spotify from other devices (HTTP):');
                localIPs.forEach(ip => {
                    console.log(`👉 http://${ip}:${this.port}`);
                });
            }
            console.log('======================================================\n');
        });

        // Start HTTPS Server if certificates are available
        if (this.httpsServer) {
            this.httpsServer.listen(this.httpsPort, () => {
                console.log('======================================================');
                console.log(`Spotify Web Controller Server (HTTPS) is running on port ${this.httpsPort}`);
                console.log('======================================================');
                console.log(`Access securely: https://localhost:${this.httpsPort}`);
                
                const localIPs = this.getLocalIPs();
                if (localIPs.length > 0) {
                    console.log('\nTo control Spotify from other devices (HTTPS/Picture-in-Picture):');
                    localIPs.forEach(ip => {
                        console.log(`👉 https://${ip}:${this.httpsPort}`);
                    });
                }
                console.log('======================================================\n');
            });
        }
    }
}

const serverInstance = new SpotifyWebControllerServer(8080);
serverInstance.start();
