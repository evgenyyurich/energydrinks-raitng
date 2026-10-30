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
const drinksLabel = (n) => plural(n, 'энергетик', 'энергетика', 'энергетиков');

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

// Балл для карточки рейтинга: число видно всегда, цвет — лишь дополнение.
const rankScore = (d) => `
  <div class="score rank-score ${scoreClass(d.avg)}">
    <span class="rank-score__value"><strong>${formatScore(d.avg)}</strong>${d.avg === null ? '' : '<span class="rank-score__max">/10</span>'}</span>
    <small>${d.votes ? votesLabel(d.votes) : 'нет оценок'}</small>
  </div>`;

const rankCard = (d, i) => `
  <li>
    <a class="card card--link card--drink" href="#/d/${d.id}">
      <span class="card__rank">${i + 1}</span>
      <span class="card__media">${thumb(d)}</span>
      <div class="card__body">
        <h2 class="card__name">${escape(d.name)}</h2>
        <p class="card__brand">${escape(d.brand)}</p>
        ${d.avgPrice !== null || d.sugarFree ? `<p class="card__meta">${d.avgPrice !== null ? `<span>≈ ${formatPrice(d.avgPrice)}</span>` : ''}${d.sugarFree ? '<span class="tag">без сахара</span>' : ''}</p>` : ''}
      </div>
      ${rankScore(d)}
    </a>
  </li>`;

function renderDrinks() {
  const canAdd = Boolean(currentUser());
  app.innerHTML = `
    <section class="hero hero--ranking">
      <div class="hero__text">
        <h1>Рейтинг энергетиков</h1>
        <p class="muted">Средний балл по оценкам всех участников.</p>
      </div>
      ${canAdd ? '<a class="btn btn--primary hero__add" href="#/add">+ Добавить энергетик</a>' : ''}
    </section>
    <section class="controls" ${drinks.length ? '' : 'hidden'}>
      <div class="search">
        <label class="visually-hidden" for="search">Поиск по названию или бренду</label>
        <svg class="search__icon" aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4"/></svg>
        <input id="search" class="input" type="search" placeholder="Поиск по названию или бренду" autocomplete="off" />
      </div>
      <div class="sortbox">
        <label class="visually-hidden" for="sort">Сортировка</label>
        <select id="sort" class="input">
          <option value="rating">По рейтингу</option>
          <option value="votes">По числу оценок</option>
          <option value="name">По названию</option>
          <option value="price">По цене</option>
        </select>
      </div>
    </section>
    <p id="count" class="rank-count muted" aria-live="polite"></p>
    <ol id="list" class="list"></ol>
    <div id="empty" hidden></div>
    ${
      canAdd
        ? `<div class="action-spacer" aria-hidden="true"></div>
    <div class="action-bar"><div class="action-bar__inner"><a class="btn btn--primary action-bar__btn" href="#/add">+ Добавить энергетик</a></div></div>`
        : ''
    }`;

  const search = document.getElementById('search');
  const sort = document.getElementById('sort');
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');
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
    if (!items.length) {
      empty.innerHTML = drinks.length
        ? `<div class="empty-state">
            <h2 class="empty-state__title">Ничего не нашлось</h2>
            <p class="empty-state__text">По запросу «${escape(search.value.trim())}» энергетиков нет. Попробуйте изменить запрос.</p>
            <button type="button" class="btn empty-state__action" id="reset-search">Сбросить поиск</button>
          </div>`
        : `<div class="empty-state">
            <h2 class="empty-state__title">Пока нет энергетиков</h2>
            <p class="empty-state__text">В рейтинге ещё ничего нет.</p>
            ${canAdd ? '<a class="btn btn--primary empty-state__action" href="#/add">Добавить энергетик</a>' : ''}
          </div>`;
    }
    count.textContent = q && items.length ? `Найдено: ${items.length}` : '';
    list.innerHTML = items.map(rankCard).join('');
  };

  empty.addEventListener('click', (e) => {
    if (!e.target.closest('#reset-search')) return;
    search.value = '';
    update();
    search.focus();
  });
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
  const addedCount = drinks.filter((d) => d.createdBy === user.id).length;

  app.innerHTML = `
    <a class="link back" href="#/people">← Все участники</a>
    ${takeAdminNotice()}
    <section class="profile">
      ${avatar(user).replace('avatar', 'avatar avatar--lg')}
      <div>
        <h1 class="profile__nick">${displayName(user)}</h1>
        ${user.name ? `<p class="muted profile__handle">@${escape(user.nick)}</p>` : ''}
        ${user.city ? `<p class="muted profile__city">${escape(user.city)}</p>` : ''}
        <p class="muted profile__stats">
          ${votesLabel(own.length)} · средняя ${avg === null ? '—' : avg.toFixed(1)}${addedCount ? ` · добавлено ${drinksLabel(addedCount)}` : ''}
        </p>
        ${
          currentUser()?.id === user.id
            ? '<a class="btn btn--ghost btn--sm profile__edit" href="#/me">Редактировать</a>'
            : currentUser()?.isAdmin
              ? `<a class="btn btn--ghost btn--sm profile__edit" href="#/u/${encodeURIComponent(user.nick)}/edit">Редактировать</a>`
              : ''
        }
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
                 ${ratingAdminHtml(r)}
                </li>`;
              })
              .join('')}
          </ol>`
        : '<p class="muted empty">Пока ничего не оценил.</p>'
    }`;
  bindRatingAdmin();
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

