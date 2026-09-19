import test from 'node:test';
import assert from 'node:assert/strict';
import { store, blank, filterMembers, searchMembers } from '../src/js/store.mjs';

const pool = [
  { id: 'm1', name: '小明', createdAt: 1 },
  { id: 'm2', name: '小王', createdAt: 2 },
  { id: 'm3', name: '张小明', createdAt: 3 },
  { id: 'm4', name: '小李', createdAt: 4 },
];

test('filterMembers 排除已选中的成员', () => {
  const hits = filterMembers(pool, '', ['m4']);
  assert.deepEqual(hits.map((m) => m.id), ['m3', 'm2', 'm1'], '无关键字时按最近添加排序');
});

test('filterMembers 按命中位置排序并限制条数', () => {
  assert.deepEqual(filterMembers(pool, '小明', []).map((m) => m.id), ['m1', 'm3'], '前缀命中排在中间命中之前');
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, name: `成员${i}`, createdAt: i }));
  assert.equal(filterMembers(many, '成员', []).length, 8);
});

test('filterMembers 对空池与无命中都返回空数组', () => {
  assert.deepEqual(filterMembers([], '小明', []), []);
  assert.deepEqual(filterMembers(pool, '不存在', []), []);
});

test('searchMembers 返回全部命中，用于成员池整页过滤', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, name: `成员${i}`, createdAt: i }));
  assert.equal(searchMembers(many, '成员').length, 30);
  assert.deepEqual(searchMembers(pool, '王').map((m) => m.id), ['m2']);
  assert.equal(searchMembers(pool, '').length, 4);
});

test('ensureMe 复用同名成员并记住 settings.meId', () => {
  store.data = blank();
  store.data.members = [...pool];
  const me = store.ensureMe('小明');
  assert.equal(me.id, 'm1', '同名成员不重复创建');
  assert.equal(store.data.settings.meId, 'm1');
  assert.equal(store.me().name, '小明');
  assert.equal(store.isMe('m1'), true);
  assert.equal(store.isMe('m2'), false);
});

test('ensureMe 在没有同名成员时新建一个', () => {
  store.data = blank();
  store.data.members = [];
  const me = store.ensureMe('我');
  assert.equal(store.data.members.length, 1);
  assert.equal(store.me().id, me.id);
});
