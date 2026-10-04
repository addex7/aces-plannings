const APP_VERSION = 'v2026-10-04 15:45:23';

document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('app-version');
    if (el) el.textContent = APP_VERSION;
});
