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
    return (seancesCache || [])
        .filter(s => String(s.fields['Suivi']) === String(suiviId))
        .sort((a, b) => String(a.fields['Date'] || '').localeCompare(String(b.fields['Date'] || '')) || String(a.id).localeCompare(String(b.id)));
}
// Dernier etat connu de chaque item : 'acquis' | 'encours' | 'arefaire'.
// Compat : anciens champs 'Items validés' -> acquis, 'Items reportés' -> arefaire.
const ETATS_ITEM = { acquis: '✅', encours: '🟡', arefaire: '🔄' };
function etatsItemsSuivi(suiviId) {
    const etats = new Map();
    seancesDuSuivi(suiviId).forEach(s => {
        formationJson(s.fields['Items reportés'], []).forEach(x => etats.set(`${x.lecon}:${x.item}`, 'arefaire'));
        formationJson(s.fields['Items validés'], []).forEach(x => etats.set(`${x.lecon}:${x.item}`, 'acquis'));
        formationJson(s.fields['Items'], []).forEach(x => etats.set(`${x.lecon}:${x.item}`, x.etat));
    });
    return etats;
}
function itemsValidesSuivi(suiviId) {
    const etats = etatsItemsSuivi(suiviId);
    const ok = new Set();
    const leconsValidees = new Set();
    etats.forEach((v, k) => { if (v === 'acquis') ok.add(k); });
    seancesDuSuivi(suiviId).forEach(s => {
        if (s.fields['Leçon validée']) leconsValidees.add(String(s.fields['Leçon']));
    });
    return { ok, leconsValidees, etats };
}
// Items actuellement "a refaire" (dernier etat connu).
function itemsReportesEnAttente(suiviId) {
    const res = [];
    etatsItemsSuivi(suiviId).forEach((etat, cle) => {
        if (etat === 'arefaire') { const [lecon, item] = cle.split(':'); res.push({ lecon, item: parseInt(item, 10), etat }); }
    });
    return res;
}
function progressionSuivi(suivi) {
    const lecons = formationJson(suivi.fields['Lecons'], []);
    const { ok, leconsValidees, etats } = itemsValidesSuivi(suivi.id);
    let total = 0, faits = 0;
    lecons.forEach(l => {
        const items = l.items || [];
        items.forEach((_, i) => { total++; if (ok.has(`${l.id}:${i}`)) faits++; });
        // Une lecon est validee quand tous ses items sont acquis (auto)
        if (items.length && items.every((_, i) => ok.has(`${l.id}:${i}`))) leconsValidees.add(String(l.id));
    });
    return { total, faits, pct: total ? Math.round(faits * 100 / total) : 0, ok, leconsValidees, etats, lecons };
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
        if (suiviOuvertId) { if (!enEditionSeance) renderDetailSuivi(); return; }
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
    enEditionSeance = false;
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
        <div class="formation-docs">${modules.map(mo => {

            const fait = !!mo.statut;
            const zone = (instructeur && !fait) ? `
                <input type="date" id="module-date-${escapeHtml(mo.id)}" value="${new Date().toISOString().slice(0, 10)}" title="Date de validation" style="padding:3px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;">
                <button class="btn-primary" style="padding:4px 10px;font-size:12px;" data-formation-action="module-valide" data-sid="${suivi.id}" data-mid="${escapeHtml(mo.id)}">Valider</button>` : '';
            return `<div class="formation-doc"><span>${fait ? '✅' : '⬜'} ${escapeHtml(mo.titre)}</span>
                <span class="formation-carte-sub">${fait ? `validé le ${escapeHtml(mo.date || '')}` : 'en attente'}</span>${zone}</div>`;
        }).join('')}</div>` : '<div class="formation-vide">Aucun module.</div>';
    const ressources = formationJson(f['Ressources'], []);
    const ressourcesHtml = ressources.length ? `
        <h5 class="formation-phase-titre">📚 Documentation de la formation</h5>
        <div class="formation-docs">${ressources.map(r => {
            const lien = urlSure(r.lien || '');
            return `<div class="formation-doc">${lien
                ? `<a href="${lien}" target="_blank" rel="noopener">🔗 ${escapeHtml(r.titre || r.lien)}</a>`
                : `<span>🔗 ${escapeHtml(r.titre || '')}</span>`}</div>`;
        }).join('')}</div>` : '';
    const docsHtml = docs.length
        ? `<div class="formation-docs">${docs.map(d => renderDoc(suivi, d, instructeur)).join('')}</div>`
        : '<div class="formation-vide">Aucun document demandé.</div>';

    // Colonnes : theorique | documents | minimas (progression auto sur les seances)
    const trioHtml = `
        <div class="formation-trio">
            <div class="formation-col">
                <h4 class="formation-col-titre">📖 Formation théorique</h4>
                ${modulesHtml}
            </div>
            <div class="formation-col">
                <h4 class="formation-col-titre">📋 Documents demandés</h4>
                ${docsHtml}
                ${ressourcesHtml}
            </div>
            <div class="formation-col">
                <h4 class="formation-col-titre">⏱ Minimas requis</h4>
                <div id="${statsVolsId}" class="formation-minimas">Comptage des vols…</div>
            </div>
        </div>`;

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
        ${trioHtml}
        <h4 class="formation-sub-titre">📚 Formation pratique</h4>
        ${leconsHtml || '<div class="formation-vide">Aucune leçon définie.</div>'}
        <h4 class="formation-sub-titre">✈️ Journal des séances</h4>
        ${seancesDuSuivi(suivi.id).map(s => renderSeance(s, instructeur)).join('') || '<div class="formation-vide">Aucune séance enregistrée.</div>'}
    `;

    // Statistiques vols vs minimas (charge en arriere-plan)
    chargerStatsVols(suivi, minimas).then(html => {
        const el = document.getElementById(statsVolsId);
        if (el) el.innerHTML = html;
    });
}

