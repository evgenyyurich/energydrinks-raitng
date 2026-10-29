import {
  loadData, currentUser, onAuthChange, login, register, logout,
  rate, unrate, createDrink, updateDrink, deleteDrink, uploadDrinkImage, deleteDrinkImage,
  updateProfile, uploadAvatar, deleteAvatar,
} from './api.js';
import { prepareDrinkPhoto, prepareAvatar } from './image.js';

const app = document.getElementById('app');
const account = document.getElementById('account');
const tabs = document.querySelectorAll('.tabs__item');

// Данные приходят с нашего сервера (/api) один раз при старте.
let drinks = [];
let users = [];
let ratings = [];

// ---------- Помощники ----------

const average = (scores) =>
  scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

const formatPrice = (n) => `${n} ₽`;
// «Магнит · 119 ₽» — магазин и/или цена, что указано.
const purchaseLabel = (r) => [r.store && escape(r.store), r.price != null && formatPrice(r.price)].filter(Boolean).join(' · ');

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

// Миниатюра в карточке: фото (contain на нейтральном фоне) или цветная банка.
const thumb = (drink) =>
  drink.image
    ? `<span class="card__thumb" aria-hidden="true"><img src="${escape(drink.image)}" alt="" loading="lazy" /></span>`
    : can(drink);
const can = (drink) => `<span class="card__can" style="--can:${drink.color}" aria-hidden="true"></span>`;
// Картинка, если задан avatar, иначе кружок с первой буквой имени (если есть) или ника.
const avatar = (user) =>
  `<span class="avatar" aria-hidden="true">${
    user.avatar ? `<img src="${escape(user.avatar)}" alt="" />` : escape([...(user.name || user.nick)][0].toUpperCase())
  }</span>`;
// Имя участника: имя (если задано) и мелкий @ник рядом; без имени — просто ник.
const displayName = (user) => escape(user.name || user.nick);
const nickTag = (user) => (user.name ? ` <span class="nick">@${escape(user.nick)}</span>` : '');

// ---------- Подсчёты ----------

