import {
  store,
  uid,
  parseYuanToCents,
  today,
  DEFAULT_CATEGORIES,
  filterMembers,
  searchMembers,
  mergeData,
  looksLikeData,
  migrate,
  isNativeApp,
  nativeDataLabel,
  writeNativeExport,
} from './store.mjs';
import { settle, formatCents } from './calc.mjs';

const $ = (sel) => document.querySelector(sel);
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const currency = () => store.activeLedger()?.currency || '¥';
const money = (cents) => formatCents(Math.round(cents), currency());

const STATUS_CLASS = {
  已平账: 'ok',
  待补钱: 'warn',
  待收钱: 'info',
  多付多掏钱: 'info',
  钱平账·欠掏钱: 'warn',
  该补钱也欠掏钱: 'bad',
};

function statusBadge(status) {
  return `<span class="badge badge-${STATUS_CLASS[status] || 'info'}">${esc(status)}</span>`;
}

function meTag(id) {
  return store.isMe(id) ? '<em class="tag">我</em>' : '';
}

const ICON = {
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6" /></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M15.6 15.6L20 20" /></svg>',
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>',
};

const TAB_ICONS = {
  flow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M4.5 12h10M4.5 17h13" /></svg>',
  settle: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" /><path d="M9.5 9.5L12 12.5l2.5-3M12 12.5V16M10 14.5h4" /></svg>',
  members: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3.2" /><path d="M3.8 19.5a5.4 5.4 0 0 1 10.4 0M16.2 6.3a3 3 0 0 1 0 5.6M17.6 14.6a5.2 5.2 0 0 1 2.8 4.4" /></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h9M17.5 7h2M4.5 12h3M11.5 12h8M4.5 17h9M17.5 17h2" /><circle cx="15.5" cy="7" r="2" /><circle cx="9.5" cy="12" r="2" /><circle cx="15.5" cy="17" r="2" /></svg>',
};

const CURRENCIES = ['¥', '$', '€', 'HK$', 'JP¥', '₩'];

/* ---------- 成员搜索式输入框 ---------- */

const pickers = new Map();

function pickerHtml(id, placeholder) {
  return `
    <div class="picker" data-picker="${id}">
      <div class="picker-chips" data-picker-chips="${id}"></div>
      <div class="picker-box">
        <input type="text" class="picker-input" data-picker-input="${id}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" />
        <div class="picker-menu" data-picker-menu="${id}" hidden></div>
      </div>
    </div>`;
}

function mountPicker(id, selected, onChange) {
  pickers.set(id, { selected, query: '', highlight: -1, open: false, onChange });
  queueMicrotask(() => refreshPicker(id));
}

function pickerState(id) {
  if (!pickers.has(id)) pickers.set(id, { selected: [], query: '', highlight: -1, open: false });
  return pickers.get(id);
}

function refreshPicker(id) {
  const root = document.querySelector(`[data-picker="${id}"]`);
  const state = pickerState(id);
  if (!root) return;
  const chips = root.querySelector('[data-picker-chips]');
  chips.innerHTML = state.selected.length
    ? state.selected
        .map(
          (mid) =>
            `<span class="chip chip-picked">${esc(store.memberName(mid))}${meTag(mid)}<button type="button" class="chip-x" data-unpick="${id}" data-id="${mid}" aria-label="移除">×</button></span>`,
        )
        .join('')
    : '<span class="hint">还没选到人</span>';
  paintPickerMenu(id);
}

function paintPickerMenu(id) {
  const root = document.querySelector(`[data-picker="${id}"]`);
  const state = pickerState(id);
  if (!root) return;
  const menu = root.querySelector('[data-picker-menu]');
  const hits = filterMembers(store.data.members, state.query, state.selected);
  const typed = state.query.trim();
  const exact = store.data.members.some((m) => m.name === typed);
  const items = hits.map(
    (m, i) =>
      `<button type="button" class="picker-item ${i === state.highlight ? 'is-hl' : ''}" data-pick="${id}" data-id="${m.id}">${esc(m.name)}${meTag(m.id)}</button>`,
  );
  const create =
    typed && !exact
      ? `<button type="button" class="picker-item picker-new ${hits.length === 0 && state.highlight === 0 ? 'is-hl' : ''}" data-create="${id}" data-name="${esc(typed)}">+ 新建「${esc(typed)}」</button>`
      : '';
  const empty = !items.length && !create ? '<p class="picker-empty">没有匹配的成员</p>' : '';
  menu.innerHTML = items.join('') + create + empty;
  menu.hidden = !state.open;
}

function pickMember(id, memberId) {
  const state = pickerState(id);
  if (!state.selected.includes(memberId)) state.selected.push(memberId);
  state.query = '';
  state.highlight = -1;
  const input = document.querySelector(`[data-picker-input="${id}"]`);
  if (input) input.value = '';
  refreshPicker(id);
  if (input) input.focus();
  state.onChange?.();
}

function createAndPick(id, name) {
  const member = store.findOrCreateMember(name);
  store.persist();
  pickMember(id, member.id);
}

function unpickMember(id, memberId) {
  const state = pickerState(id);
  state.selected = state.selected.filter((m) => m !== memberId);
  refreshPicker(id);
  state.onChange?.();
}

function closePickerMenus(exceptId) {
  document.querySelectorAll('[data-picker-menu]').forEach((menu) => {
    const id = menu.dataset.pickerMenu;
    if (id === exceptId) return;
    menu.hidden = true;
    pickerState(id).open = false;
  });
}

document.addEventListener('focusin', (event) => {
  const input = event.target.closest('[data-picker-input]');
  if (!input) return;
  const id = input.dataset.pickerInput;
  const state = pickerState(id);
  state.query = input.value;
  state.highlight = -1;
  state.open = true;
  closePickerMenus(id);
  paintPickerMenu(id);
});

document.addEventListener('input', (event) => {
  const input = event.target.closest('[data-picker-input]');
  if (!input) return;
  const id = input.dataset.pickerInput;
  const state = pickerState(id);
  state.query = input.value;
  state.highlight = -1;
  state.open = true;
  paintPickerMenu(id);
});

