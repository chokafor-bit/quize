// ── QUESTION LEVELS ────────────────────────────────────────────
// Every question carries its own level ("easy" | "medium" | "hard").
// The level decides the timer, the coins earned and which round pool
// the question belongs to.
const LEVELS = ['easy', 'medium', 'hard'];
const LEVEL_META = {
  easy:   { label: 'Easy',   time: 30, coins: 2 },
  medium: { label: 'Medium', time: 25, coins: 3 },
  hard:   { label: 'Hard',   time: 15, coins: 5 }
};
function levelOf(q) {
  return q && LEVEL_META[q.level] ? q.level : 'medium';
}

// Stable id per question so the memory can remember which ones were missed.
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
ALL_QUESTIONS.forEach(q => {
  q.id = 'q' + hashStr(q.q + '|' + (q.code || '') + '|' + q.options.join('|'));
});

const QUESTIONS_PER_ROUND = 15;
const DAILY_QUESTION_COUNT = 10;
const MAX_LOG = 80;      // activity entries kept per player
const MAX_ROUNDS = 30;   // round summaries kept per player

let questions = [], current = 0, score = 0, answered = false, streak = 0;
let difficulty = 'easy';
let timerSeconds = 30, timerTotal = 30, timerInterval = null;
let visitorName = '';
let welcomeBase = '';
let isDailyMode = false;
let isPracticeMode = false;
let lastRoundDiff = 'easy';   // 'easy' | 'medium' | 'hard' | 'daily' | 'practice'
let lbFilter = 'all';         // which leaderboard tab is selected
let lbCache = [];             // last leaderboard payload from the server
let coinsEarnedThisRound = 0; // track coins earned during this quiz
let boosterActive = false;    // 2x coins for the rest of the round
let roundPowerUps = 0;        // power-ups used this round (for "Pure Skill")
let hintUsedThisQuestion = false;
let retryUsedThisQuestion = false;
let questionStartedAt = 0;
const letters = ['A','B','C','D'];

const GREETINGS = [
  "Ready to level up? 🚀",
  "Let's see what you know! 💡",
  "Time to prove your Go skills! 💪",
  "A new challenger approaches! ⚔️",
  "Gopher mode: activated 🐹",
  "Hey there, think fast like a coder! ⚡",
  "May the best Gopher win! 🏆"
];


function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SCREENS = ['welcomeScreen','startScreen','quizScreen','scoreScreen','lbScreen','shopScreen','achScreen','dailyScreen','memScreen'];
function show(id) {
  SCREENS.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? 'block' : 'none';
  });
  document.getElementById('progressArea').style.display =
    (id === 'quizScreen' || id === 'scoreScreen') ? 'block' : 'none';
  if (id === 'startScreen') refreshStartSummary();
}

// ── STORAGE FALLBACK ─────────────────────────────────────────
// Inside Claude artifacts, window.storage is provided by the host.
// On your own Go server it doesn't exist, so we fall back to
// localStorage. NOTE: with the fallback, "shared" data is only shared
// within this one browser, not across devices.
if (typeof window.storage === 'undefined') {
  const prefix = (shared) => (shared ? 'shared:' : 'personal:');
  window.storage = {
    async get(key, shared) {
      const v = localStorage.getItem(prefix(shared) + key);
      if (v === null) throw new Error('Key not found: ' + key);
      return { key, value: v, shared: !!shared };
    },
    async set(key, value, shared) {
      localStorage.setItem(prefix(shared) + key, value);
      return { key, value, shared: !!shared };
    },
    async delete(key, shared) {
      localStorage.removeItem(prefix(shared) + key);
      return { key, deleted: true, shared: !!shared };
    },
    async list(pfx, shared) {
      const p = prefix(shared) + (pfx || '');
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(p)) keys.push(k.slice(prefix(shared).length));
      }
      return { keys, prefix: pfx, shared: !!shared };
    }
  };
}

// ── PLAYER IDENTITY & PERSISTENT PROGRESS ────────────────────
// Progress (coins, achievements, inventory, stats, game memory) is keyed
// by the name a player types in on the welcome screen, using SHARED
// storage. A 4-digit PIN goes alongside the name so two different people
// typing the same name don't collide. It's kept in a shared "registry"
// record (name-slug -> pin). This is a lightweight collision guard, not
// real account security: the PIN is stored in plain text and there is no
// way to recover a forgotten one other than picking a new name.
const ANON_KEY = 'quiz-progress-anon';
const REGISTRY_KEY = 'name-registry';
let currentStorageKey = ANON_KEY;
let currentStorageShared = false;

function slugify(name) {
  const slug = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\-]/g, '');
  return slug || 'anon';
}

function playerKey(slug) {
  return 'player:' + slug;
}

async function loadRegistry() {
  try {
    const res = await window.storage.get(REGISTRY_KEY, true);
    if (res && res.value) return JSON.parse(res.value);
  } catch (e) {
    // no registry saved yet
  }
  return {};
}

async function registerNamePin(slug, pin) {
  const reg = await loadRegistry();
  reg[slug] = pin;
  try { await window.storage.set(REGISTRY_KEY, JSON.stringify(reg), true); }
  catch (e) { console.error('Could not save name registry', e); }
}

function togglePinField() {
  const name = document.getElementById('visitorName').value.trim();
  const wrap = document.getElementById('pinFormWrap');
  const hint = document.getElementById('pinHint');
  if (name) {
    wrap.style.display = 'block';
    hint.textContent = "New name? Pick any 4 digits — you'll need the same ones next time to get this exact save back.";
    hint.style.color = '#666';
  } else {
    wrap.style.display = 'none';
  }
}

function emptyCounts() {
  const o = {};
  SHOP_ITEMS.forEach(i => { o[i.id] = 0; });
  return o;
}