const drinkStats = () =>
  drinks.map((d) => {
    const own = ratings.filter((r) => r.drinkId === d.id);
    const scores = own.map((r) => r.score);
    const prices = own.map((r) => r.price).filter((p) => p != null);
    const avgPrice = average(prices);
    return {
      ...d, avg: average(scores), votes: scores.length,
      avgPrice: avgPrice === null ? null : Math.round(avgPrice), priceCount: prices.length,
    };
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
  price: (a, b) => (a.avgPrice ?? Infinity) - (b.avgPrice ?? Infinity) || a.name.localeCompare(b.name, 'ru'),
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
        <option value="price">По цене</option>
      </select>
    </section>
    <ol id="list" class="list"></ol>
    <p id="empty" class="muted empty" hidden>Ничего не нашлось.</p>
    ${
      currentUser()
        ? `<div class="action-spacer" aria-hidden="true"></div>
    <div class="action-bar"><div class="action-bar__inner"><a class="btn btn--primary action-bar__btn" href="#/add">+ Добавить энергетик</a></div></div>`
        : ''
    }`;

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
        <li>
         <a class="card card--link" href="#/d/${d.id}">
          <span class="card__rank">${i + 1}</span>
          ${thumb(d)}
          <div class="card__body">
            <h2 class="card__name">${escape(d.name)}</h2>
            <p class="card__meta">
              <span>${escape(d.brand)}</span>
              ${d.avgPrice !== null ? `<span>≈ ${formatPrice(d.avgPrice)}</span>` : ''}
              ${d.sugarFree ? '<span class="tag">без сахара</span>' : ''}
            </p>
          </div>
          ${scoreBox(d.avg, votesLabel(d.votes))}
         </a>
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
                <h2 class="card__name">${displayName(u)}${nickTag(u)}</h2>
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
        <h1 class="profile__nick">${displayName(user)}</h1>
        ${user.name ? `<p class="muted profile__handle">@${escape(user.nick)}</p>` : ''}
        ${user.city ? `<p class="muted profile__city">${escape(user.city)}</p>` : ''}
        <p class="muted profile__stats">
          ${votesLabel(own.length)} · средняя ${avg === null ? '—' : avg.toFixed(1)}
        </p>
        ${currentUser()?.id === user.id ? '<a class="btn btn--ghost btn--sm profile__edit" href="#/me">Редактировать</a>' : ''}
      </div>
    </section>
    ${
      own.length
        ? `<ol class="list">
            ${own
              .map((r) => {
                const all = averages.get(r.drinkId);
                return `
                <li>
                 <a class="card card--link card--profile" href="#/d/${r.drinkId}">
                  ${thumb(r.drink)}
                  <div class="card__body">
                    <h2 class="card__name">${escape(r.drink.name)}</h2>
                    <p class="card__meta"><span>${[`у всех в среднем ${all.toFixed(1)}`, (r.store || r.price != null) && purchaseLabel(r)].filter(Boolean).join(' · ')}</span></p>
                  </div>
                  ${scoreBox(r.score, 'оценка')}
                 </a>
                </li>`;
              })
              .join('')}
          </ol>`
        : '<p class="muted empty">Пока ничего не оценил.</p>'
    }`;
}

// ---------- Общие куски форм ----------

// Одноразовое сообщение на следующей отрисовке (например, «Оценка сохранена»).
let notice = '';
const takeNotice = () => {
  const n = notice;
  notice = '';
  return n ? `<p class="form__ok" role="status">${escape(n)}</p>` : '';
};

// Показывает ошибку в блоке; для дубликата добавляет ссылку на уже существующий энергетик.
function showError(el, err) {
  const text = escape(err?.message || 'Что-то пошло не так. Попробуйте ещё раз.');
  const link = err?.id ? ` <a class="link" href="#/d/${Number(err.id)}">Открыть его</a>` : '';
  el.innerHTML = text + link;
  el.hidden = false;
}

// Блокирует кнопки формы на время запроса.
async function busy(form, fn) {
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach((b) => (b.disabled = true));
  try {
    return await fn();
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

// Перезагружает данные с сервера и перерисовывает текущий экран (без прокрутки вверх).
async function reload() {
  ({ drinks, users, ratings } = await loadData());
  route(false);
}

// ---------- Страница энергетика ----------

const uniqueStores = () => [...new Set(ratings.map((r) => r.store).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));

const bigCan = (drink) => `<span class="drink__can" style="--can:${escape(drink.color || '#1e3a8a')}" aria-hidden="true"></span>`;

function renderDrink(id) {
  const drink = drinkStats().find((d) => d.id === id);
  if (!drink) {
    app.innerHTML = `
      <section class="hero">
        <h1>Энергетик не найден</h1>
        <p><a class="link" href="#/">← Ко всем энергетикам</a></p>
      </section>`;
    return;
  }

  const me = currentUser();
  const all = ratings
    .filter((r) => r.drinkId === id)
    .map((r) => ({ ...r, user: users.find((u) => u.id === r.userId) }))
    .filter((r) => r.user)
    .sort((a, b) => b.score - a.score || a.user.nick.localeCompare(b.user.nick));
  const mine = me ? all.find((r) => r.userId === me.id) : null;
  const owner = !!me && drink.createdBy === me.id;

  app.innerHTML = `
    <a class="link back" href="#/">← Все энергетики</a>
    ${takeNotice()}
    <section class="drink">
      <div class="drink__photo">
        ${drink.image ? `<img src="${escape(drink.image)}" alt="${escape(drink.name)}" />` : bigCan(drink)}
      </div>
      <div class="drink__info">
        <h1 class="drink__name">${escape(drink.name)}</h1>
        <p class="muted drink__brand">${escape(drink.brand)}</p>
        ${drink.avgPrice !== null ? `<p class="card__meta"><span>Средняя цена ≈ ${formatPrice(drink.avgPrice)} · по ${drink.priceCount} ${drink.priceCount % 10 === 1 && drink.priceCount % 100 !== 11 ? 'цене' : 'ценам'}</span></p>` : ''}
        ${drink.sugarFree ? '<p class="card__meta"><span class="tag">без сахара</span></p>' : ''}
      </div>
      ${scoreBox(drink.avg, votesLabel(drink.votes))}
    </section>
    ${
      owner
        ? `<div class="actions">
             <a class="btn btn--ghost" href="#/d/${id}/edit">Редактировать</a>
             <button class="btn btn--ghost btn--danger" type="button" id="drink-delete">Удалить энергетик</button>
           </div>
           <p id="owner-error" class="form__error" role="alert" hidden></p>`
        : ''
    }

    <section class="block" id="my-rating">
      <h2 class="block__title">Моя оценка</h2>
      ${
        me
          ? `<form id="rate-form" class="form" novalidate>
               <div class="field slider ${mine ? '' : 'slider--unset'}">
                 <label class="field__label" for="score">Оценка от 1 до 10</label>
                 <p class="slider__value ${mine ? scoreClass(mine.score) : 'score--none'}" id="score-value" aria-hidden="true">${
                   mine ? `<strong>${mine.score}</strong> / 10` : '<strong>—</strong> / 10'
                 }</p>
                 <input id="score" name="score" class="slider__input" type="range" min="1" max="10" step="1" value="${mine?.score ?? 5}" ${mine ? '' : 'aria-valuetext="не выбрана"'} />
                 <div class="slider__ticks" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<span data-v="${i + 1}"${mine && mine.score === i + 1 ? ' class="is-active"' : ''}>${i + 1}</span>`).join('')}</div>
               </div>
               <div class="field">
                 <label class="field__label" for="store">Где куплен (необязательно)</label>
                 <input id="store" name="store" class="input" type="text" maxlength="100" list="stores" autocomplete="off" value="${escape(mine?.store ?? '')}" />
                 <datalist id="stores">${uniqueStores().map((s) => `<option value="${escape(s)}"></option>`).join('')}</datalist>
               </div>
               <div class="field">
                 <label class="field__label" for="price">Цена, ₽ (необязательно)</label>
                 <input id="price" name="price" class="input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" value="${mine?.price ?? ''}" />
               </div>
               <p id="rate-error" class="form__error" role="alert" hidden></p>
               <div class="actions">
                 <button class="btn btn--primary" type="submit">${mine ? 'Обновить оценку' : 'Сохранить оценку'}</button>
                 ${mine ? '<button class="btn btn--ghost btn--danger" type="button" id="rate-delete">Удалить оценку</button>' : ''}
               </div>
             </form>`
          : '<p><a class="btn btn--primary" href="#/login">Войдите, чтобы оценить</a></p>'
      }
    </section>

    <section class="block">
      <h2 class="block__title">Все оценки · ${all.length}</h2>
      ${
        all.length
          ? `<ol class="list">
              ${all
                .map(
                  (r) => `
                <li class="card card--rating">
                  <a class="card__user" href="#/u/${encodeURIComponent(r.user.nick)}">
                    ${avatar(r.user)}
                    <span class="card__body">
                      <span class="card__name">${displayName(r.user)}${nickTag(r.user)}</span>
                      ${r.store || r.price != null ? `<span class="card__meta"><span>${purchaseLabel(r)}</span></span>` : ''}
                    </span>
                  </a>
                  ${scoreBox(r.score, 'оценка')}
                </li>`,
                )
                .join('')}
            </ol>`
          : '<p class="muted empty">Пока никто не оценил.</p>'
      }
    </section>`;

  const form = document.getElementById('rate-form');
  if (form) {
    const error = document.getElementById('rate-error');
    const slider = document.getElementById('score');
    const shown = document.getElementById('score-value');
    const saveBtn = form.querySelector('button[type="submit"]');
    let chosen = !!mine;
    saveBtn.disabled = !chosen;
    // Оценка «выбрана», только когда пользователь тронул ползунок: случайное значение по умолчанию не сохраняем.
    const sliderBox = form.querySelector('.slider');
    const ticks = sliderBox.querySelectorAll('.slider__ticks span');
    let lastShown = mine ? mine.score : null;
    // Заливка и цвет бегунка: --fill в процентах, --hue плавно идёт от красного (1) к зелёному (10).
    const paint = (v) => {
      const p = ((v - 1) / 9) * 100;
      sliderBox.style.setProperty('--fill', `${p}%`);
      sliderBox.style.setProperty('--fill-n', p);
      sliderBox.style.setProperty('--tone', `var(--${v >= 8 ? 'high' : v >= 6 ? 'mid' : 'low'})`);
      sliderBox.style.setProperty('--hue', Math.round(((v - 1) / 9) * 125));
    };
    paint(Number(slider.value));
    const choose = () => {
      const v = Number(slider.value);
      chosen = true;
      saveBtn.disabled = false;
      sliderBox.classList.remove('slider--unset');
      paint(v);
      ticks.forEach((t) => t.classList.toggle('is-active', Number(t.dataset.v) === v));
      shown.className = `slider__value ${scoreClass(v)}`;
      shown.innerHTML = `<strong>${v}</strong> / 10`;
      slider.setAttribute('aria-valuetext', `${v} из 10`);
      if (v !== lastShown) {
        lastShown = v;
        const num = shown.firstElementChild;
        num.classList.add('bump');
        num.addEventListener('animationend', () => num.classList.remove('bump'), { once: true });
      }
    };
    ticks.forEach((t) =>
      t.addEventListener('click', () => {
        slider.value = t.dataset.v;
        choose();
      }),
    );
    slider.addEventListener('input', choose);
    slider.addEventListener('change', choose);
    slider.addEventListener('pointerdown', choose);
    slider.addEventListener('keydown', (e) => {
      if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') setTimeout(choose);
    });
    if (mine) slider.setAttribute('aria-valuetext', `${mine.score} из 10`);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      const data = new FormData(form);
      const score = Number(data.get('score'));
      if (!chosen || !score) return showError(error, { message: 'Выберите оценку от 1 до 10.' });
      const priceRaw = String(data.get('price') || '').trim();
      let price = null;
      if (priceRaw) {
        price = /^[0-9]{1,4}$/.test(priceRaw) ? Number(priceRaw) : NaN;
        if (!(price >= 1 && price <= 5000)) return showError(error, { message: 'Цена — целое число рублей от 1 до 5000.' });
      }
      await busy(form, async () => {
        try {
          await rate(id, score, String(data.get('store') || '').trim(), price);
          notice = 'Оценка сохранена.';
          await reload();
        } catch (err) {
          showError(error, err);
        }
      });
    });
    document.getElementById('rate-delete')?.addEventListener('click', () =>
      busy(form, async () => {
        error.hidden = true;
        try {
          await unrate(id);
          notice = 'Оценка удалена.';
          await reload();
        } catch (err) {
          showError(error, err);
        }
      }),
    );
  }

  document.getElementById('drink-delete')?.addEventListener('click', async (e) => {
    if (!confirm(`Удалить «${drink.name}» вместе со всеми оценками?`)) return;
    const error = document.getElementById('owner-error');
    error.hidden = true;
    e.target.disabled = true;
    try {
      await deleteDrink(id);
      ({ drinks, users, ratings } = await loadData());
      location.hash = '#/';
    } catch (err) {
      showError(error, err);
      e.target.disabled = false;
    }
  });
}

// ---------- Добавление и правка энергетика ----------

const CAN_COLORS = ['#1e3a8a', '#166534', '#b91c1c', '#7c2d12', '#ca8a04', '#4c1d95', '#111827', '#9ca3af', '#0e7490', '#be185d'];

// drink === null — добавление, иначе правка существующего (только автор).
function renderDrinkForm(drink) {
  const me = currentUser();
  const editing = !!drink;
  if (editing && drink.createdBy !== me.id) {
    app.innerHTML = `
      <section class="hero">
        <h1>Нет доступа</h1>
        <p class="muted">Править энергетик может только тот, кто его добавил.</p>
        <p><a class="link" href="#/d/${drink.id}">← К энергетику</a></p>
      </section>`;
    return;
  }
  const color = (drink?.color || CAN_COLORS[0]).toLowerCase();
  const brands = [...new Set(drinks.map((d) => d.brand))].sort((a, b) => a.localeCompare(b, 'ru'));

  app.innerHTML = `<div class="narrow">
    <a class="link back" href="${editing ? `#/d/${drink.id}` : '#/'}">← Назад</a>
    <section class="hero"><h1>${editing ? 'Редактировать энергетик' : 'Новый энергетик'}</h1></section>
    <form id="drink-form" class="form" novalidate>
      ${field({ id: 'name', label: 'Название', autocomplete: 'off', extra: `maxlength="60" required value="${escape(drink?.name ?? '')}"` })}
      <div class="field">
        <label class="field__label" for="brand">Бренд</label>
        <input id="brand" name="brand" class="input" type="text" autocomplete="off" maxlength="40" required list="brands" value="${escape(drink?.brand ?? '')}" />
        <datalist id="brands">${brands.map((b) => `<option value="${escape(b)}"></option>`).join('')}</datalist>
      </div>
      <label class="check">
        <input type="checkbox" name="sugarFree" ${drink?.sugarFree ? 'checked' : ''} />
        <span>Без сахара</span>
      </label>
      <fieldset class="swatches">
        <legend class="field__label">Цвет банки (если нет фото)</legend>
        <div class="swatches__row">
          ${CAN_COLORS.map(
            (c) => `<label class="swatch" style="--c:${c}">
              <input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''} aria-label="Цвет ${c}" />
              <span></span>
            </label>`,
          ).join('')}
        </div>
      </fieldset>
      <div class="field">
        <label class="field__label" for="photo">Фото (необязательно)</label>
        <div class="photo-preview" id="photo-preview" ${drink?.image ? '' : 'hidden'}>
          ${drink?.image ? `<img src="${escape(drink.image)}" alt="" />` : ''}
        </div>
        <input id="photo" name="photo" class="input input--file" type="file" accept="image/*" />
        <small class="field__hint muted">Фото уменьшится прямо на устройстве; геометки и прочие данные съёмки не отправляются.</small>
        ${
          drink?.image
            ? `<label class="check"><input type="checkbox" name="removePhoto" /><span>Удалить текущее фото</span></label>`
            : ''
        }
      </div>
      <p id="form-error" class="form__error" role="alert" hidden></p>
      <button class="btn btn--primary" type="submit">${editing ? 'Сохранить' : 'Добавить энергетик'}</button>
    </form></div>`;

  const form = document.getElementById('drink-form');
  const error = document.getElementById('form-error');
  const preview = document.getElementById('photo-preview');
  const photo = document.getElementById('photo');
  let previewUrl = null;

  photo.addEventListener('change', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    const file = photo.files[0];
    if (!file) return;
    previewUrl = URL.createObjectURL(file);
    preview.hidden = false;
    preview.innerHTML = '<img alt="" />';
    preview.firstChild.src = previewUrl;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const data = new FormData(form);
    const body = {
      name: String(data.get('name')).trim(),
      brand: String(data.get('brand')).trim(),
      sugarFree: data.has('sugarFree'),
      color: String(data.get('color')),
    };
    const bad = (message, f) => {
      showError(error, { message });
      form.elements[f]?.focus();
    };
    if (!body.name || body.name.length > 60) return bad('Название обязательно, не длиннее 60 символов.', 'name');
    if (!body.brand || body.brand.length > 40) return bad('Бренд обязателен, не длиннее 40 символов.', 'brand');

    await busy(form, async () => {
      try {
        // Фото готовим до сохранения: если картинка не читается, энергетик не создаётся наполовину.
        const file = photo.files[0];
        const blob = file ? await prepareDrinkPhoto(file) : null;

        const id = editing ? drink.id : (await createDrink(body)).id;
        if (editing) await updateDrink(id, body);

        let warning = '';
        try {
          if (blob) await uploadDrinkImage(id, blob);
          else if (editing && data.has('removePhoto')) await deleteDrinkImage(id);
        } catch (err) {
          warning = ` Фото не загрузилось: ${err.message}`;
        }
        notice = (editing ? 'Изменения сохранены.' : 'Энергетик добавлен. Теперь можно поставить оценку.') + warning;
        ({ drinks, users, ratings } = await loadData());
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        scrollToRating = !editing;
        if (location.hash === `#/d/${id}`) route();
        else location.hash = `#/d/${id}`;
      } catch (err) {
        showError(error, err);
        if (err.field) form.elements[err.field]?.focus();
      }
    });
  });
}

