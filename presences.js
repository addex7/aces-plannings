/* ==========================================================================
   PRÉSENCES PLANEUR - GESTION DES INSCRIPTIONS
   ========================================================================== */

function normaliserRole(role) {
    return String(role || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function roleAutorise(rolesAutorises) {
    if (!currentUser || !Array.isArray(currentUser.roles)) return false;
    return currentUser.roles.some(r => rolesAutorises.some(role => normaliserRole(r) === normaliserRole(role)));
}

function peutSupprimerPresence(nom) {
    if (!currentUser) return false;
    const rolesAutorises = ['Super admin', 'Instructeur avion', 'Instructeur ULM', 'Instructeur planeur'];
    if (roleAutorise(rolesAutorises)) return true;
    const nomUtilisateur = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    return typeof correspondanceNom === 'function' ? correspondanceNom(nom, nomUtilisateur) : nom === nomUtilisateur;
}

function peutModifierCommentaire(nom) {
    if (!currentUser) return false;
    if (roleAutorise(['Super admin'])) return true;
    const nomUtilisateur = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
    return typeof correspondanceNom === 'function' ? correspondanceNom(nom, nomUtilisateur) : nom === nomUtilisateur;
}

function creerLignePresence(nom, commentaire, recordId, tableName) {
    const commentaireEscaped = commentaire.replace(/"/g, '&quot;');
    const nomEscaped = nom.replace(/"/g, '&quot;').replace(/'/g, "\\'");
    const btnSupprimer = peutSupprimerPresence(nom)
        ? `<button class="btn-remove-presence" onclick="desinscrire${tableName === 'Présences Club' ? 'Club' : 'Planeur'}('${recordId}')">❌</button>`
        : '';
    const btnCommentaire = peutModifierCommentaire(nom)
        ? `<button class="btn-comment" onclick="modifierCommentaire('${recordId}', '${tableName}', '${commentaireEscaped}', '${nomEscaped}')" title="Ajouter/Modifier un commentaire">💬</button>`
        : '';
    return `
        <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0; overflow:hidden;">
            <span style="white-space:nowrap;">- ${nom}</span>
            ${btnCommentaire}
            <span class="comment-text" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${commentaireEscaped}</span>
        </div>
        ${btnSupprimer}
    `;
}

async function modifierCommentaire(recordId, tableName, commentaireActuel, nom = '') {
    if (!peutModifierCommentaire(nom)) {
        alert("Tu ne peux modifier que ton propre commentaire.");
        return;
    }
    const nouveauCommentaire = prompt("Ajouter un commentaire :", commentaireActuel || "");
    if (nouveauCommentaire === null) return;
    try {
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent(tableName)}/${recordId}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ fields: { "Commentaire": nouveauCommentaire.trim() } })
        });
        if (response.ok) {
            if (tableName === 'Présences Club') await chargerPresencesClub();
            if (tableName === 'Présences Planeur') {
                if (nom) {
                    const recRes = await apiFetch(`${API_BASE}/${encodeURIComponent('Présences Planeur')}/${recordId}`, { headers });
                    const rec = recRes.ok ? await recRes.json() : null;
                    if (rec && rec.fields && rec.fields['Rôle'] === 'Instructeur') {
                        const dateStr = (rec.fields['Date'] || '').split('T')[0];
                        await synchroniserDisposPlaneur(nom, dateStr, nouveauCommentaire.trim());
                    }
                }
                await chargerPresencesPlaneur();
            }
        } else {
            const result = await response.json();
            console.error(result);
            alert(`Erreur lors de la sauvegarde du commentaire : ${result.error ? result.error.message : 'Erreur inconnue'}`);
        }
    } catch (error) {
        console.error(error);
        alert(`Erreur lors de la sauvegarde du commentaire : ${error.message}`);
    }
}

