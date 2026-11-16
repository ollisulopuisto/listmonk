package migrations

import (
	"log"

	"github.com/jmoiron/sqlx"
	"github.com/knadh/koanf/v2"
	"github.com/knadh/stuffbin"
)

// V7_0_1 backfills statements that upstream added to its v7.0.0 migration
// *after* this fork had already shipped v7.0.0.
//
// Migrations only run when their version is greater than the version recorded
// in the DB (see cmd/upgrade.go), so a fork database already at v7.0.0 never
// executes the amended v7.0.0 body, and the new code then fails on the missing
// media.tags column and OIDC settings keys. The statements are the same as in
// v7.0.0 and are idempotent, so running both is harmless. Same approach as V6_5_0.
func V7_0_1(db *sqlx.DB, fs stuffbin.FileSystem, ko *koanf.Koanf, lo *log.Logger) error {
	if _, err := db.Exec(`
		-- Preserve the existing OIDC redirect URL.
		UPDATE settings SET value = JSONB_SET(value, '{redirect_url}', (
			SELECT TO_JSONB(RTRIM(value#>>'{}', '/') || '/auth/oidc')
			FROM settings WHERE key = 'app.root_url'
		))
		WHERE key = 'security.oidc' AND NOT (value ? 'redirect_url');

		-- OIDC role sync on login.
		UPDATE settings SET value = JSONB_SET(value, '{auto_sync_roles}', 'false'::JSONB)
		WHERE key = 'security.oidc' AND NOT (value ? 'auto_sync_roles');
	`); err != nil {
		return err
	}

	// Media tags field.
	if _, err := db.Exec(`
		ALTER TABLE media ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
		CREATE INDEX IF NOT EXISTS idx_media_tags ON media USING GIN(tags);
	`); err != nil {
		return err
	}

	return nil
}