function defaultMemory() {
  return {
    byLevel: {
      easy:   { correct: 0, failed: 0 },
      medium: { correct: 0, failed: 0 },
      hard:   { correct: 0, failed: 0 }
    },
    missed: {},   // questionId -> { q, level, misses, cleared, lastMissed }
    rounds: [],   // newest first: { t, mode, score, total, coins, practice }
    log: []       // newest first: { t, type, text }
  };
}

function defaultState() {
  return {
    coins: 0,
    achievements: [],
    inventory: emptyCounts(),
    stats: {
      gamesPlayed: 0, correctTotal: 0, failedTotal: 0, timeoutTotal: 0, skippedTotal: 0,
      clearedTotal: 0, questionsTotal: 0, bestScore: 0, bestStreak: 0,
      perfectRounds: 0, hardPerfect: 0, pureRounds: 0, fastAnswers: 0,
      dailyStreak: 0, lastDailyDate: null,
      itemsBought: 0, hardCompleted: 0, lifetimeCoins: 0,
      levelsPlayed: { easy: false, medium: false, hard: false },
      purchases: emptyCounts()   // total bought per shop item
    },
    memory: defaultMemory()
  };
}

let state = defaultState();

async function enterApp() {
  const nameInput = document.getElementById('visitorName');
  const pinWrap = document.getElementById('pinFormWrap');
  const pinInput = document.getElementById('visitorPin');
  const pinHint = document.getElementById('pinHint');
  const name = nameInput.value.trim();

  if (!name) {
    visitorName = '';
    await loadPlayer('', null);
    return;
  }

  // Name entered but the PIN field isn't showing yet — reveal it and stop here.
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

  const slug = slugify(name);
  const registry = await loadRegistry();
  if (registry[slug]) {
    if (registry[slug] !== pin) {
      pinHint.textContent = '⚠️ Wrong PIN for that name. Try again, or use a different name.';
      pinHint.style.color = '#ff8f8f';
      pinInput.value = '';
      pinInput.focus();
      return;
    }
  } else {
    await registerNamePin(slug, pin);
  }

  visitorName = name;
  await loadPlayer(name, slug);
}

async function loadPlayer(name, slug) {
  const isNamed = !!name;
  currentStorageKey = isNamed ? playerKey(slug) : ANON_KEY;
  currentStorageShared = isNamed; // named players are stored in shared space so any device can find them by name+PIN

  let loaded = null;
  try {
    const res = await window.storage.get(currentStorageKey, currentStorageShared);
    if (res && res.value) loaded = JSON.parse(res.value);
  } catch (e) {
    // no saved progress under this key yet
  }

  const isReturning = !!loaded;
  state = defaultState();
  if (loaded) {
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
    showToast('👋', 'Welcome back!', `${name} — ${state.coins} coins, ${s.correctTotal || 0} correct, ${s.failedTotal || 0} failed`);
  }
  saveState();
}

async function saveState() {
  try { await window.storage.set(currentStorageKey, JSON.stringify(state), currentStorageShared); }
  catch (e) { console.error('Could not save progress', e); }
  queuePlayerSave();   // also push the player summary to the server
}

// ── PLAYER SUMMARY (sent to the Go server) ─────────────────────
function buildPlayerSnapshot() {
  const s = state.stats, m = state.memory;
  return {
    name: visitorName,
    coins: state.coins,
    lifetimeCoins: s.lifetimeCoins || 0,
    achievements: ACHIEVEMENTS
      .filter(a => state.achievements.includes(a.id))
      .map(a => ({ id: a.id, name: a.name })),
    purchases: Object.assign({}, s.purchases || {}),   // total bought, per item
    inventory: Object.assign({}, state.inventory),     // currently owned
    stats: {
      correct: s.correctTotal || 0,
      failed: s.failedTotal || 0,
      timedOut: s.timeoutTotal || 0,
      skipped: s.skippedTotal || 0,
      cleared: s.clearedTotal || 0,
      questionsAnswered: s.questionsTotal || 0,
      gamesPlayed: s.gamesPlayed || 0,
      bestScore: s.bestScore || 0,
      bestStreak: s.bestStreak || 0,
      dailyStreak: s.dailyStreak || 0
    },
    byLevel: m.byLevel,
    missedQuestions: Object.values(m.missed)
      .filter(x => !x.cleared)
      .map(x => ({ q: x.q, level: x.level, misses: x.misses })),
    recentActivity: m.log.slice(0, 20),
    savedAt: new Date().toISOString()
  };
}

async function savePlayerProgress() {
  if (!visitorName) return false;            // anonymous players aren't saved
  const snapshot = buildPlayerSnapshot();

  // 1) local backup (works even if the server is down)
  try {
    localStorage.setItem('gopher-quiz:' + slugify(snapshot.name), JSON.stringify(snapshot));
  } catch (e) { /* storage unavailable, ignore */ }

  // 2) server copy (needs a POST /api/player route on the Go server)
  try {
    const res = await fetch('/api/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot)
    });
    if (!res.ok) throw new Error('Server error ' + res.status);
    return true;
  } catch (e) {
    console.warn('Could not save player progress to server:', e);
    return false;
  }
}

// Debounced, so rapid coin/answer updates don't spam the server
let playerSaveTimer = null;
function queuePlayerSave() {
  clearTimeout(playerSaveTimer);
  playerSaveTimer = setTimeout(savePlayerProgress, 800);
}

