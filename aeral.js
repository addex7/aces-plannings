// ============================================================================
// RAPPORT AERAL — compte-rendu annuel DG/MALGH
// Extractions sur l'année civile choisie (par défaut : année précédente),
// à partir des carnets de route + lignes GVV non couvertes par le carnet.
// ============================================================================

let aeralUtilisateurs = null;

function aeralEstUlm(immat) { return /^F-J/i.test((immat || '').toString().trim()); }

// Durée en centièmes d'heure — même calcul que dureeVolMinutes, /60.
function aeralDuree(f) {
    const m = dureeVolMinutes(f);
    return m ? m / 60 : 0;
}

function aeralNom(s) { return normNomGvv2(s); }

// Membre par nom ou trigramme (pour les lignes GVV « Inst/PAX »).
function aeralTrouverMembre(nom, utilisateurs) {
    const cible = aeralNom(nom);
    if (!cible) return null;
    const up = (nom || '').toString().trim().toUpperCase();
    return (utilisateurs || []).find(u => {
        const f = u.fields || {};
        const complet = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
        if (nomsGvvCompatibles2(complet, nom)) return true;
        const tri = (f['Trigramme'] || '').toString().trim().toUpperCase();
        return tri && tri === up;
    }) || null;
}

// Jeune/adulte : < 21 ans pour l'avion (FFA), < 25 ans pour l'ULM — seuils du CR.
function aeralClasseAge(u, finAnnee, ulm) {
    const dn = (u && u.fields && u.fields['Date de naissance']) || '';
    if (!dn) return 'adulte';
    const d = new Date(dn);
    if (isNaN(d)) return 'adulte';
    let age = finAnnee.getFullYear() - d.getFullYear();
    const anniversaire = new Date(finAnnee.getFullYear(), d.getMonth(), d.getDate());
    if (finAnnee < anniversaire) age--;
    return age < (ulm ? 25 : 21) ? 'jeune' : 'adulte';
}

function aeralGenre(u) {
    const g = ((u && u.fields && (u.fields['Genre'] || u.fields['Civilité'])) || '').toString().trim().toLowerCase();
    if (/f[ée]minin|mme|madame|femme|^f$/.test(g)) return 'femme';
    if (/pr[ée]f[èe]re/i.test(g)) return null;
    if (/masculin|monsieur|homme|^m(?!me)/.test(g)) return 'homme';
    return null;
}

// Uniformise une ligne carnet OU GVV en vol analysable.
function aeralNormaliser(records, source, utilisateurs) {
    const num = v => parseFloat(String(v ?? '').replace(',', '.'));
    return (records || []).map(r => {
        const f = r.fields || {};
        const ulm = aeralEstUlm(f['Machine']);
        let duree, fonction, instructeur, nature, precision, eleve;
        if (source === 'gvv') {
            duree = (f['Compteur fin'] !== undefined && f['Compteur début'] !== undefined)
                ? Math.max(0, num(f['Compteur fin']) - num(f['Compteur début'])) : 0;
            if (ulm) {
                // F-JVIO : horametre H.MM
                const hh = v => { const t = num(v); const h = Math.floor(t); return h + (t - h) * 100 / 60; };
                duree = Math.max(0, hh(f['Compteur fin']) - hh(f['Compteur début']));
            }
            const dc = String(f['DC'] || '') === '1';
            const cat = (f['Cat'] || '').toString().trim().toUpperCase();
            fonction = dc ? 'EP/I' : 'P';
            instructeur = dc ? (f['Inst/PAX'] || '') : '';
            eleve = dc ? (f['Pilote'] || '') : '';
            nature = cat === 'VI' ? 'vol initiation' : (cat === 'R' ? 'remorquage' : '');
            precision = cat === 'VI' ? 'Vol d\'initiation' : (cat === 'R' ? 'Remorquage' : (cat === 'VE' ? 'Évacuation' : ''));
        } else {
            duree = aeralDuree(f);
            fonction = (f['Fonction'] || '').toString().toUpperCase();
            instructeur = (f['Instructeur'] || '').toString().trim();
            nature = (f['Nature'] || '').toString().toLowerCase();
            precision = (f['Précision activité'] || '').toString().toLowerCase();
            eleve = fonction.includes('EP') ? (f['Pilote'] || '') : '';
        }
        const txt = `${nature} ${precision}`;
        const estRemorquage = /remorquage|\brem\b/i.test(txt);
        const estInitiation = /initiation|vld/i.test(txt);
        const estNuit = /nuit/i.test(txt);
        const estNavigation = /navigation|voyage/i.test(txt);
        const estInstruction = /instruction/i.test(txt) || fonction.includes('EP') || fonction.includes('/I') || fonction.includes('FI');
        const att = parseInt(f['Atterrissages'] ?? f['Attero'], 10) || 1;
        const dec = parseInt(f['Décollages'], 10) || att;
        return {
            date: f['Date'] || '', ulm, duree, fonction, instructeur, eleve,
            estRemorquage, estInitiation, estNuit, estNavigation, estInstruction,
            machine: (f['Machine'] || '').toString().trim().toUpperCase(),
            dec, att,
            dep: (f['Départ'] || '').toString().trim(),
            arr: source === 'gvv' ? (f['Lieu'] || '').toString().trim() : (f['Arrivée'] || '').toString().trim(),
        };
    }).filter(v => v.date && v.duree > 0);
}

