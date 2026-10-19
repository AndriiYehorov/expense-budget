// Сгенерировано tools/build.mjs из js/*.js. Не редактируйте вручную.
(() => {
/**
 * Расчёт бюджета. Только чистые функции: без DOM, без хранилища, без сети.
 *
 * Деньги: целые числа в копейках (минимальных единицах валюты).
 * Даты: строки 'YYYY-MM-DD'.
 *
 * Главная формула:
 *   лимит дня = (база − отложка − обязательные платежи − траты за прошлые дни)
 *               / дней до конца периода (включая этот)
 * Обязательные платежи вычитаются из базы целиком и сразу, поэтому отметка «оплачен»
 * на лимит не влияет: деньги под платёж уже вынуты из расчёта.
 * Лимит текущего дня фиксируется утром и не меняется, пока вы тратите в этот день.
 * Всё, что вы недотратили или перетратили, автоматически распределяется на следующие дни.
 */

const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');

/* ---------- даты ---------- */

function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(iso, n) {
  return formatISO(parseISO(iso) + n * DAY_MS);
}

function diffDays(from, to) {
  return Math.round((parseISO(to) - parseISO(from)) / DAY_MS);
}

/** Сегодняшняя дата в часовом поясе устройства. */
function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Первый и последний день календарного месяца, в котором лежит дата. */
function monthBounds(iso) {
  const [y, m] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}` };
}

/** Сдвиг даты на n месяцев; если в целевом месяце нет такого числа, берётся последний день. */
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return formatISO(Date.UTC(ty, tm, Math.min(d, last)));
}

/** Следующий период той же длины в месяцах: с 15 окт по 14 ноя → с 15 ноя по 14 дек. */
function nextPeriod(_start, end) {
  const start = addDays(end, 1);
  return { start, end: addDays(addMonths(start, 1), -1) };
}

/* ---------- обязательные платежи ---------- */

/** Сумма платежей {amount}. */
function sumPayments(payments) {
  return (payments || []).reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Дата платежа внутри периода по дню месяца (payment.dueDay, 1–31).
 * Если в месяце нет такого числа, берётся его последний день. Без dueDay возвращает null.
 */
function dueDate(payment, periodStart, periodEnd) {
  if (!payment.dueDay) return null;
  const total = diffDays(periodStart, periodEnd);
  for (let i = 0; i <= total; i++) {
    const iso = addDays(periodStart, i);
    const lastDay = Number(monthBounds(iso).end.slice(8));
    if (Number(iso.slice(8, 10)) === Math.min(payment.dueDay, lastDay)) return iso;
  }
  return null;
}

/* ---------- суммы ---------- */

/** Текст из поля ввода → копейки. Принимает «1 200», «99,50», «99.5». Иначе null. */
function parseAmount(text) {
  const s = String(text ?? '').replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

/* ---------- расчёт ---------- */

/**
 * @param {{base:number, reserve:number, periodStart:string, periodEnd:string}} settings
 * @param {{date:string, amount:number}[]} expenses
 * @param {string} today
 */
function summarize(settings, expenses, today) {
  const { periodStart, periodEnd } = settings;
  const base = settings.base || 0;
  const reserve = Math.min(settings.reserve || 0, base);
  const payments = settings.payments || [];
  const mandatory = Math.min(sumPayments(payments), base - reserve);
  const mandatoryPaid = sumPayments(payments.filter((p) => p.paid));
  const pool = base - reserve - mandatory;
  const totalDays = diffDays(periodStart, periodEnd) + 1;

  const status = today < periodStart ? 'before' : today > periodEnd ? 'after' : 'active';
  const current = status === 'before' ? periodStart : status === 'after' ? periodEnd : today;
  const remainingDays = status === 'after' ? 0 : diffDays(current, periodEnd) + 1;

  let spentTotal = 0;
  let spentBefore = 0;
  let spentCurrent = 0;
  for (const e of expenses) {
    if (e.date < periodStart || e.date > periodEnd) continue;
    spentTotal += e.amount;
    if (e.date < current) spentBefore += e.amount;
    else if (e.date === current) spentCurrent += e.amount;
  }

  const limitToday = remainingDays > 0 ? Math.floor((pool - spentBefore) / remainingDays) : 0;
  const nextLimit =
    remainingDays > 1 ? Math.floor((pool - spentBefore - spentCurrent) / (remainingDays - 1)) : null;

  return {
    status,
    current,
    pool,
    reserve,
    mandatory,
    mandatoryPaid,
    totalDays,
    remainingDays,
    plannedDaily: Math.floor(pool / totalDays),
    spentTotal,
    spentCurrent,
    remainingTotal: pool - spentTotal,
    limitToday,
    leftToday: limitToday - spentCurrent,
    nextLimit,
    overBudget: pool - spentTotal < 0,
  };
}

/**
 * Строки для вкладки «Дни».
 * Прошедшие дни и сегодня считаются точно. Для будущих показывается лимит,
 * который сохранится, если каждый день тратить ровно по лимиту.
 */
function dayRows(settings, expenses, today) {
  const s = summarize(settings, expenses, today);
  const { periodStart, periodEnd } = settings;

  const spentByDate = new Map();
  for (const e of expenses) {
    if (e.date < periodStart || e.date > periodEnd) continue;
    spentByDate.set(e.date, (spentByDate.get(e.date) || 0) + e.amount);
  }

  const futureLimit = s.status === 'before' ? s.limitToday : (s.nextLimit ?? 0);
  const rows = [];
  let spentBefore = 0;
  for (let i = 0; i < s.totalDays; i++) {
    const date = addDays(periodStart, i);
    const spent = spentByDate.get(date) || 0;
    const kind = date < today ? 'past' : date === today ? 'today' : 'future';
    const limit =
      kind === 'future' ? futureLimit : Math.floor((s.pool - spentBefore) / (s.totalDays - i));
    rows.push({ date, kind, spent, limit, left: limit - spent });
    spentBefore += spent;
  }
  return rows;
}


/** Пример данных для знакомства с приложением: текущий месяц, траты за прошедшие дни. */
function makeDemo(today) {
  const { start, end } = monthBounds(today);
  const dayOfMonth = Number(today.slice(8, 10));
  const settings = {
    base: 4_000_000,
    reserve: 500_000,
    periodStart: start,
    periodEnd: end,
    currency: '₴',
    demo: true,
    payments: [
      { id: 'demo-pay-rent', name: 'Аренда', amount: 800_000, dueDay: 5, paid: dayOfMonth >= 5 },
      { id: 'demo-pay-utilities', name: 'Коммуналка', amount: 240_000, dueDay: 20, paid: false },
      { id: 'demo-pay-internet', name: 'Интернет и связь', amount: 45_000, dueDay: 25, paid: false },
      { id: 'demo-pay-subs', name: 'Подписки', amount: 60_000, dueDay: 12, paid: dayOfMonth >= 12 },
    ],
  };

  const notes = ['Продукты', 'Кофе', 'Транспорт', 'Обед', 'Аптека', 'Продукты', 'Такси', 'Кафе'];
  const sums = [120, 240, 380, 95, 520, 310, 60, 450];
  const now = Date.now();
  const expenses = [];

  const past = Math.max(0, diffDays(start, today));
  for (let i = 0; i < past; i++) {
    const date = addDays(start, i);
    const count = 2 + (i % 3 === 0 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const idx = (i * 3 + k * 5) % notes.length;
      expenses.push({
        id: `demo-${i}-${k}`,
        date,
        amount: sums[idx] * 100,
        note: notes[idx],
        category: null,
        source: 'manual',
        createdAt: parseISO(date) + (10 + k * 3) * 3_600_000,
      });
    }
  }
  if (past > 4) {
    expenses.push({
      id: 'demo-big',
      date: addDays(start, 4),
      amount: 185_000,
      note: 'Аптека, лекарства',
      category: null,
      source: 'manual',
      createdAt: parseISO(addDays(start, 4)) + 19 * 3_600_000,
    });
  }

  expenses.push(
    { id: 'demo-today-0', date: today, amount: 9_500, note: 'Кофе', category: null, source: 'manual', createdAt: now - 3_600_000 },
    { id: 'demo-today-1', date: today, amount: 31_000, note: 'Обед', category: null, source: 'manual', createdAt: now - 1_800_000 },
  );

  return { settings, expenses };
}

/**
 * Хранилище. Сейчас IndexedDB на устройстве; если оно недоступно, данные живут в памяти страницы.
 * Интерфейс одинаков для обоих вариантов, поэтому потом можно подключить SQLite (Capacitor)
 * или сервер, не трогая остальной код.
 *
 * Данные:
 *   settings: { base, reserve, periodStart, periodEnd, currency, demo? }   (суммы в копейках)
 *   expense:  { id, date, amount, note, category, source, createdAt }
 *             source: 'manual' сейчас, позже 'bank' для импорта из банка
 */

const DB_NAME = 'expense-budget';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('meta');
      const store = db.createObjectStore('expenses', { keyPath: 'id' });
      store.createIndex('date', 'date');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const finished = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

function idbStorage(db) {
  return {
    persistent: true,

    async load() {
      const tx = db.transaction(['meta', 'expenses'], 'readonly');
      const settings = await wrap(tx.objectStore('meta').get('settings'));
      const expenses = await wrap(tx.objectStore('expenses').getAll());
      return { settings: settings ?? null, expenses };
    },

    async saveSettings(settings) {
      const tx = db.transaction('meta', 'readwrite');
      if (settings) tx.objectStore('meta').put(settings, 'settings');
      else tx.objectStore('meta').delete('settings');
      await finished(tx);
    },

    async putExpense(expense) {
      const tx = db.transaction('expenses', 'readwrite');
      tx.objectStore('expenses').put(expense);
      await finished(tx);
    },

    async removeExpense(id) {
      const tx = db.transaction('expenses', 'readwrite');
      tx.objectStore('expenses').delete(id);
      await finished(tx);
    },

    async replaceAll({ settings, expenses }) {
      const tx = db.transaction(['meta', 'expenses'], 'readwrite');
      const store = tx.objectStore('expenses');
      store.clear();
      for (const e of expenses) store.put(e);
      if (settings) tx.objectStore('meta').put(settings, 'settings');
      else tx.objectStore('meta').delete('settings');
      await finished(tx);
    },
  };
}

function memoryStorage() {
  let settings = null;
  const expenses = new Map();
  return {
    persistent: false,
    async load() {
      return { settings, expenses: [...expenses.values()] };
    },
    async saveSettings(s) {
      settings = s;
    },
    async putExpense(e) {
      expenses.set(e.id, e);
    },
    async removeExpense(id) {
      expenses.delete(id);
    },
    async replaceAll(data) {
      settings = data.settings;
      expenses.clear();
      for (const e of data.expenses) expenses.set(e.id, e);
    },
  };
}

async function createStorage() {
  try {
    if (!('indexedDB' in globalThis)) throw new Error('no indexedDB');
    const db = await openDB();
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* необязательно */
    }
    return idbStorage(db);
  } catch {
    return memoryStorage();
  }
}




const CURRENCIES = ['₴', '$', '€', 'zł', '£'];

const state = {
  storage: null,
  settings: null,
  expenses: [],
  tab: 'today',
  openDays: new Set(),
  scrollToToday: false,
  armed: false,
  toastTimer: 0,
  removed: null,
  removedPayment: null,
  editPaymentId: null,
};

const el = {
  top: document.getElementById('top'),
  notice: document.getElementById('notice'),
  view: document.getElementById('view'),
  tabs: document.getElementById('tabs'),
  toast: document.getElementById('toast'),
};

/* ---------- форматирование ---------- */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const nfInt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nfFrac = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dfDay = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dfShort = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dfTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

const currency = () => state.settings?.currency || '₴';
const moneyIn = (cents, cur) => {
  const v = cents / 100;
  return `${Number.isInteger(v) ? nfInt.format(v) : nfFrac.format(v)} ${cur}`;
};
const money = (cents) => moneyIn(cents, currency());
const whole = (cents) => nfInt.format(Math.floor(cents / 100));
const dayLabel = (iso) => dfDay.format(parseISO(iso));
const shortLabel = (iso) => dfShort.format(parseISO(iso));
const inputValue = (cents) => (cents ? String(cents / 100).replace('.', ',') : '');
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/* ---------- сохранение ---------- */

async function persist(fn) {
  try {
    await fn();
    return true;
  } catch {
    toast('Не удалось сохранить, попробуйте ещё раз');
    return false;
  }
}

function toast(message, actionLabel = '', action = '') {
  clearTimeout(state.toastTimer);
  el.toast.innerHTML =
    `<span>${esc(message)}</span>` +
    (actionLabel ? `<button type="button" class="link" data-action="${action}">${esc(actionLabel)}</button>` : '');
  el.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    el.toast.hidden = true;
    state.removed = null;
    state.removedPayment = null;
  }, 5000);
}

/* ---------- общие куски разметки ---------- */

const crossIcon =
  '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function expenseItem(e) {
  const time =
    e.createdAt && todayISO(new Date(e.createdAt)) === e.date
      ? `<span class="item__time">${dfTime.format(e.createdAt)}</span>`
      : '';
  return (
    `<li class="item"><span class="item__note">${esc(e.note) || 'Без заметки'}${time}</span>` +
    `<span class="item__sum">${money(e.amount)}</span>` +
    `<button type="button" class="icon-btn" data-action="remove" data-id="${esc(e.id)}" aria-label="Удалить трату ${esc(money(e.amount))}">${crossIcon}</button></li>`
  );
}

function expenseList(list, emptyText) {
  if (!list.length) return `<p class="empty">${emptyText}</p>`;
  return `<ul class="list">${list.map(expenseItem).join('')}</ul>`;
}

const byNewest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);

/** Срок платежа словами и тон: просрочен, сегодня, завтра или дата. */
function dueInfo(payment, due, today) {
  if (payment.paid) return { text: 'оплачен', tone: 'ok' };
  if (!due) return { text: 'без срока', tone: '' };
  if (due < today) return { text: `просрочен, был ${shortLabel(due)}`, tone: 'bad' };
  if (due === today) return { text: 'сегодня', tone: 'warn' };
  if (due === addDays(today, 1)) return { text: 'завтра', tone: 'warn' };
  return { text: `до ${shortLabel(due)}`, tone: '' };
}

/** Неоплаченные платежи, которые просрочены или наступят в ближайшие 7 дней. */
function soonPayments(today) {
  const st = state.settings;
  const limit = addDays(today, 7);
  return (st.payments || [])
    .filter((p) => !p.paid)
    .map((p) => ({ p, due: dueDate(p, st.periodStart, st.periodEnd) }))
    .filter((x) => x.due && x.due <= limit)
    .sort((a, b) => a.due.localeCompare(b.due));
}

/* ---------- шапка ---------- */

function renderTop() {
  const s = state.settings;
  el.top.innerHTML =
    '<h1 class="brand">Учёт расходов</h1>' +
    (s ? `<button type="button" class="link period" data-action="tab" data-tab="settings" aria-label="Изменить период">${shortLabel(s.periodStart)} — ${shortLabel(s.periodEnd)}, изменить</button>` : '') +
    (s?.demo
      ? '<div class="demo-banner"><span>Пример данных, не ваши траты</span><button type="button" class="link" data-action="reset-demo">Начать с нуля</button></div>'
      : '');
}

/* ---------- вкладка «Сегодня» ---------- */

function viewToday(today) {
  const st = state.settings;
  const s = summarize(st, state.expenses, today);

  if (s.status === 'after') {
    return (
      '<section class="card"><h2>Период закончен</h2>' +
      `<p class="hint">Итого потрачено ${money(s.spentTotal)} из ${money(s.pool)}. ` +
      (s.remainingTotal >= 0 ? `Остаток: ${money(s.remainingTotal)}.` : `Перерасход: ${money(-s.remainingTotal)}.`) +
      '</p><button type="button" class="btn btn--primary" data-action="next-period-go">Начать следующий период</button></section>'
    );
  }

  let tone = 'ok';
  let pill = 'В рамках лимита';
  if (s.overBudget) {
    tone = 'bad';
    pill = 'Бюджет периода исчерпан';
  } else if (s.limitToday <= 0) {
    tone = 'bad';
    pill = 'На сегодня денег нет';
  } else if (s.leftToday < 0) {
    tone = 'bad';
    pill = 'Перерасход за день';
  } else if (s.leftToday <= s.limitToday * 0.2) {
    tone = 'warn';
    pill = 'Почти весь лимит';
  }

  const share = s.limitToday > 0 ? Math.min(100, (s.spentCurrent / s.limitToday) * 100) : s.spentCurrent > 0 ? 100 : 0;
  const num = whole(s.leftToday);
  const isBefore = s.status === 'before';
  const dayItems = state.expenses.filter((e) => e.date === s.current).sort(byNewest);

  const heroTitle = isBefore ? `Можно тратить в день с ${shortLabel(st.periodStart)}` : 'Можно потратить сегодня';

  return (
    `<section class="hero tone-${tone}" aria-label="Лимит на сегодня">` +
    `<p class="eyebrow">${heroTitle}</p>` +
    `<p class="big${num.length > 6 ? ' big--long' : ''}"><span class="big__num">${num}</span><span class="big__cur">${esc(currency())}</span></p>` +
    `<div class="meter" role="img" aria-label="Потрачено ${Math.round(share)}% дневного лимита"><span class="meter__fill" style="width:${share.toFixed(1)}%"></span></div>` +
    `<div class="hero__row"><p class="hero__meta">Лимит дня ${money(Math.max(0, s.limitToday))} · потрачено ${money(s.spentCurrent)}</p><span class="pill">${pill}</span></div>` +
    '</section>' +
    '<dl class="facts">' +
    `<div class="fact"><dt>Осталось на период</dt><dd>${money(s.remainingTotal)}</dd></div>` +
    `<div class="fact"><dt>Дней до конца</dt><dd>${s.remainingDays}</dd></div>` +
    `<div class="fact"><dt>Лимит на завтра</dt><dd>${s.nextLimit === null ? '—' : money(Math.max(0, s.nextLimit))}</dd></div>` +
    '</dl>' +
    deductionsNote(s) +
    soonNote(today) +
    addForm(s) +
    '<section class="card">' +
    `<h2>${s.current === today ? 'Траты за сегодня' : 'Траты за ' + shortLabel(s.current)}</h2>` +
    expenseList(dayItems, 'Трат пока нет. Введите сумму выше, и лимит пересчитается.') +
    '</section>'
  );
}

function deductionsNote(s) {
  const parts = [];
  if (s.reserve > 0) parts.push(`отложка ${money(s.reserve)}`);
  if (s.mandatory > 0) parts.push(`обязательные платежи ${money(s.mandatory)}`);
  if (!parts.length) return '';
  return `<p class="footnote">Из базы уже вычтено: ${parts.join(' и ')}.</p>`;
}

function soonNote(today) {
  const soon = soonPayments(today);
  if (!soon.length) return '';
  const { p, due } = soon[0];
  const info = dueInfo(p, due, today);
  const more = soon.length > 1 ? ` и ещё ${soon.length - 1}` : '';
  return (
    `<p class="footnote${info.tone ? ' tone-' + info.tone : ''}">Скоро платёж: <b>${esc(p.name)}</b>, ${money(p.amount)}, ${info.text}${more} · ` +
    '<button type="button" class="link" data-action="tab" data-tab="payments">Все платежи</button></p>'
  );
}

function addForm(s) {
  const st = state.settings;
  return (
    '<form class="card" id="addForm" novalidate>' +
    '<h2>Новая трата</h2>' +
    '<div class="grid2 grid2--stack">' +
    `<label class="field"><span>Сумма, ${esc(currency())}</span><input id="f-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" enterkeyhint="done"></label>` +
    '<label class="field"><span>Заметка</span><input id="f-note" name="note" maxlength="80" autocomplete="off" placeholder="Например, продукты"></label>' +
    '</div>' +
    '<div class="grid2 grid2--end grid2--stack">' +
    `<label class="field"><span>Дата</span><input id="f-date" name="date" type="date" value="${s.current}" min="${st.periodStart}" max="${st.periodEnd}"></label>` +
    '<button type="submit" class="btn btn--primary">Добавить</button>' +
    '</div>' +
    '<p class="form-error" id="addError" role="alert" hidden></p>' +
    '</form>'
  );
}

/* ---------- вкладка «Дни» ---------- */

function viewDays(today) {
  const st = state.settings;
  const s = summarize(st, state.expenses, today);
  const rows = dayRows(st, state.expenses, today);

  const items = rows
    .map((r) => {
      const list = state.expenses.filter((e) => e.date === r.date).sort(byNewest);
      let tone = 'ok';
      if (r.spent > r.limit) tone = 'bad';
      else if (r.limit > 0 && r.spent > r.limit * 0.8) tone = 'warn';
      const share = r.limit > 0 ? Math.min(100, (r.spent / r.limit) * 100) : r.spent > 0 ? 100 : 0;
      const tag = r.kind === 'today' ? '<span class="tag">сегодня</span>' : '';
      const nums =
        r.kind === 'future' && !r.spent
          ? `≈ <b>${money(Math.max(0, r.limit))}</b>`
          : `<b>${money(r.spent)}</b> из ${money(Math.max(0, r.limit))}`;
      const head =
        `<span class="day__date">${dayLabel(r.date)}${tag}</span><span class="day__nums">${nums}</span>` +
        `<span class="meter meter--thin tone-${tone}"><span class="meter__fill" style="width:${share.toFixed(1)}%"></span></span>`;

      if (r.kind === 'future' && !list.length) {
        return `<li><div class="day day--future"><div class="day__head">${head}</div></div></li>`;
      }
      const open = state.openDays.has(r.date) ? ' open' : '';
      return (
        `<li><details class="day day--${r.kind}" data-date="${r.date}"${open}>` +
        `<summary class="day__head">${head}</summary>` +
        `<div class="day__body">${expenseList(list, 'В этот день трат нет.')}</div></details></li>`
      );
    })
    .join('');

  return (
    `<p class="summary-line">Потрачено ${money(s.spentTotal)} из ${money(s.pool)}. По плану ${money(s.plannedDaily)} в день. Для будущих дней показан лимит при ровных тратах.</p>` +
    `<ul class="days">${items}</ul>`
  );
}

/* ---------- вкладка «Платежи» ---------- */

const checkIcon =
  '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function paymentItem(p, due, today) {
  const info = dueInfo(p, due, today);
  return (
    `<li class="pay${p.paid ? ' pay--paid' : ''}">` +
    `<button type="button" class="check" role="checkbox" aria-checked="${p.paid}" data-action="toggle-paid" data-id="${esc(p.id)}" aria-label="Оплачен: ${esc(p.name)}">${p.paid ? checkIcon : ''}</button>` +
    `<span class="pay__main"><span class="pay__name">${esc(p.name)}</span>` +
    `<span class="pay__due${info.tone ? ' tone-' + info.tone : ''}">${info.text}</span></span>` +
    `<span class="pay__sum">${money(p.amount)}</span>` +
    '<span class="pay__actions">' +
    `<button type="button" class="link" data-action="edit-payment" data-id="${esc(p.id)}">Изменить</button>` +
    `<button type="button" class="link link--muted" data-action="remove-payment" data-id="${esc(p.id)}">Удалить</button>` +
    '</span></li>'
  );
}

function paymentForm() {
  const editing = (state.settings.payments || []).find((p) => p.id === state.editPaymentId);
  return (
    '<form class="card" id="paymentForm" novalidate>' +
    `<h2>${editing ? 'Изменить платёж' : 'Новый платёж'}</h2>` +
    `<label class="field"><span>Название</span><input id="f-title" name="title" maxlength="40" autocomplete="off" placeholder="Например, аренда" value="${esc(editing?.name ?? '')}"></label>` +
    '<div class="grid2 grid2--stack">' +
    `<label class="field"><span>Сумма, ${esc(currency())}</span><input id="f-sum" name="sum" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(inputValue(editing?.amount ?? 0))}"></label>` +
    `<label class="field"><span>День месяца (необязательно)</span><input id="f-day" name="day" inputmode="numeric" autocomplete="off" maxlength="2" placeholder="5" value="${esc(editing?.dueDay ?? '')}"></label>` +
    '</div>' +
    '<p class="form-error" id="paymentError" role="alert" hidden></p>' +
    '<div class="grid2 grid2--stack">' +
    `<button type="submit" class="btn btn--primary">${editing ? 'Сохранить' : 'Добавить'}</button>` +
    (editing ? '<button type="button" class="btn" data-action="cancel-edit">Отмена</button>' : '') +
    '</div></form>'
  );
}

