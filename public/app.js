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

function confirmModal(message) {
  return new Promise((resolve) => {
    const overlay = qs('confirm-modal');
    qs('confirm-modal-message').textContent = message;
    overlay.style.display = 'flex';

    const confirmBtn = qs('confirm-modal-confirm');
    const cancelBtn = qs('confirm-modal-cancel');

    function cleanup(result) {
      overlay.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onConfirm() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function statusBadge(status) {
  const span = document.createElement('span');
  span.className = `badge ${status}`;
  span.textContent = status;
  return span;
}

function youtubeVideoId(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.slice(1);
    if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.replace('/shorts/', '');
    return parsed.searchParams.get('v');
  } catch {
    return null;
  }
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------- Dashboard (index.html) ----------

async function initDashboard() {
  const list = qs('content-list');
  const search = qs('search');
  const typeChips = document.querySelectorAll('[data-type-filter]');

  let items = await api('/api/content');
  let typeFilter = 'videos';

  function render() {
    const term = search.value.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const matchesTerm = !term || item.title.toLowerCase().includes(term);
      const matchesType = typeFilter === 'videos' ? item.video_type !== 'short' : item.video_type === 'short';
      return matchesTerm && matchesType;
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
      const wrapper = document.createElement('div');

      const card = document.createElement('a');
      card.className = 'card';
      card.href = `/content?id=${item.id}`;

      // Title
      const top = document.createElement('div');
      top.className = 'card-top';
      const title = document.createElement('h3');
      title.textContent = item.title;
      top.appendChild(title);
      top.appendChild(statusBadge(item.status));
      card.appendChild(top);

      // Published Date
      const publishedDate = document.createElement('div');
      publishedDate.className = 'pub-date';
      publishedDate.textContent = formatDate(item.publish_date);
      card.appendChild(publishedDate);

      // Thumbnail
      const videoId = item.platform === 'youtube' ? youtubeVideoId(item.source_url) : null;
      if (videoId) {
        const thumb = document.createElement('img');
        thumb.className = 'thumbnail';
        thumb.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        thumb.alt = item.title;
        thumb.loading = 'lazy';
        card.appendChild(thumb);
      }

      // Watch on YouTube Link
      if (item.source_url) {
        const sourceLink = document.createElement('a');
        sourceLink.href = item.source_url;
        sourceLink.target = '_blank';
        sourceLink.rel = 'noopener';
        sourceLink.textContent = 'Watch on YouTube ↗';
        sourceLink.style.display = 'inline-block';
        sourceLink.style.margin = '-4px 0 10px';
        sourceLink.style.fontSize = '13px';
        card.appendChild(sourceLink);
      }

      wrapper.appendChild(card);
      list.appendChild(wrapper);
    }
  }

  search.addEventListener('input', render);
  typeChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      typeChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      typeFilter = chip.dataset.typeFilter;
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
      const parts = [];
      if (result.inserted > 0) parts.push(`${result.inserted} new video${result.inserted === 1 ? '' : 's'} added`);
      if (result.reclassified > 0) parts.push(`${result.reclassified} reclassified`);
      syncStatus.textContent = parts.length > 0 ? parts.join(', ') + '.' : 'No new videos.';
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
  let editingLinkId = null;

  qs('title').textContent = content.title;
  qs('platform').textContent = content.platform;
  qs('status-badge').replaceWith(statusBadge(content.status));
  if (content.source_url) {
    qs('source-url').href = content.source_url;
    qs('source-url').textContent = content.source_url;
  }

  renderLinks(content.links);
  renderMessages(content.messages);
  updateOpenInAppUI();

  function hasOpenInAppLink() {
    return content.links.some((link) => link.type === 'openinapp');
  }

  function updateOpenInAppUI() {
    const exists = hasOpenInAppLink();
    qs('generate-openinapp-link').style.display = exists ? 'none' : '';
    qs('link-type').querySelector('option[value="openinapp"]').disabled = exists;
    if (exists && qs('link-type').value === 'openinapp') {
      qs('link-type').value = 'creatorurls';
    }
  }

  qs('add-link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = qs('link-type').value;
    const url = qs('link-url').value;
    const label = qs('link-label').value;
    if (type === 'openinapp' && hasOpenInAppLink()) {
      qs('generate-openinapp-status').textContent = 'An OpenInApp link already exists for this content.';
      return;
    }
    const link = await api(`/api/content/${id}/links`, {
      method: 'POST',
      body: JSON.stringify({ type, url, label }),
    });
    content.links.push(link);
    renderLinks(content.links);
    updateOpenInAppUI();
    e.target.reset();
  });

  qs('generate-openinapp-link').addEventListener('click', async () => {
    const button = qs('generate-openinapp-link');
    const status = qs('generate-openinapp-status');
    if (hasOpenInAppLink()) {
      status.textContent = 'An OpenInApp link already exists for this content.';
      return;
    }
    if (!content.source_url) {
      status.textContent = 'No source URL to generate a link from.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Generating...';
    status.textContent = '';
    try {
      const { url } = await api('/api/openinapp', {
        method: 'POST',
        body: JSON.stringify({ url: content.source_url }),
      });
      qs('link-type').value = 'openinapp';
      qs('link-url').value = url;
      qs('add-link-form').requestSubmit();
    } catch (err) {
      status.textContent = `Generation failed: ${err.message}`;
    } finally {
      button.disabled = false;
      button.textContent = 'Generate OpenInApp Link';
    }
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

      if (editingLinkId === link.id) {
        row.style.flexDirection = 'column';
        row.style.alignItems = 'stretch';

        const editFields = document.createElement('div');
        editFields.style.display = 'flex';
        editFields.style.gap = '6px';

        const typeSelect = document.createElement('select');
        for (const type of ['openinapp', 'creatorurls', 'affiliate', 'other']) {
          const opt = document.createElement('option');
          opt.value = type;
          opt.textContent = type;
          opt.selected = type === link.type;
          typeSelect.appendChild(opt);
        }
        editFields.appendChild(typeSelect);

        const descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.placeholder = 'Description (optional)';
        descInput.value = link.label || '';
        editFields.appendChild(descInput);

        const urlInput = document.createElement('input');
        urlInput.type = 'url';
        urlInput.required = true;
        urlInput.style.flex = '1';
        urlInput.value = link.url;
        editFields.appendChild(urlInput);

        row.appendChild(editFields);

        const editActions = document.createElement('div');
        editActions.style.display = 'flex';
        editActions.style.gap = '6px';
        editActions.style.marginTop = '6px';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'small';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', async () => {
          const updated = await api(`/api/links/${link.id}`, {
            method: 'PUT',
            body: JSON.stringify({ type: typeSelect.value, label: descInput.value, url: urlInput.value }),
          });
          const idx = content.links.findIndex((l) => l.id === link.id);
          content.links[idx] = updated;
          editingLinkId = null;
          renderLinks(content.links);
          updateOpenInAppUI();
        });
        editActions.appendChild(saveBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'small secondary';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => {
          editingLinkId = null;
          renderLinks(content.links);
        });
        editActions.appendChild(cancelBtn);

        row.appendChild(editActions);
        list.appendChild(row);
        continue;
      }

      const left = document.createElement('div');
      left.innerHTML = `<div class="label">${link.type}</div><div class="value">${link.url}</div>${link.label ? `<div class="description">${link.label}</div>` : ''}`;
      row.appendChild(left);

      const actions = document.createElement('div');
      const copyBtn = document.createElement('button');
      copyBtn.className = 'small secondary';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => copyToClipboard(link.url, copyBtn));
      actions.appendChild(copyBtn);

      const editBtn = document.createElement('button');
      editBtn.className = 'small secondary';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        editingLinkId = link.id;
        renderLinks(content.links);
      });
      actions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'small secondary';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        const confirmed = await confirmModal(`Delete this ${link.type} link? This can't be undone.`);
        if (!confirmed) return;
        await api(`/api/links/${link.id}`, { method: 'DELETE' });
        content.links = content.links.filter((l) => l.id !== link.id);
        renderLinks(content.links);
        updateOpenInAppUI();
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
    const video_type = qs('field-video-type').value;
    const publish_date = qs('field-publish-date').value;
    const source_url = qs('field-source-url').value;

    const content = await api('/api/content', {
      method: 'POST',
      body: JSON.stringify({ title, platform: 'youtube', video_type, publish_date, source_url }),
    });
    window.location.href = `/content?id=${content.id}`;
  });
}
