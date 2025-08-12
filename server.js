const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.static('.'));

const games = new Map(); 
const waitingPlayers = new Set();
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
        
        this.players[0].symbol = 'X';
        this.players[1].symbol = 'O';
        
        this.sendToPlayers({
            type: 'gameStart',
            gameId: this.gameId,
            playerSymbol: this.players[0].symbol,
            opponentSymbol: this.players[1].symbol,
            currentPlayer: this.players[0].symbol,
            gameState: this.getGameState()
        }, 0);
        
        this.sendToPlayers({
            type: 'gameStart',
            gameId: this.gameId,
            playerSymbol: this.players[1].symbol,
            opponentSymbol: this.players[0].symbol,
            currentPlayer: this.players[0].symbol,
            gameState: this.getGameState()
        }, 1);
    }
    
    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
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
        } else if (this.isMainBoardFull()) {
            this.gameOver = true;
            this.winner = 'tie';
        }
        
        if (!this.gameOver) {
            this.currentPlayerIndex = 1 - this.currentPlayerIndex;
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
    
    removePlayer(playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== -1) {
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
        case 'findGame':
            findGame(ws, message.playerId);
            break;
        case 'makeMove':
            makeMove(ws, message);
            break;
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
    }
}

function findGame(ws, playerId) {
    const player = { id: playerId, ws: ws };
    
    if (waitingPlayers.size > 0) {
        const waitingPlayer = waitingPlayers.values().next().value;
        waitingPlayers.delete(waitingPlayer);
        
        const gameId = generateGameId();
        const game = new Game(gameId, waitingPlayer, player);
        
        games.set(gameId, game);
        playerGames.set(waitingPlayer.id, gameId);
        playerGames.set(player.id, gameId);
        
        console.log(`Game ${gameId} started with players ${waitingPlayer.id} and ${player.id}`);
    } else {
        waitingPlayers.add(player);
        ws.send(JSON.stringify({
            type: 'waiting',
            message: 'Waiting for an opponent...'
        }));
    }
}

function makeMove(ws, message) {
    const gameId = playerGames.get(message.playerId);
    if (!gameId) return;
    
    const game = games.get(gameId);
    if (!game) return;
    
    game.makeMove(message.playerId, message.boardIndex, message.cellIndex);
}

function handleDisconnection(ws) {
    for (const player of waitingPlayers) {
        if (player.ws === ws) {
            waitingPlayers.delete(player);
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