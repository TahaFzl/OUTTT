const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const AVATAR_COLORS = ['#0A84FF', '#5E5CE6', '#FF9F0A', '#30D158', '#BF5AF2', '#FF453A'];

// ── Database ─────────────────────────────────────────────────────────────────

const db = new DatabaseSync(path.join(__dirname, 'data.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 1200,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS follows (
    follower_id TEXT NOT NULL,
    followee_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (follower_id, followee_id)
  );
`);

function getSecret() {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('secret');
    if (row) return row.value;
    const secret = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('secret', secret);
    return secret;
}
const SECRET = getSecret();

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function timingSafeEqualHex(a, b) {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function makeToken(userId) {
    const sig = crypto.createHmac('sha256', SECRET).update(userId).digest('hex');
    return userId + '.' + sig;
}

function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const idx = token.lastIndexOf('.');
    if (idx === -1) return null;
    const userId = token.slice(0, idx);
    const sig = token.slice(idx + 1);
    const expected = crypto.createHmac('sha256', SECRET).update(userId).digest('hex');
    if (sig.length !== expected.length || !timingSafeEqualHex(sig, expected)) return null;
    return userId;
}

function getUserById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function getUserByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getFollowCounts(userId) {
    const following = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').get(userId).n;
    const followers = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').get(userId).n;
    return { following, followers };
}

function sanitizeUser(row) {
    if (!row) return null;
    const counts = getFollowCounts(row.id);
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        avatarColor: row.avatar_color,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        rating: row.rating,
        following: counts.following,
        followers: counts.followers
    };
}

function authenticateRequest(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const userId = verifyToken(token);
    if (!userId) return null;
    return getUserById(userId);
}

function resolvePlayerProfile(authToken, guestName) {
    const userId = authToken ? verifyToken(authToken) : null;
    const row = userId ? getUserById(userId) : null;
    if (row) {
        return { userId: row.id, name: row.name, avatarColor: row.avatar_color, rating: row.rating };
    }
    return { userId: null, name: String(guestName || 'Guest').slice(0, 40) || 'Guest', avatarColor: '#3A3A3C', rating: null };
}

// ── HTTP API ─────────────────────────────────────────────────────────────────

app.use(express.json());

// Never let the static file server hand out the database file.
app.use((req, res, next) => {
    if (req.path.toLowerCase().endsWith('.db')) return res.status(404).end();
    next();
});
app.use(express.static('.'));

app.post('/api/signup', (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 40);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200);
    const password = String(req.body.password || '');

    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (getUserByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists.' });

    const id = crypto.randomUUID();
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    db.prepare('INSERT INTO users (id, name, email, password_hash, salt, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, name, email, passwordHash, salt, avatarColor, Date.now());

    res.json({ token: makeToken(id), user: sanitizeUser(getUserById(id)) });
});

app.post('/api/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const row = getUserByEmail(email);
    if (!row) return res.status(401).json({ error: 'Incorrect email or password.' });

    const hash = hashPassword(password, row.salt);
    if (!timingSafeEqualHex(hash, row.password_hash)) {
        return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    res.json({ token: makeToken(row.id), user: sanitizeUser(row) });
});

app.get('/api/me', (req, res) => {
    const user = authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    res.json({ user: sanitizeUser(user) });
});

app.get('/api/users/search', (req, res) => {
    const requester = authenticateRequest(req);
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ users: [] });

    const rows = db.prepare(
        'SELECT id, name, avatar_color, rating FROM users WHERE name LIKE ? ORDER BY name LIMIT 20'
    ).all('%' + q + '%');

    const followingSet = requester
        ? new Set(db.prepare('SELECT followee_id FROM follows WHERE follower_id = ?').all(requester.id).map(r => r.followee_id))
        : new Set();

    const users = rows
        .filter(r => !requester || r.id !== requester.id)
        .map(r => ({
            id: r.id,
            name: r.name,
            avatarColor: r.avatar_color,
            rating: r.rating,
            isFollowing: followingSet.has(r.id)
        }));

    res.json({ users });
});

app.post('/api/follow', (req, res) => {
    const requester = authenticateRequest(req);
    if (!requester) return res.status(401).json({ error: 'Sign in to follow players.' });
    const targetId = String(req.body.userId || '');
    if (!targetId || targetId === requester.id) return res.status(400).json({ error: 'Invalid player.' });
    if (!getUserById(targetId)) return res.status(404).json({ error: 'Player not found.' });

    db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)')
        .run(requester.id, targetId, Date.now());
    res.json({ ok: true });
});

app.post('/api/unfollow', (req, res) => {
    const requester = authenticateRequest(req);
    if (!requester) return res.status(401).json({ error: 'Sign in to manage follows.' });
    const targetId = String(req.body.userId || '');
    if (!targetId) return res.status(400).json({ error: 'Invalid player.' });

    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(requester.id, targetId);
    res.json({ ok: true });
});

// ── Game state ───────────────────────────────────────────────────────────────

const games = new Map();
const rooms = new Map();
const playerRooms = new Map();
const playerGames = new Map();

function normalizeTimeControl(tc) {
    const bank = tc && Number.isFinite(tc.bank) ? Math.max(0, Math.min(3600, Math.round(tc.bank))) : 0;
    const move = tc && Number.isFinite(tc.move) ? Math.max(0, Math.min(300, Math.round(tc.move))) : 30;
    return { bank, move };
}

class Game {
    constructor(gameId, player1, player2, timeControl) {
        this.gameId = gameId;
        this.players = [player1, player2];
        this.currentPlayerIndex = 0;
        this.activeBoard = null;
        this.gameOver = false;
        this.winner = null;
        this.winReason = null;
        this.smallBoards = Array(9).fill(null).map(() => Array(9).fill(''));
        this.smallBoardWinners = Array(9).fill('');
        this.spectators = new Set();
        this.rematchRequestedBy = null;

        const tc = normalizeTimeControl(timeControl);
        this.bank = tc.bank;
        this.moveLimit = tc.move;
        this.clockX = this.bank;
        this.clockO = this.bank;
        this.moveLeft = this.moveLimit;
        this.tickTimer = null;

        this.players[0].symbol = 'X';
        this.players[1].symbol = 'O';

        this.sendGameStart();
        this.startTicking();
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    sendGameStart() {
        [0, 1].forEach((i) => {
            const me = this.players[i];
            const opp = this.players[1 - i];
            this.sendToPlayers({
                type: 'gameStart',
                gameId: this.gameId,
                playerSymbol: me.symbol,
                you: { name: me.name, avatarColor: me.avatarColor, rating: me.rating },
                opponent: { name: opp.name, avatarColor: opp.avatarColor, rating: opp.rating },
                timeControl: { bank: this.bank, move: this.moveLimit },
                gameState: this.getGameState()
            }, i);
        });
    }

    startTicking() {
        clearInterval(this.tickTimer);
        this.lastTick = Date.now();
        this.tickTimer = setInterval(() => this.tick(), 100);
    }

    stopTicking() {
        clearInterval(this.tickTimer);
        this.tickTimer = null;
    }

    tick() {
        if (this.gameOver) { this.stopTicking(); return; }
        const now = Date.now();
        const dt = (now - this.lastTick) / 1000;
        this.lastTick = now;

        if (this.moveLimit > 0) {
            this.moveLeft = Math.max(0, this.moveLeft - dt);
            if (this.moveLeft <= 0) { this.forfeitTurn(); return; }
        }
        if (this.bank > 0) {
            const key = this.getCurrentPlayer().symbol === 'X' ? 'clockX' : 'clockO';
            this[key] = Math.max(0, this[key] - dt);
            if (this[key] <= 0) { this.flagFall(this.getCurrentPlayer().symbol); return; }
        }
        if (this.moveLimit > 0 || this.bank > 0) this.broadcastClock();
    }

    broadcastClock() {
        this.sendToPlayers({ type: 'clock', clockX: this.clockX, clockO: this.clockO, moveLeft: this.moveLeft });
    }

    flagFall(side) {
        this.gameOver = true;
        this.winner = side === 'X' ? 'O' : 'X';
        this.winReason = 'flag';
        this.stopTicking();
        this.finalizeStats();
        this.broadcastGameState({
            type: 'gameOver',
            winner: this.winner,
            winReason: this.winReason,
            gameState: this.getGameState()
        });
    }

    forfeitTurn() {
        const side = this.getCurrentPlayer().symbol;
        this.activeBoard = null;
        this.currentPlayerIndex = 1 - this.currentPlayerIndex;
        this.moveLeft = this.moveLimit;
        this.broadcastGameState({
            type: 'forfeit',
            side,
            currentPlayer: this.getCurrentPlayer().symbol,
            gameState: this.getGameState()
        });
    }

    makeMove(playerId, boardIndex, cellIndex) {
        const player = this.players.find(p => p.id === playerId);
        if (!player || player !== this.getCurrentPlayer() || this.gameOver) {
            return false;
        }

        if (!this.isValidMove(boardIndex, cellIndex)) {
            return false;
        }

        this.smallBoards[boardIndex][cellIndex] = player.symbol;

        const smallBoardWinner = this.checkSmallBoardWinner(boardIndex);
        if (smallBoardWinner) {
            this.smallBoardWinners[boardIndex] = smallBoardWinner;
        } else if (this.isSmallBoardFull(boardIndex)) {
            this.smallBoardWinners[boardIndex] = 'tie';
        }

        this.setNextActiveBoard(cellIndex);

        const mainWinner = this.checkMainBoardWinner();
        if (mainWinner) {
            this.gameOver = true;
            this.winner = mainWinner;
            this.winReason = 'board';
        } else if (this.isMainBoardFull()) {
            this.gameOver = true;
            this.winner = 'tie';
            this.winReason = 'draw';
        }

        if (!this.gameOver) {
            this.currentPlayerIndex = 1 - this.currentPlayerIndex;
            this.moveLeft = this.moveLimit;
        } else {
            this.stopTicking();
            this.finalizeStats();
        }

        this.broadcastGameState({
            type: 'move',
            playerId: playerId,
            boardIndex: boardIndex,
            cellIndex: cellIndex,
            symbol: player.symbol,
            currentPlayer: this.gameOver ? null : this.getCurrentPlayer().symbol,
            gameOver: this.gameOver,
            winner: this.winner,
            winReason: this.winReason,
            gameState: this.getGameState()
        });

        return true;
    }

    finalizeStats() {
        if (this.winner === 'tie') {
            for (const p of this.players) {
                if (p.userId) db.prepare('UPDATE users SET draws = draws + 1 WHERE id = ?').run(p.userId);
            }
            return;
        }
        const winnerPlayer = this.players.find(p => p.symbol === this.winner);
        const loserPlayer = this.players.find(p => p.symbol !== this.winner);
        if (!winnerPlayer || !loserPlayer) return;

        const winnerRow = winnerPlayer.userId ? getUserById(winnerPlayer.userId) : null;
        const loserRow = loserPlayer.userId ? getUserById(loserPlayer.userId) : null;
        const winnerRating = winnerRow ? winnerRow.rating : (winnerPlayer.rating ?? 1200);
        const loserRating = loserRow ? loserRow.rating : (loserPlayer.rating ?? 1200);

        const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
        const K = 32;
        const newWinnerRating = Math.round(winnerRating + K * (1 - expectedWinner));
        const newLoserRating = Math.max(100, Math.round(loserRating + K * (0 - (1 - expectedWinner))));

        if (winnerPlayer.userId) {
            db.prepare('UPDATE users SET wins = wins + 1, rating = ? WHERE id = ?').run(newWinnerRating, winnerPlayer.userId);
        }
        if (loserPlayer.userId) {
            db.prepare('UPDATE users SET losses = losses + 1, rating = ? WHERE id = ?').run(newLoserRating, loserPlayer.userId);
        }
    }

    isValidMove(boardIndex, cellIndex) {
        if (this.smallBoards[boardIndex][cellIndex] !== '') return false;
        if (this.smallBoardWinners[boardIndex] !== '') return false;
        if (this.activeBoard !== null && this.activeBoard !== boardIndex) return false;
        return true;
    }

    checkSmallBoardWinner(boardIndex) {
        const board = this.smallBoards[boardIndex];
        const winPatterns = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];

        for (const pattern of winPatterns) {
            const [a, b, c] = pattern;
            if (board[a] && board[a] === board[b] && board[a] === board[c]) {
                return board[a];
            }
        }
        return null;
    }

    isSmallBoardFull(boardIndex) {
        return this.smallBoards[boardIndex].every(cell => cell !== '');
    }

    setNextActiveBoard(cellIndex) {
        if (this.smallBoardWinners[cellIndex] !== '') {
            this.activeBoard = null;
        } else {
            this.activeBoard = cellIndex;
        }
    }

    checkMainBoardWinner() {
        const winPatterns = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];

        for (const pattern of winPatterns) {
            const [a, b, c] = pattern;
            const winnerA = this.smallBoardWinners[a];
            const winnerB = this.smallBoardWinners[b];
            const winnerC = this.smallBoardWinners[c];

            if (winnerA && winnerA !== 'tie' && winnerA === winnerB && winnerA === winnerC) {
                return winnerA;
            }
        }
        return null;
    }

    isMainBoardFull() {
        return this.smallBoardWinners.every(winner => winner !== '');
    }

    getGameState() {
        return {
            smallBoards: this.smallBoards,
            smallBoardWinners: this.smallBoardWinners,
            activeBoard: this.activeBoard,
            currentPlayer: this.gameOver ? null : this.getCurrentPlayer().symbol,
            gameOver: this.gameOver,
            winner: this.winner,
            winReason: this.winReason,
            clockX: this.clockX,
            clockO: this.clockO,
            moveLeft: this.moveLeft
        };
    }

    sendToPlayers(message, playerIndex = null) {
        if (playerIndex !== null) {
            if (this.players[playerIndex] && this.players[playerIndex].ws.readyState === WebSocket.OPEN) {
                this.players[playerIndex].ws.send(JSON.stringify(message));
            }
        } else {
            this.players.forEach(player => {
                if (player.ws.readyState === WebSocket.OPEN) {
                    player.ws.send(JSON.stringify(message));
                }
            });
        }
    }

    broadcastGameState(message) {
        this.sendToPlayers(message);
        this.spectators.forEach(spectator => {
            if (spectator.readyState === WebSocket.OPEN) {
                spectator.send(JSON.stringify(message));
            }
        });
    }

    resetForRematch() {
        this.players.reverse();
        this.players[0].symbol = 'X';
        this.players[1].symbol = 'O';
        this.currentPlayerIndex = 0;
        this.activeBoard = null;
        this.gameOver = false;
        this.winner = null;
        this.winReason = null;
        this.smallBoards = Array(9).fill(null).map(() => Array(9).fill(''));
        this.smallBoardWinners = Array(9).fill('');
        this.clockX = this.bank;
        this.clockO = this.bank;
        this.moveLeft = this.moveLimit;
        this.rematchRequestedBy = null;

        this.sendGameStart();
        this.startTicking();
    }

    removePlayer(playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== -1) {
            this.stopTicking();
            const otherPlayerIndex = 1 - playerIndex;
            if (this.players[otherPlayerIndex]) {
                this.sendToPlayers({
                    type: 'playerDisconnected',
                    message: 'Your opponent has disconnected'
                }, otherPlayerIndex);
            }
            return true;
        }
        return false;
    }
}

wss.on('connection', (ws) => {
    console.log('New WebSocket connection');

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(ws, message);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        handleDisconnection(ws);
    });
});

function handleMessage(ws, message) {
    switch (message.type) {
        case 'createRoom':
            createRoom(ws, message);
            break;
        case 'joinRoom':
            joinRoom(ws, message);
            break;
        case 'makeMove':
            makeMove(ws, message);
            break;
        case 'chat':
            handleChat(ws, message);
            break;
        case 'rematchRequest':
            rematchRequest(ws, message.playerId);
            break;
        case 'rematchResponse':
            rematchResponse(ws, message.playerId, !!message.accept);
            break;
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
    }
}

function createRoom(ws, message) {
    const { playerId, roomCode, authToken, guestName, timeControl, hostSide } = message;
    if (!playerId || !roomCode) return;

    if (rooms.has(roomCode)) {
        ws.send(JSON.stringify({ type: 'error', message: 'That room code is already in use. Try again.' }));
        return;
    }

    const profile = resolvePlayerProfile(authToken, guestName);
    const player = Object.assign({ id: playerId, ws: ws }, profile);
    rooms.set(roomCode, {
        player,
        timeControl: normalizeTimeControl(timeControl),
        hostSide: hostSide === 'O' ? 'O' : 'X'
    });
    playerRooms.set(playerId, roomCode);

    ws.send(JSON.stringify({
        type: 'waiting',
        message: 'Waiting for an opponent...'
    }));

    console.log(`Room ${roomCode} opened by ${playerId}`);
}

function joinRoom(ws, message) {
    const { playerId, roomCode, authToken, guestName } = message;
    if (!playerId || !roomCode) return;

    const entry = rooms.get(roomCode);
    if (!entry) {
        ws.send(JSON.stringify({ type: 'roomNotFound', message: 'That room code was not found.' }));
        return;
    }

    if (entry.player.id === playerId) {
        ws.send(JSON.stringify({ type: 'error', message: "You can't join your own room." }));
        return;
    }

    rooms.delete(roomCode);
    playerRooms.delete(entry.player.id);

    const profile = resolvePlayerProfile(authToken, guestName);
    const player = Object.assign({ id: playerId, ws: ws }, profile);
    const gameId = roomCode + ':' + generateGameId();
    // hostSide 'X' means the host moves first; 'O' means the joiner does.
    const players = entry.hostSide === 'O' ? [player, entry.player] : [entry.player, player];
    const game = new Game(gameId, players[0], players[1], entry.timeControl);

    games.set(gameId, game);
    playerGames.set(entry.player.id, gameId);
    playerGames.set(player.id, gameId);

    console.log(`Game ${gameId} started in room ${roomCode} with players ${entry.player.id} and ${player.id}`);
}

function makeMove(ws, message) {
    const gameId = playerGames.get(message.playerId);
    if (!gameId) return;

    const game = games.get(gameId);
    if (!game) return;

    game.makeMove(message.playerId, message.boardIndex, message.cellIndex);
}

function handleChat(ws, message) {
    const gameId = playerGames.get(message.playerId);
    if (!gameId) return;

    const game = games.get(gameId);
    if (!game) return;

    const player = game.players.find(p => p.id === message.playerId);
    if (!player) return;

    const text = String(message.text || '').slice(0, 300).trim();
    if (!text) return;

    game.sendToPlayers({ type: 'chat', symbol: player.symbol, text: text });
}

function rematchRequest(ws, playerId) {
    const gameId = playerGames.get(playerId);
    if (!gameId) return;

    const game = games.get(gameId);
    if (!game || !game.gameOver) return;

    const opponent = game.players.find(p => p.id !== playerId);
    if (!opponent) return;

    if (game.rematchRequestedBy && game.rematchRequestedBy !== playerId) {
        game.resetForRematch();
        return;
    }

    game.rematchRequestedBy = playerId;
    if (opponent.ws.readyState === WebSocket.OPEN) {
        opponent.ws.send(JSON.stringify({ type: 'rematchRequested' }));
    }
}

function rematchResponse(ws, playerId, accept) {
    const gameId = playerGames.get(playerId);
    if (!gameId) return;

    const game = games.get(gameId);
    if (!game || !game.rematchRequestedBy || game.rematchRequestedBy === playerId) return;

    const requester = game.players.find(p => p.id === game.rematchRequestedBy);
    game.rematchRequestedBy = null;

    if (accept) {
        game.resetForRematch();
    } else if (requester && requester.ws.readyState === WebSocket.OPEN) {
        requester.ws.send(JSON.stringify({ type: 'rematchDeclined' }));
    }
}

function handleDisconnection(ws) {
    for (const [roomCode, entry] of rooms) {
        if (entry.player.ws === ws) {
            rooms.delete(roomCode);
            playerRooms.delete(entry.player.id);
            break;
        }
    }

    for (const [gameId, game] of games) {
        const disconnectedPlayer = game.players.find(p => p.ws === ws);
        if (disconnectedPlayer) {
            const shouldEndGame = game.removePlayer(disconnectedPlayer.id);
            if (shouldEndGame) {
                game.players.forEach(p => playerGames.delete(p.id));
                games.delete(gameId);
            }
            break;
        }
        game.spectators.delete(ws);
    }
}

function generateGameId() {
    return Math.random().toString(36).substring(2, 15);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Ultimate Tic-Tac-Toe multiplayer server running on port ${PORT}`);
});
