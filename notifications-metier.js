/* ==========================================================================
   NOTIFICATIONS MÉTIER
   Déduplication par champ "Clé" (stable) + vérifications périodiques.
   Catégories :
   - Potentiel machine < 0h au moment d'un vol réservé (pilote concerné)
   - Compte pilote en négatif (pilote concerné)
   - Qualification/validité proche de la péremption ou périmée (pilote)
   - Nouveaux créneaux VI disponibles (pilotes VI)
   - Potentiel machine arrivé à sa butée (mécaniciens)
   - Documents aéronefs en échéance, regroupés (mécaniciens)
   - Licences pilotes en échéance, regroupées (instructeurs)
   - Nouvel événement (tous les membres)
   ========================================================================== */

const NOTIF_SEUIL_POTENTIEL = 10;          // heures avant butée -> alerte mécanicien
const NOTIF_JOURS_ECHANCE = 30;            // jours avant échéance docs/licences
const NOTIF_INTERVALLE_CHECK_MS = 2 * 3600 * 1000; // vérifications au plus 1x/2h par poste

/* --------------------------------------------------------------------------
   Utilitaires
   -------------------------------------------------------------------------- */
function notifMoisCourant() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function notifDateIso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function notifHash(texte) {
    // Hash simple (djb2) -> base36, suffisant pour des clés de dédup
    let h = 5381;
    const s = String(texte);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

function notifRoles(roles) {
    return Array.isArray(roles) ? roles : [roles].filter(Boolean);
}

function notifEstMecanicien(roles) {
    const r = notifRoles(roles);
    return r.includes('Mécanicien') || r.includes('Mecanicien');
}

function notifEstInstructeur(roles) {
    return notifRoles(roles).some(r => (r || '').toString().toLowerCase().includes('instructeur'));
}

function notifEstPiloteVI(roles) {
    return notifRoles(roles).includes('Pilote VI');
}

function notifEstSuperAdmin(roles) {
    const r = notifRoles(roles);
    return r.includes('Super admin') || r.includes('Super Admin');
}

function notifNomCompletMembre(membre) {
    const f = (membre && membre.fields) || {};
    return `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
}

async function notifChargerMembres() {
    if (!listeMembresCache.length && typeof chargerListeMembresCache === 'function') {
        await chargerListeMembresCache();
    }
    if (!listeMembresCache.length) {
        try {
            listeMembresCache = await fetchTousRecords(
                `${API_BASE}/${encodeURIComponent(TABLE_UTILISATEURS)}?pageSize=100`, { headers });
        } catch (e) { console.warn('Chargement membres notifications:', e); }
    }
    return listeMembresCache || [];
}

/* --------------------------------------------------------------------------
   Déduplication : on mémorise en mémoire les couples "Pilote|Clé" déjà émis.
   -------------------------------------------------------------------------- */
let _clesNotifChargees = null;

async function chargerClesNotifications(force = false) {
    if (_clesNotifChargees && !force) return _clesNotifChargees;
    _clesNotifChargees = new Set();
    try {
        const records = await fetchTousRecords(
            `${API_BASE}/${encodeURIComponent(TABLE_NOTIFICATIONS)}?pageSize=100`, { headers });
        records.forEach(r => {
            const f = r.fields || {};
            const cle = f['Clé'] || f['Cle'];
            if (f['Pilote'] && cle) _clesNotifChargees.add(`${f['Pilote']}|${cle}`);
        });
    } catch (e) {
        console.warn('Lecture des notifications pour dédup:', e);
    }
    return _clesNotifChargees;
}

// Émet une notification seulement si (pilote, clé) n'a jamais été envoyé.
async function notifierUnique(piloteNom, cle, message, type = 'info', lien = '') {
    if (!piloteNom || !cle) return false;
    const cible = typeof formaterNomPilote === 'function' ? formaterNomPilote(piloteNom) : piloteNom;
    if (!cible) return false;
    const cles = await chargerClesNotifications();
    const key = `${cible}|${cle}`;
    if (cles.has(key)) return false;
    cles.add(key); // optimiste : évite les doublons en cas d'appels concurrents
    try {
        const res = await apiFetch(`${API_BASE}/${encodeURIComponent(TABLE_NOTIFICATIONS)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                records: [{
                    fields: {
                        'Pilote': cible,
                        'Message': message,
                        'Type': type,
                        'Date': notifDateIso(new Date()),
                        'Lue': false,
                        'Lien': lien,
                        'Clé': cle
                    }
                }]
            })
        });
        return res.ok;
    } catch (e) {
        cles.delete(key);
        console.warn('Émission notification:', e);
        return false;
    }
}

