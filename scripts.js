'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const LINE_COORDS = [
  { x1: 0.15, y1: 0.5,  x2: 2.85, y2: 0.5  }, // row 0
  { x1: 0.15, y1: 1.5,  x2: 2.85, y2: 1.5  }, // row 1
  { x1: 0.15, y1: 2.5,  x2: 2.85, y2: 2.5  }, // row 2
  { x1: 0.5,  y1: 0.15, x2: 0.5,  y2: 2.85 }, // col 0
  { x1: 1.5,  y1: 0.15, x2: 1.5,  y2: 2.85 }, // col 1
  { x1: 2.5,  y1: 0.15, x2: 2.5,  y2: 2.85 }, // col 2
  { x1: 0.15, y1: 0.15, x2: 2.85, y2: 2.85 }, // diagonal
  { x1: 2.85, y1: 0.15, x2: 0.15, y2: 2.85 }  // anti-diagonal
];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SVG_NS = 'http://www.w3.org/2000/svg';
const X_COLOR = '#0A84FF';
const O_COLOR = '#FF453A';
const TINT_X = 'rgba(10,132,255,0.16)';
const TINT_O = 'rgba(255,69,58,0.16)';

const PRESETS = [
  { id: 'bullet',     label: 'Bullet',            detail: '1 min · 15s per move',        bank: 60,   move: 15 },
  { id: 'blitz',      label: 'Blitz',              detail: '3 min · 20s per move',        bank: 180,  move: 20 },
  { id: 'rapid',      label: 'Rapid',              detail: '10 min · 30s per move',       bank: 600,  move: 30 },
  { id: 'classic',    label: 'Classical',          detail: '25 min · 60s per move',       bank: 1500, move: 60 },
  { id: 'movesonly',  label: 'Move clock only',    detail: 'No total bank · 20s per move', bank: 0,    move: 20 },
  { id: 'casual',     label: 'Casual',             detail: 'No clocks at all',            bank: 0,    move: 0 }
];
const MOVE_OPTS = [10, 20, 30, 60, 0].map(v => ({ v, label: v === 0 ? 'Off' : v + 's' }));
const BANK_OPTS = [
  { v: 60, label: '1m' }, { v: 180, label: '3m' }, { v: 600, label: '10m' }, { v: 1500, label: '25m' }, { v: 0, label: '∞' }
];
const LEVELS = [{ v: 'easy', label: 'Easy' }, { v: 'normal', label: 'Normal' }, { v: 'hard', label: 'Hard' }];
const LEVEL_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const SIDES = [{ v: 'X', label: '✕' }, { v: 'O', label: '○' }, { v: 'random', label: 'Random' }];

const THEMES = {
  Midnight: { page: '#000000', tray: '#141416', sub: '#1C1C1E', tile: '#2C2C2E', idle: '#242426', overlay: 'rgba(20,20,22,0.88)' },
  Graphite: { page: '#0C0C0E', tray: '#17171A', sub: '#212125', tile: '#313136', idle: '#28282C', overlay: 'rgba(23,23,26,0.9)' },
  Ink:      { page: '#050814', tray: '#0E1424', sub: '#161E33', tile: '#212C48', idle: '#1A2439', overlay: 'rgba(14,20,36,0.9)' },
  Forest:   { page: '#04120C', tray: '#0B1F17', sub: '#122B20', tile: '#1B3C2C', idle: '#153224', overlay: 'rgba(11,31,23,0.9)' },
  Wine:     { page: '#140509', tray: '#210B12', sub: '#2C1119', tile: '#3E1A25', idle: '#33141D', overlay: 'rgba(33,11,18,0.9)' }
};
const THEME_NAMES = Object.keys(THEMES);
let CURRENT_THEME = THEMES.Midnight;

function makeCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s.slice(0, 3) + '-' + s.slice(3);
}

