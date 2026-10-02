// Функция для отображения списка неактивных вкладок при открытии popup
async function loadInactiveTabs() {
  const tabsListDiv = document.getElementById('tabsList');
  const discardBtn = document.getElementById('discardBtn');
  
  // Получаем все вкладки текущего окна
  const tabs = await chrome.tabs.query({ currentWindow: true });
  
  // Фильтруем: оставляем только неактивные и еще не выгруженные
  const inactiveTabs = tabs.filter(tab => !tab.active && !tab.discarded);
  
  if (inactiveTabs.length === 0) {
    tabsListDiv.innerHTML = '<div style="color: #888; text-align: center; padding: 10px;">Нет вкладок для выгрузки</div>';
    discardBtn.disabled = true;
    discardBtn.style.backgroundColor = '#ccc';
    discardBtn.style.cursor = 'default';
    return;
  }
  
  // Формируем HTML-список названий вкладок
  let html = '';
  for (let tab of inactiveTabs) {
    // Используем title вкладки или URL, если название еще не подгрузилось
    const title = tab.title || tab.url;
    html += `<div class="tab-item" title="${title}">• ${title}</div>`;
  }
  
  tabsListDiv.innerHTML = html;
}

// Запускаем сканирование сразу при открытии окна
document.addEventListener('DOMContentLoaded', loadInactiveTabs);

// Логика нажатия на кнопку выгрузки
document.getElementById('discardBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  const tabsListDiv = document.getElementById('tabsList');
  const discardBtn = document.getElementById('discardBtn');
  
  statusDiv.innerText = "Выгрузка...";
  discardBtn.disabled = true;

  const tabs = await chrome.tabs.query({ currentWindow: true });
  let successCount = 0;
  let failCount = 0;

  for (let tab of tabs) {
    if (!tab.active && !tab.discarded) {
      try {
        await chrome.tabs.discard(tab.id);
        successCount++;
      } catch (e) {
        failCount++;
        console.log(`Не удалось выгрузить вкладку ${tab.id}:`, e);
      }
    }
  }

  // Обновляем интерфейс после выгрузки
  tabsListDiv.innerHTML = '<div style="color: #2e7d32; text-align: center; padding: 10px;">Память успешно очищена!</div>';
  statusDiv.innerText = `✅ Выгружено: ${successCount} | ❌ Ошибок: ${failCount}`;
  discardBtn.style.display = 'none'; // Скрываем кнопку после выполнения
});