// Форма оценки (ползунок, магазин, цена). p — префикс id: у формы в окне администратора он свой, чтобы id не совпали
// с «Моей оценкой». actions — дополнительные кнопки рядом с «Сохранить».
function rateFormHtml(cur, p, { actions = '' } = {}) {
  return `<form id="${p}rate-form" class="form" novalidate>
         <div class="field slider ${cur ? '' : 'slider--unset'}">
           <label class="field__label" for="${p}score">Оценка от 1 до 10</label>
           <div class="rate__head">
             <p class="slider__value ${cur ? scoreClass(cur.score) : 'score--none'}" id="${p}score-value" aria-hidden="true">${
               cur ? `<strong>${cur.score}</strong> / 10` : '<strong>—</strong> / 10'
             }</p>
             <p class="rate__status" id="${p}rate-status" data-state="${cur ? 'saved' : 'none'}">${cur ? 'Сохранено' : 'Оценка не выбрана'}</p>
           </div>
           <input id="${p}score" name="score" class="slider__input" type="range" min="1" max="10" step="1" value="${cur?.score ?? 5}" ${cur ? '' : 'aria-valuetext="не выбрана"'} />
           <div class="slider__ticks" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<span data-v="${i + 1}" style="--i:${i}"${cur && cur.score === i + 1 ? ' class="is-active"' : ''}>${i + 1}</span>`).join('')}</div>
         </div>
         <div class="field">
           <label class="field__label" for="${p}store">Где куплен</label>
           <input id="${p}store" name="store" class="input" type="text" maxlength="100" list="${p}stores" autocomplete="off" aria-describedby="${p}store-hint" value="${escape(cur?.store ?? '')}" />
           <span class="field__hint muted" id="${p}store-hint">необязательно</span>
           <datalist id="${p}stores">${uniqueStores().map((s) => `<option value="${escape(s)}"></option>`).join('')}</datalist>
         </div>
         <div class="field">
           <label class="field__label" for="${p}price">Цена, ₽</label>
           <input id="${p}price" name="price" class="input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" aria-describedby="${p}price-hint ${p}price-error" value="${cur?.price ?? ''}" />
           <span class="field__hint muted" id="${p}price-hint">необязательно</span>
           <p class="field__error" id="${p}price-error" hidden></p>
         </div>
         <p id="${p}rate-error" class="form__error" role="alert" hidden></p>
         <div class="actions">
           <button class="btn btn--primary" type="submit" id="${p}rate-submit">${cur ? 'Обновить оценку' : 'Сохранить оценку'}</button>
           ${actions}
         </div>
       </form>`;
}

// Логика формы оценки: ползунок, статус, проверка цены. save(score, store, price) вызывается при отправке;
// ошибки save показываются в форме.
function mountRateForm(p, cur, save) {
  const el = (name) => document.getElementById(p + name);
  const form = el('rate-form');
  const error = el('rate-error');
  const slider = el('score');
  const shown = el('score-value');
  const statusEl = el('rate-status');
  const storeEl = el('store');
  const priceEl = el('price');
  const priceError = el('price-error');
  const saveBtn = el('rate-submit');
  let chosen = !!cur;
  saveBtn.disabled = !chosen;
  // Оценка «выбрана», только когда пользователь тронул ползунок: случайное значение по умолчанию не сохраняем.
  const sliderBox = form.querySelector('.slider');
  const ticks = sliderBox.querySelectorAll('.slider__ticks span');
  // Заливка и цвет бегунка: --fill в процентах, --hue плавно идёт от красного (1) к зелёному (10).
  const paint = (v) => {
    const pct = ((v - 1) / 9) * 100;
    sliderBox.style.setProperty('--fill', `${pct}%`);
    sliderBox.style.setProperty('--fill-n', pct);
    sliderBox.style.setProperty('--tone', `var(--${v >= 8 ? 'high' : v >= 6 ? 'mid' : 'low'})`);
    sliderBox.style.setProperty('--hue', Math.round(((v - 1) / 9) * 125));
  };
  paint(Number(slider.value));
  // Статус: «Сохранено» / «Не сохранено» / «Есть несохранённые изменения» / «Оценка не выбрана» — без перерисовки страницы.
  const refreshStatus = () => {
    const changed =
      !!cur &&
      (Number(slider.value) !== cur.score ||
        storeEl.value.trim() !== (cur.store ?? '') ||
        priceEl.value.trim() !== String(cur.price ?? ''));
    const state = cur ? (changed ? 'dirty' : 'saved') : chosen ? 'dirty' : 'none';
    statusEl.dataset.state = state;
    statusEl.textContent = state === 'saved' ? 'Сохранено' : state === 'none' ? 'Оценка не выбрана' : cur ? 'Есть несохранённые изменения' : 'Не сохранено';
  };
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
    refreshStatus();
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
  storeEl.addEventListener('input', refreshStatus);
  priceEl.addEventListener('input', () => {
    priceError.hidden = true;
    priceEl.removeAttribute('aria-invalid');
    refreshStatus();
  });
  if (cur) slider.setAttribute('aria-valuetext', `${cur.score} из 10`);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    priceError.hidden = true;
    priceEl.removeAttribute('aria-invalid');
    const data = new FormData(form);
    const score = Number(data.get('score'));
    if (!chosen || !score) return showError(error, { message: 'Выберите оценку от 1 до 10.' });
    const priceRaw = String(data.get('price') || '').trim();
    let price = null;
    if (priceRaw) {
      price = /^[0-9]{1,4}$/.test(priceRaw) ? Number(priceRaw) : NaN;
      if (!(price >= 1 && price <= 5000)) {
        priceError.textContent = 'Цена — целое число рублей от 1 до 5000.';
        priceError.hidden = false;
        priceEl.setAttribute('aria-invalid', 'true');
        priceEl.focus();
        return;
      }
    }
    saveBtn.setAttribute('aria-busy', 'true');
    await busy(form, async () => {
      try {
        await save(score, String(data.get('store') || '').trim(), price);
      } catch (err) {
        showError(error, err);
      }
    });
    saveBtn.removeAttribute('aria-busy');
  });
}

// ---------- Администратор: чужие оценки ----------

// Одноразовое сообщение о действии администратора над оценкой (показывается над списком оценок).
let adminNotice = '';
const takeAdminNotice = () => {
  const n = adminNotice;
  adminNotice = '';
  return n ? `<p class="form__ok" role="status">${escape(n)}</p>` : '';
};

// Кнопки «Изменить» / «Удалить» у чужой оценки — только для администратора.
const ratingAdminHtml = (r) =>
  currentUser()?.isAdmin && r.userId !== currentUser().id
    ? `<div class="card__admin">
         <button type="button" class="btn btn--ghost btn--sm" data-rating-edit data-user="${r.userId}" data-drink="${r.drinkId}">Изменить</button>
         <button type="button" class="btn btn--ghost btn--sm btn--danger" data-rating-delete data-user="${r.userId}" data-drink="${r.drinkId}">Удалить</button>
       </div>`
    : '';

// Нативный <dialog> поверх страницы; закрывается по подложке, Esc и кнопкам, после закрытия убирается из DOM.
function openDialog(html) {
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm';
  dialog.innerHTML = html;
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  app.append(dialog);
  dialog.showModal();
  return dialog;
}

const ratingTitle = (userId, drinkId) =>
  `«${escape(drinks.find((d) => d.id === drinkId)?.name ?? '')}» — ${displayName(users.find((u) => u.id === userId) ?? { nick: '' })}`;

function openRatingEditor(userId, drinkId) {
  const cur = ratings.find((r) => r.userId === userId && r.drinkId === drinkId);
  if (!cur) return;
  const dialog = openDialog(`
    <h2 class="confirm__title">Изменить оценку</h2>
    <p class="confirm__text muted">${ratingTitle(userId, drinkId)}</p>
    ${rateFormHtml(cur, 'adm-', { actions: '<button class="btn btn--ghost" type="button" id="adm-cancel">Отмена</button>' })}`);
  document.getElementById('adm-cancel').addEventListener('click', () => dialog.close());
  mountRateForm('adm-', cur, async (score, store, price) => {
    await rate(drinkId, score, store, price, userId);
    adminNotice = 'Оценка участника изменена.';
    await reload();
  });
}

function confirmRatingDelete(userId, drinkId) {
  const dialog = openDialog(`
    <h2 class="confirm__title">Удалить оценку?</h2>
    <p class="confirm__text muted">${ratingTitle(userId, drinkId)}. Это нельзя отменить.</p>
    <p id="adm-del-error" class="form__error" role="alert" hidden></p>
    <div class="actions">
      <button class="btn btn--ghost" type="button" id="adm-del-cancel" autofocus>Отмена</button>
      <button class="btn btn--danger" type="button" id="adm-del-confirm">Удалить</button>
    </div>`);
  const err = document.getElementById('adm-del-error');
  document.getElementById('adm-del-cancel').addEventListener('click', () => dialog.close());
  document.getElementById('adm-del-confirm').addEventListener('click', () =>
    busy(dialog, async () => {
      err.hidden = true;
      try {
        await unrate(drinkId, userId);
        adminNotice = 'Оценка участника удалена.';
        await reload();
      } catch (e) {
        showError(err, e);
      }
    }),
  );
}

function bindRatingAdmin() {
  const ids = (b) => [Number(b.dataset.user), Number(b.dataset.drink)];
  app.querySelectorAll('[data-rating-edit]').forEach((b) => b.addEventListener('click', () => openRatingEditor(...ids(b))));
  app.querySelectorAll('[data-rating-delete]').forEach((b) => b.addEventListener('click', () => confirmRatingDelete(...ids(b))));
}

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
  const owner = !!me && (drink.createdBy === me.id || !!me.isAdmin);

  app.innerHTML = `
    <div class="drink-top">
    ${drink.image ? `<div class="drink-bg" aria-hidden="true"><div style="background-image:url('${escape(drink.image)}')"></div></div>` : ''}
    <div class="drink-bar">
      <a class="link back" href="#/">← Все энергетики</a>
      ${
        owner
          ? `<div class="drink-menu">
               <button type="button" class="btn btn--ghost drink-menu__btn" id="owner-menu-btn" aria-label="Действия с энергетиком" aria-haspopup="menu" aria-expanded="false" aria-controls="owner-menu">⋯</button>
               <div class="drink-menu__list" id="owner-menu" role="menu" aria-label="Действия с энергетиком" hidden>
                 <a class="drink-menu__item" role="menuitem" href="#/d/${id}/edit">Редактировать</a>
                 <button class="drink-menu__item" role="menuitem" type="button" id="drink-delete">Удалить энергетик</button>
               </div>
             </div>`
          : ''
      }
    </div>
    <div class="drink-layout">
      <section class="drink-main">
        ${
          drink.image
            ? `<button type="button" class="drink__photo drink__photo--zoom" id="photo-open" aria-label="Открыть фото"><img src="${escape(drink.image)}" alt="${escape(drink.name)}" /></button>`
            : `<div class="drink__photo drink__photo--can">${bigCan(drink)}</div>`
        }
        <div class="drink__text">
        <div class="drink__info">
          <h1 class="drink__name">${escape(drink.name)}</h1>
          <p class="muted drink__brand">${escape(drink.brand)}</p>
          ${
            drink.avgPrice !== null || drink.sugarFree
              ? `<ul class="drink__facts">
                   ${drink.avgPrice !== null ? `<li>Средняя цена ≈ ${formatPrice(drink.avgPrice)} · по ${plural(drink.priceCount, 'цене', 'ценам', 'ценам')}</li>` : ''}
                   ${drink.sugarFree ? '<li><span class="tag">без сахара</span></li>' : ''}
                 </ul>`
              : ''
          }
        </div>
        <div class="drink__rating">
          ${
            drink.votes
              ? `<p class="drink__avg ${scoreClass(drink.avg)}"><strong>${formatScore(drink.avg)}</strong><span>/ 10</span></p>
                 <p class="muted">Средняя оценка · ${votesLabel(drink.votes)}</p>`
              : `<p class="drink__rating-empty">Ещё нет оценок</p>
                 ${me ? '<p class="muted">Будьте первым — поставьте оценку в блоке «Моя оценка».</p>' : ''}`
          }
        </div>
        </div>
      </section>

      <section class="drink-aside rate" id="my-rating" aria-labelledby="my-rating-title">
        <h2 class="block__title" id="my-rating-title">Моя оценка</h2>
        ${takeNotice()}
        ${
          me
            ? rateFormHtml(mine, '', {
                actions: mine ? '<button class="btn btn--ghost" type="button" id="rate-delete">Удалить оценку</button>' : '',
              })
            : `<div class="rate__guest">
                 <p class="muted">Оценки могут ставить только вошедшие пользователи.</p>
                 <a class="btn btn--primary" href="#/login">Войдите, чтобы оценить</a>
               </div>`
        }
      </section>

      <section class="drink-all">
        <h2 class="block__title">Все оценки · ${all.length}</h2>
        ${takeAdminNotice()}
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
                    ${ratingAdminHtml(r)}
                  </li>`,
                  )
                  .join('')}
              </ol>`
            : `<div class="empty-state">
                 <p class="empty-state__title">Пока никто не оценил</p>
                 <p class="empty-state__text">Оценки участников появятся здесь.</p>
               </div>`
        }
      </section>
    </div>
    </div>
    ${
      owner
        ? `<dialog class="confirm" id="delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-text">
             <h2 class="confirm__title" id="delete-title">Удалить «${escape(drink.name)}»?</h2>
             <p class="confirm__text muted" id="delete-text">${all.length ? `Вместе с ним ${all.length % 10 === 1 && all.length % 100 !== 11 ? 'удалится' : 'удалятся'} ${votesLabel(all.length)}. ` : ''}Это нельзя отменить.</p>
             <p id="delete-error" class="form__error" role="alert" hidden></p>
             <div class="actions">
               <button class="btn btn--ghost" type="button" id="delete-cancel" autofocus>Отмена</button>
               <button class="btn btn--danger" type="button" id="delete-confirm">Удалить</button>
             </div>
           </dialog>`
        : ''
    }`;

  document.getElementById('photo-open')?.addEventListener('click', (e) => openLightbox(drink.image, drink.name, e.currentTarget));

  // Меню «⋯»: закрывается по Esc (фокус возвращается на кнопку), клику вне и смене маршрута.
  const menuBtn = document.getElementById('owner-menu-btn');
  const menu = document.getElementById('owner-menu');
  if (menuBtn) {
    const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
    const closeMenu = (refocus) => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onMenuKey);
      window.removeEventListener('hashchange', onHash);
      menu.hidden = true;
      menuBtn.setAttribute('aria-expanded', 'false');
      if (refocus) menuBtn.focus();
    };
    const onHash = () => closeMenu(false);
    const onDocClick = (e) => {
      if (!menuBtn.isConnected || (!menu.contains(e.target) && !menuBtn.contains(e.target))) closeMenu(false);
    };
    const onMenuKey = (e) => {
      if (e.key === 'Escape') closeMenu(true);
      else if (e.key === 'Tab') closeMenu(false);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items();
        const i = list.indexOf(document.activeElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
      }
    };
    menuBtn.addEventListener('click', () => {
      if (!menu.hidden) return closeMenu(true);
      menu.hidden = false;
      menuBtn.setAttribute('aria-expanded', 'true');
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onMenuKey);
      window.addEventListener('hashchange', onHash);
      items()[0].focus();
    });

    // Удаление энергетика: подтверждение в нативном <dialog>.
    const dialog = document.getElementById('delete-dialog');
    const delError = document.getElementById('delete-error');
    const confirmBtn = document.getElementById('delete-confirm');
    document.getElementById('drink-delete').addEventListener('click', () => {
      closeMenu(false);
      delError.hidden = true;
      dialog.showModal();
      document.getElementById('delete-cancel').focus();
    });
    document.getElementById('delete-cancel').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      if (menuBtn.isConnected) menuBtn.focus();
    });
    confirmBtn.addEventListener('click', async () => {
      delError.hidden = true;
      confirmBtn.setAttribute('aria-busy', 'true');
      await busy(dialog, async () => {
        try {
          await deleteDrink(id);
          ({ drinks, users, ratings } = await loadData());
          location.hash = '#/';
        } catch (err) {
          showError(delError, err);
        }
      });
      confirmBtn.removeAttribute('aria-busy');
    });
  }

  if (document.getElementById('rate-form')) {
    const error = document.getElementById('rate-error');
    // После сохранения страница перерисовывается: возвращаем прокрутку и фокус, чтобы ничего не прыгало.
    const rerender = async (focusId) => {
      const y = window.scrollY;
      await reload();
      window.scrollTo(0, y);
      document.getElementById(focusId)?.focus({ preventScroll: true });
    };
    mountRateForm('', mine, async (score, store, price) => {
      await rate(id, score, store, price);
      notice = 'Оценка сохранена.';
      await rerender('rate-submit');
    });
    const form = document.getElementById('rate-form');
    const delBtn = document.getElementById('rate-delete');
    delBtn?.addEventListener('click', async () => {
      error.hidden = true;
      delBtn.setAttribute('aria-busy', 'true');
      await busy(form, async () => {
        try {
          await unrate(id);
          notice = 'Оценка удалена.';
          await rerender('score');
        } catch (err) {
          showError(error, err);
        }
      });
      delBtn.removeAttribute('aria-busy');
    });
  }
  bindRatingAdmin();
}

// Просмотр фото целиком. Закрывается по подложке, крестику, Esc и смене маршрута.
function openLightbox(src, name, opener) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', name);
  box.innerHTML = `<img src="${escape(src)}" alt="${escape(name)}" /><button type="button" class="lightbox__close" aria-label="Закрыть">×</button>`;
  const close = () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    document.body.classList.remove('no-scroll');
    box.remove();
    if (opener.isConnected) opener.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab') {
      e.preventDefault();
      box.querySelector('.lightbox__close').focus();
    }
  };
  box.addEventListener('click', (e) => {
    if (e.target !== box.querySelector('img')) close();
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close);
  document.body.classList.add('no-scroll');
  document.body.append(box);
  box.querySelector('.lightbox__close').focus();
}

// ---------- Добавление и правка энергетика ----------

const CAN_COLORS = ['#1e3a8a', '#166534', '#b91c1c', '#7c2d12', '#ca8a04', '#4c1d95', '#111827', '#9ca3af', '#0e7490', '#be185d'];
const CAN_COLOR_NAMES = {
  '#1e3a8a': 'Синий', '#166534': 'Зелёный', '#b91c1c': 'Красный', '#7c2d12': 'Коричневый', '#ca8a04': 'Жёлтый',
  '#4c1d95': 'Фиолетовый', '#111827': 'Чёрный', '#9ca3af': 'Серебристый', '#0e7490': 'Бирюзовый', '#be185d': 'Розовый',
};

// Светлота цвета (0..1): на светлых плашках галочка тёмная, на тёмных — белая.
function isLightColor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.28;
}

const CHECK_ICON =
  '<svg class="swatch__check" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PHOTO_ICON =
  '<svg class="uploader__icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"><path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';

const MAX_SOURCE_PHOTO = 25 * 1024 * 1024;

// Загрузчик фото: скрытый input[type=file] + собственный интерфейс (кнопки открывают выбор файла).
function uploaderHtml({ id, compact = false }) {
  return `<div class="uploader${compact ? ' uploader--compact' : ''}" id="${id}-uploader">
    <input id="${id}" class="visually-hidden" type="file" accept="image/*" tabindex="-1" aria-describedby="${id}-error" />
    <div class="uploader__stage"></div>
    <p class="field__error" id="${id}-error" role="alert" hidden></p>
  </div>`;
}

// Состояния: пусто / обработка / выбран новый файл / текущее фото (при правке) / текущее фото помечено к удалению.
// Готовый (уже уменьшенный) blob хранится в `blob` и отправляется как есть — повторно не сжимается.
function mountUploader(id, { existing = null, compact = false, prepare, title, hint, onChange }) {
  const box = document.getElementById(`${id}-uploader`);
  const input = document.getElementById(id);
  const stage = box.querySelector('.uploader__stage');
  const errorEl = document.getElementById(`${id}-error`);
  let removed = false;
  let picked = null; // { blob, url }
  let working = false;
  let token = 0;

  const hasPhoto = () => !!picked || (!!existing && !removed);
  const setError = (message) => {
    if (message) showError(errorEl, { message });
    else errorEl.hidden = true;
  };
  const freePicked = () => {
    if (picked) URL.revokeObjectURL(picked.url);
    picked = null;
  };

  function render(focus = false) {
    let html;
    if (working) {
      html = `<div class="uploader__drop uploader__drop--busy" role="status">${PHOTO_ICON}<span>Обрабатываем фото…</span></div>`;
    } else if (hasPhoto()) {
      const src = picked ? picked.url : escape(existing);
      html = `<div class="uploader__preview"><img src="${src}" alt="${picked ? 'Выбранное фото' : 'Текущее фото'}" /></div>
        <div class="uploader__actions">
          <button class="btn btn--sm" type="button" data-act="pick">Заменить</button>
          <button class="btn btn--ghost btn--sm" type="button" data-act="${picked ? 'drop' : 'remove'}">${picked ? 'Убрать' : 'Удалить фото'}</button>
        </div>`;
    } else {
      html = `<button class="uploader__drop" type="button" data-act="pick">
          ${PHOTO_ICON}<strong>${title}</strong><span class="uploader__hint">${hint}</span>
        </button>
        ${existing && removed ? '<p class="uploader__note">Текущее фото будет удалено при сохранении. <button class="uploader__undo" type="button" data-act="undo">Отменить</button></p>' : ''}`;
    }
    stage.innerHTML = html;
    if (focus) stage.querySelector('[data-act]')?.focus();
  }

  stage.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'pick') return input.click();
    setError('');
    if (act === 'drop') freePicked();
    if (act === 'remove') removed = true;
    if (act === 'undo') removed = false;
    render(true);
    onChange?.();
  });

  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = ''; // тот же файл можно выбрать повторно
    if (!file) return;
    setError('');
    if (file.type && !file.type.startsWith('image/')) return setError('Это не изображение. Выберите JPEG, PNG или WebP.');
    if (file.size > MAX_SOURCE_PHOTO) return setError('Файл слишком большой (больше 25 МБ).');
    const mine = ++token;
    working = true;
    render();
    onChange?.();
    try {
      const blob = await prepare(file);
      if (mine !== token) return;
      freePicked();
      picked = { blob, url: URL.createObjectURL(blob) };
    } catch (err) {
      if (mine !== token) return;
      setError(err?.message || 'Не удалось обработать фото. Выберите другое.');
    } finally {
      if (mine === token) {
        working = false;
        render(true);
        onChange?.();
      }
    }
  });

  const destroy = () => {
    token++;
    freePicked();
  };
  window.addEventListener('hashchange', destroy, { once: true });
  render();

  return {
    get blob() { return picked?.blob ?? null; },
    get removed() { return !!existing && removed && !picked; },
    get hasPhoto() { return hasPhoto(); },
    get working() { return working; },
    setError,
    destroy,
  };
}

// drink === null — добавление, иначе правка существующего (только автор).
function renderDrinkForm(drink) {
  const me = currentUser();
  const editing = !!drink;
  if (editing && drink.createdBy !== me.id && !me.isAdmin) {
    app.innerHTML = `
      <section class="hero">
        <h1>Нет доступа</h1>
        <p class="muted">Править энергетик может только тот, кто его добавил, или администратор.</p>
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
      ${field({ id: 'brand', label: 'Бренд', autocomplete: 'off', extra: `maxlength="40" required list="brands" value="${escape(drink?.brand ?? '')}"` })}
      <datalist id="brands">${brands.map((b) => `<option value="${escape(b)}"></option>`).join('')}</datalist>
      <label class="check">
        <input type="checkbox" name="sugarFree" ${drink?.sugarFree ? 'checked' : ''} />
        <span>Без сахара</span>
      </label>
      <div class="field" role="group" aria-labelledby="photo-label">
        <span class="field__label" id="photo-label">Фото (необязательно)</span>
        ${uploaderHtml({ id: 'photo' })}
      </div>
      <fieldset class="swatches">
        <legend class="field__label">Цвет банки: <span id="color-name">${CAN_COLOR_NAMES[color] ?? ''}</span></legend>
        <div class="swatches__row">
          ${CAN_COLORS.map(
            (c) => `<label class="swatch${isLightColor(c) ? ' swatch--light' : ''}" style="--c:${c}" title="${CAN_COLOR_NAMES[c]}">
              <input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''} aria-label="${CAN_COLOR_NAMES[c]}" />
              <span class="swatch__face">${CHECK_ICON}</span>
            </label>`,
          ).join('')}
        </div>
        <small class="field__hint muted" id="color-hint" hidden>Цвет используется только если у энергетика нет фото.</small>
      </fieldset>
      <p id="form-error" class="form__error" role="alert" hidden></p>
      <button class="btn btn--primary" type="submit">${editing ? 'Сохранить' : 'Добавить энергетик'}</button>
    </form></div>`;

  const form = document.getElementById('drink-form');
  const error = document.getElementById('form-error');
  const submitBtn = form.querySelector('button[type="submit"]');
  const colorHint = document.getElementById('color-hint');
  const syncColorHint = () => (colorHint.hidden = !photoUp.hasPhoto);
  // Фото уменьшается сразу при выборе; готовый blob уходит на сервер как есть.
  const photoUp = mountUploader('photo', {
    existing: drink?.image || null,
    prepare: prepareDrinkPhoto,
    title: 'Выбрать фото',
    hint: 'JPEG, PNG или WebP. Фото уменьшится на устройстве; геометки не отправляются.',
    onChange: syncColorHint,
  });
  syncColorHint();

  clearErrorsOnInput(form);
  form.addEventListener('change', (e) => {
    if (e.target.name === 'color') document.getElementById('color-name').textContent = CAN_COLOR_NAMES[e.target.value] ?? '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    form.querySelectorAll('.input').forEach(clearFieldError);
    const data = new FormData(form);
    const body = {
      name: String(data.get('name')).trim(),
      brand: String(data.get('brand')).trim(),
      sugarFree: data.has('sugarFree'),
      color: String(data.get('color')),
    };
    const problems = [];
    if (!body.name || body.name.length > 60) problems.push(['name', 'Название обязательно, не длиннее 60 символов.']);
    if (!body.brand || body.brand.length > 40) problems.push(['brand', 'Бренд обязателен, не длиннее 40 символов.']);
    if (problems.length) {
      problems.forEach(([f, message]) => setFieldError(document.getElementById(f), { message }));
      return document.getElementById(problems[0][0]).focus();
    }
    if (photoUp.working) return photoUp.setError('Фото ещё обрабатывается, подождите секунду.');

    setSaving(submitBtn, true);
    await busy(form, async () => {
      try {
        const blob = photoUp.blob;

        const id = editing ? drink.id : (await createDrink(body)).id;
        if (editing) await updateDrink(id, body);

        let warning = '';
        try {
          if (blob) await uploadDrinkImage(id, blob);
          else if (editing && photoUp.removed) await deleteDrinkImage(id);
        } catch (err) {
          warning = ` Фото не загрузилось: ${err.message}`;
        }
        notice = (editing ? 'Изменения сохранены.' : 'Энергетик добавлен. Теперь можно поставить оценку.') + warning;
        ({ drinks, users, ratings } = await loadData());
        photoUp.destroy();
        scrollToRating = !editing;
        if (location.hash === `#/d/${id}`) route();
        else location.hash = `#/d/${id}`;
      } catch (err) {
        setSaving(submitBtn, false);
        const input = err?.field ? document.getElementById(err.field) : null;
        if (input && form.contains(input) && setFieldError(input, err)) input.focus();
        else showError(error, err);
      }
    });
  });
}