async function aeralCalculer(annee) {
    const deb = `${annee}-01-01`, fin = `${annee}-12-31`;
    const headersLoc = { headers };
    const carnet = await fetchTousRecordsCache(
        `${API_BASE}/${encodeURIComponent('Carnet de route Pilotes')}?filterByFormula=${encodeURIComponent(`AND({Date} >= "${deb}", {Date} <= "${fin}")`)}&pageSize=100`, headersLoc);
    const gvv = (await fetchTousRecordsCache(`${API_BASE}/${encodeURIComponent('Vols GVV')}?pageSize=100`, headersLoc))
        .filter(r => { const d = (r.fields || {})['Date'] || ''; return d >= deb && d <= fin; });
    aeralUtilisateurs = aeralUtilisateurs || await fetchTousRecordsCache(`${API_BASE}/${encodeURIComponent('Utilisateurs')}?pageSize=100`, headersLoc);

    const volsCarnet = aeralNormaliser(carnet, 'carnet');
    const volsGvv = aeralNormaliser(gvv, 'gvv');
    // Exclure les lignes GVV deja couvertes par une ligne carnet (meme jour/machine/compteurs)
    const num = v => parseFloat(String(v ?? '').replace(',', '.'));
    const carnetBrut = carnet.map(r => r.fields || {});
    const volsGvvOrph = volsGvv.filter((g, i) => {
        const f = gvv[i].fields || {};
        const deb2 = num(f['Compteur début']), fin2 = num(f['Compteur fin']);
        return !carnetBrut.some(c => (c['Date'] || '') === g.date
            && (c['Machine'] || '').toString().trim().toUpperCase() === g.machine
            && (Math.abs(num(c['Horamètre départ']) - deb2) <= 0.005 || Math.abs(num(c['Horamètre arrivée']) - fin2) <= 0.005));
    });
    return volsCarnet.concat(volsGvvOrph);
}