// Notifie tous les membres dont les rôles matchent `filtreRoles`.
async function notifierParRole(filtreRoles, cle, message, type = 'info', lien = '', exclurePilote = '') {
    const membres = await notifChargerMembres();
    let envoyees = 0;
    for (const m of membres) {
        const f = m.fields || {};
        if (f['Actif'] === false) continue;
        if (!filtreRoles(notifRoles(f['Rôles']))) continue;
        const nom = notifNomCompletMembre(m);
        if (!nom) continue;
        if (exclurePilote && typeof correspondanceNom === 'function' && correspondanceNom(nom, exclurePilote)) continue;
        if (await notifierUnique(nom, cle, message, type, lien)) envoyees++;
    }
    return envoyees;
}

/* --------------------------------------------------------------------------
   POTENTIEL MACHINE : trajectoire chronologique des réservations.
   Pour chaque réservation dont la fin laisse un potentiel < 0, on notifie son
   pilote — y compris les réservations lointaines mangées par des vols antérieurs.
   -------------------------------------------------------------------------- */
async function chargerContextePotentiel() {
    const [aeronefs, reservations, carnets, maintenances] = await Promise.all([
        fetchTousRecords(`${API_BASE}/${encodeURIComponent('Aéronefs')}?pageSize=100`, { headers }),
        fetchTousRecords(`${API_BASE}/${encodeURIComponent('Réservations')}?pageSize=100`, { headers }),
        fetchTousRecords(`${API_BASE}/${encodeURIComponent('Carnet de route Pilotes')}?pageSize=100`, { headers }),
        fetchTousRecords(`${API_BASE}/${encodeURIComponent('Maintenance')}?pageSize=100`, { headers })
    ]);
    return { aeronefs, reservations, carnets, maintenances };
}

function notifImmat(aeronef) {
    return ((aeronef.fields || {})['Immatriculation'] || (aeronef.fields || {})['Nom'] || '').toString().trim();
}

function notifMatchMachine(resa, aeronef) {
    const f = resa.fields || {};
    const vals = Array.isArray(f['Machine']) ? f['Machine'] : [f['Machine']];
    const immat = notifImmat(aeronef).toUpperCase();
    return vals.some(v => {
        const s = (v || '').toString().trim().toUpperCase();
        return s === aeronef.id.toUpperCase() || s === immat;
    });
}

function notifHorametreActuel(aeronef, carnets) {
    const f = aeronef.fields || {};
    const immat = notifImmat(aeronef).toUpperCase();
    const stocke = parseFloat(String(f['Horamètre actuel'] ?? '').replace(',', '.')) || 0;
    const maxCarnet = (carnets || []).reduce((max, c) => {
        const cf = c.fields || {};
        if ((cf['Machine'] || '').toString().trim().toUpperCase() !== immat) return max;
        const h = parseFloat(String(cf['Horamètre arrivée'] ?? '').replace(',', '.'));
        return !isNaN(h) && h > max ? h : max;
    }, 0);
    return maxCarnet > 0 ? maxCarnet : stocke;
}

