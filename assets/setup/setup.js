const $ = id => document.getElementById(id);
let previous;
async function refresh() {
  try {
    const state = await window.setup.action('status');
    $('app-name').textContent = state.appName;
    if (state.granted === previous) return;
    previous = state.granted;
    $('badge').textContent = state.granted ? '✓ Granted' : 'Permission needed';
    $('badge').classList.toggle('granted', state.granted);
    $('finish').disabled = !state.granted;
    $('finish').textContent = state.granted ? 'Start Honyo' : 'Waiting for permission';
    $('hint').textContent = state.granted
      ? 'Permission granted. Choose a translation model in Settings, then start Honyo.'
      : 'Grant permission in macOS Settings. You can reopen this screen from the menu bar.';
    $('steps').hidden = state.granted;
    $('permission').hidden = state.granted;
  } catch {
    showError();
  }
}
function showError() {
  $('error').hidden = false;
  $('error').textContent =
    'Could not complete this action. Please try again, or open System Settings → Privacy & Security → Accessibility.';
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
