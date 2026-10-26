/* eslint no-await-in-loop: off */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const webpack = require('webpack');

const root = path.resolve(__dirname, '../..');
const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), 'openmtp-virtual-test-')
);
const browserPath =
  process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser;
let nextId = 0;
const pending = new Map();
let buffer = '';
let browserLog = '';

function command(method, params = {}, sessionId) {
  nextId += 1;
  const id = nextId;

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(
      `${JSON.stringify({ id, method, params, sessionId })}\0`
    );
  });
}

async function run() {
  const environment = path.join(__dirname, 'environment.js');

  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: 'development',
      devtool: false,
      plugins: [new webpack.ProvidePlugin({ process: 'process/browser' })],
      entry: path.join(__dirname, 'browser.jsx'),
      output: { path: temporary, filename: 'test.js' },
      resolve: {
        extensions: ['.js', '.jsx'],
        alias: {
          [path.join(
            root,
            'app/containers/HomePage/components/FileExplorerTableBodyEmptyRender'
          )]: path.join(__dirname, 'empty.jsx'),
          [path.join(root, 'app/constants/paths')]: environment,
          [path.join(root, 'app/utils/pkginfo')]: environment,
        },
      },
      module: {
        rules: [
          {
            test: /\.jsx?$/,
            exclude: /node_modules/,
            use: {
              loader: 'babel-loader',
              options: {
                babelrc: false,
                configFile: false,
                presets: [
                  [
                    '@babel/preset-env',
                    { targets: { chrome: '100' }, modules: false },
                  ],
                  '@babel/preset-react',
                ],
              },
            },
          },
          { test: /\.(svg|png|gif|jpe?g)$/, type: 'asset/resource' },
        ],
      },
    });

    compiler.run((error, stats) => {
      compiler.close(() => {
        if (error || stats.hasErrors())
          reject(
            error || new Error(stats.toString({ all: false, errors: true }))
          );
        else resolve();
      });
    });
  });
  fs.writeFileSync(
    path.join(temporary, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="root"></div><script src="test.js"></script></body></html>'
  );
  browser = spawn(
    browserPath,
    [
      '--headless',
      '--allow-file-access-from-files',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--remote-debugging-pipe',
      `--user-data-dir=${path.join(temporary, 'profile')}`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }
  );
  browser.stderr.on('data', (data) => {
    browserLog += data;
  });
  browser.on('error', (error) => {
    pending.forEach(({ reject }) => reject(error));
  });
  browser.on('exit', () => {
    pending.forEach(({ reject }) =>
      reject(new Error(`Chrome exited: ${browserLog}`))
    );
  });
  browser.stdio[4].on('data', (data) => {
    buffer += data;
    let boundary = buffer.indexOf('\0');

    while (boundary !== -1) {
      const message = JSON.parse(buffer.slice(0, boundary));

      buffer = buffer.slice(boundary + 1);
      if (message.method === 'Runtime.exceptionThrown') {
        browserLog += JSON.stringify(message.params);
      }

      if (pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);

        pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }

      boundary = buffer.indexOf('\0');
    }
  });
  const { targetId } = await command('Target.createTarget', {
    url: 'about:blank',
  });
  const { sessionId } = await command('Target.attachToTarget', {
    targetId,
    flatten: true,
  });

  await command('Page.enable', {}, sessionId);
  await command('Runtime.enable', {}, sessionId);
  await command(
    'Page.navigate',
    { url: `file://${path.join(temporary, 'index.html')}` },
    sessionId
  );
  // Wait for the fixture's script; this also survives navigation's context replacement.
  let ready = false;

  for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = await command(
      'Runtime.evaluate',
      {
        expression: 'typeof window.testPromise !== "undefined"',
        returnByValue: true,
      },
      sessionId
    );

    ready = result.result?.value === true;
  }

  if (!ready) throw new Error(`Browser fixture did not start: ${browserLog}`);
  const result = await command(
    'Runtime.evaluate',
    {
      expression: 'window.testPromise',
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId
  );

  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ||
        JSON.stringify(result.exceptionDetails)
    );
  console.info(JSON.stringify(result.result.value, null, 2));
}

const timeout = setTimeout(() => {
  console.error('Browser regression timed out');
  if (browser) browser.kill();
  process.exitCode = 1;
}, 60000);

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    clearTimeout(timeout);
    if (browser && browser.exitCode === null) {
      browser.kill();
      await new Promise((resolve) => browser.once('exit', resolve));
    }

    fs.rmSync(temporary, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
