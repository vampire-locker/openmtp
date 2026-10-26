const assert = require('assert');
const path = require('path');
const {
  parseArgs,
  childEnvironment,
  localConfig,
} = require('../scripts/package-local-mac');

assert.deepStrictEqual(parseArgs([]), { skipBuild: false, help: false });
assert.deepStrictEqual(parseArgs(['--skip-build']), {
  skipBuild: true,
  help: false,
});
assert.strictEqual(parseArgs(['--help']).help, true);
assert.throws(() => parseArgs(['--publish']), /未知参数/);

const env = { PATH: '/usr/bin', NODE_OPTIONS: '--max-old-space-size=4096' };
const modern = childEnvironment(env, '22.23.2');

assert(modern.PATH.includes(`${path.sep}node_modules${path.sep}.bin`));
assert.strictEqual(
  modern.NODE_OPTIONS,
  '--max-old-space-size=4096 --openssl-legacy-provider'
);
assert.strictEqual(
  childEnvironment(modern, '22.23.2').NODE_OPTIONS,
  modern.NODE_OPTIONS
);
assert.strictEqual(
  childEnvironment(env, '16.20.2').NODE_OPTIONS,
  env.NODE_OPTIONS
);
assert.strictEqual(env.PATH, '/usr/bin');
assert.strictEqual(modern.ELECTRON_NOTARIZE, 'NO');
assert.strictEqual(modern.CSC_IDENTITY_AUTO_DISCOVERY, 'false');

const base = {
  forceCodeSigning: true,
  publish: [{ provider: 'github' }],
  afterSign: 'notarize.js',
  mac: { identity: 'Developer ID', entitlements: 'entitlements.plist' },
  extraFiles: [{ from: 'build/mac/bin' }],
};
const local = localConfig(base, '/tmp/local-package');

assert.strictEqual(local.forceCodeSigning, false);
assert.strictEqual(local.publish, null);
assert.strictEqual(local.afterSign, undefined);
assert.strictEqual(local.mac.identity, null);
assert.strictEqual(local.mac.entitlements, base.mac.entitlements);
assert.strictEqual(local.extraFiles, base.extraFiles);
assert.strictEqual(local.directories.output, '/tmp/local-package');
assert.strictEqual(base.mac.identity, 'Developer ID');
assert.strictEqual(base.forceCodeSigning, true);
console.info(
  'PASS local packaging arguments, build environment and isolated configuration'
);