// ---------- Мой профиль ----------

function renderMe() {
  const me = users.find((u) => u.id === currentUser().id) || currentUser();
  app.innerHTML = `<div class="narrow">
    <a class="link back" href="#/u/${encodeURIComponent(me.nick)}">← Мой профиль</a>
    <section class="hero"><h1>Редактировать профиль</h1></section>
    ${takeNotice()}
    <section class="profile">
      ${avatar(me).replace('avatar', 'avatar avatar--lg')}
      <div>
        <h2 class="profile__nick">${displayName(me)}</h2>
        ${me.name ? `<p class="muted profile__handle">@${escape(me.nick)}</p>` : ''}
        <p class="muted profile__stats">Ник менять нельзя</p>
      </div>
    </section>
    <form id="avatar-form" class="form" novalidate>
      <div class="field">
        <label class="field__label" for="avatar-file">Аватарка</label>
        <input id="avatar-file" class="input input--file" type="file" accept="image/*" />
        <small class="field__hint muted">Фото обрежется до квадрата и уменьшится на устройстве.</small>
      </div>
      <p id="avatar-error" class="form__error" role="alert" hidden></p>
      <div class="actions">
        <button class="btn btn--primary" type="submit">Загрузить аватарку</button>
        ${me.avatar ? '<button class="btn btn--ghost btn--danger" type="button" id="avatar-delete">Убрать аватарку</button>' : ''}
      </div>
    </form>
    <form id="city-form" class="form" novalidate>
      ${field({ id: 'name', label: 'Имя (необязательно)', autocomplete: 'nickname', hint: 'Показывается вместо ника. Ник — ваш логин и адрес профиля, его изменить нельзя.', extra: `maxlength="40" value="${escape(me.name ?? '')}"` })}
      ${field({ id: 'city', label: 'Город (необязательно)', autocomplete: 'address-level2', extra: `maxlength="60" value="${escape(me.city ?? '')}"` })}
      <p id="city-error" class="form__error" role="alert" hidden></p>
      <button class="btn btn--primary" type="submit">Сохранить имя и город</button>
    </form></div>`;

  const avatarForm = document.getElementById('avatar-form');
  const avatarError = document.getElementById('avatar-error');
  avatarForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    avatarError.hidden = true;
    const file = document.getElementById('avatar-file').files[0];
    if (!file) return showError(avatarError, { message: 'Сначала выберите фото.' });
    await busy(avatarForm, async () => {
      try {
        await uploadAvatar(await prepareAvatar(file));
        notice = 'Аватарка обновлена.';
        await reload();
      } catch (err) {
        showError(avatarError, err);
      }
    });
  });
  document.getElementById('avatar-delete')?.addEventListener('click', () =>
    busy(avatarForm, async () => {
      avatarError.hidden = true;
      try {
        await deleteAvatar();
        notice = 'Аватарка убрана.';
        await reload();
      } catch (err) {
        showError(avatarError, err);
      }
    }),
  );

  const cityForm = document.getElementById('city-form');
  const cityError = document.getElementById('city-error');
  cityForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    cityError.hidden = true;
    const fd = new FormData(cityForm);
    const name = String(fd.get('name')).trim().replace(/ {2,}/g, ' ');
    const city = String(fd.get('city')).trim();
    if ([...name].length > 40 || (name && !/^[\p{L}\p{M}\p{N} .'-]+$/u.test(name)))
      return showError(cityError, { message: 'Имя: до 40 символов — буквы, цифры, пробел, точка, дефис и апостроф.' });
    if (city.length > 60) return showError(cityError, { message: 'Город: не длиннее 60 символов.' });
    await busy(cityForm, async () => {
      try {
        await updateProfile(name, city);
        notice = 'Профиль сохранён.';
        await reload();
      } catch (err) {
        showError(cityError, err);
      }
    });
  });
}

