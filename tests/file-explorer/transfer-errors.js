/* eslint global-require: off, no-await-in-loop: off */
const assert = require('assert');
const path = require('path');
const vm = require('vm');
const babel = require('@babel/core');

const source = babel.transformFileSync(
  path.resolve(__dirname, '../../ffi/kalam/src/Kalam.js'),
  {
    configFile: false,
    babelrc: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }
).code;
let simulate;
let released;
const directions = { download: 'download', upload: 'upload' };
const koffi = {
  proto: () => 'callback',
  pointer: (value) => value,
  register: (callback) => callback,
  unregister: () => {
    released += 1;
  },
  load: () => ({ func: () => ({ async: (...args) => simulate(...args) }) }),
};
const context = {
  exports: {},
  require: (name) => {
    if (name === 'koffi') return koffi;
    if (name.endsWith('/binaries')) return { kalamLibPath: '/unused' };
    if (name.endsWith('/log')) return { log: { error: () => {} } };
    if (name.endsWith('/funcs'))
      return { undefinedOrNull: (value) => value == null };
    if (name.endsWith('/checkIf')) return { checkIf: () => {} };
    if (name.endsWith('/enums')) return { FILE_TRANSFER_DIRECTION: directions };
    throw new Error(name);
  },
};

vm.runInNewContext(source, context);
const success = JSON.stringify({ error: '', errorType: '', data: true });
const failure = JSON.stringify({
  error: 'USB failure',
  errorType: 'ErrorFileTransfer',
  data: null,
});

async function run() {
  for (const scenario of [
    'success',
    'done-error',
    'progress-error',
    'ffi-error',
  ]) {
    let completed = 0;
    let errors = 0;

    released = 0;
    simulate = (_, preprocess, progress, done, finish) => {
      if (scenario === 'ffi-error') {
        finish(new Error('FFI failed'));

        return;
      }

      if (scenario === 'progress-error') progress(failure);
      done(scenario === 'done-error' ? failure : success);
      finish(null);
    };

    const result = await new context.exports.Kalam().transferFiles({
      direction: directions.download,
      storageId: 65537,
      sources: ['/a.jpg'],
      destination: '/unused',
      preprocessFiles: true,
      onPreprocess: () => {},
      onProgress: () => {},
      onError: () => {
        errors += 1;
      },
      onCompleted: () => {
        completed += 1;
      },
    });

    assert.strictEqual(completed, scenario === 'success' ? 1 : 0, scenario);
    assert.strictEqual(errors, scenario === 'success' ? 0 : 1, scenario);
    assert.strictEqual(Boolean(result.error), scenario !== 'success', scenario);
    assert.strictEqual(released, 3, scenario);
  }

  console.info(
    'PASS transfer success/error callbacks and FFI failure reporting'
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
