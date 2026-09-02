'use strict';

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
const X_COLOR = '#0A84FF';
const O_COLOR = '#FF453A';
const TINT_X = 'rgba(10,132,255,0.16)';
const TINT_O = 'rgba(255,69,58,0.16)';
const TURN_MS = 30000;
const SVG_NS = 'http://www.w3.org/2000/svg';

function makeCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s.slice(0, 3) + '-' + s.slice(3);
}

function freshGame() {
  return {
    cells: Array(81).fill(null),
    winners: Array(9).fill(null),
    turn: 'X',
    active: null,
    winner: null,
    last: null,
    history: [],
    log: [],
    turnStartedAt: Date.now()
  };
}

const state = Object.assign({
  screen: 'home',
  mode: 'cpu',
  roomCode: makeCode(),
  joinCode: '',
  copied: false,
  waitTitle: 'Waiting for opponent…',
  opponentName: 'Opponent',
  playerId: Math.random().toString(36).slice(2) + Date.now().toString(36),
  mySymbol: 'X',
  turnDuration: TURN_MS,
  chat: [],
  sidePanelTab: 'log',
  rematchPending: false,
  rematchIncoming: false,
  unreadChat: 0
}, freshGame());

let aiTimer = null;
let socket = null;
let timerInterval = null;
let titleFlashInterval = null;
const ORIGINAL_TITLE = document.title;

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

// ── Online connection ───────────────────────────────────────────────────────

function wsURL() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  return proto + location.host + '/ws';
}

function sendMessage(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
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
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'waiting':
      state.waitTitle = 'Waiting for opponent…';
      render();
      break;
    case 'gameStart':
      clearTimeout(aiTimer);
      stopTurnTimer();
      state.chat = [];
      state.log = [];
      state.rematchPending = false;
      state.rematchIncoming = false;
      state.unreadChat = 0;
      applyServerGameState(msg.gameState);
      state.mySymbol = msg.playerSymbol;
      state.opponentName = 'Opponent';
      state.last = null;
      state.turnStartedAt = msg.turnStartedAt || Date.now();
      state.turnDuration = msg.turnDuration || TURN_MS;
      state.mode = 'online';
      state.screen = 'game';
      render();
      updateChatBadge();
      appendLog('Game started — you are ' + state.mySymbol + '.');
      startTurnTimer();
      break;
    case 'move': {
      const prevWinners = state.winners;
      const prevWinner = state.winner;
      applyServerGameState(msg.gameState);
      state.last = msg.boardIndex * 9 + msg.cellIndex;
      state.turnStartedAt = msg.turnStartedAt || Date.now();
      state.turnDuration = msg.turnDuration || TURN_MS;
      render();
      logMoveOutcome(msg.symbol, msg.boardIndex, msg.cellIndex, !!msg.timedOut, prevWinners, prevWinner);
      if (state.winner) stopTurnTimer(); else startTurnTimer();
      break;
    }
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
    case 'roomNotFound':
    case 'error':
      alert(msg.message || 'Something went wrong.');
      closeSocket();
      state.screen = 'lobby';
      render();
      break;
  }
}

// ── Match log / chat ────────────────────────────────────────────────────────

function displayName(symbol) {
  const s = state;
  if (s.mode === 'local') return symbol === 'X' ? 'Player 1' : 'Player 2';
  if (s.mode === 'cpu') return symbol === 'X' ? 'You' : 'Computer';
  if (s.mode === 'online') return symbol === s.mySymbol ? 'You' : s.opponentName;
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

function logMoveOutcome(symbol, boardIndex, cellIndex, timedOut, prevWinners, prevWinner) {
  appendLog(displayName(symbol) + ' → board ' + (boardIndex + 1) + ', cell ' + (cellIndex + 1) + (timedOut ? ' (timed out)' : ''));
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
      bubble.textContent = entry.text;
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

// ── Turn timer ──────────────────────────────────────────────────────────────

function startTurnTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, 200);
  tickTimer();
}

function stopTurnTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  const el = document.getElementById('turn-timer');
  if (el) { el.textContent = ''; el.classList.remove('timer-warn'); }
}

function tickTimer() {
  const s = state;
  if (s.screen !== 'game' || s.winner) { stopTurnTimer(); return; }
  const elapsed = Date.now() - s.turnStartedAt;
  const remaining = Math.max(0, s.turnDuration - elapsed);
  const secs = Math.ceil(remaining / 1000);
  const el = document.getElementById('turn-timer');
  if (el) {
    el.textContent = secs + 's';
    el.classList.toggle('timer-warn', secs <= 10);
  }
  if (remaining <= 0) {
    clearInterval(timerInterval);
    timerInterval = null;
    if (s.mode === 'local' || (s.mode === 'cpu' && s.turn === 'X')) {
      autoPlayTimeout();
    }
  }
}

