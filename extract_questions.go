//go:build ignore

// extract_questions.go moves the ALL_QUESTIONS array out of index.html into
// its own file, questions.js (written next to index.html), and adds a
// <script src="questions.js"> tag in its place. A .bak copy is written first.
//
//	go run extract_questions.go static/index.html
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func fail(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}

func main() {
	if len(os.Args) != 2 {
		fail(fmt.Errorf("usage: go run extract_questions.go static/index.html"))
	}
	path := os.Args[1]
	b, err := os.ReadFile(path)
	if err != nil {
		fail(err)
	}
	src := string(b)
	if strings.Contains(src, `src="questions.js"`) {
		fmt.Println("already extracted, nothing to do")
		return
	}

	start := strings.Index(src, "const ALL_QUESTIONS = [")
	if start < 0 {
		fail(fmt.Errorf("could not find `const ALL_QUESTIONS = [` (is this the original index.html?)"))
	}
	// The array ends right before the "QUESTION LEVELS" comment block.
	end := strings.Index(src[start:], "QUESTION LEVELS")
	if end < 0 {
		fail(fmt.Errorf("could not find the end of the question list"))
	}
	end = strings.LastIndex(src[:start+end], "\n") + 1

	block := strings.TrimSpace(src[start:end]) + "\n"
	if !strings.HasSuffix(block, "];\n") {
		fail(fmt.Errorf("question list does not end with ]; as expected"))
	}

	tag := strings.LastIndex(src[:start], "<script>")
	if tag < 0 {
		fail(fmt.Errorf("could not find the <script> tag holding the questions"))
	}
	// External script first, then the inline script minus the questions.
	out := src[:tag] + `<script src="questions.js"></script>` + "\n" + src[tag:start] + src[end:]

	header := "// All quiz questions. Edit this file to add, change or remove questions.\n" +
		"// Each question: q, options (4 strings), answer (0-based index),\n" +
		"// level (\"easy\" | \"medium\" | \"hard\"), explanation, and optional code.\n\n"

	if err := os.WriteFile(path+".bak", b, 0o644); err != nil {
		fail(err)
	}
	qPath := filepath.Join(filepath.Dir(path), "questions.js")
	if err := os.WriteFile(qPath, []byte(header+block), 0o644); err != nil {
		fail(err)
	}
	if err := os.WriteFile(path, []byte(out), 0o644); err != nil {
		fail(err)
	}
	fmt.Println("wrote", qPath)
	fmt.Println("updated", path, "(backup:", path+".bak)")
}
