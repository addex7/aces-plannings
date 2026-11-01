const APP_VERSION = 'v2026-11-01 11:42:32';

document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('app-version');
    if (el) el.textContent = APP_VERSION;
});