function notifButeeApplicable(aeronef, maintenancesMachine, dateStr) {
    // Dernière "Nouvelle Butée" posée avant la date ; sinon l'ancienne butée
    // de la première maintenance connue ; sinon la butée courante de la fiche.
    const avant = maintenancesMachine.filter(m => String((m.fields || {})['Date'] || '').slice(0, 10) <= dateStr);
    if (avant.length) {
        const derniere = avant[avant.length - 1];
        const v = parseFloat(String((derniere.fields || {})['Nouvelle Butée'] ?? '').replace(',', '.'));
        if (!isNaN(v) && v > 0) return v;
    }
    if (maintenancesMachine.length) {
        const v = parseFloat(String((maintenancesMachine[0].fields || {})['Ancienne butée'] ?? '').replace(',', '.'));
        if (!isNaN(v) && v > 0) return v;
    }
    return parseFloat(String((aeronef.fields || {})['Prochaine Butée'] ?? '').replace(',', '.')) || 0;
}

// Pour un aéronef : renvoie [{resa, potentielApres}] triées par début.
function notifTrajectoirePotentiel(aeronef, reservations, carnets, maintenances) {
    const immat = notifImmat(aeronef).toUpperCase();
    const maintenant = new Date();
    const maintenancesMachine = (maintenances || [])
        .filter(m => ((m.fields || {})['Machine'] || '').toString().trim().toUpperCase() === immat)
        .sort((a, b) => new Date(a.fields['Date']) - new Date(b.fields['Date']));
    const horametre = notifHorametreActuel(aeronef, carnets);
    const resas = (reservations || [])
        .filter(r => {
            const f = r.fields || {};
            if (!f['Date de début'] || !f['Date de fin']) return false;
            if (!notifMatchMachine(r, aeronef)) return false;
            return new Date(f['Date de fin']) > maintenant; // vols pas encore terminés
        })
        .sort((a, b) => new Date(a.fields['Date de début']) - new Date(b.fields['Date de début']));

    let consomme = 0; // heures consommées depuis maintenant (incluses dans le cumul)
    return resas.map(r => {
        const f = r.fields || {};
        const debut = new Date(f['Date de début']);
        const fin = new Date(f['Date de fin']);
        const dateStr = f['Date de début'].slice(0, 10);
        const dureeTotale = Math.max(0, (fin - debut) / 3600000);
        let duree = parseFloat(f['Temps estimé']) || dureeTotale;
        if (debut < maintenant) {
            // Vol en cours : on ne consomme que ce qui reste à voler.
            duree = Math.min(duree, Math.max(0, (fin - maintenant) / 3600000));
        }
        consomme += duree;
        const butee = notifButeeApplicable(aeronef, maintenancesMachine, dateStr);
        // Pas de butée renseignée -> pas de calcul possible, jamais d'alerte.
        return { resa: r, potentielApres: butee > 0 ? butee - horametre - consomme : Infinity };
    });
}

// Notifie les pilotes dont une réservation laisse le potentiel sous 0.
// `avionIdRestreint` : limiter à une machine (appel post-enregistrement).
async function verifierPotentielReservations(avionIdRestreint = '') {
    try {
        const { aeronefs, reservations, carnets, maintenances } = await chargerContextePotentiel();
        const machines = aeronefs.filter(a => !avionIdRestreint || a.id === avionIdRestreint);
        const membres = await notifChargerMembres();
        for (const aeronef of machines) {
            const immat = notifImmat(aeronef);
            const traj = notifTrajectoirePotentiel(aeronef, reservations, carnets, maintenances);
            for (const { resa, potentielApres } of traj) {
                if (potentielApres >= 0) continue;
                const f = resa.fields || {};
                const piloteBrut = Array.isArray(f['Pilote']) ? f['Pilote'][0] : (f['Pilote'] || '');
                let piloteNom = piloteBrut;
                if (typeof piloteBrut === 'string' && piloteBrut.startsWith('rec')) {
                    const membre = membres.find(m => m.id === piloteBrut);
                    if (membre) piloteNom = notifNomCompletMembre(membre);
                }
                if (!piloteNom) continue;
                const jour = new Date(f['Date de début']);
                const jourIso = notifDateIso(jour);
                const jourFr = jour.toLocaleDateString('fr-FR');
                const reste = potentielApres.toFixed(1).replace('.', ',');
                const cle = `potneg-${resa.id}-${jourIso}`;
                await notifierUnique(
                    piloteNom, cle,
                    `⚠️ Le potentiel de ${immat} sera épuisé lors de votre vol du ${jourFr} (estimation : ${reste} h restantes). Contactez le club pour anticiper la maintenance.`,
                    'warning', `planning:${jourIso}`
                );
            }
        }
    } catch (e) {
        console.warn('Vérification potentiel réservations:', e);
    }
}

