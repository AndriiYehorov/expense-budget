import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize,
  dayRows,
  parseAmount,
  addDays,
  diffDays,
  monthBounds,
  nextPeriod,
  addMonths,
  sumPayments,
  dueDate,
} from '../js/budget.js';

const rub = (n) => Math.round(n * 100);
const sept = { base: rub(30000), reserve: 0, periodStart: '2026-09-01', periodEnd: '2026-09-30' };
const ex = (date, amount) => ({ date, amount: rub(amount) });

test('база делится поровну на дни периода', () => {
  const s = summarize(sept, [], '2026-09-01');
  assert.equal(s.totalDays, 30);
  assert.equal(s.limitToday, rub(1000));
  assert.equal(s.plannedDaily, rub(1000));
  assert.equal(s.leftToday, rub(1000));
});

test('отложка вычитается из базы до деления', () => {
  const s = summarize({ ...sept, reserve: rub(6000) }, [], '2026-09-01');
  assert.equal(s.pool, rub(24000));
  assert.equal(s.limitToday, rub(800));
});

test('недотраченное размазывается на оставшиеся дни', () => {
  const s = summarize(sept, [ex('2026-09-01', 500)], '2026-09-02');
  assert.equal(s.remainingDays, 29);
  assert.equal(s.limitToday, Math.floor(rub(29500) / 29)); // 1017,24
  assert.equal(s.limitToday, 101724);
});

test('перерасход уменьшает лимит следующих дней', () => {
  const s = summarize(sept, [ex('2026-09-01', 1500)], '2026-09-02');
  assert.equal(s.limitToday, Math.floor(rub(28500) / 29)); // 982,75
  assert.ok(s.limitToday < rub(1000));
});

test('лимит сегодняшнего дня не меняется, пока тратишь сегодня', () => {
  const before = summarize(sept, [ex('2026-09-01', 500)], '2026-09-02');
  const after = summarize(sept, [ex('2026-09-01', 500), ex('2026-09-02', 700)], '2026-09-02');
  assert.equal(after.limitToday, before.limitToday);
  assert.equal(after.leftToday, before.limitToday - rub(700));
});

test('лимит на завтра учитывает сегодняшние траты', () => {
  const s = summarize(sept, [ex('2026-09-02', 1400)], '2026-09-02');
  assert.equal(s.nextLimit, Math.floor(rub(28600) / 28));
});

test('в последний день лимит равен остатку', () => {
  const s = summarize(sept, [ex('2026-09-10', 29000)], '2026-09-30');
  assert.equal(s.remainingDays, 1);
  assert.equal(s.limitToday, rub(1000));
  assert.equal(s.nextLimit, null);
});

test('перерасход всего периода виден как отрицательный остаток', () => {
  const s = summarize(sept, [ex('2026-09-05', 31000)], '2026-09-06');
  assert.equal(s.overBudget, true);
  assert.equal(s.remainingTotal, rub(-1000));
  assert.ok(s.limitToday < 0);
});

test('траты вне периода не учитываются', () => {
  const s = summarize(sept, [ex('2026-08-31', 5000), ex('2026-10-01', 5000)], '2026-09-01');
  assert.equal(s.spentTotal, 0);
});

test('статусы до начала и после конца периода', () => {
  assert.equal(summarize(sept, [], '2026-08-20').status, 'before');
  assert.equal(summarize(sept, [], '2026-08-20').limitToday, rub(1000));
  const after = summarize(sept, [ex('2026-09-03', 100)], '2026-10-02');
  assert.equal(after.status, 'after');
  assert.equal(after.remainingDays, 0);
  assert.equal(after.limitToday, 0);
});

test('отложка больше базы не даёт отрицательной суммы к расходу', () => {
  const s = summarize({ ...sept, reserve: rub(50000) }, [], '2026-09-01');
  assert.equal(s.pool, 0);
  assert.equal(s.limitToday, 0);
});

test('строки дней: сегодня совпадает с summarize, будущее равно лимиту на завтра', () => {
  const expenses = [ex('2026-09-01', 500), ex('2026-09-02', 1500), ex('2026-09-03', 300)];
  const today = '2026-09-03';
  const s = summarize(sept, expenses, today);
  const rows = dayRows(sept, expenses, today);
  assert.equal(rows.length, 30);
  assert.equal(rows[0].limit, rub(1000));
  assert.equal(rows[1].limit, Math.floor(rub(29500) / 29));
  const todayRow = rows.find((r) => r.kind === 'today');
  assert.equal(todayRow.limit, s.limitToday);
  assert.equal(todayRow.spent, rub(300));
  const future = rows.filter((r) => r.kind === 'future');
  assert.equal(future.length, 27);
  assert.ok(future.every((r) => r.limit === s.nextLimit));
});

