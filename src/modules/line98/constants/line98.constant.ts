export const LINE98 = {
  /** Board is SIZE x SIZE. */
  SIZE: 9,
  /** Ball colours are numbered 1..COLOR_COUNT; 0 is an empty cell. */
  COLOR_COUNT: 5,
  EMPTY: 0,
  /** Balls on the board when a game starts. */
  INITIAL_BALLS: 5,
  /** Balls added after every move. */
  SPAWN_COUNT: 3,
  /** Minimum run of one colour (row, column or diagonal) that is cleared. */
  LINE_LENGTH: 5,
} as const;

export const LINE98_STATUSES = {
  PLAYING: 'playing',
  /** Board is full: no move is possible. */
  OVER: 'over',
  /** Replaced by a new game before it ended. */
  ABANDONED: 'abandoned',
} as const;

export type Line98Status = (typeof LINE98_STATUSES)[keyof typeof LINE98_STATUSES];

/** Socket.IO namespace and event names shared with the browser client. */
export const LINE98_WS = {
  NAMESPACE: '/line98',
  JOIN: 'game:join',
  NEW: 'game:new',
  MOVE: 'game:move',
  HINT: 'game:hint',
  /** Server → client: the board changed (sent to every tab of the same player). */
  STATE: 'game:state',
} as const;
