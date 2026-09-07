const $ = id => document.getElementById(id);
let previous;
async function refresh() {
  try {
    const state = await window.setup.action('status');
    $('app-name').textContent = state.appName;
    if (state.granted === previous) return;
    previous = state.granted;
    $('badge').textContent = state.granted ? '✓ 許可済み' : '許可が必要';
    $('badge').classList.toggle('granted', state.granted);
    $('finish').disabled = !state.granted;
    $('finish').textContent = state.granted ? 'Honyoを使い始める' : '許可を待っています';
    $('hint').textContent = state.granted
      ? '許可を確認できました。翻訳サービスの設定が済んだら、開始してください。'
      : 'macOSの設定で許可してください。この画面を閉じても、メニューバーから再開できます。';
    $('steps').hidden = state.granted;
    $('permission').hidden = state.granted;
  } catch {
    showError();
  }
}
function showError() {
  $('error').hidden = false;
  $('error').textContent =
    '操作を完了できませんでした。もう一度お試しください。設定が開かない場合は、システム設定 → プライバシーとセキュリティ → アクセシビリティを開いてください。';
}
for (const action of ['permission', 'reveal', 'restart', 'settings', 'finish']) {
  $(action).addEventListener('click', async () => {
    $('error').hidden = true;
    try {
      const result = await window.setup.action(action);
      if (action === 'finish' && result === false) await refresh();
    } catch {
      showError();
    }
  });
}
if (!navigator.userAgent.includes('Mac')) $('shortcut').textContent = 'Ctrl+C → Ctrl+C';
window.addEventListener('focus', refresh);
const timer = setInterval(refresh, 1000);
window.addEventListener('beforeunload', () => clearInterval(timer));
void refresh();
