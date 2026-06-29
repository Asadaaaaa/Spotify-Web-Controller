const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class PlaybackCacheManager {
    constructor(cacheDir) {
        this.cacheDir = cacheDir;
        this.cachePath = path.join(this.cacheDir, 'playback-cache.json');
        this.cache = this.loadCache();
    }

    loadCache() {
        try {
            if (!fs.existsSync(this.cachePath)) {
                const seed = {
                    state: null,
                    queue: null,
                    trackRequesters: {}
                };
                fs.mkdirSync(this.cacheDir, { recursive: true });
                fs.writeFileSync(this.cachePath, JSON.stringify(seed, null, 2));
                return seed;
            }
            const raw = fs.readFileSync(this.cachePath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                state: parsed?.state || null,
                queue: parsed?.queue || null,
                trackRequesters: parsed?.trackRequesters || {}
            };
        } catch (err) {
            logger.error('Failed to load playback cache:', err);
            return { state: null, queue: null, trackRequesters: {} };
        }
    }

    saveCache() {
        try {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
        } catch (err) {
            logger.error('Failed to save playback cache:', err);
        }
    }

    getState() {
        return this.cache.state;
    }

    setState(state) {
        this.cache.state = state;
        this.saveCache();
    }

    getQueue() {
        return this.cache.queue;
    }

    setQueue(queue) {
        if (queue) {
            this.cache.queue = {
                current: queue.current || null,
                next: [],
                nextInQueue: queue.nextInQueue || [],
                nextUp: [],
                prev: []
            };
        } else {
            this.cache.queue = null;
        }
        this.saveCache();
    }

    getTrackRequesters() {
        return this.cache.trackRequesters;
    }

    setTrackRequesters(trackRequesters) {
        this.cache.trackRequesters = trackRequesters;
        this.saveCache();
    }
}

module.exports = PlaybackCacheManager;
