-- Rollback of 002_aparencia.sql (run by hand).
ALTER TABLE player_profile DROP COLUMN IF EXISTS appearance;
DELETE FROM schema_migrations WHERE name = '002_aparencia.sql';
