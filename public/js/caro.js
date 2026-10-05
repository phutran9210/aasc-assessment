import { $, api, cellFromEvent, connect, request, requireLogin, showMessage } from './common.js';

requireLogin();

const SIZE = 15;
const CELL = 34;
const SYMBOL_COLORS = { X: '#b3402e', O: '#2f6fb3' };
const OUTCOME_LABELS = { win: 'Thắng', lose: 'Thua', draw: 'Hòa' };
const REASON_LABELS = {
  five_in_row: 'đủ 5 liên tiếp',
  board_full: 'hết ô trống',
  resign: 'đối phương rời trận',
  disconnect: 'đối phương mất kết nối',
};

const canvas = $('#board');
const context = canvas.getContext('2d');
const message = $('#message');

const emptyBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

/** phase: 'idle' | 'waiting' | 'playing' | 'ended' */
const view = {
  phase: 'idle',
  board: emptyBoard(),
  you: null,
  turn: null,
  lastMove: null,
  winningLine: [],
};

// ── Drawing ─────────────────────────────────────────────────────────

function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (view.lastMove) {
    context.fillStyle = 'rgba(31, 111, 92, 0.16)';
    context.fillRect(view.lastMove.col * CELL, view.lastMove.row * CELL, CELL, CELL);
  }

  context.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  context.lineWidth = 1;
  for (let i = 0; i <= SIZE; i += 1) {
    context.beginPath();
    context.moveTo(i * CELL + 0.5, 0);
    context.lineTo(i * CELL + 0.5, SIZE * CELL);
    context.moveTo(0, i * CELL + 0.5);
    context.lineTo(SIZE * CELL, i * CELL + 0.5);
    context.stroke();
  }

  context.lineWidth = 3;
  context.lineCap = 'round';
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const symbol = view.board[row][col];
      if (!symbol) continue;
      const x = col * CELL + CELL / 2;
      const y = row * CELL + CELL / 2;
      const half = CELL / 2 - 8;

      context.strokeStyle = SYMBOL_COLORS[symbol];
      context.beginPath();
      if (symbol === 'X') {
        context.moveTo(x - half, y - half);
        context.lineTo(x + half, y + half);
        context.moveTo(x + half, y - half);
        context.lineTo(x - half, y + half);
      } else {
        context.arc(x, y, half, 0, Math.PI * 2);
      }
      context.stroke();
    }
  }

  // Strike through the winning five.
  if (view.winningLine.length > 0) {
    const first = view.winningLine[0];
    const last = view.winningLine.at(-1);
    context.strokeStyle = '#1f6f5c';
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(first.col * CELL + CELL / 2, first.row * CELL + CELL / 2);
    context.lineTo(last.col * CELL + CELL / 2, last.row * CELL + CELL / 2);
    context.stroke();
  }
}

// ── State ───────────────────────────────────────────────────────────

function setPhase(phase, statusText) {
  view.phase = phase;
  $('#status').textContent = statusText;
  $('#find').classList.toggle('hidden', phase === 'waiting' || phase === 'playing');
  $('#cancel').classList.toggle('hidden', phase !== 'waiting');
  $('#leave').classList.toggle('hidden', phase !== 'playing');
}

function showTurn() {
  setPhase('playing', view.turn === view.you ? `Lượt của bạn (${view.you})` : 'Lượt của đối thủ');
}

async function loadHistory() {
  try {
    const { data } = await api('/caro/matches?limit=10');
    $('#history').replaceChildren(
      ...data.map((match) => {
        const item = document.createElement('li');
        const opponent = match.you === 'X' ? match.playerO : match.playerX;
        const versus = document.createElement('span');
        versus.textContent = `${match.you} đấu với ${opponent} · ${match.moveCount} nước`;
        const outcome = document.createElement('span');
        outcome.className = match.outcome;
        outcome.textContent = OUTCOME_LABELS[match.outcome];
        item.append(versus, outcome);
        return item;
      }),
    );
    if (data.length === 0) $('#history').textContent = 'Chưa có trận nào.';
  } catch (error) {
    showMessage(message, error.message, 'error');
  }
}

// ── Server ──────────────────────────────────────────────────────────

const socket = connect('/caro', (text, isError) => {
  if (text) showMessage(message, text, isError ? 'error' : '');
});

socket.on('connect', () => {
  // After a reconnect the server has already ended any match this socket was in.
  if (view.phase !== 'ended') setPhase('idle', 'Sẵn sàng. Bấm "Tìm trận" để ghép cặp.');
  showMessage(message, '');
  void loadHistory();
});

socket.on('match:start', (start) => {
  Object.assign(view, {
    board: emptyBoard(),
    you: start.you,
    turn: start.turn,
    lastMove: null,
    winningLine: [],
  });
  $('#you').textContent = `${start.you}${start.you === 'X' ? ' (đi trước)' : ''}`;
  $('#opponent').textContent = start.opponent;
  showMessage(message, '');
  showTurn();
  draw();
});

socket.on('match:update', ({ move, turn }) => {
  view.board[move.row][move.col] = move.symbol;
  view.lastMove = move;
  view.turn = turn;
  if (view.phase === 'playing') showTurn();
  draw();
});

socket.on('match:end', ({ winner, reason, line }) => {
  view.winningLine = line;
  const result = winner === null ? 'Hòa' : winner === view.you ? 'Bạn thắng!' : 'Bạn thua.';
  setPhase('ended', `${result} (${REASON_LABELS[reason] ?? reason})`);
  draw();
  void loadHistory();
});

// ── Input ───────────────────────────────────────────────────────────

/** Runs a request and shows its error, if any, next to the board. */
async function attempt(action) {
  try {
    await action();
    showMessage(message, '');
  } catch (error) {
    showMessage(message, error.message, 'error');
  }
}

$('#find').addEventListener('click', () =>
  attempt(async () => {
    const { status } = await request(socket, 'match:find');
    // When matched, `match:start` (which may already have arrived) sets the phase.
    if (status === 'waiting') setPhase('waiting', 'Đang tìm đối thủ...');
  }),
);

$('#cancel').addEventListener('click', () =>
  attempt(async () => {
    await request(socket, 'match:cancel');
    setPhase('idle', 'Đã hủy tìm trận.');
  }),
);

$('#leave').addEventListener('click', () => attempt(() => request(socket, 'match:leave')));

canvas.addEventListener('click', (event) => {
  if (view.phase !== 'playing') return;
  const cell = cellFromEvent(canvas, event, CELL);
  if (cell.row < 0 || cell.row >= SIZE || cell.col < 0 || cell.col >= SIZE) return;

  // The server checks the turn and the cell again; these messages just save a round trip.
  if (view.turn !== view.you) return showMessage(message, 'Chưa đến lượt của bạn', 'error');
  if (view.board[cell.row][cell.col]) return showMessage(message, 'Ô này đã được đánh', 'error');
  void attempt(() => request(socket, 'match:move', cell));
});

draw();