function viewPayments(today) {
  const st = state.settings;
  const list = st.payments || [];
  const total = sumPayments(list);
  const paid = sumPayments(list.filter((p) => p.paid));
  const rows = list
    .map((p) => ({ p, due: dueDate(p, st.periodStart, st.periodEnd) }))
    .sort(
      (a, b) =>
        Number(a.p.paid) - Number(b.p.paid) ||
        (a.due || '9999').localeCompare(b.due || '9999') ||
        a.p.name.localeCompare(b.p.name, 'ru'),
    );

  return (
    '<section class="card"><h2>Обязательные платежи</h2>' +
    '<dl class="facts">' +
    `<div class="fact"><dt>Всего за период</dt><dd>${money(total)}</dd></div>` +
    `<div class="fact"><dt>Оплачено</dt><dd>${money(paid)}</dd></div>` +
    `<div class="fact"><dt>Осталось оплатить</dt><dd>${money(total - paid)}</dd></div></dl>` +
    '<p class="hint">Эти суммы сразу вычитаются из базы, поэтому дневной лимит их не включает. Отметка «оплачен» нужна только как напоминание и лимит не меняет.</p>' +
    (rows.length
      ? `<ul class="list">${rows.map((r) => paymentItem(r.p, r.due, today)).join('')}</ul>`
      : '<p class="empty">Платежей пока нет. Добавьте аренду, коммуналку, кредит или подписки, и дневной лимит пересчитается без них.</p>') +
    '</section>' +
    paymentForm()
  );
}

