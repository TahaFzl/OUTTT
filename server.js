const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.static('.'));

const TURN_MS = 30000;

const games = new Map();
const rooms = new Map();
const playerRooms = new Map();
const playerGames = new Map();

class Game {
    constructor(gameId, player1, player2) {
        this.gameId = gameId;
        this.players = [player1, player2];
        this.currentPlayerIndex = 0;
        this.activeBoard = null;
        this.gameOver = false;
        this.winner = null;
        this.smallBoards = Array(9).fill(null).map(() => Array(9).fill(''));
        this.smallBoardWinners = Array(9).fill('');
        this.spectators = new Set();
        this.turnTimer = null;
        this.turnStartedAt = Date.now();
        this.rematchRequestedBy = null;

        this.players[0].symbol = 'X';
        this.players[1].symbol = 'O';

        this.sendGameStart();
        this.scheduleTimeout();
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    sendGameStart() {
        this.sendToPlayers({
            type: 'gameStart',
            gameId: this.gameId,
            playerSymbol: this.players[0].symbol,
            opponentSymbol: this.players[1].symbol,
            currentPlayer: this.players[0].symbol,
            turnStartedAt: this.turnStartedAt,
            turnDuration: TURN_MS,
            gameState: this.getGameState()
        }, 0);

        this.sendToPlayers({
            type: 'gameStart',
            gameId: this.gameId,
            playerSymbol: this.players[1].symbol,
            opponentSymbol: this.players[0].symbol,
            currentPlayer: this.players[0].symbol,
            turnStartedAt: this.turnStartedAt,
            turnDuration: TURN_MS,
            gameState: this.getGameState()
        }, 1);
    }

    scheduleTimeout() {
        clearTimeout(this.turnTimer);
        if (this.gameOver) return;
        this.turnTimer = setTimeout(() => this.autoMove(), TURN_MS);
    }

    legalMoves() {
        const out = [];
        for (let b = 0; b < 9; b++) {
            if (this.smallBoardWinners[b]) continue;
            if (this.activeBoard !== null && this.activeBoard !== b) continue;
            for (let c = 0; c < 9; c++) {
                if (this.smallBoards[b][c] === '') out.push([b, c]);
            }
        }
        return out;
    }

    autoMove() {
        if (this.gameOver) return;
        const moves = this.legalMoves();
        if (!moves.length) return;
        const [b, c] = moves[Math.floor(Math.random() * moves.length)];
        this.makeMove(this.getCurrentPlayer().id, b, c, { timedOut: true });
    }

    makeMove(playerId, boardIndex, cellIndex, opts = {}) {
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
        } else if (this.isMainBoardFull()) {
            this.gameOver = true;
            this.winner = 'tie';
        }

        if (!this.gameOver) {
            this.currentPlayerIndex = 1 - this.currentPlayerIndex;
            this.turnStartedAt = Date.now();
        }

        this.scheduleTimeout();

        this.broadcastGameState({
            type: 'move',
            playerId: playerId,
            boardIndex: boardIndex,
            cellIndex: cellIndex,
            symbol: player.symbol,
            timedOut: !!opts.timedOut,
            currentPlayer: this.gameOver ? null : this.getCurrentPlayer().symbol,
            turnStartedAt: this.turnStartedAt,
            turnDuration: TURN_MS,
            gameOver: this.gameOver,
            winner: this.winner,
            gameState: this.getGameState()
        });

        return true;
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
            winner: this.winner
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
        this.smallBoards = Array(9).fill(null).map(() => Array(9).fill(''));
        this.smallBoardWinners = Array(9).fill('');
        this.turnStartedAt = Date.now();
        this.rematchRequestedBy = null;

        this.sendGameStart();
        this.scheduleTimeout();
    }

    removePlayer(playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== -1) {
            clearTimeout(this.turnTimer);
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
            createRoom(ws, message.playerId, message.roomCode);
            break;
        case 'joinRoom':
            joinRoom(ws, message.playerId, message.roomCode);
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

function createRoom(ws, playerId, roomCode) {
    if (!playerId || !roomCode) return;

    if (rooms.has(roomCode)) {
        ws.send(JSON.stringify({ type: 'error', message: 'That room code is already in use. Try again.' }));
        return;
    }

    const player = { id: playerId, ws: ws };
    rooms.set(roomCode, player);
    playerRooms.set(playerId, roomCode);

    ws.send(JSON.stringify({
        type: 'waiting',
        message: 'Waiting for an opponent...'
    }));

    console.log(`Room ${roomCode} opened by ${playerId}`);
}

function joinRoom(ws, playerId, roomCode) {
    if (!playerId || !roomCode) return;

    const host = rooms.get(roomCode);
    if (!host) {
        ws.send(JSON.stringify({ type: 'roomNotFound', message: 'That room code was not found.' }));
        return;
    }

    if (host.id === playerId) {
        ws.send(JSON.stringify({ type: 'error', message: "You can't join your own room." }));
        return;
    }

    rooms.delete(roomCode);
    playerRooms.delete(host.id);

    const player = { id: playerId, ws: ws };
    const gameId = roomCode + ':' + generateGameId();
    const game = new Game(gameId, host, player);

    games.set(gameId, game);
    playerGames.set(host.id, gameId);
    playerGames.set(player.id, gameId);

    console.log(`Game ${gameId} started in room ${roomCode} with players ${host.id} and ${player.id}`);
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
    for (const [roomCode, player] of rooms) {
        if (player.ws === ws) {
            rooms.delete(roomCode);
            playerRooms.delete(player.id);
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
