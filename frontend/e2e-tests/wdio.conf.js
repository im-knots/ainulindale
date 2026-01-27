import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Keep track of the `tauri-driver` child process
let tauriDriver;
let exit = false;

// Get the binary name based on the OS
const getBinaryName = () => {
  const platform = os.platform();
  if (platform === 'darwin') {
    return 'hex-agent';
  } else if (platform === 'win32') {
    return 'hex-agent.exe';
  }
  return 'hex-agent';
};

export const config = {
  host: '127.0.0.1',
  port: 4444,
  specs: ['./specs/**/*.js'],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: path.resolve(__dirname, '..', 'src-tauri', 'target', 'debug', getBinaryName()),
      },
    },
  ],
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  // Build the Tauri app before running tests
  onPrepare: () => {
    console.log('Building Tauri app in debug mode...');
    const result = spawnSync(
      'npm',
      ['run', 'tauri', 'build', '--', '--debug', '--no-bundle'],
      {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
        shell: true,
      }
    );
    if (result.status !== 0) {
      throw new Error('Failed to build Tauri app');
    }
    console.log('Tauri app built successfully');
  },

  // Start tauri-driver before each test session
  beforeSession: () => {
    const tauriDriverPath = path.resolve(os.homedir(), '.cargo', 'bin', 'tauri-driver');
    console.log(`Starting tauri-driver from: ${tauriDriverPath}`);
    
    tauriDriver = spawn(tauriDriverPath, [], {
      stdio: [null, process.stdout, process.stderr],
    });

    tauriDriver.on('error', (error) => {
      console.error('tauri-driver error:', error);
      process.exit(1);
    });

    tauriDriver.on('exit', (code) => {
      if (!exit) {
        console.error('tauri-driver exited unexpectedly with code:', code);
        process.exit(1);
      }
    });
  },

  // Clean up tauri-driver after each test session
  afterSession: () => {
    closeTauriDriver();
  },
};

function closeTauriDriver() {
  exit = true;
  if (tauriDriver) {
    tauriDriver.kill();
    tauriDriver = null;
  }
}

function onShutdown(fn) {
  const cleanup = () => {
    try {
      fn();
    } finally {
      process.exit();
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);
  process.on('SIGBREAK', cleanup);
}

// Ensure tauri-driver is closed when our test process exits
onShutdown(() => {
  closeTauriDriver();
});

