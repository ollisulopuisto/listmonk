package migrations

import (
	"log"

	"github.com/jmoiron/sqlx"
	"github.com/knadh/koanf/v2"
	"github.com/knadh/stuffbin"
)

// V6_5_0 backfills statements that upstream added to its v6.2.0 migration
// *after* this fork had already shipped v6.3.0 and v6.4.0.
//
// Migrations only run when their version is greater than the version recorded
// in the DB (see cmd/upgrade.go), so a fork database sitting at v6.4.0 would
// never execute the amended v6.2.0 body. These statements are repeated here so
// they actually reach such databases. They are the same statements as in
// v6.2.0 and are idempotent, so running both is harmless.
func V6_5_0(db *sqlx.DB, fs stuffbin.FileSystem, ko *koanf.Koanf, lo *log.Logger) error {
	// Backfill `from_addresses` on SMTP server entries (per-domain SMTP routing).
	// Fork DBs got `msg_retry_delay` from the original v6.2.0 but not this key.
	if _, err := db.Exec(`
		UPDATE settings
		SET value = (
			SELECT JSONB_AGG(
				JSONB_SET(
					JSONB_SET(
						v,
						'{msg_retry_delay}',
						COALESCE(v->'msg_retry_delay', '"10ms"'::JSONB)
					),
					'{from_addresses}',
					COALESCE(v->'from_addresses', '[]'::JSONB)
				)
				ORDER BY ord
			)
			FROM JSONB_ARRAY_ELEMENTS(value) WITH ORDINALITY AS t(v, ord)
		)
		WHERE key = 'smtp'
		AND EXISTS (
			SELECT 1 FROM JSONB_ARRAY_ELEMENTS(value) AS v
			WHERE NOT (v ? 'msg_retry_delay') OR NOT (v ? 'from_addresses')
		);
	`); err != nil {
		return err
	}

	// Hash existing plaintext API tokens with SHA-256. Idempotent: rows that
	// already look like a lowercase SHA-256 hex digest are skipped. Existing
	// tokens remain valid, as auth hashes the presented token before comparing.
	if _, err := db.Exec(`
		UPDATE users
		SET password = ENCODE(DIGEST(password, 'sha256'), 'hex')
		WHERE type = 'api'
			AND password IS NOT NULL
			AND password != ''
			AND password !~ '^[a-f0-9]{64}$';
	`); err != nil {
		return err
	}

	return nil
}