function fmtClock(sec) {
  if (sec == null) return '∞';
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function initialsFor(name) {
  return (name || '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'G';
}

// ── State ────────────────────────────────────────────────────────────────────

function freshGame() {
  return {
    cells: Array(81).fill(null),
    winners: Array(9).fill(null),
    turn: 'X',
    active: null,
    winner: null,
    winReason: null,
    last: null,
    history: [],
    log: []
  };
}

const state = Object.assign({
  screen: 'home',

  account: null,
  authToken: null,
  accountOpen: false,
  authMode: 'signup',
  nameDraft: '', emailDraft: '', passwordDraft: '',
  authError: '',
  authBusy: false,

  pendingMode: 'cpu',
  mode: 'cpu',
  preset: 'blitz',
  bank: 180,
  move: 20,
  level: 'normal',
  side: 'X',
  humanSide: 'X',
  hints: true,
  themeName: 'Midnight',

  paused: false,
  menuOpen: false,

  roomCode: makeCode(),
  joinCode: '',
  copied: false,
  copiedLink: false,
  waitTitle: 'Waiting for opponent…',
  opponentName: 'Opponent',
  opponentRating: null,
  playerId: Math.random().toString(36).slice(2) + Date.now().toString(36),
  mySymbol: 'X',

  clockX: 0, clockO: 0, moveLeft: 0,

  chat: [],
  sidePanelTab: 'chat',
  rematchPending: false,
  rematchIncoming: false,
  unreadChat: 0
}, freshGame());

let aiTimer = null;
let socket = null;
let clockInterval = null;
let lastClockTick = Date.now();
let titleFlashInterval = null;
const ORIGINAL_TITLE = document.title;

// ── Auth / API ───────────────────────────────────────────────────────────────

async function apiRequest(path, opts) {
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || 'Something went wrong.');
  return data;
}

function myDisplayName() { return state.account ? state.account.name : 'Guest'; }

function saveSession(token, user) {
  state.authToken = token;
  state.account = user;
  try { localStorage.setItem('outtt-token', token); } catch (e) { /* ignore */ }
}

function clearSession() {
  state.authToken = null;
  state.account = null;
  try { localStorage.removeItem('outtt-token'); } catch (e) { /* ignore */ }
}

async function refreshAccount() {
  if (!state.authToken) return;
  try {
    const data = await apiRequest('/api/me', { headers: { Authorization: 'Bearer ' + state.authToken } });
    state.account = data.user;
    renderTopbar();
    renderAccountModal();
  } catch (e) { /* keep the stale copy rather than disrupting the game screen */ }
}

async function restoreSession() {
  let token = null;
  try { token = localStorage.getItem('outtt-token'); } catch (e) { /* ignore */ }
  if (!token) return;
  try {
    const data = await apiRequest('/api/me', { headers: { Authorization: 'Bearer ' + token } });
    state.authToken = token;
    state.account = data.user;
    renderTopbar();
  } catch (e) {
    try { localStorage.removeItem('outtt-token'); } catch (e2) { /* ignore */ }
  }
}

function openAccountModal(mode) {
  state.accountOpen = true;
  if (mode) state.authMode = mode;
  state.authError = '';
  renderAccountModal();
}

function closeAccountModal() {
  state.accountOpen = false;
  renderAccountModal();
}

async function submitAuth() {
  const s = state;
  const name = s.nameDraft.trim();
  const email = s.emailDraft.trim();
  const password = s.passwordDraft;

  if (s.authMode === 'signup' && !name) { s.authError = 'Enter a display name.'; renderAccountModal(); return; }
  if (!email) { s.authError = 'Enter an email.'; renderAccountModal(); return; }
  if (password.length < 6) { s.authError = 'Password must be at least 6 characters.'; renderAccountModal(); return; }

  s.authBusy = true;
  s.authError = '';
  renderAccountModal();

  try {
    const path = s.authMode === 'signup' ? '/api/signup' : '/api/login';
    const body = s.authMode === 'signup' ? { name, email, password } : { email, password };
    const data = await apiRequest(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    saveSession(data.token, data.user);
    s.accountOpen = false;
    renderTopbar();
  } catch (e) {
    s.authError = e.message;
  }
  s.authBusy = false;
  renderAccountModal();
}

function playAsGuest() {
  state.accountOpen = false;
  renderAccountModal();
}

function signOut() {
  clearSession();
  state.accountOpen = false;
  renderTopbar();
  renderAccountModal();
}

// ── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(name) {
  const key = THEMES[name] ? name : 'Midnight';
  CURRENT_THEME = THEMES[key];
  state.themeName = key;
  const root = document.documentElement.style;
  root.setProperty('--bg', CURRENT_THEME.page);
  root.setProperty('--surface', CURRENT_THEME.sub);
  root.setProperty('--tray-bg', CURRENT_THEME.tray);
  try { localStorage.setItem('outtt-theme', key); } catch (e) { /* ignore */ }
}

function restoreTheme() {
  let saved = null;
  try { saved = localStorage.getItem('outtt-theme'); } catch (e) { /* ignore */ }
  applyTheme(saved && THEMES[saved] ? saved : 'Midnight');
}

// ── Online connection ────────────────────────────────────────────────────────

function wsURL() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  return proto + location.host + '/ws';
}

function sendMessage(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function closeSocket() {
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
    socket = null;
  }
}

function connectSocket(onOpen) {
  closeSocket();
  socket = new WebSocket(wsURL());
  socket.onopen = () => onOpen();
  socket.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }
    handleServerMessage(msg);
  };
  socket.onclose = () => {
    if (state.mode === 'online' && (state.screen === 'game' || state.screen === 'waiting') && !state.winner) {
      alert('Connection to the server was lost.');
      goHome();
    }
  };
  socket.onerror = () => {};
}

function applyServerGameState(gs) {
  const cells = Array(81).fill(null);
  for (let b = 0; b < 9; b++) {
    for (let c = 0; c < 9; c++) {
      cells[b * 9 + c] = gs.smallBoards[b][c] || null;
    }
  }
  state.cells = cells;
  state.winners = gs.smallBoardWinners.map(w => (w === '' ? null : (w === 'tie' ? 'D' : w)));
  state.active = gs.activeBoard;
  state.turn = gs.currentPlayer || state.turn;
  state.winner = gs.gameOver ? (gs.winner === 'tie' ? 'D' : gs.winner) : null;
  state.winReason = gs.gameOver ? gs.winReason : null;
  state.clockX = gs.clockX;
  state.clockO = gs.clockO;
  state.moveLeft = gs.moveLeft;
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'waiting':
      state.waitTitle = 'Waiting for opponent…';
      render();
      break;
    case 'gameStart':
      clearTimeout(aiTimer);
      stopClock();
      state.chat = [];
      state.log = [];
      state.rematchPending = false;
      state.rematchIncoming = false;
      state.unreadChat = 0;
      state.menuOpen = false;
      state.paused = false;
      state.sidePanelTab = 'chat';
      applyServerGameState(msg.gameState);
      state.mySymbol = msg.playerSymbol;
      state.opponentName = (msg.opponent && msg.opponent.name) || 'Opponent';
      state.opponentRating = msg.opponent ? msg.opponent.rating : null;
      state.bank = (msg.timeControl && msg.timeControl.bank) || 0;
      state.move = msg.timeControl ? msg.timeControl.move : 30;
      state.last = null;
      state.mode = 'online';
      state.screen = 'game';
      render();
      updateChatBadge();
      appendLog('Online match started — you are ' + state.mySymbol + '.', true);
      break;
    case 'move': {
      const prevWinners = state.winners;
      const prevWinner = state.winner;
      applyServerGameState(msg.gameState);
      state.last = msg.boardIndex * 9 + msg.cellIndex;
      render();
      logMoveOutcome(msg.symbol, msg.boardIndex, msg.cellIndex, prevWinners, prevWinner);
      if (msg.gameOver) refreshAccount();
      break;
    }
    case 'clock':
      state.clockX = msg.clockX;
      state.clockO = msg.clockO;
      state.moveLeft = msg.moveLeft;
      renderClocks();
      break;
    case 'forfeit':
      applyServerGameState(msg.gameState);
      appendLog(displayName(msg.side) + '’s move time expired — turn forfeited.', true);
      render();
      break;
    case 'gameOver':
      applyServerGameState(msg.gameState);
      render();
      appendLog(
        msg.winner === 'tie'
          ? 'Game tied!'
          : (displayName(msg.winner) + (msg.winReason === 'flag' ? ' wins on time!' : ' wins the game!')),
        true
      );
      refreshAccount();
      break;
    case 'chat': {
      const mine = msg.symbol === state.mySymbol;
      appendChat({ text: msg.text, mine: mine });
      if (!mine) {
        if (state.sidePanelTab !== 'chat') {
          state.unreadChat += 1;
          updateChatBadge();
        }
        notifyNewMessage();
      }
      break;
    }
    case 'rematchRequested':
      state.rematchIncoming = true;
      render();
      break;
    case 'rematchDeclined':
      state.rematchPending = false;
      appendLog('Opponent declined the rematch.');
      render();
      break;
    case 'playerDisconnected':
      alert(msg.message || 'Your opponent has disconnected.');
      goHome();
      break;
    case 'error':
      if (state.screen === 'lobby') {
        // Our own room's code collided with an existing one — silently mint
        // a fresh code and retry rather than surfacing this to the user.
        enterRoom();
      } else {
        alert(msg.message || 'Something went wrong.');
        closeSocket();
        state.screen = 'setup';
        render();
      }
      break;
    case 'roomNotFound':
      alert(msg.message || 'That room was not found.');
      closeSocket();
      state.screen = 'setup';
      render();
      break;
  }
}