// ── GAME MEMORY: recording what the player does ───────────────
function clip(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function logActivity(type, text) {
  const log = state.memory.log;
  log.unshift({ t: Date.now(), type, text });
  if (log.length > MAX_LOG) log.length = MAX_LOG;
}

// result: 'correct' | 'wrong' | 'timeout' | 'skip'
function recordAnswer(q, result) {
  const level = levelOf(q);
  const mem = state.memory;
  const lv = mem.byLevel[level];
  const tag = `[${LEVEL_META[level].label}] ${clip(q.q, 70)}`;
  state.stats.questionsTotal = (state.stats.questionsTotal || 0) + 1;

  if (result === 'correct') {
    state.stats.correctTotal = (state.stats.correctTotal || 0) + 1;
    lv.correct++;
    const m = mem.missed[q.id];
    if (m && !m.cleared) {
      m.cleared = true;
      state.stats.clearedTotal = (state.stats.clearedTotal || 0) + 1;
      logActivity('clear', 'Cleared a missed question: ' + tag);
    } else {
      logActivity('correct', 'Correct: ' + tag);
    }
  } else if (result === 'wrong' || result === 'timeout') {
    state.stats.failedTotal = (state.stats.failedTotal || 0) + 1;
    if (result === 'timeout') state.stats.timeoutTotal = (state.stats.timeoutTotal || 0) + 1;
    lv.failed++;
    const m = mem.missed[q.id] || (mem.missed[q.id] = { q: q.q, level, misses: 0, cleared: false, lastMissed: 0 });
    m.misses++;
    m.cleared = false;
    m.lastMissed = Date.now();
    logActivity(result === 'timeout' ? 'timeout' : 'wrong', (result === 'timeout' ? 'Ran out of time: ' : 'Wrong: ') + tag);
  } else if (result === 'skip') {
    state.stats.skippedTotal = (state.stats.skippedTotal || 0) + 1;
    logActivity('skip', 'Skipped: ' + tag);
  }
}

// ── COINS, TOASTS ──────────────────────────────────────────────
function refreshCoinDisplays() {
  ['coinBalance', 'coinInQuiz', 'coinInShop'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = state.coins;
  });
}

function refreshStartSummary() {
  const s = state.stats;
  const crown = (state.inventory.crown || 0) > 0 ? ' 👑' : '';
  const w = document.getElementById('startWelcome');
  if (w) w.textContent = welcomeBase + crown;
  const line = document.getElementById('startMemoryLine');
  if (line) {
    line.textContent = `✅ ${s.correctTotal || 0} correct · ❌ ${s.failedTotal || 0} failed · ` +
      `🛍️ ${s.itemsBought || 0} items bought · 🏅 ${state.achievements.length}/${ACHIEVEMENTS.length}`;
  }
  refreshCoinDisplays();
}

function addCoins(n) {
  state.coins += n;
  coinsEarnedThisRound += n;
  state.stats.lifetimeCoins = (state.stats.lifetimeCoins || 0) + n;
  refreshCoinDisplays();
  showToast('🪙', `+${n} Coins`, `Total this round: ${coinsEarnedThisRound}`);
  saveState();
}

function spendCoins(n) {
  if (state.coins < n) return false;
  state.coins -= n;
  refreshCoinDisplays();
  saveState();
  return true;
}

