const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class BlockedKeywordsManager {
    constructor(cacheDir) {
        this.cacheDir = cacheDir;
        this.blockedKeywordsPath = path.join(this.cacheDir, 'blocked-keywords.json');
        this.defaults = ["Baon Cikadap", "Lagu Jorok", "Oke Gas", "Jokowi"];
        this.blockedKeywords = this.loadBlockedKeywords();
    }

    loadBlockedKeywords() {
        try {
            if (!fs.existsSync(this.blockedKeywordsPath)) {
                const seed = { keywords: this.defaults };
                fs.mkdirSync(this.cacheDir, { recursive: true });
                fs.writeFileSync(this.blockedKeywordsPath, JSON.stringify(seed, null, 2));
                return seed;
            }
            const raw = fs.readFileSync(this.blockedKeywordsPath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                keywords: Array.isArray(parsed?.keywords) ? parsed.keywords : this.defaults
            };
        } catch (err) {
            logger.error('Failed to load blocked keywords:', err);
            return { keywords: this.defaults };
        }
    }

    saveBlockedKeywords() {
        try {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            fs.writeFileSync(this.blockedKeywordsPath, JSON.stringify(this.blockedKeywords, null, 2));
        } catch (err) {
            logger.error('Failed to save blocked keywords:', err);
        }
    }

    getKeywords() {
        return this.blockedKeywords.keywords;
    }

    setKeywords(keywords) {
        this.blockedKeywords.keywords = keywords;
        this.saveBlockedKeywords();
    }
}

module.exports = BlockedKeywordsManager;
