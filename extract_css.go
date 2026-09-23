//go:build ignore

// extract_css.go moves the <style> block out of index.html into style.css
// (written next to index.html) and replaces it with a <link> tag.
// A .bak copy is written first.
//
//	go run extract_css.go static/index.html
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
		fail(fmt.Errorf("usage: go run extract_css.go static/index.html"))
	}
	path := os.Args[1]
	b, err := os.ReadFile(path)
	if err != nil {
		fail(err)
	}
	src := string(b)
	if strings.Contains(src, `href="style.css"`) {
		fmt.Println("already extracted, nothing to do")
		return
	}

	open := strings.Index(src, "<style>")
	if open < 0 {
		fail(fmt.Errorf("could not find a <style> tag (is this the original index.html?)"))
	}
	bodyStart := open + len("<style>")
	closeRel := strings.Index(src[bodyStart:], "</style>")
	if closeRel < 0 {
		fail(fmt.Errorf("could not find the closing </style> tag"))
	}
	bodyEnd := bodyStart + closeRel
	after := bodyEnd + len("</style>")

	// Remove the 2-space indent the CSS had inside the HTML file.
	lines := strings.Split(strings.Trim(src[bodyStart:bodyEnd], "\r\n"), "\n")
	for i, l := range lines {
		lines[i] = strings.TrimPrefix(l, "  ")
	}
	css := strings.Join(lines, "\n") + "\n"

	out := src[:open] + `<link rel="stylesheet" href="style.css">` + src[after:]

	if err := os.WriteFile(path+".css.bak", b, 0o644); err != nil {
		fail(err)
	}
	cPath := filepath.Join(filepath.Dir(path), "style.css")
	if err := os.WriteFile(cPath, []byte(css), 0o644); err != nil {
		fail(err)
	}
	if err := os.WriteFile(path, []byte(out), 0o644); err != nil {
		fail(err)
	}
	fmt.Println("wrote", cPath)
	fmt.Println("updated", path, "(backup:", path+".css.bak)")
}
