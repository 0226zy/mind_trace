package service

import "testing"

func TestSimilarity(t *testing.T) {
	tests := []struct {
		name        string
		left, right string
		min, max    float64
	}{
		{name: "identical Chinese", left: "担心工作失误", right: "担心工作失误", min: 1, max: 1},
		{name: "unrelated Chinese", left: "担心工作失误", right: "喜欢蓝天白云", min: 0, max: 0},
		{name: "partial Chinese", left: "担心工作失误被批评", right: "我害怕工作失误", min: 0.15, max: 0.99},
		{name: "case insensitive English", left: "Dead Anxiety", right: "dead anxiety", min: 1, max: 1},
		{name: "blank", left: "  ", right: "工作", min: 0, max: 0},
		{name: "English word boundaries", left: "cat", right: "concatenate", min: 0, max: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			score := Similarity(test.left, test.right)
			if score < test.min || score > test.max {
				t.Fatalf("Similarity(%q, %q)=%v, want [%v,%v]", test.left, test.right, score, test.min, test.max)
			}
		})
	}
}

func TestSimilarityIsSymmetric(t *testing.T) {
	left, right := "明天汇报失败怎么办", "汇报做错会被开除"
	if Similarity(left, right) != Similarity(right, left) {
		t.Fatal("similarity must be symmetric")
	}
}
