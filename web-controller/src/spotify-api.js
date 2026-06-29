const logger = require('./logger');

class SpotifyOfficialApiManager {
    constructor() {
        this.clientId = process.env.SPOTIFY_CLIENT_ID || '';
        this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '';
        this.accessToken = null;
        this.tokenExpiresAt = 0;
        this.isConfigured = !!(this.clientId && this.clientId !== 'your_client_id_here' && 
                               this.clientSecret && this.clientSecret !== 'your_client_secret_here');
    }

    /**
     * Authenticate and request an access token via Client Credentials Flow
     */
    async getAccessToken() {
        if (!this.isConfigured) return null;

        const now = Date.now();
        // If token is still fresh, reuse it
        if (this.accessToken && now < this.tokenExpiresAt - 30000) {
            return this.accessToken;
        }

        try {
            const authString = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
            const response = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'client_credentials'
                })
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Spotify Auth Error: ${response.status} - ${text}`);
            }

            const data = await response.json();
            if (data && data.access_token) {
                this.accessToken = data.access_token;
                this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
                logger.info('Successfully fetched new Spotify official API access token');
                return this.accessToken;
            }
        } catch (e) {
            logger.error('Failed to authenticate with Spotify Official API:', e);
        }

        return null;
    }

    /**
     * Search tracks via Official Spotify Web API
     */
    async searchTracks(query) {
        if (!this.isConfigured) {
            return { error: 'Spotify Developer Credentials not configured. Please fill out the .env file.' };
        }

        const token = await this.getAccessToken();
        if (!token) {
            return { error: 'Failed to retrieve access token from Spotify Developer API.' };
        }

        try {
            const searchUrl = new URL('https://api.spotify.com/v1/search');
            searchUrl.search = new URLSearchParams({
                q: query,
                type: 'track',
                limit: 5
            }).toString();

            const response = await fetch(searchUrl.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Spotify Search HTTP Error: ${response.status} - ${text}`);
            }

            const data = await response.json();
            const tracks = (data?.tracks?.items || []).map(item => ({
                uri: item.uri || '',
                title: item.name || '',
                artist: (item.artists || []).map(a => a.name).join(', ') || 'Unknown Artist',
                album: item.album?.name || '',
                albumArt: (item.album?.images && item.album.images.length > 0) ? item.album.images[0].url : '',
                duration: item.duration_ms || 0
            }));

            return { tracks };
        } catch (e) {
            logger.error('Official Spotify Search Fallback Failed:', e);
            return { error: e.message || 'Unknown search error' };
        }
    }
}

module.exports = new SpotifyOfficialApiManager();
