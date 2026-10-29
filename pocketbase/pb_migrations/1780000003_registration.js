/// <reference path="../pb_data/types.d.ts" />
// Регистрация по нику и паролю: открываем createRule, пароль от 8 символов,
// ограничение частоты запросов на вход и регистрацию.
// Регистрация открыта всем, поэтому лимитер важен.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    // Создавать запись может любой гость (без кода приглашения), но нельзя самому выставить verified.
    // (emailVisibility и email безвредны: список по-прежнему не отдаёт чужой email.)
    users.createRule = '@request.body.verified:isset = false';
    users.fields.getByName('password').min = 8;
    app.save(users);

    // Встроенный лимитер: метки "<коллекция>:<действие>" из документации PocketBase.
    const settings = app.settings();
    settings.rateLimits.enabled = true;
    const ours = ['users:authWithPassword', 'users:create'];
    settings.rateLimits.rules = [
      ...settings.rateLimits.rules.filter((r) => !ours.includes(r.label)),
      { label: 'users:authWithPassword', audience: '', duration: 60, maxRequests: 10 },
      { label: 'users:create', audience: '', duration: 60, maxRequests: 5 },
    ];
    app.save(settings);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.createRule = null;
    users.fields.getByName('password').min = 8; // у PocketBase по умолчанию тоже 8
    app.save(users);

    const settings = app.settings();
    settings.rateLimits.rules = settings.rateLimits.rules.filter(
      (r) => r.label !== 'users:authWithPassword' && r.label !== 'users:create',
    );
    app.save(settings);
  },
);
