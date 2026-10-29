import { drinks } from './data.js';

const list = document.getElementById('list');
const empty = document.getElementById('empty');
const search = document.getElementById('search');
const sort = document.getElementById('sort');

const average = (ratings) =>
  ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

const votesLabel = (n) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} оценка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} оценки`;
  return `${n} оценок`;
};

const scoreClass = (avg) => {
  if (avg === null) return 'score--none';
  if (avg >= 8) return 'score--high';
  if (avg >= 6) return 'score--mid';
  return 'score--low';
};

const comparators = {
  rating: (a, b) => (b.avg ?? -1) - (a.avg ?? -1),
  votes: (a, b) => b.ratings.length - a.ratings.length,
  name: (a, b) => a.name.localeCompare(b.name, 'ru'),
  caffeine: (a, b) => b.caffeine - a.caffeine,
};

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function render() {
  const q = search.value.trim().toLowerCase();
  const items = drinks
    .map((d) => ({ ...d, avg: average(d.ratings) }))
    .filter((d) => !q || d.name.toLowerCase().includes(q) || d.brand.toLowerCase().includes(q))
    .sort(comparators[sort.value]);

  empty.hidden = items.length > 0;
  list.innerHTML = items
    .map(
      (d, i) => `
      <li class="card">
        <span class="card__rank">${i + 1}</span>
        <span class="card__can" style="--can:${d.color}" aria-hidden="true"></span>
        <div class="card__body">
          <h2 class="card__name">${escape(d.name)}</h2>
          <p class="card__meta">
            <span>${escape(d.brand)}</span>
            <span>${d.volume} мл</span>
            <span>${d.caffeine} мг/100 мл</span>
            ${d.sugarFree ? '<span class="tag">без сахара</span>' : ''}
          </p>
        </div>
        <div class="score ${scoreClass(d.avg)}">
          <strong>${d.avg === null ? '—' : d.avg.toFixed(1)}</strong>
          <small>${votesLabel(d.ratings.length)}</small>
        </div>
      </li>`,
    )
    .join('');
}

search.addEventListener('input', render);
sort.addEventListener('change', render);
render();
