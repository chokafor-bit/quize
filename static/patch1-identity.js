// ═════════════════════════════════════════════════════════════════
// PATCH 1 of 2, in index.html's <script>:
//
// DELETE everything from the line
//     // ── PLAYER IDENTITY & PERSISTENT PROGRESS ─────...
// up to (but NOT including)
//     function togglePinField() {
// (that removes REGISTRY_KEY, loadRegistry and registerNamePin), and paste
// this block in its place.
// ═════════════════════════════════════════════════════════════════

// ── PLAYER IDENTITY & PERSISTENT PROGRESS ────────────────────
// Named players: progress lives on the Go server (/api/player), keyed by
// name and protected by a 4-digit PIN that the server stores hashed. Any
// device or browser can load it by typing the same name + PIN.
// Guests (no name): progress stays in this browser only, via window.storage.
const ANON_KEY = 'quiz-progress-anon';
let currentStorageKey = ANON_KEY;   // only used for guests and legacy import
let currentStorageShared = false;
let currentPin = '';                // kept in memory only, never written to disk
let serverVersion = 0;              // version of the server copy we last saw

function slugify(name) {
  const slug = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\-]/g, '');
  return slug || 'anon';
}

function playerKey(slug) {
  return 'player:' + slug;
}

