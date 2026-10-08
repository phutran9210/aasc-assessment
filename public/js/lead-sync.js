/* Admin panel of the Google Sheets → Bitrix24 lead sync: status, run history, mapping editor. */

import { $, api, logout, requireLogin } from './common.js';

requireLogin();

const PAGE_SIZE = 10;
const POLL_MS = 2000;
const FIELD_TYPES = ['string', 'email', 'phone', 'number', 'date', 'datetime', 'enum', 'user'];
const TYPES_WITH_VALUES = ['enum', 'user'];

const STATUS = {
  running: ['Đang chạy', 'label-primary'],
  succeeded: ['Thành công', 'label-success'],
  partial: ['Có hàng lỗi', 'label-warning'],
  failed: ['Thất bại', 'label-danger'],
  aborted: ['Dừng giữa chừng', 'label-warning'],
};
const TRIGGER = {
  schedule: 'Lịch tự động',
  http: 'Bấm chạy tay',
  cli: 'Dòng lệnh',
  webhook: 'Sự kiện Bitrix24 (về Sheet)',
  pull: 'Kéo từ Bitrix24 về Sheet',
};
const ACTION = {
  create: ['Tạo mới', 'label-success'],
  update: ['Cập nhật', 'label-primary'],
  fail: ['Lỗi', 'label-danger'],
};
const VIEW_TITLES = { overview: 'Đồng bộ Lead', runs: 'Lịch sử đồng bộ', mapping: 'Mapping cột' };

const state = { page: 1, totalPages: 1, mapping: null, pollTimer: null, opener: null };

/* ── Small helpers ─────────────────────────────────────────────────── */

/** Builds an element; `props` are DOM properties, `children` are nodes or strings. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('aria-') || key === 'scope' || key === 'for') {
      node.setAttribute(key, value);
    } else node[key] = value;
  }
  node.append(...children);
  return node;
}

const dateTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' });
const formatTime = (iso) => (iso ? dateTime.format(new Date(iso)) : '');

function formatDuration(run) {
  if (!run.finishedAt) return 'đang chạy';
  const seconds = (new Date(run.finishedAt) - new Date(run.startedAt)) / 1000;
  return `${seconds.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giây`;
}

function statusLabel(run) {
  const [text, className] = STATUS[run.status] ?? [run.status, ''];
  return el('span', { className: `label ${className}` }, run.dryRun ? `${text} (chạy thử)` : text);
}

function setLabel(node, text, className) {
  node.textContent = text;
  node.className = `label ${className}`.trim();
}

function showAction(text, isError = false) {
  const message = $('#action-message');
  message.textContent = text;
  message.className = `toolbar-status ${isError ? 'error' : ''}`.trim();
}

/* ── Overview ──────────────────────────────────────────────────────── */

async function loadStatus() {
  const status = await api('/lead-sync/status');

  const banner = $('#config-banner');
  banner.classList.toggle('hidden', status.configured);
  banner.textContent = status.configured ? '' : `Chưa thể đồng bộ: ${status.reason}`;
  for (const button of [$('#run'), $('#dry-run')]) button.disabled = !status.configured;

  for (const name of ['google', 'bitrix']) {
    const check = status.connections[name];
    setLabel(
      document.querySelector(`[data-connection="${name}"]`),
      check.ok ? 'Đã kết nối' : 'Chưa kết nối',
      check.ok ? 'label-success' : 'label-danger',
    );
    document.querySelector(`[data-connection-note="${name}"]`).textContent = check.message ?? '';
  }

  $('#schedule-cron').textContent = status.schedule.cron ?? 'Chưa đặt lịch';
  $('#schedule-next').textContent = status.schedule.nextRunAt
    ? formatTime(status.schedule.nextRunAt)
    : 'Không có';
  $('#schedule-timezone').textContent = status.schedule.timezone;

  renderLastRun(status.lastRun);
  return status;
}

