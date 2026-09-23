//go:build ignore

// patch_html.go applies patch1-identity.js and patch2-server-sync.js to your
// existing index.html, in place (a .bak copy is written first).
//
//	go run patch_html.go static/index.html
package main

import (
	"fmt"
	"os"
	"strings"
)

// body drops the instruction header (everything up to the 2nd "// ═" line).
func body(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		fail(err)
	}
	lines := strings.Split(string(b), "\n")
	seen := 0
	for i, l := range lines {
		if strings.HasPrefix(l, "// ═") {
			if seen++; seen == 2 {
				return strings.Join(lines[i+1:], "\n")
			}
		}
	}
	fail(fmt.Errorf("%s: header not found", path))
	return ""
}

// replace swaps the text from the line containing startMark up to the line
// containing endMark (exclusive) with repl.
func replace(src, startMark, endMark, repl string) string {
	s := strings.Index(src, startMark)
	if s < 0 {
		fail(fmt.Errorf("marker not found: %q (is this the original index.html?)", startMark))
	}
	s = strings.LastIndex(src[:s], "\n") + 1
	e := strings.Index(src[s:], endMark)
	if e < 0 {
		fail(fmt.Errorf("marker not found: %q", endMark))
	}
	e = strings.LastIndex(src[:s+e], "\n") + 1
	return src[:s] + repl + src[e:]
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}

func main() {
	if len(os.Args) != 2 {
		fail(fmt.Errorf("usage: go run patch_html.go static/index.html"))
	}
	path := os.Args[1]
	b, err := os.ReadFile(path)
	if err != nil {
		fail(err)
	}
	src := string(b)
	if strings.Contains(src, "const PLAYER_API") {
		fmt.Println("already patched, nothing to do")
		return
	}
	if err := os.WriteFile(path+".bak", b, 0o644); err != nil {
		fail(err)
	}

	src = replace(src, "PLAYER IDENTITY & PERSISTENT PROGRESS", "function togglePinField()", body("patch1-identity.js"))
	src = replace(src, "async function enterApp() {", "GAME MEMORY: recording what the player does", body("patch2-server-sync.js"))
	src = strings.Replace(src,
		"New name? Pick any 4 digits — you'll need the same ones next time to get this exact save back.",
		"New name? Pick any 4 digits. Your progress is saved on the server, so you can pick it up on any device with the same name and PIN.", 1)

	if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
		fail(err)
	}
	fmt.Println("patched", path, "(backup:", path+".bak)")
}
