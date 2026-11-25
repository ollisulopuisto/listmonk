package migrations

import (
	"log"

	"github.com/jmoiron/sqlx"
	"github.com/knadh/koanf/v2"
	"github.com/knadh/stuffbin"
)

// V7_0_2 backfills the upload settings consolidation that was added to the
// v7.0.0 migration body after this fork had already shipped v7.0.0 and
// v7.0.1. A DB at v7.0.1 never reruns v7.0.0, so the dotted upload.s3.* and
// upload.filesystem.* rows (including the S3 credentials) would stay unmigrated
// while the code reads the new upload.s3 / upload.filesystem maps. The statements
// are the same as in v7.0.0 and are idempotent: existing map values win.
func V7_0_2(db *sqlx.DB, fs stuffbin.FileSystem, ko *koanf.Koanf, lo *log.Logger) error {
	_, err := db.Exec(`
        INSERT INTO settings (key, value)
        SELECT 'upload.filesystem', '{"upload_path": "uploads", "upload_uri": "/uploads"}'::JSONB ||
            COALESCE(JSONB_OBJECT_AGG(SUBSTR(key, 19), value), '{}'::JSONB)
        FROM settings WHERE key LIKE 'upload.filesystem.%'
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value || settings.value;

        DELETE FROM settings WHERE key LIKE 'upload.filesystem.%';

        INSERT INTO settings (key, value)
        SELECT 'upload.s3', '{"url": "https://ap-south-1.s3.amazonaws.com", "public_url": "", "aws_access_key_id": "", "aws_secret_access_key": "", "aws_default_region": "ap-south-1", "bucket": "", "bucket_domain": "", "bucket_path": "/", "bucket_type": "public", "expiry": "167h"}'::JSONB ||
            COALESCE(JSONB_OBJECT_AGG(SUBSTR(key, 11), value), '{}'::JSONB)
        FROM settings WHERE key LIKE 'upload.s3.%'
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value || settings.value;

        DELETE FROM settings WHERE key LIKE 'upload.s3.%';

        INSERT INTO settings (key, value) VALUES ('upload.max_file_size', '25000')
        ON CONFLICT (key) DO NOTHING;
	`)
	return err
}
