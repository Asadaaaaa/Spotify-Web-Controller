const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const serverPath = path.join(rootDir, 'web-controller', 'server.js');
const extensionSourcePath = path.join(rootDir, 'Extensions', 'web-controller.js');
const extensionFileName = 'web-controller.js';

// ANSI escape codes for modern terminal formatting
const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    red: '\x1b[31m',
    gray: '\x1b[90m'
};

function getTime() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${colors.gray}[${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]${colors.reset}`;
}

function logStep(step, message) {
    console.log(`\n${getTime()} ${colors.bold}${colors.cyan}❖ [STEP ${step}]${colors.reset} ${colors.bold}${message}${colors.reset}`);
}

function logInfo(message) {
    console.log(`${getTime()}  ${colors.gray}ℹ${colors.reset} ${message}`);
}

function logSuccess(message) {
    console.log(`${getTime()}  ${colors.green}✔ ${message}${colors.reset}`);
}

function logWarning(message) {
    console.log(`${getTime()}  ${colors.yellow}⚠ ${message}${colors.reset}`);
}

function logError(message) {
    console.log(`${getTime()}  ${colors.red}✖ ${message}${colors.reset}`);
}

function run(command, args, options = {}) {
    logInfo(`Running: ${colors.magenta}${command} ${args.join(' ')}${colors.reset}`);
    return execFileSync(command, args, {
        cwd: options.cwd || rootDir,
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
        logWarning('Could not resolve Spicetify config path automatically. Using fallback.');
    }
    // Fallback to default config path
    return path.join(process.env.HOME || '', '.config', 'spicetify');
}

function runNpmInstall(dir, label) {
    logInfo(`Running ${colors.bold}npm install${colors.reset} in ${colors.cyan}${label}${colors.reset}...`);
    try {
        run('npm', ['install'], { cwd: dir });
        logSuccess(`Successfully installed dependencies for ${label}`);
    } catch (err) {
        logError(`Failed to run npm install in ${label}: ${err.message}`);
        throw err;
    }
}

function installExtension() {
    if (!fs.existsSync(extensionSourcePath)) {
        throw new Error(`Extension source not found: ${extensionSourcePath}`);
    }

    const configDir = resolveSpicetifyConfigDir();
    const extensionsDir = path.join(configDir, 'Extensions');
    const extensionTargetPath = path.join(extensionsDir, extensionFileName);

    if (path.resolve(extensionSourcePath) !== path.resolve(extensionTargetPath)) {
        fs.mkdirSync(extensionsDir, { recursive: true });
        fs.copyFileSync(extensionSourcePath, extensionTargetPath);
        logSuccess(`Copied extension to Spicetify: ${colors.gray}${extensionTargetPath}${colors.reset}`);
    } else {
        logInfo(`Extension is already in the target directory.`);
    }
}

function startWebControllerServer() {
    if (!fs.existsSync(serverPath)) {
        throw new Error(`Server entry not found: ${serverPath}`);
    }

    logInfo(`Launching web controller daemon...`);
    const serverProcess = spawn(process.execPath, [serverPath], {
        cwd: path.dirname(serverPath),
        stdio: 'inherit',
    });

    serverProcess.on('exit', (code, signal) => {
        if (signal) {
            logWarning(`Web controller server stopped by signal: ${signal}`);
            return;
        }
        logInfo(`Web controller server exited with code: ${code}`);
    });

    return serverProcess;
}

function stopProcess(child) {
    if (child && !child.killed) {
        child.kill('SIGTERM');
    }
}

function closeSpotify() {
    logInfo('Closing Spotify desktop client if running...');
    try {
        if (process.platform === 'darwin') {
            execFileSync('osascript', ['-e', 'tell application "Spotify" to quit'], { stdio: 'ignore' });
        } else if (process.platform === 'win32') {
            execFileSync('taskkill', ['/f', '/im', 'Spotify.exe'], { stdio: 'ignore' });
        } else {
            execFileSync('pkill', ['-x', 'spotify'], { stdio: 'ignore' });
        }
        logSuccess('Spotify closed successfully');
    } catch (err) {
        // Spotify might not be running, ignore
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    console.log(`\n${getTime()} ${colors.bold}${colors.magenta}┌──────────────────────────────────────────────────┐${colors.reset}`);
    console.log(`${getTime()} ${colors.bold}${colors.magenta}│       Spotify Web Controller Bootstrapper        │${colors.reset}`);
    console.log(`${getTime()} ${colors.bold}${colors.magenta}└──────────────────────────────────────────────────┘${colors.reset}`);
    let serverProcess = null;

    const shutdown = () => {
        logWarning('Shutdown signal received. Stopping server...');
        stopProcess(serverProcess);
        process.exit();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        logStep(1, 'Installing Dependencies');
        runNpmInstall(rootDir, 'Parent Project');
        runNpmInstall(path.join(rootDir, 'web-controller'), 'Web Controller');

        logStep(2, 'Closing Spotify Client');
        closeSpotify();
        await sleep(1500); // Give Spotify time to close

        logStep(3, 'Installing Spicetify Extension');
        installExtension();
        run('spicetify', ['config', 'extensions', extensionFileName]);
        run('spicetify', ['apply']);

        logStep(4, 'Configuring Developer Tools');
        logInfo('Ensuring Spotify is closed before enabling devtools...');
        closeSpotify();
        await sleep(1500);
        logInfo('Enabling Spicetify devtools...');
        run('spicetify', ['enable-devtools']);

        logStep(5, 'Starting Web Controller Server');
        serverProcess = startWebControllerServer();
    } catch (err) {
        stopProcess(serverProcess);
        logError(err.message || err);
        process.exit(1);
    }
}

main();

