const APP_VERSION = 'v2026-10-07 10:11:42';

document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('app-version');
    if (el) el.textContent = APP_VERSION;
});
