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
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}/${recordId}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ fields: { "Commentaire": nouveauCommentaire.trim() } })
        });
        if (response.ok) {
            if (tableName === 'Présences Club') await chargerPresencesClub();
            if (tableName === 'Présences Planeur') await chargerPresencesPlaneur();
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
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Club')}?filterByFormula=IS_SAME({Date}, '${dateIsoStr}', 'day')`;
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
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Club')}`, {
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
        const recRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Club')}/${recordId}`, { headers });
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
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Club')}?records[]=${recordId}`, { method: 'DELETE', headers: headers });
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

async function chargerPresencesPlaneur() {
    if (typeof chargerListeMembresCache === 'function') await chargerListeMembresCache();
    const listInst = document.getElementById('list-instructeurs');
    const listElev = document.getElementById('list-eleves');
    const listPilo = document.getElementById('list-pilotes'); 
    if (!listInst || !listElev || !listPilo) return;
    listInst.innerHTML = ""; listElev.innerHTML = ""; listPilo.innerHTML = "";
    const dateIsoStr = dateAffichee.toISOString().split('T')[0];
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Planeur')}?filterByFormula=IS_SAME({Date}, '${dateIsoStr}', 'day')`;
        const response = await cachedFetch(url, { headers });
        const data = await response.json();
        if (data.records) {
            data.records.forEach(rec => {
                const nom = rec.fields['Nom du pilote'] || 'Anonyme';
                const role = rec.fields['Rôle'];
                const commentaire = rec.fields['Commentaire'] || '';
                const li = document.createElement('li');
                li.innerHTML = creerLignePresence(nom, commentaire, rec.id, 'Présences Planeur');
                if (role === 'Instructeur') listInst.appendChild(li);
                if (role === 'Élève') listElev.appendChild(li);
                if (role === 'Pilote') listPilo.appendChild(li); 
            });
        }
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
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Planeur')}`, {
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
        await chargerPresencesPlaneur();
    } catch (error) {
        console.error(error);
        alert(`Erreur lors de l'inscription : ${error.message}`);
    }
}

async function desinscrirePlaneur(recordId) {
    try {
        const recRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Planeur')}/${recordId}`, { headers });
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
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Planeur')}?records[]=${recordId}`, { method: 'DELETE', headers: headers });
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
    const membres = (typeof listeMembresCache !== 'undefined' ? listeMembresCache : []);
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
    modal.dataset.table = table;
    modal.dataset.valeur = valeur;
    modal.style.display = 'flex';
}

async function inscrireAutreMembre() {
    const modal = document.getElementById('modal-inscrire-autre');
    const select = document.getElementById('select-inscrire-autre');
    if (!modal || !select || !select.value) return;
    if (!roleAutorise(['Super admin'])) {
        alert("Réservé aux Super admin.");
        return;
    }
    const table = modal.dataset.table;
    const valeur = modal.dataset.valeur;
    const membre = (typeof listeMembresCache !== 'undefined' ? listeMembresCache : []).find(m => m.id === select.value);
    if (!membre) return;
    const f = membre.fields || {};
    const nomPilote = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim() || 'Membre';
    const dateStr = dateAffichee.toISOString().split('T')[0];
    const tableName = table === 'Présences Club' ? 'Présences Club' : 'Présences Planeur';
    const fields = table === 'Présences Club'
        ? { 'Nom du pilote': nomPilote, 'Lieu': valeur, 'Date': dateStr }
        : { 'Nom du pilote': nomPilote, 'Rôle': valeur, 'Date': dateStr };
    try {
        const payload = { records: [{ fields: fields }] };
        const response = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
        if (response.ok) {
            modal.style.display = 'none';
            if (table === 'Présences Club') await chargerPresencesClub();
            else await chargerPresencesPlaneur();
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
