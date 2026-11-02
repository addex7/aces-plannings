/* ==========================================================================
   UTILITAIRES - FONCTIONS COMMUNES
   ========================================================================== */

// Coordonnées GPS de LFOY (Le Havre - Octeville / Saint-Romain)
const LFOY_LAT = 49.533;
const LFOY_LON = 0.088;

// ==========================================================================
// HELPERS DATE / VOL - partagés entre l'accueil pilote et l'espace membre.
// ==========================================================================

function debutJour(d) {
    const j = new Date(d);
    j.setHours(0, 0, 0, 0);
    return j;
}

function formaterDateFr(str) {
    if (!str) return null;
    const d = new Date(str);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function dateIlYAMois(mois) {
    const auj = new Date();
    return new Date(auj.getFullYear(), auj.getMonth() - mois, auj.getDate());
}

function estValideJusqua(str) {
    if (!str) return false;
    const d = new Date(str);
    if (isNaN(d.getTime())) return false;
    return debutJour(d) >= debutJour(new Date());
}

// Échéance à moins de 3 mois (mais encore valide).
function bientotExpire(str) {
    if (!str) return false;
    const d = new Date(str);
    if (isNaN(d.getTime())) return false;
    const seuil = new Date();
    seuil.setMonth(seuil.getMonth() + 3);
    return debutJour(d) >= debutJour(new Date()) && debutJour(d) < debutJour(seuil);
}

// Durée d'un vol en minutes : horamètres en priorité, sinon heures départ/arrivée.
function dureeVolMinutes(f) {
    if (f['Horamètre départ'] !== undefined && f['Horamètre arrivée'] !== undefined) {
        const machine = (f['Machine'] || '').toString().trim().toUpperCase();
        if (machine === 'F-JVIO') {
            // Horamètre JVIO au format H.MM (1154.17 = 1154 h 17 min), pas décimal
            const versMin = v => {
                const t = parseFloat(String(v).replace(',', '.'));
                if (isNaN(t)) return null;
                const h = Math.floor(t);
                return h * 60 + Math.round((t - h) * 100);
            };
            const dep = versMin(f['Horamètre départ']);
            const arr = versMin(f['Horamètre arrivée']);
            if (dep !== null && arr !== null && arr >= dep) return arr - dep;
        } else {
            const dep = parseFloat(f['Horamètre départ']);
            const arr = parseFloat(f['Horamètre arrivée']);
            if (!isNaN(dep) && !isNaN(arr) && arr >= dep) return Math.round((arr - dep) * 60);
        }
    }
    if (!f['Heure départ'] || !f['Heure arrivée']) return 0;
    const [hD, mD] = f['Heure départ'].split(':').map(Number);
    const [hA, mA] = f['Heure arrivée'].split(':').map(Number);
    if (isNaN(hD) || isNaN(mD) || isNaN(hA) || isNaN(mA)) return 0;
    let minutes = (hA * 60 + mA) - (hD * 60 + mD);
    if (minutes < 0) minutes += 24 * 60;
    return minutes;
}

// ==========================================================================
// EXPÉRIENCES PILOTE - calcul partagé (accueil pilote + espace membre).
// ==========================================================================

// Récupère tous les vols d'un pilote sur 24 mois : carnet de route (filtré
// par nom côté serveur, en pilote OU en instructeur — les heures
// d'instruction comptent dans l'experience) + vols extérieurs (carnet de vol).
// Chaque record est marque _volCommePilote / _volCommeInstructeur pour
// permettre aux calculs de distinguer le role tenu sur le vol.
// Normalisation de noms identique a celle du carnet (normNomGvv /
// nomsGvvCompatibles dans carnet.js) — copies pour independance de chargement.
function normNomGvv2(s) {
    return (s || '').toString().toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ')
        .split(' ').filter(Boolean).sort().join(' ');
}
function nomsGvvCompatibles2(nomA, nomB) {
    const ta = normNomGvv2(nomA).split(' ').filter(Boolean);
    const tb = normNomGvv2(nomB).split(' ').filter(Boolean);
    if (ta.join(' ') === tb.join(' ')) return true;
    return ta.length === tb.length && ta.every((t, i) => t === tb[i] || tb[i].startsWith(t) || t.startsWith(tb[i]));
}

// Vols importes de GVV qui n'ont pas de ligne carnet pour CE pilote :
// convertis en pseudo-lignes marquees _sourceGvv pour le calcul d'experience
// (heures = horametres, atterrissages = champ « Attero » GVV quand present).
async function volsGvvOrphelinsPilote(prenom, nom, recordsCarnet) {
    const nomComplet = `${prenom || ''} ${nom || ''}`.trim();
    const tous = await fetchTousRecordsCache(`${API_BASE}/${encodeURIComponent('Vols GVV')}?pageSize=100`, { headers });
    const num = v => parseFloat(String(v ?? '').replace(',', '.'));
    const lignes = (recordsCarnet || []).map(r => r.fields || {}).filter(f => f['Date'] && f['Machine']);
    const couvert = g => {
        const jour = lignes.filter(f => f['Date'] === g.date && (f['Machine'] || '').toString().trim().toUpperCase() === g.immat);
        // Match strict : une ligne avec meme debut ET fin.
        if (jour.some(f => Math.abs(num(f['Horamètre départ']) - g.deb) <= 0.005 && Math.abs(num(f['Horamètre arrivée']) - g.fin) <= 0.005)) return true;
        // Match groupe : debut sur une ligne, fin sur une autre (nav en 2 lignes).
        return jour.some(f => Math.abs(num(f['Horamètre départ']) - g.deb) <= 0.005)
            && jour.some(f => Math.abs(num(f['Horamètre arrivée']) - g.fin) <= 0.005);
    };
    // Trigramme du membre : le champ Inst/PAX de GVV utilise souvent le
    // trigramme de l'instructeur (« QNM », « TLM »…) plutot que le nom complet.
    let trigramme = '';
    try {
        const p = (prenom || '').replace(/"/g, '\\"');
        const n = (nom || '').replace(/"/g, '\\"');
        const fU = `AND(FIND(UPPER("${p}"), UPPER({Prénom})) > 0, FIND(UPPER("${n}"), UPPER({Nom})) > 0)`;
        const us = await fetchTousRecordsCache(`${API_BASE}/${encodeURIComponent('Utilisateurs')}?filterByFormula=${encodeURIComponent(fU)}&pageSize=5`, { headers });
        trigramme = ((us[0] || {}).fields || {})['Trigramme'] || '';
        trigramme = trigramme.toString().trim().toUpperCase();
    } catch (e) { /* sans trigramme : match par nom complet uniquement */ }
    return (tous || []).map(r => {
        const f = r.fields || {};
        const instGvv = (f['Inst/PAX'] || '').toString().trim();
        const dc = String(f['DC'] || '') === '1';
        const payeurMatch = nomsGvvCompatibles2(f['Pilote'], nomComplet);
        const instMatch = dc && instGvv && (
            nomsGvvCompatibles2(instGvv, nomComplet)
            || (trigramme && instGvv.toUpperCase() === trigramme));
        const g = {
            pilote: (f['Pilote'] || '').toString(),
            date: f['Date'] || '',
            immat: (f['Machine'] || '').toString().trim().toUpperCase(),
            deb: num(f['Compteur début']), fin: num(f['Compteur fin']),
            att: parseInt(f['Attero'], 10) || 1,
            obs: (f['Observations'] || '').toString().trim(),
            lieu: (f['Lieu'] || '').toString().trim(),
            inst: instGvv, dc,
        };
        if (!g.date || !g.immat || isNaN(g.deb) || isNaN(g.fin)) return null;
        if (!payeurMatch && !instMatch) return null;
        if (couvert(g)) return null;
        return {
            id: `gvv-${r.id}`,
            fields: {
                'Date': g.date, 'Machine': g.immat, 'Pilote': g.pilote,
                'Fonction': instMatch ? 'I' : (g.dc ? 'EP' : 'P'),
                'Instructeur': instMatch ? nomComplet : (g.dc ? g.inst : ''),
                'Horamètre départ': g.deb, 'Horamètre arrivée': g.fin,
                'Décollages': g.att, 'Atterrissages': g.att,
                'Observations': g.obs, 'Arrivée': g.lieu,
            },
            _volCommePilote: payeurMatch && !instMatch,
            _volCommeInstructeur: !!instMatch,
            _sourceGvv: true,
        };
    }).filter(Boolean);
}

async function chargerVolsPilote(prenom, nom) {
    const tableCarnet = typeof TABLE_CARNET_ROUTE !== 'undefined' ? TABLE_CARNET_ROUTE : 'Carnet de route Pilotes';
    const p = (prenom || '').replace(/"/g, '\\"');
    const n = (nom || '').replace(/"/g, '\\"');
    const nomComplet = `${prenom || ''} ${nom || ''}`.trim();
    const mois24 = dateIlYAMois(24);
    const dateMin = `${mois24.getFullYear()}-${String(mois24.getMonth() + 1).padStart(2, '0')}-${String(mois24.getDate()).padStart(2, '0')}`;
    const critere = champ => `AND({${champ}} != '', FIND(UPPER("${p}"), UPPER({${champ}})) > 0, FIND(UPPER("${n}"), UPPER({${champ}})) > 0)`;
    const formula = `AND(OR(${critere('Pilote')}, ${critere('Instructeur')}), IS_AFTER({Date}, "${dateMin}"))`;
    const url = `${API_BASE}/${encodeURIComponent(tableCarnet)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`;

    let records = await fetchTousRecordsCache(url, { headers });
    try {
        const urlManu = `${API_BASE}/${encodeURIComponent('Carnet de vol')}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
        records = records.concat(await fetchTousRecordsCache(urlManu, { headers }));
    } catch (e) { console.error('Erreur lecture carnet de vol manuel:', e); }
    records.forEach(r => {
        const f = r.fields || {};
        const matchNom = v => typeof correspondanceNom === 'function'
            ? correspondanceNom(v, nomComplet)
            : String(v || '').toLowerCase() === nomComplet.toLowerCase();
        r._volCommePilote = !!(f['Pilote'] && matchNom(f['Pilote']));
        r._volCommeInstructeur = !!(f['Instructeur'] && matchNom(f['Instructeur']));
    });
    // Vols GVV orphelins du pilote : completes l'experience (payeur = pilote).
    try {
        records = records.concat(await volsGvvOrphelinsPilote(prenom, nom, records));
    } catch (e) { console.warn('Vols GVV expérience :', e); }
    return records;
}

// Agrège les vols en métriques d'expérience (3 mois / 12 mois / 24 mois) puis
// évalue les validités : expérience récente, emport passager, LAPL, initiation.
function calculerExperiencesPilote(records, cpl = false) {
    const auj = new Date();
    const limite3m = dateIlYAMois(3);
    const limite12m = dateIlYAMois(12);
    const limite24m = dateIlYAMois(24);

    let dernierVol = null;
    let decollages3m = 0, atterrissages3m = 0;
    let decollages3mUlm = 0, atterrissages3mUlm = 0;
    let minutes24m = 0, decollages24m = 0, atterrissages24m = 0, instruction1h = false;
    let minutes12m = 0;
    let gvvDec3m = 0, gvvAtt3m = 0, gvvMin12 = 0, gvvMin24 = 0;
    // LAPL classe 3 : heures et decollages/atterrissages sur ULM comptent
    // dans les 12 h et les 12 dec./att. sur 24 mois ; seule l'heure
    // d'instruction reste avion.
    let minutes24mUlmCdb = 0, decollages24mUlm = 0, atterrissages24mUlm = 0;

    // Seuls les vols en AVION comptent pour « emport passager avion », LAPL et
    // initiation avion : immats moteur du carnet de route ou case « Monomoteur »
    // du carnet de vol manuel, en excluant les ULM (immat F-J…, ex. F-JVIO).
    const MOTORISES = (typeof MACHINES_MOTEURS !== 'undefined' ? MACHINES_MOTEURS : ['F-BLIO', 'F-GASB', 'F-JVIO'])
        .map(m => m.toUpperCase());
    const estVolAvion = f => {
        const machine = (f['Machine'] || f['Immatriculation'] || '').toString().trim().toUpperCase();
        if (/^F-J/.test(machine)) return false;
        return MOTORISES.includes(machine) || f['Monomoteur'] === true;
    };
    // ULM (immat serie F-J…, ex. F-JVIO) : comptage separe pour le suivi
    // « Pilote vol d'initiation ULM » (3 dec/att sur 90 jours, ULM seul).
    const estVolUlm = f => /^F-J/i.test((f['Machine'] || f['Immatriculation'] || '').toString().trim());

    records.forEach(r => {
        const f = r.fields || {};
        if (!f['Date']) return;
        const d = new Date(f['Date']);
        if (d < limite24m) return;
        if (!dernierVol || d > dernierVol) dernierVol = d;
        const avion = estVolAvion(f);
        const ulm = estVolUlm(f);
        if (!avion && !ulm) return;
        const duree = dureeVolMinutes(f);
        // Champ absent = vol normal (1) ; un 0 saisi reste 0 (ex. vol passager).
        const dec = parseInt(f['Décollages'], 10);
        const att = parseInt(f['Atterrissages'], 10);
        const decN = isNaN(dec) ? 1 : dec;
        const attN = isNaN(att) ? 1 : att;

        if (ulm && d >= limite3m) {
            decollages3mUlm += decN;
            atterrissages3mUlm += attN;
        }
        // ULM classe 3 (F-J…) : heures + dec./att. comptent pour le LAPL
        // (CDB, double commande ou solo supervise — toute ligne du membre).
        if (ulm) {
            minutes24mUlmCdb += duree;
            decollages24mUlm += decN;
            atterrissages24mUlm += attN;
        }
        if (!avion) return;
        if (d >= limite3m) {
            decollages3m += decN;
            atterrissages3m += attN;
        }
        minutes24m += duree;
        decollages24m += decN;
        atterrissages24m += attN;
        const inst = (f['Instructeur'] || '').toString().trim();
        // L'heure d'instruction requise (LAPL) doit etre RECUE : si le
        // pilote etait lui-meme l'instructeur du vol, elle ne compte pas.
        if (inst && !r._volCommeInstructeur && duree >= 60) instruction1h = true;
        if (d >= limite12m) {
            minutes12m += duree;
        }
        if (r._sourceGvv) {
            if (d >= limite3m) { gvvDec3m += decN; gvvAtt3m += attN; }
            gvvMin24 += duree;
            if (d >= limite12m) gvvMin12 += duree;
        }
    });

    const h24 = Math.floor(minutes24m / 60);
    const m24 = minutes24m % 60;
    const h12 = Math.floor(minutes12m / 60);
    const m12 = minutes12m % 60;

    let recent = false;
    let recentBientot = false;
    let recentDetail = 'Aucun vol dans les 3 derniers mois';
    if (dernierVol) {
        // Échéance du recency = dernier vol + 3 mois ; alerte orange < 30 jours.
        const validiteRecent = new Date(dernierVol);
        validiteRecent.setMonth(validiteRecent.getMonth() + 3);
        const joursRestants = Math.floor((debutJour(validiteRecent) - debutJour(auj)) / (1000 * 60 * 60 * 24));
        recent = dernierVol >= limite3m;
        recentBientot = joursRestants >= 0 && joursRestants < 30;
        recentDetail = `Dernier vol : ${formaterDateFr(dernierVol.toISOString())} — Max ${formaterDateFr(validiteRecent.toISOString())}`;
    }

    const passager = decollages3m >= 3 && atterrissages3m >= 3;
    const passagerBientot = !passager && (decollages3m > 0 || atterrissages3m > 0);
    const passagerDetail = `${decollages3m} décollages, ${atterrissages3m} atterrissages / 3${(gvvDec3m || gvvAtt3m) ? ` — dont ${gvvDec3m} déc./${gvvAtt3m} att. importés de GVV` : ''}`;

    // Echeance de chaque exigence LAPL : la fenetre glissante de 24 mois
    // tient tant que le vol « charniere » reste dedans — echeance =
    // date de ce vol + 24 mois.
    const listes24 = { h: [], dec: [], att: [], inst: [] };
    records.forEach(r => {
        const f = r.fields || {};
        if (!f['Date']) return;
        const d = new Date(f['Date']);
        if (d < limite24m || isNaN(d)) return;
        const avion = estVolAvion(f), ulm = estVolUlm(f);
        if (!avion && !ulm) return;
        const duree = dureeVolMinutes(f);
        const decN = isNaN(parseInt(f['Décollages'], 10)) ? 1 : parseInt(f['Décollages'], 10);
        const attN = isNaN(parseInt(f['Atterrissages'], 10)) ? 1 : parseInt(f['Atterrissages'], 10);
        listes24.h.push({ d, v: duree });
        for (let i = 0; i < decN; i++) listes24.dec.push({ d });
        for (let i = 0; i < attN; i++) listes24.att.push({ d });
        const inst = (f['Instructeur'] || '').toString().trim();
        if (avion && inst && !r._volCommeInstructeur && duree >= 60) listes24.inst.push({ d });
    });
    const plus24 = d => { const x = new Date(d); x.setMonth(x.getMonth() + 24); return x; };
    const echHeures = (() => {
        const t = [...listes24.h].sort((a, b) => b.d - a.d);
        let s = 0;
        for (const v of t) { s += v.v; if (s >= 12 * 60) return plus24(v.d); }
        return null;
    })();
    const echDec = (() => { const t = [...listes24.dec].sort((a, b) => b.d - a.d); return t.length >= 12 ? plus24(t[11].d) : null; })();
    const echAtt = (() => { const t = [...listes24.att].sort((a, b) => b.d - a.d); return t.length >= 12 ? plus24(t[11].d) : null; })();
    const echInst = (() => { const t = [...listes24.inst].sort((a, b) => b.d - a.d); return t.length ? plus24(t[0].d) : null; })();
    const dernierInst = [...listes24.inst].sort((a, b) => b.d - a.d)[0]?.d || null;
    const laplBlocages = [
        { nom: '12 h de vol', ech: echHeures },
        { nom: '12 décollages', ech: echDec },
        { nom: '12 atterrissages', ech: echAtt },
        { nom: '1 h instructeur (avion)', ech: echInst },
    ].filter(b => b.ech).sort((a, b) => a.ech - b.ech);
    const lapl = (minutes24m + minutes24mUlmCdb) >= 12 * 60
        && (decollages24m + decollages24mUlm) >= 12
        && (atterrissages24m + atterrissages24mUlm) >= 12
        && instruction1h;
    const h24U = Math.floor(minutes24mUlmCdb / 60), m24U = Math.floor(minutes24mUlmCdb % 60);
    const totDec24 = decollages24m + decollages24mUlm, totAtt24 = atterrissages24m + atterrissages24mUlm;
    // Echeance = blocage le plus proche ; si un second blocage tombe a
    // moins d'un mois, on le signale aussi (un peu plus de temps).
    // Action a faire pour rester valide apres la date butoir : ce qui
    // manquera dans la fenetre de 24 mois a cette date, a refaire avant.
    const actionBlocage = b => {
        const seuil = new Date(b.ech); seuil.setMonth(seuil.getMonth() - 24);
        if (b.nom === '12 h de vol') {
            const reste = listes24.h.filter(v => v.d > seuil).reduce((s, v) => s + v.v, 0);
            const manque = 12 * 60 - reste;
            return `${Math.floor(manque / 60)}h${String(Math.floor(manque % 60)).padStart(2, '0')} de vol`;
        }
        if (b.nom === '12 décollages') {
            const manque = 12 - listes24.dec.filter(v => v.d > seuil).length;
            return manque > 0 ? `${manque} décollage${manque > 1 ? 's' : ''}` : '';
        }
        if (b.nom === '12 atterrissages') {
            const manque = 12 - listes24.att.filter(v => v.d > seuil).length;
            return manque > 0 ? `${manque} atterrissage${manque > 1 ? 's' : ''}` : '';
        }
        return '1 h avec un instructeur sur avion';
    };
    let laplEcheanceTxt = '';
    if (laplBlocages.length) {
        const b1 = laplBlocages[0];
        const b2 = laplBlocages.length > 1 && (laplBlocages[1].ech - b1.ech) <= 31 * 24 * 3600 * 1000 ? laplBlocages[1] : null;
        laplEcheanceTxt = [`- Prochaine limite de validité : ${formaterDateFr(b1.ech.toISOString())} ⇒ faire ${actionBlocage(b1)}`];
        if (b2) laplEcheanceTxt.push(`- Limite de validité suivante : ${formaterDateFr(b2.ech.toISOString())} ⇒ faire ${actionBlocage(b2)}`);
        laplEcheanceTxt = laplEcheanceTxt.join('\n');
    } else {
        laplEcheanceTxt = '- Conditions non remplies : ' + [
            (minutes24m + minutes24mUlmCdb) < 12 * 60 ? 'heures' : null,
            (decollages24m + decollages24mUlm) < 12 ? 'décollages' : null,
            (atterrissages24m + atterrissages24mUlm) < 12 ? 'atterrissages' : null,
            !instruction1h ? 'heure instructeur' : null,
        ].filter(Boolean).join(', ');
    }
    const totMin24 = minutes24m + minutes24mUlmCdb;
    const laplDetail = [
        `- ${Math.floor(totMin24 / 60)}h${String(Math.floor(totMin24 % 60)).padStart(2, '0')} / 12 h de vol${minutes24mUlmCdb ? ` (dont ${h24U}h${String(m24U).padStart(2, '0')} ULM)` : ''}`,
        `- ${totDec24} / 12 décollages — ${totAtt24} / 12 atterrissages`,
        `- 1 h avec instructeur avion : ${instruction1h && dernierInst ? `faite le ${formaterDateFr(dernierInst.toISOString())}` : 'à faire'}`,
        laplEcheanceTxt
    ].join('\n');

    const initiation = passager && (cpl || minutes12m >= 25 * 60);
    const initiationDetail = cpl
        ? `Pilote CPL — ${h12}h${String(m12).padStart(2, '0')} sur 12 mois`
        : `${h12}h${String(m12).padStart(2, '0')} / 25h00 sur 12 mois — emport passager : ${passager ? 'oui' : 'non'}${gvvMin12 ? ` — dont ${Math.floor(gvvMin12 / 60)}h${String(Math.floor(gvvMin12 % 60)).padStart(2, '0')} importées de GVV` : ''}`;

    return {
        dernierVol, decollages3m, atterrissages3m, decollages3mUlm, atterrissages3mUlm,
        minutes24m, minutes24mUlmCdb, decollages24m, decollages24mUlm, atterrissages24m, atterrissages24mUlm, instruction1h, minutes12m,
        recent, recentBientot, recentDetail,
        passager, passagerBientot, passagerDetail,
        lapl, laplDetail, initiation, initiationDetail
    };
}

// Echappement HTML canonique — TOUJOURS l'utiliser avant d'injecter des
// donnees utilisateur dans innerHTML. escHtml est un alias historique.
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
function escHtml(s) { return escapeHtml(s); }

// Ne retourne l'URL que si elle est inoffensive dans un href/src — sinon '#'.
// Bloque javascript:, data:, vbscript: (XSS via <a href>).
function urlSure(u) {
    const s = (u || '').toString().trim();
    return /^(https?:\/\/|\/|mailto:|tel:)/i.test(s) ? s : '#';
}

function normaliserNom(n) {
    return (n || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function correspondanceNom(a, b) {
    const na = normaliserNom(a);
    const nb = normaliserNom(b);
    if (!na || !nb) return false;
    return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

// --- RESOLUTION DES IDs AIRTABLE (rec...) DANS UN TEXTE ---
function resoudreIdsTexte(texte) {
    if (!texte) return texte;
    return String(texte).replace(/\brec[A-Za-z0-9]{10,}\b/g, (id) => {
        if (typeof listeMembresCache !== 'undefined' && listeMembresCache.length) {
            const m = listeMembresCache.find(r => r.id === id);
            if (m && m.fields) {
                const nom = `${m.fields['Prénom'] || ''} ${m.fields['Nom'] || ''}`.trim();
                if (nom) return nom;
            }
        }
        if (typeof listeAvionsCache !== 'undefined' && listeAvionsCache.length) {
            const a = listeAvionsCache.find(r => r.id === id);
            if (a && a.fields) {
                const immat = a.fields['Immatriculation'] || a.fields['Nom'];
                if (immat) return immat;
            }
        }
        return id;
    });
}

// --- FORMATAGE DU NOM DU PILOTE (ex: Benjamin Q.) ---
function formaterNomPilote(nomComplet) {
    if (Array.isArray(nomComplet)) nomComplet = nomComplet[0] || '';
    if (!nomComplet) return '';
    let chaine = String(nomComplet).trim();
    if (!chaine) return '';

    if (chaine.startsWith('rec') && typeof listeMembresCache !== 'undefined' && listeMembresCache.length) {
        const membre = listeMembresCache.find(r => r.id === chaine);
        if (membre && membre.fields) {
            const resolu = `${membre.fields['Prénom'] || ''} ${membre.fields['Nom'] || ''}`.trim();
            if (resolu) chaine = resolu;
        }
    }

    if (chaine.startsWith('🎯') || chaine.startsWith('VI')) {
        return chaine;
    }

    const parties = chaine.split(/\s+/);
    if (parties.length === 1) {
        return parties[0];
    }

    let prenom = '';
    let nom = '';

    if (parties[0] === parties[0].toUpperCase() && parties[0].length > 1) {
        nom = parties[0];
        prenom = parties.slice(1).join(' ');
    } else {
        prenom = parties[0];
        nom = parties.slice(1).join(' ');
    }

    const initialeNom = nom.charAt(0).toUpperCase();
    return `${prenom} ${initialeNom}.`;
}

function nomPiloteCourant() {
    if (typeof currentUser === 'undefined' || !currentUser) return '';
    const prenom = currentUser.prenom || '';
    const nom = currentUser.nom || '';
    return formaterNomPilote(`${prenom} ${nom}`.trim());
}

// --- CALCUL ASTRONOMIQUE DES HEURES SOLAIRES (LFOY) ---
function calculerSoleilLFOY(date) {
    const lat = LFOY_LAT;
    const lon = LFOY_LON;
    
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay);
    const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
    
    const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
    const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
    let cosHA = Math.cos(90.833 * Math.PI / 180) / (Math.cos(lat * Math.PI / 180) * Math.cos(decl)) - Math.tan(lat * Math.PI / 180) * Math.tan(decl);
    cosHA = Math.min(1, Math.max(-1, cosHA));
    
    const ha = Math.acos(cosHA);
    const haDeg = ha * 180 / Math.PI;
    const offsetHeures = -date.getTimezoneOffset() / 60;
    const sunriseUTC = 720 - 4 * (lon + haDeg) - eqtime;
    const sunsetUTC = 720 - 4 * (lon - haDeg) - eqtime;
    const srDecimal = (sunriseUTC / 60) + offsetHeures; 
    const ssDecimal = (sunsetUTC / 60) + offsetHeures;  
    return {
        aubeAero: srDecimal - 0.5,       
        leverSoleil: srDecimal,          
        coucherSoleil: ssDecimal,        
        crepusculeAero: ssDecimal + 0.5  
    };
}

function genererFondNuitHTML(dateCible) {
    const soleil = calculerSoleilLFOY(dateCible);
    
    const pctFinNuitAeroMatin = positionHeure(Math.max(0, soleil.aubeAero));
    const pctFinNuitMatin = positionHeure(Math.max(0, soleil.leverSoleil));
    const pctDebutNuitSoir = positionHeure(Math.min(24, soleil.coucherSoleil));
    const pctDebutNuitAeroSoir = positionHeure(Math.min(24, soleil.crepusculeAero));

    return `
        <div class="night-overlay-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;">
            <div style="position: absolute; left: 0%; width: ${pctFinNuitAeroMatin}%; height: 100%; 
                        background: repeating-linear-gradient(-45deg, rgba(30, 61, 89, 0.12), rgba(30, 61, 89, 0.12) 6px, rgba(240, 244, 248, 0.4) 6px, rgba(240, 244, 248, 0.4) 12px);">
            </div>
            <div style="position: absolute; left: ${pctFinNuitAeroMatin}%; width: ${pctFinNuitMatin - pctFinNuitAeroMatin}%; height: 100%; 
                        background: repeating-linear-gradient(-45deg, rgba(30, 61, 89, 0.22), rgba(30, 61, 89, 0.22) 6px, rgba(186, 215, 233, 0.45) 6px, rgba(186, 215, 233, 0.45) 12px); 
                        border-right: 1px dashed #1e3d59;">
            </div>
            <div style="position: absolute; left: ${pctDebutNuitSoir}%; width: ${pctDebutNuitAeroSoir - pctDebutNuitSoir}%; height: 100%; 
                        background: repeating-linear-gradient(-45deg, rgba(30, 61, 89, 0.22), rgba(30, 61, 89, 0.22) 6px, rgba(186, 215, 233, 0.45) 6px, rgba(186, 215, 233, 0.45) 12px); 
                        border-left: 1px dashed #1e3d59;">
            </div>
            <div style="position: absolute; left: ${pctDebutNuitAeroSoir}%; width: ${100 - pctDebutNuitAeroSoir}%; height: 100%; 
                        background: repeating-linear-gradient(-45deg, rgba(30, 61, 89, 0.12), rgba(30, 61, 89, 0.12) 6px, rgba(240, 244, 248, 0.4) 6px, rgba(240, 244, 248, 0.4) 12px);">
            </div>
        </div>
    `;
}

function formaterPourInput(dateObjet) {
    const tzoffset = dateObjet.getTimezoneOffset() * 60000;
    return (new Date(dateObjet - tzoffset)).toISOString().slice(0, 16);
}

function minutesToTimeString(totalMinutes) {
    let hrs = Math.floor(totalMinutes / 60) % 24;
    let mins = Math.round(totalMinutes % 60);
    if (mins === 60) { hrs = (hrs + 1) % 24; mins = 0; }
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

function convertirHeureEnHHMM(decimalHeure) {
    const heures = Math.floor(decimalHeure);
    const minutes = Math.round((decimalHeure - heures) * 60);
    return `${String(heures).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const LARGEURS_HEURES = new Array(24).fill(1);
const TOTAL_LARGEUR_HEURES = LARGEURS_HEURES.reduce((a,b)=>a+b,0);

function positionHeure(decimalHeure) {
    if (decimalHeure <= 0) return 0;
    if (decimalHeure >= 24) return 100;
    return (decimalHeure / 24) * 100;
}

function positionHeureInverse(pourcentage) {
    if (pourcentage <= 0) return 0;
    if (pourcentage >= 100) return 24;
    return (pourcentage / 100) * 24;
}

function appliquerEchelleGrid(gridBg, hMin, hMax) {
    if (!gridBg || hMax <= hMin) return;
    const echelle = 24 / (hMax - hMin);
    const margeGauche = -(hMin / (hMax - hMin)) * 100;
    gridBg.style.width = `${echelle * 100}%`;
    gridBg.style.marginLeft = `${margeGauche}%`;
}

function creerWrapperCellulesGrille(gridBg) {
    const wrapper = document.createElement('div');
    wrapper.className = 'hours-grid-cells';
    gridBg.appendChild(wrapper);
    return wrapper;
}

function formaterDateHeureLocal(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formaterDateHeureAffichage(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}h${pad(d.getMinutes())} LT`;
}

// PostgreSQL renvoie les lignes dans un ordre arbitraire — tri alphabetique par immatriculation.
function trierAvionsParImmat(records) {
    return (records || []).slice().sort((a, b) => {
        const ia = (((a.fields || {})['Immatriculation'] || (a.fields || {})['Nom']) || '').toString().trim().toUpperCase();
        const ib = (((b.fields || {})['Immatriculation'] || (b.fields || {})['Nom']) || '').toString().trim().toUpperCase();
        return ia.localeCompare(ib);
    });
}

function afficherConflitsReservations(barresInfos) {
    if (!Array.isArray(barresInfos) || barresInfos.length < 2) return;
    for (let i = 0; i < barresInfos.length; i++) {
        for (let j = i + 1; j < barresInfos.length; j++) {
            const a = barresInfos[i];
            const b = barresInfos[j];
            const chevauchementDebut = Math.max(a.debut, b.debut);
            const chevauchementFin = Math.min(a.fin, b.fin);
            if (chevauchementFin > chevauchementDebut) {
                const dureeConflit = chevauchementFin - chevauchementDebut;
                function ajouterOverlay(barInfo) {
                    const largeurBar = positionHeure(barInfo.fin) - positionHeure(barInfo.debut);
                    const overlay = document.createElement('div');
                    overlay.className = 'conflit-overlay';
                    overlay.style.position = 'absolute';
                    overlay.style.top = '0';
                    overlay.style.left = `${((positionHeure(chevauchementDebut) - positionHeure(barInfo.debut)) / largeurBar) * 100}%`;
                    overlay.style.width = `${((positionHeure(chevauchementFin) - positionHeure(chevauchementDebut)) / largeurBar) * 100}%`;
                    overlay.style.height = '100%';
                    overlay.style.backgroundColor = 'rgba(255, 255, 0, 0.55)';
                    overlay.style.pointerEvents = 'none';
                    overlay.style.zIndex = '1';
                    overlay.style.border = '1px dashed #c0392b';
                    overlay.style.display = 'flex';
                    overlay.style.alignItems = 'center';
                    overlay.style.justifyContent = 'center';
                    overlay.title = `Conflit horaire de ${convertirHeureEnHHMM(chevauchementDebut)} à ${convertirHeureEnHHMM(chevauchementFin)}`;
                    overlay.innerHTML = '<span style="font-size:14px; pointer-events:none;">⚠️</span>';
                    barInfo.bar.insertBefore(overlay, barInfo.bar.firstChild);
                }
                ajouterOverlay(a);
                ajouterOverlay(b);
                a.bar.title = (a.bar.title ? a.bar.title + ' | ' : '') + 'Conflit horaire détecté';
                b.bar.title = (b.bar.title ? b.bar.title + ' | ' : '') + 'Conflit horaire détecté';
            }
        }
    }
}

// --- CACHE POUR REQUÊTES AIRTABLE (GET) ---
const API_CACHE = {};
const API_CACHE_TTL = 120000; // 2 minutes (le cache est vide a chaque ecriture, donc pas de risque de donnees propres obsoletes)

// --- RATE-LIMITER + RETRY POUR L'API AIRTABLE ---
// Airtable limite a ~5 requetes/seconde par base : on espace les requetes et on reessaie sur 429/5xx.
const _apiEnVol = new Map();

async function _apiExecuterAvecRetry(url, options, maxEssais) {
    let delai = 400;
    for (let essai = 0; essai < maxEssais; essai++) {
        let res;
        try {
            res = await fetch(url, options);
        } catch (err) {
            if (essai === maxEssais - 1) throw err;
            await new Promise(r => setTimeout(r, delai));
            delai *= 2;
            continue;
        }
        if (res.status < 500) return res;
        if (essai === maxEssais - 1) return res;
        await new Promise(r => setTimeout(r, delai));
        delai *= 2;
    }
}

function apiFetch(url, options = {}, maxEssais = 3) {
    const method = (options.method || 'GET').toUpperCase();
    const cle = `${method} ${url}`;
    // Ajoute le nom de l'utilisateur courant pour le journal d'audit cote serveur
    const opts = { ...options, headers: { ...(options.headers || {}) } };
    if (typeof nomPiloteCourant === 'function' && !opts.headers['X-User-Name']) {
        opts.headers['X-User-Name'] = nomPiloteCourant();
    }
    // Une ecriture invalide les GET deja en vol : ils repondraient avec
    // des donnees d'avant l'ecriture.
    if (method !== 'GET') _apiEnVol.clear();
    // Dedoublonne les GET identiques deja en vol (clone pour ne pas consommer le body partage).
    if (method === 'GET' && _apiEnVol.has(cle)) return _apiEnVol.get(cle).then(r => r.clone());
    const promesse = _apiExecuterAvecRetry(url, opts, maxEssais);
    // Session expirée ou révoquée : purge et retour à l'écran de connexion.
    promesse.then(r => {
        if (r && r.status === 401 && localStorage.getItem('acesSession')) {
            localStorage.removeItem('acesSession');
            localStorage.removeItem('currentUser');
            location.reload();
        }
    }).catch(() => {});
    if (method === 'GET') {
        _apiEnVol.set(cle, promesse);
        promesse.finally(() => _apiEnVol.delete(cle)).catch(() => {});
        return promesse.then(r => r.clone());
    }
    return promesse;
}

// Recupere toutes les pages d'une requete GET (l'API pagine a 100 records max).
async function fetchTousRecords(url, options = {}) {
    const tous = [];
    let offset = null;
    let garde = 0;
    do {
        const sep = url.includes('?') ? '&' : '?';
        const full = offset ? `${url}${sep}offset=${encodeURIComponent(offset)}` : url;
        const res = await apiFetch(full, options);
        const data = await res.json();
        if (!res.ok) throw new Error((data.error && data.error.message) || 'Erreur chargement');
        tous.push(...(data.records || []));
        offset = data.offset || null;
    } while (offset && ++garde < 50);
    return tous;
}

// Variante avec cache : chaque page est mise en cache (meme TTL que cachedFetch).
async function fetchTousRecordsCache(url, options = {}, ttl = API_CACHE_TTL, force = false) {
    const tous = [];
    let offset = null;
    let garde = 0;
    do {
        const sep = url.includes('?') ? '&' : '?';
        const full = offset ? `${url}${sep}offset=${encodeURIComponent(offset)}` : url;
        const res = await cachedFetch(full, options, ttl, force);
        const data = await res.json();
        if (!res.ok) throw new Error((data.error && data.error.message) || 'Erreur chargement');
        tous.push(...(data.records || []));
        offset = data.offset || null;
    } while (offset && ++garde < 50);
    return tous;
}

function viderApiCache() {
    Object.keys(API_CACHE).forEach(k => delete API_CACHE[k]);
    // Les GET deja en vol ont demarre avant l'ecriture : leurs reponses
    // sont potentiellement perimees — on ne doit plus les reutiliser.
    if (typeof _apiEnVol !== 'undefined') _apiEnVol.clear();
}

async function cachedFetch(url, options = {}, ttl = API_CACHE_TTL, force = false) {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && !force) {
        const now = Date.now();
        const entry = API_CACHE[url];
        if (entry && (now - entry.ts) < ttl) {
            return {
                ok: true,
                status: 200,
                json: () => Promise.resolve(entry.data),
                text: () => Promise.resolve(typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data))
            };
        }
    }
    if (method !== 'GET') viderApiCache();
    const res = await apiFetch(url, options);
    const data = await res.json();
    if (method === 'GET' && res.ok) API_CACHE[url] = { data, ts: Date.now() };
    return {
        ok: res.ok,
        status: res.status,
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data))
    };
}

// --- RECHERCHE PAR FRAPPE DANS LES <select> ---
// Tapez les premières lettres d'une option pour y sauter directement.
(function initRechercheSelects() {
    let buffer = '';
    let resetTimer = null;
    let changeTimer = null;
    const RESET_DELAY = 1200;
    const CHANGE_DELAY = 400;

    const normaliser = (s) => (s || '').toString().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
    const mots = (s) => (s || '').toString().trim().split(/\s+/).filter(Boolean);
    const matchNom = (text, recherche) => {
        const words = mots(text);
        // Plusieurs mots : on cherche dans le(s) mot(s) suivant(s) le premier (nom de famille)
        const cibles = words.length > 1 ? words.slice(1) : words;
        return cibles.some(w => normaliser(w).startsWith(recherche));
    };

    document.addEventListener('keydown', (e) => {
        const select = e.target;
        if (!(select instanceof HTMLSelectElement)) return;
        if (select.multiple || select.disabled) return;
        if (e.altKey || e.ctrlKey || e.metaKey) return;

        const key = e.key;
        if (key === 'Backspace' || key === 'Delete') {
            e.preventDefault();
            buffer = buffer.slice(0, -1);
        } else if (key.length === 1 && key !== ' ') {
            e.preventDefault();
            buffer += key;
        } else {
            return;
        }

        const recherche = normaliser(buffer);
        const options = Array.from(select.options);
        if (recherche && options.length) {
            const idx = options.findIndex(o => matchNom(o.text, recherche));
            if (idx >= 0 && select.selectedIndex !== idx) {
                select.selectedIndex = idx;
                clearTimeout(changeTimer);
                changeTimer = setTimeout(() => {
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }, CHANGE_DELAY);
            }
        }

        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => { buffer = ''; }, RESET_DELAY);
    }, true);
})();

// --- SELECT PERSONNALISE AVEC RECHERCHE (liste complète + champ filtre) ---
function rendreSelectRecherchable(select, allowCustom = false) {
    if (typeof select === 'string') select = document.getElementById(select);
    if (!select || select.dataset.searchReady) return;
    if (select.multiple || select.size > 1) return;
    select.dataset.searchReady = '1';
    select.dataset.allowCustom = allowCustom ? '1' : '0';
    select.removeAttribute('required');
    const etaitCache = select.style.display === 'none';
    select.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = 'select-recherche';
    wrap.style.cssText = 'position:relative; display:inline-block; min-width:200px; max-width:100%;';

    const boutonBleu = ['select-instructeur-suivi', 'carnet-machine-filtre', 'carnet-vol-pilote-select', 'carnet-vol-machine-select', 'comptes-pilote-select', 'audit-module-filtre', 'accueil-select-membre'].includes(select.id);
    const sansRecherche = ['select-instructeur-suivi', 'carnet-machine-filtre', 'carnet-vol-machine-select', 'audit-module-filtre'].includes(select.id);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'width:100%; padding:8px 28px 8px 12px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; color:#1e3d59; font-size:14px; text-align:left; cursor:pointer; position:relative; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
    if (boutonBleu) {
        wrap.style.cssText = 'position:relative; display:inline-block; width:auto; min-width:0; max-width:none;' + (etaitCache ? 'display:none;' : '');
        btn.style.cssText = 'width:auto; padding:0 38px 0 14px; height:38px; border:none; border-radius:6px; background:#1e3d59; color:#fff; font-size:13px; font-weight:600; text-align:left; cursor:pointer; position:relative; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; box-shadow:0 2px 4px rgba(0,0,0,0.1);';
    } else if (etaitCache) {
        wrap.style.cssText += 'display:none;';
    }

    const caret = document.createElement('span');
    caret.textContent = '▾';
    caret.style.cssText = 'position:absolute; right:10px; top:50%; transform:translateY(-50%); opacity:.5; pointer-events:none;';
    btn.appendChild(caret);

    const panel = document.createElement('div');
    panel.style.cssText = 'display:none; position:absolute; top:calc(100% + 4px); left:0; min-width:100%; width:max-content; max-width:320px; background:#fff; border:1px solid #cbd5e1; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.15); z-index:10000; overflow:hidden;';

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Rechercher ou saisir un nom...';
    search.autocomplete = 'off';
    search.style.cssText = 'width:100%; padding:8px 12px; border:none; border-bottom:1px solid #e2e8f0; font-size:14px; box-sizing:border-box; outline:none;';

    const list = document.createElement('div');
    list.style.cssText = 'max-height:240px; overflow-y:auto;';

    if (sansRecherche) {
        const cote = ['select-instructeur-suivi', 'carnet-vol-machine-select', 'audit-module-filtre'].includes(select.id) ? 'right:0;' : 'left:0;';
        panel.style.cssText = 'display:none; position:absolute; top:calc(100% + 4px); ' + cote + ' min-width:100%; width:auto; max-width:340px; background:#fff; border:1px solid #cbd5e1; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.15); z-index:10000; overflow:hidden;';
    } else {
        panel.appendChild(search);
        if (select.id === 'carnet-vol-pilote-select' || select.id === 'comptes-pilote-select') {
            panel.style.cssText = 'display:none; position:absolute; top:calc(100% + 4px); right:0; min-width:100%; width:max-content; max-width:320px; background:#fff; border:1px solid #cbd5e1; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.15); z-index:10000; overflow:hidden;';
        }
    }
    panel.appendChild(list);
    select.parentElement.insertBefore(wrap, select);
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    wrap.appendChild(select);

    const norm = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const label = () => {
        const o = select.options[select.selectedIndex];
        return o ? o.text : '— Choisir —';
    };
    const majBtn = () => {
        const text = document.createTextNode(label() + ' ');
        const span = document.createElement('span');
        span.textContent = '▾';
        span.style.cssText = boutonBleu
            ? 'position:absolute; right:14px; top:50%; transform:translateY(-50%); opacity:.6;'
            : 'float:right; opacity:.5;';
        btn.innerHTML = '';
        btn.appendChild(text);
        btn.appendChild(span);
        btn.disabled = select.disabled;
    };

    const renderList = (filtre = '') => {
        const f = norm(filtre);
        list.innerHTML = '';
        let count = 0;
        [...select.options].forEach(o => {
            const txt = o.text;
            if (f && !norm(txt).includes(f)) return;
            const item = document.createElement('div');
            item.style.cssText = 'padding:8px 12px; cursor:pointer; font-size:14px; color:#1e3d59; white-space:nowrap;';
            item.textContent = txt;
            if (o.value === select.value) item.style.background = '#eff6ff';
            item.addEventListener('mouseenter', () => { if (o.value !== select.value) item.style.background = '#f1f5f9'; });
            item.addEventListener('mouseleave', () => { item.style.background = (o.value === select.value) ? '#eff6ff' : ''; });
            item.addEventListener('click', () => {
                select.value = o.value;
                majBtn();
                select.dispatchEvent(new Event('change', { bubbles: true }));
                fermer();
            });
            list.appendChild(item);
            count++;
        });
        if (select.dataset.allowCustom === '1' && filtre.trim()) {
            const exact = [...select.options].some(o => norm(o.text) === f);
            if (!exact) {
                const addItem = document.createElement('div');
                addItem.style.cssText = 'padding:8px 12px; cursor:pointer; font-size:14px; color:#1e3d59; white-space:nowrap; border-top:1px solid #e2e8f0; font-style:italic;';
                addItem.textContent = `+ "${filtre.trim()}"`;
                addItem.addEventListener('mouseenter', () => { addItem.style.background = '#f1f5f9'; });
                addItem.addEventListener('mouseleave', () => { addItem.style.background = ''; });
                addItem.addEventListener('click', () => {
                    const val = filtre.trim();
                    let opt = [...select.options].find(o => o.value === val);
                    if (!opt) {
                        opt = document.createElement('option');
                        opt.value = val;
                        opt.textContent = val;
                        select.appendChild(opt);
                    }
                    select.value = val;
                    majBtn();
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    fermer();
                });
                list.appendChild(addItem);
                count++;
            }
        }
        if (!count) list.innerHTML = '<div data-empty="1" style="padding:10px 12px; color:#94a3b8; font-size:13px;">Aucun résultat</div>';
    };

    // Le panneau sort de son conteneur (position:fixed sur body) pour se
    // superposer a la modale au lieu de rester clippe dedans.
    const ouvrir = () => {
        if (panel.parentElement !== document.body) document.body.appendChild(panel);
        const r = btn.getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.top = `${r.bottom + 4}px`;
        panel.style.left = `${r.left}px`;
        panel.style.minWidth = `${r.width}px`;
        panel.style.display = 'block';
        search.value = ''; renderList();
        if (!sansRecherche) setTimeout(() => search.focus(), 0);
    };
    const fermer = () => { panel.style.display = 'none'; };

    // Quand la modale contenant le select se ferme, le panneau se ferme
    // aussi — sinon il reapparait deja ouvert a la reouverture.
    const modalParent = select.closest('.modal');
    if (modalParent) new MutationObserver(() => {
        if (modalParent.style.display === 'none') fermer();
    }).observe(modalParent, { attributes: true, attributeFilter: ['style'] });

    btn.addEventListener('click', (e) => { e.stopPropagation(); panel.style.display === 'none' ? ouvrir() : fermer(); });
    search.addEventListener('input', () => renderList(search.value));
    search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); fermer(); btn.focus(); }
        if (e.key === 'Enter') {
            e.preventDefault();
            const first = list.querySelector('div');
            if (first && !first.dataset.empty) first.click();
        }
    });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target) && !panel.contains(e.target)) fermer(); });
    select.addEventListener('change', majBtn);
    select.addEventListener('maj-affichage', majBtn);
    new MutationObserver(() => {
        majBtn();
        if (panel.style.display !== 'none') renderList(search.value);
    }).observe(select, { childList: true });
    majBtn();
}

// Appliquer la recherche aux selects de noms dans les principaux onglets
(function initSelectsRecherche() {
    const ids = [
        'comptes-pilote-select',
        'accueil-select-membre',
        'select-inscrire-autre',
        'form-pilote',
        'form-instructeur',
        'carnet-pilote',
        'carnet-instructeur',
        'select-instructeur-suivi',
        'carnet-machine-filtre',
        'carnet-vol-pilote-select',
        'carnet-vol-machine-select',
        'audit-module-filtre'
    ];

    function essayer() {
        ids.forEach(id => rendreSelectRecherchable(id, id === 'carnet-pilote' || id === 'form-pilote' || id === 'select-inscrire-autre' || id === 'carnet-instructeur'));
        if (ids.some(id => document.getElementById(id) && !document.getElementById(id).dataset.searchReady)) {
            setTimeout(essayer, 500);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', essayer);
    } else {
        essayer();
    }
})();

// ==========================================================================
// MODALE "ALLER A LA DATE" - remplace le prompt() natif
// Résout une chaîne 'YYYY-MM-DD' ou null si annulé.
// ==========================================================================
function demanderDateModal(dateInitiale) {
    return new Promise(resolve => {
        const existing = document.getElementById('date-nav-modal');
        if (existing) existing.remove();
        let iso = '';
        if (dateInitiale instanceof Date && !isNaN(dateInitiale)) {
            iso = `${dateInitiale.getFullYear()}-${String(dateInitiale.getMonth() + 1).padStart(2, '0')}-${String(dateInitiale.getDate()).padStart(2, '0')}`;
        }
        const overlay = document.createElement('div');
        overlay.id = 'date-nav-modal';
        overlay.className = 'modal';
        overlay.style.display = 'flex';
        overlay.style.zIndex = '20000';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 320px; text-align: left;">
                <h3 style="display:flex; align-items:center; gap:10px; color:#1e3d59; margin-top:0;">
                    <span style="font-size:22px;">📅</span>
                    <span>Aller à la date</span>
                </h3>
                <input type="date" id="date-nav-input" value="${iso}"
                    style="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:15px; font-family:inherit; color:#1e3d59; margin:6px 0 18px;">
                <div style="display:flex; gap:10px; justify-content:space-between;">
                    <button type="button" class="nr-btn-cancel" id="date-nav-cancel">Annuler</button>
                    <button type="button" class="btn-primary" id="date-nav-ok">Valider</button>
                </div>
            </div>
        `;
        const input = overlay.querySelector('#date-nav-input');
        const fermer = (val) => { overlay.remove(); resolve(val); };
        overlay.querySelector('#date-nav-cancel').addEventListener('click', () => fermer(null));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) fermer(null); });
        overlay.querySelector('#date-nav-ok').addEventListener('click', () => fermer(input.value || null));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); fermer(input.value || null); }
            if (e.key === 'Escape') { e.preventDefault(); fermer(null); }
        });
        document.body.appendChild(overlay);
        input.focus();
    });
}

