/* ==========================================================================
   CARNET DE ROUTE - SAISIE ET CONSULTATION DES VOLS
   ========================================================================== */

// Table dédiée au carnet de route "pilote".
// La table "Carnet de route" existante est conservée pour le suivi horamètre/maintenance.
const TABLE_CARNET_ROUTE = 'Carnet de route Pilotes';

let listeVolsCarnetCache = [];
let idCarnetEnEdition = null;
let machineCarnetSelectionnee = 'F-GASB';
let carnetPageJVIO = 1;
let derniersRecordsCarnet = [];

// Nombre de lignes par page du carnet : adapte a la hauteur reelle de l'ecran
function lignesParPageCarnet() {
    const container = document.querySelector('.carnet-table-container');
    if (!container) return 12;
    const tbody = container.querySelector('tbody');
    const thead = container.querySelector('thead');
    // Hauteur de ligne mesuree sur une ligne de vol normale : les lignes de
    // maintenance (plus hautes) ne doivent pas faire varier la pagination
    // d'un appel a l'autre.
    const rowRef = tbody ? tbody.querySelector('tr:not(.carnet-empty):not(.carnet-row-maintenance)') : null;
    const rowH = rowRef ? rowRef.getBoundingClientRect().height : 37;
    const theadH = thead ? thead.getBoundingClientRect().height : 0;
    const reserve = 115; // tfoot + pagination + paddings bas
    const dispo = window.innerHeight - container.getBoundingClientRect().top - theadH - reserve;
    return Math.max(5, Math.floor(dispo / Math.max(rowH, 20)));
}
const IMMATS_PLANEURS = ['F-CEJX', 'F-CDYX', 'F-CITT', 'F-CEGV', 'F-CBNA', 'F-CEQJ', 'F-CDVN', 'F-CFRK', 'F-CHDT', 'F-CEQZ', 'F-CESL', 'F-CGOV'];
const REMOQUES_PLANEURS = [...IMMATS_PLANEURS.map(i => `Remorque ${i}`), 'Remorque 100LL', 'Remorque SP98'];
const MATERIEL_AUTRES = ['Tracteur landini', 'Tracteur tondeuse', 'Golfette', 'Peugeot'];
const MACHINES_PLANEUR_REMOQUE = [...IMMATS_PLANEURS, ...REMOQUES_PLANEURS, ...MATERIEL_AUTRES];
const MACHINES_MOTEURS = ['F-BLIO', 'F-GASB', 'F-JVIO'];
const CATEGORIES_CARNET = {
    'PLANEURS': { titre: 'Planeurs', items: IMMATS_PLANEURS },
    'REMORQUES': { titre: 'Remorques', items: REMOQUES_PLANEURS },
    'AUTRES': { titre: 'Autres', items: MATERIEL_AUTRES }
};
let tarifsAeronefsCache = null;

async function chargerTarifsAeronefs() {
    if (tarifsAeronefsCache !== null) return tarifsAeronefsCache;
    try {
        const tous = await fetchTousRecordsCache(`${API_BASE}/${encodeURIComponent('Aéronefs')}`, { headers });
        const cache = {};
        tous.forEach(r => {
            if (r.fields && r.fields['Immatriculation']) {
                cache[r.fields['Immatriculation']] = parseFloat(String(r.fields['Prix heure'] || '').replace(',', '.')) || 0;
            }
        });
        tarifsAeronefsCache = cache;
        return cache;
    } catch (e) {
        console.warn('Erreur chargement tarifs Aéronefs:', e);
        tarifsAeronefsCache = {};
        return {};
    }
}

function getTarifMachine(machine) {
    return tarifsAeronefsCache && tarifsAeronefsCache[machine] ? tarifsAeronefsCache[machine] : 0;
}

function horametreVersMinutes(val) {
    const total = parseFloat(String(val).replace(',', '.'));
    if (isNaN(total)) return null;
    const h = Math.floor(total);
    const m = Math.round((total - h) * 100);
    return h * 60 + m;
}

function formaterDureeMinutes(minutes) {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hrs).padStart(2, '0')}h${String(mins).padStart(2, '0')}`;
}

function dureeStringEnMinutes(str) {
    if (!str || str === '-') return 0;
    const match = String(str).match(/(\d+)h(\d+)/);
    if (!match) return 0;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function calculerTempsDeVol(horametreDepart, horametreArrivee, heureDepart, heureArrivee, machine) {
    // F-JVIO : horamètre au format H.MM (ex. 1154.17 = 1154 h 17 min)
    if (horametreDepart && horametreArrivee && machine === 'F-JVIO') {
        const dep = horametreVersMinutes(horametreDepart);
        const arr = horametreVersMinutes(horametreArrivee);
        if (dep !== null && arr !== null && arr >= dep) {
            return formaterDureeMinutes(arr - dep);
        }
    }
    // Priorité aux horamètres si les deux sont renseignés (format décimal pour les autres machines)
    if (horametreDepart && horametreArrivee) {
        const dep = parseFloat(String(horametreDepart).replace(',', '.'));
        const arr = parseFloat(String(horametreArrivee).replace(',', '.'));
        if (!isNaN(dep) && !isNaN(arr) && arr >= dep) {
            const minutes = Math.round((arr - dep) * 60);
            return formaterDureeMinutes(minutes);
        }
    }
    // Sinon, calcul à partir des heures
    if (!heureDepart || !heureArrivee) return '';
    const [hD, mD] = heureDepart.split(':').map(Number);
    const [hA, mA] = heureArrivee.split(':').map(Number);
    if (isNaN(hD) || isNaN(mD) || isNaN(hA) || isNaN(mA)) return '';
    let minutes = (hA * 60 + mA) - (hD * 60 + mD);
    if (minutes < 0) minutes += 24 * 60;
    return formaterDureeMinutes(minutes);
}

// Cle de tri carnet : date + heure de decollage (les lignes de
// maintenance n'ont pas de "Heure départ" : leur Date est un datetime ISO).
function ouvrirLegendeCodeJVIO(type) {
    const ligne = (code, label) => `<div class="legende-ligne"><strong style="min-width:110px; color:#1e3d59;">${code}</strong><span>${label}</span></div>`;
    if (type === 'fonction') {
        afficherModaleAlerte('Fonction — codes utilisés', `
            ${ligne('P', 'Pilote')}
            ${ligne('PCdB', 'Pilote + Commandant de bord')}
            ${ligne('PAX', 'Passager')}
            ${ligne('EP', 'Élève pilote')}
            ${ligne('I', 'Instructeur')}
            ${ligne('ICdB', 'Instructeur + Commandant de bord')}
            ${ligne('EX', 'Examinateur')}
            <div style="margin-top:8px; font-size:12px; color:#64748b;">Combinaisons possibles, ex. P/EP</div>
        `, '👤');
    } else {
        afficherModaleAlerte('Nature du vol — codes utilisés', `
            ${ligne('local', 'Vol local')}
            ${ligne('voyage', 'Voyage')}
            ${ligne('REV', 'Révision')}
            ${ligne('Instruction', 'Instruction')}
            ${ligne('VLO', 'VLO')}
            ${ligne('VLD', 'VLD')}
            ${ligne('Act. Part.', 'Activité Particulière — à préciser')}
            ${ligne('autre', 'Autre')}
        `, '📋');
    }
}

function brancherLegendesThJVIO(thead) {
    if (!thead) return;
    thead.querySelectorAll('.th-info-jvio').forEach(b => {
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            ouvrirLegendeCodeJVIO(b.dataset.legende);
        });
    });
}

function cleDateHeureCarnet(r) {
    const f = r.fields || {};
    if (r._estMaintenance) {
        const t = new Date(f['Date'] || 0).getTime();
        return isNaN(t) ? 0 : t;
    }
    const jour = (f['Date'] || '').slice(0, 10);
    const h = /^\d{1,2}:\d{2}/.test(f['Heure départ'] || '') ? f['Heure départ'].slice(0, 5) : '00:00';
    const t = new Date(`${jour}T${h}`).getTime();
    return isNaN(t) ? 0 : t;
}

function genererHeaderCarnet(isJVIO) {
    if (isJVIO) {
        return `
            <tr>
                <th rowspan="2">Date</th>
                <th colspan="2" class="sub-header">Équipage</th>
                <th rowspan="2" style="white-space: normal;">Fonction <button type="button" class="th-info-jvio" data-legende="fonction" title="Signification des codes">i</button></th>
                <th rowspan="2" style="white-space: normal;">Nature du vol <button type="button" class="th-info-jvio" data-legende="nature" title="Signification des codes">i</button></th>
                <th colspan="2" class="sub-header">Lieu<br><small>(LFxxxx ou OACI)</small></th>
                <th colspan="2" class="sub-header">Heures<br><small>(HH:mm en H.Loc)</small></th>
                <th class="sub-header">Cumul heures</th>
                <th colspan="2" class="sub-header">Carburant<br><small>(avant/après plein complet)</small></th>
                <th rowspan="2" style="white-space: normal;">Opérations de maintenance</th>
                <th rowspan="2" style="white-space: normal;">Commentaires / Observations</th>
            </tr>
            <tr>
                <th>Nom 1</th>
                <th>Nom 2</th>
                <th>Départ</th>
                <th>Arrivée</th>
                <th>Départ</th>
                <th>Arrivée</th>
                <th>Horamètre arrivée</th>
                <th>Départ</th>
                <th>Arrivée</th>
            </tr>
        `;
    }
    return `
        <tr>
            <th rowspan="2">Date</th>
            <th rowspan="2">Équipage</th>
            <th rowspan="2">Fonction</th>
            <th colspan="2" class="sub-header">Lieu</th>
            <th colspan="2" class="sub-header">Heures</th>
            <th rowspan="2">Temps</th>
            <th rowspan="2">Nature</th>
            <th colspan="2" class="sub-header">Carburant</th>
            <th colspan="2" class="sub-header">Huile</th>
            <th rowspan="2">Observations</th>
            <th rowspan="2">Horamètre</th>
        </tr>
        <tr>
            <th>départ</th>
            <th>arrivée</th>
            <th>départ</th>
            <th>arrivée</th>
            <th>Départ</th>
            <th>Arr.</th>
            <th>Départ</th>
            <th>Arr.</th>
        </tr>
    `;
}

function estProprietaireVolCarnet(record) {
    if (typeof currentUser === 'undefined' || !currentUser || !record || !record.fields) return false;
    const f = record.fields;
    const moi = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    const tester = (nom) => {
        const n = (nom || '').toString().trim();
        if (!n) return false;
        if (typeof estUtilisateurCourant === 'function' && estUtilisateurCourant(n)) return true;
        if (typeof correspondanceNom === 'function' && (correspondanceNom(n, moi)
            || (typeof nomPiloteCourant === 'function' && correspondanceNom(n, nomPiloteCourant())))) return true;
        return n.toLowerCase() === moi.toLowerCase();
    };
    return tester(f['Pilote']) || tester(f['Instructeur']);
}

function peutModifierVolCarnet(record) {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    const roles = currentUser.roles || [];
    if (roles.includes('Super admin') || roles.includes('Super Admin')) return true;
    if (roles.some(r => /instructeur/i.test(r || ''))) return true;
    return estProprietaireVolCarnet(record);
}

function estMecanicienRestreint() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    const roles = currentUser.roles || [];
    if (roles.includes('Super admin') || roles.includes('Super Admin')) return false;
    if (roles.some(r => /instructeur/i.test(r || ''))) return false;
    return roles.includes('Mécanicien') || roles.includes('Mecanicien');
}

function definirLectureSeuleCarnet(actif) {
    const form = document.getElementById('carnet-form');
    if (!form) return;
    form.querySelectorAll('input, select, textarea').forEach(el => {
        if (el.type === 'hidden') return;
        el.disabled = !!actif;
    });
    const btnSave = form.querySelector('.btn-submit');
    if (btnSave) btnSave.style.display = actif ? 'none' : '';
}

function estSuperAdminCarnet() {
    const roles = (typeof currentUser !== 'undefined' && currentUser && currentUser.roles) || [];
    return roles.includes('Super admin') || roles.includes('Super Admin');
}

// Rapprochement GVV : vols saisis directement dans GVV (hors de l'app) →
// pastille « GVV » bleue sur la ligne du carnet (verte = envoyé depuis l'app).
// Certitude par horametre : compteur debut ET compteur fin identiques a
// ±0,005 h, plus meme pilote/date/machine — quasi impossible a confondre.
let clesGvvVols = null;
let gvvEnCours = null;

function normNomGvv(s) {
    return (s || '').toString().toLowerCase().normalize('NFD')
        .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ')
        .split(' ').filter(Boolean).sort().join(' ');
}

async function chargerEcrituresGvv() {
    if (gvvEnCours) return gvvEnCours;
    gvvEnCours = (async () => {
        try {
            const url = `${API_BASE}/${encodeURIComponent('Vols GVV')}?pageSize=100`;
            const records = await fetchTousRecordsCache(url, { headers }, 0, true);
            clesGvvVols = records.map(r => {
                const f = r.fields || {};
                return {
                    compte: normNomGvv(f['Pilote']),
                    pilote: (f['Pilote'] || '').toString(),
                    date: f['Date'] || '',
                    immat: (f['Machine'] || '').toString().trim().toUpperCase(),
                    deb: parseFloat(f['Compteur début']),
                    fin: parseFloat(f['Compteur fin'])
                };
            }).filter(v => !isNaN(v.deb) && !isNaN(v.fin));
        } catch (e) {
            console.warn('Vols GVV:', e);
            clesGvvVols = [];
        } finally {
            // Pas de verrou « charge » : chaque affichage du carnet relance le
            // fetch (la table grossit a chaque synchro quotidienne).
            gvvEnCours = null;
        }
    })();
    return gvvEnCours;
}

// Noms compatibles : jetons identiques, ou un jeton tronque accepte comme
// prefixe du jeton complet (« Benjamin Q. » = « QUONIAM Benjamin »).
function nomsGvvCompatibles(nomA, nomB) {
    const ta = normNomGvv(nomA).split(' ').filter(Boolean);
    const tb = normNomGvv(nomB).split(' ').filter(Boolean);
    if (ta.join(' ') === tb.join(' ')) return true;
    return ta.length === tb.length && ta.every((t, i) => t === tb[i] || tb[i].startsWith(t) || t.startsWith(tb[i]));
}

function volExisteDansGvv(f) {
    if (!clesGvvVols || f['GVV ID']) return false;
    const hd = parseFloat(String(f['Horamètre départ']).replace(',', '.'));
    const ha = parseFloat(String(f['Horamètre arrivée']).replace(',', '.'));
    if (isNaN(hd) || isNaN(ha)) return false;
    const date = f['Date'] || '';
    const immat = (f['Machine'] || '').toString().trim().toUpperCase();
    // Le « pilote » cote GVV est en fait le payeur du vol : il peut etre le
    // pilote, l'instructeur ou le passager cote carnet — on teste l'equipage.
    const equipage = [f['Pilote'], f['Instructeur'], f['Passager'], f['Élève']]
        .filter(n => (n || '').toString().trim());
    return clesGvvVols.some(e =>
        equipage.some(n => nomsGvvCompatibles(n, e.pilote)) && e.date === date && e.immat === immat
        && Math.abs(e.deb - hd) <= 0.005 && Math.abs(e.fin - ha) <= 0.005);
}

// Vols groupes : plusieurs lignes contigues du carnet (navigation aller/retour,
// remorquage avec refuel) correspondent a UN seul vol GVV dont le compteur
// debut = depart de la 1re ligne et le compteur fin = arrivee de la derniere.
function volExisteDansGvvGroupe(f, recordsData) {
    if (!clesGvvVols || f['GVV ID'] || !recordsData) return false;
    const parse = x => parseFloat(String(x).replace(',', '.'));
    const hd = parse(f['Horamètre départ']), ha = parse(f['Horamètre arrivée']);
    if (isNaN(hd) || isNaN(ha)) return false;
    const date = f['Date'] || '';
    const immat = (f['Machine'] || '').toString().trim().toUpperCase();
    const jour = recordsData.map(d => d.f || {})
        .filter(x => (x['Date'] || '') === date
            && (x['Machine'] || '').toString().trim().toUpperCase() === immat
            && !x['GVV ID'] && !x['Saisi dans GVV']
            && !isNaN(parse(x['Horamètre départ'])) && !isNaN(parse(x['Horamètre arrivée'])))
        .sort((a, b) => parse(a['Horamètre départ']) - parse(b['Horamètre départ']));
    const idx = jour.indexOf(f);
    if (idx < 0) return false;
    const deb = x => parse(x['Horamètre départ']);
    const fin = x => parse(x['Horamètre arrivée']);
    // La chaine ne groupe que les lignes du MEME pilote : les horametres
    // s'enchainent d'un vol a l'autre, sans quoi on fusionnerait des vols
    // de pilotes differents (erreur constatee : pas de match GVV global).
    const piloteOk = x => nomsGvvCompatibles(x['Pilote'], f['Pilote']);
    let l = idx, r = idx;
    while (l > 0 && piloteOk(jour[l - 1]) && Math.abs(fin(jour[l - 1]) - deb(jour[l])) <= 0.005) l--;
    while (r < jour.length - 1 && piloteOk(jour[r + 1]) && Math.abs(deb(jour[r + 1]) - fin(jour[r])) <= 0.005) r++;
    if (l === r) return false;
    const groupe = jour.slice(l, r + 1);
    const gDeb = deb(groupe[0]);
    const gFin = fin(groupe[groupe.length - 1]);
    const equipage = [...new Set(groupe.flatMap(x =>
        [x['Pilote'], x['Instructeur'], x['Passager'], x['Élève']]
            .filter(n => (n || '').toString().trim())))];
    return clesGvvVols.some(e =>
        equipage.some(n => nomsGvvCompatibles(n, e.pilote)) && e.date === date && e.immat === immat
        && Math.abs(e.deb - gDeb) <= 0.005 && Math.abs(e.fin - gFin) <= 0.005);
}

function badgeGvvCarnet(f, recordsData) {
    if (f['GVV ID']) return ` <span class="badge-gvv" title="Envoyé à GVV (#${f['GVV ID']})">GVV</span>`;
    if (f['Saisi dans GVV']) return ' <span class="badge-gvv badge-gvv-bleu" title="Marqué comme saisi manuellement dans GVV">GVV</span>';
    if (volExisteDansGvv(f)) return ' <span class="badge-gvv badge-gvv-bleu" title="Vol déjà saisi dans GVV (hors de l\'application)">GVV</span>';
    if (volExisteDansGvvGroupe(f, recordsData)) return ' <span class="badge-gvv badge-gvv-bleu" title="Vol déjà saisi dans GVV en une seule écriture couvrant plusieurs lignes du carnet">GVV</span>';
    return '';
}

// Bouton "⇒ GVV" (super admin, machines moteur) ou badge si deja envoye
function majBoutonGvvCarnet(record) {
    const btn = document.getElementById('btn-gvv-carnet');
    const statut = document.getElementById('carnet-gvv-statut');
    const f = record && record.fields ? record.fields : null;
    const gvvId = f && f['GVV ID'];
    const machine = f ? (f['Machine'] || '') : '';
    const eligible = !!(f && record && record.id && estSuperAdminCarnet() && MACHINES_MOTEURS.includes(machine));
    const saisiManuel = !!(f && f['Saisi dans GVV']);
    if (btn) btn.style.display = (eligible && !gvvId && !saisiManuel) ? 'inline-block' : 'none';
    const btnManuel = document.getElementById('btn-gvv-manuel-carnet');
    if (btnManuel) btnManuel.style.display = (eligible && !gvvId && !saisiManuel) ? 'inline-block' : 'none';
    if (statut) {
        statut.style.display = (gvvId || saisiManuel) ? 'inline-block' : 'none';
        statut.textContent = gvvId ? `✓ Envoyé à GVV (#${gvvId})` : (saisiManuel ? '✓ Saisi dans GVV' : '');
    }
}

