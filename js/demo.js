import { addDays, diffDays, monthBounds, parseISO } from './budget.js';

/** Пример данных для знакомства с приложением: текущий месяц, траты за прошедшие дни. */
export function makeDemo(today) {
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
