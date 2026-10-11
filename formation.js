/* ==========================================================================
   FORMATION - SUIVI PEDAGOGIQUE ELEVE / INSTRUCTEUR
   Catalogue de formations (lecons + items), suivi par eleve (progression,
   minimas, documentation demandee), seances de vol debriefees et signees.
   ========================================================================== */

const TABLE_FORMATIONS = 'Formations';
const TABLE_FORMATIONS_SUIVIS = 'Formations Suivis';
const TABLE_FORMATIONS_SEANCES = 'Formations Séances';
const TABLE_CARNET_PILOTES = 'Carnet de route Pilotes';
const ROLES_FORMATION = ['Super admin', 'Instructeur avion', 'Instructeur ULM'];
const STATUTS_SUIVI = { OUVERTE: 'Ouverte', TERMINEE: 'Terminée', ARCHIVEE: 'Archivée' };

let formationsCache = [];
let suivisCache = null;
let seancesCache = null;
let suiviOuvertId = null;
let eleveAFormation = null; // null = inconnu
let membresFormationCache = [];

function formationJson(v, def) {
    if (v === undefined || v === null || v === '') return def;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (e) { return def; }
}
function formationEncodeNom(nom) { return String(nom || '').replace(/'/g, "\\'"); }
function estInstructeurFormation() {
    return typeof roleAutorise === 'function' && roleAutorise(ROLES_FORMATION);
}
function idLecons(lecons) { return (lecons || []).map(l => String(l.id)); }

// ---------------------------------------------------------------------------
// ACCES : onglet visible pour instructeurs/admin, et pour tout eleve ayant
// (ou ayant eu) un suivi. Les suivis d'un eleve sont filtres cote serveur.
// ---------------------------------------------------------------------------
async function mettreAJourAccesFormation() {
    const tab = document.getElementById('tab-formation');
    if (!tab) return;
    if (!currentUser) { tab.style.display = 'none'; eleveAFormation = null; return; }
    if (estInstructeurFormation()) { eleveAFormation = true; tab.style.display = 'block'; return; }
    try {
        const suivis = await chargerSuivis();
        eleveAFormation = suivis.length > 0;
        tab.style.display = eleveAFormation ? 'block' : 'none';
    } catch (e) { tab.style.display = 'none'; }
}

// ---------------------------------------------------------------------------
// CHARGEMENT
// ---------------------------------------------------------------------------
async function chargerSuivis(force = false) {
    if (suivisCache && !force) return suivisCache;
    const url = `${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SUIVIS)}?sort[0][field]=${encodeURIComponent('Date début')}&sort[0][direction]=desc&pageSize=100`;
    suivisCache = await fetchTousRecordsCache(url, { headers });
    return suivisCache;
}
async function chargerToutesSeances(force = false) {
    if (seancesCache && !force) return seancesCache;
    const url = `${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}?sort[0][field]=Date&sort[0][direction]=asc&pageSize=100`;
    seancesCache = await fetchTousRecordsCache(url, { headers });
    return seancesCache;
}
async function chargerFormationsCatalogue(force = false) {
    if (formationsCache.length && !force) return formationsCache;
    const url = `${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS)}?pageSize=100`;
    formationsCache = await fetchTousRecordsCache(url, { headers });
    return formationsCache;
}
function invaliderFormationCache() { suivisCache = null; seancesCache = null; }

async function chargerVolsEleve(nomEleve) {
    const formula = encodeURIComponent(`{Pilote}='${formationEncodeNom(nomEleve)}'`);
    const url = `${API_BASE}/${encodeURIComponent(TABLE_CARNET_PILOTES)}?filterByFormula=${formula}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`;
    return fetchTousRecordsCache(url, { headers });
}

// ---------------------------------------------------------------------------
// PROGRESSION
// ---------------------------------------------------------------------------
function seancesDuSuivi(suiviId) {
    return (seancesCache || []).filter(s => String(s.fields['Suivi']) === String(suiviId));
}
function itemsValidesSuivi(suiviId) {
    const ok = new Set();
    const leconsValidees = new Set();
    seancesDuSuivi(suiviId).forEach(s => {
        formationJson(s.fields['Items validés'], []).forEach(x => ok.add(`${x.lecon}:${x.item}`));
        if (s.fields['Leçon validée']) leconsValidees.add(String(s.fields['Leçon']));
    });
    return { ok, leconsValidees };
}
// Items marques "reporte" lors d'une seance precedente et toujours non valides.
function itemsReportesEnAttente(suiviId) {
    const { ok } = itemsValidesSuivi(suiviId);
    const rep = new Map();
    seancesDuSuivi(suiviId).forEach(s => {
        formationJson(s.fields['Items reportés'], []).forEach(x => rep.set(`${x.lecon}:${x.item}`, x));
    });
    for (const k of [...rep.keys()]) if (ok.has(k)) rep.delete(k);
    return [...rep.values()];
}
function progressionSuivi(suivi) {
    const lecons = formationJson(suivi.fields['Lecons'], []);
    const { ok, leconsValidees } = itemsValidesSuivi(suivi.id);
    let total = 0, faits = 0;
    lecons.forEach(l => (l.items || []).forEach((_, i) => { total++; if (ok.has(`${l.id}:${i}`)) faits++; }));
    return { total, faits, pct: total ? Math.round(faits * 100 / total) : 0, ok, leconsValidees, lecons };
}
function couleurProgression(pct) {
    if (pct >= 100) return '#16a34a';
    if (pct >= 66) return '#22c55e';
    if (pct >= 33) return '#f59e0b';
    return '#dc2626';
}
function barreProgression(pct, hauteur = 14) {
    const c = couleurProgression(pct);
    return `<div class="formation-progress" style="height:${hauteur}px;">
        <div class="formation-progress-fill" style="width:${pct}%;background:${c};"></div>
        <span class="formation-progress-txt">${pct}%</span>
    </div>`;
}
function statutBadge(statut) {
    const m = { 'Ouverte': ['#dcfce7', '#166534'], 'Terminée': ['#dbeafe', '#1e40af'], 'Archivée': ['#f1f5f9', '#475569'] };
    const [bg, fg] = m[statut] || m['Ouverte'];
    return `<span class="formation-badge" style="background:${bg};color:${fg};">${escapeHtml(statut || 'Ouverte')}</span>`;
}
function libelleItem(suivi, x) {
    const lecon = formationJson(suivi.fields['Lecons'], []).find(l => String(l.id) === String(x.lecon));
    return lecon ? { leconTitre: lecon.titre, texte: (lecon.items || [])[x.item] || '?' } : { leconTitre: '?', texte: '?' };
}

// ---------------------------------------------------------------------------
// VUE PRINCIPALE
// ---------------------------------------------------------------------------
async function chargerFormation() {
    const zone = document.getElementById('formation-contenu');
    if (!zone || !currentUser) return;
    zone.innerHTML = '<div class="loading" style="padding:30px;text-align:center;color:#94a3b8;">Chargement…</div>';
    const instructeur = estInstructeurFormation();
    try {
        const [suivis] = await Promise.all([
            chargerSuivis(),
            chargerToutesSeances(),
            instructeur ? chargerFormationsCatalogue() : Promise.resolve([])
        ]);
        if (suiviOuvertId) { renderDetailSuivi(); return; }
        zone.innerHTML = instructeur ? renderVueInstructeur(suivis) : renderVueEleve(suivis);
    } catch (e) {
        console.error(e);
        zone.innerHTML = '<div class="loading" style="padding:30px;text-align:center;color:#b91c1c;">Erreur de chargement.</div>';
    }
}

function renderVueInstructeur(suivis) {
    const ouverts = suivis.filter(s => (s.fields['Statut'] || 'Ouverte') === 'Ouverte');
    const termines = suivis.filter(s => s.fields['Statut'] === 'Terminée');
    const archives = suivis.filter(s => s.fields['Statut'] === 'Archivée');
    const carte = s => {
        const f = s.fields;
        const p = progressionSuivi(s);
        return `<div class="formation-carte" data-formation-action="ouvrir" data-sid="${s.id}">
            <div class="formation-carte-tete">
                <strong>${escapeHtml(f['Élève nom'] || 'Élève')}</strong>
                ${statutBadge(f['Statut'] || 'Ouverte')}
            </div>
            <div class="formation-carte-sub">${escapeHtml(f['Formation titre'] || '')} — depuis le ${escapeHtml(f['Date début'] || '?')}</div>
            ${barreProgression(p.pct)}
            <div class="formation-carte-sub">${p.faits}/${p.total} items</div>
        </div>`;
    };
    return `
        <div class="formation-toolbar">
            <button class="btn-primary" data-formation-action="nouveau-suivi">＋ Attribuer une formation</button>
            <button class="btn-secondary" data-formation-action="gerer-catalogue">📚 Formations</button>
        </div>
        <h3 class="formation-section-titre">Formations en cours (${ouverts.length})</h3>
        <div class="formation-grille">${ouverts.map(carte).join('') || '<div class="formation-vide">Aucune formation en cours — attribuez-en une.</div>'}</div>
        ${termines.length ? `<h3 class="formation-section-titre">Terminées</h3><div class="formation-grille">${termines.map(carte).join('')}</div>` : ''}
        ${archives.length ? `<h3 class="formation-section-titre">Archivées</h3><div class="formation-grille">${archives.map(carte).join('')}</div>` : ''}
    `;
}

function renderVueEleve(suivis) {
    if (!suivis.length) return '<div class="formation-vide">Aucune formation ne vous a été attribuée pour le moment.</div>';
    const actives = suivis.filter(s => (s.fields['Statut'] || 'Ouverte') === 'Ouverte');
    const anciennes = suivis.filter(s => (s.fields['Statut'] || 'Ouverte') !== 'Ouverte');
    const carteResume = s => {
        const f = s.fields;
        const p = progressionSuivi(s);
        return `<div class="formation-carte" data-formation-action="ouvrir" data-sid="${s.id}">
            <div class="formation-carte-tete"><strong>${escapeHtml(f['Formation titre'] || 'Formation')}</strong>${statutBadge(f['Statut'])}</div>
            <div class="formation-carte-sub">Instructeur : ${escapeHtml(f['Instructeur'] || '—')}</div>
            ${barreProgression(p.pct)}
        </div>`;
    };
    return `
        ${actives.map(carteResume).join('')}
        ${anciennes.length ? `<h3 class="formation-section-titre">Formations passées</h3><div class="formation-grille">${anciennes.map(carteResume).join('')}</div>` : ''}
    `;
}

// ---------------------------------------------------------------------------
// DETAIL D'UN SUIVI
// ---------------------------------------------------------------------------
function ouvrirSuivi(suiviId) {
    suiviOuvertId = suiviId;
    renderDetailSuivi();
}

async function renderDetailSuivi() {
    const zone = document.getElementById('formation-contenu');
    const suivi = (suivisCache || []).find(s => s.id === suiviOuvertId);
    if (!zone) return;
    if (!suivi) { suiviOuvertId = null; chargerFormation(); return; }
    const f = suivi.fields;
    const instructeur = estInstructeurFormation();
    const p = progressionSuivi(suivi);
    const statut = f['Statut'] || 'Ouverte';
    const minimas = formationJson(f['Minimas'], {});
    const docs = formationJson(f['Documentation'], []);

    // Comptage des vols depuis le debut de la formation (asynchrone, non bloquant)
    const statsVolsId = `formation-stats-${suivi.id}`;

    const actionsInstructeur = instructeur ? `
        <div class="formation-toolbar" style="margin-top:8px;">
            <button class="btn-secondary" data-formation-action="seance" data-sid="${suivi.id}">✈️ Nouvelle séance</button>
            <button class="btn-secondary" data-formation-action="minimas" data-sid="${suivi.id}">⏱ Minimas</button>
            <button class="btn-secondary" data-formation-action="doc" data-sid="${suivi.id}">📄 Demander un document</button>
            ${statut === 'Ouverte' ? `<button class="btn-secondary" data-formation-action="terminer" data-sid="${suivi.id}">🏁 Terminer</button>` : ''}
            ${statut !== 'Archivée' ? `<button class="btn-secondary" data-formation-action="archiver" data-sid="${suivi.id}">🗄 Archiver</button>` : `<button class="btn-secondary" data-formation-action="rouvrir" data-sid="${suivi.id}">↩️ Désarchiver</button>`}
        </div>` : '';

    const leconsHtml = p.lecons.map((l, idx) => renderLecon(suivi, l, idx, p, instructeur)).join('');
    const docsHtml = docs.length ? `
        <h4 class="formation-sub-titre">📄 Documentation demandée</h4>
        <div class="formation-docs">${docs.map(d => renderDoc(suivi, d, instructeur)).join('')}</div>` : '';

    zone.innerHTML = `
        <div class="formation-toolbar">
            <button class="btn-secondary" data-formation-action="retour">← Retour</button>
        </div>
        <div class="formation-entete">
            <div>
                <h3 style="margin:0;">${escapeHtml(f['Formation titre'] || 'Formation')} ${statutBadge(statut)}</h3>
                <div class="formation-carte-sub">
                    Élève : <strong>${escapeHtml(f['Élève nom'] || '—')}</strong> ·
                    Instructeur : ${escapeHtml(f['Instructeur'] || '—')} ·
                    depuis le ${escapeHtml(f['Date début'] || '?')}
                    ${f['Date fin'] ? ` → ${escapeHtml(f['Date fin'])}` : ''}
                </div>
            </div>
            <div style="min-width:220px;">${barreProgression(p.pct, 20)}<div class="formation-carte-sub" style="text-align:right;">${p.faits}/${p.total} items validés</div></div>
        </div>
        <div id="${statsVolsId}" class="formation-carte-sub" style="margin:6px 0 10px;">Comptage des vols…</div>
        ${actionsInstructeur}
        ${docsHtml}
        <h4 class="formation-sub-titre">📚 Leçons</h4>
        ${leconsHtml || '<div class="formation-vide">Aucune leçon définie.</div>'}
    `;

    // Statistiques vols vs minimas (charge en arriere-plan)
    chargerStatsVols(suivi, minimas).then(html => {
        const el = document.getElementById(statsVolsId);
        if (el) el.innerHTML = html;
    });
}

async function chargerStatsVols(suivi, minimas) {
    try {
        const nomEleve = suivi.fields['Élève nom'] || '';
        if (!nomEleve) return '';
        const vols = await chargerVolsEleve(nomEleve);
        const debut = suivi.fields['Date début'] || '1900-01-01';
        const deduis = vols.filter(v => String(v.fields['Date'] || '') >= String(debut));
        let minutes = 0;
        deduis.forEach(v => { minutes += (typeof dureeVolMinutes === 'function' ? dureeVolMinutes(v.fields) : 0); });
        const h = Math.floor(minutes / 60), m = minutes % 60;
        const reqH = Number(minimas.heures || 0), reqV = Number(minimas.vols || 0);
        const fmt = (x, req, u) => req ? `${x}/${req}${u}` : `${x}${u}`;
        const hTxt = `${h}h${String(m).padStart(2, '0')}`;
        const reqHTxt = reqH ? `${reqH}h` : '';
        return `⏱ <strong>${deduis.length}${reqV ? '/' + reqV : ''}</strong> vols · <strong>${hTxt}${reqHTxt ? '/' + reqHTxt : ''}</strong> de vol depuis le début de la formation` +
            (reqH || reqV ? ' <span class="formation-carte-sub">(minimas requis)</span>' : '');
    } catch (e) { return ''; }
}

function renderDoc(suivi, d, instructeur) {
    const fourni = d.statut === 'Fourni';
    const bouton = (!instructeur && !fourni)
        ? `<button class="btn-primary" style="padding:4px 10px;font-size:12px;" data-formation-action="doc-fourni" data-sid="${suivi.id}" data-doc="${escapeHtml(d.id)}">Marquer fourni</button>`
        : '';
    return `<div class="formation-doc">
        <span>${fourni ? '✅' : '📄'} ${escapeHtml(d.titre)}</span>
        <span class="formation-carte-sub">${fourni ? `fourni le ${escapeHtml(d.dateFourni || '')}` : `demandé le ${escapeHtml(d.dateDemande || '')}`}</span>
        ${bouton}
    </div>`;
}

function renderLecon(suivi, lecon, idx, p, instructeur) {
    const items = lecon.items || [];
    const seances = seancesDuSuivi(suivi.id).filter(s => String(s.fields['Leçon']) === String(lecon.id));
    const validee = p.leconsValidees.has(String(lecon.id));
    const itemsHtml = items.map((it, i) => {
        const cle = `${lecon.id}:${i}`;
        const fait = p.ok.has(cle);
        const rep = !fait && itemsReportesEnAttente(suivi.id).some(x => `${x.lecon}:${x.item}` === cle);
        const icone = fait ? '✅' : (rep ? '🔄' : '⬜');
        const cls = fait ? 'formation-item-ok' : (rep ? 'formation-item-rep' : '');
        return `<div class="formation-item ${cls}">${icone} ${escapeHtml(it)}</div>`;
    }).join('');
    const seancesHtml = seances.map(s => renderSeance(s, instructeur)).join('');
    const peutSeance = instructeur && (suivi.fields['Statut'] || 'Ouverte') === 'Ouverte';
    return `
        <div class="formation-lecon ${validee ? 'formation-lecon-validee' : ''}">
            <div class="formation-lecon-tete">
                <strong>${validee ? '✅ ' : ''}Leçon ${idx + 1} — ${escapeHtml(lecon.titre || '')}</strong>
                ${lecon.objectif ? `<div class="formation-carte-sub">${escapeHtml(lecon.objectif)}</div>` : ''}
                ${peutSeance ? `<button class="btn-secondary" style="padding:4px 10px;font-size:12px;margin-left:auto;" data-formation-action="seance" data-sid="${suivi.id}" data-lecon="${escapeHtml(lecon.id)}">✈️ Séance</button>` : ''}
            </div>
            <div class="formation-items">${itemsHtml || '<div class="formation-carte-sub">Aucun item.</div>'}</div>
            ${seancesHtml}
        </div>`;
}

function renderSeance(s, instructeur) {
    const f = s.fields;
    const sigI = formationJson(f['Signature instructeur'], null);
    const sigE = formationJson(f['Signature élève'], null);
    const itemsOk = formationJson(f['Items validés'], []).length;
    const itemsRep = formationJson(f['Items reportés'], []).length;
    const vol = f['Vol libellé'] || '';
    const signer = (!instructeur && !sigE)
        ? `<button class="btn-primary" style="padding:4px 10px;font-size:12px;" data-formation-action="signer" data-sid="${s.id}">✍️ Signer</button>`
        : '';
    const sigs = `<div class="formation-signatures">
        <span title="${sigI ? `Signé par ${escapeHtml(sigI.par)} le ${escapeHtml(sigI.date)}` : 'Non signé'}">${sigI ? '✍️ Instructeur' : '⬜ Instructeur'}</span>
        <span title="${sigE ? `Signé par ${escapeHtml(sigE.par)} le ${escapeHtml(sigE.date)}` : 'Non signé'}">${sigE ? '✍️ Élève' : '⬜ Élève'}</span>
        ${signer}
    </div>`;
    return `
        <div class="formation-seance">
            <div class="formation-seance-tete">
                <strong>${escapeHtml(f['Date'] || '')}</strong>
                ${vol ? `<span class="formation-carte-sub">— ${escapeHtml(vol)}</span>` : ''}
                ${f['Leçon validée'] ? '<span class="formation-badge" style="background:#dcfce7;color:#166534;">Leçon validée</span>' : ''}
            </div>
            <div class="formation-carte-sub">${itemsOk} item(s) validé(s)${itemsRep ? ` · ${itemsRep} reporté(s)` : ''}</div>
            ${f['Commentaire'] ? `<div class="formation-commentaire">${escapeHtml(f['Commentaire']).replace(/\n/g, '<br>')}</div>` : ''}
            ${sigs}
        </div>`;
}

// ---------------------------------------------------------------------------
// ACTIONS COMMUNES (delegation)
// ---------------------------------------------------------------------------
document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-formation-action]');
    if (!el) return;
    const a = el.dataset.formationAction;
    const sid = el.dataset.sid;
    if (a === 'ouvrir') ouvrirSuivi(sid);
    else if (a === 'retour') { suiviOuvertId = null; chargerFormation(); }
    else if (a === 'nouveau-suivi') ouvrirModaleAttribuer();
    else if (a === 'gerer-catalogue') ouvrirGestionCatalogue();
    else if (a === 'seance') ouvrirModaleSeance(sid, el.dataset.lecon || null);
    else if (a === 'minimas') ouvrirModaleMinimas(sid);
    else if (a === 'doc') demanderDocument(sid);
    else if (a === 'doc-fourni') marquerDocumentFourni(sid, el.dataset.doc);
    else if (a === 'terminer') changerStatutSuivi(sid, 'Terminée');
    else if (a === 'archiver') changerStatutSuivi(sid, 'Archivée');
    else if (a === 'rouvrir') changerStatutSuivi(sid, 'Ouverte');
    else if (a === 'signer') signerSeance(sid);
    else if (a === 'editer-formation') ouvrirEditeurFormation(el.dataset.fid || null);
    else if (a === 'suppr-formation') supprimerFormation(el.dataset.fid);
    else if (a === 'lecon-suppr') el.closest('.formation-lecon-edit').remove();
    else if (a === 'lecon-add') ajouterBlocLecon();
});