// Marque le vol comme saisi manuellement dans GVV (pastille bleue permanente,
// bloque un futur envoi ⇒ GVV qui creerait un doublon).
async function marquerVolSaisiGvv() {
    if (!idCarnetEnEdition) return;
    const record = listeVolsCarnetCache.find(r => r.id === idCarnetEnEdition);
    const f = record && record.fields ? record.fields : {};
    if (!estSuperAdminCarnet()) {
        alert('Action réservée aux super admin.');
        return;
    }
    const d = f['Date'] ? new Date(f['Date']).toLocaleDateString('fr-FR') : '?';
    const recap = `${f['Pilote'] || '?'} — ${f['Machine'] || '?'} — ${d}`;
    if (!(await confirmerAction(`Marquer ce vol comme saisi manuellement dans GVV ?\n\n${recap}\n\nLa pastille « GVV » bleue s'affichera sur la ligne et l'envoi ⇒ GVV sera bloqué.`, { okLabel: 'Marquer', icone: '✓', danger: false }))) return;
    const btn = document.getElementById('btn-gvv-manuel-carnet');
    try {
        if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_CARNET_ROUTE)}/${idCarnetEnEdition}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { 'Saisi dans GVV': true } })
        });
        if (!res.ok) throw new Error((await res.json()).error?.message || 'Erreur serveur');
        f['Saisi dans GVV'] = true;
        majBoutonGvvCarnet(record);
        chargerCarnetRoute();
    } catch (e) {
        console.error(e);
        alert('Erreur : ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '✓ Déjà dans GVV'; }
    }
}

