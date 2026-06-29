require('dotenv').config();
const SpotifyWebControllerServer = require('./src/spotify-server');

const serverInstance = new SpotifyWebControllerServer(8080);
serverInstance.start();