// ---------------------------------------------------------------------------
// SIGNATURE (pad canvas reutilisable)
// ---------------------------------------------------------------------------
function ouvrirPadSignature(titre) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.style.cssText = 'display:flex;z-index:1200;';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width:560px;width:95%;">
                <h3>${escapeHtml(titre || 'Signature')}</h3>
                <p style="font-size:13px;color:#64748b;margin:4px 0 8px;">Signez dans le cadre ci-dessous (souris ou doigt).</p>
                <canvas id="pad-signature" width="520" height="160" style="border:1px solid #cbd5e1;border-radius:8px;background:#fff;touch-action:none;width:100%;height:160px;"></canvas>
                <div class="form-actions" style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end;">
                    <button type="button" class="btn-secondary" id="pad-effacer">Effacer</button>
                    <button type="button" class="btn-secondary" id="pad-annuler">Annuler</button>
                    <button type="button" class="btn-primary" id="pad-valider">✍️ Signer</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const canvas = overlay.querySelector('#pad-signature');
        const ctx = canvas.getContext('2d');
        ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1e3d59';
        let dessin = false, vide = true;
        const pos = e => {
            const r = canvas.getBoundingClientRect();
            const p = e.touches ? e.touches[0] : e;
            return { x: (p.clientX - r.left) * (canvas.width / r.width), y: (p.clientY - r.top) * (canvas.height / r.height) };
        };
        const debut = e => { dessin = true; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
        const trace = e => { if (!dessin) return; const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); vide = false; e.preventDefault(); };
        const fin = () => { dessin = false; };
        canvas.addEventListener('pointerdown', debut);
        canvas.addEventListener('pointermove', trace);
        canvas.addEventListener('pointerup', fin);
        canvas.addEventListener('pointerleave', fin);
        const fermer = v => { overlay.remove(); resolve(v); };
        overlay.querySelector('#pad-effacer').addEventListener('click', () => { ctx.clearRect(0, 0, canvas.width, canvas.height); vide = true; });
        overlay.querySelector('#pad-annuler').addEventListener('click', () => fermer(null));
        overlay.querySelector('#pad-valider').addEventListener('click', () => {
            if (vide) { alert('Signez dans le cadre avant de valider.'); return; }
            fermer(canvas.toDataURL('image/png'));
        });
    });
}

