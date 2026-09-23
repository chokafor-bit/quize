//go:build ignore

// extract_js.go moves the main inline <script> block out of index.html into
// app.js (written next to index.html) and replaces it with
// <script src="app.js"></script>. A .bak copy is written first.
//
//	go run extract_js.go static/index.html
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
		fail(fmt.Errorf("usage: go run extract_js.go static/index.html"))
	}
	path := os.Args[1]
	b, err := os.ReadFile(path)
	if err != nil {
		fail(err)
	}
	src := string(b)
	if strings.Contains(src, `src="app.js"`) {
		fmt.Println("already extracted, nothing to do")
		return
	}

	// Inline scripts are the bare <script> tags; <script src="..."> is left alone.
	open := strings.Index(src, "<script>")
	if open < 0 {
		fail(fmt.Errorf("could not find an inline <script> tag (is this the original index.html?)"))
	}
	bodyStart := open + len("<script>")
	closeRel := strings.Index(src[bodyStart:], "</script>")
	if closeRel < 0 {
		fail(fmt.Errorf("could not find the closing </script> tag"))
	}
	bodyEnd := bodyStart + closeRel
	after := bodyEnd + len("</script>")

	js := strings.Trim(src[bodyStart:bodyEnd], "\r\n") + "\n"
	out := src[:open] + `<script src="app.js"></script>` + src[after:]

	if err := os.WriteFile(path+".js.bak", b, 0o644); err != nil {
		fail(err)
	}
	jPath := filepath.Join(filepath.Dir(path), "app.js")
	if err := os.WriteFile(jPath, []byte(js), 0o644); err != nil {
		fail(err)
	}
	if err := os.WriteFile(path, []byte(out), 0o644); err != nil {
		fail(err)
	}
	fmt.Println("wrote", jPath)
	fmt.Println("updated", path, "(backup:", path+".js.bak)")
	if strings.Contains(out, "<script>") {
		fmt.Println("note: another inline <script> block is still in index.html")
	}
}
