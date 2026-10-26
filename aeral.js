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
    if (/^f|mme|madame|femme/.test(g)) return 'femme';
    if (/^m(?!me)|monsieur|homme/.test(g)) return 'homme';
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
        return {
            date: f['Date'] || '', ulm, duree, fonction, instructeur, eleve,
            estRemorquage, estInitiation, estNuit, estNavigation, estInstruction,
            machine: (f['Machine'] || '').toString().trim().toUpperCase(),
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
    const ligne = (label, val) => `<tr><td>${label}</td><td class="aeral-num">${cent(val)}</td></tr>`;

    const avion = vols.filter(v => !v.ulm);
    const ulm = vols.filter(v => v.ulm);
    const catVol = v => v.estRemorquage ? 'rem' : v.estInitiation ? 'vi' : v.estNuit ? 'nuit' : v.estNavigation ? 'nav' : 'local';
    const demo = (list, vol) => {
        const m = aeralTrouverMembre(vol.eleve || vol.instructeur, u);
        const age = aeralClasseAge(m, finAnnee, vol.ulm);
        const sexe = aeralGenre(m);
        return sexe ? `${sexe === 'femme' ? 'f' : 'h'}-${age}` : `?-${age}`;
    };
    const demoTable = list => {
        const b = { 'f-adulte': 0, 'f-jeune': 0, 'h-adulte': 0, 'h-jeune': 0, '?-adulte': 0, '?-jeune': 0 };
        list.forEach(v => { b[demo(list, v)] += v.duree; });
        return `<table class="aeral-table"><tr><th>Femmes adultes</th><th>Femmes jeunes</th><th>Hommes adultes</th><th>Hommes jeunes</th><th>Non renseigné</th></tr>
            <tr><td class="aeral-num">${cent(b['f-adulte'])}</td><td class="aeral-num">${cent(b['f-jeune'])}</td><td class="aeral-num">${cent(b['h-adulte'])}</td><td class="aeral-num">${cent(b['h-jeune'])}</td><td class="aeral-num">${cent(b['?-adulte'] + b['?-jeune'])}</td></tr></table>`;
    };

    // Heures par instructeur : DC (EP/I ou /I) + eleves solo supervises (EP seul)
    const parInstr = {};
    vols.forEach(v => {
        if (!v.estInstruction) return;
        const nom = v.instructeur ? ((aeralTrouverMembre(v.instructeur, u) || {}).fields || {}) : null;
        const cle = nom ? `${nom['Prénom'] || ''} ${nom['Nom'] || ''}`.trim() : (v.instructeur || 'Non attribué');
        parInstr[cle] = parInstr[cle] || { dc: 0, ss: 0, avion: 0, ulm: 0 };
        const dc = v.fonction.includes('/I') || v.fonction.includes('FI');
        if (dc) parInstr[cle].dc += v.duree; else parInstr[cle].ss += v.duree;
        (v.ulm ? parInstr[cle].ulm += v.duree : parInstr[cle].avion += v.duree);
    });
    const lignesInstr = Object.entries(parInstr).sort((a, b) => a[0].localeCompare(b[0]))
        .map(([n, t]) => `<tr><td>${n}</td><td class="aeral-num">${cent(t.dc)}</td><td class="aeral-num">${cent(t.ss)}</td><td class="aeral-num">${cent(t.avion)}</td><td class="aeral-num">${cent(t.ulm)}</td></tr>`).join('');

    const blocAvion = (list, titre) => `
        <h4>${titre}</h4>
        <table class="aeral-table"><tr><th>Catégorie</th><th>Heures</th></tr>
        ${ligne('VFR jour local', somme(list.filter(v => catVol(v) === 'local')))}
        ${ligne('VFR jour navigation', somme(list.filter(v => catVol(v) === 'nav')))}
        ${ligne('VFR nuit', somme(list.filter(v => catVol(v) === 'nuit')))}
        ${ligne('Vol d\'initiation', somme(list.filter(v => catVol(v) === 'vi')))}
        ${ligne('Remorquage', somme(list.filter(v => catVol(v) === 'rem')))}
        ${ligne('Total', somme(list))}</table>
        <div class="aeral-sub">Répartition élèves/pilotes :</div>${demoTable(list)}`;

    // Par machine : total + remorquage seul
    const machines = [...new Set(vols.map(v => v.machine))].sort();
    const lignesMach = machines.map(m => {
        const lv = vols.filter(v => v.machine === m);
        const rem = lv.filter(v => v.estRemorquage);
        return `<tr><td>${m}</td><td class="aeral-num">${cent(somme(lv) - somme(rem))}</td><td class="aeral-num">${cent(somme(rem))}</td><td class="aeral-num">${cent(somme(lv))}</td></tr>`;
    }).join('');

    return `
    <div class="aeral-rapport">
        <h3>Activité ${annee} — heures de vol</h3>
        <h4>Heures d'instruction par instructeur (double commande / élèves solo supervisés)</h4>
        <table class="aeral-table"><tr><th>Instructeur</th><th>Double commande</th><th>Élèves solo sup.</th><th>Heures avion</th><th>Heures ULM</th></tr>${lignesInstr}</table>
        ${blocAvion(avion.filter(v => v.estInstruction), 'Avion — EN INSTRUCTION')}
        ${blocAvion(avion.filter(v => !v.estInstruction), 'Avion — HORS INSTRUCTION')}
        <h4>ULM (classe 3 multiaxes)</h4>
        <table class="aeral-table"><tr><th></th><th>En instruction</th><th>Hors instruction</th><th>Total</th></tr>
        <tr><td>Heures</td><td class="aeral-num">${cent(somme(ulm.filter(v => v.estInstruction)))}</td><td class="aeral-num">${cent(somme(ulm.filter(v => !v.estInstruction)))}</td><td class="aeral-num">${cent(somme(ulm))}</td></tr></table>
        <div class="aeral-sub">Répartition — en instruction :</div>${demoTable(ulm.filter(v => v.estInstruction))}
        <div class="aeral-sub">Répartition — hors instruction :</div>${demoTable(ulm.filter(v => !v.estInstruction))}
        <h4>Heures par machine</h4>
        <table class="aeral-table"><tr><th>Machine</th><th>Hors remorquage</th><th>Remorquage</th><th>Total</th></tr>${lignesMach}</table>
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
        <div id="aeral-contenu" style="max-height:70vh; overflow:auto;"><p class="carnet-empty">Choisir l'année puis « Générer ».</p></div>`;
    if (typeof afficherModaleAlerte === 'function') {
        afficherModaleAlerte('📊 Rapport AERAL — compte-rendu annuel', corps, '📊', { large: true });
    } else {
        const m = document.createElement('div');
        m.className = 'modal'; m.style.display = 'flex';
        m.innerHTML = `<div class="modal-contenu" style="max-width:900px; width:92%;"><div class="modal-titre">📊 Rapport AERAL<button class="modal-fermer" onclick="this.closest('.modal').remove()">×</button></div>${corps}</div>`;
        document.body.appendChild(m);
    }
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