// ---------- Мой профиль ----------

// Свой профиль (#/me) или, для администратора, чужой (#/u/<ник>/edit): nick — ник правимого участника.
function renderMe(nick = null) {
  const self = currentUser();
  const me = nick === null ? users.find((u) => u.id === self.id) || self : users.find((u) => u.nick === nick);
  if (nick !== null && !self.isAdmin) {
    app.innerHTML = `
      <section class="hero">
        <h1>Нет доступа</h1>
        <p><a class="link" href="#/u/${encodeURIComponent(nick)}">← К профилю</a></p>
      </section>`;
    return;
  }
  if (!me) {
    app.innerHTML = `
      <section class="hero">
        <h1>Участник не найден</h1>
        <p><a class="link" href="#/people">← Ко всем участникам</a></p>
      </section>`;
    return;
  }
  // Для чужого профиля запросы идут на админские маршруты.
  const targetId = me.id === self.id ? undefined : me.id;
  app.innerHTML = `<div class="narrow">
    <a class="link back" href="#/u/${encodeURIComponent(me.nick)}">← ${targetId ? `Профиль ${displayName(me)}` : 'Мой профиль'}</a>
    <section class="hero"><h1>${targetId ? `Редактировать профиль: ${displayName(me)}` : 'Редактировать профиль'}</h1></section>
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
        <span class="field__label">Аватарка</span>
        ${uploaderHtml({ id: 'avatar-file', compact: true })}
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
  const avatarSubmit = avatarForm.querySelector('button[type="submit"]');
  avatarSubmit.disabled = true;
  const avatarUp = mountUploader('avatar-file', {
    compact: true,
    prepare: prepareAvatar,
    onChange: () => (avatarSubmit.disabled = !avatarUp.blob),
    title: 'Выбрать фото',
    hint: 'JPEG, PNG или WebP. Фото обрежется до квадрата и уменьшится на устройстве.',
  });
  avatarForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    avatarError.hidden = true;
    if (avatarUp.working) return avatarUp.setError('Фото ещё обрабатывается, подождите секунду.');
    if (!avatarUp.blob) return avatarUp.setError('Сначала выберите фото.');
    setSaving(avatarSubmit, true);
    await busy(avatarForm, async () => {
      try {
        await uploadAvatar(avatarUp.blob, targetId);
        avatarUp.destroy();
        notice = 'Аватарка обновлена.';
        await reload();
      } catch (err) {
        setSaving(avatarSubmit, false);
        showError(avatarError, err);
      }
    });
  });
  document.getElementById('avatar-delete')?.addEventListener('click', () =>
    busy(avatarForm, async () => {
      avatarError.hidden = true;
      try {
        await deleteAvatar(targetId);
        notice = 'Аватарка убрана.';
        await reload();
      } catch (err) {
        showError(avatarError, err);
      }
    }),
  );

  const cityForm = document.getElementById('city-form');
  const cityError = document.getElementById('city-error');
  const citySubmit = cityForm.querySelector('button[type="submit"]');
  clearErrorsOnInput(cityForm);
  cityForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    cityError.hidden = true;
    cityForm.querySelectorAll('.input').forEach(clearFieldError);
    const fd = new FormData(cityForm);
    const name = String(fd.get('name')).trim().replace(/ {2,}/g, ' ');
    const city = String(fd.get('city')).trim();
    const problems = [];
    if ([...name].length > 40 || (name && !/^[\p{L}\p{M}\p{N} .'-]+$/u.test(name)))
      problems.push(['name', 'Имя: до 40 символов — буквы, цифры, пробел, точка, дефис и апостроф.']);
    if (city.length > 60) problems.push(['city', 'Город: не длиннее 60 символов.']);
    if (problems.length) {
      problems.forEach(([f, message]) => setFieldError(document.getElementById(f), { message }));
      return document.getElementById(problems[0][0]).focus();
    }
    setSaving(citySubmit, true);
    await busy(cityForm, async () => {
      try {
        await updateProfile(name, city, targetId);
        notice = 'Профиль сохранён.';
        await reload();
      } catch (err) {
        setSaving(citySubmit, false);
        const input = err?.field ? document.getElementById(err.field) : null;
        if (input && cityForm.contains(input) && setFieldError(input, err)) input.focus();
        else showError(cityError, err);
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
    <input id="${id}" name="${id}" class="input" type="${type}" autocomplete="${autocomplete || 'off'}" aria-describedby="${hint ? `${id}-hint ` : ''}${id}-error" ${extra} />
    ${hint ? `<small class="field__hint muted" id="${id}-hint">${hint}</small>` : ''}
    <p class="field__error" id="${id}-error" role="alert" hidden></p>
  </div>`;

// Ошибка под полем: текст (и ссылка «Открыть его» для дубликата) в .field__error, input получает aria-invalid.
function setFieldError(input, err) {
  const el = document.getElementById(`${input.id}-error`);
  if (!el) return false;
  showError(el, err);
  input.setAttribute('aria-invalid', 'true');
  return true;
}

function clearFieldError(input) {
  input.removeAttribute('aria-invalid');
  const el = document.getElementById(`${input.id}-error`);
  if (el) el.hidden = true;
}

// Ошибка поля снимается, как только пользователь начинает печатать в нём.
function clearErrorsOnInput(form) {
  form.addEventListener('input', (e) => {
    if (e.target.matches?.('.input')) clearFieldError(e.target);
  });
}

// Кнопка отправки на время запроса: aria-busy (спиннер из базы) и текст «Сохраняем…».
function setSaving(btn, on, text = 'Сохраняем…') {
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = text;
    btn.setAttribute('aria-busy', 'true');
  } else {
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.removeAttribute('aria-busy');
  }
}

