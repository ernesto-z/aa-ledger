import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const store = require('../electron/data-store.cjs');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-store-'));
  return { dir, file: path.join(dir, 'aa-ledger-data.json') };
}

const read = (file) => fs.readFileSync(file, 'utf8');

test('文件不存在时读到空，第一次保存正常建文件', () => {
  const { file } = tempFile();
  const first = store.readDataFile(file);
  assert.equal(first.data, null);
  assert.equal(first.text, '');
  assert.equal(first.corrupt, null);

  const result = store.writeDataFile(file, { ledgers: [1] }, { expected: first.text });
  assert.equal(result.written, true);
  assert.equal(result.conflict, null);
  assert.deepEqual(JSON.parse(read(file)).ledgers, [1]);
});

test('每次改动前留一份备份，备份里是上一版内容', () => {
  const { file } = tempFile();
  let known = store.writeDataFile(file, { v: 1 }, { expected: '' }).text;
  assert.equal(store.listBackups(file).length, 0, '第一次保存没有旧内容可备份');

  known = store.writeDataFile(file, { v: 2 }, { expected: known }).text;
  const [backup] = store.listBackups(file);
  assert.deepEqual(JSON.parse(read(backup.file)).v, 1);
  assert.equal(store.listBackups(file).length, 1);

  store.writeDataFile(file, { v: 3 }, { expected: known });
  assert.equal(store.listBackups(file).length, 2, '第二份备份记的是 v2');
});

test('内容没变就不写盘、也不留备份', () => {
  const { file } = tempFile();
  const known = store.writeDataFile(file, { v: 1 }, { expected: '' }).text;
  fs.utimesSync(file, new Date(0), new Date(0));
  const result = store.writeDataFile(file, { v: 1 }, { expected: known });
  assert.equal(result.written, false);
  assert.equal(result.unchanged, true);
  assert.equal(fs.statSync(file).mtimeMs, 0, '文件修改时间没被动过');
  assert.equal(store.listBackups(file).length, 0);
});

test('备份只保留最近若干份，删的是最旧的', () => {
  const { file } = tempFile();
  let known = store.writeDataFile(file, { v: 0 }, { expected: '', keep: 3 }).text;
  for (let i = 1; i <= 6; i += 1) known = store.writeDataFile(file, { v: i }, { expected: known, keep: 3 }).text;
  const kept = store.listBackups(file);
  assert.equal(kept.length, 3, 'keep=3');
  const versions = kept.map((b) => JSON.parse(read(b.file)).v).sort((a, b) => a - b);
  assert.deepEqual(versions, [3, 4, 5], '留下的是最新的三份');
});

test('磁盘被别处改过时不覆盖，本次内容另存为 .conflict', () => {
  const { file } = tempFile();
  const known = store.writeDataFile(file, { v: 1 }, { expected: '' }).text;
  const outsider = JSON.stringify({ v: 999 }, null, 2);
  fs.writeFileSync(file, outsider, 'utf8');

  const result = store.writeDataFile(file, { v: 2 }, { expected: known });
  assert.equal(result.written, false);
  assert.ok(result.conflict, '报告冲突文件');
  assert.equal(read(file), outsider, '别人写的那份原样保留');
  assert.deepEqual(JSON.parse(read(result.conflict)).v, 2, '本次改动没丢');
});

test('自己连续保存不会误报冲突', () => {
  const { file } = tempFile();
  let known = store.writeDataFile(file, { v: 1 }, { expected: '' }).text;
  for (let i = 2; i <= 5; i += 1) {
    const result = store.writeDataFile(file, { v: i }, { expected: known });
    assert.equal(result.conflict, null, `第 ${i} 次保存不该冲突`);
    known = result.text;
  }
  assert.deepEqual(JSON.parse(read(file)).v, 5);
});

test('损坏文件另存为 .corrupt 并以空数据继续', () => {
  const { file } = tempFile();
  fs.writeFileSync(file, '{ 这不是 JSON', 'utf8');
  const result = store.readDataFile(file);
  assert.equal(result.data, null);
  assert.ok(result.corrupt);
  assert.equal(fs.existsSync(file), false);
  assert.equal(read(result.corrupt), '{ 这不是 JSON');
});
