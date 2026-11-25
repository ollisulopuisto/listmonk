package main

import (
	"testing"

	"golang.org/x/mod/semver"
)

// A DB already at v7.0.1 (the fork shipped v7.0.0 before the upload settings
// consolidation was added to its body) only runs migrations newer than
// v7.0.1, so the consolidation must live in a later version.
func TestUploadSettingsMigrationRunsForDBAtV701(t *testing.T) {
	last := migList[len(migList)-1].version
	if semver.Compare(last, "v7.0.1") <= 0 {
		t.Fatalf("latest migration is %s; a DB at v7.0.1 never runs the upload settings migration", last)
	}
}