function showToast(icon, title, desc) {
  const area = document.getElementById('toastArea');
  if (!area) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span class="t-icon">${icon}</span><div><div class="t-title">${escapeHtml(title)}</div><div class="t-desc">${escapeHtml(desc)}</div></div>`;
  area.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ── ACHIEVEMENTS ─────────────────────────────────────────────
function checkAchievements() {
  let changed = false;
  ACHIEVEMENTS.forEach(a => {
    if (!state.achievements.includes(a.id) && a.check(state)) {
      state.achievements.push(a.id);
      showToast(a.icon, 'Achievement Unlocked!', a.name);
      logActivity('achievement', `Unlocked ${a.icon} ${a.name}`);
      changed = true;
    }
  });
  if (changed) saveState();
}

function showAchievements() {
  show('achScreen');
  const list = document.getElementById('achList');
  document.getElementById('achProgress').textContent = `${state.achievements.length} / ${ACHIEVEMENTS.length} unlocked`;
  list.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = state.achievements.includes(a.id);
    return `
      <div class="ach-item ${unlocked ? 'unlocked' : 'locked'}">
        <div class="ai-icon">${unlocked ? a.icon : '🔒'}</div>
        <div class="ai-info">
          <div class="ai-name">${escapeHtml(a.name)}</div>
          <div class="ai-desc">${escapeHtml(a.desc)}</div>
        </div>
      </div>`;
  }).join('');
}

// ── SHOP ─────────────────────────────────────────────────────
function showShop() {
  show('shopScreen');
  refreshCoinDisplays();
  renderShop();
}

function renderShop() {
  const list = document.getElementById('shopList');
  list.innerHTML = SHOP_ITEMS.map(it => {
    const owned = state.inventory[it.id] || 0;
    const maxed = it.kind === 'permanent' && owned >= 1;
    const disabled = maxed || state.coins < it.price;
    return `
    <div class="shop-item">
      <div class="si-icon">${it.icon}</div>
      <div class="si-info">
        <div class="si-name">${escapeHtml(it.name)}<span class="shop-kind">${KIND_LABEL[it.kind]}</span></div>
        <div class="si-desc">${escapeHtml(it.desc)}</div>
        <div class="si-owned">${maxed ? 'Owned ✓' : 'Owned: ' + owned}</div>
      </div>
      <button class="buy-btn" ${disabled ? 'disabled' : ''} onclick="buyItem('${it.id}')">${maxed ? '✓' : '🪙 ' + it.price}</button>
    </div>`;
  }).join('');
}

function buyItem(id) {
  const item = SHOP_ITEMS.find(i => i.id === id);
  if (!item) return;
  if (item.kind === 'permanent' && (state.inventory[id] || 0) >= 1) return;
  if (!spendCoins(item.price)) return;
  state.inventory[id] = (state.inventory[id] || 0) + 1;
  state.stats.itemsBought = (state.stats.itemsBought || 0) + 1;
  state.stats.purchases = state.stats.purchases || {};
  state.stats.purchases[id] = (state.stats.purchases[id] || 0) + 1;
  logActivity('buy', `Bought ${item.icon} ${item.name} for ${item.price} coins`);
  showToast(item.icon, 'Purchased!', item.name);
  saveState();
  checkAchievements();
  renderShop();
}

// ── DAILY CHALLENGE ──────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function isYesterdayStr(dateStr) {
  if (!dateStr) return false;
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateStr === `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function dateSeed(dateStr) {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) { h = (h * 31 + dateStr.charCodeAt(i)) | 0; }
  return Math.abs(h) || 1;
}

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function seededShuffle(arr, seed) {
  const rand = seededRandom(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showDailyChallenge() {
  show('dailyScreen');
  document.getElementById('dailyStreakNum').textContent = state.stats.dailyStreak || 0;
  const done = state.stats.lastDailyDate === todayStr();
  document.getElementById('dailyDoneBadge').style.display = done ? 'inline-block' : 'none';
  document.getElementById('dailyStartBtn').style.display = done ? 'none' : 'block';
}

// ── STARTING A ROUND ─────────────────────────────────────────
function resetRound() {
  current = 0; score = 0; answered = false; streak = 0;
  boosterActive = false; roundPowerUps = 0;
  coinsEarnedThisRound = 0;
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('savedMsg').style.display = 'none';
  const nameBox = document.getElementById('playerName');
  nameBox.value = '';
  nameBox.disabled = false;
  document.getElementById('quitConfirmBox').style.display = 'none';
}

function setDiff(d, btn) {
  difficulty = d;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// Normal round: only questions of the chosen level.
function startQuiz() {
  isDailyMode = false;
  isPracticeMode = false;
  lastRoundDiff = difficulty;
  const pool = ALL_QUESTIONS.filter(q => levelOf(q) === difficulty);
  questions = shuffle(pool).slice(0, QUESTIONS_PER_ROUND);
  resetRound();
  show('quizScreen');
  loadQuestion();
}

// Daily: same 10 questions for everyone today — 4 easy, then 3 medium, then 3 hard.
function startDailyChallenge() {
  isDailyMode = true;
  isPracticeMode = false;
  lastRoundDiff = 'daily';
  const shuffled = seededShuffle(ALL_QUESTIONS, dateSeed(todayStr()));
  const pick = (lvl, n) => shuffled.filter(q => levelOf(q) === lvl).slice(0, n);
  questions = [...pick('easy', 4), ...pick('medium', 3), ...pick('hard', 3)];
  resetRound();
  show('quizScreen');
  loadQuestion();
}

// Practice: replay the questions this player has missed and not yet cleared.
function startPractice() {
  const seen = new Set();
  const pool = ALL_QUESTIONS.filter(q => {
    const m = state.memory.missed[q.id];
    if (!m || m.cleared || seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });
  if (!pool.length) {
    showToast('🎉', 'Nothing to review', 'You have no missed questions');
    return;
  }
  isDailyMode = false;
  isPracticeMode = true;
  lastRoundDiff = 'practice';
  questions = shuffle(pool).slice(0, QUESTIONS_PER_ROUND);
  resetRound();
  show('quizScreen');
  loadQuestion();
}

// ── QUIT ─────────────────────────────────────────────────────
function requestQuit() {
  if (answered) return;
  stopTimer();
  document.getElementById('quitConfirmBox').style.display = 'block';
}

function cancelQuit() {
  document.getElementById('quitConfirmBox').style.display = 'none';
  if (!answered) resumeTimer();
}

function confirmQuit() {
  document.getElementById('quitConfirmBox').style.display = 'none';
  stopTimer();
  isDailyMode = false;
  isPracticeMode = false;
  show('startScreen');
  refreshCoinDisplays();
}

// ── TIMER (each question uses its own level's time) ───────────
function startTimer() {
  clearInterval(timerInterval);
  timerTotal = LEVEL_META[levelOf(questions[current])].time;
  timerSeconds = timerTotal;
  updateTimerUI();
  resumeTimer();
}

function resumeTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerSeconds--;
    updateTimerUI();
    if (timerSeconds <= 0) {
      clearInterval(timerInterval);
      timeUp();
    }
  }, 1000);
}

function updateTimerUI() {
  const pct = Math.min(100, Math.max(0, (timerSeconds / timerTotal) * 100));
  const bar = document.getElementById('timerBar');
  const num = document.getElementById('timerNum');
  bar.style.width = pct + '%';
  bar.style.background = timerSeconds <= 5 ? 'var(--wrong)' : timerSeconds <= 10 ? '#f5c842' : 'var(--correct)';
  num.textContent = Math.max(0, timerSeconds);
  num.className = 'timer-num' + (timerSeconds <= 5 ? ' urgent' : '');
}

function stopTimer() { clearInterval(timerInterval); }

// A Streak Shield (if owned) protects the streak from a miss. Returns true if it did.
function spendShield() {
  if (streak > 0 && (state.inventory.shield || 0) > 0) {
    state.inventory.shield--;
    roundPowerUps++;
    logActivity('item', '🛡️ Streak Shield protected a streak of ' + streak);
    return true;
  }
  streak = 0;
  return false;
}

function timeUp() {
  if (answered) return;
  answered = true;
  const q = questions[current];
  document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
  document.querySelectorAll('.option-btn')[q.answer].classList.add('correct');
  const saved = spendShield();
  recordAnswer(q, 'timeout');
  const fb = document.getElementById('feedback');
  fb.textContent = '⏱ Time\'s up! ' + (saved ? '🛡️ Streak Shield protected your streak. ' : '') + q.explanation;
  fb.className = 'feedback wrong-fb show';
  document.getElementById('nextBtn').classList.add('show');
  saveState();
  refreshInventoryUI();
}

// ── QUESTION ───────────────────────────────────────────────────
function loadQuestion() {
  answered = false;
  hintUsedThisQuestion = false;
  retryUsedThisQuestion = false;
  questionStartedAt = Date.now();
  document.getElementById('quitConfirmBox').style.display = 'none';
  const q = questions[current];
  const lvl = levelOf(q);
  document.getElementById('qLabel').textContent = `Question ${current + 1} of ${questions.length}`;
  document.getElementById('scoreLabel').textContent = `Score: ${score}`;
  document.getElementById('progressBar').style.width = `${(current / questions.length) * 100}%`;
  document.getElementById('questionNum').innerHTML =
    `Question ${String(current + 1).padStart(2, '0')}` +
    (isDailyMode ? ' · Daily' : '') + (isPracticeMode ? ' · Practice' : '') +
    `<span class="lb-diff-chip ${lvl}">${LEVEL_META[lvl].label.toUpperCase()} · ${LEVEL_META[lvl].coins}🪙</span>`;
  document.getElementById('questionText').textContent = q.q;

  const codeEl = document.getElementById('codeBlock');
  codeEl.innerHTML = q.code ? `<div class="code-block">${escapeHtml(q.code)}</div>` : '<div class="no-code"></div>';

  const fb = document.getElementById('feedback');
  fb.className = 'feedback'; fb.textContent = ''; fb.removeAttribute('style');
  const nextBtn = document.getElementById('nextBtn');
  nextBtn.className = 'next-btn';
  nextBtn.textContent = current === questions.length - 1 ? 'See Results →' : 'Next Question →';

  const container = document.getElementById('optionsContainer');
  container.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.style.opacity = '';
    btn.innerHTML = `<span class="letter">${letters[i]}</span><span>${escapeHtml(opt)}</span>`;
    btn.onclick = () => selectAnswer(i, btn);
    container.appendChild(btn);
  });

  refreshInventoryUI();
  startTimer();
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function selectAnswer(index, btn) {
  if (answered) return;
  const q = questions[current];
  const level = levelOf(q);
  const isCorrect = index === q.answer;

  // Second Chance: a wrong pick is locked and the player may try once more.
  if (!isCorrect && !retryUsedThisQuestion && (state.inventory.retry || 0) > 0) {
    state.inventory.retry--;
    retryUsedThisQuestion = true;
    roundPowerUps++;
    btn.classList.add('wrong');
    btn.disabled = true;
    logActivity('item', '🔁 Used Second Chance');
    showToast('🔁', 'Second Chance!', 'That option is locked. Pick another answer.');
    saveState();
    refreshInventoryUI();
    return;
  }

  answered = true;
  stopTimer();
  document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
  const fb = document.getElementById('feedback');

  if (isCorrect) {
    btn.classList.add('correct');
    score++;
    streak++;
    if (streak > (state.stats.bestStreak || 0)) state.stats.bestStreak = streak;
    if ((Date.now() - questionStartedAt) / 1000 <= 3) {
      state.stats.fastAnswers = (state.stats.fastAnswers || 0) + 1;
    }

    // coins depend on the question's level, plus bonuses
    let earned = LEVEL_META[level].coins;
    const notes = [];
    if ((state.inventory.charm || 0) > 0) { earned += 1; notes.push('🍀 +1'); }
    if (streak > 0 && streak % 2 === 0) { earned += 2; notes.push('🔥 streak +2'); }
    if (boosterActive) { earned *= 2; notes.push('💎 2×'); }

    recordAnswer(q, 'correct');
    addCoins(earned);
    document.getElementById('scoreLabel').textContent = `Score: ${score}`;
    fb.textContent = `✓ Correct! +${earned} 🪙${notes.length ? ' (' + notes.join(', ') + ')' : ''} ` + q.explanation;
    fb.className = 'feedback correct-fb show';
    checkAchievements();
  } else {
    btn.classList.add('wrong');
    document.querySelectorAll('.option-btn')[q.answer].classList.add('correct');
    const saved = spendShield();
    recordAnswer(q, 'wrong');
    fb.textContent = '✗ Not quite. ' + (saved ? '🛡️ Streak Shield protected your streak. ' : '') + q.explanation;
    fb.className = 'feedback wrong-fb show';
  }
  saveState();
  document.getElementById('nextBtn').classList.add('show');
  refreshInventoryUI();
}

