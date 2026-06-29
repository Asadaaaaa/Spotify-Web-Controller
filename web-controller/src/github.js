const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class GitHubStarsManager {
    constructor(cacheDir) {
        this.cacheDir = cacheDir;
        this.githubCachePath = path.join(this.cacheDir, 'github-stars-cache.json');
        this.githubStarsCache = null;
        this.githubStarsFallback = undefined;
    }

    async getGitHubStars() {
        const now = Date.now();
        const CACHE_TTL = 60 * 60 * 1000; // 1 hour cache
        
        if (this.githubStarsCache && (now - this.githubStarsCache.timestamp < CACHE_TTL)) {
            return this.githubStarsCache.stars;
        }

        if (!this.githubStarsCache && fs.existsSync(this.githubCachePath)) {
            try {
                const cachedData = JSON.parse(fs.readFileSync(this.githubCachePath, 'utf8'));
                if (cachedData && (now - cachedData.timestamp < CACHE_TTL)) {
                    this.githubStarsCache = cachedData;
                    return this.githubStarsCache.stars;
                }
                this.githubStarsFallback = cachedData.stars;
            } catch (e) {
                logger.error('Failed to parse GitHub stars cache from disk:', e);
            }
        }

        try {
            const response = await fetch('https://api.github.com/repos/Asadaaaaa/Spotify-Web-Controller', {
                headers: {
                    'User-Agent': 'Spotify-Web-Controller-Server'
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data && typeof data.stargazers_count === 'number') {
                    const stars = data.stargazers_count;
                    this.githubStarsCache = {
                        stars,
                        timestamp: now
                    };
                    
                    try {
                        fs.mkdirSync(this.cacheDir, { recursive: true });
                        fs.writeFileSync(this.githubCachePath, JSON.stringify(this.githubStarsCache, null, 2));
                    } catch (err) {
                        logger.error('Failed to save GitHub stars cache to disk:', err);
                    }
                    
                    return stars;
                }
            } else {
                logger.warn(`GitHub API returned status ${response.status} when fetching stars.`);
            }
        } catch (error) {
            logger.error('Failed to fetch from GitHub API:', error);
        }

        if (this.githubStarsCache) {
            logger.info('Using expired in-memory GitHub stars cache due to fetch failure');
            return this.githubStarsCache.stars;
        }
        if (this.githubStarsFallback !== undefined) {
            logger.info('Using expired disk-cached GitHub stars due to fetch failure');
            return this.githubStarsFallback;
        }

        return 0;
    }
}

module.exports = GitHubStarsManager;
