package trip

import "testing"

func TestNormalizeCountry(t *testing.T) {
	cases := map[string]string{
		"CN": "CN", "jp": "JP", " th ": "TH", "": "",
		"中国": "CN", "中国澳门": "MO", "中国香港": "HK", "马来西亚": "MY",
		"Hong Kong": "HK", "United States": "US",
		"火星": "火星",
	}
	for in, want := range cases {
		if got := NormalizeCountry(in); got != want {
			t.Errorf("NormalizeCountry(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidateNormalizesCountry(t *testing.T) {
	tr := Trip{
		Type:        Flight,
		Origin:      &Place{Name: "北京", Country: "中国", Lat: 39.9, Lng: 116.4},
		Destination: Place{Name: "澳门", Country: "中国澳门", Lat: 22.2, Lng: 113.5},
	}
	if err := tr.Validate(); err != nil {
		t.Fatal(err)
	}
	if tr.Origin.Country != "CN" || tr.Destination.Country != "MO" {
		t.Fatalf("got %q / %q", tr.Origin.Country, tr.Destination.Country)
	}

	tr.Destination.Country = "火星"
	if err := tr.Validate(); err == nil {
		t.Fatal("expected error for unknown country")
	}
}