// ── Match log / chat ────────────────────────────────────────────────────────

function displayName(symbol) {
  const s = state;
  if (s.mode === 'local') return symbol === 'X' ? 'Player 1' : 'Player 2';
  if (s.mode === 'cpu') return symbol === bottomSide() ? myDisplayName() : 'Computer';
  if (s.mode === 'online') return symbol === s.mySymbol ? myDisplayName() : s.opponentName;
  return symbol;
}

function appendLog(text, highlight) {
  state.log = state.log.concat([{ text: text, highlight: !!highlight }]);
  if (state.log.length > 300) state.log = state.log.slice(-300);
  renderLogList();
}

function renderLogList() {
  const list = document.getElementById('log-list');
  if (!list) return;
  list.innerHTML = '';
  state.log.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'log-entry' + (entry.highlight ? ' log-highlight' : '');
    div.textContent = entry.text;
    list.appendChild(div);
  });
  list.scrollTop = list.scrollHeight;
}

function logMoveOutcome(symbol, boardIndex, cellIndex, prevWinners, prevWinner) {
  appendLog(displayName(symbol) + ' → board ' + (boardIndex + 1) + ', cell ' + (cellIndex + 1));
  const bw = state.winners[boardIndex];
  if (bw && bw !== prevWinners[boardIndex]) {
    appendLog('Board ' + (boardIndex + 1) + (bw === 'D' ? ' tied.' : ' won by ' + displayName(bw) + '.'), true);
  }
  if (state.winner && state.winner !== prevWinner) {
    appendLog(state.winner === 'D' ? 'Game tied!' : (displayName(state.winner) + ' wins the game!'), true);
  }
}

function appendChat(entry) {
  state.chat = state.chat.concat([entry]);
  renderChatList();
}

function renderChatList() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.chat.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = 'Say hello to your opponent.';
    list.appendChild(empty);
  } else {
    state.chat.forEach(entry => {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble' + (entry.mine ? ' mine' : '');
      const textEl = document.createElement('div');
      textEl.className = 'chat-bubble-text';
      textEl.textContent = entry.text;
      bubble.appendChild(textEl);
      list.appendChild(bubble);
    });
  }
  list.scrollTop = list.scrollHeight;
}

function sendChat(text) {
  const trimmed = text.trim();
  if (!trimmed || state.mode !== 'online') return;
  sendMessage({ type: 'chat', playerId: state.playerId, text: trimmed });
}

function updateChatBadge() {
  const tabBtn = document.getElementById('tab-chat');
  let badge = tabBtn.querySelector('.tab-badge');
  if (state.unreadChat > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-badge';
      tabBtn.appendChild(badge);
    }
    badge.textContent = state.unreadChat > 9 ? '9+' : String(state.unreadChat);
    tabBtn.classList.remove('tab-pulse');
    void tabBtn.offsetWidth;
    tabBtn.classList.add('tab-pulse');
  } else if (badge) {
    badge.remove();
    tabBtn.classList.remove('tab-pulse');
  }
}

function notifyNewMessage() {
  if (!document.hidden || titleFlashInterval) return;
  let toggle = false;
  titleFlashInterval = setInterval(() => {
    document.title = toggle ? ORIGINAL_TITLE : '💬 New message';
    toggle = !toggle;
  }, 1000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && titleFlashInterval) {
    clearInterval(titleFlashInterval);
    titleFlashInterval = null;
    document.title = ORIGINAL_TITLE;
  }
});

// ── Clocks (local / cpu) ─────────────────────────────────────────────────────

function botSide() { return state.mode === 'cpu' ? (state.humanSide === 'X' ? 'O' : 'X') : null; }

function bottomSide() {
  if (state.mode === 'local') return 'X';
  if (state.mode === 'cpu') return state.humanSide || 'X';
  if (state.mode === 'online') return state.mySymbol || 'X';
  return 'X';
}
function topSideOf() { return bottomSide() === 'X' ? 'O' : 'X'; }

function startClock() {
  clearInterval(clockInterval);
  clockInterval = null;
  if (state.mode === 'online') return;
  lastClockTick = Date.now();
  clockInterval = setInterval(tickClock, 100);
}

function stopClock() {
  clearInterval(clockInterval);
  clockInterval = null;
}

function tickClock() {
  const s = state;
  if (s.screen !== 'game' || s.winner || s.paused) return;
  const now = Date.now();
  const dt = (now - lastClockTick) / 1000;
  lastClockTick = now;

  if (s.move > 0) {
    s.moveLeft = Math.max(0, s.moveLeft - dt);
    if (s.moveLeft <= 0) { forfeitTurnLocal(); return; }
  }
  if (s.bank > 0) {
    const key = s.turn === 'X' ? 'clockX' : 'clockO';
    s[key] = Math.max(0, s[key] - dt);
    if (s[key] <= 0) { flagFallLocal(s.turn); return; }
  }
  renderClocks();
}

function forfeitTurnLocal() {
  const side = state.turn;
  state.turn = side === 'X' ? 'O' : 'X';
  state.active = null;
  state.moveLeft = state.move;
  appendLog(displayName(side) + '’s move time expired — turn forfeited, opponent plays anywhere.', true);
  render();
  scheduleAiIfNeeded();
}

