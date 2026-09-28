const APP_VERSION = 'v2026-09-28 11:10:11';

document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('app-version');
    if (el) el.textContent = APP_VERSION;
});