async function envoyerVolVersGvv() {
    if (!idCarnetEnEdition) return;
    const record = listeVolsCarnetCache.find(r => r.id === idCarnetEnEdition);
    const f = record && record.fields ? record.fields : {};
    if (!estSuperAdminCarnet()) {
        alert('Envoi vers GVV réservé aux super admin.');
        return;
    }
    if (f['GVV ID']) {
        alert(`Ce vol a déjà été envoyé à GVV (#${f['GVV ID']}).`);
        return;
    }
    const d = f['Date'] ? new Date(f['Date']).toLocaleDateString('fr-FR') : '?';
    const recap = `${f['Pilote'] || '?'} — ${f['Machine'] || '?'} — ${d} — ${f['Temps de vol'] || 'durée inconnue'}`;
    if (!(await confirmerAction(`Envoyer ce vol vers GVV ?\n\n${recap}\n\nGVV créera l'écriture comptable correspondante sur le compte du payeur.`, { okLabel: 'Envoyer', icone: '📤', danger: false }))) return;
    const btn = document.getElementById('btn-gvv-carnet');
    try {
        if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }
        const res = await apiFetch(`${API_BASE}/gvv-vol`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ recordId: idCarnetEnEdition })
        });
        const data = await res.json();
        if (!res.ok) throw new Error((data && data.error && data.error.message) || 'Erreur envoi GVV');
        f['GVV ID'] = data.gvvId || '';
        f['Envoyé GVV le'] = new Date().toISOString();
        if (typeof viderApiCache === 'function') viderApiCache();
        majBoutonGvvCarnet(record);
        chargerCarnetRoute();
        alert(`Vol envoyé à GVV${data.gvvId ? ` (vol #${data.gvvId})` : ''}.`);
    } catch (e) {
        console.error(e);
        alert('Envoi GVV impossible : ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '⇒ GVV'; }
    }
}

async function ouvrirModaleCarnet(recordId = null, machineImmat = null) {
    const modal = document.getElementById('carnet-modal');
    const form = document.getElementById('carnet-form');
    const titre = modal ? modal.querySelector('h3') : null;
    if (!modal || !form) return;
    form.reset();
    definirLectureSeuleCarnet(false);
    idCarnetEnEdition = recordId || null;
    const recordEdit = recordId ? listeVolsCarnetCache.find(r => r.id === recordId) : null;
    const lectureSeule = !!(recordEdit && !peutModifierVolCarnet(recordEdit));
    const btnDelete = document.getElementById('btn-delete-carnet');
    const dateInput = document.getElementById('carnet-date');
    const selectMachine = document.getElementById('carnet-machine');
    const selectFiltre = document.getElementById('carnet-machine-filtre');
    const departInput = document.getElementById('carnet-depart');
    const arriveeInput = document.getElementById('carnet-arrivee');
    const heureDepart = document.getElementById('carnet-heure-depart');
    const heureArrivee = document.getElementById('carnet-heure-arrivee');
    const decAt = document.getElementById('carnet-decol-atterr');
    if (titre) titre.textContent = recordId
        ? (lectureSeule ? 'Détail du vol (lecture seule)' : 'Modifier un vol')
        : (machineImmat ? 'Nouvelle observation' : 'Saisir un vol');
    if (btnDelete) btnDelete.style.display = (recordId && !lectureSeule) ? 'inline-block' : 'none';
    majBoutonGvvCarnet(recordEdit);
    if (dateInput) dateInput.value = new Date().toLocaleDateString('en-CA');
    if (departInput) departInput.value = 'LFOY';
    if (arriveeInput) arriveeInput.value = 'LFOY';

    const record = recordEdit;
    const extraMachine = machineImmat || (record && record.fields ? record.fields['Machine'] : null);
    const filtreMachine = document.getElementById('carnet-machine-filtre');
    const machineCible = extraMachine || (filtreMachine ? filtreMachine.value : 'F-GASB');

    const piloteDefaut = `${currentUser?.prenom || ''} ${currentUser?.nom || ''}`.trim() || (typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '');
    const piloteCible = recordId ? (record.fields?.['Pilote'] || '') : piloteDefaut;
    await peuplerPilotesSelect(piloteCible);

    const instructeurCible = recordId ? (record.fields?.['Instructeur'] || '') : '';
    await peuplerCarnetInstructeurs(instructeurCible, machineCible);

    peuplerOptionsMachineCarnet(extraMachine);

    if (machineImmat) {
        form.dataset.mode = 'observation';
        if (heureDepart) heureDepart.value = '00:00';
        if (heureArrivee) heureArrivee.value = '00:00';
        if (decAt) decAt.value = '0';
        if (selectMachine) selectMachine.value = machineImmat;
        if (selectMachine) adapterFormulaireCarnet(machineImmat);
        mettreAJourStyleChampsAuto(machineImmat);
        const obs = document.getElementById('carnet-observations');
        setTimeout(() => { if (obs) obs.focus(); }, 50);
    } else {
        form.dataset.mode = 'vol';
        if (selectMachine && selectFiltre && selectMachine.querySelector(`option[value="${selectFiltre.value}"]`)) {
            selectMachine.value = selectFiltre.value;
        }
        if (selectMachine) adapterFormulaireCarnet(selectMachine.value);
        mettreAJourStyleChampsAuto(selectMachine ? selectMachine.value : 'F-GASB');
        if (!recordId) cocherFonctionParDefaut();
    }
    modal.classList.toggle('carnet-modal-observation', form.dataset.mode === 'observation');
    document.getElementById('carnet-id').value = recordId || '';
    if (recordId) {
        const record = listeVolsCarnetCache.find(r => r.id === recordId);
        if (record && record.fields) remplirFormulaireCarnet(record.fields);
    } else if (selectMachine && form.dataset.mode !== 'observation') {
        mettreAJourDonneesDepartDefaut(selectMachine.value);
        suggererNatureParTrajet();
        mettreAJourHeureArrivee();
        mettreAJourActiviteParticuliere();
        mettreAJourPrixDuVol();
        syncNatureChips();
    }
    if (lectureSeule) definirLectureSeuleCarnet(true);
    const sidebar = document.querySelector('.sidebar');
    const sidebarWidth = sidebar ? sidebar.getBoundingClientRect().width : 170;
    modal.style.setProperty('--carnet-modal-left', `${sidebarWidth}px`);
    modal.style.display = 'flex';
}

function fermerModaleCarnet() {
    const modal = document.getElementById('carnet-modal');
    if (modal) modal.style.display = 'none';
    idCarnetEnEdition = null;
    const btnDelete = document.getElementById('btn-delete-carnet');
    if (btnDelete) btnDelete.style.display = 'none';
    majBoutonGvvCarnet(null);
}

function remplirFormulaireCarnet(f) {
    const pilote = f['Pilote'] || (typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim());
    document.getElementById('carnet-date').value = f['Date'] ? (f['Date'].split('T')[0] || '') : '';
    const machine = f['Machine'] || 'F-GASB';
    document.getElementById('carnet-machine').value = machine;
    adapterFormulaireCarnet(machine);
    const piloteInput = document.getElementById('carnet-pilote');
    if (piloteInput) piloteInput.value = pilote;
    const instSel = document.getElementById('carnet-instructeur');
    if (instSel) instSel.value = f['Instructeur'] || '';
    document.getElementById('carnet-depart').value = f['Départ'] || 'LFOY';
    document.getElementById('carnet-arrivee').value = f['Arrivée'] || 'LFOY';
    document.getElementById('carnet-heure-depart').value = f['Heure départ'] || '';
    document.getElementById('carnet-heure-arrivee').value = f['Heure arrivée'] || '';
    const nature = document.getElementById('carnet-nature');
    if (nature) {
        nature.value = f['Nature'] || (machine === 'F-JVIO' ? 'local' : 'Autre');
        if (!nature.value && nature.options.length) nature.value = nature.options[0].value;
    }
    const cbDep = parseCarburant(f['Carburant départ']);
    const cbArr = parseCarburant(f['Carburant arrivée']);
    document.getElementById('carnet-carburant-depart').value = cbDep.q;
    document.getElementById('carnet-carburant-arrivee').value = cbArr.q;
    const pcDep = document.getElementById('carnet-pc-depart');
    const pcArr = document.getElementById('carnet-pc-arrivee');
    if (pcDep) pcDep.checked = cbDep.pc;
    if (pcArr) pcArr.checked = cbArr.pc;
    const maintEl = document.getElementById('carnet-maintenance');
    if (maintEl) maintEl.value = f['Maintenance'] || '';
    if (machine !== 'F-JVIO') {
        document.getElementById('carnet-huile-depart').value = f['Huile départ'] || '';
        document.getElementById('carnet-huile-arrivee').value = f['Huile arrivée'] || '';
        restaurerDetailNatureStd(f['Précision activité'] || '');
    }
    document.getElementById('carnet-horametre-depart').value = f['Horamètre départ'] || '';
    document.getElementById('carnet-horametre-arrivee').value = f['Horamètre arrivée'] || '';
    document.getElementById('carnet-observations').value = f['Observations'] || '';
    const activiteDetail = document.getElementById('carnet-activite-detail');
    if (activiteDetail) activiteDetail.value = machine === 'F-JVIO' ? (f['Précision activité'] || '') : '';
    const decAt = document.getElementById('carnet-decol-atterr');
    if (decAt) decAt.value = (f['Décollages'] === 0 || f['Décollages']) ? f['Décollages'] : '1';
    const fonctions = (f['Fonction'] || '').split('/').map(x => x.trim());
    document.querySelectorAll('input[name="carnet-fonction"]').forEach(cb => {
        cb.checked = fonctions.includes(cb.value);
    });
    mettreAJourStyleChampsAuto(machine);
    mettreAJourHeureArrivee();
    mettreAJourActiviteParticuliere();
    mettreAJourPrixDuVol();
    syncNatureChips();
}

let carnetInstructeursCache = [];
let carnetPilotesCache = [];

async function peuplerPilotesSelect(pilote = '') {
    const sel = document.getElementById('carnet-pilote');
    if (!sel) return;
    const defaut = pilote || `${currentUser?.prenom || ''} ${currentUser?.nom || ''}`.trim() || (typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : '');
    const ROLES_INSTRUCTEUR = ['Instructeur avion', 'Instructeur planeur', 'Instructeur ULM'];
    const peutChoisir = currentUser && Array.isArray(currentUser.roles) && (
        currentUser.roles.includes('Super admin') ||
        currentUser.roles.some(r => ROLES_INSTRUCTEUR.includes(r))
    );
    try {
        if (peutChoisir && !carnetPilotesCache.length) {
            const table = typeof TABLE_UTILISATEURS !== 'undefined' ? TABLE_UTILISATEURS : 'Utilisateurs';
            const tous = await fetchTousRecordsCache(`${API_BASE}/${encodeURIComponent(table)}?sort[0][field]=Nom&sort[0][direction]=asc&pageSize=100`, { headers });
            carnetPilotesCache = tous.map(r => {
                const f = r.fields || {};
                return `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
            }).filter(Boolean);
        }
        const noms = peutChoisir ? [...carnetPilotesCache] : [];
        if (defaut && !noms.some(n => normaliserNom(n) === normaliserNom(defaut))) noms.push(defaut);
        sel.innerHTML = '';
        noms.forEach(nom => {
            const opt = document.createElement('option');
            opt.value = nom;
            opt.textContent = nom;
            sel.appendChild(opt);
        });
        sel.disabled = !peutChoisir;
        if (defaut) sel.value = defaut;
    } catch (err) {
        console.error('Erreur chargement pilotes:', err);
        sel.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = defaut;
        opt.textContent = defaut;
        sel.appendChild(opt);
        sel.disabled = !peutChoisir;
        sel.value = defaut;
    }
}

async function peuplerCarnetInstructeurs(instructeur = '', machine = '') {
    const sel = document.getElementById('carnet-instructeur');
    if (!sel) return;
    const isJVIO = machine === 'F-JVIO';
    try {
        if (isJVIO) {
            // Equipage 2 peut etre n'importe quel membre (instructeur,
            // copilote, passager...) — la liste est chargee directement,
            // independamment du droit de choisir le pilote (peuplerPilotesSelect
            // ne remplit carnetPilotesCache que pour les admins/instructeurs,
            // sinon Equipage 2 restait limite au membre connecte).
            if (!carnetPilotesCache.length) {
                const table = typeof TABLE_UTILISATEURS !== 'undefined' ? TABLE_UTILISATEURS : 'Utilisateurs';
                const tous = await fetchTousRecordsCache(`${API_BASE}/${encodeURIComponent(table)}?sort[0][field]=Nom&sort[0][direction]=asc&pageSize=100`, { headers });
                carnetPilotesCache = tous.map(r => {
                    const f = r.fields || {};
                    return `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
                }).filter(Boolean);
            }
            let noms = [...carnetPilotesCache];
            if (!noms.length) {
                const piloteSel = document.getElementById('carnet-pilote');
                if (piloteSel && piloteSel.options.length) {
                    noms = [...piloteSel.options].map(o => o.value).filter(Boolean);
                }
            }
            if (instructeur && !noms.includes(instructeur)) noms.push(instructeur);
            sel.innerHTML = '<option value="">-- Aucun --</option>';
            noms.forEach(nom => {
                const opt = document.createElement('option');
                opt.value = nom;
                opt.textContent = nom;
                sel.appendChild(opt);
            });
        } else {
            const ROLES_INSTRUCTEUR = ['Instructeur avion', 'Instructeur planeur', 'Instructeur ULM'];
            if (!carnetInstructeursCache.length) {
                const table = typeof TABLE_UTILISATEURS !== 'undefined' ? TABLE_UTILISATEURS : 'Utilisateurs';
                const tous = await fetchTousRecordsCache(`${API_BASE}/${encodeURIComponent(table)}?sort[0][field]=Nom&sort[0][direction]=asc&pageSize=100`, { headers });
                carnetInstructeursCache = tous.filter(r => {
                    const roles = Array.isArray(r.fields?.['Rôles']) ? r.fields['Rôles'] : [r.fields?.['Rôles']].filter(Boolean);
                    return roles.some(role => ROLES_INSTRUCTEUR.includes(role));
                });
            }
            const noneOption = sel.querySelector('option[value=""]');
            sel.innerHTML = noneOption ? noneOption.outerHTML : '<option value="">-- Aucun --</option>';
            carnetInstructeursCache.forEach(r => {
                const f = r.fields || {};
                const nomComplet = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim() || 'Instructeur';
                const opt = document.createElement('option');
                opt.value = nomComplet;
                opt.textContent = nomComplet;
                if (instructeur && (nomComplet === instructeur || f['Nom'] === instructeur || f['Prénom'] === instructeur)) opt.selected = true;
                sel.appendChild(opt);
            });
            if (instructeur && ![...sel.options].some(o => o.value === instructeur)) {
                const opt = document.createElement('option');
                opt.value = instructeur;
                opt.textContent = instructeur;
                sel.appendChild(opt);
            }
        }
        if (instructeur) sel.value = instructeur;
    } catch (err) {
        console.error('Erreur chargement instructeurs:', err);
        sel.innerHTML = `<option value="">-- Aucun --</option>${instructeur ? `<option value="${escHtml(instructeur)}">${escHtml(instructeur)}</option>` : ''}`;
    }
}

// Pré-remplit horamètre départ / terrain de départ avec le vol
// chronologiquement precedent la date (et heure) saisies — pas forcement
// le dernier vol du carnet pour une saisie passee. Les champs marques
// "auto" sont remis a jour tant que l'utilisateur ne les a pas modifies.
function mettreAJourDonneesDepartDefaut(machine, forcer = false) {
    const hInput = document.getElementById('carnet-horametre-depart');
    const tInput = document.getElementById('carnet-depart');
    const jour = (document.getElementById('carnet-date')?.value || '').slice(0, 10);
    const heureVal = document.getElementById('carnet-heure-depart')?.value || '';
    const heure = /^\d{1,2}:\d{2}/.test(heureVal) ? heureVal.slice(0, 5) : '00:00';
    const cleRef = jour ? new Date(`${jour}T${heure}`).getTime() : Infinity;
    const precedent = (listeVolsCarnetCache || [])
        .filter(r => (r.fields || {})['Machine'] === machine && !r._estMaintenance)
        .filter(r => cleDateHeureCarnet(r) < (isNaN(cleRef) ? Infinity : cleRef))
        .sort((a, b) => cleDateHeureCarnet(a) - cleDateHeureCarnet(b))
        .pop();
    if (!precedent) return;
    const dernier = precedent.fields || {};
    const arr = dernier['Horamètre arrivée'];
    if (hInput && (forcer || hInput.dataset.auto === '1' || !hInput.value) && arr !== undefined && arr !== null && arr !== '') {
        hInput.value = arr;
        hInput.dataset.auto = '1';
    }
    if (tInput && (forcer || tInput.dataset.auto === '1' || !tInput.value) && dernier['Arrivée']) {
        tInput.value = dernier['Arrivée'];
        tInput.dataset.auto = '1';
    }
}

function formaterNombre(n) {
    if (n === null || n === undefined || n === '') return '';
    const parsed = parseFloat(n);
    return isNaN(parsed) ? '' : parsed.toLocaleString('fr-FR');
}

function afficherCarburant(v) {
    if (v === null || v === undefined || v === '') return '-';
    const val = String(v).trim();
    if (val.toUpperCase().includes('PC')) return val;
    const compact = val.replace(/\s/g, '');
    if (/^[0-9]*[.,]?[0-9]+$/.test(compact)) {
        const n = parseFloat(compact.replace(',', '.'));
        return n === 0 ? '-' : `+${formaterNombre(n)}L`;
    }
    return val;
}

function afficherHuile(v) {
    if (v === null || v === undefined || v === '') return '-';
    const val = String(v).trim();
    if (val.toUpperCase().includes('L') || val.toUpperCase().includes('PC')) return val;
    const n = parseFloat(val.replace(',', '.'));
    if (!isNaN(n)) {
        if (n === 0) return '-';
        return `+${formaterNombre(v)}L`;
    }
    return val;
}

function parseCarburant(v) {
    if (v === null || v === undefined || v === '') return { q: '', pc: false };
    const str = String(v).trim();
    const pc = str.toUpperCase().includes('PC');
    const q = str
        .replace(/\+\s*/g, '')
        .replace(/L\b/ig, '')
        .replace(/PC/ig, '')
        .trim();
    return { q, pc };
}

function dureeHorametreMinutes(machine, horametreDepart, horametreArrivee) {
    if (!horametreDepart || !horametreArrivee) return null;
    if (machine === 'F-JVIO') {
        const dep = horametreVersMinutes(horametreDepart);
        const arr = horametreVersMinutes(horametreArrivee);
        if (dep === null || arr === null || arr < dep) return null;
        return arr - dep;
    }
    const dep = parseFloat(String(horametreDepart).replace(',', '.'));
    const arr = parseFloat(String(horametreArrivee).replace(',', '.'));
    if (isNaN(dep) || isNaN(arr) || arr < dep) return null;
    return Math.round((arr - dep) * 60);
}

