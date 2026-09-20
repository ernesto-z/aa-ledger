const LS_KEY = 'aa-ledger-data-v1';
const bridge = typeof window !== 'undefined' ? window.aaApi : undefined;

export const DEFAULT_CATEGORIES = ['餐饮', '交通', '住宿', '门票', '日用', '其他'];

export function blank() {
  return {
    version: 1,
    settings: { meId: null },
    members: [],
    categories: [...DEFAULT_CATEGORIES],
    ledgers: [],
    ui: { activeLedgerId: null, tab: 'flow' },
  };
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function migrate(raw) {
  const base = blank();
  if (!raw || typeof raw !== 'object') return base;
  const data = { ...base, ...raw };
  data.members = Array.isArray(raw.members) ? raw.members : [];
  data.ledgers = Array.isArray(raw.ledgers)
    ? raw.ledgers.map((l) => ({
        ...l,
        currency: l.currency || '¥',
        memberIds: Array.isArray(l.memberIds) ? l.memberIds : [],
        entries: Array.isArray(l.entries)
          ? l.entries.map((e) => ({
              ...e,
              amountCents: Number.isFinite(e.amountCents) ? Math.round(e.amountCents) : 0,
              createdAt: Number.isFinite(e.createdAt) ? e.createdAt : 0,
            }))
          : [],
      }))
    : [];
  const cats = Array.isArray(raw.categories)
    ? [...new Set(raw.categories.map((c) => String(c ?? '').trim()).filter(Boolean))]
    : [];
  data.categories = cats.length ? cats : [...DEFAULT_CATEGORIES];
  data.settings = { ...base.settings, ...(raw.settings || {}) };
  data.ui = { ...base.ui, ...(raw.ui || {}) };
  if (data.settings.meId && !data.members.some((m) => m.id === data.settings.meId)) data.settings.meId = null;
  return data;
}

export function searchMembers(members, query) {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return members;
  return members.filter((m) => m.name.toLowerCase().includes(text));
}

export function filterMembers(members, query, excludeIds = []) {
  const picked = new Set(excludeIds);
  const pool = members.filter((m) => !picked.has(m.id));
  const text = String(query || '').trim().toLowerCase();
  if (!text) {
    return [...pool].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 8);
  }
  return pool
    .map((m) => ({ m, at: m.name.toLowerCase().indexOf(text) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at || a.m.name.length - b.m.name.length)
    .slice(0, 8)
    .map((x) => x.m);
}

const normName = (name) => String(name || '').trim().toLowerCase();

export function looksLikeData(raw) {
  return Boolean(raw) && typeof raw === 'object' && Array.isArray(raw.ledgers) && Array.isArray(raw.members);
}

// 把另一台设备的账本并进来：成员按 id、再按名字去重；账本按 id 合并；一笔按 id 去重，
// 撞 id 的笔保留本机那份（编辑过的记录不会被覆盖掉），只在报告里列出来。
export function mergeData(current, incoming) {
  const merged = JSON.parse(JSON.stringify(current));
  const report = {
    ledgerAdded: 0,
    ledgerMerged: 0,
    memberAdded: 0,
    entryAdded: 0,
    entrySkipped: 0,
    categoryAdded: 0,
    skipped: [],
  };

  const memberById = new Map(merged.members.map((m) => [m.id, m]));
  const memberByName = new Map(merged.members.map((m) => [normName(m.name), m]));
  const memberMap = new Map();
  for (const m of incoming.members || []) {
    const target = memberById.get(m.id) || memberByName.get(normName(m.name));
    if (target) {
      memberMap.set(m.id, target.id);
      continue;
    }
    const created = { id: m.id, name: m.name, createdAt: Number.isFinite(m.createdAt) ? m.createdAt : Date.now() };
    merged.members.push(created);
    memberById.set(created.id, created);
    memberByName.set(normName(created.name), created);
    memberMap.set(m.id, created.id);
    report.memberAdded += 1;
  }

  const ledgerById = new Map(merged.ledgers.map((l) => [l.id, l]));
  for (const l of incoming.ledgers || []) {
    const mappedMembers = [...new Set((l.memberIds || []).map((id) => memberMap.get(id) ?? id))];
    let target = ledgerById.get(l.id);
    if (!target) {
      target = { ...l, memberIds: [], entries: [] };
      merged.ledgers.push(target);
      ledgerById.set(l.id, target);
      report.ledgerAdded += 1;
    } else {
      report.ledgerMerged += 1;
    }
    for (const id of mappedMembers) {
      if (!target.memberIds.includes(id)) target.memberIds.push(id);
    }
    const seen = new Set(target.entries.map((e) => e.id));
    for (const e of l.entries || []) {
      const payerId = memberMap.get(e.payerId) ?? e.payerId;
      if (seen.has(e.id)) {
        report.entrySkipped += 1;
        report.skipped.push(`${l.name || '未命名账本'} · ${e.date || ''} ${e.note || '（无备注）'}`);
        continue;
      }
      target.entries.push({ ...e, payerId });
      seen.add(e.id);
      report.entryAdded += 1;
    }
  }

  for (const c of incoming.categories || []) {
    if (!merged.categories.includes(c)) {
      merged.categories.push(c);
      report.categoryAdded += 1;
    }
  }

  if (!merged.categories.length) merged.categories = [...DEFAULT_CATEGORIES];
  return { data: merged, report };
}

export const store = {
  data: blank(),

  async init() {
    const saved = bridge ? await bridge.loadData() : JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    this.data = migrate(saved);
    if (this.data.ledgers.length && !this.data.ledgers.some((l) => l.id === this.data.ui.activeLedgerId)) {
      this.data.ui.activeLedgerId = this.data.ledgers[0].id;
    }
    return this.data;
  },

  persist() {
    const snapshot = JSON.parse(JSON.stringify(this.data));
    if (bridge) {
      bridge.saveData(snapshot);
    } else {
      localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
    }
  },

  mutate(fn) {
    fn(this.data);
    this.persist();
  },

  activeLedger() {
    return this.data.ledgers.find((l) => l.id === this.data.ui.activeLedgerId) || null;
  },

  memberName(id) {
    return this.data.members.find((m) => m.id === id)?.name || '未知成员';
  },

  memberNamesById() {
    return Object.fromEntries(this.data.members.map((m) => [m.id, m.name]));
  },

  findOrCreateMember(name) {
    const trimmed = name.trim();
    const existing = this.data.members.find((m) => m.name === trimmed);
    if (existing) return existing;
    const created = { id: uid('m'), name: trimmed, createdAt: Date.now() };
    this.data.members.push(created);
    return created;
  },

  me() {
    const { meId } = this.data.settings;
    return meId ? this.data.members.find((m) => m.id === meId) || null : null;
  },

  isMe(id) {
    return Boolean(this.data.settings.meId) && this.data.settings.meId === id;
  },

  ensureMe(name) {
    const member = this.findOrCreateMember(name || '我');
    this.data.settings.meId = member.id;
    return member;
  },
};

export function parseYuanToCents(text) {
  const value = Number(String(text).replace(/[,\s¥￥]/g, ''));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function today() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