function autoPlayTimeout() {
  const s = state;
  if (s.winner) return;
  const moves = legalMoves(s.cells, s.winners, s.active);
  if (!moves.length) return;
  const [b, c] = moves[Math.floor(Math.random() * moves.length)];
  play(b, c, false, true);
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

function play(b, c, fromAI, timedOut) {
  const s = state;
  if (s.winner) return;
  if (s.mode === 'online') {
    if (fromAI) return;
    if (s.turn !== s.mySymbol) return;
    if (s.winners[b] || s.cells[b * 9 + c]) return;
    if (s.active !== null && s.active !== b) return;
    sendMessage({ type: 'makeMove', playerId: s.playerId, boardIndex: b, cellIndex: c });
    return;
  }
  const aiSide = s.mode === 'local' ? null : 'O';
  if (aiSide && s.turn === aiSide && !fromAI) return;
  if (s.winners[b] || s.cells[b * 9 + c]) return;
  if (s.active !== null && s.active !== b) return;

  const symbol = s.turn;
  const prevWinners = s.winners;
  const prevWinner = s.winner;

  const snapshot = {
    cells: s.cells.slice(),
    winners: s.winners.slice(),
    turn: s.turn,
    active: s.active,
    winner: s.winner,
    last: s.last
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
  const done = gameWinner || winners.every(Boolean);

  s.cells = cells;
  s.winners = winners;
  s.turn = s.turn === 'X' ? 'O' : 'X';
  s.active = active;
  s.winner = gameWinner || (winners.every(Boolean) ? 'D' : null);
  s.last = b * 9 + c;
  s.turnStartedAt = Date.now();
  s.history = s.history.concat([snapshot]);

  render();
  logMoveOutcome(symbol, b, c, !!timedOut, prevWinners, prevWinner);

  if (s.winner) {
    stopTurnTimer();
  } else {
    startTurnTimer();
  }

  if (!done && s.mode !== 'local' && s.turn === 'O') {
    clearTimeout(aiTimer);
    aiTimer = setTimeout(aiMove, 420);
  }
}

function scoreMove([b, c], cells, winners) {
  let s = Math.random() * 3;
  const nc = cells.slice();
  nc[b * 9 + c] = 'O';
  const nw = winners.slice();
  const sub = nc.slice(b * 9, b * 9 + 9);
  const w = lineWinner(sub);
  if (w) nw[b] = w; else if (sub.every(Boolean)) nw[b] = 'D';

  if (nw[b] === 'O') {
    if (lineWinner(nw) === 'O') return 1e6;
    s += 60;
    if (b === 4) s += 12;
  }
  const alt = cells.slice();
  alt[b * 9 + c] = 'X';
  if (lineWinner(alt.slice(b * 9, b * 9 + 9)) === 'X') s += 45;

  if (b === 4) s += 6;
  if (c === 4) s += 5;
  else if ([0, 2, 6, 8].includes(c)) s += 2;

  const nextSub = nc.slice(c * 9, c * 9 + 9);
  if (nw[c] || nextSub.every(Boolean)) {
    s -= 25;
  } else {
    let threat = false;
    for (const [p, q, r] of LINES) {
      const v = [nextSub[p], nextSub[q], nextSub[r]];
      if (v.filter(x => x === 'X').length === 2 && v.filter(x => !x).length === 1) {
        threat = true;
        break;
      }
    }
    if (threat) {
      s -= 35;
      const w2 = nw.slice();
      w2[c] = 'X';
      if (lineWinner(w2) === 'X') s -= 500;
    }
  }
  return s;
}

function aiMove() {
  const { cells, winners, active, winner } = state;
  if (winner) return;
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

function startGame(mode, extra) {
  clearTimeout(aiTimer);
  if (mode !== 'online') closeSocket();
  Object.assign(state, { screen: 'game', mode }, freshGame(), extra || {});
  render();
  const label = mode === 'local' ? 'Pass & Play' : 'You vs Computer';
  appendLog(label + ' — game started.');
  startTurnTimer();
}

function resetGame() {
  clearTimeout(aiTimer);
  Object.assign(state, freshGame());
  render();
  const label = state.mode === 'local' ? 'Pass & Play' : 'You vs Computer';
  appendLog(label + ' — game started.');
  startTurnTimer();
}

function undoMove() {
  clearTimeout(aiTimer);
  const h = state.history.slice();
  let n = state.mode !== 'local' && h.length > 1 ? 2 : 1;
  let snap = null;
  while (n-- > 0 && h.length) snap = h.pop();
  if (snap) {
    Object.assign(state, snap, { history: h, turnStartedAt: Date.now() });
    render();
    appendLog('Move undone.');
    if (state.winner) stopTurnTimer(); else startTurnTimer();
  }
}

function goHome() {
  clearTimeout(aiTimer);
  stopTurnTimer();
  closeSocket();
  Object.assign(state, {
    screen: 'home', roomCode: makeCode(), joinCode: '', copied: false, mySymbol: 'X',
    chat: [], log: [], rematchPending: false, rematchIncoming: false, sidePanelTab: 'log', unreadChat: 0
  });
  updateChatBadge();
  render();
}

function goLobby() {
  stopTurnTimer();
  closeSocket();
  state.screen = 'lobby';
  state.roomCode = makeCode();
  state.copied = false;
  render();
}

function copyRoomCode() {
  if (navigator.clipboard) navigator.clipboard.writeText(state.roomCode).catch(() => {});
  state.copied = true;
  render();
  setTimeout(() => { state.copied = false; render(); }, 1600);
}

// ── Render ───────────────────────────────────────────────────────────────────

function render() {
  // Switch screens
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const screenEl = document.getElementById('screen-' + state.screen);
  if (screenEl) screenEl.classList.add('active');

  if (state.screen === 'lobby') renderLobby();
  else if (state.screen === 'waiting') renderWaiting();
  else if (state.screen === 'game') renderGame();
}

function renderLobby() {
  document.getElementById('room-code-display').textContent = state.roomCode;
  document.getElementById('copy-btn').textContent = state.copied ? 'Copied' : 'Copy Code';

  const joinInput = document.getElementById('join-input');
  if (joinInput.value !== state.joinCode) joinInput.value = state.joinCode;

  const code = state.joinCode.replace(/[^A-Za-z0-9]/g, '');
  document.getElementById('join-btn').style.opacity = code.length >= 5 ? '1' : '0.4';
}

function renderWaiting() {
  document.getElementById('wait-title').textContent = state.waitTitle;
  document.getElementById('wait-room').textContent = 'Room ' + state.roomCode;
}

function renderSideTabs() {
  const s = state;
  const chatAllowed = s.mode === 'online';
  const tabChatBtn = document.getElementById('tab-chat');
  tabChatBtn.classList.toggle('hidden', !chatAllowed);
  if (!chatAllowed) s.sidePanelTab = 'log';

  document.getElementById('tab-log').classList.toggle('active', s.sidePanelTab === 'log');
  tabChatBtn.classList.toggle('active', s.sidePanelTab === 'chat');
  document.getElementById('panel-log').classList.toggle('active', s.sidePanelTab === 'log');
  document.getElementById('panel-chat').classList.toggle('active', s.sidePanelTab === 'chat');
}

function renderGame() {
  const s = state;
  const X = X_COLOR;
  const O = O_COLOR;

  // Status pill
  const turnColor = s.winner
    ? (s.winner === 'D' ? '#98989D' : (s.winner === 'X' ? X : O))
    : (s.turn === 'X' ? X : O);

  const remote = s.mode !== 'local';
  const mySymbol = s.mode === 'online' ? s.mySymbol : 'X';
  const oppSymbol = mySymbol === 'X' ? 'O' : 'X';
  let statusText;
  if (s.winner === 'D') {
    statusText = 'Draw';
  } else if (s.winner) {
    if (!remote) {
      statusText = s.winner + ' wins';
    } else if (s.winner === mySymbol) {
      statusText = 'You win';
    } else {
      statusText = s.mode === 'online' ? s.opponentName + ' wins' : 'Computer wins';
    }
  } else if (remote && s.turn === oppSymbol) {
    statusText = s.mode === 'online' ? s.opponentName + ' is playing…' : 'Computer is thinking…';
  } else {
    statusText = (remote ? 'Your turn' : s.turn + '’s turn')
      + (s.active === null ? ' — play anywhere' : ' — highlighted board');
  }

  document.getElementById('status-dot').style.background = turnColor;
  document.getElementById('status-text').textContent = statusText;
  document.getElementById('mode-label').textContent =
    s.mode === 'local' ? 'Pass & Play'
    : s.mode === 'online' ? 'Room ' + s.roomCode
    : 'Single player';

  // Player chips
  const xOn = !s.winner && s.turn === 'X';
  const oOn = !s.winner && s.turn === 'O';
  const chipRing = '0 0 0 1px rgba(255,255,255,0.09)';
  const xChip = document.getElementById('x-chip');
  const oChip = document.getElementById('o-chip');
  xChip.style.background = xOn ? '#1C1C1E' : 'transparent';
  xChip.style.boxShadow = xOn ? chipRing : 'none';
  oChip.style.background = oOn ? '#1C1C1E' : 'transparent';
  oChip.style.boxShadow = oOn ? chipRing : 'none';
  const oppLabel = s.mode === 'online' ? s.opponentName : 'Computer';
  document.getElementById('x-label').textContent =
    s.mode === 'local' ? 'Player 1' : (mySymbol === 'X' ? 'You' : oppLabel);
  document.getElementById('o-label').textContent =
    s.mode === 'local' ? 'Player 2' : (mySymbol === 'O' ? 'You' : oppLabel);

  // Action buttons
  const undoBtn = document.getElementById('undo-btn');
  const rematchBtn = document.getElementById('rematch-btn');
  const newGameBtn = document.getElementById('new-game-btn');

  if (s.mode === 'online') {
    undoBtn.classList.add('hidden');
    if (s.winner) {
      rematchBtn.classList.remove('hidden');
      rematchBtn.textContent = s.rematchPending ? 'Waiting…' : 'Rematch';
      rematchBtn.disabled = s.rematchPending;
    } else {
      rematchBtn.classList.add('hidden');
    }
    newGameBtn.textContent = 'Leave';
  } else {
    undoBtn.classList.remove('hidden');
    rematchBtn.classList.add('hidden');
    newGameBtn.textContent = 'New Game';
  }

  document.getElementById('rematch-incoming').classList.toggle('active', s.mode === 'online' && s.rematchIncoming);

  renderSideTabs();
  renderBoards();
  fitBoard();
}

// ── Fit the board to the viewport so the game never needs scrolling ─────────

function fitBoard() {
  if (state.screen !== 'game') return;
  const boardsGrid = document.getElementById('boards-container');
  const gameMain = document.querySelector('.game-main');
  const gameLayout = document.querySelector('.game-layout');
  const gameCol = document.querySelector('.game-col');
  const screenEl = document.getElementById('screen-game');
  const gameSide = document.querySelector('.game-side');
  const topbar = document.querySelector('.game-topbar');
  const chips = document.querySelector('.player-chips');
  const actions = document.querySelector('.game-actions');
  const hint = document.querySelector('.game-hint');
  const rematchBar = document.getElementById('rematch-incoming');

  boardsGrid.style.width = '';

  const stacked = getComputedStyle(gameLayout).flexDirection === 'column';
  const screenStyle = getComputedStyle(screenEl);
  const padTop = parseFloat(screenStyle.paddingTop) || 0;
  const padBottom = parseFloat(screenStyle.paddingBottom) || 0;
  const gameColGap = parseFloat(getComputedStyle(gameCol).rowGap) || 0;
  const mainGap = parseFloat(getComputedStyle(gameMain).rowGap) || 0;

  let used = padTop + padBottom;
  used += topbar.getBoundingClientRect().height + gameColGap;
  used += chips.getBoundingClientRect().height + mainGap;
  if (rematchBar.classList.contains('active')) used += rematchBar.getBoundingClientRect().height + mainGap;
  used += actions.getBoundingClientRect().height + mainGap;
  used += hint.getBoundingClientRect().height + mainGap;
  if (stacked) used += gameSide.getBoundingClientRect().height + gameColGap;

  const availableH = Math.max(180, window.innerHeight - used - 12);
  const availableW = gameMain.getBoundingClientRect().width;
  boardsGrid.style.width = Math.min(availableW, availableH) + 'px';
}

function renderBoards() {
  const s = state;
  const X = X_COLOR;
  const O = O_COLOR;
  const container = document.getElementById('boards-container');

  for (let b = 0; b < 9; b++) {
    const bw = s.winners[b];
    const playable = !s.winner && !bw && (s.active === null || s.active === b);
    const boardEl = container.children[b];

    boardEl.style.opacity = (bw || playable) ? '1' : '0.42';
    boardEl.style.boxShadow = playable
      ? '0 0 0 2px ' + (s.turn === 'X' ? 'rgba(10,132,255,0.55)' : 'rgba(255,69,58,0.55)')
      : '0 0 0 1px rgba(255,255,255,0.05)';

    // Win overlay
    const overlay = boardEl.querySelector('.board-overlay');
    overlay.style.opacity = bw ? '1' : '0';
    overlay.style.color = bw === 'X' ? X : bw === 'O' ? O : '#48484A';
    overlay.textContent = bw === 'X' ? '✕' : bw === 'O' ? '○' : bw === 'D' ? '–' : '';

    // Cells
    const cellEls = boardEl.querySelectorAll('.game-cell');
    for (let c = 0; c < 9; c++) {
      const i = b * 9 + c;
      const mark = s.cells[i];
      const cellEl = cellEls[c];

      cellEl.style.background = mark === 'X' ? TINT_X
        : mark === 'O' ? TINT_O
        : playable ? '#2C2C2E'
        : '#242426';
      cellEl.style.color = mark === 'X' ? X : O;
      cellEl.style.boxShadow = s.last === i
        ? 'inset 0 0 0 2px ' + (mark === 'X' ? X : O)
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

  // Home
  document.getElementById('btn-local').addEventListener('click', () => startGame('local'));
  document.getElementById('btn-cpu').addEventListener('click', () => startGame('cpu'));
  document.getElementById('btn-online').addEventListener('click', goLobby);

  // Lobby
  document.getElementById('back-lobby').addEventListener('click', goHome);
  document.getElementById('copy-btn').addEventListener('click', copyRoomCode);
  document.getElementById('open-room-btn').addEventListener('click', () => {
    state.waitTitle = 'Waiting for opponent…';
    state.screen = 'waiting';
    render();
    connectSocket(() => {
      sendMessage({ type: 'createRoom', playerId: state.playerId, roomCode: state.roomCode });
    });
  });
  document.getElementById('join-input').addEventListener('input', e => {
    state.joinCode = e.target.value.toUpperCase();
    renderLobby();
  });
  document.getElementById('join-btn').addEventListener('click', () => {
    const code = state.joinCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (code.length < 5) return;
    const pretty = code.slice(0, 3) + '-' + code.slice(3, 6);
    state.roomCode = pretty;
    state.waitTitle = 'Connecting to ' + pretty + '…';
    state.screen = 'waiting';
    render();
    connectSocket(() => {
      sendMessage({ type: 'joinRoom', playerId: state.playerId, roomCode: pretty });
    });
  });

  // Waiting
  document.getElementById('cancel-wait').addEventListener('click', goHome);

  // Game
  document.getElementById('back-game').addEventListener('click', goHome);
  document.getElementById('undo-btn').addEventListener('click', () => {
    if (state.mode !== 'online') undoMove();
  });
  document.getElementById('new-game-btn').addEventListener('click', () => {
    if (state.mode === 'online') goHome();
    else resetGame();
  });

  // Rematch
  document.getElementById('rematch-btn').addEventListener('click', () => {
    if (state.mode !== 'online' || !state.winner || state.rematchPending) return;
    state.rematchPending = true;
    sendMessage({ type: 'rematchRequest', playerId: state.playerId });
    renderGame();
  });
  document.getElementById('rematch-accept').addEventListener('click', () => {
    state.rematchIncoming = false;
    sendMessage({ type: 'rematchResponse', playerId: state.playerId, accept: true });
    renderGame();
  });
  document.getElementById('rematch-decline').addEventListener('click', () => {
    state.rematchIncoming = false;
    sendMessage({ type: 'rematchResponse', playerId: state.playerId, accept: false });
    renderGame();
  });

  // Side panel tabs
  document.getElementById('tab-log').addEventListener('click', () => {
    state.sidePanelTab = 'log';
    renderSideTabs();
  });
  document.getElementById('tab-chat').addEventListener('click', () => {
    if (state.mode !== 'online') return;
    state.sidePanelTab = 'chat';
    state.unreadChat = 0;
    updateChatBadge();
    renderSideTabs();
  });

  // Chat
  document.getElementById('chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    sendChat(input.value);
    input.value = '';
  });

  // Board cell clicks (event delegation)
  document.getElementById('boards-container').addEventListener('click', e => {
    const cellEl = e.target.closest('.game-cell');
    if (!cellEl) return;
    const b = parseInt(cellEl.dataset.board);
    const c = parseInt(cellEl.dataset.cell);
    play(b, c, false);
  });

  let resizeRAF = null;
  window.addEventListener('resize', () => {
    if (resizeRAF) cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(fitBoard);
  });

  render();
});
