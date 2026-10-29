import { loadData } from './api.js';

const app = document.getElementById('app');
const tabs = document.querySelectorAll('.tabs__item');

// Данные приходят из PocketBase один раз при старте.
let drinks = [];
let users = [];
let ratings = [];

// ---------- Помощники ----------

const average = (scores) =>
  scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

const plural = (n, one, few, many) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
};
const votesLabel = (n) => plural(n, 'оценка', 'оценки', 'оценок');

const scoreClass = (value) => {
  if (value === null) return 'score--none';
  if (value >= 8) return 'score--high';
  if (value >= 6) return 'score--mid';
  return 'score--low';
};
const formatScore = (value) => (value === null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(1));

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const scoreBox = (value, caption) => `
  <div class="score ${scoreClass(value)}">
    <strong>${formatScore(value)}</strong>
    <small>${caption}</small>
  </div>`;

const can = (drink) => `<span class="card__can" style="--can:${drink.color}" aria-hidden="true"></span>`;
// Картинка, если задан avatar, иначе кружок с первой буквой ника.
const avatar = (user) =>
  `<span class="avatar" aria-hidden="true">${
    user.avatar ? `<img src="${escape(user.avatar)}" alt="" />` : escape(user.nick[0].toUpperCase())
  }</span>`;

// ---------- Подсчёты ----------

const drinkStats = () =>
  drinks.map((d) => {
    const scores = ratings.filter((r) => r.drinkId === d.id).map((r) => r.score);
    return { ...d, avg: average(scores), votes: scores.length };
  });

const userStats = () =>
  users.map((u) => {
    const scores = ratings.filter((r) => r.userId === u.id).map((r) => r.score);
    return { ...u, avg: average(scores), votes: scores.length };
  });

// ---------- Энергетики ----------

const drinkSorts = {
  rating: (a, b) => (b.avg ?? -1) - (a.avg ?? -1),
  votes: (a, b) => b.votes - a.votes,
  name: (a, b) => a.name.localeCompare(b.name, 'ru'),
  caffeine: (a, b) => b.caffeine - a.caffeine,
};

const drinkFilter = { q: '', sort: 'rating' };

function renderDrinks() {
  app.innerHTML = `
    <section class="hero">
      <h1>Рейтинг энергетиков</h1>
      <p class="muted">Средний балл по оценкам всех участников.</p>
    </section>
    <section class="controls">
      <input id="search" class="input" type="search" placeholder="Поиск по названию или бренду" autocomplete="off" />
      <select id="sort" class="input">
        <option value="rating">По рейтингу</option>
        <option value="votes">По числу оценок</option>
        <option value="name">По названию</option>
        <option value="caffeine">По кофеину</option>
      </select>
    </section>
    <ol id="list" class="list"></ol>
    <p id="empty" class="muted empty" hidden>Ничего не нашлось.</p>`;

  const search = document.getElementById('search');
  const sort = document.getElementById('sort');
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  search.value = drinkFilter.q;
  sort.value = drinkFilter.sort;

  const update = () => {
    drinkFilter.q = search.value;
    drinkFilter.sort = sort.value;
    const q = search.value.trim().toLowerCase();
    const items = drinkStats()
      .filter((d) => !q || d.name.toLowerCase().includes(q) || d.brand.toLowerCase().includes(q))
      .sort(drinkSorts[sort.value]);

    empty.hidden = items.length > 0;
    list.innerHTML = items
      .map(
        (d, i) => `
        <li class="card">
          <span class="card__rank">${i + 1}</span>
          ${can(d)}
          <div class="card__body">
            <h2 class="card__name">${escape(d.name)}</h2>
            <p class="card__meta">
              <span>${escape(d.brand)}</span>
              <span>${d.volume} мл</span>
              <span>${d.caffeine} мг/100 мл</span>
              ${d.sugarFree ? '<span class="tag">без сахара</span>' : ''}
            </p>
          </div>
          ${scoreBox(d.avg, votesLabel(d.votes))}
        </li>`,
      )
      .join('');
  };

  search.addEventListener('input', update);
  sort.addEventListener('change', update);
  update();
}