/* --------------------------------------------------------------------------
   COMPTE PILOTE EN NÉGATIF
   -------------------------------------------------------------------------- */
async function notifierCompteNegatif(piloteNom, solde) {
    if (!piloteNom || !(solde < 0)) return;
    const soldeTxt = solde.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await notifierUnique(
        piloteNom, `solde-neg-${notifHash(piloteNom)}-${notifMoisCourant()}`,
        `💳 Votre compte pilote est débiteur de ${soldeTxt} €. Merci de le recréditer depuis l'espace Compte pilote.`,
        'warning', 'comptes:'
    );
}

// Vérifié pour l'utilisateur courant (login) ; aussi appelé depuis le résumé
// du compte pilote pour couvrir le passage en négatif vu par le trésorier.
async function verifierSoldePiloteNegatif() {
    if (!currentUser || typeof getSoldePilote !== 'function') return;
    try {
        const nom = typeof nomPiloteComptes === 'function' ? nomPiloteComptes(currentUser) : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
        if (!nom) return;
        await notifierCompteNegatif(nom, await getSoldePilote(nom));
    } catch (e) {
        console.warn('Vérification solde pilote:', e);
    }
}

/* --------------------------------------------------------------------------
   VALIDITÉS / QUALIFICATIONS du pilote connecté (regroupées en 1 notif)
   -------------------------------------------------------------------------- */
