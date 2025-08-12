class UltimateTicTacToe {
    constructor() {
        this.currentPlayer = 'X';
        this.activeBoard = null;
        this.gameOver = false;
        this.winner = null;
        this.isMultiplayer = false;
        this.playerId = this.generatePlayerId();
        this.playerSymbol = null;
        this.opponentSymbol = null;
        this.isMyTurn = false;
        this.gameId = null;
        this.socket = null;
        this.connectionStatus = 'disconnected';
        
        this.smallBoards = Array(9).fill(null).map(() => Array(9).fill(''));
        this.smallBoardWinners = Array(9).fill(''); 
        this.mainBoard = Array(9).fill('');
        
        this.initializeDOM();
        this.createGameBoard();
        this.attachEventListeners();
        this.showGameModeSelection();
    }

    initializeDOM() {
        this.elements = {
            ultimateBoard: document.getElementById('ultimateBoard'),
            currentPlayerSymbol: document.getElementById('currentPlayerSymbol'),
            currentPlayerText: document.querySelector('.current-player'),
            gameStatus: document.getElementById('gameStatus'),
            statusText: document.querySelector('.status-text'),
            resetBtn: document.getElementById('resetGame'),
            gameOverlay: document.getElementById('gameOverlay'),
            winnerText: document.getElementById('winnerText'),
            winnerSubtext: document.getElementById('winnerSubtext'),
            playAgainBtn: document.getElementById('playAgain')
        };
    }

    generatePlayerId() {
        return 'player_' + Math.random().toString(36).substring(2, 15);
    }

    showGameModeSelection() {
        const modeOverlay = document.createElement('div');
        modeOverlay.className = 'game-overlay active';
        modeOverlay.innerHTML = `
            <div class="overlay-content">
                <div class="mode-selection">
                    <i class="fas fa-gamepad"></i>
                    <h2>Choose Game Mode</h2>
                    <p>Select how you want to play Ultimate Tic-Tac-Toe</p>
                    <div class="mode-buttons">
                        <button class="mode-btn" id="singlePlayerMode">
                            <i class="fas fa-user"></i>
                            <span>Single Player</span>
                            <small>Play locally with a friend</small>
                        </button>
                        <button class="mode-btn primary" id="multiPlayerMode">
                            <i class="fas fa-users"></i>
                            <span>Multiplayer</span>
                            <small>Play online with another player</small>
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modeOverlay);
        
        document.getElementById('singlePlayerMode').addEventListener('click', () => {
            this.startSinglePlayerMode();
            document.body.removeChild(modeOverlay);
        });
        
        document.getElementById('multiPlayerMode').addEventListener('click', () => {
            this.startMultiPlayerMode();
            document.body.removeChild(modeOverlay);
        });
    }

    startSinglePlayerMode() {
        this.isMultiplayer = false;
        this.updateGameStatus();
    }

    startMultiPlayerMode() {
        this.isMultiplayer = true;
        this.connectToServer();
    }

    connectToServer() {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        this.socket = new WebSocket(wsUrl);
        
        this.socket.onopen = () => {
            console.log('Connected to game server');
            this.connectionStatus = 'connected';
            this.findGame();
        };
        
        this.socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleServerMessage(message);
        };
        
        this.socket.onclose = () => {
            console.log('Disconnected from game server');
            this.connectionStatus = 'disconnected';
            this.showConnectionError();
        };
        
        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.showConnectionError();
        };
        
        setInterval(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    }

    findGame() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'findGame',
                playerId: this.playerId
            }));
            
            this.showWaitingMessage();
        }
    }

    showWaitingMessage() {
        this.elements.statusText.textContent = 'Searching for an opponent...';
        this.elements.gameStatus.classList.add('active');
    }

    showConnectionError() {
        this.elements.statusText.textContent = 'Connection lost. Please refresh the page.';
        this.elements.gameStatus.classList.add('active');
    }

    handleServerMessage(message) {
        switch (message.type) {
            case 'waiting':
                this.elements.statusText.textContent = message.message;
                break;
                
            case 'gameStart':
                this.handleGameStart(message);
                break;
                
            case 'move':
                this.handleOpponentMove(message);
                break;
                
            case 'playerDisconnected':
                this.handlePlayerDisconnected(message);
                break;
                
            case 'pong':
                break;
        }
    }

    handleGameStart(message) {
        this.gameId = message.gameId;
        this.playerSymbol = message.playerSymbol;
        this.opponentSymbol = message.opponentSymbol;
        this.currentPlayer = message.currentPlayer;
        this.isMyTurn = this.playerSymbol === this.currentPlayer;
        
        this.applyGameState(message.gameState);
        
        this.elements.statusText.textContent = this.isMyTurn ? 
            `Your turn (${this.playerSymbol})` : 
            `Opponent's turn (${this.opponentSymbol})`;
    }

    handleOpponentMove(message) {
        this.smallBoards[message.boardIndex][message.cellIndex] = message.symbol;
        
        const cell = document.querySelector(
            `[data-board-index="${message.boardIndex}"][data-cell-index="${message.cellIndex}"]`
        );
        cell.textContent = message.symbol;
        cell.classList.add(message.symbol.toLowerCase());
        cell.classList.add('disabled');
        
        this.applyGameState(message.gameState);
        
        this.currentPlayer = message.currentPlayer;
        this.isMyTurn = this.playerSymbol === this.currentPlayer;
        
        if (message.gameOver) {
            this.handleGameEnd(message.winner);
        } else {
            this.updateDisplay();
        }
    }

    handlePlayerDisconnected(message) {
        this.elements.statusText.textContent = message.message;
        this.gameOver = true;
        this.disableAllCells();
    }

    applyGameState(gameState) {
        this.smallBoards = gameState.smallBoards;
        this.smallBoardWinners = gameState.smallBoardWinners;
        this.activeBoard = gameState.activeBoard;
        this.currentPlayer = gameState.currentPlayer;
        this.gameOver = gameState.gameOver;
        this.winner = gameState.winner;
        
        this.updateBoardFromState();
        this.updateDisplay();
    }

    updateBoardFromState() {
        for (let boardIndex = 0; boardIndex < 9; boardIndex++) {
            for (let cellIndex = 0; cellIndex < 9; cellIndex++) {
                const cell = document.querySelector(
                    `[data-board-index="${boardIndex}"][data-cell-index="${cellIndex}"]`
                );
                const value = this.smallBoards[boardIndex][cellIndex];
                
                if (value) {
                    cell.textContent = value;
                    cell.classList.add(value.toLowerCase());
                    cell.classList.add('disabled');
                }
            }
            
            const winner = this.smallBoardWinners[boardIndex];
            if (winner) {
                this.updateSmallBoardDisplay(boardIndex, winner);
            }
        }
    }

    handleGameEnd(winner) {
        this.gameOver = true;
        this.winner = winner;
        this.isMyTurn = false;
        
        this.disableAllCells();
        this.updateDisplay();
        this.showGameOverScreen();
    }

    disableAllCells() {
        const allCells = document.querySelectorAll('.board-cell');
        allCells.forEach(cell => cell.classList.add('disabled'));
        
        const allBoards = document.querySelectorAll('.small-board');
        allBoards.forEach(board => board.classList.remove('active'));
    }

    createGameBoard() {
        this.elements.ultimateBoard.innerHTML = '';
        
        for (let boardIndex = 0; boardIndex < 9; boardIndex++) {
            const smallBoard = this.createSmallBoard(boardIndex);
            this.elements.ultimateBoard.appendChild(smallBoard);
        }
    }

    createSmallBoard(boardIndex) {
        const boardContainer = document.createElement('div');
        boardContainer.className = 'small-board';
        boardContainer.dataset.boardIndex = boardIndex;

        const boardGrid = document.createElement('div');
        boardGrid.className = 'board-grid';

        for (let cellIndex = 0; cellIndex < 9; cellIndex++) {
            const cell = document.createElement('div');
            cell.className = 'board-cell';
            cell.dataset.boardIndex = boardIndex;
            cell.dataset.cellIndex = cellIndex;
            
            cell.addEventListener('click', (e) => this.handleCellClick(e));
            
            boardGrid.appendChild(cell);
        }

        boardContainer.appendChild(boardGrid);
        return boardContainer;
    }

    attachEventListeners() {
        this.elements.resetBtn.addEventListener('click', () => this.resetGame());
        this.elements.playAgainBtn.addEventListener('click', () => this.resetGame());
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'r' || e.key === 'R') {
                this.resetGame();
            }
        });
    }

    handleCellClick(event) {
        if (this.gameOver) return;

        const boardIndex = parseInt(event.target.dataset.boardIndex);
        const cellIndex = parseInt(event.target.dataset.cellIndex);

        if (this.isMultiplayer && !this.isMyTurn) {
            this.showInvalidMoveAnimation(event.target);
            return;
        }

        if (!this.isValidMove(boardIndex, cellIndex)) {
            this.showInvalidMoveAnimation(event.target);
            return;
        }

        if (this.isMultiplayer) {
            this.sendMoveToServer(boardIndex, cellIndex);
        } else {
            this.makeMove(boardIndex, cellIndex);
            this.updateDisplay();
            this.checkGameState();
        }
    }

    sendMoveToServer(boardIndex, cellIndex) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'makeMove',
                playerId: this.playerId,
                boardIndex: boardIndex,
                cellIndex: cellIndex
            }));
        }
    }

    isValidMove(boardIndex, cellIndex) {
        if (this.smallBoards[boardIndex][cellIndex] !== '') {
            return false;
        }

        if (this.smallBoardWinners[boardIndex] !== '') {
            return false;
        }

        if (this.activeBoard !== null && this.activeBoard !== boardIndex) {
            return false;
        }

        return true;
    }

    makeMove(boardIndex, cellIndex) {
        this.smallBoards[boardIndex][cellIndex] = this.currentPlayer;
        
        const cell = document.querySelector(
            `[data-board-index="${boardIndex}"][data-cell-index="${cellIndex}"]`
        );
        cell.textContent = this.currentPlayer;
        cell.classList.add(this.currentPlayer.toLowerCase());
        cell.classList.add('disabled');
        
        this.animateCellPlacement(cell);

        const smallBoardWinner = this.checkSmallBoardWinner(boardIndex);
        if (smallBoardWinner) {
            this.smallBoardWinners[boardIndex] = smallBoardWinner;
            this.updateSmallBoardDisplay(boardIndex, smallBoardWinner);
        } else if (this.isSmallBoardFull(boardIndex)) {
            this.smallBoardWinners[boardIndex] = 'tie';
            this.updateSmallBoardDisplay(boardIndex, 'tie');
        }

        this.setNextActiveBoard(cellIndex);

        this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
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

    updateSmallBoardDisplay(boardIndex, result) {
        const boardElement = document.querySelector(`[data-board-index="${boardIndex}"]`);
        
        if (result === 'tie') {
            boardElement.classList.add('tied');
        } else {
            boardElement.classList.add(`won-${result.toLowerCase()}`);
        }

        const overlay = document.createElement('div');
        overlay.className = `win-overlay ${result === 'tie' ? 'tie' : result.toLowerCase()}`;
        overlay.textContent = result === 'tie' ? 'TIE' : result;
        boardElement.appendChild(overlay);

        const cells = boardElement.querySelectorAll('.board-cell');
        cells.forEach(cell => cell.classList.add('disabled'));
    }

    setNextActiveBoard(cellIndex) {
        if (this.smallBoardWinners[cellIndex] !== '') {
            this.activeBoard = null;
        } else {
            this.activeBoard = cellIndex;
        }
    }

    updateDisplay() {
        this.updatePlayerIndicator();
        this.updateBoardHighlights();
        this.updateGameStatus();
    }

    updatePlayerIndicator() {
        this.elements.currentPlayerSymbol.textContent = this.currentPlayer;
        this.elements.currentPlayerSymbol.className = 
            `player-symbol ${this.currentPlayer === 'O' ? 'player-o' : ''}`;
        this.elements.currentPlayerText.textContent = `Player ${this.currentPlayer}'s Turn`;
    }

    updateBoardHighlights() {
        const allBoards = document.querySelectorAll('.small-board');
        
        allBoards.forEach((board, index) => {
            board.classList.remove('active');
            
            if (this.smallBoardWinners[index] === '') {
                if (this.activeBoard === null || this.activeBoard === index) {
                    board.classList.add('active');
                }
            }
        });
    }

    updateGameStatus() {
        let statusMessage = '';
        
        if (this.gameOver) {
            if (this.winner === 'tie') {
                statusMessage = "Game ended in a tie!";
            } else if (this.isMultiplayer) {
                statusMessage = this.winner === this.playerSymbol ? 
                    `You win! (${this.winner})` : 
                    `You lose! (${this.winner} wins)`;
            } else {
                statusMessage = `Player ${this.winner} wins the game!`;
            }
        } else if (this.isMultiplayer) {
            if (this.isMyTurn) {
                statusMessage = this.activeBoard === null ? 
                    `Your turn (${this.playerSymbol}) - Choose any available board` :
                    `Your turn (${this.playerSymbol}) - Play on the highlighted board`;
            } else {
                statusMessage = `Opponent's turn (${this.opponentSymbol})`;
            }
        } else {
            if (this.activeBoard === null) {
                statusMessage = `Player ${this.currentPlayer} can choose any available board`;
            } else {
                statusMessage = `Player ${this.currentPlayer} must play on the highlighted board`;
            }
        }

        this.elements.statusText.textContent = statusMessage;
        
        if (this.activeBoard !== null || this.gameOver || this.isMultiplayer) {
            this.elements.gameStatus.classList.add('active');
        } else {
            this.elements.gameStatus.classList.remove('active');
        }
    }

    checkGameState() {
        const mainWinner = this.checkMainBoardWinner();
        if (mainWinner) {
            this.endGame(mainWinner);
            return;
        }

        if (this.isMainBoardFull()) {
            this.endGame('tie');
            return;
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

    endGame(winner) {
        this.gameOver = true;
        this.winner = winner;
        this.activeBoard = null;

        const allCells = document.querySelectorAll('.board-cell:not(.disabled)');
        allCells.forEach(cell => cell.classList.add('disabled'));

        const allBoards = document.querySelectorAll('.small-board');
        allBoards.forEach(board => board.classList.remove('active'));

        this.showGameOverScreen();
        this.updateGameStatus();
    }

    showGameOverScreen() {
        if (this.winner === 'tie') {
            this.elements.winnerText.textContent = "It's a Tie!";
            this.elements.winnerSubtext.textContent = "Great game! Try again?";
        } else if (this.isMultiplayer) {
            if (this.winner === this.playerSymbol) {
                this.elements.winnerText.textContent = "You Win!";
                this.elements.winnerSubtext.textContent = "Excellent strategy! Well played!";
            } else {
                this.elements.winnerText.textContent = "You Lose!";
                this.elements.winnerSubtext.textContent = "Good game! Better luck next time!";
            }
        } else {
            this.elements.winnerText.textContent = `Player ${this.winner} Wins!`;
            this.elements.winnerSubtext.textContent = "Congratulations on your victory!";
        }

        setTimeout(() => {
            this.elements.gameOverlay.classList.add('active');
        }, 1000);
    }

    resetGame() {
        this.currentPlayer = 'X';
        this.activeBoard = null;
        this.gameOver = false;
        this.winner = null;
        this.smallBoards = Array(9).fill(null).map(() => Array(9).fill(''));
        this.smallBoardWinners = Array(9).fill('');
        this.mainBoard = Array(9).fill('');

        this.elements.gameOverlay.classList.remove('active');

        if (this.isMultiplayer) {
            if (this.socket) {
                this.socket.close();
            }
            this.isMultiplayer = false;
            this.playerSymbol = null;
            this.opponentSymbol = null;
            this.isMyTurn = false;
            this.gameId = null;
            this.socket = null;
            this.showGameModeSelection();
        } else {
            this.createGameBoard();
            this.updateDisplay();
            this.animateReset();
        }
    }

    showInvalidMoveAnimation(cell) {
        cell.style.animation = 'none';
        cell.offsetHeight; 
        cell.style.animation = 'shake 0.5s ease-in-out';
        
        setTimeout(() => {
            cell.style.animation = '';
        }, 500);
    }

    animateCellPlacement(cell) {
        cell.style.transform = 'scale(0)';
        cell.style.transition = 'transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
        
        requestAnimationFrame(() => {
            cell.style.transform = 'scale(1)';
        });

        setTimeout(() => {
            cell.style.transition = '';
            cell.style.transform = '';
        }, 300);
    }

    animateReset() {
        const allBoards = document.querySelectorAll('.small-board');
        allBoards.forEach((board, index) => {
            board.style.opacity = '0';
            board.style.transform = 'scale(0.8)';
            
            setTimeout(() => {
                board.style.transition = 'all 0.3s ease-out';
                board.style.opacity = '1';
                board.style.transform = 'scale(1)';
                
                setTimeout(() => {
                    board.style.transition = '';
                    board.style.transform = '';
                    board.style.opacity = '';
                }, 300);
            }, index * 50);
        });
    }
}


const shakeAnimation = `
@keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
    20%, 40%, 60%, 80% { transform: translateX(5px); }
}
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = shakeAnimation;
document.head.appendChild(styleSheet);

document.addEventListener('DOMContentLoaded', () => {
    new UltimateTicTacToe();
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
        });
    });
}