/* ---------- настройки и первый запуск ---------- */

function settingsForm(values, mode) {
  const first = mode === 'setup';
  const options = CURRENCIES.map(
    (c) => `<option value="${esc(c)}"${c === values.currency ? ' selected' : ''}>${esc(c)}</option>`,
  ).join('');
  return (
    '<form class="card" id="settingsForm" novalidate>' +
    `<h2>${first ? 'Начнём с периода и суммы' : 'Период и суммы'}</h2>` +
    '<p class="hint">Период: с какого числа пришли деньги и до какого их нужно растянуть. Обычно это день до следующего пополнения.</p>' +
    '<div class="grid2 grid2--stack">' +
    `<label class="field"><span>С какого числа</span><input id="f-start" name="start" type="date" value="${values.periodStart}"></label>` +
    `<label class="field"><span>По какое число (включительно)</span><input id="f-end" name="end" type="date" value="${values.periodEnd}"></label>` +
    '</div>' +
    '<div class="quick">' +
    '<button type="button" class="link" data-action="period-today">С сегодня на месяц</button>' +
    (first ? '' : '<button type="button" class="link" data-action="fill-next-period">Следующий период</button>') +
    '</div>' +
    '<label class="field"><span>Сумма на период (база)</span><input id="f-base" name="base" inputmode="decimal" autocomplete="off" placeholder="30 000"' +
    ` value="${esc(inputValue(values.base))}"></label>` +
    '<label class="field"><span>Отложка (неприкосновенная сумма)</span><input id="f-reserve" name="reserve" inputmode="decimal" autocomplete="off" placeholder="0"' +
    ` value="${esc(inputValue(values.reserve))}"></label>` +
    `<label class="field"><span>Валюта</span><select id="f-currency" name="currency">${options}</select></label>` +
    '<p class="preview" id="preview"></p>' +
    '<p class="form-error" id="settingsError" role="alert" hidden></p>' +
    `<button type="submit" class="btn btn--primary">${first ? 'Начать' : 'Сохранить'}</button>` +
    '</form>'
  );
}

