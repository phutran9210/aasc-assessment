export const CARO = {
  /** Board is SIZE x SIZE. */
  SIZE: 15,
  /** Consecutive symbols (row, column or diagonal) needed to win. */
  WIN_LENGTH: 5,
} as const;

export const CARO_SYMBOLS = { X: 'X', O: 'O' } as const;
export type CaroSymbol = (typeof CARO_SYMBOLS)[keyof typeof CARO_SYMBOLS];

export const CARO_RESULTS = { X_WIN: 'x_win', O_WIN: 'o_win', DRAW: 'draw' } as const;
export type CaroResult = (typeof CARO_RESULTS)[keyof typeof CARO_RESULTS];
export const CARO_RESULT_VALUES = Object.values(CARO_RESULTS);

/** Why a match ended. */
export const CARO_END_REASONS = {
  /** A player made five in a row. */
  FIVE_IN_ROW: 'five_in_row',
  /** The board is full with no winner. */
  BOARD_FULL: 'board_full',
  /** A player left the match on purpose. */
  RESIGN: 'resign',
  /** A player's connection dropped. */
  DISCONNECT: 'disconnect',
} as const;
export type CaroEndReason = (typeof CARO_END_REASONS)[keyof typeof CARO_END_REASONS];
export const CARO_END_REASON_VALUES = Object.values(CARO_END_REASONS);

/** Socket.IO namespace and event names shared with the browser client. */
export const CARO_WS = {
  NAMESPACE: '/caro',
  // Client → server (each answered with an ack)
  FIND: 'match:find',
  CANCEL: 'match:cancel',
  MOVE: 'match:move',
  LEAVE: 'match:leave',
  // Server → client
  START: 'match:start',
  UPDATE: 'match:update',
  END: 'match:end',
} as const;
