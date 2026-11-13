package auth

import (
	"reflect"
	"testing"
)

// Guard: list-restricted users only get media under their lists' prefixes
// (plus "public"); users with no lists get a prefix that matches nothing.
func TestMediaPrefixesRestrictsToPermittedLists(t *testing.T) {
	u := &User{GetListIDs: []int{3}, ManageListIDs: []int{5}}
	want := []string{"list-3/%", "list-3-%", "list-5/%", "list-5-%", "public/%", "public-%"}
	if got := MediaPrefixes(u); !reflect.DeepEqual(got, want) {
		t.Fatalf("prefixes = %v, want %v", got, want)
	}
	if got := MediaPrefixes(&User{}); !reflect.DeepEqual(got, []string{"public/%", "public-%"}) {
		t.Fatalf("user without lists got %v", got)
	}
}

func TestMediaPrefixesUnrestricted(t *testing.T) {
	if got := MediaPrefixes(&User{UserRoleID: SuperAdminRoleID}); len(got) != 0 {
		t.Fatalf("super admin should be unrestricted, got %v", got)
	}
	u := &User{PermissionsMap: map[string]struct{}{PermListGetAll: {}}}
	if got := MediaPrefixes(u); len(got) != 0 {
		t.Fatalf("lists:get_all should be unrestricted, got %v", got)
	}
}
