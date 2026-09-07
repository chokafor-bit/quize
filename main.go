// Command quizserver serves the "Imperative in Go" quiz app and backs its
// leaderboard with a small JSON file on disk (no external DB required).
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"
)

type Entry struct {
	Name  string    `json:"name"`
	Score int       `json:"score"`
	Total int       `json:"total"`
	Diff  string    `json:"diff"`
	Date  time.Time `json:"date"`
}

const (
	dataFile   = "leaderboard.json"
	maxEntries = 200 // keep the file bounded; we only ever show top 10 anyway
)

var (
	mu      sync.Mutex
	entries []Entry
)

func loadEntries() {
	mu.Lock()
	defer mu.Unlock()

	b, err := os.ReadFile(dataFile)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("warning: could not read %s: %v", dataFile, err)
		}
		entries = []Entry{}
		return
	}
	if err := json.Unmarshal(b, &entries); err != nil {
		log.Printf("warning: could not parse %s: %v", dataFile, err)
		entries = []Entry{}
	}
}

func saveEntries() error {
	// caller must hold mu
	b, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(dataFile, b, 0o644)
}

func leaderboardHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		mu.Lock()
		sorted := make([]Entry, len(entries))
		copy(sorted, entries)
		mu.Unlock()

		sort.Slice(sorted, func(i, j int) bool {
			return sorted[i].Score > sorted[j].Score
		})
		if len(sorted) > 10 {
			sorted = sorted[:10]
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sorted)

	case http.MethodPost:
		var e Entry
		if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if e.Name == "" {
			e.Name = "Anonymous"
		}
		if len(e.Name) > 20 {
			e.Name = e.Name[:20]
		}
		if e.Total <= 0 || e.Score < 0 || e.Score > e.Total {
			http.Error(w, "invalid score", http.StatusBadRequest)
			return
		}
		e.Date = time.Now()

		mu.Lock()
		entries = append(entries, e)
		if len(entries) > maxEntries {
			// keep the best-scoring entries when trimming
			sort.Slice(entries, func(i, j int) bool { return entries[i].Score > entries[j].Score })
			entries = entries[:maxEntries]
		}
		err := saveEntries()
		mu.Unlock()

		if err != nil {
			log.Printf("error saving leaderboard: %v", err)
			http.Error(w, "could not save score", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)

	default:
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// recover middleware: catches panics in any handler and returns a clean 500
// instead of crashing the server.
func withRecovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic recovered: %v", rec)
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func main() {
	loadEntries()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/leaderboard", leaderboardHandler)
	mux.Handle("/", http.FileServer(http.Dir("./static")))

	addr := ":8080"
	log.Printf("Imperative in Go quiz server listening on http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, withRecovery(mux)))
}