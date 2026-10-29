-- Объём и кофеин больше не хранятся. На этих колонках нет индексов, CHECK и внешних ключей,
-- поэтому достаточно ALTER TABLE ... DROP COLUMN: id, created_by, image и уникальный индекс не затрагиваются.
ALTER TABLE drinks DROP COLUMN volume;
ALTER TABLE drinks DROP COLUMN caffeine;