function nextQuestion() {
  current++;
  if (current >= questions.length) { showScore(); } else { loadQuestion(); }
}

// ── POWER-UPS (used during a question) ──────────────────────
const USE_BUTTONS = [
  { id: 'hint50',  btn: 'hintBtn',    count: 'hintCount',    blocked: () => hintUsedThisQuestion },
  { id: 'freeze',  btn: 'freezeBtn',  count: 'freezeCount' },
  { id: 'warp',    btn: 'warpBtn',    count: 'warpCount' },
  { id: 'skip',    btn: 'skipBtn',    count: 'skipCount' },
  { id: 'booster', btn: 'boosterBtn', count: 'boosterCount', blocked: () => boosterActive }
];

function refreshInventoryUI() {
  if (!document.getElementById('hintBtn')) return;
  USE_BUTTONS.forEach(u => {
    const owned = state.inventory[u.id] || 0;
    document.getElementById(u.count).textContent = owned;
    document.getElementById(u.btn).disabled = answered || owned <= 0 || (u.blocked ? u.blocked() : false);
  });

  // status chips for automatic / permanent / active effects
  const chips = [];
  if ((state.inventory.shield || 0) > 0) chips.push(`<span class="passive-chip on">🛡️ Shield ×${state.inventory.shield}</span>`);
  if ((state.inventory.retry || 0) > 0)  chips.push(`<span class="passive-chip on">🔁 Second Chance ×${state.inventory.retry}</span>`);
  if ((state.inventory.charm || 0) > 0)  chips.push(`<span class="passive-chip on">🍀 Lucky Charm +1🪙</span>`);
  if (boosterActive)                     chips.push(`<span class="passive-chip on">💎 2× coins active</span>`);
  const row = document.getElementById('passiveRow');
  if (row) row.innerHTML = chips.join('');
  refreshCoinDisplays();
}

