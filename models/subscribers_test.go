package models

import "testing"

func TestSubscriberFirstAndLastName(t *testing.T) {
	tests := []struct {
		name          string
		wantFirstName string
		wantLastName  string
	}{
		{
			name:          "John Doe",
			wantFirstName: "John",
			wantLastName:  "Doe",
		},
		{
			name:          "Alexander",
			wantFirstName: "Alexander",
			wantLastName:  "Alexander",
		},
		{
			name:          "Al Doe",
			wantFirstName: "Doe",
			wantLastName:  "Doe",
		},
		{
			name:          "Al Bo",
			wantFirstName: "Al Bo",
			wantLastName:  "Al Bo",
		},
		{
			name:          "John Jacob Jingleheimer Schmidt",
			wantFirstName: "John",
			wantLastName:  "Schmidt",
		},
		{
			name:          "Dr. John Watson Jr.",
			wantFirstName: "Dr.",
			wantLastName:  "Jr.",
		},
		{
			name:          "  Leading and Trailing  ",
			wantFirstName: "Leading",
			wantLastName:  "Trailing",
		},
		{
			name:          "First  Middle   Last",
			wantFirstName: "First",
			wantLastName:  "Last",
		},
		{
			name:          "",
			wantFirstName: "",
			wantLastName:  "",
		},
		{
			name:          "   ",
			wantFirstName: "   ",
			wantLastName:  "   ",
		},
	}

	for _, tc := range tests {
		s := Subscriber{Name: tc.name}
		if got := s.FirstName(); got != tc.wantFirstName {
			t.Errorf("Subscriber{Name: %q}.FirstName() = %q; want %q", tc.name, got, tc.wantFirstName)
		}
		if got := s.LastName(); got != tc.wantLastName {
			t.Errorf("Subscriber{Name: %q}.LastName() = %q; want %q", tc.name, got, tc.wantLastName)
		}
	}
}

func BenchmarkSubscriberFirstName(b *testing.B) {
	s := Subscriber{Name: "John Jacob Jingleheimer Schmidt"}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = s.FirstName()
	}
}

func BenchmarkSubscriberLastName(b *testing.B) {
	s := Subscriber{Name: "John Jacob Jingleheimer Schmidt"}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = s.LastName()
	}
}
