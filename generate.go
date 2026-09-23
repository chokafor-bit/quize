package main

// Question generation.
//
//   POST /api/generate         (admin) ask Claude for new questions; they are
//                              stored UNAPPROVED unless QUIZ_AUTO_APPROVE=1
//   GET  /api/admin/questions  (admin) list everything, with ids and status
//   POST /api/admin/questions  (admin) {"approve":[ids],"delete":[ids]}
//   GET  /api/questions        (public) approved questions only; the game loads these
//
// Environment:
//   ANTHROPIC_API_KEY   required for /api/generate
//   QUIZ_ADMIN_TOKEN    required; sent as the X-Admin-Token header
//   QUIZ_MODEL          optional, default claude-sonnet-5
//   QUIZ_WEB_SEARCH     "off" to skip web search
//   QUIZ_AUTO_APPROVE   "1" to publish generated questions without review

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const generatedFile = "generated_questions.json"

var errNoKey = errors.New("ANTHROPIC_API_KEY is not set")

// GenQuestion matches the question objects the game already uses, plus
// bookkeeping fields.
type GenQuestion struct {
	ID          string   `json:"id"`
	Q           string   `json:"q"`
	Code        string   `json:"code,omitempty"`
	Options     []string `json:"options"`
	Answer      int      `json:"answer"`
	Level       string   `json:"level"`
	Explanation string   `json:"explanation"`
	Approved    bool     `json:"approved"`
	Topic       string   `json:"topic,omitempty"`
	CreatedAt   string   `json:"createdAt,omitempty"`
}

var (
	generated []GenQuestion
	genMu     sync.Mutex // guards generated
	genRun    sync.Mutex // one generation at a time: each call costs money
	genClient = &http.Client{Timeout: 150 * time.Second}
)

const systemPrompt = `You write accurate multiple-choice quiz questions for students learning Go through the 01edu curriculum (go-reloaded, ascii-art, ascii-web, groupie-tracker, lem-in, forum, net-cat, goroutines, interfaces, error handling, testing, modules). You may search the web to check facts against the official Go documentation and other reputable sources. Write every question in your own words: never copy questions, answer options or explanations from any website or quiz bank. Assume Go 1.22 or newer. Reply with ONLY a JSON array, with no markdown fences and no commentary.`

func buildPrompt(topic, level string, count int) string {
	lv := "a mix of easy (40%), medium (40%) and hard (20%)"
	if level != "" {
		lv = "all " + level
	}
	if topic == "" {
		topic = "a broad mix of Go fundamentals and the 01edu projects"
	}
	return fmt.Sprintf(`Write %d new multiple-choice questions about Go.
Topic: %s
Difficulty: %s

Each array element must be an object with exactly these keys:
  "q": the question text
  "code": a short Go snippet the question refers to, or "" if none (at most 10 lines, use \n for line breaks)
  "options": exactly 4 distinct answer strings
  "answer": the index (0-3) of the correct option
  "level": "easy", "medium" or "hard"
  "explanation": one or two sentences saying why the answer is correct

Rules:
- Exactly one option is correct; the others must be plausible but clearly wrong.
- Verify every answer against current Go documentation before including it.
- Spread the correct answer across positions 0-3.
- Easy = recall a fact. Medium = apply it or read short code. Hard = subtle behaviour or edge cases.
- No questions whose answer depends on undefined or version-specific behaviour.
- No two questions may test the same fact.`, count, topic, lv)
}

// ── validation ─────────────────────────────────────────────────

func normQ(s string) string { return strings.ToLower(strings.Join(strings.Fields(s), " ")) }

func questionID(g GenQuestion) string {
	sum := sha256.Sum256([]byte(normQ(g.Q) + "|" + strings.Join(g.Options, "|")))
	return hex.EncodeToString(sum[:])[:10]
}

func cleanText(s string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, s))
}