function renderLastRun(run) {
  const label = $('#last-status');
  const reason = $('#last-reason');
  if (!run) {
    setLabel(label, 'Chưa chạy', '');
    $('#last-meta').textContent = '';
    reason.classList.add('hidden');
    return;
  }
  label.replaceWith(Object.assign(statusLabel(run), { id: 'last-status' }));
  $('#last-meta').textContent =
    `${TRIGGER[run.trigger] ?? run.trigger}, ${formatTime(run.startedAt)}, ${formatDuration(run)}`;
  for (const name of ['created', 'updated', 'skipped', 'failed']) {
    const cell = document.querySelector(`[data-counter="${name}"]`);
    cell.textContent = run[name].toLocaleString('vi-VN');
    cell.classList.toggle('nonzero', run[name] > 0);
  }
  reason.classList.toggle('hidden', !run.stopReason);
  reason.textContent = run.stopReason ? `Lý do dừng: ${run.stopReason}` : '';
}

/* ── Run history ───────────────────────────────────────────────────── */

async function loadRuns() {
  const { data, meta } = await api(`/lead-sync/runs?page=${state.page}&limit=${PAGE_SIZE}`);
  const total = meta?.total ?? data.length;
  state.totalPages = Math.max(1, meta?.totalPages ?? Math.ceil(total / PAGE_SIZE));

  $('#runs-total').textContent = total ? `${total.toLocaleString('vi-VN')} lần chạy` : '';
  $('#runs-empty').classList.toggle('hidden', data.length > 0);
  $('#runs-page').textContent = `Trang ${state.page} / ${state.totalPages}`;
  $('#runs-prev').disabled = state.page <= 1;
  $('#runs-next').disabled = state.page >= state.totalPages;

  $('#runs-body').replaceChildren(
    ...data.map((run) => {
      const open = el(
        'button',
        { type: 'button', className: 'linklike' },
        formatTime(run.startedAt),
      );
      open.addEventListener('click', () => openRun(run.id, open));
      const failed = el('td', { className: 'num' }, String(run.failed));
      if (run.failed > 0) failed.classList.add('failed-count');
      return el(
        'tr',
        {},
        el('td', {}, open),
        el('td', {}, TRIGGER[run.trigger] ?? run.trigger),
        el('td', {}, statusLabel(run)),
        el('td', { className: 'num' }, String(run.total)),
        el('td', { className: 'num' }, String(run.created)),
        el('td', { className: 'num' }, String(run.updated)),
        el('td', { className: 'num' }, String(run.skipped)),
        failed,
        el('td', { className: 'num' }, formatDuration(run)),
      );
    }),
  );
}

async function openRun(id, opener) {
  const run = await api(`/lead-sync/runs/${id}`);
  const body = el('div');

  const summary = el(
    'ul',
    { className: 'rows' },
    row('Kết quả', statusLabel(run)),
    row('Nguồn', TRIGGER[run.trigger] ?? run.trigger),
    row('Bắt đầu', formatTime(run.startedAt)),
    row('Thời gian chạy', formatDuration(run)),
    row(
      'Số hàng',
      `${run.total} hàng: ${run.created} tạo mới, ${run.updated} cập nhật, ${run.skipped} bỏ qua, ${run.failed} lỗi`,
    ),
  );
  if (run.stopReason) summary.append(row('Lý do dừng', run.stopReason));
  body.append(panel('Tóm tắt', summary));

  const items = run.items ?? [];
  const table = el(
    'table',
    { className: 'grid' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        ...['Hàng trong Sheet', 'Việc đã làm', 'Lead ID', 'Chi tiết'].map((text) =>
          el('th', { scope: 'col' }, text),
        ),
      ),
    ),
    el(
      'tbody',
      {},
      ...items.map((item) => {
        const [text, className] = ACTION[item.action] ?? [item.action, ''];
        return el(
          'tr',
          {},
          el('td', {}, `Hàng ${item.rowNumber}`),
          el('td', {}, el('span', { className: `label ${className}` }, text)),
          el('td', {}, item.leadId ?? ''),
          el('td', {}, item.errorMessage ?? ''),
        );
      }),
    ),
  );
  body.append(
    panel(
      'Các hàng đã xử lý',
      items.length
        ? el('div', { className: 'grid-wrap' }, table)
        : el(
            'p',
            { className: 'empty' },
            run.dryRun
              ? 'Chạy thử không ghi lại từng hàng.'
              : 'Không có hàng nào được tạo, cập nhật hay báo lỗi trong lần chạy này.',
          ),
    ),
  );

  openSlider(`Lần chạy ${formatTime(run.startedAt)}`, body, { opener });
}