async function chargerPresencesClub() {
    if (typeof chargerListeMembresCache === 'function') await chargerListeMembresCache();
    const listAtelier = document.getElementById('list-atelier');
    const listSalle = document.getElementById('list-salle');
    if (!listAtelier || !listSalle) return;
    listAtelier.innerHTML = "";
    listSalle.innerHTML = "";
    const dateIsoStr = dateAffichee.toISOString().split('T')[0];
    try {
        const url = `${API_BASE}/${encodeURIComponent('Présences Club')}?filterByFormula=IS_SAME({Date}, '${dateIsoStr}', 'day')`;
        const response = await cachedFetch(url, { headers });
        const data = await response.json();
        if (data.records) {
            data.records.forEach(rec => {
                const nom = rec.fields['Nom du pilote'] || 'Anonyme';
                const lieu = rec.fields['Lieu'];
                const commentaire = rec.fields['Commentaire'] || '';
                const li = document.createElement('li');
                li.innerHTML = creerLignePresence(nom, commentaire, rec.id, 'Présences Club');
                if (lieu === 'Atelier Alain Bernage') listAtelier.appendChild(li);
                if (lieu === 'Salle Ernest Meyer') listSalle.appendChild(li);
            });
        }
    } catch (error) {
        console.error(error);
    }
    afficherBoutonsInscrireAutre();
}

async function sinscrireClub(lieu) {
    const nomPilote = nomPiloteCourant();
    if (!nomPilote) { alert('Connecte-toi pour t\'inscrire.'); return; }
    try {
        const dateStr = dateAffichee.toISOString().split('T')[0];
        const payload = { records: [{ fields: { "Nom du pilote": nomPilote.trim(), "Lieu": lieu, "Date": dateStr } }] };
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent('Présences Club')}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        console.log('Réponse Airtable Présences Club :', result);
        if (!response.ok) {
            const msg = (result.error && result.error.message) || JSON.stringify(result);
            alert(`Erreur lors de l'inscription : ${msg}`);
            return;
        }
        if (typeof enregistrerAudit === 'function') {
            await enregistrerAudit('Inscription Club', lieu, `Pilote : ${nomPilote} | Date : ${dateStr}`, 'Présences');
        }
        await chargerPresencesClub();
    } catch (error) {
        console.error(error);
        alert(`Erreur lors de l'inscription : ${error.message}`);
    }
}