// ---------- Участники ----------

function renderPeople() {
  const items = userStats().sort((a, b) => b.votes - a.votes || a.nick.localeCompare(b.nick));

  app.innerHTML = `
    <section class="hero">
      <h1>Участники</h1>
      <p class="muted">Кто сколько энергетиков оценил. Нажмите на участника, чтобы увидеть его оценки.</p>
    </section>
    <ol class="list">
      ${items
        .map(
          (u, i) => `
          <li>
            <a class="card card--link" href="#/u/${encodeURIComponent(u.nick)}">
              <span class="card__rank">${i + 1}</span>
              ${avatar(u)}
              <div class="card__body">
                <h2 class="card__name">${escape(u.nick)}</h2>
                <p class="card__meta"><span>${[u.city && escape(u.city), `средняя оценка ${formatScore(u.avg === null ? null : Math.round(u.avg * 10) / 10)}`].filter(Boolean).join(' · ')}</span></p>
              </div>
              <div class="score">
                <strong>${u.votes}</strong>
                <small>${plural(u.votes, 'оценка', 'оценки', 'оценок').replace(/^\d+ /, '')}</small>
              </div>
            </a>
          </li>`,
        )
        .join('')}
    </ol>`;
}

// ---------- Профиль ----------

function renderProfile(nick) {
  const user = users.find((u) => u.nick === nick);
  if (!user) {
    app.innerHTML = `
      <section class="hero">
        <h1>Участник не найден</h1>
        <p><a class="link" href="#/people">← Ко всем участникам</a></p>
      </section>`;
    return;
  }

  const averages = new Map(drinkStats().map((d) => [d.id, d.avg]));
  const own = ratings
    .filter((r) => r.userId === user.id)
    .map((r) => ({ ...r, drink: drinks.find((d) => d.id === r.drinkId) }))
    .sort((a, b) => b.score - a.score || a.drink.name.localeCompare(b.drink.name, 'ru'));
  const avg = average(own.map((r) => r.score));

  app.innerHTML = `
    <a class="link back" href="#/people">← Все участники</a>
    <section class="profile">
      ${avatar(user).replace('avatar', 'avatar avatar--lg')}
      <div>
        <h1 class="profile__nick">${escape(user.nick)}</h1>
        ${user.city ? `<p class="muted profile__city">${escape(user.city)}</p>` : ''}
        <p class="muted profile__stats">
          ${votesLabel(own.length)} · средняя ${avg === null ? '—' : avg.toFixed(1)}
        </p>
      </div>
    </section>
    ${
      own.length
        ? `<ol class="list">
            ${own
              .map((r) => {
                const all = averages.get(r.drinkId);
                return `
                <li class="card card--profile">
                  ${can(r.drink)}
                  <div class="card__body">
                    <h2 class="card__name">${escape(r.drink.name)}</h2>
                    <p class="card__meta"><span>${[`у всех в среднем ${all.toFixed(1)}`, r.store && `куплен: ${escape(r.store)}`].filter(Boolean).join(' · ')}</span></p>
                  </div>
                  ${scoreBox(r.score, 'оценка')}
                </li>`;
              })
              .join('')}
          </ol>`
        : '<p class="muted empty">Пока ничего не оценил.</p>'
    }`;
}

// ---------- Маршруты ----------

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const profile = hash.match(/^\/u\/(.+)$/);
  const tab = hash === '/people' || profile ? 'people' : 'drinks';

  tabs.forEach((t) => t.classList.toggle('tabs__item--active', t.dataset.tab === tab));

  if (profile) renderProfile(decodeURIComponent(profile[1]));
  else if (hash === '/people') renderPeople();
  else renderDrinks();

  window.scrollTo(0, 0);
}

async function start() {
  app.innerHTML = '<p class="muted empty">Загрузка…</p>';
  try {
    ({ drinks, users, ratings } = await loadData());
  } catch (err) {
    console.error(err);
    app.innerHTML = `
      <section class="hero">
        <h1>Не удалось загрузить данные</h1>
        <p class="muted">Сервер сейчас недоступен. Попробуйте обновить страницу чуть позже.</p>
      </section>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

start();
