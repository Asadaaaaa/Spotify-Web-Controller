const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const logger = require('./logger');
const { colors, getTime } = require('./colors');
const BlockedKeywordsManager = require('./blocked-keywords');
const DeviceManager = require('./devices');
const LyricsManager = require('./lyrics');
const ActionHistoryManager = require('./action-history');
const GitHubStarsManager = require('./github');
const Dashboard = require('./dashboard');

class SpotifyWebControllerServer {
    constructor(port = 8080) {
        const baseDir = path.join(__dirname, '..');
        
        this.port = process.env.PORT || port;
        this.httpsPort = 8443;
        this.app = express();
        this.server = http.createServer(this.app);

        const keyPath = path.join(baseDir, 'key.pem');
        const certPath = path.join(baseDir, 'cert.pem');
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

        this.startTime = Date.now();
        this.currentTrackName = 'None';
        this.currentTrackArtist = '';

        this.spotifySocket = null;
        this.clientSockets = new Set();
        
        this.cacheDir = path.join(baseDir, 'storage');
        this.serverId = crypto.randomUUID();

        // Instantiate Sub-Managers
        this.blockedKeywordsManager = new BlockedKeywordsManager(this.cacheDir);
        this.deviceManager = new DeviceManager(this.cacheDir);
        
        // Pass a broadcast function to the LyricsManager
        this.lyricsManager = new LyricsManager(this.cacheDir, (msg) => this.broadcastToClients(msg));
        
        this.actionHistoryManager = new ActionHistoryManager(this.cacheDir);
        this.githubStarsManager = new GitHubStarsManager(this.cacheDir);
        this.dashboard = new Dashboard(this);

        // Setup logger to render the dashboard on log updates
        logger.setLogCallback(() => this.dashboard.render());

        // Watch the public directory for changes to trigger auto-reload on clients
        const publicDir = path.join(baseDir, 'public');
        if (fs.existsSync(publicDir)) {
            let watchTimeout = null;
            fs.watch(publicDir, { recursive: true }, (eventType, filename) => {
                if (filename) {
                    if (watchTimeout) clearTimeout(watchTimeout);
                    watchTimeout = setTimeout(() => {
                        logger.info(`File changed in public: ${colors.cyan}${filename}${colors.reset}. Reloading clients.`);
                        this.broadcastToClients({ type: 'reload_client' });
                    }, 250);
                }
            });
        }

        this.initMiddleware(publicDir);
        this.initWebSocket();
    }

    handlePlaybackState(data) {
        if (!data?.track) return;
        this.currentTrackName = data.track.title || 'None';
        this.currentTrackArtist = data.track.artist || '';

        const hadCache = this.lyricsManager.sendCachedLyrics(data.track);
        if (!hadCache) {
            this.broadcastToClients({
                type: 'lyrics',
                data: {
                    loading: true,
                    trackKey: this.lyricsManager.getTrackKey(data.track),
                    title: data.track.title || '',
                    artist: data.track.artist || ''
                }
            });
        }

        this.lyricsManager.refreshLyricsCache(data.track);
    }

    initMiddleware(publicDir) {
        this.app.use(express.static(publicDir));

        this.app.get('/api/github-stars', async (req, res) => {
            try {
                const stars = await this.githubStarsManager.getGitHubStars();
                res.json({ stars });
            } catch (err) {
                logger.error('Failed to get GitHub stars:', err);
                res.status(500).json({ error: 'Failed to fetch GitHub stars' });
            }
        });
    }

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

    handleSpotifyConnection(ws) {
        logger.success('Spotify Extension connected!');
        this.spotifySocket = ws;

        this.broadcastToClients({ type: 'spotify_online', data: true });
        this.broadcastClientList();

        ws.on('message', (message) => {
            try {
                const parsed = JSON.parse(message);
                if (parsed.type !== 'progress') {
                    const recipient = parsed.clientId || 'All Clients';
                    logger.spotify(`type: ${colors.bold}${parsed.type}${colors.reset}, recipient: ${colors.gray}${recipient}${colors.reset}`);
                }
                
                if (parsed.type === 'log_fetch_error') {
                    try {
                        const errorLogPath = path.join(this.cacheDir, 'spotify-fetch-errors.log');
                        const logEntry = JSON.stringify(parsed.data) + '\n';
                        fs.appendFileSync(errorLogPath, logEntry, 'utf8');
                        logger.error(`Spotify Extension Fetch Error logged to spotify-fetch-errors.log: Status ${parsed.data?.status}`);
                    } catch (e) {
                        logger.error('Failed to write fetch error log to disk:', e);
                    }
                    return;
                }

                if (parsed.type === 'lyrics') {
                    if (parsed.data && !parsed.data.loading) {
                        const changed = this.lyricsManager.cacheLyricsPayload(parsed.data);
                        if (changed) this.broadcastToClients(parsed);
                    }
                    return;
                }

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

                this.broadcastToClients(parsed);

                if (parsed.type === 'state') {
                    this.handlePlaybackState(parsed.data);
                }
            } catch (err) {
                logger.error('Error parsing message from Spotify:', err);
            }
        });

        ws.on('close', () => {
            logger.warn('Spotify Extension disconnected!');
            this.spotifySocket = null;
            this.broadcastToClients({ type: 'spotify_online', data: false });
        });

        ws.on('error', (err) => {
            logger.error('Spotify socket error:', err);
        });
    }

