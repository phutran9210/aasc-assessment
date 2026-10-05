import { $, cellFromEvent, connect, request, requireLogin, showMessage } from './common.js';

requireLogin();

const SIZE = 9;
const CELL = 56;
const RADIUS = 20;
/** Index = colour number sent by the server (0 is unused: empty cell). */
const COLORS = [null, '#d8433b', '#2f7fd1', '#3a9d5d', '#e0a526', '#8a4fc4'];
const STEP_MS = 45; // time a moving ball spends on each cell of its path
const GROW_MS = 220; // new balls grow, cleared balls shrink
const HINT_MS = 2500;

const canvas = $('#board');
const context = canvas.getContext('2d');
const message = $('#message');

/** Everything the canvas shows. The server is the only one that changes `board`. */
const view = {
  board: Array.from({ length: SIZE }, () => Array(SIZE).fill(0)),
  status: 'playing',
  selected: null, // cell of the ball picked by the player
  moving: null, // { color, x, y } ball travelling along a path
  growing: new Map(), // cell key → scale 0..1 for balls that just appeared
  shrinking: [], // { row, col, color, scale } balls being cleared
  hint: null, // { from, to }
  busy: false, // a move is being sent or animated
};

const keyOf = ({ row, col }) => row * SIZE + col;
const centerOf = ({ row, col }) => ({ x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Drawing ─────────────────────────────────────────────────────────

function drawBall(x, y, color, scale = 1) {
  const radius = RADIUS * scale;
  if (radius <= 0) return;
  const gradient = context.createRadialGradient(
    x - radius / 3,
    y - radius / 3,
    radius / 6,
    x,
    y,
    radius,
  );
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.25, COLORS[color]);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.55)');

  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = COLORS[color];
  context.fill();
  context.fillStyle = gradient;
  context.globalAlpha = 0.55;
  context.fill();
  context.globalAlpha = 1;
}

function draw(now) {
  context.clearRect(0, 0, canvas.width, canvas.height);

  // Grid
  context.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  context.lineWidth = 1;
  for (let i = 0; i <= SIZE; i += 1) {
    context.beginPath();
    context.moveTo(i * CELL + 0.5, 0);
    context.lineTo(i * CELL + 0.5, SIZE * CELL);
    context.moveTo(0, i * CELL + 0.5);
    context.lineTo(SIZE * CELL, i * CELL + 0.5);
    context.stroke();
  }

  // Hint: ring around the ball to move, dot on the suggested target.
  if (view.hint) {
    const from = centerOf(view.hint.from);
    const to = centerOf(view.hint.to);
    context.strokeStyle = '#1f6f5c';
    context.lineWidth = 4;
    context.strokeRect(
      view.hint.from.col * CELL + 4,
      view.hint.from.row * CELL + 4,
      CELL - 8,
      CELL - 8,
    );
    context.setLineDash([6, 6]);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(to.x, to.y, 7, 0, Math.PI * 2);
    context.fillStyle = '#1f6f5c';
    context.fill();
  }

  // Balls
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const color = view.board[row][col];
      if (!color) continue;
      const { x, y } = centerOf({ row, col });
      const isSelected = view.selected?.row === row && view.selected?.col === col;
      // The selected ball pulses (grows and shrinks) so the choice is obvious.
      const scale = isSelected
        ? 1.12 + 0.1 * Math.sin(now / 130)
        : (view.growing.get(keyOf({ row, col })) ?? 1);
      drawBall(x, y, color, scale);
    }
  }
  for (const ball of view.shrinking) {
    const { x, y } = centerOf(ball);
    drawBall(x, y, ball.color, ball.scale);
  }
  if (view.moving) drawBall(view.moving.x, view.moving.y, view.moving.color, 1.1);

  requestAnimationFrame(draw);
}

// ── Animations ──────────────────────────────────────────────────────

