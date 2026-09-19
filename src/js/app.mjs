import { store, uid, parseYuanToCents, today, DEFAULT_CATEGORIES } from './store.mjs';
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

function render() {
  renderLedgerList();
  renderHeader();
  renderTabs();
  renderView();
}

function renderLedgerList() {
  const list = $('#ledger-list');
  const { ledgers, ui } = store.data;
  list.innerHTML = ledgers.length
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
  if (!ledger) {
    header.innerHTML = '<h1 class="page-title">AA 账本</h1><p class="hint">按用户组分账，记录谁掏了钱，自动算人均与谁欠谁人情。</p>';
    return;
  }
  const result = settle(ledger, store.memberNamesById());
  header.innerHTML = `
    <div class="header-row">
      <div>
        <h1 class="page-title">${esc(ledger.name)}</h1>
        <p class="hint">${ledger.memberIds.map((id) => esc(store.memberName(id))).join('、') || '尚未选择成员'}</p>
      </div>
      <div class="header-stats">
        <div class="stat"><span>总花销</span><strong>${money(result.totalCents)}</strong></div>
        <div class="stat"><span>人均</span><strong>${money(result.perCapitaCents)}</strong></div>
        <div class="stat"><span>笔数</span><strong>${result.entryCount}</strong></div>
      </div>
    </div>`;
}

function renderTabs() {
  const active = store.data.ui.tab;
  $('#tabs')
    .querySelectorAll('.tab')
    .forEach((el) => el.classList.toggle('is-active', el.dataset.tab === active));
}