function viewSetup(today) {
  const start = today;
  const end = addDays(addMonths(today, 1), -1);
  return (
    settingsForm({ base: 0, reserve: 0, periodStart: start, periodEnd: end, currency: '₴' }, 'setup') +
    '<section class="card"><h2>Сначала посмотреть</h2>' +
    '<p class="hint">Загрузим пример: месяц с отложкой и несколькими тратами. Его можно стереть одной кнопкой.</p>' +
    '<button type="button" class="btn btn--wide" data-action="demo">Открыть на примере</button></section>'
  );
}

function viewSettings() {
  return (
    settingsForm(state.settings, 'edit') +
    '<section class="card"><h2>Копия данных</h2>' +
    '<p class="hint">Скопируйте данные в буфер и сохраните где угодно. Чтобы восстановить, вставьте текст ниже.</p>' +
    '<label class="field"><span>Текст копии</span><textarea id="f-backup" spellcheck="false"></textarea></label>' +
    '<div class="grid2 grid2--stack"><button type="button" class="btn" data-action="copy">Скопировать данные</button>' +
    '<button type="button" class="btn" data-action="import">Восстановить из текста</button></div>' +
    '<p class="form-error" id="backupError" role="alert" hidden></p></section>' +
    '<section class="card"><h2>Удаление</h2>' +
    '<p class="hint">Удалит суммы, период и все траты с этого устройства.</p>' +
    `<button type="button" class="btn btn--danger${state.armed ? ' is-armed' : ''}" data-action="wipe">${state.armed ? 'Точно удалить всё' : 'Удалить все данные'}</button></section>`
  );
}