// ---------- Шапка и авторизация ----------

// Кнопка «Войти» или аватар + ник + «Выйти» — по текущей сессии.
function renderAccount() {
  const me = currentUser();
  account.innerHTML = me
    ? `<a class="account__me" href="#/u/${encodeURIComponent(me.nick)}">
         ${avatar(me)}<span class="account__nick">${displayName(me)}</span>
       </a>
       <button class="btn btn--ghost btn--sm" type="button" id="logout">Выйти</button>`
    : '<a class="btn btn--ghost" href="#/login">Войти</a>';
}

// Куда вернуться после входа: последняя страница, не относящаяся к входу/регистрации.
let returnTo = '#/';

// Поле формы: подпись над input, 16px и высоту 44px задаёт .input.
const field = ({ id, label, type = 'text', autocomplete, hint = '', extra = '' }) => `
  <div class="field">
    <label class="field__label" for="${id}">${label}</label>
    <input id="${id}" name="${id}" class="input" type="${type}" autocomplete="${autocomplete}" ${extra} />
    ${hint ? `<small class="field__hint muted">${hint}</small>` : ''}
  </div>`;

// Общая логика формы: блокируем кнопку на время отправки, показываем ошибку.
function bindForm(onSubmit) {
  const form = document.getElementById('auth-form');
  const error = document.getElementById('auth-error');
  const submit = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
    } catch (err) {
      error.textContent = err.message || 'Что-то пошло не так. Попробуйте ещё раз.';
      error.hidden = false;
      if (err.field) form.elements[err.field]?.focus();
      submit.disabled = false;
    }
  });
}

