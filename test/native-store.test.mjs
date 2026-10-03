import test from 'node:test';
import assert from 'node:assert/strict';

/* 安卓壳里没有 window.aaApi，账本要落在原生文件上。
   store.mjs 在导入时就判定运行环境，所以先搭好假的 Capacitor 桥，再动态导入。 */

const calls = [];
let readFileResult = null;
let writeFails = false;

const files = new Map();

globalThis.window = {
  Capacitor: {
    isNativePlatform: () => true,
    nativePromise: (plugin, method, options) => {
      calls.push({ plugin, method, path: options.path, directory: options.directory });
      if (plugin === 'Filesystem' && method === 'readFile') {
        return readFileResult === null
          ? Promise.reject(new Error('File does not exist'))
          : Promise.resolve({ data: readFileResult });
      }
      if (plugin === 'Filesystem' && method === 'writeFile') {
        if (writeFails) return Promise.reject(new Error('ENOENT'));
        files.set(`${options.directory}/${options.path}`, options.data);
        return Promise.resolve({ uri: `file:///x/${options.path}` });
      }
      if (plugin === 'Filesystem' && method === 'getUri') {
        return Promise.resolve({ uri: `file:///x/${options.path}` });
      }
      if (plugin === 'Share' && method === 'share') return Promise.resolve({ sharedAction: 'dismissed' });
      return Promise.reject(new Error(`unexpected call ${plugin}.${method}`));
    },
  },
};

const local = new Map();
globalThis.localStorage = {
  getItem: (k) => (local.has(k) ? local.get(k) : null),
  setItem: (k, v) => local.set(k, v),
};

const seedLedger = {
  version: 1,
  settings: { meId: 'm1' },
  members: [{ id: 'm1', name: '小明', createdAt: 1 }],
  categories: ['餐饮'],
  ledgers: [{ id: 'l1', name: '测试账本', currency: '¥', memberIds: ['m1'], entries: [] }],
  ui: { activeLedgerId: 'l1', tab: 'flow' },
};

const { store, isNativeApp, writeNativeExport } = await import('../src/js/store.mjs');

test('安卓壳里认得出原生环境', () => {
  assert.equal(isNativeApp, true);
});

test('init 优先读应用目录里的那份 JSON', async () => {
  readFileResult = JSON.stringify(seedLedger);
  const data = await store.init();
  assert.equal(data.ledgers[0].name, '测试账本');
  assert.equal(calls[0].plugin, 'Filesystem');
  assert.equal(calls[0].method, 'readFile');
  assert.equal(calls[0].directory, 'EXTERNAL', '用应用目录，公共 Documents 在 Android 11 之后写不进去');
});

test('原生文件还没有时，把浏览器里那份搬过来', async () => {
  readFileResult = null;
  local.set('aa-ledger-data-v1', JSON.stringify(seedLedger));
  const data = await store.init();
  assert.equal(data.settings.meId, 'm1');
});

test('保存同时写原生文件与浏览器副本', async () => {
  readFileResult = JSON.stringify(seedLedger);
  await store.init();
  store.mutate((d) => d.ledgers[0].entries.push({ id: 'e1', title: '午饭', amountCents: 3000, payerId: 'm1' }));
  await new Promise((r) => setTimeout(r, 0));
  const written = JSON.parse(files.get('EXTERNAL/aa-ledger-data.json'));
  assert.equal(written.ledgers[0].entries.length, 1);
  assert.equal(JSON.parse(local.get('aa-ledger-data-v1')).ledgers[0].entries.length, 1);
});

test('写失败会在界面上报警，而不是静默丢掉', async () => {
  writeFails = true;
  const seen = [];
  store.onSaveProblem = (msg) => seen.push(msg);
  store.mutate((d) => d.ledgers[0].entries.push({ id: 'e2', title: '打车', amountCents: 1000, payerId: 'm1' }));
  await new Promise((r) => setTimeout(r, 0));
  assert.match(store.saveProblem, /存储权限/);
  assert.deepEqual(seen, [store.saveProblem]);

  writeFails = false;
  store.mutate((d) => d.ledgers[0].entries.push({ id: 'e3', title: '水', amountCents: 200, payerId: 'm1' }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(store.saveProblem, null, '恢复写入后警告自动消失');
});

test('导出走系统分享面板', async () => {
  const path = await writeNativeExport('aa-ledger-2026-10-03.json', '{"version":1}');
  assert.equal(path, 'exports/aa-ledger-2026-10-03.json');
  const tail = calls.slice(-3);
  assert.deepEqual(
    tail.map((c) => `${c.plugin}.${c.method}`),
    ['Filesystem.writeFile', 'Filesystem.getUri', 'Share.share']
  );
  assert.equal(JSON.parse(files.get('EXTERNAL/exports/aa-ledger-2026-10-03.json')).version, 1);
});
