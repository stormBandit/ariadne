// ---------- Dashboard (index.html) ----------

async function initDashboard() {
  const tableBody = qs('content-table-body');
  const table = qs('content-table');
  const empty = qs('content-empty');
  const search = qs('search');
  const typeChips = document.querySelectorAll('[data-type-filter]');

  // Wrap the table so it scrolls horizontally on narrow viewports instead of
  // squeezing columns unreadably — see PLAN.md's "UI Revamp — Follow-up:
  // Responsive behaviour" (this is a desktop-first tool; horizontal scroll
  // on mobile is an accepted tradeoff, not something worth reflowing to cards).
  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'table-scroll';
  table.parentNode.insertBefore(tableWrapper, table);
  tableWrapper.appendChild(table);

  let items = await api('/api/content');
  let typeFilter = 'videos';

  function buildRow(item) {
    const tr = document.createElement('tr');
    tr.className = 'content-row';
    tr.addEventListener('click', () => {
      window.location.href = `/content?id=${item.video_id}`;
    });

    const videoId = item.video_id;

    // Thumbnail — fixed 16:9 box with object-fit: cover. maxresdefault isn't
    // generated for every video, so fall back to hqdefault (always
    // available) if it 404s.
    const thumbTd = document.createElement('td');
    thumbTd.className = 'row-thumb';
    if (videoId) {
      const thumb = document.createElement('img');
      thumb.src = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      thumb.alt = item.title;
      thumb.loading = 'lazy';
      thumb.addEventListener(
        'error',
        () => {
          thumb.onerror = null;
          thumb.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        },
        { once: true }
      );
      thumbTd.appendChild(thumb);
    }
    tr.appendChild(thumbTd);

    // Status badge + title + publish date
    const titleTd = document.createElement('td');
    const badgeRow = document.createElement('div');
    badgeRow.className = 'row-badges';
    badgeRow.appendChild(statusBadge(item.status));
    titleTd.appendChild(badgeRow);
    const titleDiv = document.createElement('div');
    titleDiv.className = 'row-title';
    titleDiv.textContent = item.title;
    titleTd.appendChild(titleDiv);
    const dateDiv = document.createElement('div');
    dateDiv.className = 'row-date';
    dateDiv.textContent = formatDate(item.publish_date);
    titleTd.appendChild(dateDiv);
    tr.appendChild(titleTd);

    // Test status (title / thumbnail)
    const testTd = document.createElement('td');
    testTd.appendChild(testBadges(item));
    tr.appendChild(testTd);

    return tr;
  }

  function render() {
    const term = search.value.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const matchesTerm = !term || item.title.toLowerCase().includes(term) || item.video_id.toLowerCase().includes(term);
      const matchesType = typeFilter === 'videos' ? item.video_type !== 'short' : item.video_type === 'short';
      return matchesTerm && matchesType;
    });

    tableBody.innerHTML = '';
    if (filtered.length === 0) {
      table.style.display = 'none';
      empty.style.display = '';
      empty.textContent = items.length === 0 ? 'No content yet — add your first video.' : 'No content matches your filters.';
      return;
    }
    table.style.display = '';
    empty.style.display = 'none';

    for (const item of filtered) {
      tableBody.appendChild(buildRow(item));
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

  const syncStatus = qs('sync-status');
  initSyncButton(async (result, err) => {
    if (err) {
      syncStatus.textContent = `Sync failed: ${err.message}`;
      return;
    }
    const parts = [];
    if (result.inserted > 0) parts.push(`${result.inserted} new video${result.inserted === 1 ? '' : 's'} added`);
    if (result.reclassified > 0) parts.push(`${result.reclassified} reclassified`);
    syncStatus.textContent = parts.length > 0 ? parts.join(', ') + '.' : 'No new videos.';
    items = await api('/api/content');
    render();
  });
}
