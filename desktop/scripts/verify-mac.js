const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Run on the final bundles: packaging can invalidate Electron's original signature.
for (const folder of ['mac-arm64', 'mac']) {
  const app = path.resolve(__dirname, '../dist', folder, 'LabServer.app');
  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'pipe' });
    console.log(`PASS ${folder}: final app signature is valid (notarization is a separate release requirement).`);
  } catch (error) {
    console.error(`FAIL ${folder}: final app signature is invalid.\n${error.stderr?.toString() || error.message}`);
    process.exitCode = 1;
  }
}
