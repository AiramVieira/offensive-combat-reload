-- Rollback of 001_contas.sql (run by hand: psql -f server/migrations/001_contas.down.sql).
DROP TABLE IF EXISTS auth_event;
DROP TABLE IF EXISTS account_role;
DROP TABLE IF EXISTS role;
DROP TABLE IF EXISTS sanction;
DROP TABLE IF EXISTS session_participation;
DROP TABLE IF EXISTS weapon_progress;
DROP TABLE IF EXISTS player_stats;
DROP TABLE IF EXISTS display_name_history;
DROP TABLE IF EXISTS player_profile;
DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS auth_identity;
DROP TABLE IF EXISTS password_credential;
DROP TABLE IF EXISTS account;
DELETE FROM schema_migrations WHERE name = '001_contas.sql';
DROP EXTENSION IF EXISTS citext;
