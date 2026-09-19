import test from 'node:test';
import assert from 'node:assert/strict';
import { settle, splitCents, planTransfers } from '../src/js/calc.mjs';

const names = { a: '阿A', b: '小B', c: '大C', d: '老D' };

function ledger(memberIds, entries) {
  return { memberIds, entries: entries.map((e, i) => ({ id: `e${i}`, ...e })) };
}

const run = (memberIds, entries) => settle(ledger(memberIds, entries), names);

test('splitCents 保证份额之和等于总额', () => {
  assert.deepEqual(splitCents(1000, 3, 0), [334, 333, 333]);
  assert.deepEqual(splitCents(1000, 3, 1), [333, 334, 333]);
  assert.equal(splitCents(1001, 4, 2).reduce((x, y) => x + y, 0), 1001);
});

test('总花销 / 总人均 / 每笔人均', () => {
  const result = run(['a', 'b', 'c'], [
    { date: '2026-09-01', amountCents: 30000, payerId: 'a' },
    { date: '2026-09-02', amountCents: 10010, payerId: 'b' },
  ]);
  assert.equal(result.totalCents, 40010);
  assert.equal(result.perCapitaCents, 40010 / 3);
  assert.equal(result.perEntry[0].perCapitaCents, 10000);
  assert.equal(Math.round(result.perEntry[1].perCapitaCents), 3337);
});

test('每人份额之和恰好等于总额，不丢分', () => {
  const result = run(['a', 'b', 'c'], [
    { date: '2026-09-01', amountCents: 1000, payerId: 'a' },
    { date: '2026-09-02', amountCents: 1001, payerId: 'b' },
  ]);
  assert.equal(result.perMember.reduce((s, m) => s + m.shareCents, 0), 2001);
  assert.equal(
    result.perEntry.reduce((s, pe) => s + Object.values(pe.shares).reduce((x, y) => x + y, 0), 0),
    2001,
  );
});

test('转账建议金额闭合', () => {
  const result = run(['a', 'b', 'c'], [
    { date: '2026-09-01', amountCents: 30000, payerId: 'a' },
    { date: '2026-09-02', amountCents: 15000, payerId: 'b' },
  ]);
  const totalMoved = result.transfers.reduce((s, t) => s + t.cents, 0);
  const receivable = result.perMember.filter((m) => m.balanceCents > 0).reduce((s, m) => s + m.balanceCents, 0);
  assert.equal(totalMoved, receivable);
  assert.deepEqual(
    result.transfers.map((t) => [t.fromId, t.toId, t.cents]),
    [['c', 'a', 15000]],
  );
});

test('轮值：一次没掏钱的人被标记为欠掏钱', () => {
  const result = run(['a', 'b', 'c'], [
    { date: '2026-09-01', amountCents: 9000, payerId: 'a' },
    { date: '2026-09-02', amountCents: 9000, payerId: 'a' },
    { date: '2026-09-03', amountCents: 9000, payerId: 'a' },
  ]);
  const a = result.perMember.find((m) => m.id === 'a');
  const b = result.perMember.find((m) => m.id === 'b');
  assert.equal(a.extraTurns, 2);
  assert.equal(a.owedTurns, 0);
  assert.equal(b.owedTurns, 1);
  assert.equal(b.status, '该补钱也欠掏钱');
  assert.equal(result.nextPayerId, 'b');
});

test('轮值：钱未平且掏钱次数不足会同时提示', () => {
  const result = run(['a', 'b'], [
    { date: '2026-09-01', amountCents: 20000, payerId: 'a' },
    { date: '2026-09-02', amountCents: 20000, payerId: 'a' },
  ]);
  const b = result.perMember.find((m) => m.id === 'b');
  assert.equal(b.balanceCents, -20000);
  assert.equal(b.owedTurns, 1);
});

test('轮值：轮流付钱时无人欠掏钱', () => {
  const result = run(['a', 'b', 'c'], [
    { date: '2026-09-01', amountCents: 9000, payerId: 'a' },
    { date: '2026-09-02', amountCents: 9000, payerId: 'b' },
    { date: '2026-09-03', amountCents: 9000, payerId: 'c' },
  ]);
  result.perMember.forEach((m) => {
    assert.equal(m.owedTurns, 0);
    assert.equal(m.balanceCents, 0);
    assert.equal(m.status, '已平账');
  });
});

test('轮值：笔数少于人数时，掏过钱的人不算多掏', () => {
  const result = run(['a', 'b', 'c'], [
    { date: '2026-09-01', amountCents: 9000, payerId: 'a' },
    { date: '2026-09-02', amountCents: 4500, payerId: 'b' },
  ]);
  const a = result.perMember.find((m) => m.id === 'a');
  const b = result.perMember.find((m) => m.id === 'b');
  const c = result.perMember.find((m) => m.id === 'c');
  assert.equal(a.extraTurns, 0);
  assert.equal(b.extraTurns, 0);
  assert.equal(c.owedTurns, 1);
  assert.equal(result.nextPayerId, 'c');
});

test('垫付矩阵记录谁替谁掏过钱，并给出净额方向', () => {
  const result = run(['a', 'b'], [
    { date: '2026-09-01', amountCents: 20000, payerId: 'a' },
    { date: '2026-09-02', amountCents: 8000, payerId: 'b' },
  ]);
  assert.equal(result.pairs.length, 1);
  const pair = result.pairs[0];
  assert.equal(pair.netCents, 6000);
  assert.equal(pair.fromId, 'b', '欠钱的一方排在前面');
  assert.equal(pair.toId, 'a');
});

test('planTransfers 对零余额人员不产生转账', () => {
  assert.deepEqual(planTransfers([{ id: 'a', balanceCents: 0 }, { id: 'b', balanceCents: 0 }]), []);
});