function flagFallLocal(side) {
  state.winner = side === 'X' ? 'O' : 'X';
  state.winReason = 'flag';
  stopClock();
  appendLog(displayName(side) + ' ran out of time — ' + displayName(state.winner) + ' wins!', true);
  render();
}

// ── Game logic ──────────────────────────────────────────────────────────────

function lineWinner(g) {
  for (const [a, b, c] of LINES) {
    if (g[a] && g[a] !== 'D' && g[a] === g[b] && g[a] === g[c]) return g[a];
  }
  return null;
}

function findWinPattern(triplet) {
  for (let i = 0; i < LINES.length; i++) {
    const [a, b, c] = LINES[i];
    if (triplet[a] && triplet[a] !== 'D' && triplet[a] === triplet[b] && triplet[a] === triplet[c]) return i;
  }
  return null;
}

function legalMoves(cells, winners, active) {
  const out = [];
  for (let b = 0; b < 9; b++) {
    if (winners[b]) continue;
    if (active !== null && active !== b) continue;
    for (let c = 0; c < 9; c++) {
      if (!cells[b * 9 + c]) out.push([b, c]);
    }
  }
  return out;
}

function play(b, c, fromAI) {
  const s = state;
  if (s.winner || s.paused) return;
  if (s.mode === 'online') {
    if (fromAI) return;
    if (s.turn !== s.mySymbol) return;
    if (s.winners[b] || s.cells[b * 9 + c]) return;
    if (s.active !== null && s.active !== b) return;
    sendMessage({ type: 'makeMove', playerId: s.playerId, boardIndex: b, cellIndex: c });
    return;
  }
  const bot = botSide();
  if (bot && s.turn === bot && !fromAI) return;
  if (s.winners[b] || s.cells[b * 9 + c]) return;
  if (s.active !== null && s.active !== b) return;

  const symbol = s.turn;
  const prevWinners = s.winners;
  const prevWinner = s.winner;

  const snapshot = {
    cells: s.cells.slice(), winners: s.winners.slice(), turn: s.turn, active: s.active,
    winner: s.winner, winReason: s.winReason, last: s.last,
    clockX: s.clockX, clockO: s.clockO, moveLeft: s.moveLeft
  };

  const cells = s.cells.slice();
  cells[b * 9 + c] = s.turn;

  const winners = s.winners.slice();
  const sub = cells.slice(b * 9, b * 9 + 9);
  const w = lineWinner(sub);
  if (w) winners[b] = w;
  else if (sub.every(Boolean)) winners[b] = 'D';

  const gameWinner = lineWinner(winners);
  const nextSub = cells.slice(c * 9, c * 9 + 9);
  const active = (winners[c] || nextSub.every(Boolean)) ? null : c;
  const filled = winners.every(Boolean);

  s.cells = cells;
  s.winners = winners;
  s.turn = s.turn === 'X' ? 'O' : 'X';
  s.active = active;
  s.winner = gameWinner || (filled ? 'D' : null);
  s.winReason = gameWinner ? 'board' : (filled ? 'draw' : null);
  s.last = b * 9 + c;
  s.moveLeft = s.move;
  s.history = s.history.concat([snapshot]);

  render();
  logMoveOutcome(symbol, b, c, prevWinners, prevWinner);

  if (s.winner) stopClock();
  scheduleAiIfNeeded();
}

function scheduleAiIfNeeded() {
  const s = state;
  if (s.winner || s.paused) return;
  const bot = botSide();
  if (bot && s.turn === bot) {
    clearTimeout(aiTimer);
    aiTimer = setTimeout(aiMove, 380);
  }
}

function scoreMove([b, c], cells, winners) {
  const level = state.level;
  const noise = level === 'easy' ? 40 : level === 'hard' ? 3 : 10;
  let s = Math.random() * noise;
  if (level === 'easy') return s + Math.random() * 5;

  const me = botSide() || 'O';
  const you = me === 'X' ? 'O' : 'X';
  const nc = cells.slice();
  nc[b * 9 + c] = me;
  const nw = winners.slice();
  const sub = nc.slice(b * 9, b * 9 + 9);
  const w = lineWinner(sub);
  if (w) nw[b] = w; else if (sub.every(Boolean)) nw[b] = 'D';

  if (nw[b] === me) {
    if (lineWinner(nw) === me) return 1e6;
    s += 60;
    if (b === 4) s += 12;
  }
  const alt = cells.slice();
  alt[b * 9 + c] = you;
  if (lineWinner(alt.slice(b * 9, b * 9 + 9)) === you) s += 45;

  if (b === 4) s += 6;
  if (c === 4) s += 5;
  else if ([0, 2, 6, 8].includes(c)) s += 2;

  const nextSub = nc.slice(c * 9, c * 9 + 9);
  if (nw[c] || nextSub.every(Boolean)) {
    s -= 25;
  } else if (level === 'hard') {
    let threat = false;
    for (const [p, q, r] of LINES) {
      const v = [nextSub[p], nextSub[q], nextSub[r]];
      if (v.filter(x => x === you).length === 2 && v.filter(x => !x).length === 1) threat = true;
    }
    if (threat) {
      s -= 35;
      const w2 = nw.slice();
      w2[c] = you;
      if (lineWinner(w2) === you) s -= 500;
    }
  }
  return s;
}

function aiMove() {
  const { cells, winners, active, winner, paused } = state;
  if (winner || paused) return;
  const moves = legalMoves(cells, winners, active);
  if (!moves.length) return;
  let best = -Infinity, pick = [];
  for (const m of moves) {
    const v = scoreMove(m, cells, winners);
    if (v > best) { best = v; pick = [m]; }
    else if (v === best) pick.push(m);
  }
  const [b, c] = pick[Math.floor(Math.random() * pick.length)];
  play(b, c, true);
}

// ── Navigation ───────────────────────────────────────────────────────────────

function openSetup(mode) {
  state.pendingMode = mode;
  state.mode = mode;
  state.screen = 'setup';
  render();
}

function applyPreset(p) {
  state.preset = p.id;
  state.bank = p.bank;
  state.move = p.move;
  renderSetup();
}

function confirmSetup() {
  if (state.mode === 'online') {
    enterRoom();
  } else {
    startGame(state.mode);
  }
}