function signatureObjet(image) {
    return {
        par: `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim(),
        date: new Date().toISOString().slice(0, 16).replace('T', ' '),
        image
    };
}

async function signerSeance(seanceId) {
    const image = await ouvrirPadSignature('Signer la séance');
    if (!image) return;
    try {
        const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ records: [{ id: seanceId, fields: { 'Signature élève': signatureObjet(image) } }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur');
        invaliderFormationCache();
        await chargerToutesSeances(true);
        if (suiviOuvertId) renderDetailSuivi(); else chargerFormation();
    } catch (e) { console.error(e); alert('Erreur lors de la signature.'); }
}

// ---------------------------------------------------------------------------
// GESTION DU STATUT ET DE LA DOCUMENTATION D'UN SUIVI
// ---------------------------------------------------------------------------
async function patchSuivi(suiviId, fields) {
    const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SUIVIS)}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ records: [{ id: suiviId, fields }] })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur');
    invaliderFormationCache();
    await chargerSuivis(true);
}

async function changerStatutSuivi(suiviId, statut) {
    const labels = { 'Terminée': 'marquer cette formation comme terminée ?', 'Archivée': 'archiver cette formation ?', 'Ouverte': 'rouvrir cette formation ?' };
    if (!(await confirmerAction(`Voulez-vous ${labels[statut] || 'changer le statut ?'}`, { okLabel: 'Confirmer', icone: '🎓' }))) return;
    try {
        const fields = { 'Statut': statut };
        if (statut !== 'Ouverte') fields['Date fin'] = new Date().toISOString().slice(0, 10);
        await patchSuivi(suiviId, fields);
        if (suiviOuvertId) renderDetailSuivi(); else chargerFormation();
    } catch (e) { console.error(e); alert('Erreur lors du changement de statut.'); }
}

async function demanderDocument(suiviId) {
    const titre = await demanderSaisie('Document à demander à l\'élève', '', { placeholder: 'Ex : copie de la licence, certificat médical…' });
    if (titre === null || !titre.trim()) return;
    const suivi = suivisCache.find(s => s.id === suiviId);
    const docs = formationJson(suivi.fields['Documentation'], []).slice();
    docs.push({ id: `d${Date.now()}`, titre: titre.trim(), statut: 'Demandé', dateDemande: new Date().toISOString().slice(0, 10) });
    try {
        await patchSuivi(suiviId, { 'Documentation': docs });
        if (suiviOuvertId) renderDetailSuivi();
    } catch (e) { console.error(e); alert('Erreur lors de la demande.'); }
}

async function marquerDocumentFourni(suiviId, docId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const docs = formationJson(suivi.fields['Documentation'], []).map(d =>
        String(d.id) === String(docId) ? { ...d, statut: 'Fourni', dateFourni: new Date().toISOString().slice(0, 10) } : d);
    try {
        await patchSuivi(suiviId, { 'Documentation': docs });
        renderDetailSuivi();
    } catch (e) { console.error(e); alert('Erreur lors de la mise à jour.'); }
}

// ---------------------------------------------------------------------------
// MODALE MINIMAS
// ---------------------------------------------------------------------------
function ouvrirModaleMinimas(suiviId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const m = formationJson(suivi.fields['Minimas'], {});
    const overlay = document.getElementById('modale-formation-minimas');
    document.getElementById('minimas-heures').value = m.heures ?? '';
    document.getElementById('minimas-vols').value = m.vols ?? '';
    overlay.style.display = 'flex';
    overlay.dataset.sid = suiviId;
}

async function enregistrerMinimas(e) {
    e.preventDefault();
    const overlay = document.getElementById('modale-formation-minimas');
    const suiviId = overlay.dataset.sid;
    const h = parseFloat(document.getElementById('minimas-heures').value) || 0;
    const v = parseInt(document.getElementById('minimas-vols').value, 10) || 0;
    try {
        await patchSuivi(suiviId, { 'Minimas': { heures: h, vols: v } });
        overlay.style.display = 'none';
        renderDetailSuivi();
    } catch (err) { console.error(err); alert('Erreur lors de l\'enregistrement des minimas.'); }
}

// ---------------------------------------------------------------------------
// MODALE ATTRIBUTION D'UNE FORMATION A UN ELEVE
// ---------------------------------------------------------------------------
async function ouvrirModaleAttribuer() {
    const overlay = document.getElementById('modale-formation-attribuer');
    const selEleve = document.getElementById('attribuer-eleve');
    const selForm = document.getElementById('attribuer-formation');
    // Liste des membres actifs
    let membres = (typeof listeMembresCache !== 'undefined' && listeMembresCache.length) ? listeMembresCache : null;
    if (!membres) {
        const url = `${API_BASE}/${encodeURIComponent('Utilisateurs')}?pageSize=100`;
        membres = await fetchTousRecordsCache(url, { headers });
    }
    membresFormationCache = membres;
    const actifs = membres.filter(m => m.fields && m.fields['Actif'] !== false && `${m.fields['Prénom'] || ''}${m.fields['Nom'] || ''}`.trim());
    actifs.sort((a, b) => `${a.fields['Prénom']} ${a.fields['Nom']}`.localeCompare(`${b.fields['Prénom']} ${b.fields['Nom']}`));
    selEleve.innerHTML = '<option value="">— Choisir un élève —</option>' +
        actifs.map(m => `<option value="${m.id}">${escapeHtml(`${m.fields['Prénom'] || ''} ${m.fields['Nom'] || ''}`.trim())}</option>`).join('');
    const formations = formationsCache.filter(f => f.fields['Actif'] !== false);
    selForm.innerHTML = '<option value="">— Choisir une formation —</option>' +
        formations.map(f => `<option value="${f.id}">${escapeHtml(f.fields['Titre'] || 'Formation')}</option>`).join('');
    document.getElementById('attribuer-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('attribuer-licencie').checked = false;
    overlay.style.display = 'flex';
}

async function enregistrerAttribution(e) {
    e.preventDefault();
    const overlay = document.getElementById('modale-formation-attribuer');
    const eleveId = document.getElementById('attribuer-eleve').value;
    const formId = document.getElementById('attribuer-formation').value;
    const dateDebut = document.getElementById('attribuer-date').value;
    const licencie = document.getElementById('attribuer-licencie').checked;
    if (!eleveId || !formId || !dateDebut) { alert('Choisissez un élève, une formation et une date.'); return; }
    const membre = membresFormationCache.find(m => m.id === eleveId);
    const formation = formationsCache.find(f => f.id === formId);
    if (!formation) { alert('Formation introuvable.'); return; }
    const ff = formation.fields;
    const nomEleve = membre ? `${membre.fields['Prénom'] || ''} ${membre.fields['Nom'] || ''}`.trim() : eleveId;
    const min = formationJson(ff['Minimas'], {}) || {};
    const minimas = {
        heures: licencie ? (min.heuresLicencie ?? min.heures ?? 0) : (min.heures ?? 0),
        vols: licencie ? (min.volsLicencie ?? min.vols ?? 0) : (min.vols ?? 0)
    };
    const fields = {
        'Élève': [eleveId],
        'Élève nom': nomEleve,
        'Instructeur': `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim(),
        'Formation': [formId],
        'Formation titre': ff['Titre'] || '',
        'Discipline': ff['Discipline'] || '',
        'Lecons': formationJson(ff['Lecons'], []),
        'Minimas': minimas,
        'Statut': 'Ouverte',
        'Date début': dateDebut,
        'Documentation': []
    };
    try {
        const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SUIVIS)}`, {
            method: 'POST', headers, body: JSON.stringify({ records: [{ fields }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur');
        overlay.style.display = 'none';
        invaliderFormationCache();
        await chargerSuivis(true);
        chargerFormation();
    } catch (err) { console.error(err); alert('Erreur lors de l\'attribution.'); }
}

// ---------------------------------------------------------------------------
// CATALOGUE DES FORMATIONS (creation / edition lecons + items)
// ---------------------------------------------------------------------------
function ouvrirGestionCatalogue() {
    const overlay = document.getElementById('modale-formation-catalogue');
    const liste = document.getElementById('catalogue-liste');
    liste.innerHTML = formationsCache.map(f => {
        const lecons = formationJson(f.fields['Lecons'], []);
        return `<div class="formation-doc">
            <span><strong>${escapeHtml(f.fields['Titre'] || '')}</strong> <span class="formation-carte-sub">${escapeHtml(f.fields['Discipline'] || '')} · ${lecons.length} leçon(s)</span></span>
            <span>
                <button class="btn-secondary" style="padding:4px 10px;font-size:12px;" data-formation-action="editer-formation" data-fid="${f.id}">✏️ Modifier</button>
                <button class="btn-secondary" style="padding:4px 10px;font-size:12px;color:#b91c1c;" data-formation-action="suppr-formation" data-fid="${f.id}">🗑</button>
            </span>
        </div>`;
    }).join('') || '<div class="formation-vide">Aucune formation au catalogue.</div>';
    overlay.style.display = 'flex';
}

function blocLeconHtml(lecon, idx) {
    const itemsTxt = (lecon.items || []).join('\n');
    return `<div class="formation-lecon-edit" data-lecon-id="${escapeHtml(lecon.id || '')}">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <strong style="font-size:13px;">Leçon ${idx + 1}</strong>
            <input type="text" class="lecon-titre" placeholder="Titre de la leçon *" value="${escapeHtml(lecon.titre || '')}" style="flex:1;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
            <button type="button" class="btn-secondary" style="padding:4px 8px;color:#b91c1c;" data-formation-action="lecon-suppr">✕</button>
        </div>
        <input type="text" class="lecon-objectif" placeholder="Objectif (optionnel)" value="${escapeHtml(lecon.objectif || '')}" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;margin-bottom:6px;">
        <textarea class="lecon-items" rows="3" placeholder="Un item par ligne : ex. « Tenir le cap ±10° »" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-family:inherit;">${escapeHtml(itemsTxt)}</textarea>
    </div>`;
}
function ajouterBlocLecon() {
    const zone = document.getElementById('editeur-lecons');
    const idx = zone.querySelectorAll('.formation-lecon-edit').length;
    const div = document.createElement('div');
    div.innerHTML = blocLeconHtml({ id: '', titre: '', objectif: '', items: [] }, idx);
    zone.appendChild(div.firstElementChild);
}

function ouvrirEditeurFormation(formationId) {
    const overlay = document.getElementById('modale-formation-editeur');
    const form = formationId ? formationsCache.find(f => f.id === formationId) : null;
    overlay.dataset.fid = form ? form.id : '';
    document.getElementById('edit-formation-titre').value = form ? (form.fields['Titre'] || '') : '';
    document.getElementById('edit-formation-discipline').value = form ? (form.fields['Discipline'] || 'Avion') : 'Avion';
    document.getElementById('edit-formation-description').value = form ? (form.fields['Description'] || '') : '';
    const m = form ? formationJson(form.fields['Minimas'], {}) : {};
    document.getElementById('edit-formation-heures').value = m.heures ?? '';
    document.getElementById('edit-formation-vols').value = m.vols ?? '';
    document.getElementById('edit-formation-heures-lic').value = m.heuresLicencie ?? '';
    document.getElementById('edit-formation-vols-lic').value = m.volsLicencie ?? '';
    const lecons = form ? formationJson(form.fields['Lecons'], []) : [{ id: 'l1', titre: '', objectif: '', items: [] }];
    document.getElementById('editeur-lecons').innerHTML = lecons.map((l, i) => blocLeconHtml(l, i)).join('');
    document.getElementById('titre-modale-formation').textContent = form ? 'Modifier la formation' : 'Nouvelle formation';
    overlay.style.display = 'flex';
}

async function enregistrerFormationEdit(e) {
    e.preventDefault();
    const overlay = document.getElementById('modale-formation-editeur');
    const fid = overlay.dataset.fid;
    const titre = document.getElementById('edit-formation-titre').value.trim();
    if (!titre) { alert('Le titre est obligatoire.'); return; }
    const blocs = [...document.querySelectorAll('#editeur-lecons .formation-lecon-edit')];
    const lecons = blocs.map((b, i) => ({
        id: b.dataset.leconId || `l${Date.now()}_${i}`,
        titre: b.querySelector('.lecon-titre').value.trim(),
        objectif: b.querySelector('.lecon-objectif').value.trim(),
        items: b.querySelector('.lecon-items').value.split('\n').map(s => s.trim()).filter(Boolean)
    })).filter(l => l.titre || l.items.length);
    const fields = {
        'Titre': titre,
        'Discipline': document.getElementById('edit-formation-discipline').value,
        'Description': document.getElementById('edit-formation-description').value.trim(),
        'Minimas': {
            heures: parseFloat(document.getElementById('edit-formation-heures').value) || 0,
            vols: parseInt(document.getElementById('edit-formation-vols').value, 10) || 0,
            heuresLicencie: parseFloat(document.getElementById('edit-formation-heures-lic').value) || 0,
            volsLicencie: parseInt(document.getElementById('edit-formation-vols-lic').value, 10) || 0
        },
        'Lecons': lecons,
        'Actif': true
    };
    try {
        const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS)}`, {
            method: fid ? 'PATCH' : 'POST', headers,
            body: JSON.stringify(fid ? { records: [{ id: fid, fields }] } : { records: [{ fields }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur');
        overlay.style.display = 'none';
        await chargerFormationsCatalogue(true);
        ouvrirGestionCatalogue();
    } catch (err) { console.error(err); alert('Erreur lors de l\'enregistrement.'); }
}

async function supprimerFormation(fid) {
    if (!(await confirmerSuppression('Supprimer cette formation du catalogue ?\nLes suivis en cours conservent leur copie des leçons.'))) return;
    try {
        const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS)}?records[]=${fid}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error(await res.text());
        await chargerFormationsCatalogue(true);
        ouvrirGestionCatalogue();
    } catch (e) { console.error(e); alert('Erreur lors de la suppression.'); }
}

