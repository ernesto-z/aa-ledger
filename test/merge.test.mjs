import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, mergeData, looksLikeData, migrate } from '../src/js/store.mjs';

const member = (id, name) => ({ id, name, createdAt: 1 });
const entry = (id, payerId, amountCents, date = '2026-09-01') => ({ id, payerId, amountCents, date, category: '餐饮', createdAt: 2 });

function base() {
  const data = blank();
  data.settings.meId = 'm_a';
  data.members = [member('m_a', '阿A'), member('m_b', '小B')];
  data.ledgers = [
    { id: 'l_1', name: '云南行', currency: '¥', memberIds: ['m_a', 'm_b'], createdAt: 1, entries: [entry('e_1', 'm_a', 100000)] },
  ];
  data.ui.activeLedgerId = 'l_1';
  return data;
}

test('同名成员并成一个人，付款人跟着重映射', () => {
  const incoming = base();
  incoming.settings.meId = 'm_other';
  incoming.members = [member('m_phone', '阿A'), member('m_b', '小B')];
  incoming.ledgers = [
    { id: 'l_1', name: '云南行', currency: '¥', memberIds: ['m_phone', 'm_b'], createdAt: 1, entries: [entry('e_2', 'm_phone', 3000, '2026-09-02')] },
  ];

  const { data, report } = mergeData(base(), incoming);

  assert.equal(data.members.length, 2);
  assert.deepEqual(report.skipped, []);
  assert.equal(report.entryAdded, 1);
  const added = data.ledgers[0].entries.find((e) => e.id === 'e_2');
  assert.equal(added.payerId, 'm_a');
  assert.deepEqual(data.ledgers[0].memberIds, ['m_a', 'm_b']);
  assert.equal(data.settings.meId, 'm_a', '不 import 对方的「我」');
});

test('本机没有的账本整本带过来', () => {
  const incoming = base();
  incoming.ledgers = [
    { id: 'l_new', name: '合租', currency: '¥', memberIds: ['m_b'], createdAt: 3, entries: [entry('e_9', 'm_b', 150000)] },
  ];

  const { data, report } = mergeData(base(), incoming);

  assert.equal(report.ledgerAdded, 1);
  assert.equal(data.ledgers.length, 2);
  assert.deepEqual(data.ledgers[1].memberIds, ['m_b']);
  assert.equal(data.ledgers[1].entries.length, 1);
});

test('撞 id 的一笔保留本机版本并报告出来', () => {
  const incoming = base();
  incoming.ledgers = [
    {
      id: 'l_1',
      name: '云南行',
      currency: '¥',
      memberIds: ['m_a', 'm_b'],
      createdAt: 1,
      entries: [{ ...entry('e_1', 'm_a', 1, '2020-01-01'), note: '被改过的对方版本' }, entry('e_3', 'm_b', 8800)],
    },
  ];

  const { data, report } = mergeData(base(), incoming);

  assert.equal(report.entrySkipped, 1);
  assert.equal(report.entryAdded, 1);
  assert.equal(report.skipped.length, 1);
  const kept = data.ledgers[0].entries.find((e) => e.id === 'e_1');
  assert.equal(kept.amountCents, 100000);
  assert.equal(kept.date, '2026-09-01');
});

test('同一份数据合并两次不产生任何新增', () => {
  const current = base();
  const once = mergeData(current, JSON.parse(JSON.stringify(current)));
  assert.deepEqual(once.report, {
    ledgerAdded: 0,
    ledgerMerged: 1,
    memberAdded: 0,
    entryAdded: 0,
    entrySkipped: 1,
    categoryAdded: 0,
    skipped: ['云南行 · 2026-09-01 （无备注）'],
  });
  const twice = mergeData(once.data, JSON.parse(JSON.stringify(current)));
  assert.deepEqual(twice.data, once.data);
});

test('分类求并集，坏数据不会污染分类', () => {
  const incoming = base();
  incoming.categories = ['餐饮', '医疗', ''];
  const { data, report } = mergeData(base(), migrate(incoming));
  assert.equal(report.categoryAdded, 1);
  assert.equal(data.categories.at(-1), '医疗');

  const emptyCats = mergeData(base(), { ...base(), categories: [] });
  assert.ok(emptyCats.data.categories.length);
});

test('looksLikeData 挡住不是本工具的文件', () => {
  assert.equal(looksLikeData({ version: 1, members: [], ledgers: [] }), true);
  assert.equal(looksLikeData({ members: [] }), false);
  assert.equal(looksLikeData([1, 2, 3]), false);
  assert.equal(looksLikeData(null), false);
});
