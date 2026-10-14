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

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return formatISO(parseISO(iso) + n * DAY_MS);
}

export function diffDays(from, to) {
  return Math.round((parseISO(to) - parseISO(from)) / DAY_MS);
}

/** Сегодняшняя дата в часовом поясе устройства. */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Первый и последний день календарного месяца, в котором лежит дата. */
export function monthBounds(iso) {
  const [y, m] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}` };
}

/** Сдвиг даты на n месяцев; если в целевом месяце нет такого числа, берётся последний день. */
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return formatISO(Date.UTC(ty, tm, Math.min(d, last)));
}

/** Следующий период той же длины в месяцах: с 15 окт по 14 ноя → с 15 ноя по 14 дек. */
export function nextPeriod(_start, end) {
  const start = addDays(end, 1);
  return { start, end: addDays(addMonths(start, 1), -1) };
}

/* ---------- обязательные платежи ---------- */

/** Сумма платежей {amount}. */
export function sumPayments(payments) {
  return (payments || []).reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Дата платежа внутри периода по дню месяца (payment.dueDay, 1–31).
 * Если в месяце нет такого числа, берётся его последний день. Без dueDay возвращает null.
 */
export function dueDate(payment, periodStart, periodEnd) {
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
export function parseAmount(text) {
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
export function summarize(settings, expenses, today) {
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
export function dayRows(settings, expenses, today) {
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
