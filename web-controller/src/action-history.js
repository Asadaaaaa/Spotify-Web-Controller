const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { colors } = require('./colors');

class ActionHistoryManager {
    constructor(cacheDir) {
        this.cacheDir = cacheDir;
        this.historyFile = path.join(this.cacheDir, 'action-history.json');
    }

    getHistory(targetDeviceId) {
        if (fs.existsSync(this.historyFile)) {
            try {
                const allHistory = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
                return allHistory
                    .filter(entry => entry.deviceId === targetDeviceId)
                    .slice(-50)
                    .reverse();
            } catch (e) {
                logger.error('Failed to parse action history:', e);
            }
        }
        return [];
    }

    logAction(deviceId, clientName, action, data) {
        try {
            let history = [];
            if (fs.existsSync(this.historyFile)) {
                try {
                    history = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
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
            fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2));
            logger.info(`History Log: Device: ${colors.bold}${clientName}${colors.reset} (${deviceId.substring(0, 8)}) -> Action: ${colors.cyan}${action}${colors.reset}`);
        } catch (err) {
            logger.error('Failed to log action:', err);
        }
    }
}

module.exports = ActionHistoryManager;
