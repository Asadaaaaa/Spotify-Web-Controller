const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

class LyricsManager {
    constructor(cacheDir, broadcastFn) {
        this.cacheDir = cacheDir;
        this.broadcastFn = broadcastFn;
        this.lyricsCachePath = path.join(this.cacheDir, 'lyrics-cache.json');
        this.lyricsCache = this.loadLyricsCache();
        this.lyricsRefreshInFlight = new Set();
        this.LYRICS_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
    }

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
            logger.error('Failed to load lyrics cache:', err);
            return { version: 1, lyrics: {} };
        }
    }

    saveLyricsCache() {
        try {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            fs.writeFileSync(this.lyricsCachePath, JSON.stringify(this.lyricsCache, null, 2));
        } catch (err) {
            logger.error('Failed to save lyrics cache:', err);
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

        if (ws && ws.readyState === 1) { // 1 is WebSocket.OPEN
            ws.send(JSON.stringify(message));
        } else {
            this.broadcastFn(message);
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
                this.broadcastFn({ type: 'lyrics', data: { ...payload, cached: false } });
            }
        } catch (err) {
            logger.error('Failed to refresh lyrics cache:', err);
        } finally {
            this.lyricsRefreshInFlight.delete(trackKey);
        }
    }
}

module.exports = LyricsManager;