func validateQuestion(g *GenQuestion) error {
	g.Q = cleanText(g.Q)
	g.Code = cleanText(g.Code)
	g.Explanation = cleanText(g.Explanation)
	g.Level = strings.ToLower(strings.TrimSpace(g.Level))

	if n := utf8.RuneCountInString(g.Q); n < 10 || n > 400 {
		return errors.New("question length")
	}
	if n := utf8.RuneCountInString(g.Explanation); n < 10 || n > 600 {
		return errors.New("explanation length")
	}
	if utf8.RuneCountInString(g.Code) > 800 {
		return errors.New("code too long")
	}
	if g.Level != "easy" && g.Level != "medium" && g.Level != "hard" {
		return errors.New("level")
	}
	if len(g.Options) != 4 || g.Answer < 0 || g.Answer > 3 {
		return errors.New("options/answer")
	}
	seen := map[string]bool{}
	for i, o := range g.Options {
		o = cleanText(o)
		g.Options[i] = o
		if n := utf8.RuneCountInString(o); n < 1 || n > 200 {
			return errors.New("option length")
		}
		k := strings.ToLower(o)
		if seen[k] {
			return errors.New("duplicate option")
		}
		seen[k] = true
	}
	return nil
}

// ── talking to the Anthropic API ───────────────────────────────

func clipStr(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

// callClaude returns the reply's text blocks. With web search on, the reply
// has several (narration between searches, then the final answer).
func callClaude(ctx context.Context, prompt string) ([]string, error) {
	key := os.Getenv("ANTHROPIC_API_KEY")
	if key == "" {
		return nil, errNoKey
	}
	model := os.Getenv("QUIZ_MODEL")
	if model == "" {
		model = "claude-sonnet-5"
	}
	body := map[string]any{
		"model":      model,
		"max_tokens": 8000,
		"system":     systemPrompt,
		"messages":   []map[string]any{{"role": "user", "content": prompt}},
	}
	if strings.ToLower(os.Getenv("QUIZ_WEB_SEARCH")) != "off" {
		body["tools"] = []map[string]any{{"type": "web_search_20250305", "name": "web_search", "max_uses": 4}}
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", key)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := genClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("anthropic API returned %d: %s", resp.StatusCode, clipStr(string(raw), 300))
	}
	var out struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	var texts []string
	for _, c := range out.Content {
		if c.Type == "text" && strings.TrimSpace(c.Text) != "" {
			texts = append(texts, c.Text)
		}
	}
	return texts, nil
}

// arrayStarts finds every '[' that is followed by '{': candidate starts of
// the JSON array (ignores brackets in narration text).
func arrayStarts(t string) []int {
	var out []int
	for i := 0; i < len(t); i++ {
		if t[i] != '[' {
			continue
		}
		j := i + 1
		for j < len(t) && (t[j] == ' ' || t[j] == '\n' || t[j] == '\t' || t[j] == '\r') {
			j++
		}
		if j < len(t) && t[j] == '{' {
			out = append(out, i)
		}
	}
	return out
}

func parseQuestions(texts []string) ([]GenQuestion, error) {
	for i := len(texts) - 1; i >= 0; i-- {
		for _, s := range arrayStarts(texts[i]) {
			var qs []GenQuestion
			if err := json.NewDecoder(strings.NewReader(texts[i][s:])).Decode(&qs); err == nil && len(qs) > 0 {
				return qs, nil
			}
		}
	}
	return nil, errors.New("the model's reply did not contain a JSON array of questions")
}

// ── storage ────────────────────────────────────────────────────

func loadGenerated() {
	genMu.Lock()
	defer genMu.Unlock()
	b, err := os.ReadFile(generatedFile)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("warning: could not read %s: %v", generatedFile, err)
		}
		generated = []GenQuestion{}
		return
	}
	if err := json.Unmarshal(b, &generated); err != nil {
		log.Printf("warning: could not parse %s: %v", generatedFile, err)
		generated = []GenQuestion{}
	}
}

// saveGenerated: caller must hold genMu. Atomic write.
func saveGenerated() error {
	b, err := json.MarshalIndent(generated, "", "  ")
	if err != nil {
		return err
	}
	tmp := generatedFile + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, generatedFile)
}

// ── handlers ───────────────────────────────────────────────────

