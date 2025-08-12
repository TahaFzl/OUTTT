## Game Overview

Ultimate Tic-Tac-Toe features a 3×3 grid of smaller Tic-Tac-Toe boards. Players take turns placing their marks (X or O) in one of the 81 available squares. Your move determines which small board your opponent must play in next. Win a small board to claim it on the larger grid. The first player to claim three small boards in a row wins the game.

---

## Project Structure

| File               | Description                                     |
|--------------------|-------------------------------------------------|
| `index.html`       | Main game interface                             |
| `styles.css`       | Styling for layout and visuals                  |
| `scripts.js`       | Client-side game logic and interactions         |
| `server.js`        | Serves the game via a simple Node.js server     |
| `package.json`     | Project metadata and dependencies               |
| `package-lock.json`| Ensures consistent dependency versions          |

---

## Installation & Running Locally

1. **Clone the repository**:
   ```bash
   git clone https://github.com/TahaFzl/UTTT.git
   cd UTTT
   ```

2. **Install dependencies** (if any are listed in `package.json`):
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   node server.js
   ```

4. **Open your browser** and navigate to `http://localhost:3000` (or whichever port is specified in `server.js`).

---

## How to Play

- Game begins with X placing a mark in any square across the 9 small boards.
- Your move determines the small board your opponent must play in next.
- Claim a small board by winning it—then it becomes your mark on the larger 3×3 grid.
- Capture three small boards in a row to win the game.
- If your opponent is sent to a small board that’s already complete (won or full), they may play in any other open board.

---

## Contributing

Contributions are welcome! Whether you're fixing bugs, polishing the UI, or adding new features, feel free to submit issues or pull requests. Let’s make this game even more engaging together!
