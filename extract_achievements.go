//go:build ignore

// extract_achievements.go moves the ACHIEVEMENTS array out of index.html into
// achievements.js (written next to index.html) and adds a
// <script src="achievements.js"> tag. A .bak copy is written first.
//
//	go run extract_achievements.go static/index.html
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
		fail(fmt.Errorf("usage: go run extract_achievements.go static/index.html"))
	}
	path := os.Args[1]
	b, err := os.ReadFile(path)
	if err != nil {
		fail(err)
	}
	src := string(b)
	if strings.Contains(src, `src="achievements.js"`) {
		fmt.Println("already extracted, nothing to do")
		return
	}

	start := strings.Index(src, "const ACHIEVEMENTS = [")
	if start < 0 {
		fail(fmt.Errorf("could not find `const ACHIEVEMENTS = [` (is this the original index.html?)"))
	}
	// Take the section comment line just above it too, if there is one.
	if start > 0 {
		prev := strings.LastIndex(src[:start-1], "\n") + 1
		if strings.HasPrefix(src[prev:start], "//") {
			start = prev
		}
	}
	// The array ends right before `function shuffle(`.
	end := strings.Index(src[start:], "function shuffle(")
	if end < 0 {
		fail(fmt.Errorf("could not find the end of the achievements list"))
	}
	end = strings.LastIndex(src[:start+end], "\n") + 1

	block := strings.TrimSpace(src[start:end]) + "\n"
	if !strings.HasSuffix(block, "];\n") {
		fail(fmt.Errorf("achievements list does not end with ]; as expected"))
	}

	tag := strings.LastIndex(src[:start], "<script>")
	if tag < 0 {
		fail(fmt.Errorf("could not find the <script> tag holding the achievements"))
	}
	// Load achievements.js first, then the inline script minus the achievements.
	out := src[:tag] + `<script src="achievements.js"></script>` + "\n" + src[tag:start] + src[end:]

	header := "// All achievements. Edit this file to add, change or remove achievements.\n" +
		"// Each one: id (unique), icon, name, desc, and check(s), which returns true when unlocked.\n" +
		"// check() uses LEVELS and SHOP_ITEMS from the main game script; that works\n" +
		"// because check() only runs during play, after everything has loaded.\n\n"

	if err := os.WriteFile(path+".ach.bak", b, 0o644); err != nil {
		fail(err)
	}
	aPath := filepath.Join(filepath.Dir(path), "achievements.js")
	if err := os.WriteFile(aPath, []byte(header+block), 0o644); err != nil {
		fail(err)
	}
	if err := os.WriteFile(path, []byte(out), 0o644); err != nil {
		fail(err)
	}
	fmt.Println("wrote", aPath)
	fmt.Println("updated", path, "(backup:", path+".ach.bak)")
}