function usePowerUp(id, logText) {
  state.inventory[id]--;
  roundPowerUps++;
  logActivity('item', logText);
  saveState();
}

function useHint() {
  if (answered || hintUsedThisQuestion || !((state.inventory.hint50 || 0) > 0)) return;
  hintUsedThisQuestion = true;
  usePowerUp('hint50', '✂️ Used 50/50 Hint');
  const q = questions[current];
  const buttons = Array.from(document.querySelectorAll('.option-btn'));
  const wrongIdx = buttons.map((b, i) => i).filter(i => i !== q.answer && !buttons[i].disabled);
  shuffle(wrongIdx).slice(0, 2).forEach(i => {
    buttons[i].disabled = true;
    buttons[i].style.opacity = '0.25';
  });
  refreshInventoryUI();
}

function addTime(id, seconds, icon, name) {
  if (answered || !((state.inventory[id] || 0) > 0)) return;
  usePowerUp(id, `${icon} Used ${name}`);
  timerSeconds += seconds;
  updateTimerUI();
  showToast(icon, name, `+${seconds} seconds added`);
  refreshInventoryUI();
}
function useFreeze() { addTime('freeze', 10, '🧊', 'Time Freeze'); }
function useWarp()   { addTime('warp',   20, '⏳', 'Time Warp'); }

function useBooster() {
  if (answered || boosterActive || !((state.inventory.booster || 0) > 0)) return;
  usePowerUp('booster', '💎 Activated Coin Booster');
  boosterActive = true;
  showToast('💎', 'Coin Booster on', '2× coins for the rest of this round');
  refreshInventoryUI();
}

function useSkip() {
  if (answered || !((state.inventory.skip || 0) > 0)) return;
  usePowerUp('skip', '⏭ Used Skip Token');
  answered = true;   // a skip does not break the streak
  stopTimer();
  document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
  const q = questions[current];
  document.querySelectorAll('.option-btn')[q.answer].classList.add('correct');
  recordAnswer(q, 'skip');
  const fb = document.getElementById('feedback');
  fb.textContent = '⏭ Skipped. ' + q.explanation;
  fb.className = 'feedback show';
  fb.style.background = 'rgba(255,255,255,0.04)';
  fb.style.color = 'var(--muted)';
  fb.style.border = '1px solid var(--border)';
  document.getElementById('nextBtn').classList.add('show');
  saveState();
  refreshInventoryUI();
}

// ── SCORE ──────────────────────────────────────────────────────
function showScore() {
  stopTimer();
  document.getElementById('progressBar').style.width = '100%';
  document.getElementById('qLabel').textContent = 'Quiz Complete';
  show('scoreScreen');
  document.getElementById('finalScore').textContent = score;
  document.getElementById('finalTotal').textContent = questions.length;

  const practice = isPracticeMode;
  const daily = isDailyMode;
  const perfect = questions.length > 0 && score === questions.length;
  let bonusCoins = 0;

  if (!practice) {
    state.stats.gamesPlayed = (state.stats.gamesPlayed || 0) + 1;
    if (score > (state.stats.bestScore || 0)) state.stats.bestScore = score;
    if (LEVELS.includes(lastRoundDiff)) {
      state.stats.levelsPlayed[lastRoundDiff] = true;
      if (lastRoundDiff === 'hard') state.stats.hardCompleted = (state.stats.hardCompleted || 0) + 1;
    }
    if (perfect) {
      state.stats.perfectRounds = (state.stats.perfectRounds || 0) + 1;
      if (lastRoundDiff === 'hard') state.stats.hardPerfect = (state.stats.hardPerfect || 0) + 1;
      if (roundPowerUps === 0) state.stats.pureRounds = (state.stats.pureRounds || 0) + 1;
      bonusCoins += 20;
      showToast('💯', 'Perfect Round!', '+20 bonus coins');
    }
  }

  if (daily) {
    const today = todayStr();
    if (state.stats.lastDailyDate !== today) {
      state.stats.dailyStreak = isYesterdayStr(state.stats.lastDailyDate) ? (state.stats.dailyStreak || 0) + 1 : 1;
      state.stats.lastDailyDate = today;
      const streakBonus = Math.min(state.stats.dailyStreak * 2, 50);
      bonusCoins += 15 + streakBonus;
      showToast('🔥', 'Daily Challenge Complete!', `Streak: ${state.stats.dailyStreak} day(s)`);
      logActivity('daily', `Completed the Daily Challenge (streak: ${state.stats.dailyStreak})`);
    }
    isDailyMode = false;
  }
  if (bonusCoins > 0) addCoins(bonusCoins);
  document.getElementById('coinsEarned').textContent = coinsEarnedThisRound;

  // remember this round
  const modeLabel = practice ? 'Practice' : daily ? 'Daily' : (LEVEL_META[lastRoundDiff] ? LEVEL_META[lastRoundDiff].label : lastRoundDiff);
  state.memory.rounds.unshift({
    t: Date.now(), mode: lastRoundDiff, score, total: questions.length,
    coins: coinsEarnedThisRound, practice
  });
  if (state.memory.rounds.length > MAX_ROUNDS) state.memory.rounds.length = MAX_ROUNDS;
  logActivity('round', `${modeLabel} round finished: ${score}/${questions.length}, +${coinsEarnedThisRound} coins`);

  saveState();
  checkAchievements();

  // leaderboard save box (not for practice rounds)
  document.getElementById('saveScoreBox').style.display = practice ? 'none' : 'block';
  document.getElementById('practiceNote').style.display = practice ? 'block' : 'none';
  const input = document.getElementById('playerName');
  input.value = visitorName || '';
  input.disabled = false;
  input.style.opacity = '1';
  document.getElementById('savedMsg').style.display = 'none';
  const saveBtns = document.querySelectorAll('[onclick="saveScore()"]');
  saveBtns.forEach(b => { b.disabled = false; b.style.opacity = '1'; });

  const pct = score / questions.length;
  let title, msg;
  if (pct === 1)       { title = 'Gopher Master!';  msg = "Flawless! You could write the Go spec yourself. 🐹"; }
  else if (pct >= 0.8) { title = 'Go Expert!';      msg = "Impressive! You clearly write Go in your sleep."; }
  else if (pct >= 0.6) { title = 'Solid Go Dev!';   msg = "Nice work! Brush up on the trickier topics to level up."; }
  else if (pct >= 0.4) { title = 'Getting There!';  msg = "You know some Go! Keep practicing."; }
  else                 { title = 'agba coder!';     msg = "Go has a steep curve — review the basics and try again!"; }
  document.getElementById('scoreTitle').textContent = title;
  document.getElementById('scoreMsg').textContent = msg;
  isPracticeMode = false;
}