// Panneau des minimas : chaque exigence avec sa progression, calculee
// automatiquement depuis les seances (HDV) et le carnet de l'eleve.
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
        const ligne = (label, val, req, enHeures) => {
            const vTxt = enHeures ? hTxt(val) : val;
            const rTxt = req ? (enHeures ? hTxt(req) : req) : null;
            const pct = req ? Math.min(100, Math.round(val * 100 / req)) : null;
            const c = pct === null ? '' : couleurProgression(pct);
            return `<div class="mini-ligne">
                <div class="mini-tete"><span>${label}</span><strong>${vTxt}${rTxt ? ` / ${rTxt}` : ''}</strong></div>
                ${pct !== null ? `<div class="mini-bar"><div class="mini-bar-fill" style="width:${pct}%;background:${c};"></div></div>` : ''}
            </div>`;
        };
        const reqH = Number(minimas.heures || 0), reqV = Number(minimas.vols || 0);
        const reqDC = Number(minimas.heuresDC || 0), reqSolo = Number(minimas.heuresSolo || 0), reqAtt = Number(minimas.atterrissages || 0);
        const lignes = [
            ligne('Heures totales', minutes / 60, reqH, true),
            ligne('Vols', nbVols, reqV, false),
            ligne('Double commande', dc, reqDC, true),
            ligne('Solo', solo, reqSolo, true),
            simu ? ligne('Simulateur', simu, 0, true) : '',
            (att || reqAtt) ? ligne('Atterrissages', att, reqAtt, false) : ''
        ].filter(Boolean);
        const aDesHdv = dc || solo || simu || att;
        return lignes.join('') +
            (aDesHdv ? '' : '<div class="formation-carte-sub">DC/solo/simu comptés depuis les séances.</div>') +
            (minimas.cas ? `<div class="formation-carte-sub" style="margin-top:6px;">Cas appliqué : « ${escapeHtml(minimas.cas)} »</div>` : '');
    } catch (e) { return '<div class="formation-carte-sub">Erreur de comptage.</div>'; }
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
        <span>${fourni ? '✅' : (d.prerequis ? '📋' : '📄')} ${escapeHtml(d.titre)}${lien}</span>
        <span class="formation-carte-sub">${infos}</span>
        ${depot}
    </div>`;
}

function renderLecon(suivi, lecon, idx, p, instructeur) {
    const items = lecon.items || [];
    const validee = p.leconsValidees.has(String(lecon.id));
    const itemsHtml = items.map((it, i) => {
        const cle = `${lecon.id}:${i}`;
        const etat = p.etats ? p.etats.get(cle) : null;
        const icone = ETATS_ITEM[etat] || '⬜';
        const cls = etat === 'acquis' ? 'formation-item-ok' : (etat === 'arefaire' ? 'formation-item-rep' : (etat === 'encours' ? 'formation-item-encours' : ''));
        return `<div class="formation-item ${cls}">${icone} ${escapeHtml(it)}</div>`;
    }).join('');
    return `
        <div class="formation-lecon ${validee ? 'formation-lecon-validee' : ''}">
            <div class="formation-lecon-tete">
                <strong>${validee ? '✅ ' : ''}Leçon ${idx + 1} — ${escapeHtml(lecon.titre || '')}</strong>
                ${lecon.objectif ? `<div class="formation-carte-sub">${escapeHtml(lecon.objectif)}</div>` : ''}
            </div>
            <div class="formation-items">${itemsHtml || '<div class="formation-carte-sub">Aucun item.</div>'}</div>
        </div>`;
}

function renderSeance(s, instructeur) {
    const f = s.fields;
    const sigI = formationJson(f['Signature instructeur'], null);
    const sigE = formationJson(f['Signature élève'], null);
    const itemsNouveau = formationJson(f['Items'], []);
    const itemsOk = formationJson(f['Items validés'], []).length + itemsNouveau.filter(x => x.etat === 'acquis').length;
    const itemsEnCours = itemsNouveau.filter(x => x.etat === 'encours').length;
    const itemsRep = formationJson(f['Items reportés'], []).length + itemsNouveau.filter(x => x.etat === 'arefaire').length;
    const comptes = [`${itemsOk} acquis`, itemsEnCours ? `${itemsEnCours} en cours` : '', itemsRep ? `${itemsRep} à refaire` : ''].filter(Boolean).join(' · ');
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
    const outils = instructeur ? `
        <button class="btn-secondary" style="padding:2px 8px;font-size:12px;margin-left:auto;" title="Modifier la séance (signatures à refaire)" data-formation-action="seance-edit" data-sid="${escapeHtml(f['Suivi'])}" data-seid="${s.id}">✏️</button>
        <button class="btn-secondary" style="padding:2px 8px;font-size:12px;color:#b91c1c;" title="Supprimer la séance" data-formation-action="seance-del" data-seid="${s.id}">🗑</button>` : '';
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
                ${outils}
            </div>
            ${vol ? `<div class="formation-carte-sub">Vol : ${escapeHtml(vol)}</div>` : ''}
            ${hdv ? `<div class="formation-carte-sub">⏱ ${escapeHtml(hdv)}</div>` : ''}
            ${f['Météo'] ? `<div class="formation-carte-sub">🌦 ${escapeHtml(f['Météo'])}</div>` : ''}
            ${comptes ? `<div class="formation-carte-sub">${escapeHtml(comptes)}</div>` : ''}
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
    else if (a === 'retour') {
        if (enEditionSeance) { enEditionSeance = false; renderDetailSuivi(); return; }
        suiviOuvertId = null;
        chargerFormation();
    }
    else if (a === 'nouveau-suivi') ouvrirModaleAttribuer();
    else if (a === 'gerer-catalogue') ouvrirGestionCatalogue();
    else if (a === 'seance') ouvrirPageSeance(sid);
    else if (a === 'item-etat') basculerEtatItem(el);
    else if (a === 'seance-save') enregistrerPageSeance();
    else if (a === 'seance-edit') ouvrirPageSeance(sid, el.dataset.seid);
    else if (a === 'seance-del') supprimerSeance(el.dataset.seid);
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
// Le select vol de la page seance est cree dynamiquement : delegation change.
document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'seance-vol') prefillSeanceDepuisVol();
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
// PAGE SEANCE (debrief plein ecran : arbre complet a gauche, formulaire a droite)
// Chaque item est marque d'un etat : acquis / en cours / a refaire.
// ---------------------------------------------------------------------------
let seanceEnCours = null; // { suiviId, vols }
let seanceEtats = new Map(); // 'lecon:item' -> 'acquis'|'encours'|'arefaire'
let enEditionSeance = false; // empeche l'auto-refresh de re-rendre le detail
let seanceEditionId = null; // null = creation, sinon id de la seance modifiee

async function ouvrirPageSeance(suiviId, seanceId) {
    const zone = document.getElementById('formation-contenu');
    const suivi = (suivisCache || []).find(s => s.id === suiviId);
    if (!zone || !suivi) return;
    suiviOuvertId = suiviId;
    enEditionSeance = true;
    seanceEditionId = seanceId || null;
    const edition = seanceId ? (seancesCache || []).find(s => s.id === seanceId) : null;
    const fe = edition ? edition.fields : {};

    // Etats pre-selectionnes en modification (nouveau champ Items,
    // sinon conversion des anciens valides/reportes).
    seanceEtats = new Map();
    if (edition) {
        const itemsN = formationJson(fe['Items'], []);
        if (itemsN.length) itemsN.forEach(x => seanceEtats.set(`${x.lecon}:${x.item}`, x.etat));
        else {
            formationJson(fe['Items validés'], []).forEach(x => seanceEtats.set(`${x.lecon}:${x.item}`, 'acquis'));
            formationJson(fe['Items reportés'], []).forEach(x => seanceEtats.set(`${x.lecon}:${x.item}`, 'arefaire'));
        }
    }

    majActionsEntete(`<button class="btn-secondary" data-formation-action="retour">← Annuler</button>`);

    const p = progressionSuivi(suivi);
    let dernierGroupe = '';
    const arbre = p.lecons.map((l, idx) => {
        const g = l.groupe || '';
        const entete = g !== dernierGroupe && g ? `<h5 class="formation-phase-titre">${escapeHtml(g)}</h5>` : '';
        dernierGroupe = g;
        const items = (l.items || []).map((it, i) => {
            const cle = `${l.id}:${i}`;
            const icone = ETATS_ITEM[p.etats.get(cle)] || '⬜';
            const sel = seanceEtats.get(cle);
            const on = e => sel === e ? ' ts-on' : '';
            return `<div class="seance-item-row" data-cle="${escapeHtml(cle)}">
                <span class="seance-item-libelle">${icone} ${escapeHtml(it)}</span>
                <span class="seance-tristate">
                    <button type="button" class="ts-btn ts-arefaire${on('arefaire')}" data-formation-action="item-etat" data-etat="arefaire">À refaire</button>
                    <button type="button" class="ts-btn ts-encours${on('encours')}" data-formation-action="item-etat" data-etat="encours">En cours</button>
                    <button type="button" class="ts-btn ts-acquis${on('acquis')}" data-formation-action="item-etat" data-etat="acquis">Acquis</button>
                </span>
            </div>`;
        }).join('');
        return `${entete}<div class="seance-lecon-bloc"><strong>Leçon ${idx + 1} — ${escapeHtml(l.titre || '')}</strong><div class="seance-lecon-items">${items}</div></div>`;
    }).join('');

    zone.innerHTML = `
    <div class="seance-page">
        <div class="seance-arbre">
            <div class="seance-arbre-titre">Items de la formation — état constaté lors de la séance</div>
            ${arbre || '<div class="formation-vide">Aucune leçon définie.</div>'}
        </div>
        <div class="seance-formulaire">
            ${edition ? `<div class="seance-edition-note">✏️ Modification — les signatures devront être refaites après enregistrement.</div>` : ''}
            <div class="seance-grid3">
                <div class="form-group">
                    <label for="seance-type">Type de séance</label>
                    <select id="seance-type">
                        <option value="Vol" ${fe['Type'] === 'Vol' ? 'selected' : ''}>Avion (vol)</option>
                        <option value="Simulateur" ${fe['Type'] === 'Simulateur' ? 'selected' : ''}>Simulateur</option>
                        <option value="Théorique" ${fe['Type'] === 'Théorique' ? 'selected' : ''}>Formation théorique</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="seance-machine">Machine / Simu</label>
                    <input type="text" id="seance-machine" placeholder="ex : C172, FNPT II" value="${escapeHtml(fe['Machine'] || '')}">
                </div>
                <div class="form-group">
                    <label for="seance-date">Date</label>
                    <input type="date" id="seance-date" value="${escapeHtml(fe['Date'] || new Date().toISOString().slice(0, 10))}">
                </div>
            </div>
            <div class="form-group">
                <label for="seance-vol">Vol associé</label>
                <select id="seance-vol"><option value="">Chargement des vols…</option></select>
            </div>
            <div class="seance-form-sous-titre">Heures de vol & atterrissages</div>
            <div class="seance-grid4">
                <div class="form-group">
                    <label for="seance-hdc">Double cmd</label>
                    <input type="number" id="seance-hdc" min="0" step="0.1" placeholder="h" value="${fe['HDV DC'] || ''}">
                </div>
                <div class="form-group">
                    <label for="seance-hsolo">Solo</label>
                    <input type="number" id="seance-hsolo" min="0" step="0.1" placeholder="h" value="${fe['HDV solo'] || ''}">
                </div>
                <div class="form-group">
                    <label for="seance-hsimu">Simulateur</label>
                    <input type="number" id="seance-hsimu" min="0" step="0.1" placeholder="h" value="${fe['HDV simu'] || ''}">
                </div>
                <div class="form-group">
                    <label for="seance-att">Atterrissages</label>
                    <input type="number" id="seance-att" min="0" step="1" value="${fe['Atterrissages'] || ''}">
                </div>
            </div>
            <div class="form-group">
                <label for="seance-meteo">Météo & infos opérationnelles</label>
                <input type="text" id="seance-meteo" placeholder="ex : BKN014 9999, vent N/NE 5-10 kt" value="${escapeHtml(fe['Météo'] || '')}">
            </div>
            <div class="form-group">
                <label for="seance-commentaire">Contenu de la séance & remarques pour l'élève</label>
                <textarea id="seance-commentaire" rows="5" placeholder="Points forts, points à retravailler…">${escapeHtml(fe['Commentaire'] || '')}</textarea>
            </div>
            <button type="button" class="btn-submit" style="width:100%;" data-formation-action="seance-save">${edition ? '✍️ Re-signer et enregistrer' : '✍️ Signer et enregistrer'}</button>
        </div>
    </div>`;

    // Vols de l'eleve en arriere-plan
    try {
        const vols = await chargerVolsEleve(suivi.fields['Élève nom'] || '');
        seanceEnCours = { suiviId, vols };
        const selVol = document.getElementById('seance-vol');
        if (selVol) {
            selVol.innerHTML = '<option value="">— Sans vol associé —</option>' + vols.slice(0, 40).map(v => {
                const f = v.fields;
                const lbl = `${f['Date'] || ''} · ${f['Départ'] || '?'}→${f['Arrivée'] || '?'} · ${f['Temps de vol'] || ''} · ${f['Machine'] || ''}`;
                return `<option value="${v.id}">${escapeHtml(lbl)}</option>`;
            }).join('');
            if (fe['Vol']) selVol.value = fe['Vol'];
        }
    } catch (e) {
        seanceEnCours = { suiviId, vols: [] };
        const selVol = document.getElementById('seance-vol');
        if (selVol) selVol.innerHTML = '<option value="">— Sans vol associé —</option>';
    }
}

// Bascule l'etat d'un item dans la page seance (reclic = deselection).
function basculerEtatItem(btn) {
    const row = btn.closest('.seance-item-row');
    if (!row) return;
    const cle = row.dataset.cle, etat = btn.dataset.etat;
    if (seanceEtats.get(cle) === etat) seanceEtats.delete(cle);
    else seanceEtats.set(cle, etat);
    row.querySelectorAll('.ts-btn').forEach(b => b.classList.toggle('ts-on', seanceEtats.get(cle) === b.dataset.etat));
}

// Pre-remplit la fiche seance depuis le vol choisi : HDV reparties selon la
// fonction (EP* = double commande, P = solo), atterrissages, machine, date.
function prefillSeanceDepuisVol() {
    if (!seanceEnCours) return;
    const selVol = document.getElementById('seance-vol');
    if (!selVol) return;
    const vol = selVol.value ? seanceEnCours.vols.find(v => v.id === selVol.value) : null;
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

async function enregistrerPageSeance() {
    const suivi = (suivisCache || []).find(s => s.id === suiviOuvertId);
    if (!suivi) return;
    const items = [...seanceEtats.entries()].map(([cle, etat]) => {
        const [lecon, item] = cle.split(':');
        return { lecon, item: parseInt(item, 10), etat };
    });
    const selVol = document.getElementById('seance-vol');
    const volId = selVol ? selVol.value : '';
    const vol = volId && seanceEnCours ? seanceEnCours.vols.find(v => v.id === volId) : null;
    const volLibelle = vol ? `${vol.fields['Date'] || ''} · ${vol.fields['Départ'] || '?'}→${vol.fields['Arrivée'] || '?'} · ${vol.fields['Temps de vol'] || ''} · ${vol.fields['Machine'] || ''}` : '';
    const commentaire = document.getElementById('seance-commentaire').value.trim();
    const date = document.getElementById('seance-date').value || new Date().toISOString().slice(0, 10);
    if (!items.length && !(await confirmerAction('Aucun item coché — enregistrer la séance quand même ?', { okLabel: 'Enregistrer', icone: '✈️' }))) return;

    const image = await ouvrirPadSignature('Signature de l\'instructeur');
    if (!image) return;

    const hdv = id => parseFloat(document.getElementById(id).value) || 0;
    const fields = {
        'Suivi': String(suivi.id),
        'Élève': suivi.fields['Élève'] || [],
        'Élève nom': suivi.fields['Élève nom'] || '',
        'Leçon': '',
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
        'Items': items,
        'Signature instructeur': signatureObjet(image)
    };
    // En modification, la signature eleve est invalidee : l'eleve devra re-signer.
    if (seanceEditionId) fields['Signature élève'] = null;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}`, {
            method: seanceEditionId ? 'PATCH' : 'POST', headers,
            body: JSON.stringify(seanceEditionId
                ? { records: [{ id: seanceEditionId, fields }] }
                : { records: [{ fields }] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ? data.error.message : 'Erreur');
        seanceEtats = new Map();
        enEditionSeance = false;
        seanceEditionId = null;
        invaliderFormationCache();
        await chargerToutesSeances(true);
        renderDetailSuivi();
    } catch (err) { console.error(err); alert('Erreur lors de l\'enregistrement de la séance.'); }
}