function updatePreview() {
  const form = document.getElementById('settingsForm');
  const out = document.getElementById('preview');
  if (!form || !out) return;
  const f = form.elements;
  const base = parseAmount(f.base.value);
  const reserveText = f.reserve.value.trim();
  const reserve = reserveText === '' ? 0 : parseAmount(reserveText);
  const start = f.start.value;
  const end = f.end.value;
  if (!base || reserve === null || !start || !end || end < start) {
    out.textContent = 'Заполните сумму и даты периода, и здесь появится расчёт.';
    return;
  }
  const days = diffDays(start, end) + 1;
  const mandatory = sumPayments(state.settings?.payments);
  const pool = Math.max(0, base - reserve - mandatory);
  const cur = f.currency.value;
  out.textContent =
    `В расчёте ${moneyIn(pool, cur)} на ${days} дн. По плану ${moneyIn(Math.floor(pool / days), cur)} в день.` +
    (mandatory > 0 ? ` Обязательные платежи (${moneyIn(mandatory, cur)}) уже вычтены.` : '');
}

function showError(id, message) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

/* ---------- отрисовка ---------- */

function render() {
  const today = todayISO();
  renderTop();
  el.notice.hidden = !state.storage || state.storage.persistent;
  if (!el.notice.hidden) el.notice.textContent = 'Хранилище браузера недоступно: данные пропадут, когда вы закроете страницу.';

  const hasSettings = !!state.settings;
  el.tabs.hidden = !hasSettings;
  for (const b of el.tabs.querySelectorAll('button')) {
    b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false');
  }

  if (!hasSettings) el.view.innerHTML = viewSetup(today);
  else if (state.tab === 'days') el.view.innerHTML = viewDays(today);
  else if (state.tab === 'payments') el.view.innerHTML = viewPayments(today);
  else if (state.tab === 'settings') el.view.innerHTML = viewSettings();
  else el.view.innerHTML = viewToday(today);

  updatePreview();

  if (state.scrollToToday) {
    state.scrollToToday = false;
    el.view.querySelector('.day--today')?.scrollIntoView({ block: 'center' });
  }
}