document.addEventListener('keydown', (event) => {
  const input = event.target.closest('[data-picker-input]');
  if (!input) return;
  const id = input.dataset.pickerInput;
  const state = pickerState(id);
  const hits = filterMembers(store.data.members, state.query, state.selected);
  const optionCount = hits.length + (state.query.trim() && !store.data.members.some((m) => m.name === state.query.trim()) ? 1 : 0);

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!optionCount) return;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    state.highlight = (state.highlight + step + optionCount * 2) % optionCount;
    paintPickerMenu(id);
    return;
  }
  if (event.key === 'Escape') {
    state.open = false;
    closePickerMenus();
    return;
  }
  if (event.key === 'Backspace' && !input.value && state.selected.length) {
    event.preventDefault();
    unpickMember(id, state.selected[state.selected.length - 1]);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const typed = state.query.trim();
    if (state.highlight >= 0 && hits[state.highlight]) {
      pickMember(id, hits[state.highlight].id);
    } else if (typed) {
      const existing = store.data.members.find((m) => m.name === typed);
      if (existing) pickMember(id, existing.id);
      else createAndPick(id, typed);
    }
  }
});

/* ---------- 手机端视图：顶栏、选择账本面板、账本操作 ---------- */

const isMobile = () => window.matchMedia('(max-width: 720px)').matches;
const moneyIn = (ledger, cents) => formatCents(Math.round(cents), ledger.currency || '¥');
const findLedger = (id) => store.data.ledgers.find((l) => l.id === id) || null;

let switcherQuery = '';
let menuLedgerId = null;

function ledgerStats(ledger) {
  const result = settle(ledger, store.memberNamesById());
  return { result, me: result.perMember.find((m) => store.isMe(m.id)) || null };
}

// 面板里每本按最近一次记账时间排序，长期不用的自然沉到下面。
function lastEntryDate(ledger) {
  let mx = '';
  for (const e of ledger.entries) if (e.date > mx) mx = e.date;
  if (mx) return mx;
  return ledger.createdAt ? new Date(ledger.createdAt).toISOString().slice(0, 10) : '';
}

function balanceHtml(ledger, me, withTurn) {
  // 一笔都还没记的账本谈不上欠不欠，留白比「已平账」诚实
  if (!me || !ledger.entries.length) return '';
  let pill;
  if (me.balanceCents > 0) pill = `<span class="m-balance is-in">应收 ${moneyIn(ledger, me.balanceCents)}</span>`;
  else if (me.balanceCents < 0) pill = `<span class="m-balance is-out">应补 ${moneyIn(ledger, -me.balanceCents)}</span>`;
  else pill = '<span class="m-balance is-flat">已平账</span>';
  const turn = withTurn && me.owedTurns > 0 ? `<span class="lc-turn">欠掏 ${me.owedTurns} 次</span>` : '';
  return pill + turn;
}

function renderMobileTop() {
  const btn = $('#m-switcher');
  if (!btn) return;
  const ledger = store.activeLedger();
  if (!ledger) {
    btn.innerHTML = `<span class="m-name">还没有账本</span><span class="m-caret">${ICON.chevron}</span>`;
    return;
  }
  const { me } = ledgerStats(ledger);
  btn.innerHTML = `<span class="m-name">${esc(ledger.name)}</span>${balanceHtml(ledger, me, false)}<span class="m-caret">${ICON.chevron}</span>`;
}

function switcherCards() {
  const q = switcherQuery.trim().toLowerCase();
  const items = [...store.data.ledgers]
    .sort((a, b) => {
      const da = lastEntryDate(a);
      const db = lastEntryDate(b);
      if (da !== db) return da < db ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    })
    .filter((l) => !q || l.name.toLowerCase().includes(q));
  if (!items.length) {
    return `<p class="switcher-none">${
      q ? `没有名字带「${esc(switcherQuery.trim())}」的账本。` : '还没有账本，点下面「新建账本」开始。'
    }</p>`;
  }
  return items
    .map((l, i) => {
      const active = l.id === store.data.ui.activeLedgerId;
      const { result, me } = ledgerStats(l);
      const when = result.entryCount ? `最近记账 ${esc(lastEntryDate(l))}` : '还没记过';
      return `
        <article class="ledger-card ${active ? 'is-active' : ''}" style="--i:${i}">
          <button type="button" class="lc-hit" data-action="select-ledger" data-id="${l.id}">
            <span class="lc-name">${esc(l.name)}${active ? '<em class="tag">当前</em>' : ''}</span>
            <span class="lc-meta">${when}</span>
          </button>
          <span class="lc-right">${balanceHtml(l, me, true)}</span>
          <button type="button" class="lc-menu" data-action="ledger-menu" data-id="${l.id}" aria-label="「${esc(l.name)}」的操作">${ICON.dots}</button>
        </article>`;
    })
    .join('');
}

function switcherHtml() {
  return `
    <div class="switcher">
      <div class="switcher-head">
        <h2 class="switcher-title">选择账本</h2>
        <button type="button" class="switcher-x" data-action="close-switcher" aria-label="关闭">×</button>
        <label class="switcher-search">
          ${ICON.search}
          <input type="search" data-action="switcher-search" placeholder="按账本名搜索…" value="${esc(switcherQuery)}" aria-label="搜索账本" />
        </label>
      </div>
      <div class="switcher-body" id="switcher-body">${switcherCards()}</div>
      <div class="switcher-foot">
        <button type="button" class="btn btn-ghost btn-block" data-action="new-ledger">＋ 新建账本</button>
      </div>
    </div>`;
}

function openSwitcher() {
  switcherQuery = '';
  const dlg = $('#switcher');
  dlg.innerHTML = switcherHtml();
  dlg.showModal();
  // 焦点停在面板本身，别让第一个按钮带着焦点环出现在用户眼前
  dlg.focus();
}