function renderView() {
  const view = $('#view');
  const ledger = store.activeLedger();
  if (!ledger) {
    view.innerHTML = '<div class="empty">先在左侧新建一个账本。</div>';
    return;
  }
  if (ledger.memberIds.length === 0 && store.data.ui.tab !== 'members') {
    view.innerHTML = '<div class="empty">这个账本还没有成员。到「成员与分类」里选人，才能算人均。</div>';
    return;
  }
  if (store.data.ui.tab === 'flow') view.innerHTML = flowView(ledger);
  else if (store.data.ui.tab === 'settle') view.innerHTML = settleView(ledger);
  else view.innerHTML = membersView(ledger);
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
        <span class="payer">付：${esc(store.memberName(entry.payerId))}</span>
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
    .map((id) => `<option value="${id}">${esc(store.memberName(id))}</option>`)
    .join('');
  const catOptions = store.data.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const entries = [...ledger.entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
  return `
    <form class="entry-form card" data-form="entry">
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
        <td>${esc(m.name)}</td>
        <td class="num">${money(m.paidCents)}</td>
        <td class="num">${money(m.shareCents)}</td>
        <td class="num ${m.balanceCents > 0 ? 'pos' : m.balanceCents < 0 ? 'neg' : ''}">
          ${m.balanceCents > 0 ? '应收 ' : m.balanceCents < 0 ? '应补 ' : '—'}${m.balanceCents === 0 ? '' : money(Math.abs(m.balanceCents))}
        </td>
        <td class="num">${m.paidCount} 次${m.extraTurns > 0 ? `（多 ${m.extraTurns}）` : ''}</td>
        <td>${m.owedTurns > 0 ? `<span class="badge badge-warn">还欠 ${m.owedTurns} 次掏钱</span>` : ''} ${statusBadge(m.status)}</td>
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
      return `<tr><td>${esc(e.date)}</td><td class="num">${money(e.amountCents)}</td><td class="num">${money(detail.perCapitaCents)}</td><td class="hint">${esc(store.memberName(e.payerId))} 掏的</td><td>${parts}</td></tr>`;
    })
    .join('');

  return `
    <div class="cards">
      <div class="card stat-card"><span>总花销</span><strong>${money(result.totalCents)}</strong></div>
      <div class="card stat-card"><span>总人均（${result.memberCount} 人）</span><strong>${money(result.perCapitaCents)}</strong></div>
    </div>
    ${
      next
        ? `<div class="notice">下一次建议由 <strong>${esc(next.name)}</strong> 掏钱${next.owedTurns > 0 ? `（还缺 ${next.owedTurns} 次）` : '（掏钱次数最少）'}。</div>`
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

function membersView(ledger) {
  const pool = store.data.members;
  const usage = (id) => store.data.ledgers.filter((l) => l.memberIds.includes(id)).length;
  const chips = pool.length
    ? pool
        .map((m) => {
          const inLedger = ledger.memberIds.includes(m.id);
          return `
        <span class="chip chip-member ${inLedger ? 'is-on' : ''}" data-action="toggle-member" data-id="${m.id}" title="点击${inLedger ? '移出' : '加入'}本账本">
          ${esc(m.name)}<em class="hint">${usage(m.id)} 个账本</em>
        </span>`;
        })
        .join('')
    : '<p class="hint">还没有成员，下面添加第一个。</p>';

  const catChips = store.data.categories
    .map((c) => `<span class="chip chip-cat">${esc(c)}<button class="link danger" data-action="remove-category" data-name="${esc(c)}">×</button></span>`)
    .join('');

  return `
    <div class="card">
      <h2>本账本成员（${ledger.memberIds.length} 人）</h2>
      <p class="hint">人均按这里的人数算。成员在所有账本之间共用，加过一次以后直接点选即可。</p>
      <div class="chip-row">${chips}</div>
      <form class="inline-form" data-form="add-member"><input type="text" name="name" placeholder="新成员名字" required /><button class="btn btn-primary">添加并加入本账本</button></form>
    </div>
    <div class="card">
      <h2>分类标签</h2>
      <div class="chip-row">${catChips}</div>
      <form class="inline-form" data-form="add-category"><input type="text" name="name" placeholder="新分类" required /><button class="btn btn-primary">添加</button></form>
    </div>
    <div class="card card-danger">
      <h2>账本设置</h2>
      <form class="inline-form" data-form="rename-ledger"><input type="text" name="name" value="${esc(ledger.name)}" /><button class="btn">改名</button></form>
      <form class="inline-form" data-form="set-currency">
        <select name="currency">${['¥', '$', '€', 'HK$', 'JP¥', '₩']
          .map((c) => `<option value="${c}" ${c === ledger.currency ? 'selected' : ''}>${c}</option>`)
          .join('')}</select>
        <button class="btn">切换币种</button>
      </form>
      <button class="btn btn-danger" data-action="delete-ledger">删除这个账本</button>
    </div>`;
}

function openLedgerModal() {
  const modal = $('#modal');
  const pool = store.data.members;
  modal.innerHTML = `
    <form class="card modal-card" data-form="create-ledger">
      <h2>新建账本</h2>
      <label class="field"><span>账本名称</span><input type="text" name="name" placeholder="如：国庆云南行 / 室友房租" required autofocus /></label>
      <label class="field"><span>币种</span><select name="currency"><option value="¥">¥ 人民币</option><option value="$">$ 美元</option><option value="€">€ 欧元</option><option value="HK$">HK$ 港币</option></select></label>
      <p class="field-label">成员</p>
      ${
        pool.length
          ? `<div class="chip-row" id="modal-members">${pool
              .map((m) => `<label class="chip chip-member"><input type="checkbox" name="memberIds" value="${m.id}" /> ${esc(m.name)}</label>`)
              .join('')}</div>`
          : '<p class="hint">成员池是空的，可先只建账本，稍后在「成员与分类」里加人。</p>'
      }
      <label class="field"><span>新增成员（用、或空格分隔，会存进成员池）</span><input type="text" name="newMembers" placeholder="小明、小红" /></label>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">取消</button><button type="submit" class="btn btn-primary">建账本</button></div>
    </form>`;
  modal.showModal();
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

function onSubmit(form, formData) {
  const kind = form.dataset.form;
  const ledger = store.activeLedger();
  const value = (name) => (formData.get(name) || '').toString().trim();

  if (kind === 'entry') {
    const amountCents = parseYuanToCents(value('amount'));
    if (amountCents === null || amountCents <= 0) return alert('金额请输入大于 0 的数字。');
    if (!ledger) return alert('请先选择账本。');
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
    return render();
  }

  if (kind === 'create-ledger') {
    const name = value('name') || '未命名账本';
    const newNames = value('newMembers').split(/[、,，\s]+/).filter(Boolean);
    store.mutate((data) => {
      const ids = formData.getAll('memberIds').map(String);
      newNames.forEach((n) => {
        const member = store.findOrCreateMember(n);
        if (!ids.includes(member.id)) ids.push(member.id);
      });
      const created = { id: uid('l'), name, currency: value('currency') || '¥', memberIds: ids, createdAt: Date.now(), entries: [] };
      data.ledgers.push(created);
      data.ui.activeLedgerId = created.id;
      data.ui.tab = 'flow';
    });
    $('#modal').close();
    return render();
  }

  if (kind === 'add-member') {
    const name = value('name');
    if (!name) return;
    store.mutate(() => {
      const member = store.findOrCreateMember(name);
      if (!ledger.memberIds.includes(member.id)) ledger.memberIds.push(member.id);
    });
    return render();
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
    if (name) store.mutate(() => (ledger.name = name));
    return render();
  }

  if (kind === 'set-currency') {
    store.mutate(() => (ledger.currency = value('currency') || '¥'));
    return render();
  }
}

function onClick(action, target) {
  const id = target.dataset.id;
  const ledger = store.activeLedger();

  if (action === 'new-ledger') return openLedgerModal();
  if (action === 'close-modal') return $('#modal').close();
  if (action === 'select-ledger') {
    store.mutate((data) => (data.ui.activeLedgerId = id));
    return render();
  }
  if (action === 'tab') {
    store.mutate((data) => (data.ui.tab = target.dataset.tab));
    return render();
  }
  if (action === 'edit-entry') return openEntryModal(id);
  if (action === 'delete-entry' && ledger) {
    if (!confirm('删除这笔记录？')) return;
    store.mutate(() => {
      ledger.entries = ledger.entries.filter((e) => e.id !== id);
    });
    return render();
  }
  if (action === 'toggle-member' && ledger) {
    store.mutate(() => {
      if (ledger.memberIds.includes(id)) {
        if (ledger.entries.some((e) => e.payerId === id)) return alert('这个人已经付过钱了，先改或删掉相关记录再移出。');
        ledger.memberIds = ledger.memberIds.filter((m) => m !== id);
      } else {
        ledger.memberIds.push(id);
      }
    });
    return render();
  }
  if (action === 'remove-category') {
    const name = target.dataset.name;
    store.mutate((data) => {
      if (data.categories.length <= 1) return alert('至少保留一个分类。');
      data.categories = data.categories.filter((c) => c !== name);
      if (!data.categories.length) data.categories = [...DEFAULT_CATEGORIES];
    });
    return render();
  }
  if (action === 'delete-ledger' && ledger) {
    if (!confirm(`确认删除账本「${ledger.name}」以及其中 ${ledger.entries.length} 笔记录？`)) return;
    store.mutate((data) => {
      data.ledgers = data.ledgers.filter((l) => l.id !== ledger.id);
      data.ui.activeLedgerId = data.ledgers[0]?.id || null;
    });
    return render();
  }
}

document.addEventListener('click', (event) => {
  if (event.target.id === 'modal') return $('#modal').close();
  const target = event.target.closest('[data-action]');
  if (target) {
    onClick(target.dataset.action, target);
    return;
  }
  const tab = event.target.closest('.tab');
  if (tab) onClick('tab', tab);
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  onSubmit(form, new FormData(form));
  form.reset();
});

async function boot() {
  await store.init();
  const pathText = window.aaApi?.dataPath ? await window.aaApi.dataPath() : null;
  if (pathText) $('#data-path').textContent = `数据文件：${pathText}`;
  render();
}

boot();
