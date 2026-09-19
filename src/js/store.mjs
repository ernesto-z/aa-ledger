const LS_KEY = 'aa-ledger-data-v1';
const bridge = typeof window !== 'undefined' ? window.aaApi : undefined;

export const DEFAULT_CATEGORIES = ['餐饮', '交通', '住宿', '门票', '日用', '其他'];

export function blank() {
  return {
    version: 1,
    members: [],
    categories: [...DEFAULT_CATEGORIES],
    ledgers: [],
    ui: { activeLedgerId: null, tab: 'flow' },
  };
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function migrate(raw) {
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
  data.categories = Array.isArray(raw.categories) && raw.categories.length ? raw.categories : [...DEFAULT_CATEGORIES];
  data.ui = { ...base.ui, ...(raw.ui || {}) };
  return data;
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