function ajouterMinutes(heure, minutes) {
    if (!heure || minutes === null || isNaN(minutes)) return null;
    const [h, m] = heure.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    let total = (h * 60 + m + minutes) % (24 * 60);
    if (total < 0) total += 24 * 60;
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function mettreAJourActiviteParticuliere() {
    const nature = document.getElementById('carnet-nature').value;
    const group = document.getElementById('carnet-activite-detail-group');
    const input = document.getElementById('carnet-activite-detail');
    if (!group || !input) return;
    if (nature === 'Activité Particulière') {
        group.style.display = '';
        if (!input.value) input.value = 'Remorquage';
    } else {
        group.style.display = 'none';
    }
}

async function mettreAJourPrixDuVol() {
    const input = document.getElementById('carnet-prix-vol');
    if (!input) return;
    const machine = document.getElementById('carnet-machine').value;
    const nature = document.getElementById('carnet-nature').value;
    if (machine === 'F-BLIO') {
        input.value = '';
        return;
    }
    if (nature === 'VLD') {
        input.value = '0,00 €';
        return;
    }
    await chargerTarifsAeronefs();
    const tarif = getTarifMachine(machine);
    if (!tarif) {
        input.value = '—';
        return;
    }
    const heureDepart = document.getElementById('carnet-heure-depart').value;
    const heureArrivee = document.getElementById('carnet-heure-arrivee').value;
    const hDep = document.getElementById('carnet-horametre-depart').value;
    const hArr = document.getElementById('carnet-horametre-arrivee').value;
    let minutes = 0;
    const dureeHora = dureeHorametreMinutes(machine, hDep, hArr);
    if (dureeHora !== null && dureeHora > 0) {
        minutes = dureeHora;
    } else if (heureDepart && heureArrivee) {
        const [hD, mD] = heureDepart.split(':').map(Number);
        const [hA, mA] = heureArrivee.split(':').map(Number);
        if (!isNaN(hD) && !isNaN(mD) && !isNaN(hA) && !isNaN(mA)) {
            minutes = (hA * 60 + mA) - (hD * 60 + mD);
            if (minutes < 0) minutes += 24 * 60;
        }
    }
    if (minutes <= 0) {
        input.value = '—';
        return;
    }
    const prix = (minutes / 60) * tarif;
    input.value = prix.toFixed(2).replace('.', ',') + ' €';
}

function mettreAJourStyleChampsAuto(machine) {
    const heureArrivee = document.getElementById('carnet-heure-arrivee');
    const horametreDepart = document.getElementById('carnet-horametre-depart');
    const isMoteur = machine && machine !== 'F-BLIO' && !MACHINES_PLANEUR_REMOQUE.includes(machine);
    if (heureArrivee) {
        heureArrivee.classList.toggle('carnet-champ-auto', isMoteur);
    }
    if (horametreDepart) {
        horametreDepart.classList.add('carnet-champ-auto');
    }
}

function mettreAJourHeureArrivee() {
    const machine = document.getElementById('carnet-machine').value;
    const heureDepart = document.getElementById('carnet-heure-depart').value;
    const hDep = document.getElementById('carnet-horametre-depart').value;
    const hArr = document.getElementById('carnet-horametre-arrivee').value;
    const input = document.getElementById('carnet-heure-arrivee');
    if (!input || !machine || machine === 'F-BLIO' || MACHINES_PLANEUR_REMOQUE.includes(machine)) return;
    const minutes = dureeHorametreMinutes(machine, hDep, hArr);
    if (minutes === null || !heureDepart) return;
    const arr = ajouterMinutes(heureDepart, minutes);
    if (arr !== null) input.value = arr;
    mettreAJourPrixDuVol();
}

function suggererNatureParTrajet() {
    const dep = (document.getElementById('carnet-depart')?.value || '').trim().toUpperCase();
    const arr = (document.getElementById('carnet-arrivee')?.value || '').trim().toUpperCase();
    if (!dep || !arr || dep === arr) return;
    const machine = document.getElementById('carnet-machine')?.value || '';
    if (machine === 'F-JVIO') {
        const select = document.getElementById('carnet-nature');
        if (select && select.value === 'local' && select.querySelector('option[value="voyage"]')) {
            select.value = 'voyage';
            syncNatureChips();
            mettreAJourActiviteParticuliere();
            mettreAJourPrixDuVol();
        }
    } else if (MACHINES_MOTEURS.includes(machine)) {
        const vi = document.querySelector('input[name="carnet-nature-extra"][value="Vol d\'initiation"]');
        if (vi && vi.checked) return;
        const base = document.querySelector('input[name="carnet-nature-base"]:checked');
        if (base && (base.value === 'Navigation' || base.value === 'Remorquage')) return;
        const nav = document.querySelector('input[name="carnet-nature-base"][value="Navigation"]');
        if (nav) {
            nav.checked = true;
            mettreAJourActiviteParticuliere();
            mettreAJourPrixDuVol();
        }
    }
}

const FONCTIONS_EXCLUSIVES = [['P', 'EP'], ['FI', 'FE']];

function appliquerExclusiviteFonctions(cb) {
    if (!cb.checked) return;
    FONCTIONS_EXCLUSIVES.forEach(groupe => {
        if (!groupe.includes(cb.value)) return;
        document.querySelectorAll('input[name="carnet-fonction"]').forEach(o => {
            if (o !== cb && groupe.includes(o.value)) o.checked = false;
        });
    });
}

function mettreAJourNatureParFonction() {
    const select = document.getElementById('carnet-nature');
    if (!select) return;
    const checked = Array.from(document.querySelectorAll('input[name="carnet-fonction"]:checked')).map(cb => cb.value);
    if (checked.includes('FE') || checked.includes('EX')) {
        if (select.querySelector('option[value="Examen"]')) select.value = 'Examen';
    } else if (checked.includes('FI') || checked.includes('I')) {
        if (select.querySelector('option[value="Instruction"]')) select.value = 'Instruction';
    }
    syncNatureChips();
}

function syncNatureChips() {
    const select = document.getElementById('carnet-nature');
    const val = select ? select.value : '';
    const qualChips = document.querySelectorAll('input[name="carnet-nature-qual"]');
    if (qualChips.length) {
        qualChips.forEach(cb => { cb.checked = cb.value === val; });
        if (!document.querySelector('input[name="carnet-nature-base"]:checked')) {
            const def = document.querySelector('input[name="carnet-nature-base"][value="Local"]');
            if (def) def.checked = true;
        }
        return;
    }
    const chips = document.querySelectorAll('input[name="carnet-nature-chip"]');
    chips.forEach(cb => { cb.checked = cb.value === val; });
}

function majNatureStd() {
    const select = document.getElementById('carnet-nature');
    if (!select) return;
    const qual = document.querySelector('input[name="carnet-nature-qual"]:checked');
    select.value = qual && select.querySelector(`option[value="${qual.value}"]`) ? qual.value : 'Autre';
    syncNatureChips();
}

function detailNatureStd() {
    const base = document.querySelector('input[name="carnet-nature-base"]:checked');
    const extras = Array.from(document.querySelectorAll('input[name="carnet-nature-extra"]:checked')).map(cb => cb.value);
    const quals = Array.from(document.querySelectorAll('input[name="carnet-nature-qual"]:checked')).map(cb => cb.value);
    const parts = [];
    if (base) parts.push(base.value);
    parts.push(...extras, ...quals);
    return parts.join(' + ');
}

function restaurerDetailNatureStd(detail) {
    const parts = String(detail || '').split('+').map(s => s.trim()).filter(Boolean);
    const aBase = parts.some(v => CARNET_STD_NATURES_BASE.includes(v));
    document.querySelectorAll('input[name="carnet-nature-base"]').forEach(rb => {
        rb.checked = aBase ? parts.includes(rb.value) : rb.value === 'Local';
    });
    document.querySelectorAll('input[name="carnet-nature-extra"]').forEach(cb => {
        cb.checked = parts.includes(cb.value);
    });
    majVerrouillageVolInitiation();
}

function majVerrouillageVolInitiation() {
    const chips = document.getElementById('carnet-nature-chips');
    if (!chips) return;
    const vi = chips.querySelector('input[name="carnet-nature-extra"][value="Vol d\'initiation"]');
    if (!vi) return;
    const lock = vi.checked;
    chips.querySelectorAll('input[name="carnet-nature-base"]').forEach(rb => {
        rb.disabled = lock;
        const label = rb.closest('label');
        if (label) label.classList.toggle('chip-disabled', lock);
        if (lock && rb.value === 'Local') rb.checked = true;
    });
    if (lock) {
        chips.querySelectorAll('input[name="carnet-nature-extra"]').forEach(cb => {
            if (cb !== vi) cb.checked = false;
        });
        chips.querySelectorAll('input[name="carnet-nature-qual"]').forEach(cb => {
            cb.checked = false;
        });
        majNatureStd();
    }
}

const CARNET_JVIO_FONCTIONS = [
    { value: 'P', label: 'P = Pilote', emoji: '🧑‍✈️' },
    { value: 'PCdB', label: 'PCdB = PIL.+CdB', emoji: '🛩️' },
    { value: 'PAX', label: 'PAX = Passager', emoji: '👤' },
    { value: 'EP', label: 'EP = Élève pilote', emoji: '🎓' },
    { value: 'I', label: 'I = Instructeur', emoji: '👨‍🏫' },
    { value: 'ICdB', label: 'ICdB = Instr.+CdB', emoji: '✈️' },
    { value: 'EX', label: 'EX = Examinateur', emoji: '📋' }
];

const EMOJIS_NATURE_JVIO = {
    'local': '🏠',
    'voyage': '🗺️',
    'REV': '🔄',
    'Instruction': '📚',
    'VLD': '🛬',
    'Activité Particulière': '🎯'
};

const CARNET_STD_FONCTIONS = [
    { value: 'P', label: 'P - Pilote' },
    { value: 'EP', label: 'EP - Élève pilote' },
    { value: 'FI', label: 'FI - Instructeur' },
    { value: 'FE', label: 'FE - Examinateur' }
];

const CARNET_MOTEUR_FONCTIONS = [
    { value: 'P', label: 'P = Pilote', emoji: '🧑‍✈️' },
    { value: 'EP', label: 'EP = Élève pilote', emoji: '🎓' },
    { value: 'FI', label: 'FI = Instructeur', emoji: '👨‍🏫' },
    { value: 'FE', label: 'FE = Examinateur', emoji: '📋' }
];

const CARNET_JVIO_NATURES = ['local', 'voyage', 'REV', 'Instruction', 'VLD', 'Activité Particulière'];
const CARNET_STD_NATURES = ['Autre', 'Instruction', 'Examen'];
const CARNET_STD_NATURES_BASE = ['Local', 'Navigation', 'Remorquage'];
const CARNET_STD_NATURES_EXTRA = ['VFR Nuit', "Vol d'initiation"];
const CARNET_STD_NATURES_QUAL = ['Instruction', 'Examen'];
const EMOJIS_NATURE_STD = {
    'Local': '🏠',
    'Navigation': '🗺️',
    'Remorquage': '🪝',
    'VFR Nuit': '🌙',
    "Vol d'initiation": '🎁',
    'Autre': '📝',
    'Instruction': '📚',
    'Examen': '✅'
};

const EMOJIS_MACHINE = {
    'F-GASB': '✈️',
    'F-BLIO': '🛩️',
    'F-JVIO': '🚁'
};

function peuplerOptionsMachineCarnet(extraMachine = null) {
    const select = document.getElementById('carnet-machine');
    const chips = document.getElementById('carnet-machine-chips');
    if (!select) return;
    select.innerHTML = MACHINES_MOTEURS.map(m => `<option value="${m}">${m}</option>`).join('');
    if (extraMachine && !MACHINES_MOTEURS.includes(extraMachine)) {
        const opt = document.createElement('option');
        opt.value = extraMachine;
        opt.textContent = extraMachine;
        select.appendChild(opt);
    }
    if (chips) {
        chips.innerHTML = Array.from(select.options).map(o =>
            `<label class="checkbox-option"><input type="radio" name="carnet-machine-chip" value="${o.value}"> ${EMOJIS_MACHINE[o.value] || ''} ${o.text}</label>`
        ).join('');
        chips.querySelectorAll('input[name="carnet-machine-chip"]').forEach(rb => {
            rb.addEventListener('change', async () => {
                select.value = rb.value;
                adapterFormulaireCarnet(rb.value);
                const instSel = document.getElementById('carnet-instructeur');
                await peuplerCarnetInstructeurs(instSel ? instSel.value : '', rb.value);
                mettreAJourStyleChampsAuto(rb.value);
                mettreAJourHeureArrivee();
                mettreAJourActiviteParticuliere();
                mettreAJourPrixDuVol();
                syncMachineChips();
                syncNatureChips();
            });
        });
    }
}

function syncMachineChips() {
    const select = document.getElementById('carnet-machine');
    const chips = document.querySelectorAll('input[name="carnet-machine-chip"]');
    chips.forEach(cb => { cb.checked = cb.value === (select ? select.value : ''); });
}

function cocherFonctionParDefaut() {
    const cb = document.querySelector('input[name="carnet-fonction"][value="P"]');
    if (cb) cb.checked = true;
}

function adapterFormulaireCarnet(machine) {
    const isJVIO = machine === 'F-JVIO';
    const isBLIO = machine === 'F-BLIO';
    const isMoteur = MACHINES_MOTEURS.includes(machine);
    const modal = document.getElementById('carnet-modal');
    if (modal) modal.classList.toggle('carnet-modal-jvio', isMoteur);
    const piloteLabel = document.getElementById('carnet-pilote-label');
    const instLabel = document.getElementById('carnet-instructeur-label');
    const hDepLabel = document.getElementById('carnet-heure-depart-label');
    const hArrLabel = document.getElementById('carnet-heure-arrivee-label');
    const fonctionGroup = document.getElementById('carnet-fonction-group');
    const fonctionLabel = document.getElementById('carnet-fonction-label');
    const nature = document.getElementById('carnet-nature');
    const machineSelect = document.getElementById('carnet-machine');
    const machineChips = document.getElementById('carnet-machine-chips');
    const carbuRow = document.getElementById('carnet-carburant-row');
    const huileRow = document.getElementById('carnet-huile-row');
    const instSel = document.getElementById('carnet-instructeur');
    const prixInput = document.getElementById('carnet-prix-vol');
    const prixGroup = prixInput ? prixInput.closest('.form-group') : null;
    const form = document.getElementById('carnet-form');
    const fonctionFormGroup = fonctionGroup ? fonctionGroup.parentElement : null;

    if (form) form.classList.toggle('carnet-form-jvio', isMoteur);
    if (prixGroup) {
        prixGroup.style.display = isBLIO ? 'none' : '';
        if (isBLIO && prixInput) prixInput.value = '';
    }
    if (piloteLabel) piloteLabel.textContent = isJVIO ? 'Équipage 1 :' : 'Pilote :';
    if (instLabel) instLabel.textContent = isJVIO ? 'Équipage 2 :' : 'Instructeur (si instruction) :';
    if (hDepLabel) hDepLabel.textContent = isJVIO ? 'Heure de départ (H.Loc) :' : 'Heure de départ (UTC) :';
    if (hArrLabel) hArrLabel.textContent = isJVIO ? 'Heure d\'arrivée (H.Loc) :' : 'Heure d\'arrivée (UTC) :';
    if (fonctionLabel) fonctionLabel.textContent = 'Fonction(s) à bord :';
    if (instSel) instSel.dataset.allowCustom = '1';
    if (fonctionFormGroup) fonctionFormGroup.classList.toggle('full-width', isMoteur);

    const natureChips = document.getElementById('carnet-nature-chips');
    const natureOptions = isJVIO ? CARNET_JVIO_NATURES : CARNET_STD_NATURES;
    if (nature) {
        nature.innerHTML = natureOptions.map(v => `<option value="${v}">${v}</option>`).join('');
        nature.style.display = isMoteur ? 'none' : '';
        nature.value = isJVIO ? 'local' : natureOptions[0];
    }
    if (natureChips) {
        natureChips.style.display = isMoteur ? 'flex' : 'none';
        if (isJVIO) {
            natureChips.innerHTML = CARNET_JVIO_NATURES.map(v =>
                `<label class="checkbox-option"><input type="radio" name="carnet-nature-chip" value="${v}"> ${EMOJIS_NATURE_JVIO[v] || ''} ${v}</label>`
            ).join('');
            natureChips.querySelectorAll('input[name="carnet-nature-chip"]').forEach(rb => {
                rb.addEventListener('change', () => {
                    if (nature) nature.value = rb.value;
                    mettreAJourNatureParFonction();
                    mettreAJourActiviteParticuliere();
                    mettreAJourPrixDuVol();
                });
            });
        } else if (isMoteur) {
            natureChips.innerHTML =
                CARNET_STD_NATURES_BASE.map(v =>
                    `<label class="checkbox-option"><input type="radio" name="carnet-nature-base" value="${v}"> ${EMOJIS_NATURE_STD[v] || ''} ${v}</label>`
                ).join('') +
                CARNET_STD_NATURES_EXTRA.map(v =>
                    `<label class="checkbox-option"><input type="checkbox" name="carnet-nature-extra" value="${v}"> ${EMOJIS_NATURE_STD[v] || ''} ${v}</label>`
                ).join('') +
                CARNET_STD_NATURES_QUAL.map(v =>
                    `<label class="checkbox-option"><input type="checkbox" name="carnet-nature-qual" value="${v}"> ${EMOJIS_NATURE_STD[v] || ''} ${v}</label>`
                ).join('');
            natureChips.querySelectorAll('input[name="carnet-nature-extra"]').forEach(cb => {
                cb.addEventListener('change', () => {
                    majVerrouillageVolInitiation();
                    mettreAJourActiviteParticuliere();
                    mettreAJourPrixDuVol();
                });
            });
            natureChips.querySelectorAll('input[name="carnet-nature-qual"]').forEach(cb => {
                cb.addEventListener('change', () => {
                    if (cb.checked) {
                        natureChips.querySelectorAll('input[name="carnet-nature-qual"]').forEach(o => {
                            if (o !== cb) o.checked = false;
                        });
                    }
                    majNatureStd();
                    mettreAJourActiviteParticuliere();
                    mettreAJourPrixDuVol();
                });
            });
            majVerrouillageVolInitiation();
        } else {
            natureChips.innerHTML = '';
        }
    }
    syncNatureChips();
    if (machineSelect) machineSelect.style.display = 'none';
    if (machineChips) machineChips.style.display = 'flex';
    syncMachineChips();

    if (fonctionGroup) {
        const fonctions = isJVIO ? CARNET_JVIO_FONCTIONS : (isMoteur ? CARNET_MOTEUR_FONCTIONS : CARNET_STD_FONCTIONS);
        fonctionGroup.innerHTML = fonctions.map(f =>
            `<label class="checkbox-option">${f.emoji ? f.emoji + ' ' : ''}<input type="checkbox" name="carnet-fonction" value="${f.value}"> ${f.label}</label>`
        ).join('');
        fonctionGroup.querySelectorAll('input[name="carnet-fonction"]').forEach(cb => {
            cb.addEventListener('change', () => {
                if (isMoteur && !isJVIO) appliquerExclusiviteFonctions(cb);
                mettreAJourNatureParFonction();
            });
        });
    }

    if (carbuRow) carbuRow.style.display = '';
    if (huileRow) huileRow.style.display = isJVIO ? 'none' : '';

    const maintenanceRow = document.getElementById('carnet-maintenance-row');
    if (maintenanceRow) maintenanceRow.style.display = isJVIO ? '' : 'none';
    const obsLabel = document.querySelector('label[for="carnet-observations"]');
    if (obsLabel) obsLabel.textContent = 'Remarques mécaniques :';

    if (isJVIO) {
        ['carnet-huile-depart', 'carnet-huile-arrivee'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    } else {
        const maint = document.getElementById('carnet-maintenance');
        if (maint) maint.value = '';
    }

    if (isBLIO) {
        const cbP = fonctionGroup ? fonctionGroup.querySelector('input[name="carnet-fonction"][value="P"]') : null;
        if (cbP) cbP.checked = true;
        const rem = document.querySelector('input[name="carnet-nature-base"][value="Remorquage"]');
        if (rem) rem.checked = true;
    }

    if (instSel && !instSel.disabled) {
        instSel.disabled = estMecanicienRestreint() && !isJVIO;
    }
}

// --- RECHERCHE DANS LE CARNET (pilote, instructeur, date, terrain, horametre) ---
function normaliserTexteRecherche(s) {
    return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function volCorrespondRecherche(d, q) {
    const f = d.f || {};
    const hay = [
        f['Pilote'], f['Instructeur'], f['Effectué par'],
        d.dateStr, String(f['Date'] || '').slice(0, 10),
        f['Départ'], f['Arrivée'],
        formaterNombre(f['Horamètre départ']), formaterNombre(f['Horamètre arrivée']),
        f['Horamètre départ'], f['Horamètre arrivée']
    ].map(normaliserTexteRecherche).join(' ');
    return q.split(/\s+/).every(m => hay.includes(m));
}

function formatEquipageCourt(nom) {
    const str = String(nom || '').trim();
    const parts = str.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return str;
    if (/^[A-ZÀ-Ý]\.?$/.test(parts[parts.length - 1])) return str;
    return `${parts.slice(1).join(' ')} ${parts[0].charAt(0).toUpperCase()}.`;
}

function afficherCarnet(records) {
    const tbody = document.getElementById('carnet-body');
    if (!tbody) return;
    derniersRecordsCarnet = records;
    const isJVIO = machineCarnetSelectionnee === 'F-JVIO';
    const table = tbody.closest('table');
    const thead = table ? table.querySelector('thead') : null;
    const tfoot = table ? table.querySelector('tfoot') : null;
    const tableContainer = table ? table.closest('.carnet-table-container') : null;
    if (table) table.style.minWidth = isJVIO ? '1400px' : '1100px';
    if (thead) thead.innerHTML = genererHeaderCarnet(isJVIO);
    brancherLegendesThJVIO(thead);
    if (tfoot) tfoot.remove();
    if (tableContainer) {
        const existingPagination = tableContainer.querySelector('.carnet-pagination');
        if (existingPagination) existingPagination.remove();
    }
    if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isJVIO ? 14 : 15}" class="carnet-empty">Aucun vol enregistré dans le carnet de route.</td></tr>`;
        return;
    }

    // Pré-calculer les temps pour toutes les lignes
    const recordsData = records.map(record => {
        const f = record.fields || {};
        const temps = machineCarnetSelectionnee === 'F-JVIO' || !f['Temps de vol']
            ? calculerTempsDeVol(f['Horamètre départ'], f['Horamètre arrivée'], f['Heure départ'], f['Heure arrivée'], machineCarnetSelectionnee)
            : f['Temps de vol'];
        const dateObj = f['Date'] ? new Date(f['Date']) : null;
        const dateStr = dateObj ? dateObj.toLocaleDateString('fr-FR') : '-';
        return { record, f, temps, dateStr };
    });

    // Détection des ruptures de continuité horamètre (en ordre chronologique).
    // F-JVIO : horamètre au format H.MM converti en minutes ; les lignes de
    // maintenance n'interrompent pas la chaîne.
    const idsEcartHorametre = new Set();
    const detailEcartJVIO = new Map();
    {
        const num = isJVIO
            ? v => horametreVersMinutes(v)
            : v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : n; };
        const chrono = [...recordsData]
            .filter(d => !d.record._estMaintenance)
            .sort((a, b) => {
                if (isJVIO) {
                    const c = cleDateHeureCarnet(a.record) - cleDateHeureCarnet(b.record);
                    if (c) return c;
                } else {
                    const da = a.f['Date'] || '', db = b.f['Date'] || '';
                    if (da !== db) return da < db ? -1 : 1;
                    const ha = a.f['Heure départ'] || '', hb = b.f['Heure départ'] || '';
                    if (ha !== hb) return ha < hb ? -1 : 1;
                }
                return (num(a.f['Horamètre départ']) || 0) - (num(b.f['Horamètre départ']) || 0);
            });
        for (let i = 1; i < chrono.length; i++) {
            const prevArr = num(chrono[i - 1].f['Horamètre arrivée']);
            const curDep = num(chrono[i].f['Horamètre départ']);
            if (prevArr === null || curDep === null) continue;
            const seuil = isJVIO ? 0.5 : 0.005;
            if (Math.abs(prevArr - curDep) > seuil) {
                idsEcartHorametre.add(chrono[i - 1].record.id);
                idsEcartHorametre.add(chrono[i].record.id);
                if (isJVIO) {
                    detailEcartJVIO.set(chrono[i - 1].record.id,
                        `Horamètre arrivée ${formaterNombre(chrono[i - 1].f['Horamètre arrivée'])} ≠ départ du vol suivant (${formaterNombre(chrono[i].f['Horamètre départ'])})`);
                    detailEcartJVIO.set(chrono[i].record.id,
                        `Horamètre départ ${formaterNombre(chrono[i].f['Horamètre départ'])} ≠ arrivée du vol précédent (${formaterNombre(chrono[i - 1].f['Horamètre arrivée'])})`);
                }
            }
        }
    }

    // Filtre de recherche (apres la detection de continuite, qui porte sur tout le carnet)
    const rechercheQ = normaliserTexteRecherche(document.getElementById('carnet-recherche')?.value);
    const affichage = rechercheQ ? recordsData.filter(d => volCorrespondRecherche(d, rechercheQ)) : recordsData;
    if (affichage.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isJVIO ? 14 : 15}" class="carnet-empty">Aucun vol ne correspond à la recherche « ${escHtml(rechercheQ)} ».</td></tr>`;
        return;
    }

    let pageRecords = affichage;
    let totalPages = 1;
    let totalCumuleMinutes = 0;

    const lignesParPage = lignesParPageCarnet();
    totalPages = Math.max(1, Math.ceil(affichage.length / lignesParPage));
    if (carnetPageJVIO > totalPages) carnetPageJVIO = totalPages;
    if (carnetPageJVIO < 1) carnetPageJVIO = 1;
    const start = (carnetPageJVIO - 1) * lignesParPage;
    const end = start + lignesParPage;
    pageRecords = affichage.slice(start, end);
    if (isJVIO) {
        totalCumuleMinutes = affichage.slice(0, end).reduce((sum, d) => sum + dureeStringEnMinutes(d.temps), 0);
    }

    tbody.innerHTML = '';
    pageRecords.forEach(({ record, f, temps, dateStr }) => {
        const tr = document.createElement('tr');
        tr.dataset.id = record.id;
        if (isJVIO && record._estMaintenance) {
            tr.className = 'carnet-row-maintenance';
            const qui = (f['Effectué par'] || '').toString().trim() || '-';
            const taches = (f['Tâches'] || '').toString().trim() || '-';
            tr.innerHTML = `
                <td>${dateStr}</td>
                <td colspan="9">🔧 Maintenance — <strong>${escHtml(qui)}</strong></td>
                <td colspan="2"></td>
                <td>${escHtml(taches)}</td>
                <td></td>
            `;
        } else if (isJVIO) {
            tr.innerHTML = `
                <td>${dateStr}${badgeGvvCarnet(f, recordsData)}</td>
                <td>${escHtml(formatEquipageCourt(f['Pilote'])) || '-'}</td>
                <td>${escHtml(formatEquipageCourt(f['Instructeur'])) || '-'}</td>
                <td>${escHtml(f['Fonction']) || '-'}</td>
                <td>${escHtml(f['Nature']) || '-'}</td>
                <td>${escHtml(f['Départ']) || '-'}</td>
                <td>${escHtml(f['Arrivée']) || '-'}</td>
                <td>${escHtml(f['Heure départ'])}</td>
                <td>${escHtml(f['Heure arrivée'])}</td>
                <td${idsEcartHorametre.has(record.id) ? ` class="horametre-ecart" title="${escHtml(detailEcartJVIO.get(record.id) || 'Rupture de continuité horamètre')}"` : ''}>${formaterNombre(f['Horamètre arrivée']) || '-'}${idsEcartHorametre.has(record.id) ? ' ⚠️' : ''}</td>
                <td>${escHtml(afficherCarburant(f['Carburant départ']))}</td>
                <td>${escHtml(afficherCarburant(f['Carburant arrivée']))}</td>
                <td>${escHtml((f['Maintenance'] || '').toString().trim()) || '-'}</td>
                <td>${escHtml((f['Observations'] || '').trim()) || '-'}</td>
            `;
        } else {
            const equipage = [f['Pilote'], f['Instructeur']].filter(Boolean).map(formatEquipageCourt).join(' / ') || '-';
            const carburant = [formaterNombre(f['Carburant départ']), formaterNombre(f['Carburant arrivée'])].filter(v => v !== '').join(' / ') || '-';
            const huile = [formaterNombre(f['Huile départ']), formaterNombre(f['Huile arrivée'])].filter(v => v !== '').join(' / ') || '-';
            const horametre = [formaterNombre(f['Horamètre départ']), formaterNombre(f['Horamètre arrivée'])].filter(v => v !== '').join(' / ') || '-';
            tr.innerHTML = `
                <td>${dateStr}${badgeGvvCarnet(f, recordsData)}</td>
                <td>${escHtml(equipage)}</td>
                <td>${escHtml(f['Fonction']) || '-'}</td>
                <td>${escHtml(f['Départ']) || '-'}</td>
                <td>${escHtml(f['Arrivée']) || '-'}</td>
                <td>${escHtml(f['Heure départ'])}</td>
                <td>${escHtml(f['Heure arrivée'])}</td>
                <td>${temps || '-'}</td>
                <td>${escHtml(f['Nature']) || '-'}</td>
                <td>${escHtml(afficherCarburant(f['Carburant départ']))}</td>
                <td>${escHtml(afficherCarburant(f['Carburant arrivée']))}</td>
                <td>${escHtml(afficherHuile(f['Huile départ']))}</td>
                <td>${escHtml(afficherHuile(f['Huile arrivée']))}</td>
                <td>${escHtml((f['Observations'] || '').trim()) || '-'}</td>
                <td${idsEcartHorametre.has(record.id) ? ' class="horametre-ecart"' : ''}>${horametre}</td>
            `;
        }
        tr.addEventListener('click', () => {
            if (record._estMaintenance) {
                if (typeof peutGererMaintenance === 'function' && peutGererMaintenance() && typeof ouvrirModaleMaintenance === 'function') {
                    ouvrirModaleMaintenance(record._maintenanceRecord || record);
                }
            } else {
                ouvrirModaleCarnet(record.id);
            }
        });
        tbody.appendChild(tr);
    });

    for (let i = pageRecords.length; i < lignesParPage; i++) {
        const tr = document.createElement('tr');
        tr.className = 'carnet-ligne-vide';
        tr.innerHTML = `<td colspan="${isJVIO ? 14 : 15}">&nbsp;</td>`;
        tbody.appendChild(tr);
    }

    if (isJVIO) {
        const newTfoot = document.createElement('tfoot');
        newTfoot.innerHTML = `
            <tr class="carnet-total-cumule">
                <td colspan="9" style="text-align:right; font-weight:600;">Total cumulé :</td>
                <td style="font-weight:600;">${formaterDureeMinutes(totalCumuleMinutes)}</td>
                <td colspan="4"></td>
            </tr>
        `;
        table.appendChild(newTfoot);
    }

    if (tableContainer && totalPages > 1) {
        const pagination = document.createElement('div');
        pagination.className = 'carnet-pagination';
        pagination.innerHTML = `
            <button type="button" ${carnetPageJVIO === 1 ? 'disabled' : ''} data-page="${carnetPageJVIO - 1}">◀ Précédent</button>
            <span>Page ${carnetPageJVIO} / ${totalPages}</span>
            <button type="button" ${carnetPageJVIO === totalPages ? 'disabled' : ''} data-page="${carnetPageJVIO + 1}">Suivant ▶</button>
        `;
        pagination.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const newPage = parseInt(e.currentTarget.dataset.page, 10);
                if (!isNaN(newPage)) {
                    carnetPageJVIO = newPage;
                    afficherCarnet(records);
                }
            });
        });
        tableContainer.appendChild(pagination);
    }
}

