package main

// Player progress storage (replaces my earlier players.go).
//
// In main.go, DELETE: the Player type, the `players` / `playersMu` vars, and
// playerHandler, loadPlayers, savePlayers. Keep the playersDataFile const and
// the calls in main(). Nothing else in main.go changes.

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	maxPlayerBody  = 512 << 10 // whole request body
	maxDataBytes   = 400 << 10 // the game-state blob
	maxNameRunes   = 20
	minPinLen      = 4
	maxPinFailures = 5
	lockoutFor     = 10 * time.Minute
)

// Player is what the API sends and receives. Data is the browser's full game
// state (coins, inventory, stats, memory...) and is opaque to the server.
// Coins/LifetimeCoins are duplicated at the top level so the server can
// validate them and you can query them later without parsing Data.
type Player struct {
	Name          string          `json:"name"`
	Coins         int             `json:"coins"`
	LifetimeCoins int             `json:"lifetimeCoins"`
	Data          json.RawMessage `json:"data,omitempty"`
	SavedAt       string          `json:"savedAt"`
	// Version increments on every save. Clients send the version they last
	// saw; a stale one (another device saved in between) gets a 409.
	Version int `json:"version"`
}

// storedPlayer is what lives on disk: Player plus PIN credentials, which are
// never sent to clients.
type storedPlayer struct {
	Player
	Salt string `json:"salt,omitempty"`
	Hash string `json:"hash,omitempty"`
}

type failInfo struct {
	count int
	until time.Time
}

var (
	players   = map[string]storedPlayer{}
	pinFails  = map[string]*failInfo{} // guarded by playersMu
	playersMu sync.Mutex
)

func normName(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > maxNameRunes {
		s = string([]rune(s)[:maxNameRunes])
	}
	return s
}

func newSalt() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err) // recovered by withRecovery
	}
	return hex.EncodeToString(b)
}

func hashPin(salt, pin string) string {
	sum := sha256.Sum256([]byte(salt + ":" + pin))
	return hex.EncodeToString(sum[:])
}

// pinOK: entries with no Hash are unclaimed (saved before PINs existed);
// the first POST with a PIN claims them.
func (s storedPlayer) pinOK(pin string) bool {
	if s.Hash == "" {
		return true
	}
	return subtle.ConstantTimeCompare([]byte(hashPin(s.Salt, pin)), []byte(s.Hash)) == 1
}

// authorize must be called with playersMu held. Returns 0 if OK, else an
// HTTP status. A 4-digit PIN is only 10,000 guesses, so wrong attempts are
// counted per name and lock that name out for a while.
func authorize(key string, sp storedPlayer, pin string) int {
	f := pinFails[key]
	if f != nil && time.Now().Before(f.until) {
		return http.StatusTooManyRequests
	}
	if sp.pinOK(pin) {
		delete(pinFails, key)
		return 0
	}
	if f == nil {
		f = &failInfo{}
		pinFails[key] = f
	}
	f.count++
	if f.count >= maxPinFailures {
		f.count = 0
		f.until = time.Now().Add(lockoutFor)
	}
	return http.StatusUnauthorized
}

func authError(w http.ResponseWriter, code int) {
	if code == http.StatusTooManyRequests {
		http.Error(w, "too many wrong PINs, try again in a few minutes", code)
		return
	}
	http.Error(w, "wrong PIN", code)
}

func writePlayerJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func playerHandler(w http.ResponseWriter, r *http.Request) {
	pin := r.Header.Get("X-Player-Pin")

	switch r.Method {
	case http.MethodGet:
		name := normName(r.URL.Query().Get("name"))
		if name == "" {
			http.Error(w, "missing player name", http.StatusBadRequest)
			return
		}
		key := strings.ToLower(name)

		playersMu.Lock()
		defer playersMu.Unlock()
		sp, ok := players[key]
		if !ok {
			http.NotFound(w, r)
			return
		}
		if code := authorize(key, sp, pin); code != 0 {
			authError(w, code)
			return
		}
		writePlayerJSON(w, http.StatusOK, sp.Player)

	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, maxPlayerBody)
		var in Player
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		in.Name = normName(in.Name)
		if in.Name == "" {
			http.Error(w, "player name required", http.StatusBadRequest)
			return
		}
		if utf8.RuneCountInString(pin) < minPinLen {
			http.Error(w, "PIN must be at least 4 characters", http.StatusBadRequest)
			return
		}
		if in.Coins < 0 || in.LifetimeCoins < 0 {
			http.Error(w, "invalid player progress", http.StatusBadRequest)
			return
		}
		if len(in.Data) > maxDataBytes || (len(in.Data) > 0 && in.Data[0] != '{') {
			http.Error(w, "invalid game data", http.StatusBadRequest)
			return
		}

		key := strings.ToLower(in.Name)

		playersMu.Lock()
		defer playersMu.Unlock()

		old, existed := players[key]
		next := storedPlayer{Player: in, Salt: old.Salt, Hash: old.Hash}
		if existed {
			if code := authorize(key, old, pin); code != 0 {
				authError(w, code)
				return
			}
			if in.Version != old.Version {
				// Another device saved since this client last synced.
				writePlayerJSON(w, http.StatusConflict, old.Player)
				return
			}
		}
		if next.Hash == "" {
			next.Salt = newSalt()
			next.Hash = hashPin(next.Salt, pin)
		}
		next.Version = old.Version + 1
		next.SavedAt = time.Now().UTC().Format(time.RFC3339)

		players[key] = next
		if err := savePlayers(); err != nil {
			// roll back so memory and disk agree
			if existed {
				players[key] = old
			} else {
				delete(players, key)
			}
			log.Printf("error saving player progress: %v", err)
			http.Error(w, "could not save player progress", http.StatusInternalServerError)
			return
		}
		writePlayerJSON(w, http.StatusOK, next.Player)

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
		players = map[string]storedPlayer{}
	}
}

// savePlayers writes atomically (temp file + rename) so a crash mid-write
// can't corrupt players.json. Caller must hold playersMu.
func savePlayers() error {
	b, err := json.Marshal(players)
	if err != nil {
		return err
	}
	tmp := playersDataFile + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, playersDataFile)
}
