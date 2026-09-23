// server-questions.js: adds the approved, server-generated questions
// (GET /api/questions) to the game's built-in ALL_QUESTIONS.
//
// It must load AFTER the main game script (it uses ALL_QUESTIONS and hashStr
// from it). If the server is unreachable or has none, the built-in questions
// work exactly as before.
(async function () {
  try {
    const res = await fetch('/api/questions', { cache: 'no-store' });
    if (!res.ok) return;
    const extra = await res.json();
    if (!Array.isArray(extra) || !extra.length) return;

    const seen = new Set(ALL_QUESTIONS.map(q => q.q.trim().toLowerCase()));
    let added = 0;
    for (const g of extra) {
      if (!g || typeof g.q !== 'string' || !Array.isArray(g.options) || g.options.length !== 4) continue;
      if (!Number.isInteger(g.answer) || g.answer < 0 || g.answer > 3) continue;
      if (!['easy', 'medium', 'hard'].includes(g.level)) continue;
      const key = g.q.trim().toLowerCase();
      if (seen.has(key)) continue;

      // `generated: true` keeps these out of the Daily Challenge, so
      // "the same 10 questions for everyone" stays true.
      const q = {
        q: g.q, options: g.options, answer: g.answer, level: g.level,
        explanation: g.explanation || '', generated: true
      };
      if (g.code) q.code = g.code;
      q.id = 'q' + hashStr(q.q + '|' + (q.code || '') + '|' + q.options.join('|'));
      ALL_QUESTIONS.push(q);
      seen.add(key);
      added++;
    }

    if (added) {
      ['featQCount', 'statQCount'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = ALL_QUESTIONS.length;
      });
    }
  } catch (e) {
    /* offline or no server questions: built-in questions still work */
  }
})();