function aeralRapportHtml(vols, annee) {
    const finAnnee = new Date(annee, 11, 31);
    const u = aeralUtilisateurs || [];
    const cent = v => v.toFixed(2).replace('.', ',');
    const somme = list => list.reduce((s, v) => s + v.duree, 0);
    const hhmm = v => { const t = Math.round(v * 60); return [Math.floor(t / 60), t % 60]; };
    const cellH = v => { const [h, m] = hhmm(v); return `<td class="aeral-num">${cent(v)}</td><td class="aeral-num">${h}</td><td class="aeral-num">${String(m).padStart(2, '0')}</td>`; };
    const roles = u0 => (((u0.fields || {})['Rôles']) || []).join(' ');
    const nfed = u0 => { const f = u0.fields || {}; return f['Numéro licence FFA'] || f['Numéro licence FFPLUM'] || f['Numéro licence FFVP'] || ''; };

    const avion = vols.filter(v => !v.ulm);
    const ulm = vols.filter(v => v.ulm);
    const catVol = v => v.estInitiation ? 'vi' : v.estNuit ? 'nuit' : v.estNavigation ? 'nav' : 'local';

    // --- Tableau demographique (format officiel 2 colonnes) -----------------
    const demoTable = list => {
        const b = { 'f-adulte': 0, 'f-jeune': 0, 'h-adulte': 0, 'h-jeune': 0, nf: 0, ng: 0 };
        const nomsIntrouvables = new Set();
        list.forEach(v => {
            const m = aeralTrouverMembre(v.eleve || v.instructeur, u);
            if (!m) { b.nf += v.duree; nomsIntrouvables.add((v.eleve || v.instructeur || '').trim()); return; }
            const sexe = aeralGenre(m);
            if (!sexe) { b.ng += v.duree; return; }
            const age = aeralClasseAge(m, finAnnee, v.ulm);
            b[`${sexe === 'femme' ? 'f' : 'h'}-${age}`] += v.duree;
        });
        const nr = b.nf + b.ng;
        const raisons = [
            b.nf ? `${cent(b.nf)} h : membre introuvable dans l'annuaire (${[...nomsIntrouvables].slice(0, 4).join(', ')}${nomsIntrouvables.size > 4 ? '…' : ''})` : '',
            b.ng ? `${cent(b.ng)} h : genre non renseigné sur la fiche` : ''
        ].filter(Boolean).join(' · ');
        return `<table class="aeral-table">
            <tr><th></th><th>Centièmes</th><th>HH</th><th>MM</th><th></th><th>Centièmes</th><th>HH</th><th>MM</th></tr>
            <tr><td>Jeunes hommes</td>${cellH(b['h-jeune'])}<td>Jeunes femmes</td>${cellH(b['f-jeune'])}</tr>
            <tr><td>Hommes adultes</td>${cellH(b['h-adulte'])}<td>Femmes adultes</td>${cellH(b['f-adulte'])}</tr>
            <tr><td><strong>Total hommes</strong></td>${cellH(b['h-jeune'] + b['h-adulte'])}<td><strong>Total femmes</strong></td>${cellH(b['f-jeune'] + b['f-adulte'])}</tr>
            <tr><td><strong>Total des heures de vol</strong></td>${cellH(somme(list))}<td colspan="4">${nr ? `<span style="font-size:10px; color:#94a3b8;">Non renseigné : ${cent(nr)} h — ${raisons}</span>` : ''}</td></tr>
        </table>`;
    };

    // --- Tableau categories AVION (format officiel) --------------------------
    const blocAvion = list => {
        const c = k => somme(list.filter(v => catVol(v) === k));
        return `<table class="aeral-table">
            <tr><th></th><th>Centièmes</th><th>HH</th><th>MM</th><th style="border:none; background:none;"></th><th colspan="3"></th></tr>
            <tr><td>VFR Jour local</td>${cellH(c('local'))}<td colspan="4"></td></tr>
            <tr><td>VFR Jour Navigation (distance &gt; 50 NM)</td>${cellH(c('nav'))}<td colspan="4"></td></tr>
            <tr><td>VFR Nuit</td>${cellH(c('nuit'))}<td>Dont vol BIA</td><td colspan="3" class="aeral-num">—</td></tr>
            <tr><td><strong>Total des heures de vol</strong></td>${cellH(somme(list))}<td colspan="4"></td></tr>
        </table>`;
    };

    // --- Tableau categories ULM par classes (format officiel) ----------------
    const blocUlm = list => {
        const classe = n => n === 3 ? somme(list) : 0;
        return `<table class="aeral-table">
            <tr><th></th><th>Centièmes</th><th>HH</th><th>MM</th><th style="border:none; background:none;"></th><th></th></tr>
            <tr><td>Classe 3 - multiaxes</td>${cellH(classe(3))}<td style="vertical-align:middle;">Dont vol BIA</td><td class="aeral-num" style="vertical-align:middle;">—</td></tr>
            <tr><td><strong>Total des heures de vol</strong></td>${cellH(somme(list))}<td colspan="2"></td></tr>
        </table>`;
    };

    // --- Instructeurs (format officiel) --------------------------------------
    const parInstr = {};
    vols.forEach(v => {
        if (!v.estInstruction) return;
        const m = v.instructeur ? aeralTrouverMembre(v.instructeur, u) : null;
        const cle = m ? m.id : (v.instructeur || 'Non attribué');
        parInstr[cle] = parInstr[cle] || { h: 0, avion: 0, ulm: 0 };
        parInstr[cle].h += v.duree;
        (v.ulm ? parInstr[cle].ulm += v.duree : parInstr[cle].avion += v.duree);
    });
    // Tous les membres avec un role Instructeur*, meme a 0 h
    const instrMembres = u.filter(m => /instructeur/i.test(roles(m)));
    instrMembres.forEach(m => { if (!parInstr[m.id]) parInstr[m.id] = { h: 0, avion: 0, ulm: 0 }; });
    const croix = (m, motif) => (m && new RegExp(motif, 'i').test(roles(m))) ? 'X' : '';
    const nomDe = m => `${((m.fields || {})['Nom'] || '')} ${((m.fields || {})['Prénom'] || '')}`.trim().toUpperCase();
    const lignesInstr = Object.entries(parInstr).map(([cle, t]) => {
        const m = u.find(x => x.id === cle);
        return `<tr><td>${m ? nomDe(m) : cle}</td>
            <td class="aeral-num">${t.avion ? cent(t.avion) : '—'}</td>
            <td class="aeral-num">${t.ulm ? cent(t.ulm) : '—'}</td>
            <td class="aeral-num">${cent(t.h)}</td></tr>`;
    }).sort((a, b) => a.localeCompare(b)).join('');
    const totInstr = Object.values(parInstr).reduce((s, t) => s + t.h, 0);
    const totInstrAvion = Object.values(parInstr).reduce((s, t) => s + t.avion, 0);
    const totInstrUlm = Object.values(parInstr).reduce((s, t) => s + t.ulm, 0);

    // --- Machines + mouvements ----------------------------------------------
    const machines = [...new Set(vols.map(v => v.machine))].sort();
    const lignesMach = machines.map(m => {
        const lv = vols.filter(v => v.machine === m);
        const rem = lv.filter(v => v.estRemorquage);
        return `<tr><td>${m}</td><td class="aeral-num">${cent(somme(lv) - somme(rem))}</td><td class="aeral-num">${cent(somme(rem))}</td><td class="aeral-num">${cent(somme(lv))}</td></tr>`;
    }).join('');
    const estLfoy = s => !s || /lfoy|saint.?romain/i.test(s);
    let mDec = 0, mAtt = 0, mRem = 0;
    vols.forEach(v => {
        if (v.estRemorquage) { mRem += 1; return; }
        if (estLfoy(v.dep)) mDec += v.dec;
        if (estLfoy(v.arr)) mAtt += v.att;
    });
    const mvtRem = mRem * 2;

    return `
    <div class="aeral-rapport">
        <h3>Compte-rendu annuel ${annee} — heures de vol</h3>

        <h4>Instructeurs de l'aéroclub</h4>
        <table class="aeral-table">
            <tr><th>Nom de l'instructeur</th><th>Avion</th><th>ULM</th><th>Total heures d'instruction</th></tr>
            ${lignesInstr}
        </table>

        <h4>Activité en instruction</h4>
        <h5 style="margin:10px 0 4px; font-size:13px; color:#475569;">✈️ Avion</h5>
        ${blocAvion(avion.filter(v => v.estInstruction))}
        ${demoTable(avion.filter(v => v.estInstruction))}
        <h5 style="margin:10px 0 4px; font-size:13px; color:#475569;">🪂 ULM</h5>
        ${blocUlm(ulm.filter(v => v.estInstruction))}
        ${demoTable(ulm.filter(v => v.estInstruction))}

        <h4>Activité hors instruction</h4>
        <h5 style="margin:10px 0 4px; font-size:13px; color:#475569;">✈️ Avion</h5>
        ${blocAvion(avion.filter(v => !v.estInstruction))}
        ${demoTable(avion.filter(v => !v.estInstruction))}
        <h5 style="margin:10px 0 4px; font-size:13px; color:#475569;">🪂 ULM</h5>
        ${blocUlm(ulm.filter(v => !v.estInstruction))}
        ${demoTable(ulm.filter(v => !v.estInstruction))}

        <h4>Heures par machine</h4>
        <table class="aeral-table"><tr><th>Machine</th><th>Hors remorquage</th><th>Remorquage</th><th>Total</th></tr>${lignesMach}</table>

        <h4>Nombre de mouvements sur la plate-forme LFOY (Le Havre – Saint-Romain)</h4>
        <table class="aeral-table">
            <tr><th></th><th>Nombre</th><th>Détail</th></tr>
            <tr><td>Décollages</td><td class="aeral-num">${mDec}</td><td>1 décollage = 1 mouvement</td></tr>
            <tr><td>Atterrissages (dont touchés)</td><td class="aeral-num">${mAtt}</td><td>1 atterrissage ou touché = 1 mouvement</td></tr>
            <tr><td>Remorquages</td><td class="aeral-num">${mvtRem}</td><td>${mRem} remorquage(s) × 2 mouvements (décollage + atterrissage)</td></tr>
            <tr><td><strong>Total mouvements</strong></td><td class="aeral-num"><strong>${mDec + mAtt + mvtRem}</strong></td><td></td></tr>
        </table>
        <p class="aeral-note">⚠️ Ajouter à ce total les mouvements des planeurs remorqués (décollage + atterrissage du planeur, non comptabilisés dans le carnet avion/ULM).</p>
        <p class="aeral-note">Sources : carnets de route + vols GVV non couverts. « Non renseigné » = membre sans genre ou hors annuaire — renseignez le champ Genre de la fiche membre.</p>
    </div>`;
}

