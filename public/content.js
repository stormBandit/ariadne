// ---------- Content Detail (content.html) ----------

async function initContentDetail() {
  const id = new URLSearchParams(window.location.search).get('id');
  const content = await api(`/api/content/${id}`);
  let editingLinkId = null;
  let editingTestId = null;
  initImageLightbox();
  initSyncButton();

  const tabChips = document.querySelectorAll('[data-tab]');
  const tabPanels = document.querySelectorAll('[data-tab-panel]');
  tabChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      tabChips.forEach((c) => c.classList.toggle('active', c === chip));
      tabPanels.forEach((panel) => {
        panel.style.display = panel.dataset.tabPanel === chip.dataset.tab ? '' : 'none';
      });
    });
  });

  qs('title').textContent = content.title;
  qs('status-badge').replaceWith(statusBadge(content.status));
  qs('header-date').textContent = formatDate(content.publish_date);

  if (content.video_type === 'short') {
    const shortBadge = qs('header-short-badge');
    shortBadge.classList.add('short');
    shortBadge.style.display = '';
  }

  // Prefer the stored thumbnail_url (kept in sync by the YouTube sync); fall
  // back to the YouTube CDN if it's missing, same maxres->hqdefault fallback
  // the dashboard table uses.
  const headerThumb = qs('header-thumb');
  if (content.thumbnail_url) {
    headerThumb.src = content.thumbnail_url;
  } else if (content.video_id) {
    headerThumb.src = `https://img.youtube.com/vi/${content.video_id}/maxresdefault.jpg`;
    headerThumb.addEventListener(
      'error',
      () => {
        headerThumb.onerror = null;
        headerThumb.src = `https://img.youtube.com/vi/${content.video_id}/hqdefault.jpg`;
      },
      { once: true }
    );
  }
  headerThumb.alt = content.title;
  headerThumb.addEventListener('click', () => window.openImageLightbox(headerThumb.src, content.title));

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

  qs('changelog-heading').appendChild(
    infoTip(
      "Ariadne automatically detects when your video's title or thumbnail changes during each sync and logs it here. Use this tab to see the history of every change and — once YouTube Analytics is connected — whether each change improved your CTR."
    )
  );

  renderLinks(content.links);
  renderMessages(content.messages);

  qs('add-link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = qs('link-type').value;
    const url = qs('link-url').value;
    const label = qs('link-label').value;
    const validationError = validateLinkUrl(type, url);
    if (validationError) {
      qs('link-form-status').textContent = validationError;
      return;
    }
    qs('link-form-status').textContent = '';
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

  renderKeywords(content.keywords);

  qs('add-keyword-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const keyword = qs('keyword-text').value;
    const scoreValue = qs('keyword-score').value;
    const volumeValue = qs('keyword-volume').value;
    const created = await api(`/api/content/${id}/keywords`, {
      method: 'POST',
      body: JSON.stringify({
        keyword,
        weighted_score: scoreValue ? Number(scoreValue) : null,
        search_volume: volumeValue || null,
      }),
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

      if (kw.search_volume) {
        const volume = document.createElement('span');
        volume.className = `volume volume-${kw.search_volume.toLowerCase()}`;
        volume.textContent = kw.search_volume;
        tag.appendChild(volume);
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

        const editStatusErrorMsg = document.createElement('div');
        editStatusErrorMsg.className = 'error-text';

        const editActions = document.createElement('div');
        editActions.className = 'test-card-actions';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'small';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', async () => {
          const variants = await readVariantRows(variantsContainer);
          const minVariants = MIN_VARIANTS[testType] ?? 2;
          if (variants.length < minVariants) {
            editStatusErrorMsg.textContent = `Add at least ${minVariants} variant(s).`;
            return;
          }
          const editShares = variants.map((v) => v.watch_time_share);
          if (editShares.some((s) => s !== null)) {
            const editTotal = editShares.reduce((sum, s) => sum + (s ?? 0), 0);
            if (Math.abs(editTotal - 100) > 0.1) {
              editStatusErrorMsg.textContent = 'Watch Time Share must sum to 100%';
              return;
            }
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
            editStatusErrorMsg.textContent = err.message;
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

        card.appendChild(editStatusErrorMsg);
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

      // Build Test Notes
      if (test.notes) {
        const notes = document.createElement('div');
        notes.className = 'notes';
        notes.textContent = test.notes;
        card.appendChild(notes);
      }

      // Build the test variants title list
      for (const variant of test.variants) {
        const row = document.createElement('div');
        row.className = 'test-variant';
        if (testType === 'thumbnail') {
          const img = document.createElement('img');
          img.className = 'variant-thumbnail';
          img.src = variant.value;
          img.addEventListener('click', () => window.openImageLightbox(variant.value, content.title));
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
      const minVariants = MIN_VARIANTS[testType] ?? 2;
      if (variants.length < minVariants) {
        statusMsg.textContent = `Add at least ${minVariants} variant(s).`;
        return;
      }
      const shares = variants.map((v) => v.watch_time_share);
      if (shares.some((s) => s !== null)) {
        const total = shares.reduce((sum, s) => sum + (s ?? 0), 0);
        if (Math.abs(total - 100) > 0.1) {
          statusMsg.textContent = 'Watch Time Share must sum to 100%';
          return;
        }
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
        // 'openinapp' is no longer offered on the Add-link form (content.html) — it's
        // kept here only so existing openinapp-type links can still be viewed/edited
        // without their type silently changing to whatever option happens to be first.
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

        const editError = document.createElement('div');
        editError.className = 'error-text';
        editError.style.marginTop = '4px';
        row.appendChild(editError);

        const editActions = document.createElement('div');
        editActions.style.display = 'flex';
        editActions.style.gap = '6px';
        editActions.style.marginTop = '6px';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'small';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', async () => {
          const validationError = validateLinkUrl(typeSelect.value, urlInput.value);
          if (validationError) {
            editError.textContent = validationError;
            return;
          }
          const updated = await api(`/api/links/${link.id}`, {
            method: 'PUT',
            body: JSON.stringify({ type: typeSelect.value, label: descInput.value, url: urlInput.value }),
          });
          const idx = content.links.findIndex((l) => l.id === link.id);
          content.links[idx] = updated;
          editingLinkId = null;
          renderLinks(content.links);
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