function renderSwitcher() {
  const dlg = $('#switcher');
  if (dlg && dlg.open) dlg.innerHTML = switcherHtml();
}

function ledgerMenuHtml(l) {
  const cur = l.currency || '¥';
  return `
    <div class="sheet-card">
      <p class="sheet-title">${esc(l.name)}</p>
      <button type="button" class="sheet-btn" data-action="rename-ledger-open" data-id="${l.id}">改名</button>
      <div class="sheet-row">
        <span class="sheet-label">币种</span>
        <div class="chip-row">
          ${CURRENCIES
            .map(
              (c) =>
                `<button type="button" class="chip chip-member ${c === cur ? 'is-on' : ''}" data-action="set-ledger-currency" data-id="${l.id}" data-currency="${c}">${c}</button>`,
            )
            .join('')}
        </div>
      </div>
      <button type="button" class="sheet-btn sheet-danger" data-action="delete-ledger" data-id="${l.id}">删除这个账本</button>
      <button type="button" class="sheet-cancel" data-action="close-ledger-menu">取消</button>
    </div>`;
}

function openLedgerMenu(id) {
  const l = findLedger(id);
  if (!l) return;
  menuLedgerId = l.id;
  const dlg = $('#ledger-menu');
  dlg.innerHTML = ledgerMenuHtml(l);
  dlg.showModal();
  dlg.focus();
}

function renderLedgerMenu() {
  const dlg = $('#ledger-menu');
  if (!dlg.open) return;
  const l = findLedger(menuLedgerId);
  if (!l) {
    dlg.close();
    return;
  }
  dlg.innerHTML = ledgerMenuHtml(l);
}

function openRenameModal(id) {
  const l = findLedger(id) || store.activeLedger();
  if (!l) return;
  menuLedgerId = l.id;
  const modal = $('#modal');
  modal.innerHTML = `
    <form class="card modal-card" data-form="rename-ledger">
      <h2>账本改名</h2>
      <input type="hidden" name="ledgerId" value="${l.id}" />
      <label class="field"><span>账本名称</span><input type="text" name="name" value="${esc(l.name)}" required autofocus /></label>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">取消</button><button type="submit" class="btn btn-primary">保存</button></div>
    </form>`;
  modal.showModal();
}

function focusAmountInput() {
  document.querySelector('#view [data-form="entry"] [name="amount"]')?.focus();
}

/* ---------- 渲染 ---------- */

function render() {
  renderLedgerList();
  renderMobileTop();
  renderHeader();
  renderTabs();
  renderView();
  renderSwitcher();
  renderLedgerMenu();
  showSaveProblem(store.saveProblem);
}

function showSaveProblem(msg) {
  const el = $('#save-problem');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
}

function renderLedgerList() {
  const { ledgers, ui } = store.data;
  $('#ledger-list').innerHTML = ledgers.length
    ? ledgers
        .map(
          (l) => `
        <button class="ledger-item ${l.id === ui.activeLedgerId ? 'is-active' : ''}" data-action="select-ledger" data-id="${l.id}">
          <span class="ledger-item-name">${esc(l.name)}</span>
          <span class="ledger-item-meta">${l.memberIds.length} 人 · ${l.entries.length} 笔</span>
        </button>`,
        )
        .join('')
    : `<p class="hint pad">还没有账本，点下面的「新建账本」开始。</p>`;
}

function renderHeader() {
  const header = $('#ledger-header');
  const ledger = store.activeLedger();
  const me = store.me();
  if (!ledger) {
    header.innerHTML = `<h1 class="page-title">AA 账本</h1><p class="hint">${me ? `${esc(me.name)}，按用户组分账，记谁掏了钱，自动算人均与谁欠谁人情。` : '先设置你的名字。'}</p>`;
    return;
  }
  const result = settle(ledger, store.memberNamesById());
  header.innerHTML = `
    <div class="header-row">
      <div>
        <h1 class="page-title">${esc(ledger.name)}</h1>
        <p class="hint">${ledger.memberIds.length ? ledger.memberIds.map((id) => `${esc(store.memberName(id))}${meTag(id)}`).join('、') : '尚未选择成员'}</p>
      </div>
      <div class="header-stats">
        <div class="stat"><span>总花销</span><strong>${money(result.totalCents)}</strong></div>
        <div class="stat"><span>人均</span><strong>${money(result.perCapitaCents)}</strong></div>
        <div class="stat"><span>笔数</span><strong>${result.entryCount}</strong></div>
      </div>
    </div>`;
}

const TABS = [
  ['flow', '流水'],
  ['settle', '结算'],
  ['members', '成员'],
  ['settings', '设置'],
];

function renderTabs() {
  const bar = $('#tabs');
  bar.innerHTML = TABS.map(
    ([key, label]) =>
      `<button class="tab ${store.data.ui.tab === key ? 'is-active' : ''}" data-action="tab" data-tab="${key}"${
        store.data.ui.tab === key ? ' aria-current="page"' : ''
      }><span class="tab-icon">${TAB_ICONS[key]}</span>${label}</button>`,
  ).join('');
}

function renderView() {
  const view = $('#view');
  const ledger = store.activeLedger();
  const tab = store.data.ui.tab;
  const fab = $('#fab');
  // 浮动「记一笔」只在流水页、且当前账本能记账（有成员）时出现；桌面端由 CSS 隐藏。
  if (fab) fab.hidden = !(tab === 'flow' && ledger && ledger.memberIds.length > 0);
  if (tab === 'settings') {
    view.innerHTML = settingsView();
    return;
  }
  if (!ledger) {
    view.innerHTML = isMobile()
      ? '<div class="empty">还没有账本。点上方账本名打开「选择账本」，新建一本开始记。</div>'
      : '<div class="empty">先在左侧新建一个账本。</div>';
    return;
  }
  if (ledger.memberIds.length === 0 && tab !== 'members') {
    view.innerHTML = '<div class="empty">这个账本还没有成员。到「成员」里选人，才能算人均。</div>';
    return;
  }
  if (tab === 'flow') view.innerHTML = flowView(ledger);
  else if (tab === 'settle') view.innerHTML = settleView(ledger);
  else {
    view.innerHTML = membersView(ledger);
    mountPicker('ledger-members', [...ledger.memberIds], syncLedgerMembers);
  }
}

