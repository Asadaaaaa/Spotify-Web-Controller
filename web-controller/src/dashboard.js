const os = require('os');
const { colors } = require('./colors');
const logger = require('./logger');

class Dashboard {
    constructor(server) {
        this.server = server;
    }

    getLocalIPs() {
        const interfaces = os.networkInterfaces();
        const ips = [];
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    ips.push(iface.address);
                }
            }
        }
        return ips;
    }

    render() {
        console.clear();
        const uptimeSec = Math.floor((Date.now() - this.server.startTime) / 1000);
        const hrs = String(Math.floor(uptimeSec / 3600)).padStart(2, '0');
        const mins = String(Math.floor((uptimeSec % 3600) / 60)).padStart(2, '0');
        const secs = String(uptimeSec % 60).padStart(2, '0');
        const uptimeStr = `${hrs}:${mins}:${secs}`;

        const isSpotifyOpen = this.server.spotifySocket && this.server.spotifySocket.readyState === 1; // 1 = WebSocket.OPEN
        const spotifyStatus = isSpotifyOpen
            ? `${colors.green}${colors.bold}ONLINE${colors.reset}`
            : `${colors.red}${colors.bold}OFFLINE${colors.reset}`;

        const deviceCount = this.server.clientSockets.size;

        const wrapAndPad = (content, width = 78) => {
            const ansiRegex = /\x1b\[[0-9;]*m/g;
            const chunks = [];
            let currentVisualLen = 0;
            let currentChunk = '';
            let activeStyles = [];

            let i = 0;
            while (i < content.length) {
                if (content.substring(i).startsWith('\x1b[')) {
                    const endIdx = content.indexOf('m', i);
                    if (endIdx !== -1) {
                        const style = content.substring(i, endIdx + 1);
                        currentChunk += style;
                        if (style === '\x1b[0m') {
                            activeStyles = [];
                        } else {
                            activeStyles.push(style);
                        }
                        i = endIdx + 1;
                        continue;
                    }
                }
                currentChunk += content[i];
                currentVisualLen++;
                if (currentVisualLen === width) {
                    if (activeStyles.length > 0) {
                        currentChunk += '\x1b[0m';
                    }
                    chunks.push(currentChunk);
                    currentChunk = activeStyles.join('');
                    currentVisualLen = 0;
                }
                i++;
            }
            if (currentVisualLen > 0 || chunks.length === 0) {
                if (activeStyles.length > 0 && !currentChunk.endsWith('\x1b[0m')) {
                    currentChunk += '\x1b[0m';
                }
                chunks.push(currentChunk);
            }
            return chunks.map(chunk => {
                const visual = chunk.replace(ansiRegex, '');
                const padding = Math.max(0, width - visual.length);
                return `│  ${chunk}${' '.repeat(padding)}  │`;
            });
        };

        console.log(`\n${colors.bold}${colors.magenta}┌──────────────────────────────────────────────────────────────────────────────────┐${colors.reset}`);
        console.log(`${colors.bold}${colors.magenta}│       🎵  Spotify Web Controller Server Dashboard                                │${colors.reset}`);
        console.log(`${colors.bold}${colors.magenta}├──────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
        
        const uptimePrefix = `Uptime: ${colors.cyan}${uptimeStr}${colors.reset}`;
        const uptimePrefixVisual = `Uptime: ${uptimeStr}`;
        const line1 = uptimePrefix + ' '.repeat(Math.max(1, 27 - uptimePrefixVisual.length)) + `Spotify Extension: ${spotifyStatus}`;
        wrapAndPad(line1).forEach(l => console.log(l));

        const devicesPrefix = `Total Devices Connected: ${colors.bold}${colors.yellow}${deviceCount}${colors.reset}`;
        const devicesPrefixVisual = `Total Devices Connected: ${deviceCount}`;
        const line2 = devicesPrefix + ' '.repeat(Math.max(1, 27 - devicesPrefixVisual.length)) + `GitHub: ${colors.gray}github.com/Asadaaaaa/Spotify-Web-Controller${colors.reset}`;
        wrapAndPad(line2).forEach(l => console.log(l));
        
        console.log(`${colors.bold}${colors.magenta}├──────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
        const trackDisplay = `Now Playing: ${this.server.currentTrackName}${this.server.currentTrackArtist ? ' - ' + this.server.currentTrackArtist : ''}`;
        wrapAndPad(`${colors.bold}${colors.green}${trackDisplay}${colors.reset}`).forEach(l => console.log(l));
        console.log(`${colors.bold}${colors.magenta}├──────────────────────────────────────────────────────────────────────────────────┤${colors.reset}`);
        wrapAndPad(`Recent Activity Log:`).forEach(l => console.log(l));
        
        // Print logs from the shared logger instance history
        logger.logHistory.forEach(logLine => {
            wrapAndPad(logLine).forEach(l => console.log(l));
        });
        
        console.log(`${colors.bold}${colors.magenta}└──────────────────────────────────────────────────────────────────────────────────┘${colors.reset}`);
        
        // Also print the server listening details at the bottom
        console.log(`\n${colors.bold}${colors.green}➜${colors.reset}  Local Access:   ${colors.cyan}http://localhost:${this.server.port}${colors.reset}`);
        const localIPs = this.getLocalIPs();
        if (localIPs.length > 0) {
            localIPs.forEach(ip => {
                console.log(`${colors.bold}${colors.green}➜${colors.reset}  Network Access: ${colors.cyan}http://${ip}:${this.server.port}${colors.reset}`);
            });
        }

        if (this.server.httpsServer) {
            if (localIPs.length > 0) {
                localIPs.forEach(ip => {
                    console.log(`${colors.bold}${colors.green}➜${colors.reset}  Network HTTPS:  ${colors.cyan}https://${ip}:${this.server.httpsPort}${colors.reset}`);
                });
            }
        }
        console.log();
    }
}

module.exports = Dashboard;