async function desinscrireClub(recordId) {
    try {
        const recRes = await apiFetch(`${API_BASE}/${encodeURIComponent('Présences Club')}/${recordId}`, { headers });
        const rec = recRes.ok ? await recRes.json() : null;
        const nomInscrit = (rec && rec.fields && rec.fields['Nom du pilote']) || '';
        const nomUtilisateur = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
        const estProprietaire = typeof correspondanceNom === 'function' ? correspondanceNom(nomInscrit, nomUtilisateur) : nomInscrit === nomUtilisateur;
        const rolesAutorises = ['Super admin', 'Instructeur avion', 'Instructeur ULM', 'Instructeur planeur'];
        const aRoleAutorise = roleAutorise(rolesAutorises);
        if (!estProprietaire && !aRoleAutorise) {
            alert("Tu n'as pas le droit de supprimer cette inscription.");
            return;
        }
        if (!confirm("Voulez-vous supprimer cette inscription ?")) return;
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent('Présences Club')}?records[]=${recordId}`, { method: 'DELETE', headers: headers });
        if (response.ok) {
            if (typeof enregistrerAudit === 'function' && rec) {
                const pilote = rec.fields?.['Nom du pilote'] || '';
                const lieu = rec.fields?.['Lieu'] || '';
                const date = rec.fields?.['Date'] || '';
                await enregistrerAudit('Désinscription Club', lieu, `Pilote : ${pilote} | Date : ${date}`, 'Présences');
            }
            await chargerPresencesClub();
        }
    } catch (error) {
        console.error(error);
    }
}

function minutesVersHeure(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function intervallesDispoPlaneur(nom, dispos) {
    const specifiques = [];
    const generiques = [];
    (dispos || []).forEach(r => {
        const f = r.fields || {};
        if (typeof correspondanceNom === 'function' && !correspondanceNom(f['Instructeur'], nom)) return;
        const estDispo = f['Disponible'] === true || f['Disponible'] === 'true' || f['Disponible'] === 1 || f['Disponible'] === '1';
        if (!estDispo) return;
        const [hs, ms] = String(f['Heure début'] || '00:00').split(':').map(Number);
        const [he, me] = String(f['Heure fin'] || '00:00').split(':').map(Number);
        const iv = [hs * 60 + (ms || 0), (he * 60 + (me || 0)) || 1440];
        const mach = (f['Machine'] || '').toString().trim().toLowerCase();
        if (mach === 'planeur') specifiques.push(iv);
        else if (!mach) generiques.push(iv);
    });
    const source = specifiques.length ? specifiques : generiques;
    source.sort((a, b) => a[0] - b[0]);
    const fusion = [];
    source.forEach(([s, e]) => {
        const last = fusion[fusion.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else fusion.push([s, e]);
    });
    return fusion;
}

function parseDureesCommentaire(texte) {
    if (!texte) return null;
    const t = String(texte).toLowerCase();
    const bornes = [];
    const lireHeure = (h, m) => {
        const hh = parseInt(h, 10);
        const mm = m ? parseInt(m, 10) : 0;
        if (isNaN(hh) || hh > 24 || mm > 59) return null;
        return Math.min(hh, 24) * 60 + mm;
    };
    const rePlage = /(\d{1,2})\s*(?:h|:)?\s*(\d{2})?\s*[-–—à]\s*(\d{1,2})\s*(?:h|:)?\s*(\d{2})?/g;
    let m;
    while ((m = rePlage.exec(t)) !== null) {
        const debut = lireHeure(m[1], m[2]);
        const fin = lireHeure(m[3], m[4]);
        if (debut !== null && fin !== null && debut >= 6 * 60) bornes.push(debut <= fin ? [debut, fin] : [fin, debut]);
    }
    if (bornes.length) return bornes.filter(iv => iv[1] > iv[0]);
    const mFin = /(?:max|maxi|jusqu['aà]\s*)\s*(\d{1,2})\s*(?:h|:)?\s*(\d{2})?/.exec(t);
    if (mFin) {
        const fin = lireHeure(mFin[1], mFin[2]);
        if (fin !== null && fin > 8 * 60) return [[8 * 60, fin]];
    }
    const mDebut = /(?:à partir de|dès|des|après|apres|vers)\s*(\d{1,2})\s*(?:h|:)\s*(\d{2})?/.exec(t);
    if (mDebut) {
        const debut = lireHeure(mDebut[1], mDebut[2]);
        if (debut !== null && debut >= 6 * 60 && debut < 20 * 60) return [[debut, 20 * 60]];
    }
    return null;
}

async function supprimerDisposPlaneurJour(nom, dateStr, inclureGeneriquesSiPlaneurSeul = true) {
    const formula = `AND({Instructeur}='${String(nom).replace(/'/g, "\\'")}', DATETIME_FORMAT({Date},'YYYY-MM-DD')='${dateStr}')`;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DISPONIBILITES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`, { headers }, 0, true);
        const data = await res.json();
        if (!res.ok) return;
        const seulementPlaneur = (typeof disciplinesInstructeur === 'function')
            && disciplinesInstructeur(nom).every(d => d.toLowerCase() === 'planeur');
        const ids = (data.records || []).filter(r => {
            const mach = ((r.fields || {})['Machine'] || '').toString().trim().toLowerCase();
            return mach === 'planeur' || (!mach && inclureGeneriquesSiPlaneurSeul && seulementPlaneur);
        }).map(r => r.id);
        for (let i = 0; i < ids.length; i += 10) {
            const q = ids.slice(i, i + 10).map(id => `records[]=${encodeURIComponent(id)}`).join('&');
            await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DISPONIBILITES)}?${q}`, { method: 'DELETE', headers });
        }
    } catch (err) { console.error('[PLANEUR DISPOS] suppression:', err); }
}

async function synchroniserDisposPlaneur(nom, dateStr, commentaire) {
    if (!nom || !dateStr) return;
    try {
        const formula = `AND({Instructeur}='${String(nom).replace(/'/g, "\\'")}', DATETIME_FORMAT({Date},'YYYY-MM-DD')='${dateStr}')`;
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DISPONIBILITES)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`, { headers }, 0, true);
        const data = await res.json();
        const existantes = (res.ok && data.records) || [];
        let intervalles = parseDureesCommentaire(commentaire);
        if (intervalles && intervalles.length) {
            const planeurExistantes = existantes.filter(r => ((r.fields || {})['Machine'] || '').toString().trim().toLowerCase() === 'planeur');
            const identiques = planeurExistantes.length === intervalles.length && planeurExistantes.every(r => {
                const f = r.fields || {};
                const [hs, ms] = String(f['Heure début'] || '0:0').split(':').map(Number);
                const [he, me] = String(f['Heure fin'] || '0:0').split(':').map(Number);
                return intervalles.some(iv => iv[0] === hs * 60 + (ms || 0) && iv[1] === ((he * 60 + (me || 0)) || 1440));
            });
            if (identiques) return;
            await supprimerDisposPlaneurJour(nom, dateStr, false);
        } else {
            const dejaCouvert = existantes.some(r => {
                const f = r.fields || {};
                const mach = (f['Machine'] || '').toString().trim().toLowerCase();
                const estDispo = f['Disponible'] === true || f['Disponible'] === 'true' || f['Disponible'] === 1 || f['Disponible'] === '1';
                return estDispo && (!mach || mach === 'planeur');
            });
            if (dejaCouvert) return;
            intervalles = [[8 * 60, 20 * 60]];
        }
        const records = intervalles.map(([s, e]) => ({
            fields: {
                'Date': dateStr,
                'Heure début': `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`,
                'Heure fin': e >= 1440 ? '23:59' : `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`,
                'Machine': 'planeur',
                'Disponible': true,
                'Instructeur': nom
            }
        }));
        const post = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_DISPONIBILITES)}`, {
            method: 'POST', headers, body: JSON.stringify({ records })
        });
        if (post.ok && typeof enregistrerAudit === 'function') {
            const plages = intervalles.map(iv => `${minutesVersHeure(iv[0])}–${minutesVersHeure(iv[1])}`).join(', ');
            await enregistrerAudit('Dispo planeur (présence)', nom, `Instructeur : ${nom} | Date : ${dateStr} | ${plages}`, 'Instructeur');
        }
        disposInstructeursCache = [];
    } catch (err) { console.error('[PLANEUR DISPOS] synchro:', err); }
}

