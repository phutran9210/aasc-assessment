/* Shared by every page: session storage, REST helper and Socket.IO helpers. */

const TOKEN_KEY = 'aasc_token';

export const $ = (selector) => document.querySelector(selector);

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  location.href = '/';
}

/** Sends the visitor back to the login page when there is no session. */
export function requireLogin() {
  if (!getToken()) location.replace('/');
}

/** Shows feedback in a `.message` element. `kind` is '', 'error' or 'success'. */
export function showMessage(element, text, kind = '') {
  element.textContent = text;
  element.className = `message ${kind}`.trim();
}

/** Server errors carry `message` as a string or, for validation, a list of strings. */
const errorText = (message) => (Array.isArray(message) ? message.join('. ') : String(message));

/**
 * Calls the REST API with the access token. Resolves with the JSON body (or null for 204);
 * rejects with an Error whose message is the server's Vietnamese error message.
 */
export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Không kết nối được máy chủ');
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok) return data;

  // An expired or invalid session cannot be repaired from here: log in again.
  if (response.status === 401 && getToken() && !path.startsWith('/auth/')) logout();
  throw new Error(data?.message ? errorText(data.message) : `Lỗi ${response.status}`);
}

/**
 * Opens an authenticated Socket.IO connection to a namespace ('/line98', '/caro').
 * `onStatus(text, isError)` is called when the connection is made, lost or refused.
 */
export function connect(namespace, onStatus) {
  // `io` is the global defined by /socket.io/socket.io.js.
  const socket = io(namespace, { auth: { token: getToken() } });

  socket.on('connect', () => onStatus('', false));
  socket.on('disconnect', () => onStatus('Mất kết nối, đang thử kết nối lại...', true));
  socket.on('connect_error', (error) => {
    onStatus(error.message || 'Không kết nối được máy chủ', true);
    // The handshake was refused because of the token: reconnecting would fail forever.
    if (/đăng nhập|hết hạn/.test(error.message)) setTimeout(logout, 1500);
  });
  return socket;
}

/** Emits an event and resolves with its data; rejects with the server's error message. */
export function request(socket, event, body) {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(event, body, (timeoutError, ack) => {
      if (timeoutError) reject(new Error('Máy chủ không phản hồi'));
      else if (ack?.ok) resolve(ack.data);
      else reject(new Error(ack?.message ?? 'Lỗi không xác định'));
    });
  });
}

/** Maps a mouse/touch event to the board cell under it, taking CSS scaling into account. */
export function cellFromEvent(canvas, event, cellSize) {
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  return {
    row: Math.floor(((event.clientY - rect.top) * scale) / cellSize),
    col: Math.floor(((event.clientX - rect.left) * scale) / cellSize),
  };
}