function goTab(tab) {
  state.tab = tab;
  state.armed = false;
  state.editPaymentId = null;
  if (tab === 'days') {
    state.openDays.add(todayISO());
    state.scrollToToday = true;
  } else {
    window.scrollTo(0, 0);
  }
  render();
}

/* ---------- действия ---------- */

async function addExpense(form) {
  const st = state.settings;
  const f = form.elements;
  const amount = parseAmount(f.amount.value);
  const date = f.date.value;
  if (!amount) return showError('addError', 'Введите сумму больше нуля, например 250 или 99,50.');
  if (!date || date < st.periodStart || date > st.periodEnd) {
    return showError('addError', `Дата должна попасть в период: ${shortLabel(st.periodStart)} — ${shortLabel(st.periodEnd)}.`);
  }
  const expense = { id: newId(), date, amount, note: f.note.value.trim(), category: null, source: 'manual', createdAt: Date.now() };
  state.expenses.push(expense);
  const ok = await persist(() => state.storage.putExpense(expense));
  if (!ok) state.expenses.pop();
  render();
  if (ok) {
    toast(`Добавлено: ${money(amount)}`);
    document.getElementById('f-amount')?.focus();
  }
}

async function removeExpense(id) {
  const index = state.expenses.findIndex((e) => e.id === id);
  if (index < 0) return;
  const [removed] = state.expenses.splice(index, 1);
  const ok = await persist(() => state.storage.removeExpense(id));
  if (!ok) {
    state.expenses.splice(index, 0, removed);
  } else {
    state.removed = removed;
  }
  render();
  if (ok) toast(`Удалено: ${money(removed.amount)}`, 'Вернуть', 'undo');
}

