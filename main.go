// Command quizserver serves the "Imperative in Go" quiz app and backs its
// leaderboard with a small JSON file on disk (no external DB required).
package main

import (
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sort"
	"strings"
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
	dataFile        = "leaderboard.json"
	playersDataFile = "players.json"
	maxEntries      = 200 // keep the file bounded; we only ever show top 10 anyway
)

var (
	mu      sync.Mutex
	entries []Entry
)

type Player struct {
	Name          string         `json:"name"`
	Coins         int            `json:"coins"`
	LifetimeCoins int            `json:"lifetimeCoins"`
	AvatarImage   string         `json:"avatarImage,omitempty"`
	ProfileTitle  string         `json:"profileTitle,omitempty"`
	ProfileColor  string         `json:"profileColor,omitempty"`
	Achievements  []string       `json:"achievements"`
	Purchases     map[string]int `json:"purchases"`
	Inventory     map[string]int `json:"inventory"`
	Stats         map[string]int `json:"stats"`
	SavedAt       string         `json:"savedAt"`
}

var (
	players   = map[string]Player{}
	playersMu sync.Mutex
)

type RoomPlayer struct {
	Name      string `json:"name"`
	Score     int    `json:"score"`
	Submitted bool   `json:"submitted"`
	Reset     bool   `json:"reset,omitempty"`
}

type Room struct {
	Code      string       `json:"code"`
	Host      string       `json:"host"`
	Players   []RoomPlayer `json:"players"`
	Winner    string       `json:"winner,omitempty"`
	Finished  bool         `json:"finished"`
	CreatedAt time.Time    `json:"createdAt"`
}

var (
	rooms   = map[string]*Room{}
	roomsMu sync.Mutex
)

func cleanupRooms() {
	cutoff := time.Now().Add(-2 * time.Hour)
	roomsMu.Lock()
	defer roomsMu.Unlock()
	for code, room := range rooms {
		if room.CreatedAt.Before(cutoff) {
			delete(rooms, code)
		}
	}
}

func roomCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	code := make([]byte, 6)
	for i := range code {
		code[i] = alphabet[rand.Intn(len(alphabet))]
	}
	return string(code)
}

func roomHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodPost && r.URL.Path == "/api/rooms" {
		var request RoomPlayer
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || strings.TrimSpace(request.Name) == "" {
			http.Error(w, "player name required", http.StatusBadRequest)
			return
		}
		roomsMu.Lock()
		code := roomCode()
		for rooms[code] != nil {
			code = roomCode()
		}
		rooms[code] = &Room{Code: code, Host: request.Name, Players: []RoomPlayer{{Name: request.Name}}, CreatedAt: time.Now()}
		room := *rooms[code]
		roomsMu.Unlock()
		json.NewEncoder(w).Encode(room)
		return
	}

	code := strings.ToUpper(strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/rooms/")))
	if len(code) != 6 {
		http.Error(w, "invalid room code", http.StatusBadRequest)
		return
	}
	roomsMu.Lock()
	room, ok := rooms[code]
	if !ok {
		roomsMu.Unlock()
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodPost {
		var request RoomPlayer
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || strings.TrimSpace(request.Name) == "" {
			roomsMu.Unlock()
			http.Error(w, "player name required", http.StatusBadRequest)
			return
		}
		if request.Reset && strings.EqualFold(room.Host, request.Name) {
			for i := range room.Players {
				room.Players[i].Score = 0
				room.Players[i].Submitted = false
			}
			room.Winner = ""
			room.Finished = false
		}
		found := false
		for i, player := range room.Players {
			if strings.EqualFold(player.Name, request.Name) {
				found = true
				if request.Score > player.Score {
					room.Players[i].Score = request.Score
				}
				room.Players[i].Submitted = request.Submitted
				break
			}
		}
		if !found && len(room.Players) < 8 {
			room.Players = append(room.Players, request)
		} else if !found {
			roomsMu.Unlock()
			http.Error(w, "room is full", http.StatusConflict)
			return
		}
		allSubmitted := len(room.Players) >= 2
		for _, player := range room.Players {
			allSubmitted = allSubmitted && player.Submitted
		}
		if allSubmitted {
			room.Finished = true
			winner := room.Players[0]
			for _, player := range room.Players[1:] {
				if player.Score > winner.Score {
					winner = player
				}
			}
			room.Winner = winner.Name
		}
	}
	result := *room
	roomsMu.Unlock()
	json.NewEncoder(w).Encode(result)
}

func playerHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		name := strings.TrimSpace(r.URL.Query().Get("name"))
		if name == "" {
			http.Error(w, "missing player name", http.StatusBadRequest)
			return
		}
		playersMu.Lock()
		p, ok := players[strings.ToLower(name)]
		playersMu.Unlock()
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(p)
	case http.MethodPost:
		var p Player
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil || strings.TrimSpace(p.Name) == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		p.Name = strings.TrimSpace(p.Name)
		if len(p.Name) > 20 {
			p.Name = p.Name[:20]
		}
		if p.Coins < 0 || p.LifetimeCoins < 0 {
			http.Error(w, "invalid player progress", http.StatusBadRequest)
			return
		}
		if p.Achievements == nil {
			p.Achievements = []string{}
		}
		if p.Purchases == nil {
			p.Purchases = map[string]int{}
		}
		if p.Inventory == nil {
			p.Inventory = map[string]int{}
		}
		if p.Stats == nil {
			p.Stats = map[string]int{}
		}
		p.SavedAt = time.Now().UTC().Format(time.RFC3339)

		playersMu.Lock()
		players[strings.ToLower(p.Name)] = p
		err := savePlayers()
		playersMu.Unlock()
		if err != nil {
			log.Printf("error saving player progress: %v", err)
			http.Error(w, "could not save player progress", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func loadPlayers() {
	playersMu.Lock()
	defer playersMu.Unlock()

	b, err := os.ReadFile(playersDataFile)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("warning: could not read %s: %v", playersDataFile, err)
		}
		return
	}
	if err := json.Unmarshal(b, &players); err != nil {
		log.Printf("warning: could not parse %s: %v", playersDataFile, err)
		players = map[string]Player{}
	}
}

func savePlayers() error {
	// caller must hold playersMu
	b, err := json.MarshalIndent(players, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(playersDataFile, b, 0o644)
}

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

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(sorted)

	case http.MethodPost:
		var e Entry
		if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		e.Name = strings.TrimSpace(e.Name)
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
		e.Diff = strings.ToLower(strings.TrimSpace(e.Diff))
		if e.Diff != "easy" && e.Diff != "medium" && e.Diff != "hard" && e.Diff != "daily" {
			http.Error(w, "invalid difficulty", http.StatusBadRequest)
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
	loadPlayers()
	go func() {
		ticker := time.NewTicker(15 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			cleanupRooms()
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/leaderboard", leaderboardHandler)
	mux.HandleFunc("/api/player", playerHandler)
	mux.HandleFunc("/api/rooms", roomHandler)
	mux.HandleFunc("/api/rooms/", roomHandler)
	mux.Handle("/", http.FileServer(http.Dir("./static")))

	addr := ":8080"
	log.Printf("Imperative in Go quiz server listening on http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, withRecovery(mux)))
}
