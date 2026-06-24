// Same-origin by default. If the Worker API is hosted on a different domain
// than the Pages frontend, set this to that origin (e.g. via a <meta> tag).
const API_BASE = '';

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function qs(id) {
  return document.getElementById(id);
}

function copyToClipboard(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    const original = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  });
}

function statusBadge(status) {
  const span = document.createElement('span');
  span.className = `badge ${status}`;
  span.textContent = status;
  return span;
}

// ---------- Dashboard (index.html) ----------

async function initDashboard() {
  const list = qs('content-list');
  const search = qs('search');
  const platformChips = document.querySelectorAll('[data-platform-filter]');
  const statusChips = document.querySelectorAll('[data-status-filter]');

  let items = await api('/api/content');
  let platformFilter = 'all';
  let statusFilter = 'all';

  function render() {
    const term = search.value.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const matchesTerm = !term || item.title.toLowerCase().includes(term);
      const matchesPlatform = platformFilter === 'all' || item.platform === platformFilter;
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchesTerm && matchesPlatform && matchesStatus;
    });

    list.innerHTML = '';
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = items.length === 0
        ? 'No content yet — add your first video.'
        : 'No content matches your filters.';
      list.appendChild(empty);
      return;
    }

    for (const item of filtered) {
      const card = document.createElement('a');
      card.className = 'card';
      card.href = `/content?id=${item.id}`;

      const top = document.createElement('div');
      top.className = 'card-top';
      const title = document.createElement('h3');
      title.textContent = item.title;
      top.appendChild(title);
      top.appendChild(statusBadge(item.status));
      card.appendChild(top);

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = [item.platform, item.publish_date].filter(Boolean).join(' · ');
      card.appendChild(meta);

      list.appendChild(card);
    }
  }

  search.addEventListener('input', render);
  platformChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      platformChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      platformFilter = chip.dataset.platformFilter;
      render();
    });
  });
  statusChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      statusChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      statusFilter = chip.dataset.statusFilter;
      render();
    });
  });

  render();

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      window.location.href = '/new';
    }
  });

  const syncButton = qs('sync-youtube');
  const syncStatus = qs('sync-status');
  syncButton.addEventListener('click', async () => {
    syncButton.disabled = true;
    syncButton.textContent = 'Syncing...';
    syncStatus.textContent = '';
    try {
      const result = await api('/api/sync/youtube', { method: 'POST' });
      syncStatus.textContent = result.inserted > 0
        ? `${result.inserted} new video${result.inserted === 1 ? '' : 's'} added.`
        : 'No new videos.';
      items = await api('/api/content');
      render();
    } catch (err) {
      syncStatus.textContent = `Sync failed: ${err.message}`;
    } finally {
      syncButton.disabled = false;
      syncButton.textContent = 'Sync now';
    }
  });
}

// ---------- Content Detail (content.html) ----------

async function initContentDetail() {
  const id = new URLSearchParams(window.location.search).get('id');
  const content = await api(`/api/content/${id}`);

  qs('title').textContent = content.title;
  qs('platform').textContent = content.platform;
  qs('status-badge').replaceWith(statusBadge(content.status));
  if (content.source_url) {
    qs('source-url').href = content.source_url;
    qs('source-url').textContent = content.source_url;
  }

  renderLinks(content.links);
  renderMessages(content.messages);

  qs('add-link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = qs('link-type').value;
    const url = qs('link-url').value;
    const label = qs('link-label').value;
    const link = await api(`/api/content/${id}/links`, {
      method: 'POST',
      body: JSON.stringify({ type, url, label }),
    });
    content.links.push(link);
    renderLinks(content.links);
    e.target.reset();
  });

  qs('add-message-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const platform = qs('message-platform').value;
    const trigger_word = qs('message-trigger').value;
    const message_body = qs('message-body').value;
    const message = await api(`/api/content/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ platform, trigger_word, message_body }),
    });
    content.messages.push(message);
    renderMessages(content.messages);
    e.target.reset();
  });

  function renderLinks(links) {
    const list = qs('link-list');
    list.innerHTML = '';
    if (links.length === 0) {
      list.innerHTML = '<div class="empty-state">No links yet.</div>';
      return;
    }
    for (const link of links) {
      const row = document.createElement('div');
      row.className = 'row';
      const left = document.createElement('div');
      left.innerHTML = `<div class="label">${link.type}${link.label ? ` · ${link.label}` : ''}</div><div class="value">${link.url}</div>`;
      row.appendChild(left);

      const actions = document.createElement('div');
      const copyBtn = document.createElement('button');
      copyBtn.className = 'small secondary';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => copyToClipboard(link.url, copyBtn));
      actions.appendChild(copyBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'small secondary';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        await api(`/api/links/${link.id}`, { method: 'DELETE' });
        content.links = content.links.filter((l) => l.id !== link.id);
        renderLinks(content.links);
      });
      actions.appendChild(delBtn);

      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  function renderMessages(messages) {
    const list = qs('message-list');
    list.innerHTML = '';
    if (messages.length === 0) {
      list.innerHTML = '<div class="empty-state">No messages yet.</div>';
      return;
    }
    for (const message of messages) {
      const row = document.createElement('div');
      row.className = 'row';
      const left = document.createElement('div');
      left.innerHTML = `<div class="label">${[message.platform, message.trigger_word].filter(Boolean).join(' · ') || 'message'}</div><div class="value">${message.message_body}</div>`;
      row.appendChild(left);

      const actions = document.createElement('div');
      const copyBtn = document.createElement('button');
      copyBtn.className = 'small secondary';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => copyToClipboard(message.message_body, copyBtn));
      actions.appendChild(copyBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'small secondary';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        await api(`/api/messages/${message.id}`, { method: 'DELETE' });
        content.messages = content.messages.filter((m) => m.id !== message.id);
        renderMessages(content.messages);
      });
      actions.appendChild(delBtn);

      row.appendChild(actions);
      list.appendChild(row);
    }
  }
}

// ---------- New Content Form (new.html) ----------

function initNewContentForm() {
  qs('new-content-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = qs('field-title').value;
    const platform = qs('field-platform').value;
    const publish_date = qs('field-publish-date').value;
    const source_url = qs('field-source-url').value;

    const content = await api('/api/content', {
      method: 'POST',
      body: JSON.stringify({ title, platform, publish_date, source_url }),
    });
    window.location.href = `/content?id=${content.id}`;
  });
}
