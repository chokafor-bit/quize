// All achievements. Edit this file to add, change or remove achievements.
// Each one: id (unique), icon, name, desc, and check(s), which returns true when unlocked.
// check() uses LEVELS and SHOP_ITEMS from the main game script; that works
// because check() only runs during play, after everything has loaded.

// ── ACHIEVEMENTS ─────────────────────────────────────────────
const ACHIEVEMENTS = [
  // playing
  { id: 'first_quiz',     icon: '🎓', name: 'First Steps',           desc: 'Complete your first quiz',                                check: s => s.stats.gamesPlayed >= 1 },
  { id: 'marathon',       icon: '🏃', name: 'Marathoner',            desc: 'Play 10 quizzes',                                         check: s => s.stats.gamesPlayed >= 10 },
  { id: 'games25',        icon: '🥾', name: 'Regular',               desc: 'Play 25 quizzes',                                         check: s => s.stats.gamesPlayed >= 25 },
  { id: 'games50',        icon: '🏔️', name: 'Ultra Marathoner',      desc: 'Play 50 quizzes',                                         check: s => s.stats.gamesPlayed >= 50 },
  // knowledge
  { id: 'correct50',      icon: '🎯', name: 'Sharpshooter',          desc: 'Answer 50 questions correctly (lifetime)',                check: s => s.stats.correctTotal >= 50 },
  { id: 'century',        icon: '📚', name: 'Century Club',          desc: 'Answer 100 questions correctly (lifetime)',               check: s => s.stats.correctTotal >= 100 },
  { id: 'correct250',     icon: '🧠', name: 'Go Scholar',            desc: 'Answer 250 questions correctly (lifetime)',               check: s => s.stats.correctTotal >= 250 },
  { id: 'correct500',     icon: '🧙', name: 'Go Sage',               desc: 'Answer 500 questions correctly (lifetime)',               check: s => s.stats.correctTotal >= 500 },
  { id: 'accuracy90',     icon: '🎖️', name: 'Sharp Mind',            desc: 'Keep 90% accuracy over at least 50 answers',              check: s => s.stats.questionsTotal >= 50 && s.stats.correctTotal / s.stats.questionsTotal >= 0.9 },
  { id: 'comeback',       icon: '🩹', name: 'Learning From Mistakes', desc: 'Clear all questions you previously got wrong',            check: s => s.stats.clearedTotal >= 10 },
  // rounds and levels
  { id: 'perfect',        icon: '💯', name: 'Perfect Round',         desc: 'Score 100% in a round',                                   check: s => s.stats.perfectRounds >= 1 },
  { id: 'pure_round',     icon: '🧘', name: 'Pure Skill',            desc: 'Score 100% in a round without using any power-ups',       check: s => s.stats.pureRounds >= 1 },
  { id: 'hard_mode',      icon: '🔴', name: 'No Fear',               desc: 'Complete a quiz on Hard difficulty',                      check: s => s.stats.hardCompleted >= 1 },
  { id: 'hard_perfect',   icon: '☠️', name: 'Nightmare Slayer',      desc: 'Score 100% on a Hard round',                              check: s => s.stats.hardPerfect >= 1 },
  { id: 'all_levels',     icon: '🌈', name: 'Well Rounded',          desc: 'Complete a round on Easy, Medium and Hard',               check: s => LEVELS.every(l => s.stats.levelsPlayed && s.stats.levelsPlayed[l]) },
  // streaks and speed
  { id: 'streak10',       icon: '🔥', name: 'On Fire',               desc: 'Get 10 correct answers in a row',                         check: s => s.stats.bestStreak >= 10 },
  { id: 'streak15',       icon: '⚡', name: 'Unstoppable',           desc: 'Get 15 correct answers in a row',                         check: s => s.stats.bestStreak >= 15 },
  { id: 'lightning',      icon: '⏱️', name: 'Lightning Reflexes',    desc: 'Answer 5 questions correctly in under 3 seconds each',    check: s => s.stats.fastAnswers >= 5 },
  // coins and shop
  { id: 'piggy',          icon: '🐷', name: 'Piggy Bank',            desc: 'Hold 500 coins at once',                                  check: s => s.coins >= 500 },
  { id: 'coin_collector', icon: '💰', name: 'Coin Collector',        desc: 'Earn 1000 coins in total',                                check: s => s.stats.lifetimeCoins >= 1000 },
  { id: 'tycoon',         icon: '🏦', name: 'Tycoon',                desc: 'Earn 5000 coins in total',                                check: s => s.stats.lifetimeCoins >= 5000 },
  { id: 'shopper',        icon: '🛍️', name: 'First Purchase',        desc: 'Buy something from the shop',                             check: s => s.stats.itemsBought >= 1 },
  { id: 'spender',        icon: '💸', name: 'Big Spender',           desc: 'Buy 9 items from the shop',                              check: s => s.stats.itemsBought >= 10 },
  { id: 'collector',      icon: '🧺', name: 'Collector',             desc: 'Buy every kind of item in the shop at least once',        check: s => SHOP_ITEMS.every(i => (s.stats.purchases[i.id] || 0) >= 1) },
  { id: 'royalty',        icon: '👑', name: 'Royalty',               desc: 'Buy the Golden Crown',                                    check: s => (s.stats.purchases.crown || 0) >= 1 },
  // daily
  { id: 'daily3',         icon: '📆', name: 'Getting Started',       desc: 'Reach a 3-day Daily Challenge streak',                    check: s => s.stats.dailyStreak >= 3 },
  { id: 'daily7',         icon: '🗓️', name: 'Dedicated Gopher',      desc: 'Reach a 7-day Daily Challenge streak',                    check: s => s.stats.dailyStreak >= 7 },
  { id: 'daily10',        icon: '📅', name: 'Habit Former',          desc: 'Reach a 10-day Daily Challenge streak',                   check: s => s.stats.dailyStreak >= 10 },
  { id: 'daily30',        icon: '🗻', name: 'Iron Habit',            desc: 'Reach a 30-day Daily Challenge streak',                   check: s => s.stats.dailyStreak >= 30 }
];