async function supprimerSeance(seanceId) {
    if (!(await confirmerSuppression('Supprimer cette séance ?\nLes items qu\'elle validait seront recalculés sur les autres séances.'))) return;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_FORMATIONS_SEANCES)}?records[]=${encodeURIComponent(seanceId)}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error(await res.text());
        invaliderFormationCache();
        await chargerToutesSeances(true);
        renderDetailSuivi();
    } catch (e) { console.error(e); alert('Erreur lors de la suppression.'); }
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
function initFormation() {
    const fermer = (id) => { const o = document.getElementById(id); if (o) o.style.display = 'none'; };
    const liaisons = [
        ['btn-close-formation-editeur', 'modale-formation-editeur'],
        ['btn-close-formation-attribuer', 'modale-formation-attribuer'],
        ['btn-close-formation-minimas', 'modale-formation-minimas'],
        ['btn-close-formation-catalogue', 'modale-formation-catalogue'],
        ['btn-close-formation-fiche', 'modale-formation-fiche']
    ];
    liaisons.forEach(([btn, mod]) => {
        const b = document.getElementById(btn);
        if (b) b.addEventListener('click', () => fermer(mod));
    });
    document.querySelectorAll('#modale-formation-editeur, #modale-formation-attribuer, #modale-formation-minimas, #modale-formation-catalogue, #modale-formation-fiche')
        .forEach(o => o.addEventListener('click', (e) => { if (e.target === o) o.style.display = 'none'; }));
    const f1 = document.getElementById('form-formation-editeur');
    if (f1) f1.addEventListener('submit', enregistrerFormationEdit);
    const f2 = document.getElementById('form-formation-attribuer');
    if (f2) f2.addEventListener('submit', enregistrerAttribution);
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
