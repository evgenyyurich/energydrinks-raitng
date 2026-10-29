// Тестовые данные. Позже они переедут в Supabase.
export const drinks = [
  { id: 1, name: 'Red Bull', brand: 'Red Bull', volume: 250, caffeine: 32, sugarFree: false, color: '#1e3a8a' },
  { id: 2, name: 'Monster Energy', brand: 'Monster', volume: 500, caffeine: 32, sugarFree: false, color: '#166534' },
  { id: 3, name: 'Monster Ultra White', brand: 'Monster', volume: 500, caffeine: 30, sugarFree: true, color: '#9ca3af' },
  { id: 4, name: 'Burn Original', brand: 'Burn', volume: 449, caffeine: 32, sugarFree: false, color: '#b91c1c' },
  { id: 5, name: 'Adrenaline Rush', brand: 'Adrenaline', volume: 449, caffeine: 30, sugarFree: false, color: '#7c2d12' },
  { id: 6, name: 'Flash Up Energy', brand: 'Flash Up', volume: 450, caffeine: 30, sugarFree: false, color: '#ca8a04' },
  { id: 7, name: 'Tornado Energy', brand: 'Tornado', volume: 450, caffeine: 30, sugarFree: false, color: '#4c1d95' },
  { id: 8, name: 'Gorilla', brand: 'Gorilla', volume: 450, caffeine: 30, sugarFree: false, color: '#111827' },
];

export const users = [
  { id: 1, nick: 'evgen' },
  { id: 2, nick: 'max' },
  { id: 3, nick: 'dimon' },
  { id: 4, nick: 'kate' },
];

// Одна оценка на пару «участник — энергетик», от 1 до 10.
export const ratings = [
  { userId: 1, drinkId: 1, score: 9 },
  { userId: 1, drinkId: 2, score: 8 },
  { userId: 1, drinkId: 3, score: 9 },
  { userId: 1, drinkId: 4, score: 7 },
  { userId: 1, drinkId: 5, score: 8 },
  { userId: 1, drinkId: 6, score: 6 },
  { userId: 1, drinkId: 7, score: 5 },
  { userId: 2, drinkId: 1, score: 8 },
  { userId: 2, drinkId: 2, score: 9 },
  { userId: 2, drinkId: 3, score: 10 },
  { userId: 2, drinkId: 6, score: 5 },
  { userId: 2, drinkId: 7, score: 6 },
  { userId: 3, drinkId: 1, score: 9 },
  { userId: 3, drinkId: 2, score: 7 },
  { userId: 3, drinkId: 4, score: 6 },
  { userId: 3, drinkId: 5, score: 7 },
  { userId: 3, drinkId: 6, score: 7 },
  { userId: 4, drinkId: 2, score: 8 },
  { userId: 4, drinkId: 3, score: 8 },
  { userId: 4, drinkId: 4, score: 8 },
  { userId: 4, drinkId: 6, score: 6 },
];
