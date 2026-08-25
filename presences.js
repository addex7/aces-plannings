/* ==========================================================================
   PRÉSENCES PLANEUR - GESTION DES INSCRIPTIONS
   ========================================================================== */

function creerLignePresence(nom, commentaire, recordId, tableName) {
    const commentaireEscaped = commentaire.replace(/"/g, '&quot;');
    return `
        <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0; overflow:hidden;">
            <span style="white-space:nowrap;">- ${nom}</span>
            <button class="btn-comment" onclick="modifierCommentaire('${recordId}', '${tableName}', '${commentaireEscaped}')" title="Ajouter/Modifier un commentaire">💬</button>
            <span class="comment-text" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${commentaireEscaped}</span>
        </div>
        <button class="btn-remove-presence" onclick="desinscrire${tableName === 'Présences Club' ? 'Club' : 'Planeur'}('${recordId}')">❌</button>
    `;
}

async function modifierCommentaire(recordId, tableName, commentaireActuel) {
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
    if (!confirm("Voulez-vous supprimer cette inscription ?")) return;
    try {
        const recRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Club')}/${recordId}`, { headers });
        const rec = recRes.ok ? await recRes.json() : null;
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
}

async function sinscrirePlaneur(role) {
    const roles = (currentUser && currentUser.roles) || [];
    const roleRequis = { 'Instructeur': 'Instructeur planeur', 'Élève': 'Élève planeur', 'Pilote': 'Pilote planeur' }[role];
    if (roleRequis && !roles.includes(roleRequis) && !roles.includes('Super admin')) {
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
    if (!confirm("Voulez-vous supprimer cette inscription ?")) return;
    try {
        const recRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Planeur')}/${recordId}`, { headers });
        const rec = recRes.ok ? await recRes.json() : null;
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
