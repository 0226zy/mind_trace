package service

import (
	"strings"
	"unicode"
)

// Similarity uses a Sørensen–Dice coefficient over Chinese character bigrams
// and normalized Latin/number words. It is deterministic and language-neutral
// enough for short mixed-language thought descriptions.
func Similarity(left, right string) float64 {
	a, b := tokens(left), tokens(right)
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	counts := make(map[string]int, len(a))
	for token := range a {
		counts[token]++
	}
	intersection := 0
	for token := range b {
		if counts[token] > 0 {
			intersection++
			counts[token]--
		}
	}
	return float64(2*intersection) / float64(len(a)+len(b))
}

func tokens(text string) map[string]struct{} {
	text = strings.ToLower(strings.TrimSpace(text))
	result := make(map[string]struct{})
	var word []rune
	var cjk []rune
	flushWord := func() {
		if len(word) > 0 {
			result[string(word)] = struct{}{}
			word = nil
		}
	}
	flushCJK := func() {
		if len(cjk) == 1 {
			result[string(cjk)] = struct{}{}
		}
		for i := 0; i+1 < len(cjk); i++ {
			result[string(cjk[i:i+2])] = struct{}{}
		}
		cjk = nil
	}
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Han, r):
			flushWord()
			cjk = append(cjk, r)
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			flushCJK()
			word = append(word, r)
		default:
			flushWord()
			flushCJK()
		}
	}
	flushWord()
	flushCJK()
	return result
}
