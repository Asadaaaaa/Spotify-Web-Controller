const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

class SpotifyWebControllerServer {
    constructor(port = 8080) {
        this.port = process.env.PORT || port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ noServer: true });

        this.spotifySocket = null;
        this.clientSockets = new Set();

        this.initMiddleware();
        this.initWebSocket();
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
        this.server.on('upgrade', (request, socket, head) => {
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
        });

        this.wss.on('connection', (ws, request, type) => {
            if (type === 'spotify') {
                this.handleSpotifyConnection(ws);
            } else if (type === 'client') {
                this.handleClientConnection(ws);
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
                // Relay everything from Spotify to all Web Clients
                this.broadcastToClients(parsed);
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

    /**
     * Manage Client browser socket connections and command relays
     */
    handleClientConnection(ws) {
        console.log('Web Client connected!');
        this.clientSockets.add(ws);

        // Send current online status of Spotify to the client
        ws.send(JSON.stringify({ type: 'spotify_online', data: this.spotifySocket !== null }));

        // Request full state from Spotify if it's connected, so new client gets immediate update
        if (this.spotifySocket && this.spotifySocket.readyState === WebSocket.OPEN) {
            this.spotifySocket.send(JSON.stringify({ type: 'request_state' }));
        }

        ws.on('message', (message) => {
            try {
                const parsed = JSON.parse(message);
                // Relay commands from Web Client to Spotify
                if (this.spotifySocket && this.spotifySocket.readyState === WebSocket.OPEN) {
                    this.spotifySocket.send(JSON.stringify(parsed));
                } else {
                    console.log('Command ignored: Spotify is not connected.');
                    ws.send(JSON.stringify({ type: 'error', data: 'Spotify is not connected.' }));
                }
            } catch (err) {
                console.error('Error parsing message from Client:', err);
            }
        });

        ws.on('close', () => {
            console.log('Web Client disconnected.');
            this.clientSockets.delete(ws);
        });

        ws.on('error', (err) => {
            console.error('Client socket error:', err);
            this.clientSockets.delete(ws);
        });
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
        this.server.listen(this.port, () => {
            console.log('\n======================================================');
            console.log(`Spotify Web Controller Server is running on port ${this.port}`);
            console.log('======================================================');
            console.log(`Access locally: http://localhost:${this.port}`);
            
            const localIPs = this.getLocalIPs();
            if (localIPs.length > 0) {
                console.log('\nTo control Spotify from other devices (like your phone):');
                localIPs.forEach(ip => {
                    console.log(`👉 http://${ip}:${this.port}`);
                });
            } else {
                console.log('\nNo external network interfaces found. Local-only access.');
            }
            console.log('======================================================\n');
        });
    }
}

const serverInstance = new SpotifyWebControllerServer(8080);
serverInstance.start();