function entryRow(ledger, entry) {
  const per = entry.amountCents / Math.max(1, ledger.memberIds.length);
  return `
    <div class="row entry-row">
      <div class="cell cell-date">${esc(entry.date)}</div>
      <div class="cell cell-main">
        <span class="chip chip-cat">${esc(entry.category || '未分类')}</span>
        <strong>${money(entry.amountCents)}</strong>
        <span class="muted">${esc(entry.note || '')}</span>
      </div>
      <div class="cell cell-payer">
        <span class="payer">付：${esc(store.memberName(entry.payerId))}${meTag(entry.payerId)}</span>
        <span class="hint">人均 ${money(per)}</span>
      </div>
      <div class="cell cell-act">
        <button class="link" data-action="edit-entry" data-id="${entry.id}">改</button>
        <button class="link danger" data-action="delete-entry" data-id="${entry.id}">删</button>
      </div>
    </div>`;
}

function flowView(ledger) {
  const payerOptions = ledger.memberIds
    .map((id) => `<option value="${id}">${esc(store.memberName(id))}${store.isMe(id) ? '（我）' : ''}</option>`)
    .join('');
  const catOptions = store.data.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const entries = [...ledger.entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
  return `
    <form class="entry-form card" data-form="entry">
      <div class="form-drawer-bar"><span>记一笔</span><button type="button" class="form-x" data-action="close-entry-form" aria-label="关闭">×</button></div>
      <input type="hidden" name="entryId" value="" />
      <label class="field"><span>日期</span><input type="date" name="date" required value="${today()}" /></label>
      <label class="field field-amount"><span>金额</span><input type="text" name="amount" inputmode="decimal" placeholder="0.00" required /></label>
      <label class="field"><span>谁掏的钱</span><select name="payerId" required>${payerOptions}</select></label>
      <label class="field"><span>分类</span><select name="category">${catOptions}</select></label>
      <label class="field field-note"><span>备注</span><input type="text" name="note" placeholder="如：午饭 / 打车" /></label>
      <button class="btn btn-primary" type="submit">记一笔</button>
    </form>
    ${
      entries.length
        ? `<div class="card list">${entries.map((e) => entryRow(ledger, e)).join('')}</div>`
        : '<div class="empty">还没有记录，先记第一笔。</div>'
    }`;
}

function settleView(ledger) {
  const result = settle(ledger, store.memberNamesById());
  const byId = Object.fromEntries(result.perMember.map((m) => [m.id, m]));
  const next = result.nextPayerId ? byId[result.nextPayerId] : null;
  const shareOf = (entryId) => result.perEntry.find((pe) => pe.entryId === entryId);

  const memberRows = result.perMember
    .map(
      (m) => `
      <tr>
        <td data-label="成员">${esc(m.name)}${store.isMe(m.id) ? '<em class="tag">我</em>' : ''}</td>
        <td class="num" data-label="已付">${money(m.paidCents)}</td>
        <td class="num" data-label="应负担">${money(m.shareCents)}</td>
        <td class="num ${m.balanceCents > 0 ? 'pos' : m.balanceCents < 0 ? 'neg' : ''}" data-label="差额">
          ${m.balanceCents > 0 ? '应收 ' : m.balanceCents < 0 ? '应补 ' : '—'}${m.balanceCents === 0 ? '' : money(Math.abs(m.balanceCents))}
        </td>
        <td class="num" data-label="掏钱次数">${m.paidCount} 次${m.extraTurns > 0 ? `（多 ${m.extraTurns}）` : ''}</td>
        <td data-label="人情状态">${m.owedTurns > 0 ? `<span class="badge badge-warn">还欠 ${m.owedTurns} 次掏钱</span>` : ''} ${statusBadge(m.status)}</td>
      </tr>`,
    )
    .join('');

  const pairRows = result.pairs.length
    ? result.pairs
        .map(
          (p) => `
        <li>
          <strong>${esc(store.memberName(p.fromId))}</strong> 欠 <strong>${esc(store.memberName(p.toId))}</strong> ${money(p.netCents)}
          <span class="hint">${esc(store.memberName(p.toId))} 替其垫付 ${p.creditorAdvanced.count} 笔共 ${money(p.creditorAdvanced.cents)}；反向 ${p.debtorAdvanced.count} 笔共 ${money(p.debtorAdvanced.cents)}</span>
        </li>`,
        )
        .join('')
    : '<li class="hint">还没有互相垫付的记录。</li>';

  const transferRows = result.transfers.length
    ? result.transfers
        .map((t) => `<li><strong>${esc(store.memberName(t.fromId))}</strong> → <strong>${esc(store.memberName(t.toId))}</strong> ${money(t.cents)}</li>`)
        .join('')
    : '<li class="hint">大家金额已经平了，不需要转账。</li>';

  const perEntryRows = ledger.entries
    .map((e) => {
      const detail = shareOf(e.id);
      const parts = ledger.memberIds.map((id) => `${esc(store.memberName(id))} ${money(detail.shares[id])}`).join(' · ');
      return `<tr><td data-label="日期">${esc(e.date)}</td><td class="num" data-label="金额">${money(e.amountCents)}</td><td class="num" data-label="人均">${money(detail.perCapitaCents)}</td><td class="hint" data-label="付款人">${esc(store.memberName(e.payerId))} 掏的</td><td data-label="每人份额">${parts}</td></tr>`;
    })
    .join('');

  return `
    <div class="cards">
      <div class="card stat-card"><span>总花销</span><strong>${money(result.totalCents)}</strong></div>
      <div class="card stat-card"><span>总人均（${result.memberCount} 人）</span><strong>${money(result.perCapitaCents)}</strong></div>
    </div>
    ${
      next
        ? `<div class="notice">下一次建议由 <strong>${esc(next.name)}</strong> 掏钱${store.isMe(next.id) ? '（就是你）' : ''}${next.owedTurns > 0 ? `，还缺 ${next.owedTurns} 次` : '，掏钱次数最少'}。</div>`
        : ''
    }
    <div class="card">
      <h2>每人结算</h2>
      <div class="table-wrap">
      <table class="table">
        <thead><tr><th>成员</th><th class="num">已付</th><th class="num">应负担</th><th class="num">差额</th><th class="num">掏钱次数</th><th>人情状态</th></tr></thead>
        <tbody>${memberRows}</tbody>
      </table>
      </div>
    </div>
    <div class="two-col">
      <div class="card"><h2>结清建议</h2><ul class="clean">${transferRows}</ul></div>
      <div class="card"><h2>谁替谁垫付过</h2><ul class="clean">${pairRows}</ul></div>
    </div>
    ${
      ledger.entries.length
        ? `<div class="card"><h2>每笔人均</h2><div class="table-wrap"><table class="table">
            <thead><tr><th>日期</th><th class="num">金额</th><th class="num">人均</th><th>付款人</th><th>每人份额</th></tr></thead>
            <tbody>${perEntryRows}</tbody></table></div></div>`
        : ''
    }`;
}

let memberQuery = '';

function memberChip(m, ledger) {
  const inLedger = ledger.memberIds.includes(m.id);
  return `
    <button type="button" class="chip chip-member ${inLedger ? 'is-on' : ''}" data-action="toggle-member" data-id="${m.id}" title="点击${inLedger ? '移出' : '加入'}本账本">
      ${esc(m.name)}${meTag(m.id)}<em class="hint">${inLedger ? '本账本' : '未加入'}</em>
    </button>`;
}

function memberChipList(ledger) {
  const hits = searchMembers(store.data.members, memberQuery);
  if (!store.data.members.length) return '<p class="hint">还没有成员，用上面的输入框添加。</p>';
  if (!hits.length) return `<p class="hint">没有名字包含「${esc(memberQuery)}」的成员。</p>`;
  return hits.map((m) => memberChip(m, ledger)).join('');
}

function membersView(ledger) {
  return `
    <div class="card">
      <h2 data-member-count>本账本成员（${ledger.memberIds.length} 人）</h2>
      <p class="hint">人均按这里的人数算。输入名字可搜索已有成员，点一下或回车就加入；没有的会新建并存进成员池。</p>
      ${pickerHtml('ledger-members', '搜索或添加成员…')}
    </div>
    <div class="card">
      <h2>成员池（${store.data.members.length} 人）</h2>
      <input type="search" class="search" data-action="member-search" placeholder="按名字过滤…" value="${esc(memberQuery)}" />
      <div class="chip-row" id="member-list">${memberChipList(ledger)}</div>
    </div>
    <div class="card">
      <h2>分类标签</h2>
      <div class="chip-row">${store.data.categories
        .map((c) => `<span class="chip chip-cat">${esc(c)}<button class="link danger" data-action="remove-category" data-name="${esc(c)}">×</button></span>`)
        .join('')}</div>
      <form class="inline-form" data-form="add-category"><input type="text" name="name" placeholder="新分类" required /><button class="btn btn-primary">添加</button></form>
    </div>`;
}

function syncLedgerMembers() {
  const ledger = store.activeLedger();
  if (!ledger) return;
  const selected = pickerState('ledger-members').selected;
  store.mutate(() => {
    ledger.memberIds = selected;
  });
  const list = $('#member-list');
  if (list) list.innerHTML = memberChipList(ledger);
  const count = document.querySelector('[data-member-count]');
  if (count) count.textContent = `本账本成员（${ledger.memberIds.length} 人）`;
  renderHeader();
  renderLedgerList();
  renderMobileTop();
}

/* ---------- 导入 / 合并 ---------- */

let pendingMerge = null;
let mergeUndo = null;
let importError = '';

function canUndoMerge() {
  return Boolean(mergeUndo) && !pendingMerge && JSON.stringify(store.data) === mergeUndo.after;
}

function mergeReportHtml(r) {
  const skipped = r.skipped.slice(0, 6).map((s) => `<li>${esc(s)}</li>`).join('');
  const more = r.skipped.length > 6 ? `<li class="hint">……共 ${r.skipped.length} 笔</li>` : '';
  return `
      <div class="merge-report">
        <p>先试了一遍：会新增 <strong>${r.entryAdded}</strong> 笔、<strong>${r.ledgerAdded}</strong> 个账本、<strong>${r.memberAdded}</strong> 个成员、${r.categoryAdded} 个分类；${r.entrySkipped} 笔本机已经有了，保留本机那一版。</p>
        ${skipped ? `<p class="hint">保留本机的有：</p><ul class="clean">${skipped}${more}</ul>` : ''}
        <div class="btn-row">
          <button class="btn btn-primary" data-action="confirm-merge">确认合并</button>
          <button class="btn" data-action="cancel-merge">先不合并</button>
        </div>
      </div>`;
}

function mergeCard() {
  return `
    <div class="card">
      <h2>导入 / 合并另一台的账本</h2>
      <p class="hint">选另一台设备「导出一份 JSON」得到的文件。合并只做加法：不删本机任何记录，成员按名字认人，同名的账本算同一本。</p>
      ${importError ? `<p class="merge-error">${esc(importError)}</p>` : ''}
      <div class="btn-row">
        <label class="btn"><input type="file" class="file-input" accept=".json,application/json" data-action="import-file" />选择 JSON 文件…</label>
        <button class="btn" data-action="export-json">导出一份 JSON</button>
      </div>
      ${pendingMerge ? mergeReportHtml(pendingMerge.report) : ''}
      ${canUndoMerge() ? '<div class="btn-row"><button class="btn" data-action="undo-merge">撤销刚才的合并</button></div>' : ''}
    </div>`;
}

function stageMergeFromText(text) {
  importError = '';
  pendingMerge = null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    importError = '这个文件不是合法的 JSON，读不了。';
    return;
  }
  if (!looksLikeData(parsed)) {
    importError = '这个文件看着不是 AA 账本导出的（缺 members / ledgers）。';
    return;
  }
  const result = mergeData(store.data, migrate(parsed));
  const { entryAdded, ledgerAdded, memberAdded, categoryAdded, entrySkipped } = result.report;
  if (!entryAdded && !ledgerAdded && !memberAdded && !categoryAdded) {
    importError = `这份文件里的东西本机都有了（${entrySkipped} 笔全部同号，保留本机版本），没有要合并的。`;
    return;
  }
  pendingMerge = result;
}