const row = (name, value) =>
  el('li', {}, el('span', { className: 'rows-name' }, name), el('span', {}, value));

const panel = (title, ...children) =>
  el(
    'div',
    { className: 'panel' },
    el('div', { className: 'panel-head' }, el('h3', {}, title)),
    ...children,
  );

/* ── Mapping ───────────────────────────────────────────────────────── */

const valuesToText = (values) =>
  Object.entries(values ?? {})
    .map(([label, code]) => `${label} = ${code}`)
    .join('\n');

/** One `Label = CODE` pair per line. A code made of digits only is stored as a number. */
function textToValues(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const at = line.lastIndexOf('=');
    if (at < 0) continue;
    const label = line.slice(0, at).trim();
    const code = line.slice(at + 1).trim();
    if (label && code) values[label] = /^\d+$/.test(code) ? Number(code) : code;
  }
  return values;
}

async function loadMapping() {
  const { path, mapping } = await api('/lead-sync/mapping');
  state.mapping = mapping;
  $('#mapping-path').textContent = path;

  $('#mapping-body').replaceChildren(
    ...mapping.fields.map((field) =>
      el(
        'tr',
        {},
        el('td', {}, field.column),
        el('td', {}, el('code', {}, field.field)),
        el('td', {}, field.type),
        el('td', {}, field.required ? 'Có' : ''),
        el('td', {}, valuesToText(field.values).replaceAll('\n', '; ')),
      ),
    ),
  );

  const defaults = Object.entries(mapping.defaults ?? {})
    .map(([name, value]) => `${name} = ${value}`)
    .join(', ');
  $('#mapping-summary').replaceChildren(
    row('Tiêu đề lead', mapping.titleTemplate ?? 'Không đặt'),
    row('Giá trị mặc định', defaults || 'Không có'),
    row('Chống trùng theo', mapping.dedupe.keys.join(', ')),
  );
}

function fieldRow(field = { column: '', field: '', type: 'string', required: false }) {
  const index = crypto.randomUUID().slice(0, 8);
  const input = (name, label, value) =>
    el('input', { type: 'text', name, value, 'aria-label': label, id: `${name}-${index}` });

  const type = el(
    'select',
    { name: 'type', 'aria-label': 'Kiểu dữ liệu' },
    ...FIELD_TYPES.map((name) =>
      el('option', { value: name, selected: name === field.type }, name),
    ),
  );
  const values = el('textarea', {
    name: 'values',
    rows: 2,
    value: valuesToText(field.values),
    placeholder: 'Mới = NEW',
    'aria-label': 'Bảng giá trị, mỗi dòng một cặp Nhãn = Mã',
  });
  const syncValues = () => {
    // Only enum and user columns have a value table; the box would be noise on the others.
    values.hidden = !TYPES_WITH_VALUES.includes(type.value);
  };
  type.addEventListener('change', syncValues);
  syncValues();

  const remove = el(
    'button',
    { type: 'button', className: 'btn btn-icon', 'aria-label': 'Xóa dòng mapping này' },
    '✕',
  );
  const tr = el(
    'tr',
    {},
    el('td', {}, input('column', 'Cột trong Sheet', field.column)),
    el('td', {}, input('field', 'Trường lead Bitrix24', field.field)),
    el('td', { className: 'col-type' }, type),
    el(
      'td',
      { className: 'col-required' },
      el('input', {
        type: 'checkbox',
        name: 'required',
        checked: Boolean(field.required),
        'aria-label': 'Bắt buộc',
      }),
    ),
    el('td', { className: 'col-values' }, values),
    el('td', { className: 'col-remove' }, remove),
  );
  // Keys the form does not edit (onUnknown, ...) travel with the row untouched.
  tr.original = field;
  remove.addEventListener('click', () => tr.remove());
  return tr;
}

