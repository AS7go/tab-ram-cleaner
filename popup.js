// Ключ для хранения списка отмеченных страниц в chrome.storage
const STORAGE_KEY = 'protectedPages';

// Кэш в памяти — решает race condition при быстрых кликах
let protectedCache = null;

// Формируем ключ страницы:
//  - для обычных сайтов: origin + pathname + query, БЕЗ hash
//  - для YouTube (/watch): только origin + pathname + ?v=ID
//  - для служебных страниц (chrome://, about:, file:// и т.п.) — null
function getPageKey(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.origin === 'null') return null;

    // Спецобработка YouTube: ключ = только ID видео
    const host = u.hostname.replace(/^www\./, '');
    if ((host === 'youtube.com' || host === 'm.youtube.com') && u.pathname === '/watch') {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/watch?v=${v}`;
    }

    // Всё остальное: origin + pathname + query, без hash
    return u.origin + u.pathname + u.search;
  } catch {
    return null;
  }
}

// Можно ли выгрузить вкладку (не активна, не выгружена, не отмечена, не служебная)
function isDiscardable(tab, protectedPages) {
  if (tab.active || tab.discarded) return false;
  const key = getPageKey(tab.url);
  if (key === null) return false;
  return !protectedPages.has(key);
}

// Загружаем множество отмеченных ключей из хранилища (с кэшем)
async function getProtectedPages() {
  if (protectedCache !== null) return protectedCache;
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    protectedCache = new Set(data[STORAGE_KEY] || []);
  } catch (e) {
    console.error('Не удалось прочитать storage:', e);
    protectedCache = new Set();
  }
  return protectedCache;
}

// Сохраняем множество отмеченных ключей в хранилище
async function saveProtectedPages(set) {
  protectedCache = set;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: Array.from(set) });
  } catch (e) {
    console.error('Не удалось записать в storage:', e);
  }
}

// Экранирование HTML
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Отображение списка вкладок
async function loadInactiveTabs() {
  const tabsListDiv = document.getElementById('tabsList');
  const discardBtn = document.getElementById('discardBtn');

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const protectedPages = await getProtectedPages();

  // Показываем все вкладки, кроме уже выгруженных.
  // Порядок сохраняем как в браузере — без сортировки.
  const targetTabs = tabs.filter(tab => !tab.discarded);

  if (targetTabs.length === 0) {
    tabsListDiv.innerHTML = '<div style="color: #888; text-align: center; padding: 10px;">Нет вкладок для отображения</div>';
    discardBtn.disabled = true;
    return;
  }

  let html = '';
  let discardableCount = 0;

  for (const tab of targetTabs) {
    const key = getPageKey(tab.url);
    const isActive = tab.active;
    const isProtected = !isActive && key !== null && protectedPages.has(key);
    const canBeProtected = !isActive && key !== null;

    if (isDiscardable(tab, protectedPages)) discardableCount++;

    const title = tab.title || tab.url || 'Без названия';
    const safeTitle = escapeHtml(title);
    const safeKey = escapeHtml(key || '');

    const titleClass = isActive ? 'tab-title active'
                     : isProtected ? 'tab-title protected'
                     : canBeProtected ? 'tab-title'
                     : 'tab-title disabled';

    const hint = isActive ? 'Активная вкладка — не выгружается'
               : canBeProtected ? 'Не выгружать эту вкладку'
               : 'Служебная страница — не выгружается';

    const bullet = isActive ? '▶' : '•';

    html += `
      <div class="tab-item">
        <input type="checkbox" data-key="${safeKey}"
               ${isProtected ? 'checked' : ''}
               ${canBeProtected ? '' : 'disabled'}
               title="${hint}"
               aria-label="${hint}">
        <span class="${titleClass}" title="${safeTitle}">${bullet} ${safeTitle}</span>
      </div>`;
  }

  tabsListDiv.innerHTML = html;
  discardBtn.disabled = (discardableCount === 0);

  tabsListDiv.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach(cb => {
    cb.addEventListener('change', onCheckboxChange);
  });
}

// Обработчик переключения чекбокса
async function onCheckboxChange(event) {
  const cb = event.target;
  const key = cb.dataset.key;
  if (!key) return;

  const protectedPages = await getProtectedPages();

  if (cb.checked) {
    protectedPages.add(key);
  } else {
    protectedPages.delete(key);
  }

  await saveProtectedPages(protectedPages);

  const titleSpan = cb.nextElementSibling;
  if (titleSpan) {
    titleSpan.classList.toggle('protected', cb.checked);
  }

  // Пересчитываем, есть ли что выгружать
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const discardBtn = document.getElementById('discardBtn');
  const hasDiscardable = tabs.some(tab => isDiscardable(tab, protectedPages));
  discardBtn.disabled = !hasDiscardable;
}

// Запускаем при открытии окна
document.addEventListener('DOMContentLoaded', loadInactiveTabs);

// Обработчик кнопки выгрузки
document.getElementById('discardBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  const tabsListDiv = document.getElementById('tabsList');
  const discardBtn = document.getElementById('discardBtn');

  statusDiv.innerText = 'Выгрузка...';
  discardBtn.disabled = true;

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const protectedPages = await getProtectedPages();

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (const tab of tabs) {
    if (tab.active || tab.discarded) continue;

    const key = getPageKey(tab.url);

    // Отмеченные — пропускаем
    if (key !== null && protectedPages.has(key)) {
      skippedCount++;
      continue;
    }

    // Служебные страницы discard не поддерживает — пропускаем
    if (key === null) {
      skippedCount++;
      continue;
    }

    try {
      await chrome.tabs.discard(tab.id);
      successCount++;
    } catch (e) {
      failCount++;
      console.log(`Не удалось выгрузить вкладку ${tab.id} (${tab.url}):`, e);
    }
  }

  tabsListDiv.innerHTML = '<div style="color: #2e7d32; text-align: center; padding: 10px;">Память очищена!</div>';
  statusDiv.innerText = `✅ Выгружено: ${successCount} | 🛡 Пропущено: ${skippedCount}`;
  if (failCount > 0) statusDiv.innerText += ` | ❌ Ошибок: ${failCount}`;

  discardBtn.style.display = 'none';
});