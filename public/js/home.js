import { $, api, getToken, logout, setToken, showMessage } from './common.js';

const authMessage = $('#auth-message');
const profileMessage = $('#profile-message');

const credentials = () => ({ username: $('#username').value, password: $('#password').value });

function showLobby(user) {
  $('#auth').classList.add('hidden');
  ['#lobby', '#profile', '#logout'].forEach((id) => $(id).classList.remove('hidden'));
  $('#profile-username').textContent = user.username;
  $('#nickname').value = user.nickname ?? '';
  $('#email').value = user.email ?? '';
}

async function login() {
  const { accessToken, user } = await api('/auth/login', { method: 'POST', body: credentials() });
  setToken(accessToken);
  showLobby(user);
}

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await login();
  } catch (error) {
    showMessage(authMessage, error.message, 'error');
  }
});

$('#register').addEventListener('click', async () => {
  try {
    await api('/auth/register', { method: 'POST', body: credentials() });
    await login(); // a new account is logged in straight away
  } catch (error) {
    showMessage(authMessage, error.message, 'error');
  }
});

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    // Empty fields are sent as null: that is how the API clears a value.
    const user = await api('/users/me', {
      method: 'PATCH',
      body: {
        nickname: $('#nickname').value.trim() || null,
        email: $('#email').value.trim() || null,
      },
    });
    showLobby(user);
    showMessage(profileMessage, 'Đã lưu thông tin', 'success');
  } catch (error) {
    showMessage(profileMessage, error.message, 'error');
  }
});

$('#logout').addEventListener('click', (event) => {
  event.preventDefault();
  logout();
});

// Returning player: restore the session if the stored token is still valid.
if (getToken()) {
  api('/users/me')
    .then(showLobby)
    .catch(() => {});
}