async function undoRemove() {
  const e = state.removed;
  if (!e) return;
  state.removed = null;
  state.expenses.push(e);
  await persist(() => state.storage.putExpense(e));
  el.toast.hidden = true;
  render();
}

async function saveSettingsForm(form) {
  const f = form.elements;
  const base = parseAmount(f.base.value);
  const reserveText = f.reserve.value.trim();
  const reserve = reserveText === '' ? 0 : parseAmount(reserveText);
  const periodStart = f.start.value;
  const periodEnd = f.end.value;

  if (!base) return showError('settingsError', 'Введите сумму на период больше нуля, например 30000.');
  if (reserve === null) return showError('settingsError', 'Отложка: введите число, например 5000, или оставьте поле пустым.');
  const mandatory = sumPayments(state.settings?.payments);
  if (reserve + mandatory > base) {
    return showError(
      'settingsError',
      mandatory > 0
        ? `Отложка и обязательные платежи (${money(mandatory)}) вместе больше суммы на период. Увеличьте сумму или уменьшите отложку.`
        : 'Отложка не может быть больше суммы на период.',
    );
  }
  if (!periodStart || !periodEnd || periodEnd < periodStart) return showError('settingsError', 'Конец периода должен быть не раньше начала.');
  if (diffDays(periodStart, periodEnd) > 370) return showError('settingsError', 'Период не может быть длиннее года.');

  const wasSetup = !state.settings;
  const prev = state.settings;
  // Новый период: платежи остаются в списке, отметки «оплачен» сбрасываются.
  const payments = (prev?.payments || []).map((p) => (prev.periodStart !== periodStart ? { ...p, paid: false } : p));
  state.settings = { ...prev, base, reserve, periodStart, periodEnd, currency: f.currency.value, payments };
  const ok = await persist(() => state.storage.saveSettings(state.settings));
  if (!ok) return;
  state.tab = 'today';
  window.scrollTo(0, 0);
  render();
  toast(wasSetup ? 'Готово, лимит на сегодня рассчитан' : 'Настройки сохранены');
}

async function savePayment(form) {
  const st = state.settings;
  const f = form.elements;
  const name = f.title.value.trim();
  const amount = parseAmount(f.sum.value);
  const dayText = f.day.value.trim();
  const dueDay = dayText === '' ? null : Number(dayText);

  if (!name) return showError('paymentError', 'Введите название, например «Аренда».');
  if (!amount) return showError('paymentError', 'Введите сумму больше нуля, например 8000.');
  if (dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
    return showError('paymentError', 'День месяца: число от 1 до 31 или пустое поле.');
  }

  const payments = st.payments || [];
  const others = payments.filter((p) => p.id !== state.editPaymentId);
  if (st.reserve + sumPayments(others) + amount > st.base) {
    return showError(
      'paymentError',
      `Отложка и платежи вместе не могут быть больше суммы на период (${money(st.base)}). Увеличьте сумму в настройках.`,
    );
  }

  const editing = payments.find((p) => p.id === state.editPaymentId);
  const next = editing
    ? payments.map((p) => (p.id === editing.id ? { ...p, name, amount, dueDay } : p))
    : [...payments, { id: newId(), name, amount, dueDay, paid: false }];
  const before = st.payments;
  st.payments = next;
  const ok = await persist(() => state.storage.saveSettings(st));
  if (!ok) st.payments = before;
  state.editPaymentId = null;
  render();
  if (ok) toast(editing ? 'Платёж сохранён' : `Платёж добавлен: ${money(amount)}`);
}

async function togglePaid(id) {
  const p = (state.settings.payments || []).find((x) => x.id === id);
  if (!p) return;
  p.paid = !p.paid;
  const ok = await persist(() => state.storage.saveSettings(state.settings));
  if (!ok) p.paid = !p.paid;
  render();
}

async function removePayment(id) {
  const st = state.settings;
  const index = (st.payments || []).findIndex((p) => p.id === id);
  if (index < 0) return;
  const [removed] = st.payments.splice(index, 1);
  const ok = await persist(() => state.storage.saveSettings(st));
  if (!ok) st.payments.splice(index, 0, removed);
  else state.removedPayment = { payment: removed, index };
  if (state.editPaymentId === id) state.editPaymentId = null;
  render();
  if (ok) toast(`Платёж удалён: ${removed.name}`, 'Вернуть', 'undo-payment');
}

async function undoPayment() {
  const r = state.removedPayment;
  if (!r) return;
  state.removedPayment = null;
  state.settings.payments.splice(Math.min(r.index, state.settings.payments.length), 0, r.payment);
  await persist(() => state.storage.saveSettings(state.settings));
  el.toast.hidden = true;
  render();
}

