package service

import "testing"

func TestEscapeLike(t *testing.T) {
	tests := []struct {
		input, want string
	}{
		{input: "ordinary text", want: "ordinary text"},
		{input: "100%", want: `100\%`},
		{input: "under_score", want: `under\_score`},
		{input: `back\slash`, want: `back\\slash`},
		{input: `100%\_`, want: `100\%\\\_`},
	}
	for _, test := range tests {
		if got := escapeLike(test.input); got != test.want {
			t.Errorf("escapeLike(%q)=%q, want %q", test.input, got, test.want)
		}
	}
}