// ── GAME MEMORY SCREEN ─────────────────────────────────────────
const LOG_ICONS = {
  correct: '✅', clear: '🩹', wrong: '❌', timeout: '⏱', skip: '⏭', buy: '🛒',
  item: '🧩', achievement: '🏅', round: '🎮', daily: '🔥', session: '👋'
};

function fmtTime(t) {
  try {
    return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

function levelChip(level) {
  const l = LEVEL_META[level] ? level : 'medium';
  return `<span class="lb-diff-chip ${l}">${LEVEL_META[l].label.toUpperCase()}</span>`;
}

function showMemory() {
  show('memScreen');
  renderMemory();
}

function renderMemory() {
  const s = state.stats, m = state.memory;
  document.getElementById('memWho').textContent = visitorName
    ? `${visitorName}: your progress is remembered under this name`
    : 'Playing as a guest. Enter a name on the welcome screen to keep this memory under your name.';

  const correct = s.correctTotal || 0, failed = s.failedTotal || 0;
  const answeredCount = correct + failed;
  const acc = answeredCount ? Math.round((correct * 100) / answeredCount) : 0;
  const missedList = Object.entries(m.missed)
    .filter(([, v]) => !v.cleared)
    .sort((a, b) => b[1].misses - a[1].misses);

  const out = [];

  out.push(`<div class="mem-grid">
    <div class="mem-pill"><div class="num">${state.coins}</div><div class="lbl">Coins</div></div>
    <div class="mem-pill"><div class="num">${correct}</div><div class="lbl">Correct</div></div>
    <div class="mem-pill"><div class="num">${failed}</div><div class="lbl">Failed</div></div>
    <div class="mem-pill"><div class="num">${acc}%</div><div class="lbl">Accuracy</div></div>
    <div class="mem-pill"><div class="num">${s.bestStreak || 0}</div><div class="lbl">Best streak</div></div>
    <div class="mem-pill"><div class="num">${s.gamesPlayed || 0}</div><div class="lbl">Rounds</div></div>
  </div>`);

  out.push('<div class="mem-sec">By level</div>');
  out.push(LEVELS.map(l => {
    const b = m.byLevel[l] || { correct: 0, failed: 0 };
    const t = b.correct + b.failed;
    const pct = t ? Math.round((b.correct * 100) / t) : 0;
    return `<div class="mem-level">${levelChip(l)}
      <div class="mem-bar"><div style="width:${pct}%"></div></div>
      <span>${b.correct} ✅ ${b.failed} ❌</span></div>`;
  }).join(''));

  out.push('<div class="mem-sec">Items bought</div>');
  const bought = SHOP_ITEMS.filter(i => (s.purchases[i.id] || 0) > 0);
  out.push(bought.length ? bought.map(i => `
    <div class="mem-row"><div class="mr-main">${i.icon} ${escapeHtml(i.name)}</div>
    <div class="mr-side">bought ${s.purchases[i.id]} · owned ${state.inventory[i.id] || 0}</div></div>`).join('')
    : '<div class="mem-empty">Nothing bought yet. Visit the shop to spend your coins.</div>');

  out.push(`<div class="mem-sec">Achievements (${state.achievements.length}/${ACHIEVEMENTS.length})</div>`);
  const unlocked = ACHIEVEMENTS.filter(a => state.achievements.includes(a.id));
  out.push(unlocked.length
    ? `<div class="mem-badges">${unlocked.map(a => `<span title="${escapeHtml(a.name)}">${a.icon}</span>`).join('')}</div>`
    : '<div class="mem-empty">No achievements yet.</div>');

  out.push(`<div class="mem-sec">Questions to review (${missedList.length})</div>`);
  if (missedList.length) {
    out.push(missedList.slice(0, 15).map(([, v]) => `
      <div class="mem-row"><div class="mr-main">${escapeHtml(clip(v.q, 90))}</div>
      <div class="mr-side">${levelChip(v.level)} ${v.misses}×</div></div>`).join(''));
    if (missedList.length > 15) out.push(`<div class="mem-empty">…and ${missedList.length - 15} more</div>`);
    out.push('<button class="practice-btn" onclick="startPractice()">🎯 Practice missed questions</button>');
  } else {
    out.push('<div class="mem-empty">No open missed questions. Cleared so far: ' + (s.clearedTotal || 0) + '.</div>');
  }

  out.push('<div class="mem-sec">Recent rounds</div>');
  out.push(m.rounds.length ? m.rounds.slice(0, 8).map(r => {
    const label = r.practice ? 'Practice' : r.mode === 'daily' ? 'Daily' : (LEVEL_META[r.mode] ? LEVEL_META[r.mode].label : r.mode);
    return `<div class="mem-row"><div class="mr-main">${escapeHtml(label)}: ${r.score}/${r.total} · +${r.coins} 🪙</div>
      <div class="mr-side">${fmtTime(r.t)}</div></div>`;
  }).join('') : '<div class="mem-empty">No rounds played yet.</div>');

  out.push('<div class="mem-sec">Recent activity</div>');
  out.push(m.log.length ? m.log.slice(0, 25).map(e => `
    <div class="mem-row"><div class="mr-main">${LOG_ICONS[e.type] || '•'} ${escapeHtml(e.text)}</div>
    <div class="mr-side">${fmtTime(e.t)}</div></div>`).join('')
    : '<div class="mem-empty">Nothing recorded yet.</div>');

  document.getElementById('memBody').innerHTML = out.join('');
}

// ── LEADERBOARD (backed by Go server API) ─────────────────────
async function saveScore() {
  const name = document.getElementById('playerName').value.trim() || visitorName || 'Anonymous';
  const saveBtns = document.querySelectorAll('[onclick="saveScore()"]');
  saveBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

  try {
    const res = await fetch('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, score, total: questions.length, diff: lastRoundDiff })
    });
    if (!res.ok) throw new Error('Server error');
    document.getElementById('savedMsg').style.display = 'block';
    document.getElementById('playerName').disabled = true;
    lbFilter = lastRoundDiff;   // jump straight to the board this score landed on
  } catch (e) {
    saveBtns.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
    alert('Could not save score. Is the server running?');
  }
}

// Difficulty weights: harder difficulties rank higher with the same score.
// A Hard 12/15 (80%) beats an Easy 15/15 (100%) because Hard is tougher.
const DIFF_WEIGHTS = { easy: 1.0, medium: 1.5, hard: 2.0, daily: 1.0 };

function getWeightedScore(entry) {
  const pct = entry.total ? entry.score / entry.total : 0;
  const weight = DIFF_WEIGHTS[(entry.diff || '').toLowerCase()] || 1.0;
  return pct * weight;
}

function sortEntries(list) {
  return [...list].sort((a, b) => {
    // 1. Sort by weighted score (difficulty × percentage)
    const wa = getWeightedScore(a), wb = getWeightedScore(b);
    if (wb !== wa) return wb - wa;
    // 2. Tiebreak: raw score (more questions correct wins)
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    // 3. Tiebreak: earliest date (first to achieve the score wins)
    return new Date(a.date || 0) - new Date(b.date || 0);
  });
}

function setLbFilter(diff, btn) {
  lbFilter = diff;
  document.querySelectorAll('.lb-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderLeaderboard();
}

function syncLbTabs() {
  document.querySelectorAll('.lb-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.diff === lbFilter);
  });
}

function renderLeaderboard() {
  const list = document.getElementById('lbList');
  const rows = lbFilter === 'all' ? lbCache : lbCache.filter(e => (e.diff || '') === lbFilter);

  if (!rows.length) {
    list.innerHTML = lbFilter === 'all'
      ? '<div class="lb-empty">No scores yet. Play a round and save your score!</div>'
      : `<div class="lb-empty">No ${lbFilter} scores yet — be the first.</div>`;
    return;
  }

  const medals = ['gold','silver','bronze'];
  list.innerHTML = sortEntries(rows).slice(0, 10).map((e, i) => {
    const date = e.date ? new Date(e.date).toLocaleDateString() : '';
    const d = (e.diff || '').toLowerCase();
    let chip = '';
    if (d === 'daily') {
      chip = `<span class="lb-diff-chip daily">📅 DAILY</span>`;
    } else if (d) {
      chip = `<span class="lb-diff-chip ${d}">${d.toUpperCase()}</span>`;
    }
    return `
      <li class="lb-item ${medals[i] || ''}">
        <div class="lb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</div>
        <div class="lb-info">
          <div class="lb-score-name">${escapeHtml(e.name)}</div>
          <div class="lb-meta">${chip} ${date}</div>
        </div>
        <div class="lb-score-val">${e.score}<span style="font-size:14px;color:var(--muted)">/${e.total}</span></div>
      </li>`;
  }).join('');
}

async function showLeaderboard() {
  show('lbScreen');
  syncLbTabs();
  const list = document.getElementById('lbList');
  list.innerHTML = '<div class="lb-empty">Loading...</div>';
  try {
    const res = await fetch('/api/leaderboard');
    const lb = await res.json();
    lbCache = Array.isArray(lb) ? lb : [];
    renderLeaderboard();
  } catch (err) {
    list.innerHTML = '<div class="lb-empty">Could not load scores. Is the server running?</div>';
  }
}

// On page load: just show the welcome screen. We don't know who the
// player is yet, so we can't load their progress until they type a name
// and press "Let's Go" (enterApp -> loadPlayer).
window.onload = function() {
  const msgs = [
    "Welcome, future Gopher! 🐹",
    "Hello, Go developer! 👋",
    "Ready to test your skills?",
    "Welcome! Let's get started.",
    "Hi there! Enter your name below."
  ];
  document.getElementById('welcomeMsg').textContent =
    msgs[Math.floor(Math.random() * msgs.length)];
  document.getElementById('featQCount').textContent = ALL_QUESTIONS.length;
  document.getElementById('statQCount').textContent = ALL_QUESTIONS.length;
  show('welcomeScreen');
};