async function verifierValiditesPilote() {
    if (!currentUser || typeof chargerValiditesAccueil !== 'function') return;
    try {
        const validites = await chargerValiditesAccueil();
        if (!validites || !validites.items) return;
        const lignes = [];
        validites.items.forEach(i => {
            if (i.actif === false) return;
            const dateFr = i.date ? new Date(i.date).toLocaleDateString('fr-FR') : '';
            if (i.ok === false) lignes.push(`${i.label}${dateFr ? ` (périmée le ${dateFr})` : ''}`);
            else if (i.bientot) lignes.push(`${i.label}${dateFr ? ` (expire le ${dateFr})` : ''}`);
        });
        if (!lignes.length) return;
        const nom = `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
        const cle = `validites-${currentUser.id}-${notifHash(lignes.join('|'))}`;
        await notifierUnique(
            nom, cle,
            `📋 Des éléments de votre dossier expirent bientôt ou sont périmés — merci de vous rapprocher du club pour les mettre à jour :\n${lignes.map(l => `• ${l}`).join('\n')}`,
            'warning', 'membres:'
        );
    } catch (e) {
        console.warn('Vérification validités pilote:', e);
    }
}

/* --------------------------------------------------------------------------
   MÉCANICIENS : machines arrivées à butée + documents aéronefs en échéance.
   -------------------------------------------------------------------------- */
async function verifierAlertesMecaniciens() {
    const mecaOuAdmin = roles => notifEstMecanicien(roles) || notifEstSuperAdmin(roles);
    try {
        const { aeronefs, reservations, carnets, maintenances } = await chargerContextePotentiel();
        const aujourdhui = notifDateIso(new Date());
        for (const aeronef of aeronefs) {
            const f = aeronef.fields || {};
            const immat = notifImmat(aeronef);
            if (!immat) continue;
            const butee = parseFloat(String(f['Prochaine Butée'] ?? '').replace(',', '.')) || 0;
            if (butee <= 0) continue;
            const maintenancesMachine = (maintenances || [])
                .filter(m => ((m.fields || {})['Machine'] || '').toString().trim().toUpperCase() === immat.toUpperCase())
                .sort((a, b) => new Date(a.fields['Date']) - new Date(b.fields['Date']));
            const buteeJour = notifButeeApplicable(aeronef, maintenancesMachine, aujourdhui);
            const potentiel = buteeJour - notifHorametreActuel(aeronef, carnets);
            if (potentiel <= 0) {
                await notifierParRole(
                    mecaOuAdmin, `butee-${aeronef.id}-${buteeJour}-depassee`,
                    `🛠️ ${immat} a atteint sa butée (potentiel ${potentiel.toFixed(1).replace('.', ',')} h). Maintenance à programmer.`,
                    'danger', 'aeronefs:'
                );
            } else if (potentiel <= NOTIF_SEUIL_POTENTIEL) {
                await notifierParRole(
                    mecaOuAdmin, `butee-${aeronef.id}-${buteeJour}-proche`,
                    `🛠️ ${immat} approche de sa butée : ${potentiel.toFixed(1).replace('.', ',')} h restantes.`,
                    'warning', 'aeronefs:'
                );
            }
        }
    } catch (e) {
        console.warn('Vérification butées machines:', e);
    }

    // Documents aéronefs en échéance -> une seule notification groupée
    try {
        const docs = typeof chargerTousDocumentsAeronefs === 'function'
            ? await chargerTousDocumentsAeronefs() : [];
        const limite = new Date();
        limite.setDate(limite.getDate() + NOTIF_JOURS_ECHANCE);
        limite.setHours(23, 59, 59, 999);
        const auj = new Date(); auj.setHours(0, 0, 0, 0);
        const enEcheance = (docs || []).filter(r => {
            const f = r.fields || {};
            if (f['Activé'] === false) return false;
            const dv = f['Date de validité'];
            if (!dv) return false;
            const d = new Date(dv + 'T00:00:00');
            return d <= limite;
        }).map(r => {
            const f = r.fields || {};
            const d = new Date(f['Date de validité'] + 'T00:00:00');
            const perime = d < auj;
            return `• ${f['Machine'] || '?'} — ${f['Type de document'] || 'Document'} : ${perime ? 'périmé depuis le' : 'expire le'} ${d.toLocaleDateString('fr-FR')}`;
        }).sort();
        if (enEcheance.length) {
            const cle = `docsaero-${notifHash(enEcheance.join('|'))}`;
            await notifierParRole(
                mecaOuAdmin, cle,
                `📄 ${enEcheance.length} document(s) aéronef en échéance ou périmé(s) :\n${enEcheance.join('\n')}`,
                'warning', 'aeronefs:'
            );
        }
    } catch (e) {
        console.warn('Vérification documents aéronefs:', e);
    }
}

/* --------------------------------------------------------------------------
   INSTRUCTEURS : licences des pilotes en échéance (une notif groupée).
   -------------------------------------------------------------------------- */
async function verifierAlertesInstructeurs() {
    const instrOuAdmin = roles => notifEstInstructeur(roles) || notifEstSuperAdmin(roles);
    try {
        const membres = await notifChargerMembres();
        const limite = new Date();
        limite.setDate(limite.getDate() + NOTIF_JOURS_ECHANCE);
        limite.setHours(23, 59, 59, 999);
        const auj = new Date(); auj.setHours(0, 0, 0, 0);
        const champsLicences = ['Licence FFVP', 'Licence FFA', 'Licence FFPLUM', 'Licence SEP'];
        const lignes = [];
        membres.forEach(m => {
            const f = m.fields || {};
            if (f['Actif'] === false) return;
            const nom = notifNomCompletMembre(m);
            if (!nom) return;
            const suivis = Array.isArray(f['Suivis actifs']) ? f['Suivis actifs'] : (f['Suivis actifs'] ? [f['Suivis actifs']] : []);
            champsLicences.forEach(champ => {
                if (champ === 'Licence SEP' && suivis.length && !suivis.includes('Licence SEP')) return;
                const dv = f[champ];
                if (!dv) return;
                const d = new Date(dv + 'T00:00:00');
                if (isNaN(d.getTime()) || d > limite) return;
                const court = typeof formaterNomPilote === 'function' ? formaterNomPilote(nom) : nom;
                lignes.push(`• ${court} — ${champ} : ${d < auj ? 'périmée depuis le' : 'expire le'} ${d.toLocaleDateString('fr-FR')}`);
            });
        });
        if (!lignes.length) return;
        lignes.sort();
        const cle = `licences-${notifHash(lignes.join('|'))}`;
        await notifierParRole(
            instrOuAdmin, cle,
            `🎓 Licences de pilotes en échéance ou périmées :\n${lignes.join('\n')}`,
            'warning', 'membres:'
        );
    } catch (e) {
        console.warn('Vérification licences pilotes:', e);
    }
}

/* --------------------------------------------------------------------------
   HOOKS ÉVÉNEMENTIELS (appelés depuis les modules concernés)
   -------------------------------------------------------------------------- */

// Après création de créneaux VI -> notifier les pilotes VI (1 notif groupée).
async function notifierNouveauxCreneauxVI(type, dates) {
    if (!dates || !dates.length) return;
    try {
        const datesFr = dates.slice().sort().map(d => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR'));
        const libelleType = { VIP: 'planeur', VIA: 'avion', VIULM: 'ULM' }[type] || type;
        const liste = datesFr.length > 6 ? `${datesFr.slice(0, 6).join(', ')}…` : datesFr.join(', ');
        const cle = `vi-${type}-${notifHash(dates.slice().sort().join('|'))}`;
        await notifierParRole(
            roles => notifEstPiloteVI(roles) || notifEstSuperAdmin(roles),
            cle,
            `🎯 De nouveaux créneaux de vol d'initiation (${libelleType}) sont disponibles : ${liste}.`,
            'info', 'initiation:'
        );
    } catch (e) {
        console.warn('Notification nouveaux créneaux VI:', e);
    }
}

