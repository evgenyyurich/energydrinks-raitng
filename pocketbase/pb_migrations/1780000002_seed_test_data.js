/// <reference path="../pb_data/types.d.ts" />
// Тестовые данные (бывший src/data.js). Пароли участников генерируются случайно
// и записываются в pocketbase/.env.local (в git не попадает).

migrate(
  (app) => {
    // pb_data лежит внутри pocketbase/, поэтому корень — на уровень выше dataDir.
    const root = `${app.dataDir()}/..`;

    const drinkRows = [
      ['Red Bull', 'Red Bull', 250, 32, false, '#1e3a8a'],
      ['Monster Energy', 'Monster', 500, 32, false, '#166534'],
      ['Monster Ultra White', 'Monster', 500, 30, true, '#9ca3af'],
      ['Burn Original', 'Burn', 449, 32, false, '#b91c1c'],
      ['Adrenaline Rush', 'Adrenaline', 449, 30, false, '#7c2d12'],
      ['Flash Up Energy', 'Flash Up', 450, 30, false, '#ca8a04'],
      ['Tornado Energy', 'Tornado', 450, 30, false, '#4c1d95'],
      ['Gorilla', 'Gorilla', 450, 30, false, '#111827'],
    ];
    const userRows = [
      ['evgen', 'Москва', 'evgen.svg'],
      ['max', 'Санкт-Петербург', null],
      ['dimon', null, null],
      ['kate', 'Нижний Новгород', 'kate.svg'],
    ];
    // [участник, энергетик, оценка, магазин] — номера с 1, как в старом data.js
    const ratingRows = [
      [1, 1, 9, 'Пятёрочка'], [1, 2, 8, null], [1, 3, 9, 'ВкусВилл'], [1, 4, 7, 'Магнит'],
      [1, 5, 8, null], [1, 6, 6, 'АЗС Лукойл'], [1, 7, 5, null],
      [2, 1, 8, 'Перекрёсток'], [2, 2, 9, null], [2, 3, 10, 'Магнит'], [2, 6, 5, null], [2, 7, 6, 'Пятёрочка'],
      [3, 1, 9, null], [3, 2, 7, 'АЗС Лукойл'], [3, 4, 6, null], [3, 5, 7, 'Магнит'], [3, 6, 7, null],
      [4, 2, 8, 'Пятёрочка'], [4, 3, 8, null], [4, 4, 8, 'ВкусВилл'], [4, 6, 6, null],
    ];

    const drinksCol = app.findCollectionByNameOrId('drinks');
    const drinkIds = drinkRows.map(([name, brand, volume, caffeine, sugarFree, color]) => {
      const r = new Record(drinksCol);
      r.set('name', name);
      r.set('brand', brand);
      r.set('volume', volume);
      r.set('caffeine', caffeine);
      r.set('sugarFree', sugarFree);
      r.set('color', color);
      app.save(r);
      return r.id;
    });

    const usersCol = app.findCollectionByNameOrId('users');
    const envLines = [];
    const userIds = userRows.map(([nick, city, avatarFile]) => {
      const password = $security.randomString(24);
      const r = new Record(usersCol);
      r.set('nick', nick);
      if (city) r.set('city', city);
      r.setPassword(password);
      if (avatarFile) r.set('avatar', $filesystem.fileFromPath(`${root}/seed/${avatarFile}`));
      app.save(r);
      envLines.push(`SEED_PASSWORD_${nick.toUpperCase()}=${password}`);
      return r.id;
    });

    const ratingsCol = app.findCollectionByNameOrId('ratings');
    ratingRows.forEach(([u, d, score, store]) => {
      const r = new Record(ratingsCol);
      r.set('user', userIds[u - 1]);
      r.set('drink', drinkIds[d - 1]);
      r.set('score', score);
      if (store) r.set('store', store);
      app.save(r);
    });

    // Пароли -> pocketbase/.env.local (старые SEED_PASSWORD_* заменяем).
    const envPath = `${root}/.env.local`;
    let kept = [];
    try {
      kept = toString($os.readFile(envPath))
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.startsWith('SEED_PASSWORD_'));
    } catch (_) {}
    $os.writeFile(envPath, [...kept, ...envLines].join('\n') + '\n', 0o600);
  },
  (app) => {
    app.truncateCollection(app.findCollectionByNameOrId('ratings'));
    app.truncateCollection(app.findCollectionByNameOrId('drinks'));
    app.findAllRecords('users').forEach((r) => app.delete(r));
  },
);