function openMappingEditor(opener) {
  const mapping = state.mapping;
  const body = el('div');

  body.append(
    el(
      'p',
      { className: 'note' },
      'Sau khi lưu, lần chạy kế tiếp sẽ đồng bộ lại mọi hàng theo mapping mới. Nên bấm “Chạy thử” trước khi chạy thật.',
    ),
  );

  const rows = el('tbody', { id: 'map-rows' }, ...mapping.fields.map((field) => fieldRow(field)));
  const add = el('button', { type: 'button', className: 'btn btn-light btn-small' }, 'Thêm cột');
  add.addEventListener('click', () => {
    const tr = fieldRow();
    rows.append(tr);
    tr.querySelector('input').focus();
  });
  body.append(
    panel(
      'Cột và trường',
      el(
        'div',
        { className: 'grid-wrap' },
        el(
          'table',
          { className: 'grid map-table' },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              ...[
                'Cột trong Sheet',
                'Trường lead Bitrix24',
                'Kiểu',
                'Bắt buộc',
                'Bảng giá trị',
                '',
              ].map((text) => el('th', { scope: 'col' }, text)),
            ),
          ),
          rows,
        ),
      ),
      el('div', { className: 'panel-foot' }, add),
    ),
  );

  const field = (id, label, value, hint) =>
    el(
      'div',
      { className: 'field' },
      el('label', { for: id }, label),
      el('input', { type: 'text', id, value: value ?? '' }),
      hint ? el('p', { className: 'hint' }, hint) : '',
    );
  const dedupe = (key, label) =>
    el(
      'label',
      { className: 'dedupe' },
      el('input', {
        type: 'checkbox',
        name: 'dedupe',
        value: key,
        checked: mapping.dedupe.keys.includes(key),
      }),
      ` ${label}`,
    );
  body.append(
    panel(
      'Thiết lập chung',
      el(
        'div',
        { className: 'form-grid' },
        field(
          'map-title',
          'Tiêu đề lead',
          mapping.titleTemplate,
          'Đặt tên cột trong ngoặc nhọn, ví dụ {Tên khách hàng} - {Công ty}.',
        ),
        field('map-stage', 'Giai đoạn mặc định', mapping.defaults?.stageId, 'Ví dụ NEW.'),
        field('map-currency', 'Tiền tệ mặc định', mapping.defaults?.currencyId, 'Ví dụ VND.'),
        field(
          'map-assignee',
          'ID người phụ trách mặc định',
          mapping.defaults?.assignedById,
          'ID người dùng Bitrix24, ví dụ 1.',
        ),
        el(
          'div',
          { className: 'field' },
          el('span', { className: 'field-label' }, 'Chống trùng theo'),
          dedupe('email', 'Email'),
          ' ',
          dedupe('phone', 'Số điện thoại'),
        ),
      ),
    ),
  );

  $('#mapping-message').textContent = '';
  openSlider('Sửa mapping', body, { opener, footer: true });
}

/** Reads the editor back into a mapping, keeping every key the form does not show. */
function collectMapping() {
  const fields = [...document.querySelectorAll('#map-rows tr')].map((tr) => {
    const get = (name) => tr.querySelector(`[name="${name}"]`);
    const next = {
      ...tr.original,
      column: get('column').value.trim(),
      field: get('field').value.trim(),
      type: get('type').value,
      required: get('required').checked,
    };
    delete next.values;
    if (TYPES_WITH_VALUES.includes(next.type)) next.values = textToValues(get('values').value);
    return next;
  });

  const defaults = { ...state.mapping.defaults };
  const setDefault = (name, id, numeric = false) => {
    const value = $(id).value.trim();
    if (!value) delete defaults[name];
    else defaults[name] = numeric && /^\d+$/.test(value) ? Number(value) : value;
  };
  setDefault('stageId', '#map-stage');
  setDefault('currencyId', '#map-currency');
  setDefault('assignedById', '#map-assignee', true);

  const mapping = {
    ...state.mapping,
    defaults,
    dedupe: {
      ...state.mapping.dedupe,
      keys: [...document.querySelectorAll('[name="dedupe"]:checked')].map((box) => box.value),
    },
    fields,
  };
  const title = $('#map-title').value.trim();
  if (title) mapping.titleTemplate = title;
  else delete mapping.titleTemplate;
  return mapping;
}