// Creates and opens the room immediately — no separate "Open Room" click,
// so the host lands straight on a live, shareable room (like a Meet link).
function enterRoom(code) {
  state.mode = 'online';
  state.screen = 'lobby';
  state.roomCode = code || makeCode();
  state.copied = false;
  state.copiedLink = false;
  render();
  connectSocket(() => {
    sendMessage({
      type: 'createRoom',
      playerId: state.playerId,
      roomCode: state.roomCode,
      authToken: state.authToken,
      guestName: myDisplayName(),
      timeControl: { bank: state.bank, move: state.move }
    });
  });
}

function roomLink() {
  const code = state.roomCode.replace(/[^A-Za-z0-9]/g, '');
  return location.origin + location.pathname + '?room=' + encodeURIComponent(code);
}

function copyRoomLink() {
  if (navigator.clipboard) navigator.clipboard.writeText(roomLink()).catch(() => {});
  state.copiedLink = true;
  renderLobby();
  setTimeout(() => { state.copiedLink = false; renderLobby(); }, 1600);
}

function joinRoomByCode(rawCode) {
  const code = rawCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (code.length < 5) return;
  const pretty = code.length === 6 ? code.slice(0, 3) + '-' + code.slice(3, 6) : code;
  state.mode = 'online';
  state.roomCode = pretty;
  state.waitTitle = 'Connecting to ' + pretty + '…';
  state.screen = 'waiting';
  render();
  connectSocket(() => {
    sendMessage({
      type: 'joinRoom',
      playerId: state.playerId,
      roomCode: pretty,
      authToken: state.authToken,
      guestName: myDisplayName()
    });
  });
}

// A room link (?room=CODE) should drop the visitor straight into the room,
// the way opening a Meet link joins the call without extra steps.
function tryAutoJoinFromURL() {
  const params = new URLSearchParams(location.search);
  const room = params.get('room');
  if (!room) return;
  history.replaceState(null, '', location.pathname);
  joinRoomByCode(room);
}

function startNewLocalOrCpuGame(mode) {
  const side = state.side === 'random' ? (Math.random() < 0.5 ? 'X' : 'O') : state.side;
  state.humanSide = side;
  Object.assign(state, freshGame());
  if (mode) state.mode = mode;
  state.clockX = state.bank;
  state.clockO = state.bank;
  state.moveLeft = state.move;
  state.menuOpen = false;
  state.paused = false;
}

function startGame(mode) {
  clearTimeout(aiTimer);
  stopClock();
  closeSocket();
  startNewLocalOrCpuGame(mode);
  state.screen = 'game';
  state.sidePanelTab = 'log';
  render();
  const label = mode === 'local' ? 'Local match' : 'Match vs computer (' + LEVEL_LABEL[state.level] + ')';
  const bankTxt = state.bank ? fmtClock(state.bank) + ' each' : 'no bank';
  const moveTxt = state.move ? state.move + 's per move' : 'no move limit';
  appendLog(label + ' · ' + bankTxt + ' · ' + moveTxt, true);
  startClock();
  scheduleAiIfNeeded();
}

function resetGame() {
  clearTimeout(aiTimer);
  stopClock();
  startNewLocalOrCpuGame();
  render();
  appendLog('New game started.', true);
  startClock();
  scheduleAiIfNeeded();
}

function undoMove() {
  clearTimeout(aiTimer);
  const s = state;
  const h = s.history.slice();
  let n = s.mode !== 'local' && h.length > 1 ? 2 : 1;
  let snap = null;
  while (n-- > 0 && h.length) snap = h.pop();
  if (!snap) return;
  const log = s.log.slice();
  let k = s.mode !== 'local' ? 2 : 1;
  while (k-- > 0 && log.length > 1) log.pop();
  Object.assign(state, snap, { history: h, log: log });
  state.menuOpen = false;
  render();
  if (state.winner) {
    stopClock();
  } else {
    lastClockTick = Date.now();
    startClock();
    scheduleAiIfNeeded();
  }
}

function togglePause() {
  if (state.mode === 'online') return;
  state.paused = !state.paused;
  state.menuOpen = false;
  if (state.paused) {
    clearTimeout(aiTimer);
  } else {
    lastClockTick = Date.now();
    scheduleAiIfNeeded();
  }
  render();
}

function goHome() {
  clearTimeout(aiTimer);
  stopClock();
  closeSocket();
  Object.assign(state, {
    screen: 'home', roomCode: makeCode(), joinCode: '', copied: false, mySymbol: 'X',
    chat: [], log: [], rematchPending: false, rematchIncoming: false, sidePanelTab: 'chat',
    unreadChat: 0, menuOpen: false, paused: false
  });
  updateChatBadge();
  render();
}

function goBackToSetup() {
  stopClock();
  closeSocket();
  state.screen = 'setup';
  render();
}

function copyRoomCode() {
  if (navigator.clipboard) navigator.clipboard.writeText(state.roomCode).catch(() => {});
  state.copied = true;
  renderLobby();
  setTimeout(() => { state.copied = false; renderLobby(); }, 1600);
}

// ── Render: top bar / account modal ─────────────────────────────────────────

function renderTopbar() {
  const signedOut = document.getElementById('signed-out-actions');
  const signedIn = document.getElementById('signed-in-actions');
  if (state.account) {
    signedOut.classList.add('hidden');
    signedIn.classList.remove('hidden');
    document.getElementById('rating-label').textContent = state.account.rating + ' · Online';
    const av = document.getElementById('account-avatar');
    av.style.background = state.account.avatarColor;
    av.textContent = initialsFor(state.account.name);
    document.getElementById('account-name').textContent = state.account.name;
  } else {
    signedOut.classList.remove('hidden');
    signedIn.classList.add('hidden');
  }
}