function afficherAlarmeObservation(records) {
    const alarme = document.getElementById('carnet-observation-alarme');
    if (!alarme) return;
    if (!records || records.length === 0) {
        alarme.style.display = 'none';
        return;
    }
    const avecObs = records.filter(r => {
        const f = r.fields || {};
        const m = f['Machine'];
        const catCarnet = CATEGORIES_CARNET[machineCarnetSelectionnee];
        const matchMachine = !machineCarnetSelectionnee
            || (catCarnet
                ? catCarnet.items.includes(m)
                : m === machineCarnetSelectionnee);
        return (f['Observations'] || '').trim() !== '' && matchMachine;
    }).sort((a, b) => new Date(a.fields['Date']) - new Date(b.fields['Date']));
    if (avecObs.length === 0) {
        alarme.style.display = 'none';
        return;
    }
    alarme.style.display = 'flex';
    alarme.style.cssText = `
        background-color: rgba(253, 224, 71, 0.25);
        border-left: 4px solid #eab308;
        color: #854d0e;
        padding: 10px 14px;
        border-radius: 6px;
        margin: 10px 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 13px;
    `;
    const peutTraiter = typeof peutTraiterSignalements === 'function' && peutTraiterSignalements();
    const btnsHtml = peutTraiter ? `
        <button class="btn-statut-obs" data-statut="Pris en compte" style="padding: 4px 8px; border: 1px solid #854d0e; background: transparent; color: #854d0e; border-radius: 4px; cursor: pointer; font-size: 12px;">Pris en compte</button>
        <button class="btn-statut-obs" data-statut="En cours de traitement" style="padding: 4px 8px; border: 1px solid #854d0e; background: transparent; color: #854d0e; border-radius: 4px; cursor: pointer; font-size: 12px;">En cours</button>
        <button class="btn-statut-obs" data-statut="Observation traitée" style="padding: 4px 8px; border: 1px solid #854d0e; background: transparent; color: #854d0e; border-radius: 4px; cursor: pointer; font-size: 12px;">Traité</button>
    ` : '';
    const COULEURS_STATUT_OBS = {
        'Non pris en compte': '#dc2626',
        'Pris en compte': '#d97706',
        'En cours de traitement': '#2563eb',
        'Observation traitée': '#16a34a'
    };
    let html = '';
    avecObs.forEach(obs => {
        const f = obs.fields || {};
        const dateObj = f['Date'] ? new Date(f['Date']) : null;
        const dateStr = dateObj ? dateObj.toLocaleDateString('fr-FR') : '-';
        const statut = (f['Statut observation'] || 'Non pris en compte').toString();
        const couleur = COULEURS_STATUT_OBS[statut] || '#dc2626';
        html += `
            <div data-record-id="${obs.id}" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0 6px 10px; border-bottom: 1px solid rgba(180, 83, 9, 0.2); border-left: 4px solid ${couleur};">
                <div>
                    <strong>🛠️ ${escHtml(f['Machine'])} — ${dateStr}</strong> — ${escHtml((f['Observations'] || '').trim())}
                    <span class="obs-statut" style="font-style: italic; margin-left: 8px; font-weight: 700; color: ${couleur};">(${escHtml(statut)})</span>
                </div>
                ${btnsHtml ? `<div class="obs-btns" style="display: flex; gap: 6px; flex-shrink: 0;">${btnsHtml}</div>` : ''}
            </div>
        `;
    });
    alarme.innerHTML = html;
    alarme.querySelectorAll('.btn-statut-obs').forEach(btn => {
        const recordId = btn.closest('[data-record-id]')?.dataset.recordId;
        btn.addEventListener('click', () => mettreAJourStatutObservation(recordId, btn.dataset.statut));
    });
}

