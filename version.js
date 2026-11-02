const APP_VERSION = 'v2026-11-02 11:10:30';

document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('app-version');
    if (el) el.textContent = APP_VERSION;
});
