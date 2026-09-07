let questions = [], current = 0, score = 0, answered = false;
let difficulty = 'easy';
let timerSeconds = 30, timerInterval = null;
let visitorName = '';
const DIFF_TIME = { easy: 30, medium: 20, hard: 10 };
const letters = ['A', 'B', 'C', 'D'];

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

function show(id) {
  ['welcomeScreen', 'startScreen', 'quizScreen', 'scoreScreen', 'lbScreen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? 'block' : 'none';
  });
  document.getElementById('progressArea').style.display =
    (id === 'quizScreen' || id === 'scoreScreen') ? 'block' : 'none';
}

function enterApp() {
  const input = document.getElementById('visitorName');
  visitorName = input.value.trim();
  const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  const welcomeLine = visitorName ? `Hey ${visitorName}! ${greeting}` : greeting;
  document.getElementById('startWelcome').textContent = welcomeLine;
  show('startScreen');
}

window.onload = function () {
  const msgs = [
    "Welcome, future Gopher! 🐹",
    "Hello, Go developer! 👋",
    "Ready to test your skills?",
    "Welcome! Let's get started.",
    "Hi there! Enter your name below."
  ];
  document.getElementById('welcomeMsg').textContent = msgs[Math.floor(Math.random() * msgs.length)];

  // Question count is read from the actual bank instead of a hardcoded
  // number, so the welcome/start screens never drift out of sync with it.
  const total = ALL_QUESTIONS.length;
  document.getElementById('totalQCount').textContent = total;
  document.getElementById('statQCount').textContent = total;

  show('welcomeScreen');
};

function setDiff(d, btn) {
  difficulty = d;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function startQuiz() {
  const roundSize = Math.min(25, ALL_QUESTIONS.length);
  questions = shuffle(ALL_QUESTIONS).slice(0, roundSize);
  current = 0; score = 0; answered = false;
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('savedMsg').style.display = 'none';
  document.getElementById('playerName').value = '';
  show('quizScreen');
  loadQuestion();
}

// ── TIMER ──────────────────────────────────────────────────────
function startTimer() {
  clearInterval(timerInterval);
  timerSeconds = DIFF_TIME[difficulty];
  updateTimerUI();
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
  const total = DIFF_TIME[difficulty];
  const pct = (timerSeconds / total) * 100;
  const bar = document.getElementById('timerBar');
  const num = document.getElementById('timerNum');
  bar.style.width = pct + '%';
  bar.style.background = timerSeconds <= 5 ? 'var(--wrong)' : timerSeconds <= 10 ? '#f5c842' : 'var(--correct)';
  num.textContent = timerSeconds;
  num.className = 'timer-num' + (timerSeconds <= 5 ? ' urgent' : '');
}

function timeUp() {
  if (answered) return;
  answered = true;
  document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
  const q = questions[current];
  document.querySelectorAll('.option-btn')[q.answer].classList.add('correct');
  const fb = document.getElementById('feedback');
  fb.textContent = "⏱ Time's up! " + q.explanation;
  fb.className = 'feedback wrong-fb show';
  document.getElementById('nextBtn').classList.add('show');
}

function stopTimer() { clearInterval(timerInterval); }

// ── QUESTION ───────────────────────────────────────────────────
function loadQuestion() {
  answered = false;
  const q = questions[current];
  document.getElementById('qLabel').textContent = `Question ${current + 1} of ${questions.length}`;
  document.getElementById('scoreLabel').textContent = `Score: ${score}`;
  document.getElementById('progressBar').style.width = `${(current / questions.length) * 100}%`;
  document.getElementById('questionNum').textContent = `Question ${String(current + 1).padStart(2, '0')}`;
  document.getElementById('questionText').textContent = q.q;

  const codeEl = document.getElementById('codeBlock');
  codeEl.innerHTML = q.code ? `<div class="code-block">${escapeHtml(q.code)}</div>` : '<div class="no-code"></div>';

  const fb = document.getElementById('feedback');
  fb.className = 'feedback'; fb.textContent = '';
  const nextBtn = document.getElementById('nextBtn');
  nextBtn.className = 'next-btn';
  nextBtn.textContent = current === questions.length - 1 ? 'See Results →' : 'Next Question →';

  const container = document.getElementById('optionsContainer');
  container.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.innerHTML = `<span class="letter">${letters[i]}</span><span>${escapeHtml(opt)}</span>`;
    btn.onclick = () => selectAnswer(i, btn);
    container.appendChild(btn);
  });

  startTimer();
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function selectAnswer(index, btn) {
  if (answered) return;
  answered = true;
  stopTimer();
  const q = questions[current];
  document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
  const fb = document.getElementById('feedback');
  if (index === q.answer) {
    btn.classList.add('correct');
    score++;
    document.getElementById('scoreLabel').textContent = `Score: ${score}`;
    fb.textContent = '✓ Correct! ' + q.explanation;
    fb.className = 'feedback correct-fb show';
  } else {
    btn.classList.add('wrong');
    document.querySelectorAll('.option-btn')[q.answer].classList.add('correct');
    fb.textContent = '✗ Not quite. ' + q.explanation;
    fb.className = 'feedback wrong-fb show';
  }
  document.getElementById('nextBtn').classList.add('show');
}