// Общая логика формы: блокируем кнопку на время отправки, показываем ошибку.
function bindForm(onSubmit) {
  const form = document.getElementById('auth-form');
  const error = document.getElementById('auth-error');
  const submit = form.querySelector('button[type="submit"]');
  clearErrorsOnInput(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    form.querySelectorAll('.input').forEach(clearFieldError);
    submit.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
    } catch (err) {
      const input = err.field ? document.getElementById(err.field) : null;
      if (input && setFieldError(input, err)) {
        input.focus();
      } else {
        error.textContent = err.message || 'Что-то пошло не так. Попробуйте ещё раз.';
        error.hidden = false;
      }
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
    if (!nick.trim() || !password)
      throw { message: nick.trim() ? 'Введите пароль.' : 'Введите ник.', field: nick.trim() ? 'password' : 'nick' };
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
  const profileEdit = hash.match(/^\/u\/([^/]+)\/edit$/);
  const profile = profileEdit ? null : hash.match(/^\/u\/(.+)$/);
  const drinkPage = hash.match(/^\/d\/(\d{1,9})(\/edit)?$/);
  const isAuthPage = hash === '/login' || hash === '/register';
  const needsLogin = hash === '/add' || hash === '/me' || !!profileEdit || !!drinkPage?.[2];
  const tab = hash === '/people' || profile || profileEdit ? 'people' : isAuthPage || hash === '/me' ? null : 'drinks';

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
  else if (profileEdit) renderMe(decodeURIComponent(profileEdit[1]));
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