// ---------------------------------------------------------------------------
// MODALE SEANCE (debrief d'un vol, items valides/reportes, signature)
// ---------------------------------------------------------------------------
let seanceEnCours = null; // { suiviId, vols }

async function ouvrirModaleSeance(suiviId, leconPreChoisie) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const overlay = document.getElementById('modale-formation-seance');
    const selVol = document.getElementById('seance-vol');
    const selLecon = document.getElementById('seance-lecon');
    selVol.innerHTML = '<option value="">Chargement des vols…</option>';
    const lecons = formationJson(suivi.fields['Lecons'], []);
    const { leconsValidees } = itemsValidesSuivi(suiviId);
    const cible = leconPreChoisie || ((lecons.find(l => !leconsValidees.has(String(l.id)))) || {}).id || '';
    selLecon.innerHTML = lecons.map((l, i) => `<option value="${escapeHtml(l.id)}" ${String(l.id) === String(cible) ? 'selected' : ''}>Leçon ${i + 1} — ${escapeHtml(l.titre || '')}</option>`).join('');
    document.getElementById('seance-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('seance-commentaire').value = '';
    document.getElementById('seance-lecon-validee').checked = false;
    overlay.dataset.sid = suiviId;
    overlay.style.display = 'flex';
    renderItemsSeance();

    // Vols de l'eleve en arriere-plan
    try {
        const vols = await chargerVolsEleve(suivi.fields['Élève nom'] || '');
        seanceEnCours = { suiviId, vols };
        selVol.innerHTML = '<option value="">— Sans vol associé —</option>' + vols.slice(0, 40).map(v => {
            const f = v.fields;
            const lbl = `${f['Date'] || ''} · ${f['Départ'] || '?'}→${f['Arrivée'] || '?'} · ${f['Temps de vol'] || ''} · ${f['Machine'] || ''}`;
            return `<option value="${v.id}">${escapeHtml(lbl)}</option>`;
        }).join('');
    } catch (e) { selVol.innerHTML = '<option value="">— Sans vol associé —</option>'; }
}

