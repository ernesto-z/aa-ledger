// 结算核心算法：纯函数，金额一律以「分」为整数单位，避免浮点误差。

export function splitCents(totalCents, parts, offset = 0) {
  if (parts <= 0) return [];
  const base = Math.floor(totalCents / parts);
  let remainder = totalCents - base * parts;
  const shares = new Array(parts).fill(base);
  for (let i = 0; remainder > 0; i += 1, remainder -= 1) {
    shares[(i + offset) % parts] += 1;
  }
  return shares;
}

export function totalCentsOf(entries) {
  return entries.reduce((sum, e) => sum + e.amountCents, 0);
}

function byPaidCountThenLastPaid(memberIds, paidCount, lastPaidIndex) {
  return [...memberIds].sort((a, b) => {
    const countDiff = paidCount.get(a) - paidCount.get(b);
    if (countDiff !== 0) return countDiff;
    return lastPaidIndex.get(a) - lastPaidIndex.get(b);
  });
}

export function settle(ledger, memberNames = {}) {
  const memberIds = ledger.memberIds;
  const entries = ledger.entries;
  const n = memberIds.length;
  const total = totalCentsOf(entries);

  const paidCount = new Map(memberIds.map((id) => [id, 0]));
  const lastPaidIndex = new Map(memberIds.map((id) => [id, -1]));
  const paidCents = new Map(memberIds.map((id) => [id, 0]));
  const shareCents = new Map(memberIds.map((id) => [id, 0]));
  const advances = new Map();

  const perEntry = entries.map((entry, index) => {
    const shares = splitCents(entry.amountCents, n, index);
    const detail = {};
    memberIds.forEach((id, i) => {
      shareCents.set(id, shareCents.get(id) + shares[i]);
      detail[id] = shares[i];
      if (id !== entry.payerId) {
        const key = `${entry.payerId}>${id}`;
        const prev = advances.get(key) || { cents: 0, count: 0 };
        advances.set(key, { cents: prev.cents + shares[i], count: prev.count + 1 });
      }
    });
    if (paidCount.has(entry.payerId)) {
      paidCount.set(entry.payerId, paidCount.get(entry.payerId) + 1);
      lastPaidIndex.set(entry.payerId, index);
      paidCents.set(entry.payerId, paidCents.get(entry.payerId) + entry.amountCents);
    }
    return { entryId: entry.id, amountCents: entry.amountCents, perCapitaCents: entry.amountCents / n, shares: detail };
  });

  const expectedFloor = Math.floor(entries.length / n);
  const unfilledSlots = entries.length % n;
  // 笔数除不尽人数时，多出来的那几笔本就该由某些人多掏一次，不算「多掏」。
  const fairCap = expectedFloor + (unfilledSlots > 0 ? 1 : 0);
  const sortedByTurn = byPaidCountThenLastPaid(memberIds, paidCount, lastPaidIndex);
  const turnDeficit = new Map();
  sortedByTurn.forEach((id) => {
    const paid = paidCount.get(id);
    if (paid < expectedFloor) turnDeficit.set(id, expectedFloor - paid);
    else if (paid === expectedFloor && unfilledSlots > 0) turnDeficit.set(id, 1);
    else turnDeficit.set(id, 0);
  });

  const perMember = memberIds.map((id) => {
    const balance = paidCents.get(id) - shareCents.get(id);
    const deficit = turnDeficit.get(id);
    const extraTurns = Math.max(0, paidCount.get(id) - fairCap);
    return {
      id,
      name: memberNames[id] || id,
      paidCents: paidCents.get(id),
      shareCents: shareCents.get(id),
      balanceCents: balance,
      paidCount: paidCount.get(id),
      extraTurns,
      owedTurns: deficit,
      status: statusOf(balance, deficit, extraTurns),
    };
  });

  return {
    memberCount: n,
    entryCount: entries.length,
    totalCents: total,
    perCapitaCents: n ? total / n : 0,
    perEntry,
    perMember,
    advances,
    pairs: advancePairs(advances, memberIds),
    transfers: planTransfers(perMember),
    nextPayerId: sortedByTurn[0] ?? null,
  };
}

function statusOf(balanceCents, owedTurns, extraTurns) {
  if (balanceCents < 0) return owedTurns > 0 ? '该补钱也欠掏钱' : '待补钱';
  if (balanceCents > 0) return extraTurns > 0 ? '多付多掏钱' : '待收钱';
  return owedTurns > 0 ? '钱平账·欠掏钱' : '已平账';
}

export function planTransfers(perMember) {
  const creditors = perMember
    .filter((m) => m.balanceCents > 0)
    .map((m) => ({ id: m.id, left: m.balanceCents }))
    .sort((a, b) => b.left - a.left);
  const debtors = perMember
    .filter((m) => m.balanceCents < 0)
    .map((m) => ({ id: m.id, left: -m.balanceCents }))
    .sort((a, b) => b.left - a.left);

  const plan = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const amount = Math.min(creditors[ci].left, debtors[di].left);
    if (amount > 0) plan.push({ fromId: debtors[di].id, toId: creditors[ci].id, cents: amount });
    creditors[ci].left -= amount;
    debtors[di].left -= amount;
    if (creditors[ci].left === 0) ci += 1;
    if (debtors[di].left === 0) di += 1;
  }
  return plan;
}

export function advancePairs(advances, memberIds) {
  const seen = new Set();
  const pairs = [];
  memberIds.forEach((a) => {
    memberIds.forEach((b) => {
      if (a === b) return;
      const key = [a, b].sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      const ab = advances.get(`${a}>${b}`) || { cents: 0, count: 0 };
      const ba = advances.get(`${b}>${a}`) || { cents: 0, count: 0 };
      const net = ab.cents - ba.cents;
      if (ab.count === 0 && ba.count === 0) return;
      const [debtorId, creditorId, creditorAdvanced, debtorAdvanced] =
        net > 0 ? [b, a, ab, ba] : [a, b, ba, ab];
      pairs.push({
        fromId: debtorId,
        toId: creditorId,
        netCents: Math.abs(net),
        creditorAdvanced,
        debtorAdvanced,
      });
    });
  });
  return pairs.sort((x, y) => y.netCents - x.netCents);
}

export function formatCents(cents, currency = '¥') {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100).toLocaleString('zh-CN');
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${currency}${yuan}.${frac}`;
}
