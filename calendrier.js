/* ==========================================================================
   MINI CALENDRIER - Visualisation des inscriptions mensuelles
   ========================================================================== */

let miniCalendrierDate = new Date();
let miniCalendrierData = {};

function initMiniCalendrier() {
    const container = document.getElementById('mini-calendrier');
    if (!container) return;
    container.addEventListener('click', gererClicMiniCalendrier);
    renderMiniCalendrier();
    const waitUser = setInterval(() => {
        if (typeof currentUser !== 'undefined' && currentUser) {
            clearInterval(waitUser);
            renderMiniCalendrier();
        }
    }, 100);
    setTimeout(() => clearInterval(waitUser), 5000);
}

function gererClicMiniCalendrier(e) {
    if (e.target.classList.contains('cal-btn-prev')) {
        miniCalendrierDate.setMonth(miniCalendrierDate.getMonth() - 1);
        renderMiniCalendrier();
    } else if (e.target.classList.contains('cal-btn-next')) {
        miniCalendrierDate.setMonth(miniCalendrierDate.getMonth() + 1);
        renderMiniCalendrier();
    } else if (e.target.classList.contains('cal-btn-today')) {
        miniCalendrierDate = new Date();
        if (typeof dateAffichee !== 'undefined') {
            dateAffichee = new Date();
            dateAffichee.setHours(12, 0, 0, 0);
            allerADateAffichee();
        } else {
            renderMiniCalendrier();
        }
    } else {
        const dayEl = e.target.closest('.cal-day');
        if (dayEl && dayEl.dataset.year) {
            const y = Number(dayEl.dataset.year);
            const m = Number(dayEl.dataset.month);
            const d = Number(dayEl.dataset.day);
            if (typeof dateAffichee !== 'undefined') {
                dateAffichee = new Date(y, m, d, 12, 0, 0);
                allerADateAffichee();
            }
        }
    }
}

async function allerADateAffichee() {
    const tabPlanning = document.getElementById('tab-planning');
    if (tabPlanning) tabPlanning.click();
    if (typeof mettreAJourDateAffichee === 'function') mettreAJourDateAffichee();
    await Promise.all([
        (typeof chargerDonneesPlanning === 'function' ? chargerDonneesPlanning() : Promise.resolve()),
        (typeof chargerPresencesPlaneur === 'function' ? chargerPresencesPlaneur() : Promise.resolve()),
        (typeof chargerPresencesClub === 'function' ? chargerPresencesClub() : Promise.resolve()),
        (typeof chargerEvenementsJour === 'function' ? chargerEvenementsJour() : Promise.resolve())
    ]);
    miniCalendrierDate = new Date(dateAffichee.getFullYear(), dateAffichee.getMonth(), 1);
    await renderMiniCalendrier();
}

