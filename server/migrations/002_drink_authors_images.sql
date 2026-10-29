-- Кто добавил энергетик (NULL у тестовых и если автор удалён) и файл его фотографии.
ALTER TABLE drinks ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE drinks ADD COLUMN image TEXT;

-- Один и тот же энергетик (название + бренд) не добавляется дважды. lower() в SQLite понимает только
-- латиницу, поэтому сервер дополнительно сравнивает названия без учёта регистра в коде (в т.ч. кириллицу).
CREATE UNIQUE INDEX idx_drinks_name_brand ON drinks(lower(name), lower(brand));
CREATE INDEX idx_drinks_created_by ON drinks(created_by);

-- ratings.updated_at уже есть в 001_init.sql — повторно не добавляем.
