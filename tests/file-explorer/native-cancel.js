const assert = require('assert');
const path = require('path');
const koffi = require('koffi');

// No Initialize call: this checks the C ABI without accessing a phone or disk data.
const lib = koffi.load(
  process.argv[2] ||
    path.resolve(__dirname, '../../build/mac/bin/arm64/kalam-seg5.dylib')
);
const callback = koffi.proto('void safety_test_callback(char*)');
const cancel = lib.func('void CancelDownload(char*)');
const download = lib.func(
  'void DownloadFiles(char*, safety_test_callback*, safety_test_callback*, safety_test_callback*)'
);

function invoke(transferId) {
  return new Promise((resolve, reject) => {
    let response;
    const done = koffi.register((raw) => {
      response = JSON.parse(raw);
    }, koffi.pointer(callback));
    const input = JSON.stringify({
      transferId,
      storageId: 1,
      sources: ['/unused'],
      destination: '/unused',
      preprocessFiles: false,
    });

    download.async(input, null, null, done, (error) => {
      koffi.unregister(done);
      if (error) reject(error);
      else resolve(response);
    });
  });
}

async function run() {
  const id = `native-cancel-${Date.now()}`;

  cancel(id);
  const stopped = await invoke(id);

  assert.strictEqual(stopped.errorType, 'ErrorTransferCancelled');
  const next = await invoke(`${id}-next`);

  assert.strictEqual(next.errorType, 'ErrorMtpDetectFailed');
  console.info(
    'PASS native cancellation ABI and cancellation isolation (no phone I/O)'
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