function nextQuestion() {
  current++;
  if (current >= questions.length) { showScore(); } else { loadQuestion(); }
}

function showScore() {
  stopTimer();
  document.getElementById('progressBar').style.width = '100%';
  document.getElementById('qLabel').textContent = 'Quiz Complete';
  show('scoreScreen');
  document.getElementById('finalScore').textContent = score;
  document.querySelector('.score-denom').textContent = `/ ${questions.length}`;

  const input = document.getElementById('playerName');
  input.value = visitorName || '';
  input.disabled = false;
  input.style.opacity = '1';
  document.getElementById('savedMsg').style.display = 'none';
  const saveBtn = document.getElementById('saveScoreBtn');
  saveBtn.disabled = false;
  saveBtn.style.opacity = '1';

  const pct = score / questions.length;
  let title, msg;
  if (pct === 1) { title = 'Gopher Master!'; msg = 'Flawless! You could write the Go spec yourself. 🐹'; }
  else if (pct >= 0.8) { title = 'Go Expert!'; msg = 'Impressive! You clearly write Go in your sleep.'; }
  else if (pct >= 0.6) { title = 'Solid Go Dev!'; msg = 'Nice work! Brush up on the trickier topics to level up.'; }
  else if (pct >= 0.4) { title = 'Getting There!'; msg = 'You know some Go! Keep practicing.'; }
  else { title = 'Keep Coding!'; msg = 'Go has a steep curve — review the basics and try again!'; }
  document.getElementById('scoreTitle').textContent = title;
  document.getElementById('scoreMsg').textContent = msg;
}

// ── LEADERBOARD (backed by the Go server API) ───────────────────
async function saveScore() {
  const name = document.getElementById('playerName').value.trim() || visitorName || 'Anonymous';
  const btn = document.getElementById('saveScoreBtn');
  btn.disabled = true; btn.style.opacity = '0.5';

  try {
    const res = await fetch('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, score, total: questions.length, diff: difficulty })
    });
    if (!res.ok) throw new Error('Server error');
    document.getElementById('savedMsg').style.display = 'block';
    document.getElementById('playerName').disabled = true;
  } catch (e) {
    btn.disabled = false; btn.style.opacity = '1';
    alert('Could not save score. Is the server running?');
  }
}

async function showLeaderboard() {
  show('lbScreen');
  const list = document.getElementById('lbList');
  list.innerHTML = '<div class="lb-empty">Loading...</div>';
  try {
    const res = await fetch('/api/leaderboard');
    const lb = await res.json();
    if (!lb || lb.length === 0) {
      list.innerHTML = '<div class="lb-empty">No scores yet. Play a round and save your score!</div>';
      return;
    }
    const medals = ['gold', 'silver', 'bronze'];
    list.innerHTML = lb.slice(0, 10).map((e, i) => {
      const date = e.date ? new Date(e.date).toLocaleDateString() : '';
      return `
        <li class="lb-item ${medals[i] || ''}">
          <div class="lb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</div>
          <div class="lb-info">
            <div class="lb-score-name">${escapeHtml(e.name)}</div>
            <div class="lb-meta">${(e.diff || '').toUpperCase()} · ${date}</div>
          </div>
          <div class="lb-score-val">${e.score}<span style="font-size:14px;color:var(--muted)">/${e.total}</span></div>
        </li>`;
    }).join('');
  } catch (err) {
    list.innerHTML = '<div class="lb-empty">Could not load scores. Is the server running?</div>';
  }
}
