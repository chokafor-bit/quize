// Shop catalogue. You can freely change name, icon, price and desc.
// The ids (hint50, freeze, warp, skip, booster, shield, retry, charm, crown)
// are wired to game logic in index.html, so keep them. A brand-new item also
// needs code in index.html for what it does.

// ── SHOP ITEMS ───────────────────────────────────────────────
// kind: 'use'       -> you press a button during a question
//       'auto'      -> triggers by itself when it is needed
//       'permanent' -> buy once, works forever
const SHOP_ITEMS = [
  { id: 'hint50',  icon: '✂️', name: '50/50 Hint',    kind: 'use',       price: 100,  desc: 'Removes two incorrect options from the current question' },
  { id: 'freeze',  icon: '🧊', name: 'Time Freeze',   kind: 'use',       price: 60,  desc: 'Adds 10 extra seconds to the timer' },
  { id: 'warp',    icon: '⏳', name: 'Time Warp',     kind: 'use',       price: 90,  desc: 'Adds 20 extra seconds to the timer' },
  { id: 'skip',    icon: '⏭',  name: 'Skip Token',    kind: 'use',       price: 150,  desc: 'Skip a question with no penalty to your streak' },
  { id: 'booster', icon: '💎', name: 'Coin Booster',  kind: 'use',       price: 250, desc: 'Doubles the coins from correct answers for the rest of the round' },
  { id: 'shield',  icon: '🛡️', name: 'Streak Shield', kind: 'auto',      price: 100,  desc: 'Automatically protects your streak from one wrong answer or timeout' },
  { id: 'retry',   icon: '🔁', name: 'Second Chance', kind: 'auto',      price: 150, desc: 'Automatically lets you try again once after a wrong answer' },
  { id: 'charm',   icon: '🍀', name: 'Lucky Charm',   kind: 'permanent', price: 300, desc: 'Permanent: +1 bonus coin on every correct answer' },
  { id: 'crown',   icon: '👑', name: 'Golden Crown',  kind: 'permanent', price: 1000, desc: 'Permanent: a crown next to your name on the home screen' }
];
const KIND_LABEL = { use: 'use in quiz', auto: 'automatic', permanent: 'permanent' };
