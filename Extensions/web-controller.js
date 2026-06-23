(function SpotifyWebControllerExtension() {
    // Wait for Spicetify APIs to be fully ready
    if (!window.Spicetify || !Spicetify.Player || !Spicetify.Queue || !Spicetify.Platform || !Spicetify.CosmosAsync) {
        setTimeout(SpotifyWebControllerExtension, 100);
        return;
    }

    class SpotifyWebController {
        constructor() {
            this.ws = null;
            this.reconnectTimeout = null;
            this.lastVolume = typeof Spicetify.Player.getVolume === 'function' ? Spicetify.Player.getVolume() : 0.5;
            this.capturedClientToken = null;
            this.capturedAccessToken = null;
            this.origFetch = window.fetch.bind(window);
            
            // Cache settings
            this.searchCache = new Map();
            this.lyricsCache = new Map();
            this.CACHE_TTL = 30000; // 30 seconds

            // Polling detection state
            this.lastQueueRevision = '';
            this.lastQueueUris = '';

            console.log("Spotify Web Controller Extension: Loading...");

            this.initTokenInterceptor();
            this.initEventListeners();
            this.initQueueAndVolumePolling();
            this.connect();
        }

        /**
         * Intercepts fetch calls to capture authorization tokens needed for partner APIs
         */
        initTokenInterceptor() {
            const self = this;
            window.fetch = function(url, opts) {
                try {
                    const urlStr = typeof url === 'string' ? url : (url?.url || '');
                    if (urlStr.includes('api-partner.spotify.com')) {
                        const headers = opts?.headers || {};
                        if (headers['client-token']) {
                            self.capturedClientToken = headers['client-token'];
                        }
                        if (headers['authorization']) {
                            self.capturedAccessToken = headers['authorization'].replace('Bearer ', '');
                        }
                    }
                } catch (err) {
                    console.error("Spotify Web Controller Extension: Error in token interceptor:", err);
                }
                return self.origFetch(url, opts);
            };
        }

        /**
         * Normalize Spotify image URIs to HTTP URLs
         */
        getImageUrl(uri) {
            if (!uri) return '';
            if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
            if (uri.startsWith('spotify:image:')) {
                return 'https://i.scdn.co/image/' + uri.substring(14);
            }
            if (uri.startsWith('spotify:mosaic:')) {
                return 'https://mosaic.scdn.co/300/' + uri.substring(15);
            }
            if (/^[0-9a-fA-F]{40}$/.test(uri)) {
                return 'https://i.scdn.co/image/' + uri;
            }
            return uri;
        }

        /**
         * Common track normalization logic shared across player, queue, and search track formatting.
         */
        normalizeTrackInfo(track, source = 'player') {
            if (!track || track.uri === 'spotify:delimiter') return null;

            // Handle nested track formats
            const t = track.contextTrack || track;

            // Title resolving
            const title = t.name || t.title || t.metadata?.title || t.metadata?.name || 'Unknown Track';

            // Artist resolving
            let artist = 'Unknown Artist';
            if (Array.isArray(t.artists)) {
                artist = t.artists.map(a => a.profile?.name || a.name || a.title).filter(Boolean).join(', ');
            } else if (t.artists?.items) {
                artist = t.artists.items.map(a => a.profile?.name || a.name).filter(Boolean).join(', ');
            } else if (typeof t.artists === 'string') {
                artist = t.artists;
            } else if (t.artist) {
                artist = t.artist;
            } else if (t.metadata) {
                artist = t.metadata.artist_name || t.metadata.artist || 'Unknown Artist';
            }

            // Album resolving
            let album = '';
            if (t.album) {
                album = t.album.name || t.album.title || (typeof t.album === 'string' ? t.album : '');
            } else if (t.albumOfTrack) {
                album = t.albumOfTrack.name || '';
            } else if (t.metadata) {
                album = t.metadata.album_title || t.metadata.album || '';
            }

            // Album Art resolving
            let albumArt = '';
            if (t.metadata) {
                albumArt = t.metadata.image_url || t.metadata.image_xlarge_url || t.metadata.image_large_url || '';
            }
            if (!albumArt && t.album && Array.isArray(t.album.images) && t.album.images.length > 0) {
                albumArt = t.album.images[0].url;
            }
            if (!albumArt && t.albumOfTrack?.coverArt?.sources && t.albumOfTrack.coverArt.sources.length > 0) {
                albumArt = t.albumOfTrack.coverArt.sources[0].url;
            }
            if (!albumArt && t.images && Array.isArray(t.images) && t.images.length > 0) {
                albumArt = t.images[0].url;
            }

            const formatted = {
                uri: t.uri || '',
                title: title,
                artist: artist,
                album: album,
                albumArt: this.getImageUrl(albumArt)
            };

            if (source === 'player' || source === 'queue') {
                formatted.uid = t.uid || track.uid || '';
            } else if (source === 'search') {
                formatted.duration = t.duration_ms || t.duration?.totalMilliseconds || 0;
            }

            return formatted;
        }

        /**
         * Build a stable cache key for the current track.
         */
        getTrackKey(track) {
            if (!track) return '';
            return [
                track.uri || '',
                track.title || '',
                track.artist || '',
                track.album || '',
            ].join('|');
        }

        /**
         * Get the current playback state formatted
         */
        getPlaybackState() {
            try {
                const item = Spicetify.Player.data?.item;
                const progress = typeof Spicetify.Player.getProgress === 'function' ? Spicetify.Player.getProgress() : 0;
                const duration = typeof Spicetify.Player.getDuration === 'function' ? Spicetify.Player.getDuration() : 0;
                const isPlaying = typeof Spicetify.Player.isPlaying === 'function' ? Spicetify.Player.isPlaying() : false;
                const volume = typeof Spicetify.Player.getVolume === 'function' ? Spicetify.Player.getVolume() : 0.5;
                const shuffle = typeof Spicetify.Player.getShuffle === 'function' ? Spicetify.Player.getShuffle() : false;
                const repeat = typeof Spicetify.Player.getRepeat === 'function' ? Spicetify.Player.getRepeat() : 0;
                const heart = typeof Spicetify.Player.getHeart === 'function' ? Spicetify.Player.getHeart() : false;

                return {
                    track: {
                        ...this.normalizeTrackInfo(item, 'player'),
                        duration
                    },
                    progress,
                    duration,
                    isPlaying,
                    volume,
                    shuffle,
                    repeat,
                    heart
                };
            } catch (err) {
                console.error("Spotify Web Controller Extension: Error getting playback state:", err);
                return {
                    track: null,
                    progress: 0,
                    duration: 0,
                    isPlaying: false,
                    volume: 0.5,
                    shuffle: false,
                    repeat: 0,
                    heart: false
                };
            }
        }

        /**
         * Get the current queue state formatted
         */
        getQueueState() {
            try {
                if (!Spicetify.Queue) {
                    return { current: null, next: [], nextInQueue: [], nextUp: [], prev: [] };
                }
                const nextTracks = Spicetify.Queue.nextTracks || [];
                const prevTracks = Spicetify.Queue.prevTracks || [];
                
                const nextInQueueRaw = [];
                const nextUpRaw = [];
                
                nextTracks.forEach(t => {
                    if (!t) return;
                    const track = t.contextTrack || t;
                    if (track && track.uri === 'spotify:delimiter') {
                        return; // Skip delimiter
                    }
                    
                    if (t.provider === 'queue') {
                        nextInQueueRaw.push(t);
                    } else {
                        nextUpRaw.push(t);
                    }
                });
                
                const formatter = (t) => this.normalizeTrackInfo(t, 'queue');

                return {
                    current: this.normalizeTrackInfo(Spicetify.Queue.track, 'queue'),
                    next: nextTracks.map(formatter).filter(Boolean).slice(0, 40),
                    nextInQueue: nextInQueueRaw.map(formatter).filter(Boolean).slice(0, 40),
                    nextUp: nextUpRaw.map(formatter).filter(Boolean).slice(0, 40),
                    prev: prevTracks.slice(-10).map(formatter).filter(Boolean)
                };
            } catch (err) {
                console.error("Spotify Web Controller Extension: Error getting queue state:", err);
                return {
                    current: null,
                    next: [],
                    nextInQueue: [],
                    nextUp: [],
                    prev: []
                };
            }
        }

        /**
         * Send structured message to the WebSocket server
         */
        send(type, data) {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                try {
                    this.ws.send(JSON.stringify({ type, data }));
                } catch (err) {
                    console.error("Spotify Web Controller Extension: Failed to send WS message:", err);
                    try {
                        this.ws.send(JSON.stringify({ type, error: err.message }));
                    } catch (e) {}
                }
            }
        }

        /**
         * Broadcast player state and queue details to the server
         */
        broadcastFullState() {
            this.send('state', this.getPlaybackState());
            this.broadcastQueue();
        }

        /**
         * Broadcast queue details to the server
         */
        broadcastQueue() {
            this.send('queue', this.getQueueState());
        }

        /**
         * Parse LRCLIB timed lyric text into structured lines.
         */
        parseSyncedLyrics(text) {
            if (!text || typeof text !== 'string') return [];

            const lines = [];
            const rows = text.split(/\r?\n/);

            for (const row of rows) {
                const matches = [...row.matchAll(/\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
                if (matches.length === 0) continue;

                const lyricText = row.replace(/\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/g, '').trim();
                if (!lyricText) continue;

                for (const match of matches) {
                    const minutes = parseInt(match[1], 10);
                    const seconds = parseInt(match[2], 10);
                    const fraction = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
                    const time = (minutes * 60 * 1000) + (seconds * 1000) + fraction;
                    lines.push({ time, text: lyricText });
                }
            }

            return lines.sort((a, b) => a.time - b.time);
        }

        /**
         * Parse plain lyrics into one line per entry.
         */
        parsePlainLyrics(text) {
            if (!text || typeof text !== 'string') return [];
            return text
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean)
                .map(text => ({ time: -1, text }));
        }

        /**
         * Fetch lyrics from LRCLIB with cache and graceful fallback.
         */
        async fetchLyrics(track) {
            if (!track?.title || !track?.artist) return null;

            const cacheKey = this.getTrackKey(track);
            const cached = this.lyricsCache.get(cacheKey);
            if (cached) return cached;

            const query = new URLSearchParams({
                track_name: track.title,
                artist_name: track.artist,
            });
            if (track.album) query.set('album_name', track.album);
            if (track.duration) query.set('duration', String(Math.round(track.duration / 1000)));

            const resp = await this.origFetch(`https://lrclib.net/api/get?${query.toString()}`, {
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

            const result = {
                trackKey: cacheKey,
                title: track.title,
                artist: track.artist,
                album: track.album || '',
                source: 'LRCLIB',
                synced,
                lines,
                rawText: json?.plainLyrics || json?.lyrics || ''
            };

            this.lyricsCache.set(cacheKey, result);
            return result;
        }

        /**
         * Send lyrics state for the current track to the client.
         */
        async broadcastLyrics() {
            try {
                const track = this.normalizeTrackInfo(Spicetify.Player.data?.item, 'player');
                if (!track) {
                    this.send('lyrics', { loading: false, trackKey: '', lines: [], rawText: '' });
                    return;
                }

                const trackKey = this.getTrackKey(track);
                this.send('lyrics', {
                    loading: true,
                    trackKey,
                    title: track.title,
                    artist: track.artist
                });

                const lyrics = await this.fetchLyrics(track);
                if (!lyrics) {
                    this.send('lyrics', {
                        loading: false,
                        trackKey,
                        title: track.title,
                        artist: track.artist,
                        lines: [],
                        rawText: ''
                    });
                    return;
                }

                this.send('lyrics', {
                    loading: false,
                    ...lyrics
                });
            } catch (err) {
                console.error("Spotify Web Controller Extension: Error fetching lyrics:", err);
                const track = this.normalizeTrackInfo(Spicetify.Player.data?.item, 'player');
                this.send('lyrics', {
                    loading: false,
                    trackKey: this.getTrackKey(track),
                    title: track?.title || '',
                    artist: track?.artist || '',
                    lines: [],
                    rawText: ''
                });
            }
        }

        /**
         * Connect/reconnect to the WebSocket server
         */
        connect() {
            if (this.ws) {
                try { this.ws.close(); } catch (e) {}
            }

            console.log("Spotify Web Controller Extension: Connecting to server...");
            this.ws = new WebSocket("ws://localhost:8080/spotify");

            this.ws.onopen = () => {
                console.log("Spotify Web Controller Extension: Connected to server successfully!");
                this.broadcastFullState();
            };

            this.ws.onclose = () => {
                console.log("Spotify Web Controller Extension: Disconnected from server. Reconnecting in 3s...");
                this.scheduleReconnect();
            };

            this.ws.onerror = (err) => {
                console.error("Spotify Web Controller Extension: WebSocket error:", err);
            };

            this.ws.onmessage = async (event) => {
                try {
                    const message = JSON.parse(event.data);
                    await this.handleIncomingCommand(message);
                } catch (err) {
                    console.error("Spotify Web Controller Extension: Failed to parse incoming WS message:", err);
                }
            };
        }

        /**
         * Schedule a reconnection attempt
         */
        scheduleReconnect() {
            if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = setTimeout(() => this.connect(), 3000);
        }

        /**
         * Route incoming command messages to player APIs
         */
        async handleIncomingCommand({ type, data }) {
            console.log("Spotify Web Controller Extension: Received command", type, data);

            switch (type) {
                case 'play':
                    Spicetify.Player.play();
                    break;
                case 'play_track':
                    await Spicetify.Player.playUri(data);
                    break;
                case 'pause':
                    Spicetify.Player.pause();
                    break;
                case 'togglePlay':
                    Spicetify.Player.togglePlay();
                    break;
                case 'next':
                    Spicetify.Player.next();
                    break;
                case 'back':
                    Spicetify.Player.back();
                    break;
                case 'seek':
                    Spicetify.Player.seek(data);
                    break;
                case 'volume':
                    Spicetify.Player.setVolume(data);
                    this.lastVolume = data;
                    this.broadcastFullState();
                    break;
                case 'shuffle':
                    await Spicetify.Player.setShuffle(data);
                    setTimeout(() => this.broadcastFullState(), 300);
                    break;
                case 'repeat':
                    await Spicetify.Player.setRepeat(data);
                    setTimeout(() => this.broadcastFullState(), 300);
                    break;
                case 'toggleHeart':
                    Spicetify.Player.toggleHeart();
                    break;
                case 'add_queue':
                    if (typeof data === 'string') {
                        await Spicetify.addToQueue([{ uri: data }]);
                    } else if (Array.isArray(data)) {
                        await Spicetify.addToQueue(data.map(uri => ({ uri })));
                    }
                    setTimeout(() => this.broadcastQueue(), 300);
                    break;
                case 'remove_queue':
                    if (data && data.uri) {
                        await Spicetify.removeFromQueue([data]);
                    }
                    setTimeout(() => this.broadcastQueue(), 300);
                    break;
                case 'reorder_queue':
                    if (data && data.track) {
                        const trackToMove = { uri: data.track.uri || "", uid: data.track.uid };
                        let target = null;
                        if (data.insertBefore) {
                            target = { before: { uri: data.insertBefore.uri || "", uid: data.insertBefore.uid } };
                        }
                        try {
                            if (Spicetify.Platform?.PlayerAPI?.reorderQueue) {
                                await Spicetify.Platform.PlayerAPI.reorderQueue([trackToMove], target);
                            } else {
                                console.error("Spicetify Platform PlayerAPI reorderQueue is not available");
                            }
                        } catch (err) {
                            console.error("Error reordering queue:", err);
                        }
                    }
                    setTimeout(() => this.broadcastQueue(), 300);
                    break;
                case 'search':
                    this.searchSpotify(data);
                    break;
                case 'request_state':
                    this.broadcastFullState();
                    break;
                default:
                    console.warn("Spotify Web Controller Extension: Unknown command type:", type);
            }
        }

        /**
         * Send a query to the partner API using GraphQL operation hashes
         */
        async partnerAPISearch(operationName, hash, variables) {
            let token = this.capturedAccessToken;
            if (!token) {
                let sess = Spicetify.Platform.Session.accessToken;
                if (typeof sess === 'function') sess = await sess();
                token = typeof sess === 'string' ? sess : (sess?.accessToken || sess?.token || '');
            }

            const headers = {
                'accept': 'application/json',
                'accept-language': 'en',
                'app-platform': 'OSX_ARM64',
                'authorization': `Bearer ${token}`,
                'content-type': 'application/json;charset=UTF-8',
            };
            
            if (this.capturedClientToken) {
                headers['client-token'] = this.capturedClientToken;
            }

            const resp = await this.origFetch('https://api-partner.spotify.com/pathfinder/v2/query', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    variables,
                    operationName,
                    extensions: { persistedQuery: { version: 1, sha256Hash: hash } }
                })
            });

            if (!resp.ok) {
                const errText = await resp.text().catch(() => '');
                throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
            }
            return await resp.json();
        }

        /**
         * Parse GraphQL search response shapes into standard track list
         */
        parseTracksFromResponse(data) {
            if (!data) return [];

            // Primary path: searchSuggestions & searchModalResults topResults
            const topItems = data?.searchV2?.topResultsV2?.itemsV2 || [];
            if (topItems.length > 0) {
                const tracks = topItems
                    .filter(h => h?.item?.__typename === 'TrackResponseWrapper')
                    .map(h => this.normalizeTrackInfo(h.item.data, 'search'))
                    .filter(Boolean);
                if (tracks.length > 0) return tracks;
            }

            // Fallback paths (other query shapes)
            const rawItems =
                data?.searchV2?.tracksV2?.items ||
                data?.searchV2?.tracks?.items ||
                data?.searchSuggestions?.tracks?.items ||
                data?.search?.tracksV2?.items ||
                data?.search?.tracks?.items ||
                [];
            return rawItems
                .map(item => this.normalizeTrackInfo(item?.item?.data || item?.data || item, 'search'))
                .filter(Boolean);
        }

        /**
         * Execute track searches on Spotify
         */
        async searchSpotify(query) {
            if (!query || query.trim() === '') {
                this.send('search_results', { query: '', tracks: [] });
                return;
            }

            const trimmed = query.trim();

            // Return cached result if still fresh
            const cached = this.searchCache.get(trimmed);
            if (cached && (Date.now() - cached.ts < this.CACHE_TTL)) {
                this.send('search_results', { query: trimmed, tracks: cached.tracks });
                return;
            }

            const cacheAndSend = (tracks) => {
                this.searchCache.set(trimmed, { tracks, ts: Date.now() });
                if (this.searchCache.size > 50) {
                    this.searchCache.delete(this.searchCache.keys().next().value);
                }
                this.send('search_results', { query: trimmed, tracks });
            };

            // Try searchSuggestions first
            try {
                const json = await this.partnerAPISearch(
                    'searchSuggestions',
                    '556f5a15b2fdd3a7113ffd377ad9805e38a3a27b8bb1ca7d6d76bad54aa8ee12',
                    { query: trimmed, limit: 15, numberOfTopResults: 15, offset: 0, includeAuthors: false, includeAlbumPreReleases: true, includeEpisodeContentRatingsV2: true }
                );
                if (json?.data) {
                    const tracks = this.parseTracksFromResponse(json.data);
                    this.send('debug', { msg: 'searchSuggestions', tracks: tracks.length });
                    if (tracks.length > 0) {
                        cacheAndSend(tracks);
                        return;
                    }
                }
            } catch (e) {
                this.send('debug', { msg: 'searchSuggestions error', error: e.message });
            }

            // Try searchModalResults fallback
            try {
                const json = await this.partnerAPISearch(
                    'searchModalResults',
                    '5c10c8121738f9a0e7c685984d237cde29812448b2f87b8b94e85fb52f645fd0',
                    { searchTerm: trimmed, offset: 0, limit: 10, numberOfTopResults: 5, includeAudiobooks: false, includeAuthors: false }
                );
                if (json?.data) {
                    const tracks = this.parseTracksFromResponse(json.data);
                    this.send('debug', { msg: 'searchModalResults', tracks: tracks.length });
                    if (tracks.length > 0) {
                        cacheAndSend(tracks);
                        return;
                    }
                }
            } catch (e) {
                this.send('debug', { msg: 'searchModalResults error', error: e.message });
            }

            this.send('debug', { msg: 'all failed', hasToken: !!this.capturedAccessToken, hasClientToken: !!this.capturedClientToken });
            this.send('search_results', { query: trimmed, tracks: [] });
        }

        /**
         * Wire up Spicetify Player events
         */
        initEventListeners() {
            Spicetify.Player.addEventListener("songchange", () => {
            console.log("Spotify Web Controller Extension: songchange event");
            setTimeout(() => this.broadcastFullState(), 300);
            });

            Spicetify.Player.addEventListener("onplaypause", () => {
                console.log("Spotify Web Controller Extension: onplaypause event");
                this.broadcastFullState();
            });

            Spicetify.Player.addEventListener("onprogress", (event) => {
                if (event && typeof event.data === 'number') {
                    this.send('progress', { progress: event.data });
                } else {
                    this.send('progress', { progress: Spicetify.Player.getProgress() });
                }
            });
        }

        /**
         * Poll for volume changes and queue updates
         */
        initQueueAndVolumePolling() {
            setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    // 1. Check Volume changes
                    const currentVolume = Spicetify.Player.getVolume();
                    if (Math.abs(currentVolume - this.lastVolume) > 0.01) {
                        this.lastVolume = currentVolume;
                        this.send('volume_change', { volume: currentVolume });
                    }

                    // 2. Check Queue changes
                    if (Spicetify.Queue) {
                        const currentRevision = Spicetify.Queue.queueRevision || '';
                        const nextTracks = Spicetify.Queue.nextTracks || [];
                        const currentUris = nextTracks.slice(0, 30).map(t => t.uri).join(',');

                        let hasChanged = false;
                        if (currentRevision) {
                            if (currentRevision !== this.lastQueueRevision) {
                                this.lastQueueRevision = currentRevision;
                                hasChanged = true;
                            }
                        } else {
                            if (currentUris !== this.lastQueueUris) {
                                this.lastQueueUris = currentUris;
                                hasChanged = true;
                            }
                        }

                        if (hasChanged) {
                            console.log("Spotify Web Controller Extension: Queue change detected");
                            this.broadcastQueue();
                        }
                    }
                }
            }, 1500);
        }
    }

    // Instantiate and run the extension
    new SpotifyWebController();
})();