// Après création d'un événement -> notifier tous les membres actifs (sauf créateur).
async function notifierNouvelEvenement(recordId, titre, dateDebut, createur) {
    if (!recordId) return;
    try {
        const dateFr = dateDebut ? new Date(dateDebut + 'T00:00:00').toLocaleDateString('fr-FR') : '';
        const cle = `evt-${recordId}`;
        await notifierParRole(
            () => true,
            cle,
            `📅 Nouvel événement : « ${titre} »${dateFr ? ` le ${dateFr}` : ''}. Consultez le calendrier du club.`,
            'info', dateDebut ? `planning:${dateDebut}` : 'accueil:',
            createur
        );
    } catch (e) {
        console.warn('Notification nouvel événement:', e);
    }
}

/* --------------------------------------------------------------------------
   ORCHESTRATEUR : vérifications au login (throttlées par poste et par compte).
   -------------------------------------------------------------------------- */
let _checkNotifEnCours = false;

async function verifierNotificationsMetier() {
    if (!currentUser || _checkNotifEnCours) return;
    const cleThrottle = `notif-check-${currentUser.id}`;
    const dernier = parseInt(localStorage.getItem(cleThrottle) || '0', 10);
    if (Date.now() - dernier < NOTIF_INTERVALLE_CHECK_MS) return;
    _checkNotifEnCours = true;
    localStorage.setItem(cleThrottle, String(Date.now()));
    try {
        const roles = notifRoles(currentUser.roles);
        const taches = [
            verifierPotentielReservations(),
            verifierSoldePiloteNegatif(),
            verifierValiditesPilote()
        ];
        if (notifEstMecanicien(roles) || notifEstSuperAdmin(roles)) taches.push(verifierAlertesMecaniciens());
        if (notifEstInstructeur(roles) || notifEstSuperAdmin(roles)) taches.push(verifierAlertesInstructeurs());
        await Promise.allSettled(taches);
        if (typeof chargerNotifications === 'function') chargerNotifications();
    } finally {
        _checkNotifEnCours = false;
    }
}
