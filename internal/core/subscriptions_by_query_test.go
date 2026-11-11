package core

// Regression tests for the PR #46 review finding: replacing
// compileSubscriberQueryTpl with querySubscriberIDs dropped
// sanitizeSQLExp from the shared bulk-action helper, so the add, remove
// and unsubscribe by-query subscription actions accepted raw filter
// expressions. A list-restricted subscribers:sql_query user could submit
// `TRUE) OR TRUE --`, break out of the final WHERE condition and act on
// subscribers outside their permitted source lists.
//
// TestSubscriptionByQueryActionsRejectInjection needs no database: the
// shared helper must reject the expression before any DB access, so a nil
// *sqlx.DB proves the rejection happens first.
//
// The PG tests are skipped unless LISTMONK_TEST_PG_URI points at a
// throwaway database, e.g.:
//
//	LISTMONK_TEST_PG_URI="postgres://postgres@localhost:5432/secverify?sslmode=disable" go test ./internal/core/ -run PG -v
//
// They DROP and recreate the subscribers and subscriber_lists tables and
// the subscriber_status / subscription_status types, so the database must
// be disposable.

import (
	"errors"
	"io"

	"log"
	"os"
	"path/filepath"
	"testing"

	"github.com/knadh/goyesql/v2"
	"github.com/knadh/listmonk/internal/i18n"
	"github.com/knadh/listmonk/models"
	"github.com/labstack/echo/v5"
	_ "github.com/lib/pq"
)

func testCoreNoDB(t *testing.T) *Core {
	t.Helper()
	i18nInst, err := i18n.New([]byte(`{"_.code": "en", "_.name": "English", "subscribers.errorPreparingQuery": "Error preparing query: {{ .error }}"}`))
	if err != nil {
		t.Fatalf("initializing i18n: %v", err)
	}
	return &Core{
		i18n: i18nInst,
		log:  log.New(io.Discard, "", 0),
		// Empty templates are fine: rejection must happen before they run.
		q: &models.Queries{},
	}
}

// assertBadRequest fails the test unless err is a 400 echo.HTTPError.
func assertBadRequest(t *testing.T, action, queryExp string, err error) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s accepted malicious expression %q", action, queryExp)
	}
	var he *echo.HTTPError
	if !errors.As(err, &he) || he.Code != 400 {
		t.Fatalf("%s(%q) error = %v, want 400 Bad Request", action, queryExp, err)
	}
}

// TestSubscriptionByQueryActionsRejectInjection drives every bulk by-query
// entry point with expressions that must never reach the database:
// comment-based WHERE breakout, multi-statement input and non-allowlisted
// functions. All five actions share execSubQueryTpl, which now sanitizes
// centrally; a nil database proves rejection happens before any DB access.
func TestSubscriptionByQueryActionsRejectInjection(t *testing.T) {
	c := testCoreNoDB(t)

	bad := []string{
		"TRUE) OR TRUE --",
		// Parenthesis breakout that needs no comment: passes the comment and
		// function checks but must be rejected by the paren-depth validation.
		"FALSE) OR (TRUE",
		"TRUE)) IS TRUE OR ((TRUE",
		// Escape string literal breakout: E'\'' hides its real end from a
		// plain-quote scan, exposing the depth-zero close.
		`name = E'\'' ) OR (TRUE`,
		"TRUE; DROP TABLE subscribers",
		"/* comment */ TRUE",
		"pg_sleep(5)",
		"TRUE OR pg_read_file('/etc/passwd') <> ''",
	}

	for _, q := range bad {
		assertBadRequest(t, "AddSubscriptionsByQuery", q,
			c.AddSubscriptionsByQuery("", q, []int{1}, []int{2}, "confirmed", "", ""))
		assertBadRequest(t, "DeleteSubscriptionsByQuery", q,
			c.DeleteSubscriptionsByQuery("", q, []int{1}, []int{2}, "", ""))
		assertBadRequest(t, "UnsubscribeListsByQuery", q,
			c.UnsubscribeListsByQuery("", q, []int{1}, []int{2}, "", ""))
		assertBadRequest(t, "BlocklistSubscribersByQuery", q,
			c.BlocklistSubscribersByQuery("", q, []int{1}, "", ""))
		assertBadRequest(t, "DeleteSubscribersByQuery", q,
			c.DeleteSubscribersByQuery("", q, []int{1}, "", ""))
	}
}