function renderLogin() {
  app.innerHTML = `<div class="narrow narrow--card">
    <section class="hero"><h1>Вход</h1></section>
    <form id="auth-form" class="form" novalidate>
      ${field({ id: 'nick', label: 'Ник', autocomplete: 'username', extra: 'autocapitalize="none" spellcheck="false"' })}
      ${field({ id: 'password', label: 'Пароль', type: 'password', autocomplete: 'current-password' })}
      <p id="auth-error" class="form__error" role="alert" hidden></p>
      <button class="btn btn--primary" type="submit">Войти</button>
    </form>
    <p class="muted form__alt">Ещё нет аккаунта? <a class="link" href="#/register">Зарегистрироваться</a></p></div>`;

  bindForm(async ({ nick, password }) => {
    if (!nick.trim() || !password) throw { message: 'Введите ник и пароль.' };
    await login(nick.trim(), password);
    location.hash = returnTo;
  });
}

function renderRegister() {
  app.innerHTML = `<div class="narrow narrow--card">
    <section class="hero"><h1>Регистрация</h1></section>
    <form id="auth-form" class="form" novalidate>
      ${field({ id: 'nick', label: 'Ник', autocomplete: 'username', hint: '3–24 символа: латинские буквы, цифры и _', extra: 'autocapitalize="none" spellcheck="false" maxlength="24"' })}
      ${field({ id: 'password', label: 'Пароль', type: 'password', autocomplete: 'new-password', hint: 'Минимум 4 символа' })}
      ${field({ id: 'password2', label: 'Повторите пароль', type: 'password', autocomplete: 'new-password' })}
      <p id="auth-error" class="form__error" role="alert" hidden></p>
      <button class="btn btn--primary" type="submit">Зарегистрироваться</button>
    </form>
    <p class="muted form__alt">Уже есть аккаунт? <a class="link" href="#/login">Войти</a></p></div>`;

  bindForm(async ({ nick, password, password2 }) => {
    nick = nick.trim();
    if (!/^[A-Za-z0-9_]{3,24}$/.test(nick))
      throw { message: 'Ник: 3–24 символа, только латинские буквы, цифры и _.', field: 'nick' };
    if (password.length < 4)
      throw { message: 'Пароль слишком короткий: нужно минимум 4 символа.', field: 'password' };
    if (password !== password2) throw { message: 'Пароли не совпадают.', field: 'password2' };

    await register(nick, password);
    // Новый участник должен появиться в списке людей.
    try {
      ({ drinks, users, ratings } = await loadData());
    } catch (err) {
      console.error(err);
    }
    location.hash = `#/u/${encodeURIComponent(nick)}`;
  });
}

