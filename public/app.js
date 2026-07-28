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

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateRange(start, end) {
  if (!start && !end) return 'Dates not recorded';
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  return formatDate(start || end);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function addVariantRow(container, placeholder, inputType = 'text', initial = null) {
  const row = document.createElement('div');
  row.className = 'variant-row';
  // For file inputs, a browser can't be made to "pre-select" an existing
  // image, so we remember the original value here and fall back to it in
  // readVariantRows() if the user doesn't choose a replacement file.
  row.dataset.originalValue = (initial && initial.value) || '';

  if (inputType === 'file') {
    const preview = document.createElement('img');
    preview.className = 'variant-preview';
    if (initial && initial.value) {
      preview.src = initial.value;
      preview.style.display = '';
    } else {
      preview.style.display = 'none';
    }

    const valueInput = document.createElement('input');
    valueInput.type = 'file';
    valueInput.accept = 'image/*';
    valueInput.addEventListener('change', () => {
      const file = valueInput.files[0];
      if (!file) {
        preview.style.display = row.dataset.originalValue ? '' : 'none';
        if (row.dataset.originalValue) preview.src = row.dataset.originalValue;
        return;
      }
      fileToDataUrl(file).then((dataUrl) => {
        preview.src = dataUrl;
        preview.style.display = '';
      });
    });

    row.appendChild(preview);
    row.appendChild(valueInput);
  } else {
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.placeholder = placeholder;
    valueInput.value = (initial && initial.value) || '';
    row.appendChild(valueInput);
  }

  const shareInput = document.createElement('input');
  shareInput.type = 'number';
  shareInput.min = '0';
  shareInput.max = '100';
  shareInput.step = '0.1';
  shareInput.placeholder = 'Watch time share %';
  if (initial && initial.watch_time_share !== null && initial.watch_time_share !== undefined) {
    shareInput.value = initial.watch_time_share;
  }
  row.appendChild(shareInput);

  container.appendChild(row);
}

async function readVariantRows(container) {
  const rows = Array.from(container.querySelectorAll('.variant-row'));
  const variants = await Promise.all(
    rows.map(async (row) => {
      const valueInput = row.querySelector('input[type="text"], input[type="file"]');
      const shareInput = row.querySelector('input[type="number"]');
      const value =
        valueInput.type === 'file'
          ? valueInput.files[0]
            ? await fileToDataUrl(valueInput.files[0])
            : row.dataset.originalValue || ''
          : valueInput.value.trim();
      return {
        value,
        watch_time_share: shareInput.value ? Number(shareInput.value) : null,
      };
    })
  );
  return variants.filter((variant) => variant.value);
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
      const matchesTerm = !term || item.title.toLowerCase().includes(term) || item.video_id.toLowerCase().includes(term);
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
      card.href = `/content?id=${item.video_id}`;

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
      const videoId = item.video_id;
      if (videoId) {
        const thumb = document.createElement('img');
        thumb.className = 'thumbnail';
        thumb.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        thumb.alt = item.title;
        thumb.loading = 'lazy';
        card.appendChild(thumb);
      }

      // Go To Studio / Go To Watch buttons
      if (videoId || item.source_url) {
        const linkRow = document.createElement('div');
        linkRow.style.display = 'flex';
        linkRow.style.gap = '6px';
        linkRow.style.margin = '-4px 0 10px';

        if (videoId) {
          const studioLink = document.createElement('a');
          studioLink.href = `https://studio.youtube.com/video/${videoId}/edit`;
          studioLink.target = '_blank';
          studioLink.rel = 'noopener';
          studioLink.className = 'button small secondary';
          studioLink.textContent = 'Go To Studio ↗';
          linkRow.appendChild(studioLink);
        }

        if (item.source_url) {
          const watchLink = document.createElement('a');
          watchLink.href = item.source_url;
          watchLink.target = '_blank';
          watchLink.rel = 'noopener';
          watchLink.className = 'button small secondary';
          watchLink.textContent = 'Go To Watch ↗';
          linkRow.appendChild(watchLink);
        }

        card.appendChild(linkRow);
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
  let editingTestId = null;

  qs('title').textContent = content.title;
  qs('status-badge').replaceWith(statusBadge(content.status));

  if (content.video_id) {
    const studioLink = qs('studio-link');
    studioLink.href = `https://studio.youtube.com/video/${content.video_id}/edit`;
    studioLink.style.display = '';
  }
  if (content.source_url) {
    const watchLink = qs('watch-link');
    watchLink.href = content.source_url;
    watchLink.style.display = '';
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

  renderKeywords(content.keywords);

  qs('add-keyword-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const keyword = qs('keyword-text').value;
    const scoreValue = qs('keyword-score').value;
    const created = await api(`/api/content/${id}/keywords`, {
      method: 'POST',
      body: JSON.stringify({ keyword, weighted_score: scoreValue ? Number(scoreValue) : null }),
    });
    content.keywords.push(created);
    renderKeywords(content.keywords);
    e.target.reset();
  });

  function renderKeywords(keywords) {
    const list = qs('keyword-list');
    list.innerHTML = '';
    if (keywords.length === 0) {
      list.innerHTML = '<div class="empty-state">No keywords yet.</div>';
      return;
    }
    const tagList = document.createElement('div');
    tagList.className = 'tag-list';
    for (const kw of keywords) {
      const tag = document.createElement('div');
      tag.className = 'tag';

      const text = document.createElement('span');
      text.textContent = kw.keyword;
      tag.appendChild(text);

      if (kw.weighted_score !== null && kw.weighted_score !== undefined) {
        const score = document.createElement('span');
        score.className = 'score';
        score.textContent = kw.weighted_score;
        tag.appendChild(score);
      }

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', async () => {
        await api(`/api/keywords/${kw.id}`, { method: 'DELETE' });
        content.keywords = content.keywords.filter((k) => k.id !== kw.id);
        renderKeywords(content.keywords);
      });
      tag.appendChild(delBtn);

      tagList.appendChild(tag);
    }
    list.appendChild(tagList);
  }

  function variantConfigFor(testType) {
    return testType === 'thumbnail'
      ? { placeholder: 'Thumbnail image', inputType: 'file' }
      : { placeholder: 'Title text', inputType: 'text' };
  }

  function renderTests(prefix, testType) {
    const list = qs(`${prefix}-list`);
    const tests = content.tests.filter((t) => t.test_type === testType);
    list.innerHTML = '';
    if (tests.length === 0) {
      list.innerHTML = '<div class="empty-state">No tests yet.</div>';
      return;
    }
    const { placeholder, inputType } = variantConfigFor(testType);

    for (const test of tests) {
      const card = document.createElement('div');
      card.className = 'test-card';

      if (editingTestId === test.id) {
        const variantsContainer = document.createElement('div');
        variantsContainer.className = 'variant-rows';
        for (const variant of test.variants) {
          addVariantRow(variantsContainer, placeholder, inputType, variant);
        }
        card.appendChild(variantsContainer);

        const addVariantBtn = document.createElement('button');
        addVariantBtn.type = 'button';
        addVariantBtn.className = 'small secondary';
        addVariantBtn.style.marginTop = '6px';
        addVariantBtn.textContent = '+ Add variant';
        addVariantBtn.addEventListener('click', () => {
          addVariantRow(variantsContainer, placeholder, inputType);
        });
        card.appendChild(addVariantBtn);

        const fieldsRow = document.createElement('div');
        fieldsRow.style.display = 'flex';
        fieldsRow.style.gap = '6px';
        fieldsRow.style.marginTop = '8px';

        const startInput = document.createElement('input');
        startInput.type = 'date';
        startInput.title = 'Start date (optional)';
        startInput.value = test.start_date || '';
        fieldsRow.appendChild(startInput);

        const endInput = document.createElement('input');
        endInput.type = 'date';
        endInput.title = 'End date (optional)';
        endInput.value = test.end_date || '';
        fieldsRow.appendChild(endInput);

        const statusSelect = document.createElement('select');
        for (const s of ['conclusive', 'inconclusive']) {
          const opt = document.createElement('option');
          opt.value = s;
          opt.textContent = s === 'inconclusive' ? 'Inconclusive (not enough impressions)' : 'Conclusive';
          opt.selected = s === test.status;
          statusSelect.appendChild(opt);
        }
        fieldsRow.appendChild(statusSelect);
        card.appendChild(fieldsRow);

        const notesInput = document.createElement('textarea');
        notesInput.rows = 2;
        notesInput.placeholder = 'Notes';
        notesInput.style.marginTop = '8px';
        notesInput.style.width = '100%';
        notesInput.value = test.notes || '';
        card.appendChild(notesInput);

        const editStatusMsg = document.createElement('div');
        editStatusMsg.className = 'notes';

        const editActions = document.createElement('div');
        editActions.className = 'test-card-actions';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'small';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', async () => {
          const variants = await readVariantRows(variantsContainer);
          if (variants.length < 2) {
            editStatusMsg.textContent = 'Add at least 2 variants.';
            return;
          }
          try {
            const updated = await api(`/api/tests/${test.id}`, {
              method: 'PUT',
              body: JSON.stringify({
                status: statusSelect.value,
                start_date: startInput.value || null,
                end_date: endInput.value || null,
                notes: notesInput.value,
                variants,
              }),
            });
            const idx = content.tests.findIndex((t) => t.id === test.id);
            content.tests[idx] = updated;
            editingTestId = null;
            renderTests(prefix, testType);
          } catch (err) {
            editStatusMsg.textContent = err.message;
          }
        });
        editActions.appendChild(saveBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'small secondary';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => {
          editingTestId = null;
          renderTests(prefix, testType);
        });
        editActions.appendChild(cancelBtn);

        card.appendChild(editStatusMsg);
        card.appendChild(editActions);

        list.appendChild(card);
        continue;
      }

      const top = document.createElement('div');
      top.className = 'test-card-top';
      const dates = document.createElement('span');
      dates.className = 'test-card-dates';
      dates.textContent = formatDateRange(test.start_date, test.end_date);
      top.appendChild(dates);
      const badge = document.createElement('span');
      badge.className = `badge ${test.status === 'conclusive' ? 'live' : 'draft'}`;
      badge.textContent = test.status;
      top.appendChild(badge);
      card.appendChild(top);

      for (const variant of test.variants) {
        const row = document.createElement('div');
        row.className = 'test-variant';
        if (testType === 'thumbnail') {
          const img = document.createElement('img');
          img.className = 'variant-thumbnail';
          img.src = variant.value;
          row.appendChild(img);
        } else {
          const value = document.createElement('span');
          value.textContent = variant.value;
          row.appendChild(value);
        }
        const share = document.createElement('span');
        share.className = 'share';
        share.textContent =
          variant.watch_time_share !== null && variant.watch_time_share !== undefined
            ? `${variant.watch_time_share}%`
            : '—';
        row.appendChild(share);
        card.appendChild(row);
      }

      if (test.notes) {
        const notes = document.createElement('div');
        notes.className = 'notes';
        notes.textContent = test.notes;
        card.appendChild(notes);
      }

      const actions = document.createElement('div');
      actions.className = 'test-card-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'small secondary';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        editingTestId = test.id;
        renderTests(prefix, testType);
      });
      actions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'small secondary';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        const confirmed = await confirmModal("Delete this test? This can't be undone.");
        if (!confirmed) return;
        await api(`/api/tests/${test.id}`, { method: 'DELETE' });
        content.tests = content.tests.filter((t) => t.id !== test.id);
        renderTests(prefix, testType);
      });
      actions.appendChild(delBtn);
      card.appendChild(actions);

      list.appendChild(card);
    }
  }

  function setupTestSection(prefix, testType, variantPlaceholder, variantInputType = 'text') {
    const variantsContainer = qs(`${prefix}-variants`);
    const form = qs(`add-${prefix}-form`);
    const statusMsg = qs(`${prefix}-form-status`);

    function resetVariantRows() {
      variantsContainer.innerHTML = '';
      addVariantRow(variantsContainer, variantPlaceholder, variantInputType);
    }
    resetVariantRows();

    qs(`${prefix}-add-variant`).addEventListener('click', () => {
      addVariantRow(variantsContainer, variantPlaceholder, variantInputType);
    });

    renderTests(prefix, testType);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      statusMsg.textContent = '';
      const variants = await readVariantRows(variantsContainer);
      if (variants.length < 2) {
        statusMsg.textContent = 'Add at least 2 variants.';
        return;
      }
      try {
        const test = await api(`/api/content/${id}/tests`, {
          method: 'POST',
          body: JSON.stringify({
            test_type: testType,
            status: qs(`${prefix}-status`).value,
            start_date: qs(`${prefix}-start`).value || null,
            end_date: qs(`${prefix}-end`).value || null,
            notes: qs(`${prefix}-notes`).value,
            variants,
          }),
        });
        content.tests.push(test);
        renderTests(prefix, testType);
        e.target.reset();
        resetVariantRows();
      } catch (err) {
        statusMsg.textContent = err.message;
      }
    });
  }

  setupTestSection('title-test', 'title', 'Title text');
  setupTestSection('thumbnail-test', 'thumbnail', 'Thumbnail image', 'file');

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
      body: JSON.stringify({ title, video_type, publish_date, source_url }),
    });
    window.location.href = `/content?id=${content.video_id}`;
  });
}