// Liste des items a cocher : items de la lecon choisie + items reportes d'avant.
function renderItemsSeance() {
    const overlay = document.getElementById('modale-formation-seance');
    const suivi = suivisCache.find(s => s.id === overlay.dataset.sid);
    const leconId = document.getElementById('seance-lecon').value;
    const zone = document.getElementById('seance-items');
    if (!suivi) { zone.innerHTML = ''; return; }
    const lecons = formationJson(suivi.fields['Lecons'], []);
    const lecon = lecons.find(l => String(l.id) === String(leconId));
    const { ok } = itemsValidesSuivi(suivi.id);
    const reportes = itemsReportesEnAttente(suivi.id).filter(x => String(x.lecon) !== String(leconId));
    const lignes = [];
    (lecon ? lecon.items : []).forEach((it, i) => {
        if (ok.has(`${lecon.id}:${i}`)) return; // deja valide
        lignes.push(`<label class="formation-item-check"><input type="checkbox" class="seance-item" data-lecon="${escapeHtml(lecon.id)}" data-item="${i}"> <span>${escapeHtml(it)}</span></label>`);
    });
    if (reportes.length) {
        lignes.push('<div class="formation-carte-sub" style="margin:8px 0 2px;">🔄 Reportés des leçons précédentes :</div>');
        reportes.forEach(x => {
            const lib = libelleItem(suivi, x);
            lignes.push(`<label class="formation-item-check formation-item-rep"><input type="checkbox" class="seance-item" data-lecon="${escapeHtml(x.lecon)}" data-item="${x.item}"> <span>${escapeHtml(lib.texte)} <em>(${escapeHtml(lib.leconTitre)})</em></span></label>`);
        });
    }
    zone.innerHTML = lignes.join('') || '<div class="formation-carte-sub">Tous les items de cette leçon sont déjà validés.</div>';
    zone.dataset.tous = (lecon ? lecon.items.length : 0);
}