async function assurerRecordPresencePlaneur(nom) {
    const dateStr = dateAffichee.toISOString().split('T')[0];
    const formula = `AND(IS_SAME({Date}, '${dateStr}', 'day'), {Rôle}='Instructeur')`;
    const res = await cachedFetch(`${API_BASE}/${encodeURIComponent('Présences Planeur')}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`, { headers }, 0, true);
    const data = await res.json();
    const existant = (data.records || []).find(r => correspondanceNom((r.fields || {})['Nom du pilote'], nom));
    if (existant) return existant.id;
    const post = await cachedFetch(`${API_BASE}/${encodeURIComponent('Présences Planeur')}`, {
        method: 'POST', headers,
        body: JSON.stringify({ records: [{ fields: { 'Nom du pilote': nom, 'Rôle': 'Instructeur', 'Date': dateStr } }] })
    });
    const created = await post.json();
    return post.ok && created.records && created.records[0] ? created.records[0].id : null;
}

async function modifierCommentaireInstructeurPlaneur(recordId, commentaireActuel, nom) {
    if (!peutModifierCommentaire(nom)) {
        alert("Tu ne peux modifier que ton propre commentaire.");
        return;
    }
    if (!recordId) recordId = await assurerRecordPresencePlaneur(nom);
    if (!recordId) return;
    await modifierCommentaire(recordId, 'Présences Planeur', commentaireActuel, nom);
}

