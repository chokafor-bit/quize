// ═════════════════════════════════════════════════════════════════
// PATCH 2 of 2, in index.html's <script>:
//
// DELETE everything from the line
//     async function enterApp() {
// up to (but NOT including) the line
//     // ── GAME MEMORY: recording what the player does ─────...
// (that removes enterApp, loadPlayer, saveState, buildPlayerSnapshot,
// savePlayerProgress and queuePlayerSave), and paste this block in its place.
//
// Also, optionally, in togglePinField() change the hint text to:
//   "New name? Pick any 4 digits. Your progress is saved on the server, so you can pick it up on any device with the same name and PIN."
// ═════════════════════════════════════════════════════════════════

const PLAYER_API = '/api/player';

// Returns { status: 200, data } | { status: 404 | 401 | 429 }; throws if the server is unreachable.
async function fetchPlayer(name, pin) {
  const res = await fetch(`${PLAYER_API}?name=${encodeURIComponent(name)}`, {
    headers: { 'X-Player-Pin': pin },
    cache: 'no-store'
  });
  if (res.status === 200) return { status: 200, data: await res.json() };
  if (res.status === 404 || res.status === 401 || res.status === 429) return { status: res.status };
  throw new Error('Server error ' + res.status);
}

async function enterApp() {
  const nameInput = document.getElementById('visitorName');
  const pinWrap = document.getElementById('pinFormWrap');
  const pinInput = document.getElementById('visitorPin');
  const pinHint = document.getElementById('pinHint');
  const name = nameInput.value.trim();

  // Push any unsaved progress from the previous player before switching identity.
  if (dirty) await flushServerSave();
  clearTimeout(saveTimer);
  dirty = false;

  if (!name) {
    visitorName = '';
    currentPin = '';
    await loadPlayer('', null, null);
    return;
  }

  // Name entered but the PIN field isn't showing yet: reveal it and stop here.
  if (pinWrap.style.display === 'none') {
    togglePinField();
    pinInput.focus();
    return;
  }

  const pin = pinInput.value.trim();
  if (!/^\d{4}$/.test(pin)) {
    pinHint.textContent = '⚠️ Enter exactly 4 digits.';
    pinHint.style.color = '#ff8f8f';
    pinInput.focus();
    return;
  }

  const btn = document.querySelector('.enter-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    const r = await fetchPlayer(name, pin);
    if (r.status === 401) {
      pinHint.textContent = '⚠️ Wrong PIN for that name. Try again, or use a different name.';
      pinHint.style.color = '#ff8f8f';
      pinInput.value = '';
      pinInput.focus();
      return;
    }
    if (r.status === 429) {
      pinHint.textContent = '⚠️ Too many wrong PINs for that name. Wait a few minutes and try again.';
      pinHint.style.color = '#ff8f8f';
      return;
    }
    visitorName = name;
    currentPin = pin;
    await loadPlayer(name, slugify(name), r.status === 200 ? r.data : null);
  } catch (e) {
    console.warn('Login failed:', e);
    pinHint.textContent = '⚠️ Could not reach the server. Check your connection and try again.';
    pinHint.style.color = '#ff8f8f';
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// Build `state` from a saved object (from the server, or a guest's local save).
function hydrateState(loaded) {
  state = defaultState();
  if (!loaded) return;

  // coins, achievements and items bought
  state.coins = typeof loaded.coins === 'number' ? loaded.coins : 0;
  state.achievements = (Array.isArray(loaded.achievements) ? loaded.achievements : [])
    .filter(id => ACHIEVEMENTS.some(a => a.id === id));
  state.inventory = Object.assign(emptyCounts(), loaded.inventory || {});

  // stats (correct answers, failed answers, streaks ...)
  const ls = loaded.stats || {};
  state.stats = Object.assign(state.stats, ls);
  state.stats.purchases = Object.assign(emptyCounts(), ls.purchases || {});
  state.stats.levelsPlayed = Object.assign({ easy: false, medium: false, hard: false }, ls.levelsPlayed || {});
  // Saves from before failed answers were tracked: everything that wasn't correct counts as failed
  if (ls.failedTotal === undefined) {
    state.stats.failedTotal = Math.max(0, (ls.questionsTotal || 0) - (ls.correctTotal || 0));
  }

  // game memory (missed questions, round history, activity log)
  const lm = loaded.memory || {};
  const dm = defaultMemory();
  LEVELS.forEach(l => { dm.byLevel[l] = Object.assign(dm.byLevel[l], (lm.byLevel || {})[l] || {}); });
  state.memory = {
    byLevel: dm.byLevel,
    missed: lm.missed && typeof lm.missed === 'object' ? lm.missed : {},
    rounds: Array.isArray(lm.rounds) ? lm.rounds : [],
    log: Array.isArray(lm.log) ? lm.log : []
  };
}

// serverData: the server's record for this player, or null if the name is new.
async function loadPlayer(name, slug, serverData) {
  const isNamed = !!name;
  currentStorageKey = isNamed ? playerKey(slug) : ANON_KEY;
  currentStorageShared = false;
  serverVersion = 0;

  let loaded = null;
  if (isNamed) {
    if (serverData) serverVersion = serverData.version || 0;
    if (serverData && serverData.data) {
      loaded = serverData.data;
    } else {
      // Nothing on the server yet: import an older save from this browser
      // (from before progress moved to the server), if there is one.
      try {
        const res = await window.storage.get(playerKey(slug), true);
        if (res && res.value) loaded = JSON.parse(res.value);
      } catch (e) { /* no old local save */ }
    }
  } else {
    try {
      const res = await window.storage.get(ANON_KEY, false);
      if (res && res.value) loaded = JSON.parse(res.value);
    } catch (e) { /* no guest save yet */ }
  }

  const isReturning = !!loaded;
  hydrateState(loaded);

  const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  if (isNamed && isReturning) {
    welcomeBase = `Welcome back, ${name}! 🪙 ${state.coins} coins waiting for you.`;
  } else if (isNamed) {
    welcomeBase = `Hey ${name}! ${greeting}`;
  } else {
    welcomeBase = greeting;
  }

  logActivity('session', isReturning ? 'Came back and resumed from saved progress' : 'Started playing');
  show('startScreen');
  refreshCoinDisplays();
  if (isNamed && isReturning) {
    const s = state.stats;
    showToast('👋', 'Welcome back!', `${name}: ${state.coins} coins, ${s.correctTotal || 0} correct, ${s.failedTotal || 0} failed`);
  }
  saveState();
  if (isNamed) flushServerSave();   // claim the name / upload imported progress right away
}

// ── SAVING ─────────────────────────────────────────────────────
// Named players save to the server (debounced). Guests save to this browser.
async function saveState() {
  if (visitorName) { queueServerSave(); return; }
  try { await window.storage.set(currentStorageKey, JSON.stringify(state), false); }
  catch (e) { console.error('Could not save progress', e); }
}

let saveTimer = null, saving = false, dirty = false, saveWarned = false;

function queueServerSave(delay) {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushServerSave, delay || 800);
}

async function flushServerSave(opts) {
  clearTimeout(saveTimer);
  if (!visitorName || !currentPin) return;
  if (saving) { dirty = true; return; }

  const who = visitorName;          // guard against an identity switch mid-request
  saving = true;
  dirty = false;
  let failed = false;
  try {
    const res = await fetch(PLAYER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Player-Pin': currentPin },
      keepalive: !!(opts && opts.keepalive),   // lets the save finish while the tab closes
      body: JSON.stringify({
        name: who,
        coins: state.coins,
        lifetimeCoins: state.stats.lifetimeCoins || 0,
        version: serverVersion,
        data: state
      })
    });
    if (res.status === 409) {
      // Another device saved newer progress. The server copy wins.
      const server = await res.json();
      serverVersion = server.version;
      dirty = false;
      if (who === visitorName && server.data) {
        hydrateState(server.data);
        refreshInventoryUI();
        refreshStartSummary();
        showToast('🔄', 'Progress updated', 'Loaded newer progress saved from another device');
      }
      return;
    }
    if (!res.ok) throw new Error('Server error ' + res.status);
    serverVersion = (await res.json()).version;
    saveWarned = false;
  } catch (e) {
    failed = true;
    dirty = true;
    console.warn('Could not save progress to server:', e);
    if (!saveWarned) {
      saveWarned = true;
      showToast('⚠️', 'Not saved yet', "Can't reach the server. Will keep retrying.");
    }
  } finally {
    saving = false;
    if (dirty && who === visitorName) queueServerSave(failed ? 5000 : 800);
  }
}

// Don't lose the last few seconds of progress when the tab is closed or hidden.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && dirty) flushServerSave({ keepalive: true });
});
window.addEventListener('pagehide', () => {
  if (dirty) flushServerSave({ keepalive: true });
});