test('если каждый день тратить ровно по лимиту, лимит почти не меняется', () => {
  const expenses = [];
  let lastLimit = null;
  for (let i = 0; i < 29; i++) {
    const date = addDays('2026-09-01', i);
    const s = summarize(sept, expenses, date);
    if (lastLimit !== null) assert.ok(Math.abs(s.limitToday - lastLimit) <= 1);
    lastLimit = s.limitToday;
    expenses.push({ date, amount: s.limitToday });
  }
  const last = summarize(sept, expenses, '2026-09-30');
  assert.ok(last.limitToday >= 0 && last.limitToday < rub(1000) + 30);
});

test('parseAmount понимает запятую, пробелы и отвергает мусор', () => {
  assert.equal(parseAmount('250'), 25000);
  assert.equal(parseAmount('99,50'), 9950);
  assert.equal(parseAmount('99.5'), 9950);
  assert.equal(parseAmount('1 200'), 120000);
  assert.equal(parseAmount('0'), 0);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('1.234'), null);
});

test('даты: границы месяца, сдвиг, следующий период', () => {
  assert.deepEqual(monthBounds('2026-02-10'), { start: '2026-02-01', end: '2026-02-28' });
  assert.equal(diffDays('2026-10-01', '2026-10-31'), 30);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.deepEqual(nextPeriod('2026-10-01', '2026-10-31'), { start: '2026-11-01', end: '2026-11-30' });
  assert.deepEqual(nextPeriod('2026-10-15', '2026-11-14'), { start: '2026-11-15', end: '2026-12-14' });
});

const pay = (amount, extra = {}) => ({ id: String(Math.random()), name: 'Платёж', amount: rub(amount), dueDay: null, paid: false, ...extra });

test('обязательные платежи вычитаются из базы вместе с отложкой', () => {
  const st = { ...sept, reserve: rub(5000), payments: [pay(8000), pay(2000)] };
  const s = summarize(st, [], '2026-09-01');
  assert.equal(s.mandatory, rub(10000));
  assert.equal(s.pool, rub(15000));
  assert.equal(s.limitToday, rub(500));
});

test('отметка «оплачен» не меняет лимит', () => {
  const unpaid = { ...sept, payments: [pay(6000), pay(3000)] };
  const paid = { ...sept, payments: [pay(6000, { paid: true }), pay(3000)] };
  const a = summarize(unpaid, [], '2026-09-10');
  const b = summarize(paid, [], '2026-09-10');
  assert.equal(a.limitToday, b.limitToday);
  assert.equal(a.mandatoryPaid, 0);
  assert.equal(b.mandatoryPaid, rub(6000));
});

test('платежи больше свободной базы не дают отрицательный пул', () => {
  const st = { ...sept, reserve: rub(5000), payments: [pay(40000)] };
  const s = summarize(st, [], '2026-09-01');
  assert.equal(s.mandatory, rub(25000));
  assert.equal(s.pool, 0);
  assert.equal(s.limitToday, 0);
});

test('платежи учитываются в строках дней и в плане на день', () => {
  const st = { ...sept, payments: [pay(6000)] };
  const rows = dayRows(st, [], '2026-09-01');
  assert.equal(rows[0].limit, rub(800));
  assert.equal(summarize(st, [], '2026-09-01').plannedDaily, rub(800));
});

test('sumPayments и dueDate', () => {
  assert.equal(sumPayments([pay(100), pay(50.5)]), rub(150.5));
  assert.equal(sumPayments(undefined), 0);
  assert.equal(dueDate({ dueDay: 5 }, '2026-10-01', '2026-10-31'), '2026-10-05');
  assert.equal(dueDate({ dueDay: 5 }, '2026-10-15', '2026-11-14'), '2026-11-05');
  assert.equal(dueDate({ dueDay: 31 }, '2026-10-15', '2026-11-14'), '2026-10-31');
  assert.equal(dueDate({ dueDay: 31 }, '2026-02-01', '2026-02-28'), '2026-02-28');
  assert.equal(dueDate({ dueDay: null }, '2026-10-01', '2026-10-31'), null);
});