async function mettreAJourStatutObservation(recordId, statut) {
    if (typeof peutTraiterSignalements === 'function' && !peutTraiterSignalements()) {
        alert('Action réservée aux mécaniciens, instructeurs et super admin.');
        return;
    }
    try {
        const fields = { 'Statut observation': statut };
        if (statut === 'Observation traitée') {
            fields['Observations'] = '';
        }
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_CARNET_ROUTE)}/${recordId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields })
        });
        if (!res.ok) throw new Error(await res.text());
        chargerCarnetRoute();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la mise à jour du statut.');
    }
}

async function chargerCarnetRoute() {
    const tbody = document.getElementById('carnet-body');
    const tableContainer = document.querySelector('.carnet-table-container');
    const planeurContainer = document.getElementById('carnet-planeur-container');
    const btnOuvrir = document.getElementById('btn-ouvrir-carnet');
    const btnDocs = document.getElementById('btn-documents-carnet');
    const recapDocs = document.getElementById('documents-carnet-recap');
    const alarme = document.getElementById('carnet-observation-alarme');
    const isJVIO = machineCarnetSelectionnee === 'F-JVIO';
    const colspan = isJVIO ? 14 : 15;

    const rechercheInput = document.getElementById('carnet-recherche');
    if (rechercheInput) rechercheInput.style.display = CATEGORIES_CARNET[machineCarnetSelectionnee] ? 'none' : '';
    const btnOptionsCarnet = document.getElementById('btn-options-carnet');
    if (btnOptionsCarnet) btnOptionsCarnet.style.display =
        (typeof peutVoirOptionsAeronef === 'function' && peutVoirOptionsAeronef()) ? 'inline-block' : 'none';
    if (!CATEGORIES_CARNET[machineCarnetSelectionnee]) {
        await chargerEcrituresGvv();
        // Retire les facturations temporaires couvertes par une ecriture GVV.
        apiFetch(`${API_BASE}/facturations-tempo-sweep`, { method: 'POST', headers, body: '{}' })
            .catch(() => {});
    }
    if (CATEGORIES_CARNET[machineCarnetSelectionnee]) {
        genererGrillesPlaneur(machineCarnetSelectionnee);
        if (tableContainer) tableContainer.style.display = 'none';
        if (planeurContainer) planeurContainer.style.display = 'block';
        const btnBilanCat = document.getElementById('btn-bilan-docs-carnet');
        const peutDocsCat = (typeof peutGererDocumentsAeronef === 'function' && peutGererDocumentsAeronef());
        if (btnBilanCat) btnBilanCat.style.display = peutDocsCat ? 'inline-block' : 'none';
        if (btnOuvrir) btnOuvrir.style.display = 'none';
        if (btnDocs) btnDocs.style.display = 'none';
        if (recapDocs) recapDocs.style.display = 'none';
        if (tbody) tbody.innerHTML = '';
        try {
            const url = `${API_BASE}/${encodeURIComponent(TABLE_CARNET_ROUTE)}?sort[0][field]=Date&sort[0][direction]=asc&pageSize=100`;
            listeVolsCarnetCache = await fetchTousRecords(url, { headers });
            afficherAlarmeObservation(listeVolsCarnetCache);
        } catch (error) {
            console.error(error);
            if (alarme) alarme.style.display = 'none';
        }
        return;
    }

    if (tableContainer) tableContainer.style.display = 'block';
    if (planeurContainer) planeurContainer.style.display = 'none';
    if (btnOuvrir) btnOuvrir.style.display = 'inline-block';
    const peutGererDocs = (typeof peutGererDocumentsAeronef === 'function' && peutGererDocumentsAeronef());
    if (btnDocs) btnDocs.style.display = peutGererDocs ? 'inline-block' : 'none';
    const btnBilanDocsCarnet = document.getElementById('btn-bilan-docs-carnet');
    if (btnBilanDocsCarnet) btnBilanDocsCarnet.style.display = peutGererDocs ? 'inline-block' : 'none';
    if (alarme) alarme.style.display = 'none';
    const table = tbody ? tbody.closest('table') : null;
    const thead = table ? table.querySelector('thead') : null;
    if (table) table.style.minWidth = isJVIO ? '1400px' : '1100px';
    if (thead) thead.innerHTML = genererHeaderCarnet(isJVIO);
    brancherLegendesThJVIO(thead);
    if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" class="carnet-empty">Chargement du carnet de route...</td></tr>`;
    try {
        const url = `${API_BASE}/${encodeURIComponent(TABLE_CARNET_ROUTE)}?sort[0][field]=Date&sort[0][direction]=asc&pageSize=100`;
        listeVolsCarnetCache = await fetchTousRecords(url, { headers });
        await nettoyerCarnetRouteMaintenance(machineCarnetSelectionnee);
        const volsMachine = listeVolsCarnetCache.filter(r => {
            const f = r.fields || {};
            return !machineCarnetSelectionnee || f['Machine'] === machineCarnetSelectionnee;
        }).sort((a, b) => {
            const fa = a.fields || {}, fb = b.fields || {};
            if (isJVIO) return cleDateHeureCarnet(a) - cleDateHeureCarnet(b);
            const da = fa['Date'] || '', db = fb['Date'] || '';
            if (da !== db) return da < db ? 1 : -1;
            const ha = fa['Heure départ'] || '', hb = fb['Heure départ'] || '';
            if (ha !== hb) return ha < hb ? 1 : -1;
            const xa = parseFloat(String(fa['Horamètre arrivée'] || '').replace(',', '.')) || 0;
            const xb = parseFloat(String(fb['Horamètre arrivée'] || '').replace(',', '.')) || 0;
            return xb - xa;
        });
        if (isJVIO) {
            try {
                const recordsMaint = await fetchTousRecordsCache(`${API_BASE}/${encodeURIComponent('Maintenance')}?filterByFormula=${encodeURIComponent("{Machine}='F-JVIO'")}`, { headers });
                recordsMaint.forEach(r => {
                    volsMachine.push({ id: r.id, fields: r.fields || {}, _estMaintenance: true, _maintenanceRecord: r });
                });
                volsMachine.sort((a, b) => cleDateHeureCarnet(a) - cleDateHeureCarnet(b));
            } catch (e) { console.warn('Maintenance JVIO indisponible:', e); }
            carnetPageJVIO = Math.max(1, Math.ceil(volsMachine.length / lignesParPageCarnet()));
        }
        afficherCarnet(volsMachine);
        afficherAlarmeObservation(volsMachine);
        await synchroniserHorametreAeronef(machineCarnetSelectionnee, volsMachine);
        if (typeof chargerDocumentsAeronef === 'function' && typeof afficherRecapDocumentsAeronef === 'function') {
            await chargerDocumentsAeronef(machineCarnetSelectionnee);
            afficherRecapDocumentsAeronef(machineCarnetSelectionnee, 'documents-carnet-list', 'documents-carnet-recap');
        }
    } catch (error) {
        console.error(error);
        if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" class="carnet-empty">Erreur lors du chargement du carnet.</td></tr>`;
    }
}

