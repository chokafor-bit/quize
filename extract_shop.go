//go:build ignore

// extract_shop.go moves the shop catalogue (SHOP_ITEMS and KIND_LABEL) out of
// index.html into shop.js (written next to index.html) and adds a
// <script src="shop.js"> tag. A .bak copy is written first.
//
//	go run extract_shop.go static/index.html
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
		fail(fmt.Errorf("usage: go run extract_shop.go static/index.html"))
	}
	path := os.Args[1]
	b, err := os.ReadFile(path)
	if err != nil {
		fail(err)
	}
	src := string(b)
	if strings.Contains(src, `src="shop.js"`) {
		fmt.Println("already extracted, nothing to do")
		return
	}

	start := strings.Index(src, "const SHOP_ITEMS = [")
	if start < 0 {
		fail(fmt.Errorf("could not find `const SHOP_ITEMS = [` (is this the original index.html?)"))
	}
	// Take the comment lines just above it too (section title + kind notes).
	for start > 0 {
		prev := strings.LastIndex(src[:start-1], "\n") + 1
		if !strings.HasPrefix(src[prev:start], "//") {
			break
		}
		start = prev
	}

	// The catalogue ends with the KIND_LABEL line.
	k := strings.Index(src[start:], "const KIND_LABEL")
	if k < 0 {
		fail(fmt.Errorf("could not find `const KIND_LABEL`"))
	}
	nl := strings.Index(src[start+k:], "\n")
	if nl < 0 {
		fail(fmt.Errorf("unexpected end of file after KIND_LABEL"))
	}
	end := start + k + nl + 1

	block := strings.TrimSpace(src[start:end]) + "\n"
	if !strings.HasSuffix(block, "};\n") {
		fail(fmt.Errorf("shop block does not end with }; as expected"))
	}

	tag := strings.LastIndex(src[:start], "<script>")
	if tag < 0 {
		fail(fmt.Errorf("could not find the <script> tag holding the shop"))
	}
	// Load shop.js first, then the inline script minus the shop block.
	out := src[:tag] + `<script src="shop.js"></script>` + "\n" + src[tag:start] + src[end:]

	header := "// Shop catalogue. You can freely change name, icon, price and desc.\n" +
		"// The ids (hint50, freeze, warp, skip, booster, shield, retry, charm, crown)\n" +
		"// are wired to game logic in index.html, so keep them. A brand-new item also\n" +
		"// needs code in index.html for what it does.\n\n"

	if err := os.WriteFile(path+".shop.bak", b, 0o644); err != nil {
		fail(err)
	}
	sPath := filepath.Join(filepath.Dir(path), "shop.js")
	if err := os.WriteFile(sPath, []byte(header+block), 0o644); err != nil {
		fail(err)
	}
	if err := os.WriteFile(path, []byte(out), 0o644); err != nil {
		fail(err)
	}
	fmt.Println("wrote", sPath)
	fmt.Println("updated", path, "(backup:", path+".shop.bak)")
}