async function renderMiniCalendrier() {
    const container = document.getElementById('mini-calendrier');
    if (!container) return;
    const annee = miniCalendrierDate.getFullYear();
    const mois = miniCalendrierDate.getMonth();
    await chargerDonneesCalendrier(annee, mois);

    const debutMois = new Date(annee, mois, 1);
    const premierJour = (debutMois.getDay() + 6) % 7;
    const joursDansMois = new Date(annee, mois + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = (typeof dateAffichee !== 'undefined') ? new Date(dateAffichee.getFullYear(), dateAffichee.getMonth(), dateAffichee.getDate()) : null;

    const moisNom = debutMois.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    let html = '';
    html += `<div class="cal-header">`;
    html += `<button class="cal-btn-prev" type="button"><<</button>`;
    html += `<span class="cal-month">${moisNom}</span>`;
    html += `<button class="cal-btn-next" type="button">>></button>`;
    html += `</div>`;
    html += `<div class="cal-grid">`;
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(j => {
        html += `<div class="cal-weekday">${j}</div>`;
    });
    for (let i = 0; i < premierJour; i++) {
        html += `<div class="cal-day empty"></div>`;
    }
    for (let j = 1; j <= joursDansMois; j++) {
        const d = new Date(annee, mois, j);
        const iso = d.toISOString().split('T')[0];
        const info = miniCalendrierData[iso] || { has: false, hasUser: false };
        let cls = 'cal-day';
        if (info.has) cls += ' has-activity';
        if (info.hasUser) cls += ' user-activity';
        if (today.getTime() === d.getTime()) cls += ' today';
        if (selected && selected.getTime() === d.getTime()) cls += ' selected';
        html += `<div class="${cls}" data-year="${annee}" data-month="${mois}" data-day="${j}">`;
        html += `<span class="cal-day-number">${j}</span>`;
        if (info.has || info.hasUser) {
            html += `<span class="cal-dot"></span>`;
        }
        html += `</div>`;
    }
    html += `</div>`;
    html += `<div class="cal-footer"><button class="cal-btn-today" type="button">Aujourd'hui</button></div>`;
    container.innerHTML = html;
}

async function chargerDonneesCalendrier(annee, mois) {
    const debutMois = new Date(annee, mois, 1, 0, 0, 0, 0);
    const finMois = new Date(annee, mois + 1, 0, 23, 59, 59, 999);
    const debutStr = debutMois.toISOString().split('T')[0];
    const finStr = finMois.toISOString().split('T')[0];
    const userName = (typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '').toString().trim();
    const userPrenom = (typeof currentUser !== 'undefined' && currentUser ? currentUser.prenom : '') || '';
    const userNom = (typeof currentUser !== 'undefined' && currentUser ? currentUser.nom : '') || '';
    const userFullName = `${userPrenom} ${userNom}`.trim();
    const userId = (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null);

    miniCalendrierData = {};

    // Réservations (aéronefs F-BLIO, F-GASB, F-JVIO, etc.)
    try {
        const formulaResa = `AND(DATETIME_FORMAT({Date de début},'YYYY-MM-DD')<='${finStr}', DATETIME_FORMAT({Date de fin},'YYYY-MM-DD')>='${debutStr}')`;
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?filterByFormula=${encodeURIComponent(formulaResa)}&pageSize=100`;
        const res = await cachedFetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        (data.records || []).forEach(r => {
            const f = r.fields || {};
            const rStart = new Date(f['Date de début']);
            const rEnd = new Date(f['Date de fin']);
            const pilote = f['Pilote'];
            const pilotes = Array.isArray(pilote) ? pilote : (pilote ? [pilote] : []);
            rStart.setHours(0, 0, 0, 0);
            rEnd.setHours(0, 0, 0, 0);
            for (let t = rStart.getTime(); t <= rEnd.getTime(); t += 86400000) {
                const iso = new Date(t).toISOString().split('T')[0];
                const d = new Date(t);
                if (d < debutMois || d > finMois) continue;
                const info = miniCalendrierData[iso] || (miniCalendrierData[iso] = { has: false, hasUser: false });
                info.has = true;
                const isUser = pilotes.some(p => {
                    if (userId && p === userId) return true;
                    const ps = (p || '').toString().trim();
                    return ps && (correspondanceNom(ps, userName) || correspondanceNom(ps, userFullName));
                });
                if (isUser) info.hasUser = true;
            }
        });
    } catch (err) { console.error('Erreur calendrier Réservations:', err); }

    // Présences Planeur (Instructeurs, Élèves, Pilotes)
    try {
        const formulaPlaneur = `AND(DATETIME_FORMAT({Date},'YYYY-MM-DD')>='${debutStr}', DATETIME_FORMAT({Date},'YYYY-MM-DD')<='${finStr}')`;
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Planeur')}?filterByFormula=${encodeURIComponent(formulaPlaneur)}&pageSize=100`;
        const res = await cachedFetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        (data.records || []).forEach(r => {
            const f = r.fields || {};
            const d = f['Date'] ? new Date(f['Date'] + 'T00:00:00') : null;
            if (!d) return;
            if (d < debutMois || d > finMois) return;
            const iso = d.toISOString().split('T')[0];
            const nomField = f['Nom du pilote'];
            const noms = Array.isArray(nomField) ? nomField : (nomField ? [nomField] : []);
            const info = miniCalendrierData[iso] || (miniCalendrierData[iso] = { has: false, hasUser: false });
            info.has = true;
            const isUser = noms.some(n => {
                if (userId && n === userId) return true;
                const ns = (n || '').toString().trim();
                return ns && (correspondanceNom(ns, userName) || correspondanceNom(ns, userFullName));
            });
            if (isUser) info.hasUser = true;
        });
    } catch (err) { console.error('Erreur calendrier Présences Planeur:', err); }

    // Présences Club (Atelier Alain Bernage, Salle Ernest Meyer)
    try {
        const formulaClub = `AND(DATETIME_FORMAT({Date},'YYYY-MM-DD')>='${debutStr}', DATETIME_FORMAT({Date},'YYYY-MM-DD')<='${finStr}')`;
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Club')}?filterByFormula=${encodeURIComponent(formulaClub)}&pageSize=100`;
        const res = await cachedFetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur Airtable');
        (data.records || []).forEach(r => {
            const f = r.fields || {};
            const d = f['Date'] ? new Date(f['Date'] + 'T00:00:00') : null;
            if (!d) return;
            if (d < debutMois || d > finMois) return;
            const iso = d.toISOString().split('T')[0];
            const nomField = f['Nom du pilote'];
            const noms = Array.isArray(nomField) ? nomField : (nomField ? [nomField] : []);
            const info = miniCalendrierData[iso] || (miniCalendrierData[iso] = { has: false, hasUser: false });
            info.has = true;
            const isUser = noms.some(n => {
                if (userId && n === userId) return true;
                const ns = (n || '').toString().trim();
                return ns && (correspondanceNom(ns, userName) || correspondanceNom(ns, userFullName));
            });
            if (isUser) info.hasUser = true;
        });
    } catch (err) { console.error('Erreur calendrier Présences Club:', err); }
}

function rafraichirMiniCalendrier() {
    if (typeof dateAffichee === 'undefined') return;
    miniCalendrierDate = new Date(dateAffichee.getFullYear(), dateAffichee.getMonth(), 1);
    renderMiniCalendrier();
}

initMiniCalendrier();
