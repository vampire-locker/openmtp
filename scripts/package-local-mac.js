/* eslint global-require: off */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');

function parseArgs(args) {
  const unknown = args.filter(
    (arg) => !['--skip-build', '--help'].includes(arg)
  );

  if (unknown.length) throw new Error(`未知参数：${unknown.join(' ')}`);

  return {
    skipBuild: args.includes('--skip-build'),
    help: args.includes('--help'),
  };
}

function childEnvironment(env, nodeVersion = process.versions.node) {
  const result = {
    ...env,
    PATH: `${path.join(projectDir, 'node_modules', '.bin')}${path.delimiter}${
      env.PATH || ''
    }`,
    ELECTRON_NOTARIZE: 'NO',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  };

  // The repository's file-loader still uses MD4 under OpenSSL 3.
  if (
    Number(nodeVersion.split('.')[0]) >= 17 &&
    !/(^|\s)--openssl-legacy-provider(\s|$)/.test(result.NODE_OPTIONS || '')
  ) {
    result.NODE_OPTIONS = `${
      result.NODE_OPTIONS || ''
    } --openssl-legacy-provider`.trim();
  }

  return result;
}

function localConfig(base, outputDir) {
  return {
    ...base,
    forceCodeSigning: false,
    // Reuse the installed Electron runtime; do not download another copy.
    electronDist: path.join(projectDir, 'node_modules', 'electron', 'dist'),
    directories: { ...base.directories, output: outputDir },
    publish: null,
    afterSign: undefined,
    mac: { ...base.mac, identity: null },
  };
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} 执行失败（${result.signal || result.status}）`
    );
}

function requireFiles(files) {
  const missing = files.filter(
    (file) => !fs.existsSync(path.join(projectDir, file))
  );

  if (missing.length)
    throw new Error(
      `缺少文件：\n${missing.join(
        '\n'
      )}\n请先安装项目依赖，并准备对应的构建产物。`
    );
}

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

async function packageLocal(args = process.argv.slice(2)) {
  const options = parseArgs(args);

  if (options.help) {
    console.info(
      '用法：node scripts/package-local-mac.js [--skip-build]\n默认重新编译 JS；--skip-build 复用已验证的构建产物。\n仅在 macOS 上为当前 Node 架构打包，不安装、不发布、不公证。'
    );

    return;
  }

  if (process.platform !== 'darwin')
    throw new Error('本机打包脚本仅支持 macOS。');
  if (!['arm64', 'x64'].includes(process.arch))
    throw new Error(`不支持的架构：${process.arch}`);
  requireFiles([
    'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    'node_modules/yarn/bin/yarn.js',
    'node_modules/electron-builder/package.json',
    'build/entitlements.mac.plist',
  ]);
  const archDir = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const nativeFiles = ['kalam.dylib', 'libusb.dylib'];

  if (process.arch === 'arm64')
    nativeFiles.push('kalam-seg5.dylib', 'libusb-seg5.dylib');
  requireFiles(nativeFiles.map((name) => `build/mac/bin/${archDir}/${name}`));
  const env = childEnvironment(process.env);

  if (!options.skipBuild) {
    console.info('[1/5] 依次编译主进程和渲染进程（不重复运行测试/lint）');
    // build-main clears app/dist; renderer must run afterward, not concurrently.
    for (const script of ['build-main', 'build-renderer']) {
      run(
        process.execPath,
        ['node_modules/yarn/bin/yarn.js', 'run', script],
        env
      );
    }
  } else {
    console.info('[1/5] 复用现有编译产物');
  }

  requireFiles([
    'app/main.prod.js',
    'app/dist/renderer.prod.js',
    'app/dist/style.css',
    'app/app.html',
  ]);
  const { build, Platform, Arch } = require('electron-builder');
  const base = require('../electron-builder-config')();
  const pkg = require('../package.json');
  const outputDir = path.join(projectDir, 'dist', 'local-mac');
  const appDir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
  const appPath = path.join(outputDir, appDir, `${base.productName}.app`);
  const archive = path.join(
    outputDir,
    `${pkg.name}-${pkg.version}-${process.arch}-local.zip`
  );

  // Builder hooks execute in this process as well as in child processes.
  process.env.ELECTRON_NOTARIZE = 'NO';
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  console.info(`[2/5] 打包 macOS ${process.arch}`);
  await build({
    projectDir,
    config: localConfig(base, outputDir),
    targets: Platform.MAC.createTarget(['dir'], Arch[process.arch]),
    publish: 'never',
  });

  console.info('[3/5] 检查原生内核已正确复制');
  nativeFiles.forEach((name) => {
    const source = path.join(projectDir, 'build', 'mac', 'bin', archDir, name);
    const packaged = path.join(
      appPath,
      'Contents',
      'Resources',
      'bin',
      archDir,
      name
    );

    if (!fs.existsSync(packaged) || sha256(source) !== sha256(packaged)) {
      throw new Error(`打包内核缺失或与源码目录不一致：${name}`);
    }
  });

  console.info('[4/5] 本机临时签名并校验（不需要开发者证书）');
  run(
    '/usr/bin/codesign',
    [
      '--force',
      '--deep',
      '--sign',
      '-',
      '--entitlements',
      'build/entitlements.mac.plist',
      appPath,
    ],
    env
  );
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], env);

  console.info('[5/5] 生成保留应用结构的 ZIP');
  run(
    '/usr/bin/ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archive],
    env
  );
  console.info(
    `\n打包完成：\n${appPath}\n${archive}\n\n退出所有 OpenMTP 实例，备份旧版后，将上述 .app 拖入“应用程序”替换。\n这是本机临时签名版本，未公证、未发布，也没有自动安装。`
  );
}

module.exports = { parseArgs, childEnvironment, localConfig, packageLocal };

if (require.main === module) {
  packageLocal().catch((error) => {
    console.error(`本机打包失败：${error.message}`);
    process.exitCode = 1;
  });
}