async function loadDemo() {
  const demo = makeDemo(todayISO());
  state.settings = demo.settings;
  state.expenses = demo.expenses;
  await persist(() => state.storage.replaceAll(demo));
  state.tab = 'today';
  render();
}

async function wipeAll() {
  state.settings = null;
  state.expenses = [];
  state.armed = false;
  state.tab = 'today';
  await persist(() => state.storage.replaceAll({ settings: null, expenses: [] }));
  render();
}

function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const s = data?.settings;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!s || !Number.isInteger(s.base) || !iso.test(s.periodStart) || !iso.test(s.periodEnd) || !Array.isArray(data.expenses)) return null;
  const expenses = data.expenses
    .filter((e) => e && iso.test(e.date) && Number.isInteger(e.amount) && e.amount > 0)
    .map((e) => ({
      id: String(e.id ?? newId()),
      date: e.date,
      amount: e.amount,
      note: String(e.note ?? ''),
      category: e.category ?? null,
      source: e.source ?? 'manual',
      createdAt: Number(e.createdAt) || Date.now(),
    }));
  const payments = Array.isArray(s.payments)
    ? s.payments
        .filter((p) => p && typeof p.name === 'string' && Number.isInteger(p.amount) && p.amount > 0)
        .map((p) => ({
          id: String(p.id ?? newId()),
          name: p.name.slice(0, 40),
          amount: p.amount,
          dueDay: Number.isInteger(p.dueDay) && p.dueDay >= 1 && p.dueDay <= 31 ? p.dueDay : null,
          paid: Boolean(p.paid),
        }))
    : [];
  return {
    settings: {
      base: s.base,
      reserve: Number.isInteger(s.reserve) ? s.reserve : 0,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      currency: CURRENCIES.includes(s.currency) ? s.currency : '₴',
      payments,
    },
    expenses,
  };
}

async function copyData() {
  const json = JSON.stringify({ version: 1, settings: state.settings, expenses: state.expenses });
  const box = document.getElementById('f-backup');
  try {
    await navigator.clipboard.writeText(json);
    toast('Данные скопированы в буфер');
  } catch {
    if (box) {
      box.value = json;
      box.focus();
      box.select();
    }
    showError('backupError', 'Буфер недоступен. Текст выделен выше, скопируйте его вручную.');
  }
}

async function importData() {
  const box = document.getElementById('f-backup');
  const data = parseBackup(box?.value ?? '');
  if (!data) return showError('backupError', 'Не получилось прочитать копию. Вставьте весь текст, который вы копировали из приложения.');
  state.settings = data.settings;
  state.expenses = data.expenses;
  const ok = await persist(() => state.storage.replaceAll(data));
  if (!ok) return;
  state.tab = 'today';
  render();
  toast(`Восстановлено трат: ${data.expenses.length}`);
}

function fillPeriodFromToday() {
  const form = document.getElementById('settingsForm');
  if (!form) return;
  const today = todayISO();
  form.elements.start.value = today;
  form.elements.end.value = addDays(addMonths(today, 1), -1);
  updatePreview();
}

function fillNextPeriod() {
  const form = document.getElementById('settingsForm');
  if (!form || !state.settings) return;
  const next = nextPeriod(state.settings.periodStart, state.settings.periodEnd);
  form.elements.start.value = next.start;
  form.elements.end.value = next.end;
  updatePreview();
}

/* ---------- события ---------- */

document.getElementById('app').addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id, tab } = target.dataset;
  if (action === 'tab') goTab(tab);
  else if (action === 'remove') removeExpense(id);
  else if (action === 'undo') undoRemove();
  else if (action === 'undo-payment') undoPayment();
  else if (action === 'toggle-paid') togglePaid(id);
  else if (action === 'remove-payment') removePayment(id);
  else if (action === 'edit-payment') {
    state.editPaymentId = id;
    render();
    document.getElementById('paymentForm')?.scrollIntoView({ block: 'center' });
  } else if (action === 'cancel-edit') {
    state.editPaymentId = null;
    render();
  }
  else if (action === 'demo') loadDemo();
  else if (action === 'reset-demo') wipeAll();
  else if (action === 'fill-next-period') fillNextPeriod();
  else if (action === 'period-today') fillPeriodFromToday();
  else if (action === 'next-period-go') {
    goTab('settings');
    fillNextPeriod();
  } else if (action === 'copy') copyData();
  else if (action === 'import') importData();
  else if (action === 'wipe') {
    if (state.armed) wipeAll();
    else {
      state.armed = true;
      render();
    }
  }
});

document.getElementById('app').addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'addForm') addExpense(event.target);
  else if (event.target.id === 'settingsForm') saveSettingsForm(event.target);
  else if (event.target.id === 'paymentForm') savePayment(event.target);
});

document.getElementById('app').addEventListener('input', (event) => {
  if (event.target.closest('#settingsForm')) updatePreview();
});

el.view.addEventListener(
  'toggle',
  (event) => {
    const date = event.target?.dataset?.date;
    if (!date) return;
    if (event.target.open) state.openDays.add(date);
    else state.openDays.delete(date);
  },
  true,
);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.settings && document.activeElement?.tagName !== 'INPUT') render();
});

/* ---------- запуск ---------- */

async function init() {
  state.storage = await createStorage();
  try {
    const data = await state.storage.load();
    state.settings = data.settings;
    state.expenses = data.expenses;
  } catch {
    /* начинаем с пустого состояния */
  }
  if (!state.settings && globalThis.__AUTO_DEMO__) await loadDemo();
  render();
}

init();

})();