async function saveMapping() {
  const button = $('#mapping-save');
  const message = $('#mapping-message');
  button.disabled = true;
  message.className = 'slider-message';
  message.textContent = 'Đang lưu mapping...';
  try {
    await api('/lead-sync/mapping', { method: 'PUT', body: collectMapping() });
    await loadMapping();
    closeSlider();
    showAction('Đã lưu mapping. Lần chạy kế tiếp sẽ đồng bộ lại mọi hàng.');
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

/* ── Slider ────────────────────────────────────────────────────────── */

function openSlider(title, content, { opener = null, footer = false } = {}) {
  state.opener = opener ?? document.activeElement;
  $('#slider-title').textContent = title;
  $('#slider-body').replaceChildren(content);
  $('#slider-foot').classList.toggle('hidden', !footer);
  $('#slider').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  $('.slider-panel').focus();
}

function closeSlider() {
  $('#slider').classList.add('hidden');
  document.body.style.overflow = '';
  state.opener?.focus?.();
}

/** Keeps Tab inside the open slider. */
function trapFocus(event) {
  if (event.key === 'Escape') return closeSlider();
  if (event.key !== 'Tab') return;
  const focusable = [
    ...$('.slider-panel').querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select, textarea:not([disabled]), a[href]',
    ),
  ].filter((node) => node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === $('.slider-panel'))
  ) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ── Running a sync ────────────────────────────────────────────────── */

async function startRun(dryRun) {
  const buttons = [$('#run'), $('#dry-run')];
  for (const button of buttons) button.disabled = true;
  showAction(dryRun ? 'Đang chạy thử...' : 'Đang chạy đồng bộ...');
  try {
    const { runId } = await api('/lead-sync/runs', {
      method: 'POST',
      body: { dryRun, force: $('#force').checked },
    });
    await followRun(runId, dryRun);
  } catch (error) {
    showAction(error.message, true);
    for (const button of buttons) button.disabled = false;
  }
}

/** Polls the run until it ends, then refreshes what the page shows. */
function followRun(runId, dryRun) {
  clearTimeout(state.pollTimer);
  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const run = await api(`/lead-sync/runs/${runId}`);
        if (run.status === 'running') {
          state.pollTimer = setTimeout(tick, POLL_MS);
          return;
        }
        const [text] = STATUS[run.status] ?? [run.status];
        const prefix = dryRun ? 'Chạy thử xong' : 'Chạy đồng bộ xong';
        showAction(
          `${prefix} (${text.toLowerCase()}): ${run.created} tạo mới, ${run.updated} cập nhật, ${run.skipped} bỏ qua, ${run.failed} lỗi.`,
          run.status === 'failed',
        );
      } catch (error) {
        showAction(error.message, true);
      }
      await refresh();
      resolve();
    };
    tick();
  });
}

/* ── Navigation and start-up ───────────────────────────────────────── */

function showView(name) {
  const view = VIEW_TITLES[name] ? name : 'overview';
  for (const section of document.querySelectorAll('.view')) {
    section.classList.toggle('hidden', section.id !== `view-${view}`);
  }
  for (const link of document.querySelectorAll('[data-view]')) {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('#page-title').textContent = VIEW_TITLES[view];
  document.title = `${VIEW_TITLES[view]} – Google Sheets sang Bitrix24`;
}

async function refresh() {
  const results = await Promise.allSettled([loadStatus(), loadRuns(), loadMapping()]);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) showAction(failure.reason.message, true);
}

$('#logout').addEventListener('click', logout);
$('#run').addEventListener('click', () => startRun(false));
$('#dry-run').addEventListener('click', () => startRun(true));
$('#mapping-edit').addEventListener('click', (event) => openMappingEditor(event.currentTarget));
$('#mapping-save').addEventListener('click', saveMapping);
$('#runs-prev').addEventListener('click', () => {
  state.page -= 1;
  loadRuns();
});
$('#runs-next').addEventListener('click', () => {
  state.page += 1;
  loadRuns();
});
for (const closer of document.querySelectorAll('[data-close]')) {
  closer.addEventListener('click', closeSlider);
}
$('#slider').addEventListener('keydown', trapFocus);
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

showView(location.hash.slice(1));
await refresh();
