-- Character customization (plano de customização): the look lives on the game profile as JSON, validated
-- by shared/appearance.ts on every read and write. NULL = the default look for the profile's body type.
ALTER TABLE player_profile ADD COLUMN appearance jsonb;