    handleClientConnection(ws, request) {
        logger.success('Web Client connected!');
        ws.clientId = crypto.randomUUID();
        
        let deviceId = 'unknown';
        try {
            const urlObj = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
            deviceId = urlObj.searchParams.get('deviceId') || crypto.randomUUID();
        } catch (e) {
            logger.error('Failed to parse connection URL query params:', e);
            deviceId = crypto.randomUUID();
        }
        ws.deviceId = deviceId;

        const hostHeader = request.headers.host || '';
        ws.isLocalhost = hostHeader.includes('localhost') || hostHeader.includes('127.0.0.1');

        if (ws.isLocalhost) {
            ws.clientName = 'HOST';
        } else {
            const existingName = this.deviceManager.getDeviceName(deviceId);
            if (!existingName || existingName.toUpperCase() === 'HOST') {
                const newName = this.deviceManager.generateName();
                this.deviceManager.setDeviceName(deviceId, newName);
                ws.clientName = newName;
            } else {
                ws.clientName = existingName;
            }
        }
        
        const ua = (request && request.headers && request.headers['user-agent']) || '';
        ws.clientDevice = this.deviceManager.parseUserAgent(ua);
        
        this.clientSockets.add(ws);

        ws.send(JSON.stringify({ type: 'spotify_online', data: this.spotifySocket !== null }));

        ws.send(JSON.stringify({
            type: 'client_registered',
            data: {
                clientId: ws.clientId,
                name: ws.clientName,
                device: ws.clientDevice,
                serverId: this.serverId
            }
        }));

        ws.send(JSON.stringify({
            type: 'blocked_keywords',
            data: { keywords: this.blockedKeywordsManager.getKeywords() }
        }));

        if (this.spotifySocket && this.spotifySocket.readyState === 1) { // WebSocket.OPEN
            this.spotifySocket.send(JSON.stringify({ type: 'request_state' }));
        }

        this.broadcastClientList();

        ws.on('message', (message) => {
            try {
                const parsed = JSON.parse(message);

                if (parsed.type === 'register_client') {
                    if (parsed.data) {
                        if (parsed.data.device) ws.clientDevice = parsed.data.device;
                        if (ws.isLocalhost) {
                            ws.clientName = 'HOST';
                        } else if (parsed.data.name) {
                            let proposedName = parsed.data.name;
                            if (proposedName.toUpperCase() === 'HOST') {
                                proposedName = this.deviceManager.getDeviceName(ws.deviceId) || this.deviceManager.generateName();
                            }
                            ws.clientName = proposedName;
                            if (ws.deviceId) {
                                this.deviceManager.setDeviceName(ws.deviceId, proposedName);
                            }
                        }
                        this.broadcastClientList();
                    }
                    return;
                }

                if (parsed.type === 'rename_device') {
                    if (parsed.data && parsed.data.deviceId && parsed.data.name) {
                        const targetDeviceId = parsed.data.deviceId;
                        const newName = parsed.data.name;

                        if (!ws.isLocalhost) return;
                        if (newName.toUpperCase() === 'HOST') return;

                        const targetSocket = Array.from(this.clientSockets).find(s => s.deviceId === targetDeviceId);
                        if (targetSocket && targetSocket.isLocalhost) return;

                        this.deviceManager.setDeviceName(targetDeviceId, newName);

                        for (let clientSocket of this.clientSockets) {
                            if (clientSocket.deviceId === targetDeviceId) {
                                clientSocket.clientName = newName;
                                clientSocket.send(JSON.stringify({
                                    type: 'client_registered',
                                    data: {
                                        clientId: clientSocket.clientId,
                                        name: newName,
                                        device: clientSocket.clientDevice,
                                        serverId: this.serverId
                                    }
                                }));
                            }
                        }
                        this.broadcastClientList();
                    }
                    return;
                }

                if (parsed.type === 'get_history') {
                    const targetId = parsed.data && parsed.data.targetDeviceId;
                    const history = this.actionHistoryManager.getHistory(targetId);
                    ws.send(JSON.stringify({
                        type: 'device_history',
                        data: {
                            deviceId: targetId,
                            history: history
                        }
                    }));
                    return;
                }

                if (parsed.type === 'get_blocked_keywords') {
                    ws.send(JSON.stringify({
                        type: 'blocked_keywords',
                        data: { keywords: this.blockedKeywordsManager.getKeywords() }
                    }));
                    return;
                }

                if (parsed.type === 'update_blocked_keywords') {
                    const newKeywords = Array.isArray(parsed?.data?.keywords)
                        ? parsed.data.keywords.filter(kw => typeof kw === 'string' && kw.trim().length >= 5)
                        : [];
                    
                    this.blockedKeywordsManager.setKeywords(newKeywords);
                    
                    this.broadcastToClients({
                        type: 'blocked_keywords',
                        data: { keywords: newKeywords }
                    });
                    logger.client(`Blocked keywords updated by ${colors.bold}${ws.clientName}${colors.reset}. Count: ${newKeywords.length}`);
                    return;
                }

                parsed.clientId = ws.clientId;
                logger.client(`type: ${colors.bold}${parsed.type}${colors.reset}, clientId: ${colors.gray}${parsed.clientId}${colors.reset}`);

                if (parsed.type === 'add_queue' && typeof parsed.data === 'string') {
                    if (!this.trackRequesters) this.trackRequesters = {};
                    this.trackRequesters[parsed.data] = ws.clientName;
                }

                if (['add_queue', 'reorder_queue', 'next', 'back'].includes(parsed.type)) {
                    this.actionHistoryManager.logAction(ws.deviceId || 'unknown', ws.clientName || 'unknown', parsed.type, parsed.data);
                }

                if (this.spotifySocket && this.spotifySocket.readyState === 1) { // WebSocket.OPEN
                    this.spotifySocket.send(JSON.stringify(parsed));
                } else {
                    logger.warn('Command ignored: Spotify is not connected.');
                    ws.send(JSON.stringify({ type: 'error', data: 'Spotify is not connected.', clientId: ws.clientId }));
                }
            } catch (err) {
                logger.error('Error parsing message from Client:', err);
            }
        });

        ws.on('close', () => {
            logger.warn('Web Client disconnected.');
            this.clientSockets.delete(ws);
            this.broadcastClientList();
        });

        ws.on('error', (err) => {
            logger.error('Client socket error:', err);
            this.clientSockets.delete(ws);
            this.broadcastClientList();
        });
    }

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
        if (this.spotifySocket && this.spotifySocket.readyState === 1) { // WebSocket.OPEN
            try {
                this.spotifySocket.send(JSON.stringify({
                    type: 'client_list',
                    data: list
                }));
            } catch (err) {
                logger.error('Failed to send client list to Spotify:', err);
            }
        }
    }

    sendToClient(clientId, messageObj) {
        const payload = JSON.stringify(messageObj);
        for (const client of this.clientSockets) {
            if (client.clientId === clientId && client.readyState === 1) {
                client.send(payload);
                break;
            }
        }
    }

    broadcastToClients(messageObj) {
        const payload = JSON.stringify(messageObj);
        for (const client of this.clientSockets) {
            if (client.readyState === 1) {
                client.send(payload);
            }
        }
    }

    start() {
        this.server.listen(this.port, () => {
            logger.system(`HTTP Server running on port ${colors.bold}${this.port}${colors.reset}`);
            const localIPs = this.dashboard.getLocalIPs();
            console.log(`${getTime()} │  ${colors.bold}${colors.green}➜${colors.reset}  Local:   ${colors.cyan}http://localhost:${this.port}${colors.reset}`);
            if (localIPs.length > 0) {
                localIPs.forEach(ip => {
                    console.log(`${getTime()} │  ${colors.bold}${colors.green}➜${colors.reset}  Network: ${colors.cyan}http://${ip}:${this.port}${colors.reset}`);
                });
            }
            console.log(`${getTime()} └──────────────────────────────────────────────────`);
        });

        if (this.httpsServer) {
            this.httpsServer.listen(this.httpsPort, () => {
                logger.system(`HTTPS Server running on port ${colors.bold}${this.httpsPort}${colors.reset}`);
                const localIPs = this.dashboard.getLocalIPs();
                console.log(`${getTime()} │  ${colors.bold}${colors.green}➜${colors.reset}  Local:   ${colors.cyan}https://localhost:${this.httpsPort}${colors.reset}`);
                if (localIPs.length > 0) {
                    localIPs.forEach(ip => {
                        console.log(`${getTime()} │  ${colors.bold}${colors.green}➜${colors.reset}  Network: ${colors.cyan}https://${ip}:${this.httpsPort}${colors.reset}`);
                    });
                }
                console.log(`${getTime()} └──────────────────────────────────────────────────`);
            });
        }

        setInterval(() => {
            this.dashboard.render();
        }, 1000);
    }
}

module.exports = SpotifyWebControllerServer;
