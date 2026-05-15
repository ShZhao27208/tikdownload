document.addEventListener('DOMContentLoaded', () => {
  const folderInput = document.getElementById('folder');
  const quality = document.getElementById('quality');
  const btnSave = document.getElementById('btn-save');
  const status = document.getElementById('status');
  const activeArea = document.getElementById('active-blocks');
  const availableArea = document.getElementById('available-blocks');
  const preview = document.getElementById('preview');

  const BLOCK_LABELS = {
    caption: 'Title', date: 'Date', author: 'Author',
    vid: 'Video ID', index: 'Index', 'sep_': '_', 'sep-': '-'
  };
  const BLOCK_CLASSES = {
    caption: 'block-caption', date: 'block-date', author: 'block-author',
    vid: 'block-vid', index: 'block-index', 'sep_': 'block-separator', 'sep-': 'block-separator'
  };
  const PREVIEW_VALUES = {
    caption: 'This is a post title',
    date: '2025-05-15',
    author: 'username',
    vid: '7639241511754832808',
    index: '1',
    'sep_': '_',
    'sep-': '-'
  };

  let activeBlocks = [];

  // --- Render active blocks ---
  function renderActive() {
    activeArea.innerHTML = '';
    if (activeBlocks.length === 0) {
      activeArea.innerHTML = '<span style="color:#666;font-size:11px;">Click blocks below to add</span>';
    }
    activeBlocks.forEach((type, i) => {
      const el = document.createElement('span');
      el.className = `block ${BLOCK_CLASSES[type]}`;
      el.draggable = true;
      el.dataset.index = i;
      el.innerHTML = `${BLOCK_LABELS[type]} <span class="remove">&times;</span>`;

      el.querySelector('.remove').addEventListener('click', (e) => {
        e.stopPropagation();
        activeBlocks.splice(i, 1);
        renderActive();
        updatePreview();
      });

      // Drag reorder
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', i);
        el.style.opacity = '0.4';
      });
      el.addEventListener('dragend', () => el.style.opacity = '1');
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'));
        const to = i;
        if (from !== to) {
          const item = activeBlocks.splice(from, 1)[0];
          activeBlocks.splice(to, 0, item);
          renderActive();
          updatePreview();
        }
      });

      activeArea.appendChild(el);
    });
  }

  // --- Preview ---
  function updatePreview() {
    if (activeBlocks.length === 0) {
      preview.innerHTML = '<span>unknown_video.mp4</span>';
      return;
    }
    const parts = activeBlocks.map(type => {
      if (type === 'sep_') return '_';
      if (type === 'sep-') return '-';
      return PREVIEW_VALUES[type] || '';
    });
    // Join non-separator parts with nothing (separators are explicit)
    let result = '';
    for (let i = 0; i < parts.length; i++) {
      result += parts[i];
    }
    preview.innerHTML = `<span>${result}.mp4</span>`;
  }

  // --- Click to add block ---
  availableArea.querySelectorAll('.block').forEach(el => {
    el.addEventListener('click', () => {
      activeBlocks.push(el.dataset.type);
      renderActive();
      updatePreview();
    });
  });

  // --- Load settings ---
  chrome.storage.local.get(['folder', 'quality', 'filenameBlocks'], (data) => {
    folderInput.value = data.folder || 'TikDownload';
    quality.value = data.quality || 'highest';
    activeBlocks = data.filenameBlocks || ['caption', 'sep_', 'date', 'sep_', 'author'];
    renderActive();
    updatePreview();
  });

  // --- Save ---
  btnSave.addEventListener('click', () => {
    chrome.storage.local.set({
      folder: folderInput.value.trim() || 'TikDownload',
      quality: quality.value,
      filenameBlocks: activeBlocks
    }, () => {
      status.textContent = 'Saved!';
      setTimeout(() => status.textContent = '', 2000);
    });
  });
});
