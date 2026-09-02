'use strict';

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const X_COLOR = '#0A84FF';
const O_COLOR = '#FF453A';
const TINT_X = 'rgba(10,132,255,0.16)';
const TINT_O = 'rgba(255,69,58,0.16)';

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
    history: []
  };
}

const state = Object.assign({
  screen: 'home',
  mode: 'cpu',
  roomCode: makeCode(),
  joinCode: '',
  copied: false,
  waitTitle: 'Waiting for opponent…',
  opponentName: 'Opponent'
}, freshGame());

let aiTimer = null;
let waitTimer = null;

// ── Game logic ──────────────────────────────────────────────────────────────

function lineWinner(g) {
  for (const [a, b, c] of LINES) {
    if (g[a] && g[a] !== 'D' && g[a] === g[b] && g[a] === g[c]) return g[a];
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
  if (s.winner) return;
  const aiSide = s.mode === 'local' ? null : 'O';
  if (aiSide && s.turn === aiSide && !fromAI) return;
  if (s.winners[b] || s.cells[b * 9 + c]) return;
  if (s.active !== null && s.active !== b) return;

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
  s.history = s.history.concat([snapshot]);

  render();

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
  clearTimeout(waitTimer);
  Object.assign(state, { screen: 'game', mode }, freshGame(), extra || {});
  render();
}

function resetGame() {
  clearTimeout(aiTimer);
  Object.assign(state, freshGame());
  render();
}

function undoMove() {
  clearTimeout(aiTimer);
  const h = state.history.slice();
  let n = state.mode !== 'local' && h.length > 1 ? 2 : 1;
  let snap = null;
  while (n-- > 0 && h.length) snap = h.pop();
  if (snap) {
    Object.assign(state, snap, { history: h });
    render();
  }
}

function goHome() {
  clearTimeout(aiTimer);
  clearTimeout(waitTimer);
  Object.assign(state, { screen: 'home', roomCode: makeCode(), joinCode: '', copied: false });
  render();
}

function goLobby() {
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

function waitForOpponent(title, name) {
  clearTimeout(waitTimer);
  state.screen = 'waiting';
  state.waitTitle = title;
  render();
  waitTimer = setTimeout(() => {
    state.waitTitle = name + ' joined';
    render();
    waitTimer = setTimeout(() => startGame('online', { opponentName: name }), 900);
  }, 2400);
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

function renderGame() {
  const s = state;
  const X = X_COLOR;
  const O = O_COLOR;

  // Status pill
  const turnColor = s.winner
    ? (s.winner === 'D' ? '#98989D' : (s.winner === 'X' ? X : O))
    : (s.turn === 'X' ? X : O);

  const remote = s.mode !== 'local';
  let statusText;
  if (s.winner === 'D') {
    statusText = 'Draw';
  } else if (s.winner) {
    statusText = s.winner === 'X'
      ? (remote ? 'You win' : 'X wins')
      : (remote
          ? (s.mode === 'online' ? s.opponentName + ' wins' : 'Computer wins')
          : 'O wins');
  } else if (remote && s.turn === 'O') {
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
  document.getElementById('x-label').textContent = s.mode === 'local' ? 'Player 1' : 'You';
  document.getElementById('o-label').textContent =
    s.mode === 'local' ? 'Player 2'
    : s.mode === 'online' ? s.opponentName
    : 'Computer';

  renderBoards();
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
}

// ── DOM setup ────────────────────────────────────────────────────────────────

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
    waitForOpponent('Waiting for opponent…', 'Ari');
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
    waitForOpponent('Connecting to ' + pretty + '…', 'Jamie');
  });

  // Waiting
  document.getElementById('cancel-wait').addEventListener('click', goHome);

  // Game
  document.getElementById('back-game').addEventListener('click', goHome);
  document.getElementById('undo-btn').addEventListener('click', undoMove);
  document.getElementById('new-game-btn').addEventListener('click', resetGame);

  // Board cell clicks (event delegation)
  document.getElementById('boards-container').addEventListener('click', e => {
    const cellEl = e.target.closest('.game-cell');
    if (!cellEl) return;
    const b = parseInt(cellEl.dataset.board);
    const c = parseInt(cellEl.dataset.cell);
    play(b, c, false);
  });

  render();
});