// ---------- Маршруты ----------

// Нужна ли после отрисовки прокрутка к форме оценки (после добавления энергетика).
let scrollToRating = false;

function route(scrollTop = true) {
  const hash = location.hash.replace(/^#/, '') || '/';
  const profile = hash.match(/^\/u\/(.+)$/);
  const drinkPage = hash.match(/^\/d\/(\d{1,9})(\/edit)?$/);
  const isAuthPage = hash === '/login' || hash === '/register';
  const needsLogin = hash === '/add' || hash === '/me' || !!drinkPage?.[2];
  const tab = hash === '/people' || profile ? 'people' : isAuthPage || hash === '/me' ? null : 'drinks';

  tabs.forEach((t) => t.classList.toggle('tabs__item--active', t.dataset.tab === tab));
  if (!isAuthPage) returnTo = location.hash || '#/';

  // Вошедшему незачем видеть формы входа и регистрации.
  if (isAuthPage && currentUser()) {
    location.replace(returnTo);
    return;
  }

  // Страницы для вошедших: гостя отправляем на вход, после входа вернёмся сюда.
  if (needsLogin && !currentUser()) {
    location.replace('#/login');
    return;
  }

  if (hash === '/login') renderLogin();
  else if (hash === '/register') renderRegister();
  else if (profile) renderProfile(decodeURIComponent(profile[1]));
  else if (hash === '/add') renderDrinkForm(null);
  else if (hash === '/me') renderMe();
  else if (drinkPage) {
    const id = Number(drinkPage[1]);
    if (drinkPage[2]) {
      const drink = drinks.find((d) => d.id === id);
      if (drink) renderDrinkForm(drink);
      else renderDrink(id);
    } else renderDrink(id);
  }
  else if (hash === '/people') renderPeople();
  else renderDrinks();

  if (scrollToRating) {
    scrollToRating = false;
    document.getElementById('my-rating')?.scrollIntoView();
  } else if (scrollTop) window.scrollTo(0, 0);
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
  window.addEventListener('hashchange', () => route());
  // Шапка обновляется при входе/выходе без перезагрузки страницы.
  let lastUserId = currentUser()?.id ?? null;
  onAuthChange((user) => {
    renderAccount();
    // Вошли или вышли — перерисовываем экран (формы оценки, кнопки «Добавить» и т.п.), кроме страниц входа.
    if ((user?.id ?? null) !== lastUserId) {
      lastUserId = user?.id ?? null;
      if (!/^#\/(login|register)$/.test(location.hash)) route(false);
    }
  });
  account.addEventListener('click', (e) => {
    if (e.target.closest('#logout')) logout().catch((err) => alert(err.message));
  });
  renderAccount();
  route();
}

start();
