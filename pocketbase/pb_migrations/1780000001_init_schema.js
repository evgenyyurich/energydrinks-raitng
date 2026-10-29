/// <reference path="../pb_data/types.d.ts" />
// Схема: users (расширение встроенной auth-коллекции), drinks, ratings.

migrate(
  (app) => {
    // ---------- users ----------
    const users = app.findCollectionByNameOrId('users');

    // Вход по нику + паролю, email необязателен.
    users.fields.removeByName('name');
    users.fields.getByName('email').required = false;

    users.fields.add(
      new Field({
        type: 'text',
        name: 'nick',
        required: true,
        min: 3,
        max: 24,
        pattern: '^[A-Za-z0-9_]+$',
      }),
    );
    users.fields.add(new Field({ type: 'text', name: 'city', required: false, max: 100 }));

    // Заменяем стандартное поле avatar на своё: одна картинка до ~2 МБ.
    users.fields.removeByName('avatar');
    users.fields.add(
      new Field({
        type: 'file',
        name: 'avatar',
        required: false,
        maxSelect: 1,
        maxSize: 2 * 1024 * 1024,
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
        thumbs: ['100x100'],
      }),
    );

    users.indexes = [...(users.indexes || []), 'CREATE UNIQUE INDEX `idx_users_nick` ON `users` (`nick`)'];
    users.passwordAuth.enabled = true;
    users.passwordAuth.identityFields = ['nick'];

    // Список и профиль публичны (email скрыт, т.к. emailVisibility=false по умолчанию).
    users.listRule = '';
    users.viewRule = '';
    users.createRule = null; // регистрация появится в следующей версии
    users.updateRule = 'id = @request.auth.id';
    users.deleteRule = null;
    app.save(users);

    // ---------- drinks ----------
    const drinks = new Collection({
      type: 'base',
      name: 'drinks',
      listRule: '',
      viewRule: '',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'name', required: true },
        { type: 'text', name: 'brand', required: true },
        { type: 'number', name: 'volume' },
        { type: 'number', name: 'caffeine' },
        { type: 'bool', name: 'sugarFree' },
        { type: 'text', name: 'color', pattern: '^#[0-9a-fA-F]{6}$' },
      ],
    });
    app.save(drinks);

    // ---------- ratings ----------
    const ratings = new Collection({
      type: 'base',
      name: 'ratings',
      listRule: '',
      viewRule: '',
      createRule: '@request.auth.id != "" && @request.body.user = @request.auth.id',
      updateRule: '@request.auth.id = user && (@request.body.user:isset = false || @request.body.user = @request.auth.id)',
      deleteRule: '@request.auth.id = user',
      fields: [
        { type: 'relation', name: 'user', required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        { type: 'relation', name: 'drink', required: true, collectionId: drinks.id, maxSelect: 1, cascadeDelete: true },
        { type: 'number', name: 'score', required: true, min: 1, max: 10, onlyInt: true },
        { type: 'text', name: 'store', required: false, max: 100 },
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_ratings_user_drink` ON `ratings` (`user`, `drink`)'],
    });
    app.save(ratings);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('ratings'));
    app.delete(app.findCollectionByNameOrId('drinks'));
    const users = app.findCollectionByNameOrId('users');
    users.indexes = users.indexes.filter((i) => !i.includes('idx_users_nick'));
    users.fields.removeByName('nick');
    users.fields.removeByName('city');
    app.save(users);
  },
);