/** Calls `onFrame(progress)` with progress going from 0 to 1 over `duration` ms. */
function animate(duration, onFrame) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      onFrame(progress);
      if (progress < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

/** Plays what the server reported: the ball travels, new balls grow, cleared balls shrink. */
async function playMove({ state, path, cleared, spawned }) {
  if (path.length > 1) {
    const [origin] = path;
    const color = view.board[origin.row][origin.col];
    view.board[origin.row][origin.col] = 0;

    for (let step = 1; step < path.length; step += 1) {
      const from = centerOf(path[step - 1]);
      const to = centerOf(path[step]);
      await animate(STEP_MS, (progress) => {
        view.moving = {
          color,
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
        };
      });
    }
    view.moving = null;
    const target = path.at(-1);
    view.board[target.row][target.col] = color;
  }

  // Remember the colours of the cleared balls before the board is replaced.
  view.shrinking = cleared.map((cell) => ({
    ...cell,
    color: view.board[cell.row][cell.col] || 1,
    scale: 1,
  }));
  applyState(state);
  spawned.forEach((cell) => view.growing.set(keyOf(cell), 0));

  await animate(GROW_MS, (progress) => {
    spawned.forEach((cell) => view.growing.set(keyOf(cell), progress));
    view.shrinking.forEach((ball) => (ball.scale = 1 - progress));
  });
  view.growing.clear();
  view.shrinking = [];
}

// ── State ───────────────────────────────────────────────────────────

function applyState(state) {
  view.board = state.board;
  view.status = state.status;
  view.selected = null;
  view.hint = null;

  $('#score').textContent = state.score;
  $('#moves').textContent = state.moveCount;
  $('#status').textContent =
    state.status === 'playing' ? 'Đang chơi' : 'Hết ô trống — kết thúc ván';
  $('#hint').disabled = state.status !== 'playing';
  $('#next').replaceChildren(
    ...state.nextColors.map((color) => {
      const dot = document.createElement('i');
      dot.style.background = COLORS[color];
      return dot;
    }),
  );
}

// ── Server ──────────────────────────────────────────────────────────

const socket = connect('/line98', (text, isError) => {
  if (text) showMessage(message, text, isError ? 'error' : '');
});

/** (Re)loads the saved game every time the connection is established. */
socket.on('connect', async () => {
  try {
    applyState(await request(socket, 'game:join'));
    showMessage(message, '');
  } catch (error) {
    showMessage(message, error.message, 'error');
  }
});

/** The same account played in another tab: mirror it here. */
socket.on('game:state', (result) => {
  if (!view.busy) void playMove(result);
});

async function sendMove(from, to) {
  view.busy = true;
  try {
    await playMove(await request(socket, 'game:move', { from, to }));
    showMessage(message, '');
  } catch (error) {
    view.selected = null;
    showMessage(message, error.message, 'error');
  } finally {
    view.busy = false;
  }
}

// ── Input ───────────────────────────────────────────────────────────

canvas.addEventListener('click', (event) => {
  if (view.busy || view.status !== 'playing') return;
  const cell = cellFromEvent(canvas, event, CELL);
  if (cell.row < 0 || cell.row >= SIZE || cell.col < 0 || cell.col >= SIZE) return;

  view.hint = null;
  if (view.board[cell.row][cell.col]) {
    // Clicking the selected ball again puts it down.
    const same = view.selected?.row === cell.row && view.selected?.col === cell.col;
    view.selected = same ? null : cell;
  } else if (view.selected) {
    void sendMove(view.selected, cell);
  }
});

$('#new-game').addEventListener('click', async () => {
  try {
    applyState(await request(socket, 'game:new'));
    showMessage(message, 'Đã bắt đầu ván mới', 'success');
  } catch (error) {
    showMessage(message, error.message, 'error');
  }
});

$('#hint').addEventListener('click', async () => {
  try {
    view.selected = null;
    const hint = await request(socket, 'game:hint');
    view.hint = hint;
    setTimeout(() => {
      if (view.hint === hint) view.hint = null;
    }, HINT_MS);
    await sleep(0);
  } catch (error) {
    showMessage(message, error.message, 'error');
  }
});

requestAnimationFrame(draw);