// ==========================================================================
// MODALES GENERIQUES - remplacent alert(), confirm() et prompt() natifs.
// ==========================================================================

// alert() natif -> modale non bloquante. Le texte est echappe, les \n deviennent
// des <br>. Fallback sur l'alert natif si la modale n'est pas encore chargee.
const __alertNatif = window.alert.bind(window);
window.alert = function(message) {
    if (typeof afficherModaleAlerte !== 'function') return __alertNatif(message);
    const texte = String(message === undefined || message === null ? '' : message);
    const estErreur = /^err/i.test(texte.trim());
    const html = `<p style="margin:0; white-space:pre-wrap;">${escapeHtml(texte).replace(/\n/g, '<br>')}</p>`;
    try {
        afficherModaleAlerte(estErreur ? 'Erreur' : 'Information', html, estErreur ? '❌' : 'ℹ️');
    } catch (e) {
        __alertNatif(message);
    }
};

// confirm() natif -> Promise<boolean>. Libelles/icones personnalisables.
function demanderConfirmation(titre, messageHtml, opts = {}) {
    const { okLabel = 'Confirmer', cancelLabel = 'Annuler', icone = '❓', danger = true } = opts;
    return new Promise(resolve => {
        const existing = document.getElementById('confirm-modal-generique');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'confirm-modal-generique';
        overlay.className = 'modal';
        overlay.style.display = 'flex';
        overlay.style.zIndex = '20000';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 420px; text-align: left;">
                <h3 style="display:flex; align-items:center; gap:10px; color:#1e3d59; margin-top:0;">
                    <span style="font-size:26px;">${icone}</span>
                    <span>${escapeHtml(titre)}</span>
                </h3>
                <div style="margin-top:15px; line-height:1.6; font-size:15px; color:#334155;">${messageHtml}</div>
                <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:20px;">
                    <button type="button" class="nr-btn-cancel" id="confirm-gen-cancel">${escapeHtml(cancelLabel)}</button>
                    <button type="button" id="confirm-gen-ok" style="background:${danger ? '#dc2626' : '#1e3d59'}; color:#fff; border:none; padding:10px 16px; border-radius:8px; cursor:pointer; font-weight:600;">${escapeHtml(okLabel)}</button>
                </div>
            </div>
        `;
        const fermer = val => { overlay.remove(); resolve(val); };
        overlay.querySelector('#confirm-gen-cancel').addEventListener('click', () => fermer(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) fermer(false); });
        overlay.querySelector('#confirm-gen-ok').addEventListener('click', () => fermer(true));
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); fermer(true); }
            if (e.key === 'Escape') { e.preventDefault(); fermer(false); }
        });
        document.body.appendChild(overlay);
        overlay.setAttribute('tabindex', '-1');
        overlay.focus();
    });
}

// prompt() natif -> Promise<string|null>. Multiligne possible via opts.textarea.
function demanderSaisie(titre, defaut = '', opts = {}) {
    const { placeholder = '', okLabel = 'Valider', textarea = false } = opts;
    return new Promise(resolve => {
        const existing = document.getElementById('saisie-modal-generique');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'saisie-modal-generique';
        overlay.className = 'modal';
        overlay.style.display = 'flex';
        overlay.style.zIndex = '20000';
        const champ = textarea
            ? `<textarea id="saisie-gen-input" rows="4" placeholder="${escapeHtml(placeholder)}" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:15px; font-family:inherit; color:#1e3d59; margin:6px 0 18px; resize:vertical;">${escapeHtml(defaut)}</textarea>`
            : `<input type="text" id="saisie-gen-input" value="${escapeHtml(defaut)}" placeholder="${escapeHtml(placeholder)}" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:15px; font-family:inherit; color:#1e3d59; margin:6px 0 18px;">`;
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 380px; text-align: left;">
                <h3 style="display:flex; align-items:center; gap:10px; color:#1e3d59; margin-top:0;">
                    <span style="font-size:22px;">✏️</span>
                    <span>${escapeHtml(titre)}</span>
                </h3>
                ${champ}
                <div style="display:flex; gap:10px; justify-content:flex-end;">
                    <button type="button" class="nr-btn-cancel" id="saisie-gen-cancel">Annuler</button>
                    <button type="button" class="btn-primary" id="saisie-gen-ok">${escapeHtml(okLabel)}</button>
                </div>
            </div>
        `;
        const input = overlay.querySelector('#saisie-gen-input');
        const fermer = val => { overlay.remove(); resolve(val); };
        overlay.querySelector('#saisie-gen-cancel').addEventListener('click', () => fermer(null));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) fermer(null); });
        overlay.querySelector('#saisie-gen-ok').addEventListener('click', () => fermer(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !textarea) { e.preventDefault(); fermer(input.value); }
            if (e.key === 'Escape') { e.preventDefault(); fermer(null); }
        });
        document.body.appendChild(overlay);
        input.focus();
        input.select();
    });
}

// Raccourcis : texte brut auto-echappe, \n -> <br>.
function confirmerAction(texte, opts = {}) {
    const html = `<p style="margin:0; white-space:pre-wrap;">${escapeHtml(texte).replace(/\n/g, '<br>')}</p>`;
    return demanderConfirmation(opts.titre || 'Confirmation', html, opts);
}
function confirmerSuppression(texte, titre = 'Confirmer la suppression') {
    return confirmerAction(texte, { titre, okLabel: 'Supprimer', icone: '🗑️' });
}