function renderAccountModal() {
  const overlay = document.getElementById('account-modal');
  overlay.classList.toggle('hidden', !state.accountOpen);
  if (!state.accountOpen) return;

  const authForm = document.getElementById('account-auth-form');
  const profile = document.getElementById('account-profile');

  if (state.account) {
    authForm.classList.add('hidden');
    profile.classList.remove('hidden');
    document.getElementById('account-modal-title').textContent = 'Account';
    document.getElementById('account-modal-subtitle').textContent = 'Your rating, record, and rooms live here.';
    const av = document.getElementById('profile-avatar');
    av.style.background = state.account.avatarColor;
    av.textContent = initialsFor(state.account.name);
    document.getElementById('profile-name').textContent = state.account.name;
    document.getElementById('profile-meta').textContent = state.account.email;
    document.getElementById('stat-wins').textContent = state.account.wins;
    document.getElementById('stat-losses').textContent = state.account.losses;
    document.getElementById('stat-rating').textContent = state.account.rating;
  } else {
    authForm.classList.remove('hidden');
    profile.classList.add('hidden');
    document.getElementById('account-modal-title').textContent = state.authMode === 'signup' ? 'Create your account' : 'Sign In';
    document.getElementById('account-modal-subtitle').textContent = 'Save your rating and history, or keep playing as a guest.';
    document.getElementById('name-input').classList.toggle('hidden', state.authMode !== 'signup');
    document.getElementById('name-input').value = state.nameDraft;
    document.getElementById('email-input').value = state.emailDraft;
    document.getElementById('password-input').value = state.passwordDraft;
    const errEl = document.getElementById('auth-error');
    errEl.classList.toggle('hidden', !state.authError);
    errEl.textContent = state.authError;
    const submitBtn = document.getElementById('auth-submit');
    submitBtn.textContent = state.authBusy ? 'Please wait…' : (state.authMode === 'signup' ? 'Continue' : 'Sign In');
    submitBtn.disabled = state.authBusy;
    document.getElementById('auth-switch').textContent = state.authMode === 'signup'
      ? 'Already have an account? Sign In'
      : "Don't have an account? Create one";
  }
}

// ── Render: screens ──────────────────────────────────────────────────────────

function render() {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const screenEl = document.getElementById('screen-' + state.screen);
  if (screenEl) screenEl.classList.add('active');

  if (state.screen === 'setup') renderSetup();
  else if (state.screen === 'lobby') renderLobby();
  else if (state.screen === 'waiting') renderWaiting();
  else if (state.screen === 'game') renderGame();
}

function renderSegmented(containerId, opts, value, onPick) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  opts.forEach(o => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'segmented-opt' + (o.v === value ? ' active' : '');
    btn.textContent = o.label;
    btn.addEventListener('click', () => onPick(o.v));
    el.appendChild(btn);
  });
}

function renderThemeSwatches(containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  THEME_NAMES.forEach(name => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (state.themeName === name ? ' active' : '');
    sw.title = name;
    sw.style.background = THEMES[name].sub;
    sw.addEventListener('click', () => { applyTheme(name); render(); });
    el.appendChild(sw);
  });
}

function renderSetup() {
  const s = state;
  document.getElementById('setup-title').textContent =
    s.mode === 'local' ? 'Local Match' : s.mode === 'cpu' ? 'Play the Computer' : 'Online Match';
  document.getElementById('setup-subtitle').textContent =
    s.mode === 'local' ? 'Both players share this device — each gets their own clock.'
    : s.mode === 'cpu' ? 'Tune the strength and the clocks before you start.'
    : 'Set the rules, then share a room code.';

  const presetGrid = document.getElementById('preset-grid');
  presetGrid.innerHTML = '';
  PRESETS.forEach(p => {
    const card = document.createElement('div');
    card.className = 'preset-card' + (s.preset === p.id ? ' active' : '');
    const label = document.createElement('div');
    label.className = 'preset-card-label';
    label.textContent = p.label;
    const detail = document.createElement('div');
    detail.className = 'preset-card-detail';
    detail.textContent = p.detail;
    card.appendChild(label);
    card.appendChild(detail);
    card.addEventListener('click', () => applyPreset(p));
    presetGrid.appendChild(card);
  });

  renderSegmented('move-seg', MOVE_OPTS, s.move, v => { s.move = v; s.preset = 'custom'; renderSetup(); });
  renderSegmented('bank-seg', BANK_OPTS, s.bank, v => { s.bank = v; s.preset = 'custom'; renderSetup(); });

  document.getElementById('level-row').classList.toggle('hidden', s.mode !== 'cpu');
  renderSegmented('level-seg', LEVELS, s.level, v => { s.level = v; renderSetup(); });

  document.getElementById('side-row').classList.toggle('hidden', s.mode !== 'cpu');
  renderSegmented('side-seg', SIDES, s.side, v => { s.side = v; renderSetup(); });

  renderThemeSwatches('theme-swatches');

  document.getElementById('hints-toggle').classList.toggle('on', s.hints);
  document.getElementById('confirm-setup').textContent = s.mode === 'online' ? 'Create Room' : 'Start Match';
}

function renderLobby() {
  document.getElementById('room-code-display').textContent = state.roomCode;
  document.getElementById('copy-btn').textContent = state.copied ? 'Copied' : 'Copy Code';
  document.getElementById('copy-link-btn').textContent = state.copiedLink ? 'Link Copied' : 'Copy Link';

  const joinInput = document.getElementById('join-input');
  if (joinInput.value !== state.joinCode) joinInput.value = state.joinCode;

  const bankTxt = state.bank ? fmtClock(state.bank) + ' each' : 'No total bank';
  const moveTxt = state.move ? state.move + 's per move' : 'No move limit';
  document.getElementById('lobby-summary').textContent = bankTxt + ' · ' + moveTxt;
}

function renderWaiting() {
  document.getElementById('wait-title').textContent = state.waitTitle;
  document.getElementById('wait-room').textContent = 'Room ' + state.roomCode;
}

function subTextFor(side) {
  const s = state;
  if (s.mode === 'local') return side === 'X' ? 'Moves first' : 'Moves second';
  const isBottom = side === bottomSide();
  if (s.mode === 'cpu') return isBottom ? 'You · ' + side : 'Computer · ' + LEVEL_LABEL[s.level];
  if (s.mode === 'online') {
    if (isBottom) return 'You · ' + side;
    return 'Opponent · ' + side + (state.opponentRating != null ? ' · ' + state.opponentRating : '');
  }
  return '';
}