function commitMerge() {
  if (!pendingMerge) return;
  mergeUndo = { before: JSON.parse(JSON.stringify(store.data)), after: '' };
  store.data = pendingMerge.data;
  store.persist();
  mergeUndo.after = JSON.stringify(store.data);
  pendingMerge = null;
  render();
}

function undoMerge() {
  if (!canUndoMerge()) return;
  store.data = mergeUndo.before;
  store.persist();
  mergeUndo = null;
  render();
}

async function exportJson() {
  const text = JSON.stringify(store.data, null, 2);
  const name = `aa-ledger-${today()}.json`;
  if (isNativeApp) {
    try {
      await writeNativeExport(name, text);
    } catch (err) {
      alert(`导出失败：${err?.message || err}`);
    }
    return;
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function settingsView() {
  const me = store.me();
  const info = dataInfo;
  const locked = Boolean(info?.lockedByEnv);
  const pathRow = info
    ? locked
      ? `<p class="hint">测试用数据文件：<code>${esc(info.file)}</code>（由环境变量 AA_LEDGER_DATA 指定，这次启动只读写它，不会碰到你平时的账本）</p>`
      : `<p class="hint">当前存在：<code>${esc(info.file)}</code>${info.isDefault ? '（应用默认位置）' : '（你自己指定的位置）'}</p>`
    : isNativeApp
      ? `<p class="hint">存在${esc(nativeDataLabel)}。这个位置不需要存储权限，卸载应用会一起删掉，所以每隔一阵请用下面的「导出一份 JSON」存一份到微信文件或其它地方。</p>`
      : '<p class="hint">在桌面应用里可以自己指定存放位置；现在是在浏览器里跑，数据存在浏览器本地。</p>';
  return `
    <div class="card">
      <h2>「我」是谁</h2>
      <p class="hint">新建账本时你会自动成为成员，算人均也会把你算进去。</p>
      ${me ? `<p>现在的名字：<strong>${esc(me.name)}</strong></p>` : ''}
      <form class="inline-form" data-form="set-me">
        <input type="text" name="name" placeholder="${me ? '改成别的名字' : '先填上你的名字'}" value="${esc(me?.name || '')}" required />
        <button class="btn btn-primary">${me ? '保存' : '确定'}</button>
      </form>
    </div>
    <div class="card">
      <h2>账本数据存放位置</h2>
      ${pathRow}
      <div class="btn-row">
        <button class="btn" data-action="choose-path" ${info && !locked ? '' : 'disabled'}>改到别的位置…</button>
        <button class="btn" data-action="restore-path" ${info && !locked && !info.isDefault ? '' : 'disabled'}>恢复默认位置</button>
        <button class="btn" data-action="reveal-path" ${info ? '' : 'disabled'}>在文件夹中显示</button>
      </div>
      <p class="hint">换位置时会问你要不要把现有账本一起带过去；旧文件不会被删除。</p>
      ${info?.backupDir ? `<p class="hint">每次保存前会自动留一份备份（最多 20 份，放在 <code>${esc(info.backupDir)}</code>）。想找回旧账：菜单「数据 → 从备份恢复…」。</p>` : ''}
    </div>
    ${mergeCard()}
    <div class="card card-danger">
      <h2>当前账本</h2>
      <form class="inline-form" data-form="rename-ledger"><input type="text" name="name" value="${esc(store.activeLedger()?.name || '')}" placeholder="账本名称" /><button class="btn">改名</button></form>
      <div class="inline-form">
        <select data-action="set-currency">${CURRENCIES
          .map((c) => `<option value="${c}" ${c === currency() ? 'selected' : ''}>${c}</option>`)
          .join('')}</select>
        <span class="hint">币种</span>
      </div>
      <div class="btn-row">
        <button class="btn btn-danger" data-action="delete-ledger" ${store.activeLedger() ? '' : 'disabled'}>删除这个账本</button>
      </div>
    </div>`;
}

function openLedgerModal() {
  const me = store.me();
  const modal = $('#modal');
  modal.innerHTML = `
    <form class="card modal-card" data-form="create-ledger">
      <h2>新建账本</h2>
      <label class="field"><span>账本名称</span><input type="text" name="name" placeholder="如：国庆云南行 / 室友房租" required autofocus /></label>
      <label class="field"><span>币种</span><select name="currency"><option value="¥">¥ 人民币</option><option value="$">$ 美元</option><option value="€">€ 欧元</option><option value="HK$">HK$ 港币</option></select></label>
      <p class="field-label">成员（你已经在里面了）</p>
      ${pickerHtml('new-ledger', '输入名字搜索成员，没有的会自动新建…')}
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">取消</button><button type="submit" class="btn btn-primary">建账本</button></div>
    </form>`;
  modal.showModal();
  mountPicker('new-ledger', me ? [me.id] : [], () => {});
}

function openEntryModal(entryId) {
  const ledger = store.activeLedger();
  const entry = ledger.entries.find((e) => e.id === entryId);
  if (!entry) return;
  const modal = $('#modal');
  modal.innerHTML = `
    <form class="card modal-card" data-form="entry">
      <h2>修改这笔</h2>
      <input type="hidden" name="entryId" value="${entry.id}" />
      <label class="field"><span>日期</span><input type="date" name="date" value="${esc(entry.date)}" required /></label>
      <label class="field"><span>金额</span><input type="text" name="amount" value="${(entry.amountCents / 100).toFixed(2)}" required /></label>
      <label class="field"><span>谁掏的钱</span><select name="payerId">${ledger.memberIds
        .map((id) => `<option value="${id}" ${id === entry.payerId ? 'selected' : ''}>${esc(store.memberName(id))}</option>`)
        .join('')}</select></label>
      <label class="field"><span>分类</span><select name="category">${store.data.categories
        .map((c) => `<option value="${esc(c)}" ${c === entry.category ? 'selected' : ''}>${esc(c)}</option>`)
        .join('')}</select></label>
      <label class="field"><span>备注</span><input type="text" name="note" value="${esc(entry.note || '')}" /></label>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">取消</button><button type="submit" class="btn btn-primary">保存</button></div>
    </form>`;
  modal.showModal();
}

function openMeModal() {
  const modal = $('#modal');
  modal.innerHTML = `
    <form class="card modal-card" data-form="set-me">
      <h2>先给自己起个名字</h2>
      <p class="hint">新建账本时你会自动成为成员，算人均时会把你算进去。</p>
      <label class="field"><span>你的名字</span><input type="text" name="name" placeholder="如：小明" required autofocus /></label>
      <div class="modal-actions"><button type="submit" class="btn btn-primary">好了</button></div>
    </form>`;
  modal.showModal();
}

/* ---------- 提交 ---------- */

// 校验失败时不用 alert：那会把焦点丢回按钮，而且调用方还会把整张表单清空。
function showFieldError(form, name, msg) {
  let p = form.querySelector('.field-error');
  if (!p) {
    p = document.createElement('p');
    p.className = 'field-error';
    form.append(p);
  }
  p.textContent = msg;
  const input = form.querySelector(`[name="${name}"]`);
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    if (input.tagName === 'INPUT' && input.type === 'text') input.select();
  }
  return false;
}

function onSubmit(form, formData) {
  const kind = form.dataset.form;
  const ledger = store.activeLedger();
  const value = (name) => (formData.get(name) || '').toString().trim();

  if (kind === 'set-me') {
    const name = value('name');
    if (!name) return;
    const me = store.me();
    if (me) {
      if (me.name === name) return;
      if (store.data.members.some((m) => m.id !== me.id && m.name === name)) {
        return showFieldError(form, 'name', `成员池里已经有「${name}」了，换个名字或直接用它建账本。`);
      }
      store.mutate(() => {
        me.name = name;
      });
    } else {
      store.mutate(() => store.ensureMe(name));
    }
    if ($('#modal').open) $('#modal').close();
    return render();
  }

  if (kind === 'entry') {
    const amountCents = parseYuanToCents(value('amount'));
    if (amountCents === null || amountCents <= 0) return showFieldError(form, 'amount', '金额请输入大于 0 的数字。');
    if (!ledger) {
      alert('请先选择账本。');
      return false;
    }
    const entryId = value('entryId');
    store.mutate((data) => {
      const l = data.ledgers.find((x) => x.id === ledger.id);
      if (entryId) {
        const e = l.entries.find((x) => x.id === entryId);
        Object.assign(e, { date: value('date'), amountCents, payerId: value('payerId'), category: value('category'), note: value('note') });
      } else {
        l.entries.push({ id: uid('e'), date: value('date'), amountCents, payerId: value('payerId'), category: value('category'), note: value('note'), createdAt: Date.now() });
      }
    });
    $('#modal').close();
    render();
    const amountInput = document.querySelector('[data-form="entry"] [name="amount"]');
    if (amountInput && !amountInput.closest('#modal')) amountInput.focus();
    return;
  }

  if (kind === 'create-ledger') {
    const name = value('name') || '未命名账本';
    const memberIds = [...pickerState('new-ledger').selected];
    const me = store.me();
    if (me && !memberIds.includes(me.id)) memberIds.unshift(me.id);
    store.mutate((data) => {
      const created = { id: uid('l'), name, currency: value('currency') || '¥', memberIds, createdAt: Date.now(), entries: [] };
      data.ledgers.push(created);
      data.ui.activeLedgerId = created.id;
      data.ui.tab = 'flow';
    });
    $('#modal').close();
    $('#switcher').close();
    $('#ledger-menu').close();
    document.body.classList.remove('form-open');
    render();
    return;
  }

  if (kind === 'add-category') {
    const name = value('name');
    if (!name) return;
    store.mutate((data) => {
      if (!data.categories.includes(name)) data.categories.push(name);
    });
    return render();
  }

  if (kind === 'rename-ledger') {
    const name = value('name');
    const target = findLedger(value('ledgerId')) || store.activeLedger();
    if (name && target) store.mutate(() => (target.name = name));
    $('#modal').close();
    return render();
  }
}

/* ---------- 点击 ---------- */

let dataInfo = null;

async function onClick(action, target) {
  const id = target.dataset.id;
  const ledger = store.activeLedger();

  if (action === 'close-modal') {
    if (!store.me()) return;
    return $('#modal').close();
  }
  if (target.dataset.pick) return pickMember(target.dataset.pick, target.dataset.id);
  if (target.dataset.create) return createAndPick(target.dataset.create, target.dataset.name);
  if (target.dataset.unpick) return unpickMember(target.dataset.unpick, target.dataset.id);

  switch (action) {
    case 'new-ledger':
      if (!store.me()) return openMeModal();
      return openLedgerModal();
    case 'open-switcher':
      return openSwitcher();
    case 'close-switcher':
      return $('#switcher').close();
    case 'ledger-menu':
      return openLedgerMenu(id);
    case 'close-ledger-menu':
      return $('#ledger-menu').close();
    case 'rename-ledger-open':
      return openRenameModal(id);
    case 'set-ledger-currency': {
      const l = findLedger(id);
      if (!l) return;
      store.mutate(() => (l.currency = target.dataset.currency));
      return render();
    }
    case 'toggle-entry-form': {
      if (store.data.ui.tab !== 'flow') {
        store.mutate((data) => (data.ui.tab = 'flow'));
        render();
        document.body.classList.add('form-open');
        requestAnimationFrame(focusAmountInput);
        return;
      }
      const open = document.body.classList.toggle('form-open');
      if (open) requestAnimationFrame(focusAmountInput);
      return;
    }
    case 'close-entry-form':
      return document.body.classList.remove('form-open');
    case 'select-ledger': {
      const picked = findLedger(id) || ledger;
      if (!picked) return;
      store.mutate((data) => (data.ui.activeLedgerId = picked.id));
      memberQuery = '';
      document.body.classList.remove('form-open');
      $('#switcher').close();
      $('#ledger-menu').close();
      return render();
    }
    case 'tab':
      store.mutate((data) => (data.ui.tab = target.dataset.tab));
      document.body.classList.remove('form-open');
      return render();
    case 'edit-entry':
      return openEntryModal(id);
    case 'delete-entry':
      if (!ledger || !confirm('删除这笔记录？')) return;
      store.mutate(() => {
        ledger.entries = ledger.entries.filter((e) => e.id !== id);
      });
      return render();
    case 'toggle-member':
      if (!ledger) return;
      if (ledger.memberIds.includes(id)) {
        if (store.isMe(id) && !confirm('确定把你自己在账本里的人数去掉吗？人均会按剩下的人数算。')) return;
        if (ledger.entries.some((e) => e.payerId === id)) return alert('这个人已经付过钱了，先改或删掉相关记录再移出。');
        store.mutate(() => {
          ledger.memberIds = ledger.memberIds.filter((m) => m !== id);
        });
      } else {
        store.mutate(() => ledger.memberIds.push(id));
      }
      return render();
    case 'remove-category': {
      const name = target.dataset.name;
      store.mutate((data) => {
        data.categories = data.categories.filter((c) => c !== name);
        if (!data.categories.length) data.categories = [...DEFAULT_CATEGORIES];
      });
      return render();
    }
    case 'delete-ledger': {
      const victim = findLedger(id) || ledger;
      if (!victim || !confirm(`确认删除账本「${victim.name}」以及其中 ${victim.entries.length} 笔记录？`)) return;
      store.mutate((data) => {
        data.ledgers = data.ledgers.filter((l) => l.id !== victim.id);
        data.ui.activeLedgerId = data.ledgers[0]?.id || null;
      });
      if (menuLedgerId === victim.id) $('#ledger-menu').close();
      return render();
    }
    case 'choose-path': {
      const result = await window.aaApi?.chooseDataFile?.();
      if (result && !result.canceled) return window.location.reload();
      return refreshDataInfo();
    }
    case 'restore-path': {
      const result = await window.aaApi?.restoreDefaultPath?.();
      if (result && !result.canceled) return window.location.reload();
      return refreshDataInfo();
    }
    case 'confirm-merge':
      commitMerge();
      return;
    case 'cancel-merge':
      pendingMerge = null;
      return render();
    case 'undo-merge':
      return undoMerge();
    case 'export-json':
      return exportJson();
    case 'reveal-path':
      return window.aaApi?.revealDataFile?.();
    default:
      return undefined;
  }
}

async function refreshDataInfo() {
  dataInfo = window.aaApi?.dataInfo ? await window.aaApi.dataInfo() : null;
  if (dataInfo) {
    $('#data-path').textContent = `数据文件：${dataInfo.file}`;
    if (dataInfo.lockedByEnv) $('#data-path').textContent += '（测试用数据文件）';
    else if (!dataInfo.isDefault) $('#data-path').textContent += '（自定义位置）';
  } else {
    $('#data-path').textContent = isNativeApp ? '数据文件：手机应用目录里的 aa-ledger-data.json' : '浏览器预览模式';
  }
  return dataInfo;
}

document.addEventListener('click', (event) => {
  if (event.target.id === 'modal' && store.me()) {
    $('#modal').close();
    return;
  }
  // 点面板空白处（内容没铺满时）也算关闭
  if (event.target.id === 'switcher' || event.target.id === 'ledger-menu') {
    event.target.close();
    return;
  }
  if (!event.target.closest('.picker')) closePickerMenus();
  const target = event.target.closest('[data-action],[data-pick],[data-create],[data-unpick]');
  if (target) onClick(target.dataset.action || '', target);
});

document.addEventListener('input', (event) => {
  const form = event.target.closest('form[data-form]');
  if (form) {
    form.querySelector('.field-error')?.remove();
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  }
  const switcherSearch = event.target.closest('[data-action="switcher-search"]');
  if (switcherSearch) {
    switcherQuery = switcherSearch.value;
    const body = $('#switcher-body');
    if (body) body.innerHTML = switcherCards();
    return;
  }
  const search = event.target.closest('[data-action="member-search"]');
  if (!search) return;
  memberQuery = search.value;
  const list = $('#member-list');
  if (list) list.innerHTML = memberChipList(store.activeLedger());
});

document.addEventListener('change', async (event) => {
  const file = event.target.closest('[data-action="import-file"]');
  if (file) {
    const picked = file.files?.[0];
    file.value = '';
    if (!picked) return;
    stageMergeFromText(await picked.text());
    return render();
  }
  const select = event.target.closest('[data-action="set-currency"]');
  if (!select || !store.activeLedger()) return;
  store.mutate(() => {
    store.activeLedger().currency = select.value;
  });
  render();
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (onSubmit(form, new FormData(form)) === false) return;
  if (!form.closest('#modal')) form.reset();
});

async function boot() {
  await store.init();
  await refreshDataInfo();
  store.onSaveProblem = showSaveProblem;
  window.aaApi?.onDataPathChanged?.(() => window.location.reload());
  $('#modal').addEventListener('cancel', (event) => {
    if (!store.me()) event.preventDefault();
  });
  render();
  if (!store.me()) openMeModal();
}

boot();
