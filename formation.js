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
    suivisCache = await fetchTousRecordsCache(url, { headers }, API_CACHE_TTL, force);
    return suivisCache;
}
async function chargerToutesSeances(force = false) {
    if (seancesCache && !force) return seancesCache;
    const url = `${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}?sort[0][field]=Date&sort[0][direction]=asc&pageSize=100`;
    seancesCache = await fetchTousRecordsCache(url, { headers }, API_CACHE_TTL, force);
    return seancesCache;
}
async function chargerFormationsCatalogue(force = false) {
    if (formationsCache.length && !force) return formationsCache;
    const url = `${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS)}?pageSize=100`;
    formationsCache = await fetchTousRecordsCache(url, { headers }, API_CACHE_TTL, force);
    return formationsCache;
}
// Vide les deux niveaux de cache : variables du module ET cache HTTP partage
// (apiFetch n'invalide pas le cache — contrairement a cachedFetch sur non-GET).
function invaliderFormationCache() {
    suivisCache = null;
    seancesCache = null;
    if (typeof viderApiCache === 'function') viderApiCache();
}

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
// Boutons d'action dans l'en-tete de la page (a droite, comme les autres vues)
function majActionsEntete(html) {
    const zone = document.getElementById('formation-header-actions');
    if (!zone) return;
    zone.innerHTML = html || '';
    zone.style.display = html ? 'flex' : 'none';
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
        majActionsEntete(instructeur ? `
            <button class="btn-primary" data-formation-action="nouveau-suivi">＋ Attribuer une formation</button>
            <button class="btn-secondary" data-formation-action="gerer-catalogue">📚 Formations</button>` : '');
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

    const boutonsInstructeur = instructeur ? `
        <button class="btn-primary" data-formation-action="seance" data-sid="${suivi.id}">✈️ Nouvelle séance</button>
        <button class="btn-secondary" data-formation-action="minimas" data-sid="${suivi.id}">⏱ Minimas</button>
        <button class="btn-secondary" data-formation-action="doc" data-sid="${suivi.id}">📄 Demander un document</button>
        ${statut === 'Ouverte' ? `<button class="btn-secondary" data-formation-action="terminer" data-sid="${suivi.id}">🏁 Terminer</button>` : ''}
        ${statut !== 'Archivée' ? `<button class="btn-secondary" data-formation-action="archiver" data-sid="${suivi.id}">🗄 Archiver</button>` : `<button class="btn-secondary" data-formation-action="rouvrir" data-sid="${suivi.id}">↩️ Désarchiver</button>`}
        <button class="btn-secondary" style="color:#b91c1c;" data-formation-action="suppr-suivi" data-sid="${suivi.id}">🗑 Supprimer</button>` : '';
    majActionsEntete(`
        <button class="btn-secondary" data-formation-action="retour">← Retour</button>
        <button class="btn-secondary" data-formation-action="fiche" data-sid="${suivi.id}">👤 Fiche élève</button>
        ${boutonsInstructeur}`);

    // Regroupement des lecons par phase (groupe), comme le livret BLN.
    let dernierGroupe = '';
    const leconsHtml = p.lecons.map((l, idx) => {
        const g = l.groupe || '';
        const entete = g !== dernierGroupe && g ? `<h5 class="formation-phase-titre">${escapeHtml(g)}</h5>` : '';
        dernierGroupe = g;
        return entete + renderLecon(suivi, l, idx, p, instructeur);
    }).join('');

    // Modules theoriques du suivi (valides un par un avec date).
    const modules = formationJson(f['Modules'], []);
    const modulesHtml = modules.length ? `
        <h4 class="formation-sub-titre">📖 Formation théorique</h4>
        <div class="formation-docs">${modules.map(mo => {
            const fait = !!mo.statut;
            const zone = (instructeur && !fait) ? `
                <input type="date" id="module-date-${escapeHtml(mo.id)}" value="${new Date().toISOString().slice(0, 10)}" title="Date de validation" style="padding:3px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;">
                <button class="btn-primary" style="padding:4px 10px;font-size:12px;" data-formation-action="module-valide" data-sid="${suivi.id}" data-mid="${escapeHtml(mo.id)}">Valider</button>` : '';
            return `<div class="formation-doc"><span>${fait ? '✅' : '⬜'} ${escapeHtml(mo.titre)}</span>
                <span class="formation-carte-sub">${fait ? `validé le ${escapeHtml(mo.date || '')}` : 'en attente'}</span>${zone}</div>`;
        }).join('')}</div>` : '';
    const ressources = formationJson(f['Ressources'], []);
    const ressourcesHtml = ressources.length ? `
        <h4 class="formation-sub-titre">� Documentation de la formation</h4>
        <div class="formation-docs">${ressources.map(r => {
            const lien = urlSure(r.lien || '');
            return `<div class="formation-doc">${lien
                ? `<a href="${lien}" target="_blank" rel="noopener">🔗 ${escapeHtml(r.titre || r.lien)}</a>`
                : `<span>🔗 ${escapeHtml(r.titre || '')}</span>`}</div>`;
        }).join('')}</div>` : '';
    const docsHtml = docs.length ? `
        <h4 class="formation-sub-titre">📋 Documents demandés / prérequis</h4>
        <div class="formation-docs">${docs.map(d => renderDoc(suivi, d, instructeur)).join('')}</div>` : '';

    zone.innerHTML = `
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
        ${ressourcesHtml}
        ${modulesHtml}
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

// Bilan style livret : HDV par type (DC / solo / simu) depuis les seances,
// plus le total carnet de route en complement, le tout compare aux minimas.
async function chargerStatsVols(suivi, minimas) {
    try {
        const seances = seancesDuSuivi(suivi.id);
        let dc = 0, solo = 0, simu = 0, att = 0;
        seances.forEach(s => {
            dc += parseFloat(s.fields['HDV DC']) || 0;
            solo += parseFloat(s.fields['HDV solo']) || 0;
            simu += parseFloat(s.fields['HDV simu']) || 0;
            att += parseInt(s.fields['Atterrissages'], 10) || 0;
        });
        const nomEleve = suivi.fields['Élève nom'] || '';
        let nbVols = 0, minutes = 0;
        if (nomEleve) {
            const vols = await chargerVolsEleve(nomEleve);
            const debut = suivi.fields['Date début'] || '1900-01-01';
            const deduis = vols.filter(v => String(v.fields['Date'] || '') >= String(debut));
            nbVols = deduis.length;
            deduis.forEach(v => { minutes += (typeof dureeVolMinutes === 'function' ? dureeVolMinutes(v.fields) : 0); });
        }
        const hTxt = v => { const h = Math.floor(v), m = Math.round((v - h) * 60); return `${h}h${String(m).padStart(2, '0')}`; };
        const seg = (label, val, req, u) => `${label} <strong>${u ? hTxt(val) : val}${req ? '/' + req + (u || '') : ''}</strong>`;
        const reqH = Number(minimas.heures || 0), reqV = Number(minimas.vols || 0);
        const reqDC = Number(minimas.heuresDC || 0), reqSolo = Number(minimas.heuresSolo || 0), reqAtt = Number(minimas.atterrissages || 0);
        const blocs = [
            seg('Total', minutes / 60, reqH, 'h'),
            `Vols <strong>${nbVols}${reqV ? '/' + reqV : ''}</strong>`,
            seg('DC', dc, reqDC, 'h'),
            seg('Solo', solo, reqSolo, 'h'),
            simu ? seg('Simu', simu, 0, 'h') : '',
            (att || reqAtt) ? `Att <strong>${att}${reqAtt ? '/' + reqAtt : ''}</strong>` : ''
        ].filter(Boolean);
        const aDesHdv = dc || solo || simu || att;
        return `⏱ ${blocs.join(' · ')}` +
            (aDesHdv ? '' : ' <span class="formation-carte-sub">(détail DC/solo compté depuis les séances)</span>') +
            (reqH || reqV || reqDC || reqSolo || reqAtt ? ' <span class="formation-carte-sub">(minimas requis)</span>' : '') +
            (minimas.cas ? ` <span class="formation-carte-sub">· cas « ${escapeHtml(minimas.cas)} »</span>` : '');
    } catch (e) { return ''; }
}

function renderDoc(suivi, d, instructeur) {
    const fourni = d.statut === 'Fourni';
    const today = new Date().toISOString().slice(0, 10);
    const expire = fourni && d.dateValidite && d.dateValidite < today;
    const lien = d.lien ? ` <a href="${urlSure(d.lien)}" target="_blank" rel="noopener" title="Voir le document">📎</a>` : '';
    const infos = fourni
        ? `fourni le ${escapeHtml(d.dateFourni || '')}` + (d.dateValidite
            ? ` · <span style="color:${expire ? '#b91c1c' : '#166534'};">${expire ? 'expiré' : 'valable'} jusqu'au ${escapeHtml(d.dateValidite)}</span>` : '')
        : `demandé le ${escapeHtml(d.dateDemande || '')}`;
    // L'eleve depose le document (fichier facultatif) + sa date de validite.
    const depot = (!instructeur && !fourni) ? `
        <div class="formation-doc-depot">
            <input type="file" id="doc-fichier-${escapeHtml(d.id)}" accept=".pdf,.jpg,.jpeg,.png" title="Joindre le document">
            <input type="date" id="doc-validite-${escapeHtml(d.id)}" title="Date de validité (optionnel)">
            <button class="btn-primary" style="padding:4px 10px;font-size:12px;" data-formation-action="doc-fourni" data-sid="${suivi.id}" data-doc="${escapeHtml(d.id)}">Envoyer</button>
        </div>` : '';
    return `<div class="formation-doc" style="flex-wrap:wrap;">
        <span>${fourni ? '✅' : (d.prerequis ? '�' : '�📄')} ${escapeHtml(d.titre)}${lien}</span>
        <span class="formation-carte-sub">${infos}</span>
        ${depot}
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
    // Numero de seance dans le suivi (ordre chronologique = "cours n°")
    const numero = seancesDuSuivi(f['Suivi']).findIndex(x => x.id === s.id) + 1;
    const iconesType = { 'Vol': '✈️', 'Simulateur': '🖥️', 'Théorique': '📖' };
    const typeSeance = f['Type'] || 'Vol';
    const hdv = [
        parseFloat(f['HDV DC']) ? `DC ${f['HDV DC']}h` : '',
        parseFloat(f['HDV solo']) ? `Solo ${f['HDV solo']}h` : '',
        parseFloat(f['HDV simu']) ? `Simu ${f['HDV simu']}h` : '',
        parseInt(f['Atterrissages'], 10) ? `${f['Atterrissages']} att.` : ''
    ].filter(Boolean).join(' · ');
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
                <strong>Séance n°${numero || '?'}</strong>
                <span class="formation-badge" style="background:#eff6ff;color:#1e40af;">${iconesType[typeSeance] || '✈️'} ${escapeHtml(typeSeance)}</span>
                <span class="formation-carte-sub">${escapeHtml(f['Date'] || '')}${f['Machine'] ? ` · ${escapeHtml(f['Machine'])}` : ''}</span>
                ${f['Leçon validée'] ? '<span class="formation-badge" style="background:#dcfce7;color:#166534;">Leçon validée</span>' : ''}
            </div>
            ${vol ? `<div class="formation-carte-sub">Vol : ${escapeHtml(vol)}</div>` : ''}
            ${hdv ? `<div class="formation-carte-sub">⏱ ${escapeHtml(hdv)}</div>` : ''}
            ${f['Météo'] ? `<div class="formation-carte-sub">🌦 ${escapeHtml(f['Météo'])}</div>` : ''}
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
    else if (a === 'module-valide') validerModule(sid, el.dataset.mid);
    else if (a === 'fiche') ouvrirFicheEleve(sid);
    else if (a === 'terminer') changerStatutSuivi(sid, 'Terminée');
    else if (a === 'archiver') changerStatutSuivi(sid, 'Archivée');
    else if (a === 'rouvrir') changerStatutSuivi(sid, 'Ouverte');
    else if (a === 'signer') signerSeance(sid);
    else if (a === 'editer-formation') ouvrirEditeurFormation(el.dataset.fid || null);
    else if (a === 'suppr-formation') supprimerFormation(el.dataset.fid);
    else if (a === 'suppr-suivi') supprimerSuivi(sid);
    else if (a === 'lecon-suppr') el.closest('.formation-lecon-edit').remove();
    else if (a === 'mini-suppr') el.closest('.formation-mini-edit').remove();
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
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}`, {
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
    const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SUIVIS)}`, {
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

// L'eleve depose un document demande : fichier facultatif (upload /v0/upload)
// + date de validite. Le serveur n'autorise l'eleve qu'a completer les items
// existants (longueur et titres conserves — verifie cote backend).
async function marquerDocumentFourni(suiviId, docId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const inputFichier = document.getElementById(`doc-fichier-${docId}`);
    const inputValidite = document.getElementById(`doc-validite-${docId}`);
    let lien = '';
    try {
        if (inputFichier && inputFichier.files && inputFichier.files[0]) {
            lien = await uploaderFichierDocument(inputFichier.files[0]);
        }
    } catch (e) { alert('Erreur lors de l\'upload : ' + e.message); return; }
    const docs = formationJson(suivi.fields['Documentation'], []).map(d =>
        String(d.id) === String(docId) ? {
            ...d, statut: 'Fourni',
            dateFourni: new Date().toISOString().slice(0, 10),
            dateValidite: inputValidite ? inputValidite.value : '',
            lien: lien || d.lien || ''
        } : d);
    try {
        await patchSuivi(suiviId, { 'Documentation': docs });
        renderDetailSuivi();
    } catch (e) { console.error(e); alert('Erreur lors de la mise à jour.'); }
}

// Validation d'un module theorique par l'instructeur (date de la séance/emargement).
async function validerModule(suiviId, moduleId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const input = document.getElementById(`module-date-${moduleId}`);
    const date = (input && input.value) || new Date().toISOString().slice(0, 10);
    const modules = formationJson(suivi.fields['Modules'], []).map(mo =>
        String(mo.id) === String(moduleId) ? { ...mo, statut: true, date } : mo);
    try {
        await patchSuivi(suiviId, { 'Modules': modules });
        renderDetailSuivi();
    } catch (e) { console.error(e); alert('Erreur lors de la validation.'); }
}

// ---------------------------------------------------------------------------
// FICHE ELEVE (etat civil + contact d'urgence — livret GEN 1)
// L'eleve peut completer sa propre fiche (auto-edition verifiee cote serveur).
// ---------------------------------------------------------------------------
function ouvrirFicheEleve(suiviId) {
    const suivi = suivisCache.find(s => s.id === suiviId);
    if (!suivi) return;
    const ec = formationJson(suivi.fields['Etat civil'], {}) || {};
    const set = (id, v) => { document.getElementById(id).value = v || ''; };
    set('fiche-naissance', ec.naissance); set('fiche-lieu-naissance', ec.lieuNaissance);
    set('fiche-nationalite', ec.nationalite); set('fiche-telephone', ec.telephone);
    set('fiche-email', ec.email); set('fiche-adresse', ec.adresse);
    set('fiche-urgence-nom', ec.urgenceNom); set('fiche-urgence-tel', ec.urgenceTel);
    const overlay = document.getElementById('modale-formation-fiche');
    overlay.dataset.sid = suiviId;
    overlay.style.display = 'flex';
}

async function enregistrerFiche(e) {
    e.preventDefault();
    const overlay = document.getElementById('modale-formation-fiche');
    const val = id => document.getElementById(id).value.trim();
    const ec = {
        naissance: document.getElementById('fiche-naissance').value,
        lieuNaissance: val('fiche-lieu-naissance'), nationalite: val('fiche-nationalite'),
        telephone: val('fiche-telephone'), email: val('fiche-email'), adresse: val('fiche-adresse'),
        urgenceNom: val('fiche-urgence-nom'), urgenceTel: val('fiche-urgence-tel')
    };
    try {
        await patchSuivi(overlay.dataset.sid, { 'Etat civil': ec });
        overlay.style.display = 'none';
    } catch (err) { console.error(err); alert('Erreur lors de l\'enregistrement de la fiche.'); }
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
    document.getElementById('minimas-hdc').value = m.heuresDC ?? '';
    document.getElementById('minimas-hsolo').value = m.heuresSolo ?? '';
    document.getElementById('minimas-att').value = m.atterrissages ?? '';
    overlay.style.display = 'flex';
    overlay.dataset.sid = suiviId;
}

async function enregistrerMinimas(e) {
    e.preventDefault();
    const overlay = document.getElementById('modale-formation-minimas');
    const suiviId = overlay.dataset.sid;
    const suivi = suivisCache.find(s => s.id === suiviId);
    const actuel = suivi ? (formationJson(suivi.fields['Minimas'], {}) || {}) : {};
    const minimas = {
        heures: parseFloat(document.getElementById('minimas-heures').value) || 0,
        vols: parseInt(document.getElementById('minimas-vols').value, 10) || 0,
        heuresDC: parseFloat(document.getElementById('minimas-hdc').value) || 0,
        heuresSolo: parseFloat(document.getElementById('minimas-hsolo').value) || 0,
        atterrissages: parseInt(document.getElementById('minimas-att').value, 10) || 0
    };
    if (actuel.cas) minimas.cas = actuel.cas; // conserve le cas applique
    try {
        await patchSuivi(suiviId, { 'Minimas': minimas });
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
    majCasAttribution();
    overlay.style.display = 'flex';
}

// Cas de figure d'une formation : nouveau format (cas[]) ou ancien licencie.
function casDeFormation(formation) {
    const m = formationJson(formation && formation.fields['Minimas'], {}) || {};
    if (Array.isArray(m.cas)) return m.cas;
    if (m.heuresLicencie || m.volsLicencie) return [{ nom: 'Déjà licencié', heures: m.heuresLicencie || 0, vols: m.volsLicencie || 0 }];
    return [];
}
function majCasAttribution() {
    const formId = document.getElementById('attribuer-formation').value;
    const formation = formationsCache.find(f => f.id === formId);
    const groupe = document.getElementById('attribuer-cas-groupe');
    const sel = document.getElementById('attribuer-cas');
    const cas = formation ? casDeFormation(formation) : [];
    groupe.style.display = cas.length ? 'block' : 'none';
    sel.innerHTML = '<option value="">Minimas standard</option>' +
        cas.map((c, i) => `<option value="${i}">${escapeHtml(c.nom)} — ${c.heures || 0}h / ${c.vols || 0} vols</option>`).join('');
}

async function enregistrerAttribution(e) {
    e.preventDefault();
    const overlay = document.getElementById('modale-formation-attribuer');
    const eleveId = document.getElementById('attribuer-eleve').value;
    const formId = document.getElementById('attribuer-formation').value;
    const dateDebut = document.getElementById('attribuer-date').value;
    const casIdx = document.getElementById('attribuer-cas').value;
    if (!eleveId || !formId || !dateDebut) { alert('Choisissez un élève, une formation et une date.'); return; }
    const membre = membresFormationCache.find(m => m.id === eleveId);
    const formation = formationsCache.find(f => f.id === formId);
    if (!formation) { alert('Formation introuvable.'); return; }
    const ff = formation.fields;
    const nomEleve = membre ? `${membre.fields['Prénom'] || ''} ${membre.fields['Nom'] || ''}`.trim() : eleveId;
    const min = formationJson(ff['Minimas'], {}) || {};
    const cas = casDeFormation(formation);
    const choisi = casIdx !== '' ? cas[parseInt(casIdx, 10)] : null;
    const minimas = {
        heures: choisi ? (choisi.heures ?? 0) : (min.heures ?? 0),
        vols: choisi ? (choisi.vols ?? 0) : (min.vols ?? 0),
        heuresDC: choisi ? (choisi.heuresDC ?? 0) : (min.heuresDC ?? 0),
        heuresSolo: choisi ? (choisi.heuresSolo ?? 0) : (min.heuresSolo ?? 0),
        atterrissages: choisi ? (choisi.atterrissages ?? 0) : (min.atterrissages ?? 0)
    };
    if (choisi) minimas.cas = choisi.nom;
    // Les prerequis du catalogue deviennent les documents demandes a l'eleve.
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const documentation = formationJson(ff['Prerequis'], []).map((p, i) => ({
        id: `d${Date.now()}_${i}`, titre: p.titre, statut: 'Demandé', dateDemande: aujourdhui, prerequis: true
    }));
    const fields = {
        'Élève': [eleveId],
        'Élève nom': nomEleve,
        'Instructeur': `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim(),
        'Formation': [formId],
        'Formation titre': ff['Titre'] || '',
        'Discipline': ff['Discipline'] || '',
        'Lecons': formationJson(ff['Lecons'], []),
        'Minimas': minimas,
        'Ressources': formationJson(ff['Ressources'], []),
        'Modules': formationJson(ff['Modules'], []).map((m, i) => ({ id: `m${Date.now()}_${i}`, titre: m.titre, statut: false, date: '' })),
        'Etat civil': { telephone: (membre && membre.fields['Téléphone']) || '', email: (membre && membre.fields['Mail']) || '' },
        'Statut': 'Ouverte',
        'Date début': dateDebut,
        'Documentation': documentation
    };
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SUIVIS)}`, {
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
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
            <input type="text" class="lecon-objectif" placeholder="Objectif (optionnel)" value="${escapeHtml(lecon.objectif || '')}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
            <input type="text" class="lecon-groupe" placeholder="Phase (optionnel, ex : Phase 1 — Maniabilité)" value="${escapeHtml(lecon.groupe || '')}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
        </div>
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

// Cas de figure de minimas (ex : "deja licencié ULM") — nom libre, multiples.
function blocCasHtml(cas) {
    const inp = (cls, ph, v) => `<input type="number" class="${cls}" min="0" step="0.5" placeholder="${ph}" title="${ph}" value="${v ?? ''}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;min-width:0;">`;
    return `<div class="formation-mini-edit" style="display:grid;grid-template-columns:1.6fr repeat(5,0.7fr) auto;gap:6px;margin-bottom:6px;align-items:center;">
        <input type="text" class="cas-nom" placeholder="Nom du cas (ex : déjà licencié ULM)" value="${escapeHtml(cas.nom || '')}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;min-width:0;">
        ${inp('cas-heures', 'Heures', cas.heures)}${inp('cas-vols', 'Vols', cas.vols)}${inp('cas-hdc', 'h double cmd', cas.heuresDC)}${inp('cas-hsolo', 'h solo', cas.heuresSolo)}${inp('cas-att', 'Atterrissages', cas.atterrissages)}
        <button type="button" class="btn-secondary" style="padding:4px 8px;color:#b91c1c;" data-formation-action="mini-suppr">✕</button>
    </div>`;
}
function blocModuleHtml(m) {
    return `<div class="formation-mini-edit" style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">
        <input type="text" class="module-titre" placeholder="Module théorique (ex : Réglementation)" value="${escapeHtml(m.titre || '')}" style="flex:1;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
        <button type="button" class="btn-secondary" style="padding:4px 8px;color:#b91c1c;" data-formation-action="mini-suppr">✕</button>
    </div>`;
}
function blocPrerequisHtml(p) {
    return `<div class="formation-mini-edit" style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">
        <input type="text" class="prerequis-titre" placeholder="Document à fournir (ex : certificat médical)" value="${escapeHtml(p.titre || '')}" style="flex:1;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
        <button type="button" class="btn-secondary" style="padding:4px 8px;color:#b91c1c;" data-formation-action="mini-suppr">✕</button>
    </div>`;
}
function blocRessourceHtml(r) {
    return `<div class="formation-mini-edit" style="display:grid;grid-template-columns:1fr 1.4fr auto;gap:6px;margin-bottom:6px;align-items:center;">
        <input type="text" class="ressource-titre" placeholder="Titre du lien" value="${escapeHtml(r.titre || '')}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
        <input type="url" class="ressource-lien" placeholder="https://… ou /uploads/…" value="${escapeHtml(r.lien || '')}" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;">
        <button type="button" class="btn-secondary" style="padding:4px 8px;color:#b91c1c;" data-formation-action="mini-suppr">✕</button>
    </div>`;
}
function ajouterBlocMini(zoneId, html) {
    const zone = document.getElementById(zoneId);
    const div = document.createElement('div');
    div.innerHTML = html;
    zone.appendChild(div.firstElementChild);
}

// Canevas officiel du livret de progression PPL(A) (phases, exercices,
// modules theoriques, prerequis, minimas 45h/25DC/10 solo).
const CANEVAS_PPL = {
    titre: 'PPL(A)',
    discipline: 'Avion',
    description: 'Livret de progression PPL(A) — formation théorique et pratique.',
    minimas: { heures: 45, vols: 0, heuresDC: 25, heuresSolo: 10, atterrissages: 0 },
    modules: ['Réglementation', 'Performance humaine', 'Météorologie', 'Communication', 'Connaissance générale de l’aéronef', 'Principes du vol', 'Navigation', 'Performances et préparation du vol', 'Procédures opérationnelles'].map(titre => ({ titre })),
    prerequis: ['Copie d’une pièce d’identité (carte d’identité ou passeport valide)', 'Attestation parentale signée (si mineur)', 'Copie du certificat médical (requis avant tout vol solo supervisé)', 'Copie de licences éventuellement détenues', 'Attestation de réussite aux examens théoriques PPL(A)'].map(titre => ({ titre })),
    lecons: [
        { id: '1A', titre: 'Maniabilité (bases)', groupe: 'Phase 1 — Maniabilité', objectif: 'Acquis avant autorisation solo', items: ['1a Familiarisation avec l’avion', '1b Exercices de secours et d’urgence', '2 Préparation pour le vol et actions après vol', '3 Familiarisation au vol : exercices en vol', '4 Effets des gouvernes', '5a Roulage au sol', '5b Urgences : panne de freins et de direction', '6 Vol horizontal rectiligne', '7 Vol en montée', '8 Vol en descente', '9 Virages'] },
        { id: '1B', titre: 'Maniabilité (avancée)', groupe: 'Phase 1 — Maniabilité', objectif: '', items: ['10a Vol lent', '10b Décrochage (2 h min sur les décrochages et l’autorotation)', '11 Évitement de l’autorotation'] },
        { id: '1C', titre: 'Tours de piste', groupe: 'Phase 1 — Maniabilité', objectif: 'Acquis avant autorisation solo', items: ['12 Décollage et montée vers la branche vent arrière', '13 Circuit, approche et atterrissage', '12/13 Urgences'] },
        { id: '1D', titre: 'Premier solo', groupe: 'Phase 1 — Maniabilité', objectif: '', items: ['14a Premier solo — tour de piste', '14b Solo — local'] },
        { id: '2A', titre: 'Perfectionnement', groupe: 'Phase 2 — Perfectionnement & navigation', objectif: '', items: ['15 Perfectionnement du virage', '16 Atterrissage forcé moteur réduit', '17 Atterrissage de précaution'] },
        { id: '2B', titre: 'Navigation', groupe: 'Phase 2 — Perfectionnement & navigation', objectif: 'Acquis avant navigation solo', items: ['18a Navigation', '18b Problèmes de navigation à basse altitude et par visibilité réduite', '18c Radionavigation'] },
        { id: '2C', titre: 'Pilotage sans visibilité (VSV)', groupe: 'Phase 2 — Perfectionnement & navigation', objectif: '', items: ['19 Pilotage de base aux instruments'] },
        { id: '2D', titre: 'Navigation solo supervisé', groupe: 'Phase 2 — Perfectionnement & navigation', objectif: 'Min 5 h dont une nav de 150 NM avec arrêts complets sur 2 aérodromes différents du départ', items: ['Navigation en vol solo supervisé — 5 h min dont 150 NM'] },
        { id: '3A', titre: 'Révisions PPL', groupe: 'Phase 3 — Révisions PPL', objectif: '', items: ['Révision « PPL(A) »'] },
        { id: '3B', titre: 'Présentation à l’examen pratique', groupe: 'Phase 3 — Révisions PPL', objectif: 'Certificat théorique de moins de 2 ans requis', items: ['Présentation à l’examen pratique « PPL(A) »'] }
    ],
    ressources: []
};

function appliquerCanevasPpl() {
    document.getElementById('edit-formation-titre').value = CANEVAS_PPL.titre;
    document.getElementById('edit-formation-discipline').value = CANEVAS_PPL.discipline;
    document.getElementById('edit-formation-description').value = CANEVAS_PPL.description;
    document.getElementById('edit-formation-heures').value = CANEVAS_PPL.minimas.heures;
    document.getElementById('edit-formation-vols').value = CANEVAS_PPL.minimas.vols || '';
    document.getElementById('edit-formation-hdc').value = CANEVAS_PPL.minimas.heuresDC;
    document.getElementById('edit-formation-hsolo').value = CANEVAS_PPL.minimas.heuresSolo;
    document.getElementById('edit-formation-att').value = CANEVAS_PPL.minimas.atterrissages || '';
    document.getElementById('editeur-modules').innerHTML = CANEVAS_PPL.modules.map(blocModuleHtml).join('');
    document.getElementById('editeur-prerequis').innerHTML = CANEVAS_PPL.prerequis.map(blocPrerequisHtml).join('');
    document.getElementById('editeur-ressources').innerHTML = CANEVAS_PPL.ressources.map(blocRessourceHtml).join('');
    document.getElementById('editeur-lecons').innerHTML = CANEVAS_PPL.lecons.map(blocLeconHtml).join('');
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
    document.getElementById('edit-formation-hdc').value = m.heuresDC ?? '';
    document.getElementById('edit-formation-hsolo').value = m.heuresSolo ?? '';
    document.getElementById('edit-formation-att').value = m.atterrissages ?? '';
    // Cas de figure : nouveau format (m.cas) ou migration de l'ancien
    // (heuresLicencie/volsLicencie -> un cas "Deja licencié").
    const cas = Array.isArray(m.cas) ? m.cas
        : (m.heuresLicencie || m.volsLicencie ? [{ nom: 'Déjà licencié', heures: m.heuresLicencie || 0, vols: m.volsLicencie || 0 }] : []);
    document.getElementById('editeur-cas').innerHTML = cas.map(blocCasHtml).join('');
    const modules = form ? formationJson(form.fields['Modules'], []) : [];
    document.getElementById('editeur-modules').innerHTML = modules.map(blocModuleHtml).join('');
    const prerequis = form ? formationJson(form.fields['Prerequis'], []) : [];
    document.getElementById('editeur-prerequis').innerHTML = prerequis.map(blocPrerequisHtml).join('');
    const ressources = form ? formationJson(form.fields['Ressources'], []) : [];
    document.getElementById('editeur-ressources').innerHTML = ressources.map(blocRessourceHtml).join('');
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
        groupe: b.querySelector('.lecon-groupe').value.trim(),
        items: b.querySelector('.lecon-items').value.split('\n').map(s => s.trim()).filter(Boolean)
    })).filter(l => l.titre || l.items.length);
    const num = (b, c, entier) => { const v = entier ? parseInt(b.querySelector(c).value, 10) : parseFloat(b.querySelector(c).value); return v || 0; };
    const cas = [...document.querySelectorAll('#editeur-cas .formation-mini-edit')].map(b => ({
        nom: b.querySelector('.cas-nom').value.trim(),
        heures: num(b, '.cas-heures'), vols: num(b, '.cas-vols', true),
        heuresDC: num(b, '.cas-hdc'), heuresSolo: num(b, '.cas-hsolo'), atterrissages: num(b, '.cas-att', true)
    })).filter(c => c.nom);
    const modules = [...document.querySelectorAll('#editeur-modules .formation-mini-edit')]
        .map(b => ({ titre: b.querySelector('.module-titre').value.trim() }))
        .filter(m => m.titre);
    const prerequis = [...document.querySelectorAll('#editeur-prerequis .formation-mini-edit')]
        .map(b => ({ titre: b.querySelector('.prerequis-titre').value.trim() }))
        .filter(p => p.titre);
    const ressources = [...document.querySelectorAll('#editeur-ressources .formation-mini-edit')]
        .map(b => ({ titre: b.querySelector('.ressource-titre').value.trim(), lien: b.querySelector('.ressource-lien').value.trim() }))
        .filter(r => r.titre || r.lien);
    const fields = {
        'Titre': titre,
        'Discipline': document.getElementById('edit-formation-discipline').value,
        'Description': document.getElementById('edit-formation-description').value.trim(),
        'Minimas': {
            heures: parseFloat(document.getElementById('edit-formation-heures').value) || 0,
            vols: parseInt(document.getElementById('edit-formation-vols').value, 10) || 0,
            heuresDC: parseFloat(document.getElementById('edit-formation-hdc').value) || 0,
            heuresSolo: parseFloat(document.getElementById('edit-formation-hsolo').value) || 0,
            atterrissages: parseInt(document.getElementById('edit-formation-att').value, 10) || 0,
            cas
        },
        'Modules': modules,
        'Prerequis': prerequis,
        'Ressources': ressources,
        'Lecons': lecons,
        'Actif': true
    };
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS)}`, {
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

// Suppression d'un suivi : efface aussi ses seances (par lots de 10).
async function supprimerSuivi(sid) {
    const suivi = (suivisCache || []).find(s => s.id === sid);
    const seances = seancesDuSuivi(sid);
    const f = suivi ? suivi.fields : {};
    if (!(await confirmerSuppression(
        `Supprimer définitivement la formation « ${f['Formation titre'] || ''} » de ${f['Élève nom'] || 'cet élève'} ?` +
        (seances.length ? `\nLes ${seances.length} séance(s) associée(s) seront aussi supprimées.` : '') +
        `\nPréférez l'archivage pour conserver l'historique.`
    ))) return;
    try {
        for (let i = 0; i < seances.length; i += 10) {
            const q = seances.slice(i, i + 10).map(s => `records[]=${encodeURIComponent(s.id)}`).join('&');
            const r = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}?${q}`, { method: 'DELETE', headers });
            if (!r.ok) throw new Error(await r.text());
        }
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SUIVIS)}?records[]=${encodeURIComponent(sid)}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error(await res.text());
        invaliderFormationCache();
        suiviOuvertId = null;
        chargerFormation();
    } catch (e) { console.error(e); alert('Erreur lors de la suppression.'); }
}

async function supprimerFormation(fid) {
    if (!(await confirmerSuppression('Supprimer cette formation du catalogue ?\nLes suivis en cours conservent leur copie des leçons.'))) return;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS)}?records[]=${fid}`, { method: 'DELETE', headers });
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
    document.getElementById('seance-type').value = 'Vol';
    document.getElementById('seance-machine').value = '';
    document.getElementById('seance-meteo').value = '';
    ['seance-hdc', 'seance-hsolo', 'seance-hsimu', 'seance-att'].forEach(id => { document.getElementById(id).value = ''; });
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

// Pre-remplit la fiche seance depuis le vol choisi : HDV reparties selon la
// fonction (EP* = double commande, P = solo), atterrissages, machine, date.
function prefillSeanceDepuisVol() {
    if (!seanceEnCours) return;
    const volId = document.getElementById('seance-vol').value;
    const vol = volId ? seanceEnCours.vols.find(v => v.id === volId) : null;
    if (!vol) return;
    const f = vol.fields;
    const minutes = typeof dureeVolMinutes === 'function' ? dureeVolMinutes(f) : 0;
    const heures = Math.round(minutes / 60 * 10) / 10;
    const fonction = String(f['Fonction'] || '').toUpperCase();
    if (fonction.startsWith('EP')) {
        document.getElementById('seance-hdc').value = heures || '';
        document.getElementById('seance-hsolo').value = '';
    } else if (fonction === 'P' || fonction.startsWith('P/')) {
        document.getElementById('seance-hsolo').value = heures || '';
        document.getElementById('seance-hdc').value = '';
    }
    if (f['Atterrissages']) document.getElementById('seance-att').value = f['Atterrissages'];
    if (f['Machine']) document.getElementById('seance-machine').value = f['Machine'];
    if (f['Date']) document.getElementById('seance-date').value = f['Date'];
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

    const hdv = id => parseFloat(document.getElementById(id).value) || 0;
    const fields = {
        'Suivi': String(suivi.id),
        'Élève': suivi.fields['Élève'] || [],
        'Élève nom': suivi.fields['Élève nom'] || '',
        'Leçon': String(leconId),
        'Leçon titre': lecon ? lecon.titre : '',
        'Vol': volId || '',
        'Vol libellé': volLibelle,
        'Date': date,
        'Type': document.getElementById('seance-type').value,
        'Machine': document.getElementById('seance-machine').value.trim(),
        'Météo': document.getElementById('seance-meteo').value.trim(),
        'HDV DC': hdv('seance-hdc'),
        'HDV solo': hdv('seance-hsolo'),
        'HDV simu': hdv('seance-hsimu'),
        'Atterrissages': parseInt(document.getElementById('seance-att').value, 10) || 0,
        'Commentaire': commentaire,
        'Items validés': valides,
        'Items reportés': reportes,
        'Leçon validée': leconValidee,
        'Signature instructeur': signatureObjet(image)
    };
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}`, {
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
    const selVol = document.getElementById('seance-vol');
    if (selVol) selVol.addEventListener('change', prefillSeanceDepuisVol);
    const fermer = (id) => { const o = document.getElementById(id); if (o) o.style.display = 'none'; };
    const liaisons = [
        ['btn-close-formation-editeur', 'modale-formation-editeur'],
        ['btn-close-formation-attribuer', 'modale-formation-attribuer'],
        ['btn-close-formation-seance', 'modale-formation-seance'],
        ['btn-close-formation-minimas', 'modale-formation-minimas'],
        ['btn-close-formation-catalogue', 'modale-formation-catalogue'],
        ['btn-close-formation-fiche', 'modale-formation-fiche']
    ];
    liaisons.forEach(([btn, mod]) => {
        const b = document.getElementById(btn);
        if (b) b.addEventListener('click', () => fermer(mod));
    });
    document.querySelectorAll('#modale-formation-editeur, #modale-formation-attribuer, #modale-formation-seance, #modale-formation-minimas, #modale-formation-catalogue, #modale-formation-fiche')
        .forEach(o => o.addEventListener('click', (e) => { if (e.target === o) o.style.display = 'none'; }));
    const f1 = document.getElementById('form-formation-editeur');
    if (f1) f1.addEventListener('submit', enregistrerFormationEdit);
    const f2 = document.getElementById('form-formation-attribuer');
    if (f2) f2.addEventListener('submit', enregistrerAttribution);
    const f3 = document.getElementById('form-formation-seance');
    if (f3) f3.addEventListener('submit', enregistrerSeance);
    const f4 = document.getElementById('form-formation-minimas');
    if (f4) f4.addEventListener('submit', enregistrerMinimas);
    const f5 = document.getElementById('form-formation-fiche');
    if (f5) f5.addEventListener('submit', enregistrerFiche);
    const btnCat = document.getElementById('btn-formation-nouvelle');
    if (btnCat) btnCat.addEventListener('click', () => ouvrirEditeurFormation(null));
    const btnLecon = document.getElementById('btn-formation-lecon-add');
    if (btnLecon) btnLecon.addEventListener('click', ajouterBlocLecon);
    const btnCas = document.getElementById('btn-formation-cas-add');
    if (btnCas) btnCas.addEventListener('click', () => ajouterBlocMini('editeur-cas', blocCasHtml({})));
    const btnPre = document.getElementById('btn-formation-prerequis-add');
    if (btnPre) btnPre.addEventListener('click', () => ajouterBlocMini('editeur-prerequis', blocPrerequisHtml({})));
    const btnRes = document.getElementById('btn-formation-ressource-add');
    if (btnRes) btnRes.addEventListener('click', () => ajouterBlocMini('editeur-ressources', blocRessourceHtml({})));
    const btnMod = document.getElementById('btn-formation-module-add');
    if (btnMod) btnMod.addEventListener('click', () => ajouterBlocMini('editeur-modules', blocModuleHtml({})));
    const btnCan = document.getElementById('btn-formation-canevas-ppl');
    if (btnCan) btnCan.addEventListener('click', appliquerCanevasPpl);
    const selForm = document.getElementById('attribuer-formation');
    if (selForm) selForm.addEventListener('change', majCasAttribution);
}
