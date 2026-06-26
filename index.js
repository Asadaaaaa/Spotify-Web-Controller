const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const serverPath = path.join(rootDir, 'web-controller', 'server.js');
const extensionSourcePath = path.join(rootDir, 'Extensions', 'web-controller.js');
const extensionFileName = 'web-controller.js';

function run(command, args, options = {}) {
    console.log(`> ${command} ${args.join(' ')}`);
    return execFileSync(command, args, {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
}

function resolveSpicetifyConfigDir() {
    try {
        const output = run('spicetify', ['-c'], { capture: true });
        if (output && output.trim()) {
            return path.dirname(output.trim());
        }
    } catch (err) {
        console.error('Error resolving spicetify config path:', err);
    }
    // Fallback to default macOS config path
    return path.join(process.env.HOME || '', '.config', 'spicetify');
}

function installExtension() {
    if (!fs.existsSync(extensionSourcePath)) {
        throw new Error(`Extension source not found: ${extensionSourcePath}`);
    }

    const configDir = resolveSpicetifyConfigDir();
    const extensionsDir = path.join(configDir, 'Extensions');
    const extensionTargetPath = path.join(extensionsDir, extensionFileName);

    // Only copy if the source and target are not the exact same file path
    if (path.resolve(extensionSourcePath) !== path.resolve(extensionTargetPath)) {
        fs.mkdirSync(extensionsDir, { recursive: true });
        fs.copyFileSync(extensionSourcePath, extensionTargetPath);
        console.log(`Copied extension to: ${extensionTargetPath}`);
    } else {
        console.log(`Extension is already in the target directory: ${extensionTargetPath}`);
    }
}

function startWebControllerServer() {
    if (!fs.existsSync(serverPath)) {
        throw new Error(`Server entry not found: ${serverPath}`);
    }

    console.log('Starting Spotify Web Controller server...');
    const serverProcess = spawn(process.execPath, [serverPath], {
        cwd: path.dirname(serverPath),
        stdio: 'inherit',
    });

    serverProcess.on('exit', (code, signal) => {
        if (signal) {
            console.log(`Web controller server stopped by signal: ${signal}`);
            return;
        }
        console.log(`Web controller server exited with code: ${code}`);
    });

    return serverProcess;
}

function stopProcess(child) {
    if (child && !child.killed) {
        child.kill('SIGTERM');
    }
}

function closeSpotify() {
    console.log('Closing Spotify if it is running...');
    try {
        if (process.platform === 'darwin') {
            execFileSync('osascript', ['-e', 'tell application "Spotify" to quit'], { stdio: 'ignore' });
        } else if (process.platform === 'win32') {
            execFileSync('taskkill', ['/f', '/im', 'Spotify.exe'], { stdio: 'ignore' });
        } else {
            execFileSync('pkill', ['-x', 'spotify'], { stdio: 'ignore' });
        }
    } catch (err) {
        // Spotify might not be running or command failed, ignore
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    let serverProcess = null;

    const shutdown = () => {
        stopProcess(serverProcess);
        process.exit();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        closeSpotify();
        await sleep(1500); // Give Spotify time to close

        installExtension();
        run('spicetify', ['config', 'extensions', extensionFileName]);
        run('spicetify', ['apply']);

        console.log('Waiting 2 seconds...');
        await sleep(2000);

        console.log('Enabling spicetify devtools...');
        run('spicetify', ['enable-devtools']);

        serverProcess = startWebControllerServer();
    } catch (err) {
        stopProcess(serverProcess);
        console.error(err.message || err);
        process.exit(1);
    }
}

main();