async function definirBriefingPlaneur(recordId, nom, briefingActuel) {
    if (!peutModifierCommentaire(nom)) {
        alert("Seul l'instructeur concerné peut définir le briefing.");
        return;
    }
    const saisie = prompt("Heure du briefing planeur (ex : 09:30, vide pour effacer) :", briefingActuel || '');
    if (saisie === null) return;
    let val = saisie.trim().toLowerCase().replace('h', ':');
    if (/^\d{1,2}$/.test(val)) val += ':00';
    if (val && !/^\d{1,2}:\d{2}$/.test(val)) {
        alert("Format attendu : HH:MM (ex : 09:30)");
        return;
    }
    try {
        if (!recordId) recordId = await assurerRecordPresencePlaneur(nom);
        if (!recordId) return;
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent('Présences Planeur')}/${recordId}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ fields: { 'Briefing': val } })
        });
        if (response.ok) await chargerPresencesPlaneur();
        else alert("Erreur lors de la sauvegarde du briefing.");
    } catch (err) {
        console.error(err);
        alert(`Erreur : ${err.message}`);
    }
}

async function desinscrireInstructeurPlaneur(recordId, nom) {
    if (!peutSupprimerPresence(nom)) {
        alert("Tu n'as pas le droit de supprimer cette inscription.");
        return;
    }
    if (!confirm(`Retirer ${nom} des instructeurs planeur du jour ?`)) return;
    try {
        if (recordId) {
            await cachedFetch(`${API_BASE}/${encodeURIComponent('Présences Planeur')}?records[]=${recordId}`, { method: 'DELETE', headers });
        }
        const dateStr = dateAffichee.toISOString().split('T')[0];
        await supprimerDisposPlaneurJour(nom, dateStr);
        disposInstructeursCache = [];
        await chargerPresencesPlaneur();
        if (typeof chargerDonneesPlanning === 'function') chargerDonneesPlanning(true, false);
    } catch (err) {
        console.error(err);
    }
}