async function ouvrirRapportAeral() {
    const anneeDefaut = new Date().getFullYear() - 1;
    const corps = `
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:12px;">
            <label for="aeral-annee">Année :</label>
            <input type="number" id="aeral-annee" value="${anneeDefaut}" min="2020" max="2100" style="width:90px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;">
            <button id="aeral-generer" class="btn-primary">Générer</button>
            <button id="aeral-print" class="btn-secondary">🖨️ Imprimer</button>
        </div>
        <div id="aeral-contenu" style="max-height:78vh; overflow:auto;"><p class="carnet-empty">Choisir l'année puis « Générer ».</p></div>`;
    // Grande modale dédiée (quasi plein écran pour lire les tableaux).
    const m = document.createElement('div');
    m.className = 'modal'; m.style.display = 'flex'; m.style.zIndex = '20000';
    m.innerHTML = `<div class="modal-content" style="max-width:1120px; width:96%;">
        <span class="close-modal" style="font-size:22px; cursor:pointer;">&times;</span>
        <h3 style="display:flex; align-items:center; gap:10px; color:#1e3d59; margin-top:0;"><span style="font-size:28px;">📊</span><span>Rapport AERAL — compte-rendu annuel</span></h3>
        ${corps}</div>`;
    m.querySelector('.close-modal').addEventListener('click', () => m.remove());
    document.body.appendChild(m);
    const gen = async () => {
        const zone = document.getElementById('aeral-contenu');
        const a = parseInt(document.getElementById('aeral-annee').value, 10) || anneeDefaut;
        zone.innerHTML = '<p class="carnet-empty">Calcul en cours…</p>';
        try {
            const vols = await aeralCalculer(a);
            zone.innerHTML = aeralRapportHtml(vols, a);
        } catch (e) {
            zone.innerHTML = `<p class="carnet-empty">Erreur : ${escHtml(e.message || e)}</p>`;
        }
    };
    document.getElementById('aeral-generer').addEventListener('click', gen);
    document.getElementById('aeral-print').addEventListener('click', () => {
        const zone = document.getElementById('aeral-contenu');
        const w = window.open('', '_blank');
        w.document.write(`<html><head><title>Rapport AERAL</title><style>body{font-family:sans-serif;font-size:12px}h3{border-bottom:2px solid #333}h4{margin:14px 0 4px}.aeral-table{border-collapse:collapse;margin:4px 0 12px}.aeral-table td,.aeral-table th{border:1px solid #999;padding:4px 8px}.aeral-num{text-align:right;font-variant-numeric:tabular-nums}.aeral-sub{font-size:11px;color:#555;margin-top:8px}.aeral-note{font-size:10px;color:#777;margin-top:14px}</style></head><body>${zone.innerHTML}</body></html>`);
        w.document.close(); w.print();
    });
    gen();
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-rapport-aeral');
    if (btn) btn.addEventListener('click', ouvrirRapportAeral);
});