async function enregistrerSeance(e) {
    e.preventDefault();
    const overlay = document.getElementById('modale-formation-seance');
    const suivi = suivisCache.find(s => s.id === overlay.dataset.sid);
    if (!suivi) return;
    const leconId = document.getElementById('seance-lecon').value;
    const lecons = formationJson(suivi.fields['Lecons'], []);
    const lecon = lecons.find(l => String(l.id) === String(leconId));
    const cases = [...document.querySelectorAll('#seance-items .seance-item')];
    const valides = cases.filter(c => c.checked).map(c => ({ lecon: c.dataset.lecon, item: parseInt(c.dataset.item, 10) }));
    const reportes = cases.filter(c => !c.checked).map(c => ({ lecon: c.dataset.lecon, item: parseInt(c.dataset.item, 10) }));
    const volId = document.getElementById('seance-vol').value;
    const vol = volId && seanceEnCours ? seanceEnCours.vols.find(v => v.id === volId) : null;
    const volLibelle = vol ? `${vol.fields['Date'] || ''} · ${vol.fields['Départ'] || '?'}→${vol.fields['Arrivée'] || '?'} · ${vol.fields['Temps de vol'] || ''} · ${vol.fields['Machine'] || ''}` : '';
    const leconValidee = document.getElementById('seance-lecon-validee').checked;
    const commentaire = document.getElementById('seance-commentaire').value.trim();
    const date = document.getElementById('seance-date').value || new Date().toISOString().slice(0, 10);

    const image = await ouvrirPadSignature('Signature de l\'instructeur');
    if (!image) return;

    const fields = {
        'Suivi': String(suivi.id),
        'Élève': suivi.fields['Élève'] || [],
        'Élève nom': suivi.fields['Élève nom'] || '',
        'Leçon': String(leconId),
        'Leçon titre': lecon ? lecon.titre : '',
        'Vol': volId || '',
        'Vol libellé': volLibelle,
        'Date': date,
        'Commentaire': commentaire,
        'Items validés': valides,
        'Items reportés': reportes,
        'Leçon validée': leconValidee,
        'Signature instructeur': signatureObjet(image)
    };
    try {
        const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}`, {
            method: 'POST', headers, body: JSON.stringify({ records: [{ fields }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur');
        overlay.style.display = 'none';
        invaliderFormationCache();
        await chargerToutesSeances(true);
        renderDetailSuivi();
    } catch (err) { console.error(err); alert('Erreur lors de l\'enregistrement de la séance.'); }
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
function initFormation() {
    const change = document.getElementById('seance-lecon');
    if (change) change.addEventListener('change', renderItemsSeance);
    const fermer = (id) => { const o = document.getElementById(id); if (o) o.style.display = 'none'; };
    const liaisons = [
        ['btn-close-formation-editeur', 'modale-formation-editeur'],
        ['btn-close-formation-attribuer', 'modale-formation-attribuer'],
        ['btn-close-formation-seance', 'modale-formation-seance'],
        ['btn-close-formation-minimas', 'modale-formation-minimas'],
        ['btn-close-formation-catalogue', 'modale-formation-catalogue']
    ];
    liaisons.forEach(([btn, mod]) => {
        const b = document.getElementById(btn);
        if (b) b.addEventListener('click', () => fermer(mod));
    });
    document.querySelectorAll('#modale-formation-editeur, #modale-formation-attribuer, #modale-formation-seance, #modale-formation-minimas, #modale-formation-catalogue')
        .forEach(o => o.addEventListener('click', (e) => { if (e.target === o) o.style.display = 'none'; }));
    const f1 = document.getElementById('form-formation-editeur');
    if (f1) f1.addEventListener('submit', enregistrerFormationEdit);
    const f2 = document.getElementById('form-formation-attribuer');
    if (f2) f2.addEventListener('submit', enregistrerAttribution);
    const f3 = document.getElementById('form-formation-seance');
    if (f3) f3.addEventListener('submit', enregistrerSeance);
    const f4 = document.getElementById('form-formation-minimas');
    if (f4) f4.addEventListener('submit', enregistrerMinimas);
    const btnCat = document.getElementById('btn-formation-nouvelle');
    if (btnCat) btnCat.addEventListener('click', () => ouvrirEditeurFormation(null));
    const btnLecon = document.getElementById('btn-formation-lecon-add');
    if (btnLecon) btnLecon.addEventListener('click', ajouterBlocLecon);
}