function creerLigneInstructeurPlaneur(nom, commentaire, briefing, recordId, intervalles) {
    const nomEscaped = nom.replace(/"/g, '&quot;').replace(/'/g, "\\'");
    const commentaireEscaped = (commentaire || '').replace(/"/g, '&quot;');
    const briefingEscaped = (briefing || '').replace(/"/g, '&quot;');
    const rid = recordId || '';
    const heures = (intervalles && intervalles.length)
        ? `<span class="presence-heures">${intervalles.map(iv => `${minutesVersHeure(iv[0])}–${minutesVersHeure(iv[1])}`).join(', ')}</span>`
        : '';
    const modifiable = peutModifierCommentaire(nom);
    const btnCommentaire = modifiable
        ? `<button class="btn-comment" onclick="modifierCommentaireInstructeurPlaneur('${rid}', '${commentaireEscaped}', '${nomEscaped}')" title="Ajouter/Modifier un commentaire">💬</button>`
        : '';
    const briefingHtml = modifiable
        ? `<button class="btn-comment" onclick="definirBriefingPlaneur('${rid}', '${nomEscaped}', '${briefingEscaped}')" title="Définir l'heure de briefing planeur">${briefing ? `⏱ ${briefing}` : '⏱'}</button>`
        : (briefing ? `<span class="presence-briefing">⏱ ${briefing}</span>` : '');
    const btnSupprimer = peutSupprimerPresence(nom)
        ? `<button class="btn-remove-presence" onclick="desinscrireInstructeurPlaneur('${rid}', '${nomEscaped}')">❌</button>`
        : '';
    return `
        <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0; overflow:hidden;">
            <span style="white-space:nowrap;">- ${nom}</span>
            ${heures}
            ${briefingHtml}
            ${btnCommentaire}
            <span class="comment-text" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${commentaireEscaped}</span>
        </div>
        ${btnSupprimer}
    `;
}

async function chargerPresencesPlaneur() {
    if (typeof chargerListeMembresCache === 'function') await chargerListeMembresCache();
    const listInst = document.getElementById('list-instructeurs');
    const listElev = document.getElementById('list-eleves');
    const listPilo = document.getElementById('list-pilotes'); 
    if (!listInst || !listElev || !listPilo) return;
    listInst.innerHTML = ""; listElev.innerHTML = ""; listPilo.innerHTML = "";
    const dateIsoStr = dateAffichee.toISOString().split('T')[0];
    try {
        const url = `${API_BASE}/${encodeURIComponent('Présences Planeur')}?filterByFormula=IS_SAME({Date}, '${dateIsoStr}', 'day')`;
        const response = await cachedFetch(url, { headers });
        const data = await response.json();
        const dispos = (typeof chargerDisponibilitesInstructeurs === 'function')
            ? await chargerDisponibilitesInstructeurs(dateAffichee)
            : [];
        const nomsInscrits = [];
        if (data.records) {
            data.records.forEach(rec => {
                const nom = rec.fields['Nom du pilote'] || 'Anonyme';
                const role = rec.fields['Rôle'];
                const commentaire = rec.fields['Commentaire'] || '';
                const li = document.createElement('li');
                if (role === 'Instructeur') {
                    nomsInscrits.push(nom);
                    li.innerHTML = creerLigneInstructeurPlaneur(nom, commentaire, rec.fields['Briefing'] || '', rec.id, intervallesDispoPlaneur(nom, dispos));
                    listInst.appendChild(li);
                } else {
                    li.innerHTML = creerLignePresence(nom, commentaire, rec.id, 'Présences Planeur');
                    if (role === 'Élève') listElev.appendChild(li);
                    if (role === 'Pilote') listPilo.appendChild(li);
                }
            });
        }
        const instructeursPlaneur = (typeof listeInstructeursCache !== 'undefined' ? listeInstructeursCache : [])
            .filter(u => (u.roles || []).includes('Instructeur planeur'));
        instructeursPlaneur.forEach(u => {
            if (nomsInscrits.some(n => correspondanceNom(n, u.nomComplet))) return;
            const intervalles = intervallesDispoPlaneur(u.nomComplet, dispos);
            if (!intervalles.length) return;
            const li = document.createElement('li');
            li.innerHTML = creerLigneInstructeurPlaneur(u.nomComplet, '', '', null, intervalles);
            listInst.appendChild(li);
        });
    } catch (error) {
        console.error(error);
    }
    afficherBoutonsInscrireAutre();
}

async function sinscrirePlaneur(role) {
    const roles = (currentUser && currentUser.roles) || [];
    const roleRequis = { 'Instructeur': 'Instructeur planeur', 'Élève': 'Élève planeur', 'Pilote': 'Pilote planeur' }[role];
    const normaliserRole = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
    const aLeRole = roleRequis && (roles.includes('Super admin') || roles.some(r => normaliserRole(r) === normaliserRole(roleRequis)));
    if (roleRequis && !aLeRole) {
        alert(`Tu dois avoir le rôle "${roleRequis}" pour t'inscrire en tant que ${role}.`);
        return;
    }
    const nomPilote = nomPiloteCourant();
    if (!nomPilote) { alert('Connecte-toi pour t\'inscrire.'); return; }
    try {
        const dateStr = dateAffichee.toISOString().split('T')[0];
        const payload = { records: [{ fields: { "Nom du pilote": nomPilote.trim(), "Rôle": role, "Date": dateStr } }] };
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent('Présences Planeur')}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        console.log('Réponse Airtable Présences Planeur :', result);
        if (!response.ok) {
            const msg = (result.error && result.error.message) || JSON.stringify(result);
            alert(`Erreur lors de l'inscription : ${msg}`);
            return;
        }
        if (typeof enregistrerAudit === 'function') {
            await enregistrerAudit('Inscription Planeur', role, `Pilote : ${nomPilote} | Date : ${dateStr}`, 'Présences');
        }
        if (role === 'Instructeur') {
            await synchroniserDisposPlaneur(nomPilote.trim(), dateStr, '');
        }
        await chargerPresencesPlaneur();
        if (typeof chargerDonneesPlanning === 'function') chargerDonneesPlanning(true, false);
    } catch (error) {
        console.error(error);
        alert(`Erreur lors de l'inscription : ${error.message}`);
    }
}

async function desinscrirePlaneur(recordId) {
    try {
        const recRes = await apiFetch(`${API_BASE}/${encodeURIComponent('Présences Planeur')}/${recordId}`, { headers });
        const rec = recRes.ok ? await recRes.json() : null;
        const nomInscrit = (rec && rec.fields && rec.fields['Nom du pilote']) || '';
        const nomUtilisateur = typeof nomPiloteCourant === 'function' ? nomPiloteCourant() : `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim();
        const estProprietaire = typeof correspondanceNom === 'function' ? correspondanceNom(nomInscrit, nomUtilisateur) : nomInscrit === nomUtilisateur;
        const rolesAutorises = ['Super admin', 'Instructeur avion', 'Instructeur ULM', 'Instructeur planeur'];
        const aRoleAutorise = roleAutorise(rolesAutorises);
        if (!estProprietaire && !aRoleAutorise) {
            alert("Tu n'as pas le droit de supprimer cette inscription.");
            return;
        }
        if (!confirm("Voulez-vous supprimer cette inscription ?")) return;
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent('Présences Planeur')}?records[]=${recordId}`, { method: 'DELETE', headers: headers });
        if (response.ok) {
            if (typeof enregistrerAudit === 'function' && rec) {
                const pilote = rec.fields?.['Nom du pilote'] || '';
                const role = rec.fields?.['Rôle'] || '';
                const date = rec.fields?.['Date'] || '';
                await enregistrerAudit('Désinscription Planeur', role, `Pilote : ${pilote} | Date : ${date}`, 'Présences');
            }
            await chargerPresencesPlaneur();
        }
    } catch (error) {
        console.error(error);
    }
}

function ouvrirInscrireAutre(table, valeur) {
    const modal = document.getElementById('modal-inscrire-autre');
    const select = document.getElementById('select-inscrire-autre');
    if (!modal || !select) return;
    if (typeof chargerListeMembresCache === 'function') chargerListeMembresCache();
    select.innerHTML = '';
    let membres = (typeof listeMembresCache !== 'undefined' ? listeMembresCache : []);
    const pilotesVI = table === 'Initiation';
    if (pilotesVI) {
        membres = membres.filter(m => {
            const roles = (m.fields || {})['Rôles'] || [];
            return roles.includes('Pilote VI');
        });
    }
    membres.sort((a, b) => {
        const fa = a.fields || {};
        const fb = b.fields || {};
        const na = `${fa['Prénom'] || ''} ${fa['Nom'] || ''}`.trim();
        const nb = `${fb['Prénom'] || ''} ${fb['Nom'] || ''}`.trim();
        return na.localeCompare(nb);
    });
    membres.forEach(m => {
        const f = m.fields || {};
        const nom = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim() || 'Membre';
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = nom;
        select.appendChild(opt);
    });
    select.dataset.allowCustom = pilotesVI ? '0' : '1';
    modal.dataset.table = table;
    modal.dataset.valeur = valeur;
    modal.style.display = 'flex';
}

async function inscrireAutreMembre() {
    const modal = document.getElementById('modal-inscrire-autre');
    const select = document.getElementById('select-inscrire-autre');
    if (!modal || !select || !select.value) return;
    const table = modal.dataset.table;
    const autorisations = (table === 'Événements' || table === 'Initiation')
        ? ['Super admin', 'Gestion VI', 'Instructeur avion', 'Instructeur planeur', 'Instructeur ULM']
        : ['Super admin'];
    if (!roleAutorise(autorisations)) {
        alert(table === 'Présences Club' ? "Réservé aux Super admin." : "Réservé aux Super admin, Gestion VI et instructeurs.");
        return;
    }
    const valeur = modal.dataset.valeur;
    const membre = (typeof listeMembresCache !== 'undefined' ? listeMembresCache : []).find(m => m.id === select.value);
    const nomPilote = membre
        ? `${(membre.fields || {})['Prénom'] || ''} ${(membre.fields || {})['Nom'] || ''}`.trim()
        : select.value.trim();
    if (!nomPilote) return;

    if (table === 'Initiation') {
        try {
            const vol = JSON.parse(valeur || '{}');
            if (!vol.id || !vol.source) return;
            const tableName = vol.source === 'moteur' ? 'Réservations' : (vol.source === 'planeur' ? 'VI Planeur' : 'VI Créneaux');
            const fields = vol.source === 'moteur' ? { 'Pilote': [membre.id] } : { 'Pilote': nomPilote };
            if (vol.source === 'creneau') fields['Statut'] = 'Réservé';
            const patchRes = await cachedFetch(`${API_BASE}/${encodeURIComponent(tableName)}`, {
                method: 'PATCH',
                headers: headers,
                body: JSON.stringify({ records: [{ id: vol.id, fields }] })
            });
            if (!patchRes.ok) throw new Error(await patchRes.text());
            modal.style.display = 'none';
            if (typeof chargerVolsInitiation === 'function') await chargerVolsInitiation();
        } catch (error) {
            console.error(error);
            alert("Erreur lors de l'inscription.");
        }
        return;
    }

    if (table === 'Événements') {
        try {
            const recordId = valeur;
            const getRes = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_EVENEMENTS)}/${recordId}`, { headers });
            const record = await getRes.json();
            if (!getRes.ok) throw new Error(record.error ? record.error.message : 'Erreur Airtable');

            const inscrits = parseInscrits(record.fields['Inscrits'] || '');
            if (inscrits.some(i => i.nom === nomPilote)) { alert(`${nomPilote} est déjà inscrit.`); return; }
            inscrits.push({ nom: nomPilote, commentaire: '' });

            const patchRes = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_EVENEMENTS)}`, {
                method: 'PATCH',
                headers: headers,
                body: JSON.stringify({ records: [{ id: recordId, fields: { 'Inscrits': formatInscrits(inscrits) } }] })
            });
            if (!patchRes.ok) throw new Error(await patchRes.text());
            modal.style.display = 'none';
            if (typeof chargerEvenementsJour === 'function') await chargerEvenementsJour();
            if (typeof chargerProchainsEvenements === 'function') await chargerProchainsEvenements();
        } catch (error) {
            console.error(error);
            alert("Erreur lors de l'inscription.");
        }
        return;
    }

    const dateStr = dateAffichee.toISOString().split('T')[0];
    const tableName = table === 'Présences Club' ? 'Présences Club' : 'Présences Planeur';
    const fields = table === 'Présences Club'
        ? { 'Nom du pilote': nomPilote, 'Lieu': valeur, 'Date': dateStr }
        : { 'Nom du pilote': nomPilote, 'Rôle': valeur, 'Date': dateStr };
    try {
        const payload = { records: [{ fields: fields }] };
        const response = await cachedFetch(`${API_BASE}/${encodeURIComponent(tableName)}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
        if (response.ok) {
            modal.style.display = 'none';
            if (table === 'Présences Club') await chargerPresencesClub();
            else {
                if (valeur === 'Instructeur') await synchroniserDisposPlaneur(nomPilote, dateStr, '');
                await chargerPresencesPlaneur();
                if (typeof chargerDonneesPlanning === 'function') chargerDonneesPlanning(true, false);
            }
        } else {
            const result = await response.json();
            alert(`Erreur : ${(result.error && result.error.message) || JSON.stringify(result)}`);
        }
    } catch (error) {
        console.error(error);
    }
}

function afficherBoutonsInscrireAutre() {
    document.querySelectorAll('.btn-inscription-autre').forEach(btn => {
        btn.style.display = roleAutorise(['Super admin']) ? 'inline-block' : 'none';
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const btnValiderInscrireAutre = document.getElementById('btn-valider-inscrire-autre');
    if (btnValiderInscrireAutre) btnValiderInscrireAutre.addEventListener('click', inscrireAutreMembre);
    const closeModalInscrireAutre = document.querySelector('.close-modal-inscrire-autre');
    if (closeModalInscrireAutre) {
        closeModalInscrireAutre.addEventListener('click', () => {
            const modal = document.getElementById('modal-inscrire-autre');
            if (modal) modal.style.display = 'none';
        });
    }
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('modal-inscrire-autre');
        if (modal && e.target === modal) modal.style.display = 'none';
    });
});
afficherBoutonsInscrireAutre();