async function synchroniserVolMaintenance(machine, date, pilote, horametreArrivee) {
    const h = parseFloat(String(horametreArrivee).replace(',', '.'));
    if (isNaN(h)) return;
    try {
        const urlBaseAeronefs = `${API_BASE}/${encodeURIComponent('Aéronefs')}`;
        const filter = `?filterByFormula=${encodeURIComponent(`{Immatriculation}='${machine}'`)}`;
        const recordsA = await fetchTousRecordsCache(urlBaseAeronefs + filter, { headers });
        if (!recordsA.length) return;
        const avionId = recordsA[0].id;

        const dateObj = new Date(`${date}T00:00:00`);
        const dateISO = isNaN(dateObj.getTime()) ? date : dateObj.toISOString();

        const urlCarnet = `${API_BASE}/${encodeURIComponent('Carnet de route')}`;
        await cachedFetch(urlCarnet, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                fields: {
                    'Machine': [avionId],
                    'Pilote': pilote,
                    'Nouvel Horamètre': h,
                    'Date du vol': dateISO
                }
            })
        });
    } catch (e) {
        console.error(e);
    }
}

async function soumettreCarnetRoute(event) {
    event.preventDefault();
    if (idCarnetEnEdition) {
        const recordEdit = listeVolsCarnetCache.find(r => r.id === idCarnetEnEdition);
        if (recordEdit && !peutModifierVolCarnet(recordEdit)) {
            alert("Tu n'as pas le droit de modifier ce vol.");
            return;
        }
    }
    const date = document.getElementById('carnet-date').value;
    const pilote = document.getElementById('carnet-pilote').value.trim();
    let instructeur = document.getElementById('carnet-instructeur').value.trim();
    const decAt = parseInt(document.getElementById('carnet-decol-atterr').value, 10) || 0;
    const decollages = decAt;
    const atterrissages = decAt;
    const fonction = Array.from(document.querySelectorAll('input[name="carnet-fonction"]:checked')).map(cb => cb.value).join('/');
    const machine = document.getElementById('carnet-machine').value;
    if (estMecanicienRestreint() && machine !== 'F-JVIO') {
        const recEdit = idCarnetEnEdition ? listeVolsCarnetCache.find(r => r.id === idCarnetEnEdition) : null;
        instructeur = ((recEdit && recEdit.fields && recEdit.fields['Instructeur']) || '').toString().trim();
    }
    const depart = document.getElementById('carnet-depart').value.trim();
    const arrivee = document.getElementById('carnet-arrivee').value.trim();
    const heureDepart = document.getElementById('carnet-heure-depart').value;
    const heureArrivee = document.getElementById('carnet-heure-arrivee').value;
    let nature = document.getElementById('carnet-nature').value;
    let carburantDepart = document.getElementById('carnet-carburant-depart').value;
    let carburantArrivee = document.getElementById('carnet-carburant-arrivee').value;
    const pcDepart = document.getElementById('carnet-pc-depart')?.checked;
    const pcArrivee = document.getElementById('carnet-pc-arrivee')?.checked;
    if (pcDepart) carburantDepart = `${carburantDepart} PC`;
    if (pcArrivee) carburantArrivee = `${carburantArrivee} PC`;
    const huileDepart = document.getElementById('carnet-huile-depart').value;
    const huileArrivee = document.getElementById('carnet-huile-arrivee').value;
    const horametreDepart = document.getElementById('carnet-horametre-depart').value;
    const horametreArrivee = document.getElementById('carnet-horametre-arrivee').value;
    const observations = document.getElementById('carnet-observations').value.trim();
    let precisionActivite = '';
    if (nature === 'Activité Particulière') {
        precisionActivite = document.getElementById('carnet-activite-detail').value.trim() || '';
    } else if (MACHINES_MOTEURS.includes(machine) && machine !== 'F-JVIO') {
        precisionActivite = detailNatureStd();
        const baseRemorquage = document.querySelector('input[name="carnet-nature-base"][value="Remorquage"]:checked');
        if (baseRemorquage) nature = `${decAt} Rem`;
    }
    const prixVolText = (document.getElementById('carnet-prix-vol') || { value: '' }).value;

    const ancienRecord = idCarnetEnEdition ? listeVolsCarnetCache.find(r => r.id === idCarnetEnEdition) : null;

    const temps = calculerTempsDeVol(horametreDepart, horametreArrivee, heureDepart, heureArrivee, machine);
    const numeric = (val) => {
        if (val === '' || val === null || val === undefined) return null;
        const n = parseFloat(String(val).replace(',', '.'));
        return isNaN(n) ? null : n;
    };
    const extraireNombreChamp = (val) => {
        const m = String(val ?? '').replace(',', '.').match(/\d+(?:\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
    };
    const valeurCarburant = (val) => {
        const v = String(val ?? '').trim();
        if (v === '') return null;
        const pc = v.toUpperCase().includes('PC');
        const n = extraireNombreChamp(v);
        if (n === null) return pc ? 'PC' : null;
        return pc ? `+${n}L PC` : n;
    };

    const fields = {
        "Date": date,
        "Pilote": pilote,
        "Instructeur": instructeur || '',
        "Fonction": fonction,
        "Machine": machine,
        "Départ": depart,
        "Arrivée": arrivee,
        "Heure départ": heureDepart,
        "Heure arrivée": heureArrivee,
        "Temps de vol": temps,
        "Décollages": decollages,
        "Atterrissages": atterrissages,
        "Nature": nature,
        "Précision activité": precisionActivite,
        "Carburant départ": valeurCarburant(carburantDepart),
        "Carburant arrivée": valeurCarburant(carburantArrivee),
        "Huile départ": extraireNombreChamp(huileDepart),
        "Huile arrivée": extraireNombreChamp(huileArrivee),
        "Horamètre départ": numeric(horametreDepart),
        "Horamètre arrivée": numeric(horametreArrivee),
        "Prix du vol": numeric(prixVolText),
        "Maintenance": (document.getElementById('carnet-maintenance')?.value || '').trim(),
        "Observations": observations,
        "Statut observation": observations
            ? (['Pris en compte', 'En cours de traitement'].includes(ancienRecord?.fields?.['Statut observation']) ? ancienRecord.fields['Statut observation'] : 'Non pris en compte')
            : ''
    };

    // Remarques mécaniques nouvelles/modifiées sur une machine moteur :
    // on rappelle au pilote qu'un probleme doit d'abord etre signale au
    // mecanicien ou a un instructeur, avec possibilite de revenir au vol
    // s'il s'est trompe de case. F-JVIO exclue : son champ sert de
    // commentaires generiques, pas uniquement de remarques mecaniques.
    const anciennesObs = ((ancienRecord && ancienRecord.fields && ancienRecord.fields['Observations']) || '').toString().trim();
    const champEstRemarqueMeca = MACHINES_MOTEURS.includes(machine) && machine !== 'F-JVIO';
    if (observations && champEstRemarqueMeca && observations !== anciennesObs) {
        const confirme = await demanderConfirmationRemarqueMeca(machine);
        if (!confirme) return;
    }

    try {
        const url = `${API_BASE}/${encodeURIComponent(TABLE_CARNET_ROUTE)}${idCarnetEnEdition ? '/' + idCarnetEnEdition : ''}`;
        const response = await cachedFetch(url, {
            method: idCarnetEnEdition ? 'PATCH' : 'POST',
            headers: headers,
            body: JSON.stringify({ fields })
        });
        const result = await response.json();
        if (response.ok) {
            // Facturation temporaire cote serveur : ecriture provisoire sur
            // le compte du pilote tant que le vol n'est pas remonte dans GVV.
            const volId = idCarnetEnEdition || (result && result.id) || (result && result.records && result.records[0] && result.records[0].id);
            if (volId) {
                apiFetch(`${API_BASE}/vol-facturation-tempo`, {
                    method: 'POST', headers, body: JSON.stringify({ recordId: volId })
                }).catch(() => {});
            }
            if (idCarnetEnEdition && ancienRecord && ancienRecord.fields) {
                const af = ancienRecord.fields;
                if (af['Machine'] && af['Date'] && af['Horamètre arrivée'] !== undefined && af['Horamètre arrivée'] !== null && af['Horamètre arrivée'] !== '') {
                    await supprimerVolMaintenance(af['Machine'], af['Date'], af['Horamètre arrivée']);
                }
            }
            await synchroniserVolMaintenance(machine, date, pilote, fields['Horamètre arrivée']);
            fermerModaleCarnet();
            chargerCarnetRoute();
        } else {
            console.error(result);
            const msg = result && result.error && result.error.message ? result.error.message : 'Vérifiez la console pour le détail.';
            alert('Erreur lors de l\'enregistrement du vol : ' + msg);
        }
    } catch (error) {
        console.error(error);
        alert('Erreur lors de l\'enregistrement du vol.');
    }
}

// Modale d'avertissement quand une remarque mecanique est saisie au carnet.
// Resout true si le pilote confirme l'enregistrement, false s'il revient au
// formulaire (ex. case erronee). Le formulaire reste ouvert dans les 2 cas.
function demanderConfirmationRemarqueMeca(immat) {
    return new Promise(resolve => {
        const existing = document.getElementById('carnet-remarque-meca-modal');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'carnet-remarque-meca-modal';
        overlay.className = 'modal';
        overlay.style.display = 'flex';
        overlay.style.zIndex = '20000';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 460px; text-align: left;">
                <h3 style="display:flex; align-items:center; gap:10px; color:#1e3d59; margin-top:0;">
                    <span style="font-size:28px;">🔧</span>
                    <span>Remarque mécanique — ${escapeHtml(immat)}</span>
                </h3>
                <div style="margin-top:15px; line-height:1.6; font-size:15px; color:#334155;">
                    <p style="margin:0 0 10px 0;">Tu as noté un problème sur l'avion dans le carnet de route. Il sera transmis et <strong>traité dans les plus brefs délais par le mécanicien</strong>.</p>
                    <p style="margin:0; padding:10px 12px; background:#fef3c7; border-left:3px solid #d97706; border-radius:6px;">⚠️ <strong>Rappel :</strong> avant de noter quoi que ce soit dans le carnet de route, il faut <strong>appeler le mécanicien ou un instructeur</strong> — une panne peut rendre l'avion inapte au vol pour les prochaines réservations.</p>
                </div>
                <div style="display:flex; gap:10px; justify-content:space-between; margin-top:20px;">
                    <button type="button" class="nr-btn-cancel" id="remarque-meca-retour">← Revenir au vol</button>
                    <button type="button" class="btn-primary" id="remarque-meca-ok">Enregistrer quand même</button>
                </div>
            </div>
        `;
        const retour = () => { overlay.remove(); resolve(false); };
        overlay.querySelector('#remarque-meca-retour').addEventListener('click', retour);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) retour(); });
        overlay.querySelector('#remarque-meca-ok').addEventListener('click', () => { overlay.remove(); resolve(true); });
        document.body.appendChild(overlay);
    });
}

async function supprimerCarnetRoute() {
    if (!idCarnetEnEdition) return;
    const record = listeVolsCarnetCache.find(r => r.id === idCarnetEnEdition);
    if (record && !peutModifierVolCarnet(record)) {
        alert("Tu n'as pas le droit de supprimer ce vol.");
        return;
    }
    if (!(await confirmerSuppression('Supprimer ce vol du carnet de route ?'))) return;
    const f = record && record.fields ? record.fields : {};
    const machine = f['Machine'] || '';
    const date = f['Date'] || '';
    const horArr = f['Horamètre arrivée'];
    try {
        if (machine && date && horArr !== undefined && horArr !== null && horArr !== '') {
            await supprimerVolMaintenance(machine, date, horArr);
        }
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_CARNET_ROUTE)}/${idCarnetEnEdition}`, {
            method: 'DELETE',
            headers: headers
        });
        if (response.ok) {
            fermerModaleCarnet();
            chargerCarnetRoute();
        } else {
            const err = await response.text();
            console.error(err);
            alert('Erreur lors de la suppression.');
        }
    } catch (error) {
        console.error(error);
        alert('Erreur lors de la suppression.');
    }
}

async function getAvionId(machineImmat) {
    try {
        const url = `${API_BASE}/${encodeURIComponent('Aéronefs')}?filterByFormula=${encodeURIComponent(`{Immatriculation}='${machineImmat}'`)}`;
        const tous = await fetchTousRecordsCache(url, { headers });
        if (tous.length) return tous[0].id;
    } catch (e) { console.error(e); }
    return null;
}

async function supprimerVolMaintenance(machineImmat, date, horametreArrivee) {
    const avionId = await getAvionId(machineImmat);
    if (!avionId) return;
    const h = parseFloat(String(horametreArrivee).replace(',', '.'));
    if (isNaN(h)) return;
    try {
        const url = `${API_BASE}/${encodeURIComponent('Carnet de route')}?filterByFormula=${encodeURIComponent(`{Nouvel Horamètre}=${h}`)}`;
        const tous = await fetchTousRecordsCache(url, { headers });
        const records = tous.filter(r => {
            const f = r.fields || {};
            const m = f['Machine'];
            const machines = Array.isArray(m) ? m : [m];
            if (!machines.includes(avionId)) return false;
            if (!f['Date du vol']) return false;
            const d = new Date(f['Date du vol']).toISOString().split('T')[0];
            return d === date;
        });
        await Promise.all(records.map(rec => apiFetch(`${API_BASE}/${encodeURIComponent('Carnet de route')}/${rec.id}`, {
            method: 'DELETE',
            headers
        })));
    } catch (e) { console.error(e); }
}

async function synchroniserHorametreAeronef(machineImmat, carnets) {
    const avionId = await getAvionId(machineImmat);
    if (!avionId) return;
    let records = carnets;
    if (!records) {
        try {
            const url = `${API_BASE}/${encodeURIComponent(TABLE_CARNET_ROUTE)}?filterByFormula=${encodeURIComponent(`{Machine}='${machineImmat}'`)}`;
            records = await fetchTousRecordsCache(url, { headers });
        } catch (e) { console.error(e); return; }
    }
    const maxH = (records || []).reduce((max, c) => {
        const f = c.fields || {};
        const h = parseFloat(String(f['Horamètre arrivée'] || '').replace(',', '.'));
        return !isNaN(h) && h > max ? h : max;
    }, 0);
    if (maxH <= 0) return;
    try {
        await cachedFetch(`${API_BASE}/${encodeURIComponent('Aéronefs')}/${avionId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { 'Horamètre actuel': maxH } })
        });
    } catch (e) { console.error(e); }
}

async function nettoyerCarnetRouteMaintenance(machineImmat) {
    const avionId = await getAvionId(machineImmat);
    if (!avionId) return;
    try {
        const url = `${API_BASE}/${encodeURIComponent('Carnet de route')}`;
        const tous = await fetchTousRecordsCache(url, { headers });
        const records = tous.filter(r => {
            const f = r.fields || {};
            const m = f['Machine'];
            const machines = Array.isArray(m) ? m : [m];
            return machines.includes(avionId);
        });
        for (const rec of records) {
            const f = rec.fields || {};
            const h = parseFloat(String(f['Nouvel Horamètre'] || '').replace(',', '.'));
            if (isNaN(h)) continue;
            const d = f['Date du vol'] ? new Date(f['Date du vol']).toISOString().split('T')[0] : null;
            const correspond = listeVolsCarnetCache.some(r => {
                const pf = r.fields || {};
                if (pf['Machine'] !== machineImmat) return false;
                if (pf['Date'] !== d) return false;
                const ph = parseFloat(String(pf['Horamètre arrivée'] || '').replace(',', '.'));
                return !isNaN(ph) && Math.abs(ph - h) < 0.001;
            });
            if (!correspond) {
                await cachedFetch(`${API_BASE}/${encodeURIComponent('Carnet de route')}/${rec.id}`, {
                    method: 'DELETE',
                    headers
                });
            }
        }
    } catch (e) { console.error(e); }
}

function formaterImmatPlaneur(immat) {
    const parts = (immat || '').split(/\s(.+)/);
    if (parts.length < 2) return escHtml(immat);
    return `${escHtml(parts[0])} <span style="white-space:nowrap;">${escHtml(parts[1])}</span>`;
}

function genererGrillesPlaneur(categorie) {
    const container = document.getElementById('carnet-planeur-container');
    if (!container) return;
    const cat = CATEGORIES_CARNET[categorie] || CATEGORIES_CARNET['PLANEURS'];
    const createGrid = (items) => {
        const grid = document.createElement('div');
        grid.className = 'planeur-grid';
        items.forEach(immat => {
            const box = document.createElement('div');
            box.className = 'planeur-box';
            box.dataset.immat = immat;
            box.innerHTML = `
                <h3>${formaterImmatPlaneur(immat)}</h3>
                <div class="planeur-box-btns">
                    <button type="button" class="btn-doc-planeur btn-remarque" title="Ajouter une remarque mécanique">Remarque</button>
                    <button type="button" class="btn-doc-planeur" title="Suivi machine — documents et échéances">Suivi</button>
                </div>
            `;
            const btnRemarque = box.querySelector('.btn-remarque');
            if (btnRemarque) {
                btnRemarque.addEventListener('click', (e) => {
                    e.stopPropagation();
                    ouvrirModaleCarnet(null, immat);
                });
            }
            box.addEventListener('click', () => ouvrirModaleCarnet(null, immat));
            const btnDoc = box.querySelector('.btn-doc-planeur:not(.btn-remarque)');
            if (btnDoc) {
                btnDoc.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (typeof ouvrirModaleDocumentsAeronef === 'function') ouvrirModaleDocumentsAeronef(immat);
                });
            }
            grid.appendChild(box);
        });
        return grid;
    };
    container.innerHTML = '';
    const titre = document.createElement('h3');
    titre.className = 'planeur-section-title';
    titre.textContent = cat.titre;
    container.appendChild(titre);
    container.appendChild(createGrid(cat.items));
}

function initCarnetRoute() {
    const btnOuvrir = document.getElementById('btn-ouvrir-carnet');
    const btnFermer = document.querySelector('.close-modal-carnet');
    const btnDelete = document.getElementById('btn-delete-carnet');
    const btnCancel = document.getElementById('btn-cancel-carnet');
    const modal = document.getElementById('carnet-modal');
    const form = document.getElementById('carnet-form');
    const selectFiltre = document.getElementById('carnet-machine-filtre');

    genererGrillesPlaneur();

    if (btnOuvrir) btnOuvrir.addEventListener('click', () => ouvrirModaleCarnet());
    const btnDocs = document.getElementById('btn-documents-carnet');
    if (btnDocs) btnDocs.addEventListener('click', () => {
        if (typeof ouvrirModaleDocumentsAeronef === 'function') ouvrirModaleDocumentsAeronef(machineCarnetSelectionnee);
    });
    const btnBilanDocs = document.getElementById('btn-bilan-docs-carnet');
    if (btnBilanDocs) btnBilanDocs.addEventListener('click', () => {
        if (typeof ouvrirBilanDocumentsAeronefs === 'function') {
            if (typeof creerModaleBilanDocuments === 'function') creerModaleBilanDocuments();
            ouvrirBilanDocumentsAeronefs();
        }
    });
    const btnOptionsCarnet = document.getElementById('btn-options-carnet');
    if (btnOptionsCarnet) btnOptionsCarnet.addEventListener('click', () => {
        if (typeof window.ouvrirOptionsAeronef === 'function') {
            const idPref = typeof idAeronefDepuisImmat === 'function' ? idAeronefDepuisImmat(machineCarnetSelectionnee) : null;
            window.ouvrirOptionsAeronef(idPref);
        }
    });
    const btnLegendeCarnet = document.getElementById('btn-legende-carnet');
    if (btnLegendeCarnet) {
        btnLegendeCarnet.addEventListener('click', () => {
            const titre = t => `<div style="font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:0.6px; margin:14px 0 2px;">${t}</div>`;
            const item = (style, label) => `<div class="legende-ligne"><span class="legende-pastille" style="${style}"></span><span>${label}</span></div>`;
            const rond = (color, label) => `<div class="legende-ligne"><span class="legende-pastille" style="background:${color}; width:14px; height:14px; border-radius:50%; border-left:none; margin:0 6px;"></span><span>${label}</span></div>`;
            afficherModaleAlerte('Légende', `
                ${titre('📖 Lignes & marqueurs')}
                <div class="legende-ligne"><span class="legende-pastille" style="background:#fffbeb; border-left-color:#d97706;"></span><span>Ligne de maintenance</span></div>
                ${item('background:#dc2626;', 'Écart d\'horamètre (continuité à vérifier)')}
                <div class="legende-ligne"><span style="display:inline-block; padding:1px 6px; font-size:10px; font-weight:700; color:#166534; background:#dcfce7; border:1px solid #86efac; border-radius:8px;">GVV</span><span>Vol envoyé vers GVV (compta)</span></div>
                <div class="legende-ligne"><span style="display:inline-block; padding:1px 6px; font-size:10px; font-weight:700; color:#1d4ed8; background:#dbeafe; border:1px solid #93c5fd; border-radius:8px;">GVV</span><span>Vol déjà saisi dans GVV (pilote, date, machine et horamètres identiques — y compris un seul vol GVV couvrant plusieurs lignes du carnet, ou marqué manuellement « ✓ Déjà dans GVV »)</span></div>
                ${titre('🛠️ Boutons (modifier un vol)')}
                <div class="legende-ligne"><strong style="min-width:110px; color:#1e3d59;">⇒ GVV</strong><span>envoyer le vol vers la comptabilité GVV</span></div>
                <div class="legende-ligne"><strong style="min-width:110px; color:#1e3d59;">✓ Déjà dans GVV</strong><span>marquer le vol comme déjà saisi dans GVV (badge bleu, blocage de l'envoi en doublon)</span></div>
                ${titre('📋 Statuts d\'une observation')}
                ${rond('#dc2626', 'Non prise en compte')}
                ${rond('#d97706', 'Prise en compte')}
                ${rond('#2563eb', 'En cours de traitement')}
                ${rond('#16a34a', 'Observation traitée')}
                ${titre('📄 Documents machine')}
                ${rond('#10b981', 'Document en cours de validité (> 3 mois)')}
                ${rond('#f97316', 'Document en fin de validité (< 3 mois)')}
                ${rond('#dc2626', 'Document expiré')}
            `, 'ℹ️');
        });
    }
    if (btnFermer) btnFermer.addEventListener('click', fermerModaleCarnet);
    if (btnCancel) btnCancel.addEventListener('click', fermerModaleCarnet);
    if (btnDelete) btnDelete.addEventListener('click', supprimerCarnetRoute);
    const btnGvv = document.getElementById('btn-gvv-carnet');
    if (btnGvv) btnGvv.addEventListener('click', envoyerVolVersGvv);
    const btnGvvManuel = document.getElementById('btn-gvv-manuel-carnet');
    if (btnGvvManuel) btnGvvManuel.addEventListener('click', marquerVolSaisiGvv);
    const rechercheInput = document.getElementById('carnet-recherche');
    if (rechercheInput) {
        rechercheInput.addEventListener('input', () => {
            carnetPageJVIO = 1;
            chargerCarnetRoute();
        });
    }
    const btnRecherche = document.getElementById('btn-recherche-carnet');
    if (btnRecherche && rechercheInput) {
        const fermerRecherche = () => {
            rechercheInput.classList.add('carnet-recherche-masquee');
            if (rechercheInput.value) {
                rechercheInput.value = '';
                rechercheInput.dispatchEvent(new Event('input'));
            }
        };
        btnRecherche.addEventListener('click', () => {
            const masquee = rechercheInput.classList.contains('carnet-recherche-masquee');
            if (masquee) {
                rechercheInput.classList.remove('carnet-recherche-masquee');
                rechercheInput.focus();
            } else {
                fermerRecherche();
            }
        });
        rechercheInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') fermerRecherche();
        });
    }
    let resizeTimerCarnet = null;
    window.addEventListener('resize', () => {
        const vue = document.getElementById('view-carnet');
        if (!vue || vue.style.display === 'none') return;
        clearTimeout(resizeTimerCarnet);
        resizeTimerCarnet = setTimeout(() => {
            if (derniersRecordsCarnet.length) afficherCarnet(derniersRecordsCarnet);
        }, 250);
    });
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) fermerModaleCarnet();
        });
    }
    if (form) form.addEventListener('submit', soumettreCarnetRoute);
    if (selectFiltre) {
        if (selectFiltre.querySelector(`option[value="${machineCarnetSelectionnee}"]`)) {
            selectFiltre.value = machineCarnetSelectionnee;
        } else {
            machineCarnetSelectionnee = selectFiltre.value;
        }
        selectFiltre.addEventListener('change', (e) => {
            machineCarnetSelectionnee = e.target.value;
            carnetPageJVIO = 1;
            chargerCarnetRoute();
        });
    }
    const champsCalculHeureArrivee = ['carnet-machine', 'carnet-horametre-depart', 'carnet-horametre-arrivee', 'carnet-heure-depart'];
    champsCalculHeureArrivee.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                mettreAJourHeureArrivee();
                mettreAJourPrixDuVol();
            });
        }
    });
    const elHeureArrivee = document.getElementById('carnet-heure-arrivee');
    if (elHeureArrivee) elHeureArrivee.addEventListener('input', mettreAJourPrixDuVol);
    // Saisie d'un vol dans le passe : l'horametre/terrain de depart se
    // raffinent sur le vol precedent la date+heure choisies (creation
    // seulement, et tant que l'utilisateur n'a pas retouche les champs).
    const raffinerDepart = () => {
        if (document.getElementById('carnet-id')?.value) return;
        mettreAJourDonneesDepartDefaut(document.getElementById('carnet-machine')?.value || '');
    };
    ['carnet-date', 'carnet-heure-depart'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', raffinerDepart);
    });
    ['carnet-horametre-depart', 'carnet-depart'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => { delete el.dataset.auto; });
    });
    ['carnet-depart', 'carnet-arrivee'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', suggererNatureParTrajet);
    });
    const elInstructeur = document.getElementById('carnet-instructeur');
    if (elInstructeur) {
        elInstructeur.addEventListener('change', () => {
            const machine = document.getElementById('carnet-machine')?.value || '';
            if (!elInstructeur.value.trim() || machine === 'F-JVIO' || !MACHINES_MOTEURS.includes(machine)) return;
            const fi = document.querySelector('input[name="carnet-fonction"][value="FI"]');
            if (fi && !fi.checked) {
                fi.checked = true;
                appliquerExclusiviteFonctions(fi);
            }
            const ep = document.querySelector('input[name="carnet-fonction"][value="EP"]');
            if (ep && !ep.checked) {
                ep.checked = true;
                appliquerExclusiviteFonctions(ep);
            }
            const vi = document.querySelector('input[name="carnet-nature-extra"][value="Vol d\'initiation"]');
            if (vi && vi.checked) {
                vi.checked = false;
                majVerrouillageVolInitiation();
            }
            mettreAJourNatureParFonction();
        });
    }

    const nature = document.getElementById('carnet-nature');
    if (nature) {
        nature.addEventListener('change', () => {
            mettreAJourNatureParFonction();
            mettreAJourActiviteParticuliere();
            mettreAJourPrixDuVol();
        });
    }

    peuplerOptionsMachineCarnet();
    const selectMachine = document.getElementById('carnet-machine');
    if (selectMachine) {
        selectMachine.addEventListener('change', async () => {
            adapterFormulaireCarnet(selectMachine.value);
            const instSel = document.getElementById('carnet-instructeur');
            await peuplerCarnetInstructeurs(instSel ? instSel.value : '', selectMachine.value);
            if (!document.getElementById('carnet-id')?.value) mettreAJourDonneesDepartDefaut(selectMachine.value, true);
            mettreAJourStyleChampsAuto(selectMachine.value);
            mettreAJourHeureArrivee();
            mettreAJourActiviteParticuliere();
            mettreAJourPrixDuVol();
        });
        adapterFormulaireCarnet(selectMachine.value);
        mettreAJourStyleChampsAuto(selectMachine.value);
    }

    chargerCarnetRoute();
}