// prepareSubActionQueries parses the real queries/subscribers.sql (the same
// file the app loads statements from) so the regression exercises the
// shipped SQL rather than a copy.
func prepareSubActionQueries(t *testing.T) *models.Queries {
	t.Helper()

	b, err := os.ReadFile(filepath.Join("..", "..", "queries", "subscribers.sql"))
	if err != nil {
		t.Fatalf("reading queries/subscribers.sql: %v", err)
	}
	qMap, err := goyesql.ParseBytes(b)
	if err != nil {
		t.Fatalf("parsing queries/subscribers.sql: %v", err)
	}

	get := func(name string) string {
		q, ok := qMap[name]
		if !ok {
			t.Fatalf("query %q not found in queries/subscribers.sql", name)
		}
		return q.Query
	}
	return &models.Queries{
		QuerySubscribersTpl:                    get("query-subscribers-template"),
		AddSubscribersToListsByQuery:           get("add-subscribers-to-lists-by-query"),
		DeleteSubscriptionsByQuery:             get("delete-subscriptions-by-query"),
		UnsubscribeSubscribersFromListsByQuery: get("unsubscribe-subscribers-from-lists-by-query"),
		BlocklistSubscribersByQuery:            get("blocklist-subscribers-by-query"),
		DeleteSubscribersByQuery:               get("delete-subscribers-by-query"),
	}
}

// seedSubActions recreates a minimal subscribers/subscriber_lists schema
// (throwaway database only) with subscriber 1 subscribed to list 1 and
// subscriber 2 subscribed to list 2.
func seedSubActions(t *testing.T, c *Core) {
	t.Helper()

	stmts := []string{
		`DROP TABLE IF EXISTS subscriber_lists`,
		`DROP TABLE IF EXISTS subscribers`,
		`DROP TYPE IF EXISTS subscription_status`,
		`DROP TYPE IF EXISTS subscriber_status`,
		`CREATE TYPE subscriber_status AS ENUM ('enabled', 'disabled', 'blocklisted')`,
		`CREATE TYPE subscription_status AS ENUM ('unconfirmed', 'confirmed', 'unsubscribed')`,
		`CREATE TABLE subscribers (
			id         SERIAL PRIMARY KEY,
			uuid       uuid NOT NULL UNIQUE,
			email      TEXT NOT NULL,
			name       TEXT NOT NULL DEFAULT '',
			status     subscriber_status NOT NULL DEFAULT 'enabled',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW())`,
		`CREATE TABLE subscriber_lists (
			subscriber_id INT NOT NULL,
			list_id       INT NOT NULL,
			status        subscription_status NOT NULL DEFAULT 'unconfirmed',
			created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			PRIMARY KEY (subscriber_id, list_id))`,
		`INSERT INTO subscribers (id, uuid, email, name) VALUES
			(1, '00000000-0000-0000-0000-0000000000b1', 'one@example.com', 'One'),
			(2, '00000000-0000-0000-0000-0000000000b2', 'two@example.com', 'Two')`,
		`INSERT INTO subscriber_lists (subscriber_id, list_id, status) VALUES
			(1, 1, 'confirmed'),
			(2, 2, 'confirmed')`,
	}
	for _, st := range stmts {
		if _, err := c.db.Exec(st); err != nil {
			t.Fatalf("seeding schema: %v\nstatement: %s", err, st)
		}
	}
	t.Cleanup(func() {
		if _, err := c.db.Exec(`DROP TABLE IF EXISTS subscriber_lists`); err != nil {
			t.Logf("dropping subscriber_lists: %v", err)
		}
		if _, err := c.db.Exec(`DROP TABLE IF EXISTS subscribers`); err != nil {
			t.Logf("dropping subscribers: %v", err)
		}
	})
}

func subListRows(t *testing.T, c *Core) map[[2]int]string {
	t.Helper()
	rows, err := c.db.Query(`SELECT subscriber_id, list_id, status::text FROM subscriber_lists ORDER BY subscriber_id, list_id`)
	if err != nil {
		t.Fatalf("reading subscriber_lists: %v", err)
	}
	defer rows.Close()

	out := map[[2]int]string{}
	for rows.Next() {
		var sid, lid int
		var status string
		if err := rows.Scan(&sid, &lid, &status); err != nil {
			t.Fatalf("scanning subscriber_lists: %v", err)
		}
		out[[2]int{sid, lid}] = status
	}
	return out
}

