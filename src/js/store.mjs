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
