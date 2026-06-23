const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const serverPath = path.join(rootDir, 'web-controller', 'server.js');
const extensionSourcePath = path.join(rootDir, 'spicetify-extension', 'web-controller.js');
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
    const output = run('spicetify', ['config-dir'], { capture: true });
    return output.trim();
}

function installExtension() {
    if (!fs.existsSync(extensionSourcePath)) {
        throw new Error(`Extension source not found: ${extensionSourcePath}`);
    }

    const configDir = resolveSpicetifyConfigDir();
    const extensionsDir = path.join(configDir, 'Extensions');
    const extensionTargetPath = path.join(extensionsDir, extensionFileName);

    fs.mkdirSync(extensionsDir, { recursive: true });
    fs.copyFileSync(extensionSourcePath, extensionTargetPath);

    console.log(`Copied extension to: ${extensionTargetPath}`);
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

function main() {
    let serverProcess = null;
    let autoProcess = null;

    const shutdown = () => {
        stopProcess(autoProcess);
        stopProcess(serverProcess);
        process.exit();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        installExtension();
        run('spicetify', ['config', 'extensions', extensionFileName]);
        run('spicetify', ['apply']);

        console.log('Starting spicetify auto...');
        autoProcess = spawn('spicetify', ['auto'], {
            cwd: rootDir,
            stdio: 'inherit',
        });

        serverProcess = startWebControllerServer();
    } catch (err) {
        stopProcess(autoProcess);
        stopProcess(serverProcess);
        console.error(err.message || err);
        process.exit(1);
    }
}

main();
