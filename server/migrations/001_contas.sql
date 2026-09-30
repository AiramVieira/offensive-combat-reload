-- Accounts (plano de autenticação). Identity, credentials and game profile are separate tables: an account
-- can sign in through several providers, and a profile's stats change all the time while the account
-- itself almost never does. IDs are UUIDv7 (time-ordered, no player count leak).

CREATE EXTENSION IF NOT EXISTS citext;

-- The person: stable, rarely updated.
CREATE TABLE account (
    id                     uuid PRIMARY KEY DEFAULT uuidv7(),
    email                  citext UNIQUE,                 -- null for Discord-only accounts
    email_verified_at      timestamptz,                   -- set by the first password-reset link used
    status                 text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'suspended', 'pending_deletion', 'deleted')),
    locale                 text NOT NULL DEFAULT 'pt-BR',
    region                 text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    deletion_requested_at  timestamptz,                   -- start of the 30-day grace period
    deleted_at             timestamptz
);

-- Local password, kept out of `account` so no query on accounts ever carries the hash.
CREATE TABLE password_credential (
    account_id     uuid PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
    password_hash  text NOT NULL,                         -- Argon2id, parameters inside the hash
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- External identities: many per account, keyed by the provider's immutable id (never the e-mail).
CREATE TABLE auth_identity (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    account_id        uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    provider          text NOT NULL CHECK (provider IN ('discord')),
    provider_subject  text NOT NULL,
    linked_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_subject),
    UNIQUE (account_id, provider)
);

-- Browser sessions: an opaque random cookie; only its SHA-256 is stored.
CREATE TABLE session (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    account_id    uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    token_hash    bytea NOT NULL UNIQUE,
    device_label  text,
    ip            inet,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_used_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    revoked_at    timestamptz
);
CREATE INDEX session_account_idx ON session (account_id) WHERE revoked_at IS NULL;

-- Game profile: what other players see. Name#1234 lets names repeat.
CREATE TABLE player_profile (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    account_id       uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    display_name     text NOT NULL,
    discriminator    smallint NOT NULL CHECK (discriminator BETWEEN 1 AND 9999),
    sex              text NOT NULL DEFAULT 'm' CHECK (sex IN ('m', 'f')),
    avatar_url       text,
    bio              text,
    name_changed_at  timestamptz,                         -- null = the free first change is still available
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX player_profile_tag_idx ON player_profile (lower(display_name), discriminator);
CREATE INDEX player_profile_account_idx ON player_profile (account_id);

CREATE TABLE display_name_history (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    profile_id     uuid NOT NULL REFERENCES player_profile(id) ON DELETE CASCADE,
    display_name   text NOT NULL,
    discriminator  smallint NOT NULL,
    changed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX display_name_history_profile_idx ON display_name_history (profile_id, changed_at DESC);

-- Hot stats: a narrow row of its own, apart from the profile (every update rewrites the whole row).
CREATE TABLE player_stats (
    profile_id      uuid PRIMARY KEY REFERENCES player_profile(id) ON DELETE CASCADE,
    level           int NOT NULL DEFAULT 1,
    xp              bigint NOT NULL DEFAULT 0,
    mmr             int NOT NULL DEFAULT 1000,             -- unused until ranked play exists
    matches_played  int NOT NULL DEFAULT 0,
    kills           int NOT NULL DEFAULT 0,
    deaths          int NOT NULL DEFAULT 0,
    headshots       int NOT NULL DEFAULT 0,
    groin_kills     int NOT NULL DEFAULT 0,
    knife_kills     int NOT NULL DEFAULT 0,
    backstabs       int NOT NULL DEFAULT 0,
    grenade_kills   int NOT NULL DEFAULT 0,
    humiliations    int NOT NULL DEFAULT 0,
    seconds_played  bigint NOT NULL DEFAULT 0,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Weapon progression: points earned with each weapon and the equipped level.
CREATE TABLE weapon_progress (
    profile_id      uuid NOT NULL REFERENCES player_profile(id) ON DELETE CASCADE,
    weapon          text NOT NULL CHECK (weapon IN ('rifle', 'faca', 'granada')),
    xp              bigint NOT NULL DEFAULT 0,
    equipped_level  int NOT NULL DEFAULT 1,
    PRIMARY KEY (profile_id, weapon)
);

-- One row per stay in an online session (sessions are endless free-for-alls, so this is the "match").
CREATE TABLE session_participation (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    profile_id    uuid NOT NULL REFERENCES player_profile(id) ON DELETE CASCADE,
    session_name  text NOT NULL,
    joined_at     timestamptz NOT NULL DEFAULT now(),
    left_at       timestamptz,
    kills         int NOT NULL DEFAULT 0,
    deaths        int NOT NULL DEFAULT 0,
    score         int NOT NULL DEFAULT 0,
    humiliations  int NOT NULL DEFAULT 0,
    account_xp    int NOT NULL DEFAULT 0
);
CREATE INDEX session_participation_profile_idx ON session_participation (profile_id, joined_at DESC);

-- Punishments as history, never a flag: why, until when, who, repeat offender.
CREATE TABLE sanction (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    type        text NOT NULL CHECK (type IN ('ban', 'chat_mute', 'ranked_ban', 'shadow_ban')),
    reason      text NOT NULL,
    issued_by   uuid,                                     -- staff account, null = system/console
    starts_at   timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz,                              -- null = permanent
    revoked_at  timestamptz
);
CREATE INDEX sanction_account_idx ON sanction (account_id, type);

-- Staff roles, apart from player accounts.
CREATE TABLE role (
    name         text PRIMARY KEY,
    description  text NOT NULL
);
INSERT INTO role (name, description) VALUES
    ('admin', 'Gerencia papéis e aplica qualquer sanção'),
    ('moderador', 'Aplica e revoga sanções');

CREATE TABLE account_role (
    account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    role        text NOT NULL REFERENCES role(name),
    granted_by  uuid,
    granted_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, role)
);

-- Authentication audit, partitioned by month (server/jobs.ts creates the partitions ahead of time; the
-- default partition only catches rows if a month is ever missing).
CREATE TABLE auth_event (
    id          bigint GENERATED ALWAYS AS IDENTITY,
    account_id  uuid,
    type        text NOT NULL,
    detail      text,
    ip          inet,
    user_agent  text,
    created_at  timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);
CREATE TABLE auth_event_default PARTITION OF auth_event DEFAULT;
CREATE INDEX auth_event_account_idx ON auth_event (account_id, created_at DESC);