// TestSubscriptionByQueryActionsSourceListBoundaryPG proves against a live
// PostgreSQL that a legitimate filter scoped to a permitted source list
// only acts on that list's subscribers, and that the reviewer's injected
// expression is rejected with no side effects. Pre-fix, `TRUE) OR TRUE --`
// selected subscriber 2 (list 2) through the same entry points.
func TestSubscriptionByQueryActionsSourceListBoundaryPG(t *testing.T) {
	c := testCoreNoDB(t)
	c.db = pgTestDB(t).Unsafe()
	c.q = prepareSubActionQueries(t)
	seedSubActions(t, c)

	// Legitimate add, scoped to source list 1: only subscriber 1 may gain
	// a subscription to target list 3.
	if err := c.AddSubscriptionsByQuery("", "TRUE", []int{1}, []int{3}, "confirmed", "", ""); err != nil {
		t.Fatalf("legit AddSubscriptionsByQuery: %v", err)
	}
	rows := subListRows(t, c)
	if rows[[2]int{1, 3}] != "confirmed" {
		t.Fatalf("subscriber 1 was not added to list 3: %v", rows)
	}
	if _, ok := rows[[2]int{2, 3}]; ok {
		t.Fatalf("subscriber 2 (outside permitted source list 1) was added to list 3: %v", rows)
	}

	// The injected expression from the finding must be rejected by every
	// action and leave the tables untouched.
	// The reviewer's payload relies on `--` commenting out the closing
	// parenthesis; "FALSE) OR (TRUE" needs no comment and breaks out of the
	// AND group on the goyesql-collapsed single-line statement form. Both
	// must be rejected with no side effects.
	injected := []string{"TRUE) OR TRUE --", "FALSE) OR (TRUE", `name = E'\'' ) OR (TRUE`}
	before := subListRows(t, c)

	for _, inj := range injected {
		assertBadRequest(t, "AddSubscriptionsByQuery", inj,
			c.AddSubscriptionsByQuery("", inj, []int{1}, []int{4}, "confirmed", "", ""))
		assertBadRequest(t, "DeleteSubscriptionsByQuery", inj,
			c.DeleteSubscriptionsByQuery("", inj, []int{1}, []int{1}, "", ""))
		assertBadRequest(t, "UnsubscribeListsByQuery", inj,
			c.UnsubscribeListsByQuery("", inj, []int{1}, []int{1}, "", ""))
		assertBadRequest(t, "BlocklistSubscribersByQuery", inj,
			c.BlocklistSubscribersByQuery("", inj, []int{1}, "", ""))
		assertBadRequest(t, "DeleteSubscribersByQuery", inj,
			c.DeleteSubscribersByQuery("", inj, []int{1}, "", ""))
	}

	after := subListRows(t, c)
	if len(after) != len(before) {
		t.Fatalf("injected expression changed subscriber_lists: before %v, after %v", before, after)
	}
	for k, v := range before {
		if after[k] != v {
			t.Fatalf("injected expression changed %v: %q -> %q", k, v, after[k])
		}
	}
	var n int
	if err := c.db.Get(&n, `SELECT count(*) FROM subscribers`); err != nil {
		t.Fatalf("counting subscribers: %v", err)
	}
	if n != 2 {
		t.Fatalf("subscriber count = %d after rejected delete/blocklist, want 2", n)
	}

	// Legitimate unsubscribe, scoped to source list 1: only subscriber 1's
	// list-1 subscription is unsubscribed; subscriber 2's list-2 row is
	// untouched.
	if err := c.UnsubscribeListsByQuery("", "TRUE", []int{1}, []int{1}, "", ""); err != nil {
		t.Fatalf("legit UnsubscribeListsByQuery: %v", err)
	}
	rows = subListRows(t, c)
	if rows[[2]int{1, 1}] != "unsubscribed" {
		t.Fatalf("subscriber 1 list-1 status = %q, want unsubscribed", rows[[2]int{1, 1}])
	}
	if rows[[2]int{2, 2}] != "confirmed" {
		t.Fatalf("subscriber 2 list-2 status = %q, want confirmed (outside permitted source list)", rows[[2]int{2, 2}])
	}

	// Legitimate delete, scoped to source list 1 and target list 3: only
	// subscriber 1's row goes.
	if err := c.DeleteSubscriptionsByQuery("", "TRUE", []int{1}, []int{3}, "", ""); err != nil {
		t.Fatalf("legit DeleteSubscriptionsByQuery: %v", err)
	}
	rows = subListRows(t, c)
	if _, ok := rows[[2]int{1, 3}]; ok {
		t.Fatalf("subscriber 1 list-3 row survived legitimate delete: %v", rows)
	}
	if len(rows) != 2 {
		t.Fatalf("unexpected rows after legitimate delete: %v", rows)
	}
}