func writeJSONResp(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func adminOK(w http.ResponseWriter, r *http.Request) bool {
	token := os.Getenv("QUIZ_ADMIN_TOKEN")
	if token == "" {
		http.Error(w, "admin API disabled: set QUIZ_ADMIN_TOKEN on the server", http.StatusServiceUnavailable)
		return false
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Admin-Token")), []byte(token)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}

// GET /api/questions: approved questions only.
func questionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	genMu.Lock()
	out := []GenQuestion{}
	for _, g := range generated {
		if g.Approved {
			out = append(out, g)
		}
	}
	genMu.Unlock()
	writeJSONResp(w, http.StatusOK, out)
}

// POST /api/generate {"topic":"goroutines","level":"medium","count":10}
func generateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !adminOK(w, r) {
		return
	}
	if !genRun.TryLock() {
		http.Error(w, "a generation is already running", http.StatusTooManyRequests)
		return
	}
	defer genRun.Unlock()

	r.Body = http.MaxBytesReader(w, r.Body, 4<<10)
	var req struct {
		Topic string `json:"topic"`
		Level string `json:"level"`
		Count int    `json:"count"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	req.Topic = cleanText(req.Topic)
	if utf8.RuneCountInString(req.Topic) > 80 {
		req.Topic = string([]rune(req.Topic)[:80])
	}
	req.Level = strings.ToLower(strings.TrimSpace(req.Level))
	if req.Level != "" && req.Level != "easy" && req.Level != "medium" && req.Level != "hard" {
		http.Error(w, `level must be "easy", "medium", "hard" or empty`, http.StatusBadRequest)
		return
	}
	if req.Count <= 0 {
		req.Count = 10
	}
	if req.Count > 20 {
		req.Count = 20
	}

	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()
	texts, err := callClaude(ctx, buildPrompt(req.Topic, req.Level, req.Count))
	if err == nil {
		var qs []GenQuestion
		if qs, err = parseQuestions(texts); err == nil {
			addGenerated(w, qs, req.Topic, req.Count)
			return
		}
	}
	log.Printf("generate failed: %v", err)
	if errors.Is(err, errNoKey) {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	http.Error(w, "generation failed: "+err.Error(), http.StatusBadGateway)
}

func addGenerated(w http.ResponseWriter, qs []GenQuestion, topic string, count int) {
	if len(qs) > count {
		qs = qs[:count]
	}
	now := time.Now().UTC().Format(time.RFC3339)
	auto := os.Getenv("QUIZ_AUTO_APPROVE") == "1"
	added := []GenQuestion{}
	skipped := 0

	genMu.Lock()
	defer genMu.Unlock()
	have := map[string]bool{}
	for _, g := range generated {
		have[normQ(g.Q)] = true
	}
	for _, g := range qs {
		if validateQuestion(&g) != nil || have[normQ(g.Q)] {
			skipped++
			continue
		}
		g.ID = questionID(g)
		g.Approved = auto
		g.Topic = topic
		g.CreatedAt = now
		have[normQ(g.Q)] = true
		added = append(added, g)
	}
	if len(added) > 0 {
		old := generated
		generated = append(generated, added...)
		if err := saveGenerated(); err != nil {
			generated = old
			log.Printf("error saving generated questions: %v", err)
			http.Error(w, "could not save questions", http.StatusInternalServerError)
			return
		}
	}
	writeJSONResp(w, http.StatusOK, map[string]any{
		"added": len(added), "skipped": skipped, "autoApproved": auto, "questions": added,
	})
}

// GET /api/admin/questions lists all; POST {"approve":[ids],"delete":[ids]}.
func adminQuestionsHandler(w http.ResponseWriter, r *http.Request) {
	if !adminOK(w, r) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		genMu.Lock()
		out := append([]GenQuestion{}, generated...)
		genMu.Unlock()
		writeJSONResp(w, http.StatusOK, out)

	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		var req struct {
			Approve []string `json:"approve"`
			Delete  []string `json:"delete"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		app, del := map[string]bool{}, map[string]bool{}
		for _, id := range req.Approve {
			app[id] = true
		}
		for _, id := range req.Delete {
			del[id] = true
		}
		genMu.Lock()
		defer genMu.Unlock()
		next := make([]GenQuestion, 0, len(generated))
		nApp, nDel := 0, 0
		for _, g := range generated {
			if del[g.ID] {
				nDel++
				continue
			}
			if app[g.ID] && !g.Approved {
				g.Approved = true
				nApp++
			}
			next = append(next, g)
		}
		old := generated
		generated = next
		if err := saveGenerated(); err != nil {
			generated = old
			log.Printf("error saving generated questions: %v", err)
			http.Error(w, "could not save", http.StatusInternalServerError)
			return
		}
		writeJSONResp(w, http.StatusOK, map[string]int{"approved": nApp, "deleted": nDel})

	default:
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