function setClockPanel(prefix, side) {
  const s = state;
  const active = !s.winner && !s.paused && s.turn === side;

  const markEl = document.getElementById(prefix + '-mark');
  markEl.textContent = side === 'X' ? '✕' : '○';
  markEl.style.color = side === 'X' ? X_COLOR : O_COLOR;

  document.getElementById(prefix + '-label').textContent = displayName(side);
  document.getElementById(prefix + '-sub').textContent = subTextFor(side);

  const bankOn = s.bank > 0;
  const val = side === 'X' ? s.clockX : s.clockO;
  const clockEl = document.getElementById(prefix + '-clock');
  clockEl.textContent = bankOn ? fmtClock(val) : '∞';
  clockEl.style.color = !bankOn ? '#8E8E93' : !active ? '#98989D' : (val <= 10 ? '#FF453A' : val <= 30 ? '#FF9F0A' : '#F5F5F7');

  const row = document.getElementById('panel-' + prefix).querySelector('.clock-row');
  row.classList.toggle('active', active);
  row.classList.toggle('o-turn', active && side === 'O');

  const moveOn = s.move > 0;
  const moveFrac = moveOn ? Math.max(0, Math.min(1, s.moveLeft / s.move)) : 1;
  const barEl = document.getElementById(prefix + '-bar');
  barEl.style.width = (moveOn ? (active ? moveFrac * 100 : 100) : 100) + '%';
  barEl.style.background = !moveOn
    ? '#2C2C2E'
    : (s.winner || !active) ? 'rgba(255,255,255,0.10)'
    : (moveFrac < 0.2 ? '#FF453A' : moveFrac < 0.5 ? '#FF9F0A' : (side === 'X' ? X_COLOR : O_COLOR));
  document.getElementById(prefix + '-move-label').textContent =
    moveOn ? (active ? Math.max(0, Math.ceil(s.moveLeft)) + 's' : s.move + 's') : 'No limit';
}

function renderClocks() {
  if (state.screen !== 'game') return;
  setClockPanel('top', topSideOf());
  setClockPanel('bottom', bottomSide());
}

function renderSideTabs() {
  const s = state;
  const chatAllowed = s.mode === 'online';
  const chatTab = document.getElementById('tab-chat');
  chatTab.classList.toggle('hidden', !chatAllowed);
  if (!chatAllowed && s.sidePanelTab === 'chat') s.sidePanelTab = 'log';

  document.getElementById('tab-chat').classList.toggle('active', s.sidePanelTab === 'chat');
  document.getElementById('tab-log').classList.toggle('active', s.sidePanelTab === 'log');
  document.getElementById('panel-chat').classList.toggle('active', s.sidePanelTab === 'chat');
  document.getElementById('panel-log').classList.toggle('active', s.sidePanelTab === 'log');

  document.getElementById('menu-panel').classList.toggle('hidden', !s.menuOpen);
  document.getElementById('menu-btn').classList.toggle('active', s.menuOpen);
  if (s.menuOpen) renderThemeSwatches('menu-theme-swatches');

  document.getElementById('log-footer').textContent = s.move
    ? ('Each move must be played within ' + s.move + 's or the turn is forfeited.')
    : 'No move limit in this match.';
}

function renderGame() {
  const s = state;

  const banner = document.getElementById('result-banner');
  if (s.winner) {
    banner.classList.add('active');
    banner.textContent = s.winner === 'D' ? 'Draw' : (displayName(s.winner) + (s.winReason === 'flag' ? ' wins on time' : ' wins'));
    banner.style.color = s.winner === 'D' ? 'var(--text2)' : (s.winner === 'X' ? X_COLOR : O_COLOR);
  } else {
    banner.classList.remove('active');
  }

  renderClocks();

  document.getElementById('menu-pause').textContent = s.paused ? 'Resume' : 'Pause';
  document.getElementById('menu-pause').disabled = s.mode === 'online';
  document.getElementById('menu-undo').disabled = s.mode === 'online' || !s.history.length;
  const rematchBtn = document.getElementById('menu-rematch');
  rematchBtn.textContent = (s.mode === 'online' && s.rematchPending) ? 'Waiting…' : 'Rematch';
  rematchBtn.disabled = s.mode === 'online' && (!s.winner || s.rematchPending);

  document.getElementById('rematch-incoming').classList.toggle('active', s.mode === 'online' && s.rematchIncoming);

  renderSideTabs();
  renderBoards();
}

function renderBoards() {
  const s = state;
  const th = CURRENT_THEME;
  const container = document.getElementById('boards-container');

  for (let b = 0; b < 9; b++) {
    const bw = s.winners[b];
    const playable = !s.winner && !s.paused && !bw && (s.active === null || s.active === b);
    const boardEl = container.children[b];

    boardEl.style.opacity = (bw || playable) ? '1' : '0.42';
    boardEl.style.boxShadow = (playable && s.hints)
      ? '0 0 0 2px ' + (s.turn === 'X' ? 'rgba(10,132,255,0.55)' : 'rgba(255,69,58,0.55)')
      : '0 0 0 1px rgba(255,255,255,0.05)';

    const overlay = boardEl.querySelector('.board-overlay');
    overlay.style.background = th.overlay;
    overlay.style.opacity = bw ? '1' : '0';
    overlay.style.color = bw === 'X' ? X_COLOR : bw === 'O' ? O_COLOR : '#48484A';
    overlay.textContent = bw === 'X' ? '✕' : bw === 'O' ? '○' : bw === 'D' ? '–' : '';

    const cellEls = boardEl.querySelectorAll('.game-cell');
    for (let c = 0; c < 9; c++) {
      const i = b * 9 + c;
      const mark = s.cells[i];
      const cellEl = cellEls[c];

      cellEl.style.background = mark === 'X' ? TINT_X
        : mark === 'O' ? TINT_O
        : playable ? th.tile
        : th.idle;
      cellEl.style.color = mark === 'X' ? X_COLOR : O_COLOR;
      cellEl.style.boxShadow = s.last === i
        ? 'inset 0 0 0 2px ' + (mark === 'X' ? X_COLOR : O_COLOR)
        : 'none';
      cellEl.textContent = mark === 'X' ? '✕' : mark === 'O' ? '○' : '';
    }
  }

  updateMainWinLine();
}

