import fs from 'node:fs';
import path from 'node:path';
import { packager } from '@electron/packager';

const platform = process.argv[2] || 'win32';
const arch = process.argv[3] || 'x64';
const { version } = JSON.parse(fs.readFileSync('node_modules/electron/package.json', 'utf8'));
const zipName = `electron-v${version}-${platform}-${arch}.zip`;
const cacheRoot = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || '', 'electron', 'Cache');

// GitHub 直连经常超时，命中本地缓存就离线打包
const cachedZip = fs.existsSync(cacheRoot)
  ? fs.readdirSync(cacheRoot).map((d) => path.join(cacheRoot, d, zipName)).find((f) => fs.existsSync(f))
  : undefined;

const outputs = await packager({
  dir: '.',
  out: 'release',
  overwrite: true,
  asar: true,
  platform,
  arch,
  electronVersion: cachedZip ? version : undefined,
  electronZipDir: cachedZip ? path.dirname(cachedZip) : undefined,
  ignore: (file) => /^\/(test|release|scripts|\.git)/.test(file),
});

console.log(cachedZip ? `离线使用本地 Electron：${cachedZip}` : '本地没有 Electron 缓存，需要联网下载');
console.log([].concat(outputs).join('\n'));
