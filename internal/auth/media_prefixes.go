package auth

import "fmt"

// MediaPrefixes returns the media filename LIKE patterns the user may access.
// A nil slice means unrestricted (the user can see all lists).
func MediaPrefixes(user *User) []string {
	var prefixes []string
	if hasAllLists, permittedLists := user.GetPermittedLists(PermTypeGet | PermTypeManage); !hasAllLists {
		for _, id := range permittedLists {
			prefixes = append(prefixes, fmt.Sprintf("list-%d/%%", id))
			prefixes = append(prefixes, fmt.Sprintf("list-%d-%%", id))
		}

		// Always allow access to a "public" namespace.
		prefixes = append(prefixes, "public/%", "public-%")

		// If the user has no permitted lists and thus no prefixes,
		// force a dummy prefix to ensure they see nothing (instead of everything).
		if len(prefixes) == 0 {
			prefixes = []string{"__none__"}
		}
	}
	return prefixes
}