function updateMainWinLine() {
  const s = state;
  const svg = document.getElementById('main-win-line');
  if (!svg) return;
  const linePath = svg.querySelector('.win-line-path');
  const pattern = (s.winner && s.winner !== 'D') ? findWinPattern(s.winners) : null;
  if (pattern !== null) {
    const coords = LINE_COORDS[pattern];
    linePath.setAttribute('x1', coords.x1);
    linePath.setAttribute('y1', coords.y1);
    linePath.setAttribute('x2', coords.x2);
    linePath.setAttribute('y2', coords.y2);
    linePath.style.stroke = s.winner === 'X' ? X_COLOR : O_COLOR;
    svg.style.opacity = '1';
  } else {
    svg.style.opacity = '0';
  }
}

// ── DOM setup ────────────────────────────────────────────────────────────────

function makeWinLineSVG(extraClass) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 3 3');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('win-line');
  if (extraClass) svg.classList.add(extraClass);
  const line = document.createElementNS(SVG_NS, 'line');
  line.classList.add('win-line-path');
  svg.appendChild(line);
  return svg;
}

function buildBoards() {
  const container = document.getElementById('boards-container');
  container.innerHTML = '';
  for (let b = 0; b < 9; b++) {
    const board = document.createElement('div');
    board.className = 'mini-board';

    const grid = document.createElement('div');
    grid.className = 'cell-grid';

    for (let c = 0; c < 9; c++) {
      const cell = document.createElement('div');
      cell.className = 'game-cell';
      cell.dataset.board = b;
      cell.dataset.cell = c;
      grid.appendChild(cell);
    }

    const overlay = document.createElement('div');
    overlay.className = 'board-overlay';

    board.appendChild(grid);
    board.appendChild(overlay);
    container.appendChild(board);
  }

  const mainSvg = makeWinLineSVG('win-line-main');
  mainSvg.id = 'main-win-line';
  container.appendChild(mainSvg);
}

document.addEventListener('DOMContentLoaded', () => {
  buildBoards();
  restoreTheme();
  render();
  restoreSession().then(tryAutoJoinFromURL);

  // Top bar
  document.getElementById('btn-logo').addEventListener('click', goHome);
  document.getElementById('btn-signin').addEventListener('click', () => openAccountModal('login'));
  document.getElementById('btn-signup').addEventListener('click', () => openAccountModal('signup'));
  document.getElementById('btn-account').addEventListener('click', () => openAccountModal());

  // Account modal
  document.getElementById('account-modal').addEventListener('click', closeAccountModal);
  document.getElementById('account-modal-card').addEventListener('click', e => e.stopPropagation());
  document.getElementById('name-input').addEventListener('input', e => { state.nameDraft = e.target.value; });
  document.getElementById('email-input').addEventListener('input', e => { state.emailDraft = e.target.value; });
  document.getElementById('password-input').addEventListener('input', e => { state.passwordDraft = e.target.value; });
  document.getElementById('auth-submit').addEventListener('click', submitAuth);
  document.getElementById('auth-switch').addEventListener('click', () => {
    state.authMode = state.authMode === 'signup' ? 'login' : 'signup';
    state.authError = '';
    renderAccountModal();
  });
  document.getElementById('btn-guest').addEventListener('click', playAsGuest);
  document.getElementById('btn-signout').addEventListener('click', signOut);

  // Home
  document.getElementById('btn-local').addEventListener('click', () => openSetup('local'));
  document.getElementById('btn-cpu').addEventListener('click', () => openSetup('cpu'));
  document.getElementById('btn-online').addEventListener('click', () => openSetup('online'));

  // Setup
  document.getElementById('back-setup').addEventListener('click', goHome);
  document.getElementById('confirm-setup').addEventListener('click', confirmSetup);
  document.getElementById('hints-toggle').addEventListener('click', () => { state.hints = !state.hints; renderSetup(); });

  // Lobby (room is already live by the time this screen shows — see enterRoom())
  document.getElementById('back-lobby').addEventListener('click', goBackToSetup);
  document.getElementById('copy-btn').addEventListener('click', copyRoomCode);
  document.getElementById('copy-link-btn').addEventListener('click', copyRoomLink);
  document.getElementById('join-input').addEventListener('input', e => {
    state.joinCode = e.target.value.toUpperCase();
    renderLobby();
  });
  document.getElementById('join-btn').addEventListener('click', () => joinRoomByCode(state.joinCode));

  // Waiting
  document.getElementById('cancel-wait').addEventListener('click', goHome);

  // Game — menu
  document.getElementById('menu-btn').addEventListener('click', () => {
    state.menuOpen = !state.menuOpen;
    renderSideTabs();
  });
  document.getElementById('menu-pause').addEventListener('click', togglePause);
  document.getElementById('menu-undo').addEventListener('click', () => {
    if (state.mode !== 'online') undoMove();
  });
  document.getElementById('menu-rematch').addEventListener('click', () => {
    const s = state;
    s.menuOpen = false;
    if (s.mode === 'online') {
      if (!s.winner || s.rematchPending) { render(); return; }
      s.rematchPending = true;
      sendMessage({ type: 'rematchRequest', playerId: s.playerId });
      render();
    } else {
      resetGame();
    }
  });
  document.getElementById('menu-leave').addEventListener('click', () => {
    state.menuOpen = false;
    goHome();
  });

  // Game — rematch banner
  document.getElementById('rematch-accept').addEventListener('click', () => {
    state.rematchIncoming = false;
    sendMessage({ type: 'rematchResponse', playerId: state.playerId, accept: true });
    render();
  });
  document.getElementById('rematch-decline').addEventListener('click', () => {
    state.rematchIncoming = false;
    sendMessage({ type: 'rematchResponse', playerId: state.playerId, accept: false });
    render();
  });

  // Game — tabs
  document.getElementById('tab-chat').addEventListener('click', () => {
    if (state.mode !== 'online') return;
    state.sidePanelTab = 'chat';
    state.unreadChat = 0;
    updateChatBadge();
    renderSideTabs();
  });
  document.getElementById('tab-log').addEventListener('click', () => {
    state.sidePanelTab = 'log';
    renderSideTabs();
  });

  // Game — chat
  document.getElementById('chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    sendChat(input.value);
    input.value = '';
  });

  // Game — board cell clicks (event delegation)
  document.getElementById('boards-container').addEventListener('click', e => {
    const cellEl = e.target.closest('.game-cell');
    if (!cellEl) return;
    play(parseInt(cellEl.dataset.board), parseInt(cellEl.dataset.cell), false);
  });
});
