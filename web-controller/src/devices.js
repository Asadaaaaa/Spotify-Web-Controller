const fs = require('fs');
const path = require('path');
const Haikunator = require('haikunator');
const logger = require('./logger');

class DeviceManager {
    constructor(cacheDir) {
        this.cacheDir = cacheDir;
        this.deviceNamesPath = path.join(this.cacheDir, 'device-names.json');
        this.haikunator = new Haikunator({
            defaults: {
                tokenLength: 4
            }
        });
        this.deviceNames = this.loadDeviceNames();
    }

    loadDeviceNames() {
        try {
            if (fs.existsSync(this.deviceNamesPath)) {
                return JSON.parse(fs.readFileSync(this.deviceNamesPath, 'utf8'));
            }
        } catch (e) {
            logger.error('Failed to load device names:', e);
        }
        return {};
    }

    saveDeviceNames() {
        try {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            fs.writeFileSync(this.deviceNamesPath, JSON.stringify(this.deviceNames, null, 2));
        } catch (e) {
            logger.error('Failed to save device names:', e);
        }
    }

    generateName() {
        return this.haikunator.haikunate();
    }

    getDeviceName(deviceId) {
        return this.deviceNames[deviceId];
    }

    setDeviceName(deviceId, name) {
        this.deviceNames[deviceId] = name;
        this.saveDeviceNames();
    }

    parseUserAgent(ua = '') {
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

        return os ? `${device} (${os})` : device;
    }
}

module.exports = DeviceManager;
