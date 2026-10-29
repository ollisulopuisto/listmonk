package core

// Live-PostgreSQL integration tests for the subscriber-filter query
// hardening. They are skipped unless LISTMONK_TEST_PG_URI points at a
// throwaway database, e.g.:
//
//	LISTMONK_TEST_PG_URI="postgres://postgres@localhost:5432/secverify?sslmode=disable" go test ./internal/core/ -run PG -v
//
// The tests only need an empty database; they create and drop their own
// table inside rolled-back transactions where possible.

import (
	"os"
	"testing"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

func pgTestDB(t *testing.T) *sqlx.DB {
	t.Helper()
	dsn := os.Getenv("LISTMONK_TEST_PG_URI")
	if dsn == "" {
		t.Skip("LISTMONK_TEST_PG_URI not set; skipping live PostgreSQL test")
	}
	db, err := sqlx.Connect("postgres", dsn)
	if err != nil {
		t.Fatalf("connecting to test database: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// TestBeginSubQueryTxStatementTimeoutPG proves against a live PostgreSQL
// that beginSubQueryTx applies the per-transaction statement timeout and
// that it actually cancels a long-running filter expression.
func TestBeginSubQueryTxStatementTimeoutPG(t *testing.T) {
	c := &Core{db: pgTestDB(t)}

	tx, err := c.beginSubQueryTx(true)
	if err != nil {
		t.Fatalf("beginSubQueryTx: %v", err)
	}
	defer tx.Rollback()

	var got string
	if err := tx.Get(&got, "SHOW statement_timeout"); err != nil {
		t.Fatalf("SHOW statement_timeout: %v", err)
	}
	if got != subQueryStatementTimeout {
		t.Fatalf("statement_timeout = %q, want %q", got, subQueryStatementTimeout)
	}

	// A filter sleeping longer than the timeout must be cancelled. Use a
	// short override so the test does not take 30s.
	if _, err := tx.Exec("SET LOCAL statement_timeout = '1500ms'"); err != nil {
		t.Fatalf("override timeout: %v", err)
	}
	start := time.Now()
	_, err = tx.Exec("SELECT pg_sleep(60)")
	if err == nil {
		t.Fatal("expected pg_sleep(60) to be cancelled by statement_timeout")
	}
	if elapsed := time.Since(start); elapsed > 10*time.Second {
		t.Fatalf("query took %v; statement_timeout did not bound it", elapsed)
	}
	t.Logf("long query cancelled after %v: %v", time.Since(start).Round(time.Millisecond), err)
}

// TestBeginSubQueryTxReadOnlyPG proves that a read-only sub-query
// transaction rejects writes, so a filter cannot be coerced into a write.
func TestBeginSubQueryTxReadOnlyPG(t *testing.T) {
	c := &Core{db: pgTestDB(t)}

	tx, err := c.beginSubQueryTx(true)
	if err != nil {
		t.Fatalf("beginSubQueryTx: %v", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec("CREATE TABLE rw_probe(id int)"); err == nil {
		t.Fatal("expected DDL to be rejected in read-only transaction")
	}
}

// TestBeginSubQueryTxLegitQueryPG proves an ordinary filter still runs.
func TestBeginSubQueryTxLegitQueryPG(t *testing.T) {
	c := &Core{db: pgTestDB(t)}

	tx, err := c.beginSubQueryTx(true)
	if err != nil {
		t.Fatalf("beginSubQueryTx: %v", err)
	}
	defer tx.Rollback()

	var n int
	if err := tx.Get(&n, "SELECT count(*) FROM (VALUES ('a@example.com'), ('b@other.com')) AS v(email) WHERE lower(v.email) LIKE '%@example.com'"); err != nil {
		t.Fatalf("legit filter query: %v", err)
	}
	if n != 1 {
		t.Fatalf("legit filter returned %d rows, want 1", n)
	}
}
