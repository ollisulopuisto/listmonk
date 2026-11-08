package i18n

import (
	"os"
	"testing"
	"time"
)

func TestFormatDate(t *testing.T) {
	date := time.Date(2026, time.October, 28, 15, 4, 5, 0, time.UTC)
	for _, tc := range []struct {
		lang, layout, want string
	}{
		{"en", "_.date_long", "October 28, 2026"},
		{"en", "_.date_short", "Wed, 28 Oct 2026"},
		{"fr", "_.date_long", "28 octobre 2026"},
		{"fr", "_.date_short", "mer. 28 oct. 2026"},
		{"fr", "Monday 02 January 2006, 15:04:05 MST", "mercredi 28 octobre 2026, 15:04:05 UTC"},
		{"fr", time.RFC3339, "2026-10-28T15:04:05Z"},
	} {
		t.Run(tc.lang+"/"+tc.layout, func(t *testing.T) {
			b, err := os.ReadFile("../../i18n/" + tc.lang + ".json")
			if err != nil {
				t.Fatal(err)
			}
			i, err := New(b)
			if err != nil {
				t.Fatal(err)
			}
			if got := i.FormatDate(date, i.T(tc.layout)); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestFormatDateFallback(t *testing.T) {
	i, err := New([]byte(`{"_.code":"test","_.name":"Test","dates.months":"invalid","dates.weekdaysShort":""}`))
	if err != nil {
		t.Fatal(err)
	}
	for month := time.January; month <= time.December; month++ {
		for day := 1; day <= 7; day++ {
			date := time.Date(2026, month, day, 15, 4, 5, 0, time.UTC)
			layout := "Monday Mon January Jan 02 2006 15:04:05"
			if got, want := i.FormatDate(date, layout), date.Format(layout); got != want {
				t.Fatalf("got %q, want %q", got, want)
			}
		}
	}
}

func TestSingularPlural(t *testing.T) {
	inst := &I18n{}
	tests := []struct {
		input        string
		wantSingular string
		wantPlural   string
	}{
		{
			input:        "Campaign",
			wantSingular: "Campaign",
			wantPlural:   "Campaign",
		},
		{
			input:        "Campaign | Campaigns",
			wantSingular: "Campaign",
			wantPlural:   "Campaigns",
		},
		{
			input:        "  Campaign   |   Campaigns  ",
			wantSingular: "Campaign",
			wantPlural:   "Campaigns",
		},
		{
			input:        "January | February | March | April",
			wantSingular: "January",
			wantPlural:   "January",
		},
		{
			input:        "Single|",
			wantSingular: "Single",
			wantPlural:   "",
		},
		{
			input:        "|Plural",
			wantSingular: "",
			wantPlural:   "Plural",
		},
		{
			input:        "",
			wantSingular: "",
			wantPlural:   "",
		},
	}

	for _, tc := range tests {
		if got := inst.getSingular(tc.input); got != tc.wantSingular {
			t.Errorf("getSingular(%q) = %q, want %q", tc.input, got, tc.wantSingular)
		}
		if got := inst.getPlural(tc.input); got != tc.wantPlural {
			t.Errorf("getPlural(%q) = %q, want %q", tc.input, got, tc.wantPlural)
		}
	}
}

func TestTandTc(t *testing.T) {
	jsonMap := []byte(`{
		"_.code": "en",
		"_.name": "English",
		"term.campaign": "Campaign | Campaigns",
		"term.single": "SingleWord"
	}`)

	i, err := New(jsonMap)
	if err != nil {
		t.Fatal(err)
	}

	if got, want := i.T("term.campaign"), "Campaign"; got != want {
		t.Errorf("T(term.campaign) = %q, want %q", got, want)
	}
	if got, want := i.T("term.single"), "SingleWord"; got != want {
		t.Errorf("T(term.single) = %q, want %q", got, want)
	}
	if got, want := i.Tc("term.campaign", 1), "Campaign"; got != want {
		t.Errorf("Tc(term.campaign, 1) = %q, want %q", got, want)
	}
	if got, want := i.Tc("term.campaign", 2), "Campaigns"; got != want {
		t.Errorf("Tc(term.campaign, 2) = %q, want %q", got, want)
	}
	if got, want := i.Tc("term.single", 2), "SingleWord"; got != want {
		t.Errorf("Tc(term.single, 2) = %q, want %q", got, want)
	}
}

func BenchmarkGetSingular(b *testing.B) {
	inst := &I18n{}
	s := "Subscriber | Subscribers"
	b.ResetTimer()
	b.ReportAllocs()
	for n := 0; n < b.N; n++ {
		_ = inst.getSingular(s)
	}
}

func BenchmarkGetPlural(b *testing.B) {
	inst := &I18n{}
	s := "Subscriber | Subscribers"
	b.ResetTimer()
	b.ReportAllocs()
	for n := 0; n < b.N; n++ {
		_ = inst.getPlural(s)
	}
}

func BenchmarkT(b *testing.B) {
	jsonMap := []byte(`{
		"_.code": "en",
		"_.name": "English",
		"term.campaign": "Campaign | Campaigns"
	}`)
	i, _ := New(jsonMap)
	b.ResetTimer()
	b.ReportAllocs()
	for n := 0; n < b.N; n++ {
		_ = i.T("term.campaign")
	}
}

func BenchmarkTc(b *testing.B) {
	jsonMap := []byte(`{
		"_.code": "en",
		"_.name": "English",
		"term.campaign": "Campaign | Campaigns"
	}`)
	i, _ := New(jsonMap)
	b.ResetTimer()
	b.ReportAllocs()
	for n := 0; n < b.N; n++ {
		_ = i.Tc("term.campaign", 5)
	}
}
