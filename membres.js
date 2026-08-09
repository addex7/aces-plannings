const TABLE_UTILISATEURS = 'Utilisateurs';

const EMAILJS_SERVICE_ID = 'service_mzemfef';
const EMAILJS_TEMPLATE_ID = 'template_1esjy9a';
const EMAILJS_RESET_TEMPLATE_ID = ''; // ID du template EmailJS dédié au reset ; laisser vide pour utiliser le template d'invitation
const EMAILJS_PUBLIC_KEY = 'V_q5vuIMURlLXAaVC';
const PUBLIC_URL = 'https://addex7.github.io/aces-plannings/index.html';

let currentUser = null;
let idMembreEnEdition = null;

function isSuperAdmin() {
    if (!currentUser) return false;
    const roles = currentUser.roles || [];
    return roles.includes('Super admin');
}

function setCurrentUser(user) {
    currentUser = user;
    if (user) {
        const save = { ...user };
        delete save.motDePasse;
        localStorage.setItem('currentUser', JSON.stringify(save));
    } else {
        localStorage.removeItem('currentUser');
    }
    updateUIRoles();
    if (typeof updateGestionVI === 'function') updateGestionVI();
}

function updateUIRoles() {
    const profile = document.getElementById('user-profile-name');
    const logoutBtn = document.getElementById('btn-logout');
    const tabMembres = document.getElementById('tab-membres');
    if (profile) profile.textContent = currentUser ? `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim() : 'Pilote Connecté';
    if (logoutBtn) logoutBtn.style.display = currentUser ? 'inline-block' : 'none';
    if (tabMembres) tabMembres.style.display = currentUser ? 'block' : 'none';
}

function genererToken() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function initAuth() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
        showSetup(token);
        return;
    }
    const resetId = params.get('reset');
    if (resetId) {
        showReset(resetId);
        return;
    }
    const saved = localStorage.getItem('currentUser');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.id) {
                setCurrentUser(parsed);
                showApp();
                if (typeof appliquerAccesDocumentaire === 'function') appliquerAccesDocumentaire();
                return;
            }
        } catch (e) {
            localStorage.removeItem('currentUser');
        }
    }
    showLogin();
}

function showLogin() {
    const overlay = document.getElementById('login-overlay');
    const setup = document.getElementById('setup-overlay');
    const forgot = document.getElementById('forgot-overlay');
    if (overlay) overlay.style.display = 'flex';
    if (setup) setup.style.display = 'none';
    if (forgot) forgot.style.display = 'none';
}

function showSetup(token) {
    const overlay = document.getElementById('login-overlay');
    const setup = document.getElementById('setup-overlay');
    if (overlay) overlay.style.display = 'none';
    if (setup) {
        setup.style.display = 'flex';
        setup.dataset.recordId = '';
    }
    document.getElementById('setup-name').textContent = '...';
    chargerInvitation(token);
}

async function chargerInvitation(recordId) {
    const setup = document.getElementById('setup-overlay');
    const nameEl = document.getElementById('setup-name');
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}/${recordId}`, { headers });
        const record = await res.json();
        if (!res.ok) throw new Error(record.error?.message || 'Erreur');
        if (!record || !record.id || record.fields['Actif']) {
            setupError('Lien d\'invitation invalide ou déjà utilisé.');
            return;
        }
        setup.dataset.recordId = record.id;
        setup.dataset.mode = 'setup';
        const f = record.fields || {};
        const h2 = setup.querySelector('h2');
        const btn = document.getElementById('btn-setup');
        const identifiantInput = document.getElementById('setup-identifiant');
        if (h2) h2.textContent = 'Créer mon compte';
        if (nameEl) nameEl.textContent = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
        if (identifiantInput) { identifiantInput.value = ''; identifiantInput.disabled = false; }
        if (btn) btn.textContent = 'Activer mon compte';
    } catch (err) {
        console.error(err);
        setupError('Erreur lors du chargement de l\'invitation.');
    }
}

function showReset(recordId) {
    const overlay = document.getElementById('login-overlay');
    const setup = document.getElementById('setup-overlay');
    if (overlay) overlay.style.display = 'none';
    if (setup) {
        setup.style.display = 'flex';
        setup.dataset.recordId = '';
        setup.dataset.mode = 'reset';
    }
    chargerReset(recordId);
}

async function chargerReset(recordId) {
    const setup = document.getElementById('setup-overlay');
    const nameEl = document.getElementById('setup-name');
    const h2 = setup.querySelector('h2');
    const btn = document.getElementById('btn-setup');
    const identifiantInput = document.getElementById('setup-identifiant');
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}/${recordId}`, { headers });
        const record = await res.json();
        if (!res.ok) throw new Error(record.error?.message || 'Erreur');
        if (!record || !record.id) { setupError('Lien de réinitialisation invalide.'); return; }
        if (!record.fields['Actif']) { setupError('Ce compte n\'est pas actif.'); return; }
        setup.dataset.recordId = record.id;
        setup.dataset.mode = 'reset';
        const f = record.fields || {};
        if (h2) h2.textContent = 'Réinitialiser mon mot de passe';
        if (nameEl) nameEl.textContent = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim();
        if (identifiantInput) { identifiantInput.value = f['Identifiant'] || ''; identifiantInput.disabled = true; }
        if (btn) btn.textContent = 'Réinitialiser le mot de passe';
    } catch (err) {
        console.error(err);
        setupError('Erreur lors du chargement de la réinitialisation.');
    }
}

function setupError(msg) {
    const setup = document.getElementById('setup-overlay');
    if (setup) {
        setup.innerHTML = `<div style="padding:30px; text-align:center;"><p style="color:#dc2626;">${msg}</p><button onclick="location.href=location.pathname" class="btn-primary" style="margin-top:10px;">Retour</button></div>`;
    }
}

function showApp() {
    const overlay = document.getElementById('login-overlay');
    const setup = document.getElementById('setup-overlay');
    if (overlay) overlay.style.display = 'none';
    if (setup) setup.style.display = 'none';
    updateUIRoles();
}

async function seConnecter() {
    const identifiant = document.getElementById('login-identifiant').value.trim();
    const motDePasse = document.getElementById('login-password').value;
    if (!identifiant || !motDePasse) { alert('Identifiant et mot de passe sont requis.'); return; }
    try {
        const champ = identifiant;
        const formula = `AND(OR({Identifiant}='${champ}', {Mail}='${champ}'), {Actif}=1)`;
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}?filterByFormula=${encodeURIComponent(formula)}`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const record = (data.records || [])[0];
        if (!record || (record.fields['Mot de passe'] || '').toString() !== motDePasse) {
            alert('Identifiant ou mot de passe incorrect.');
            return;
        }
        const f = record.fields || {};
        currentUser = {
            id: record.id,
            prenom: f['Prénom'],
            nom: f['Nom'],
            mail: f['Mail'],
            telephone: f['Téléphone'],
            identifiant: f['Identifiant'],
            roles: Array.isArray(f['Rôles']) ? f['Rôles'] : [f['Rôles']].filter(Boolean)
        };
        setCurrentUser(currentUser);
        showApp();
    if (typeof appliquerAccesDocumentaire === 'function') appliquerAccesDocumentaire();
    } catch (err) {
        console.error(err);
        alert('Erreur de connexion.');
    }
}

function seDeconnecter() {
    setCurrentUser(null);
    location.reload();
}

async function validerSetup() {
    const setup = document.getElementById('setup-overlay');
    const recordId = setup.dataset.recordId;
    const mode = setup.dataset.mode || 'setup';
    const identifiantInput = document.getElementById('setup-identifiant');
    const identifiant = identifiantInput ? identifiantInput.value.trim() : '';
    const motDePasse = document.getElementById('setup-password').value;
    const confirmation = document.getElementById('setup-confirm').value;
    if (!recordId) { alert('Lien invalide.'); return; }
    if (!motDePasse) { alert('Mot de passe requis.'); return; }
    if (mode === 'setup' && !identifiant) { alert('Identifiant requis.'); return; }
    if (motDePasse !== confirmation) { alert('Les mots de passe ne correspondent pas.'); return; }
    const fields = { 'Mot de passe': motDePasse };
    if (mode === 'setup') {
        fields['Identifiant'] = identifiant;
        fields['Actif'] = true;
    }
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}/${recordId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields })
        });
        if (!res.ok) throw new Error(await res.text());
        const record = await res.json();
        const f = record.fields || {};
        currentUser = {
            id: record.id,
            prenom: f['Prénom'],
            nom: f['Nom'],
            mail: f['Mail'],
            telephone: f['Téléphone'],
            identifiant: f['Identifiant'],
            roles: Array.isArray(f['Rôles']) ? f['Rôles'] : [f['Rôles']].filter(Boolean)
        };
        setCurrentUser(currentUser);
        const url = new URL(window.location.href);
        url.searchParams.delete('token');
        url.searchParams.delete('reset');
        window.history.replaceState({}, '', url.toString());
        showApp();
    if (typeof appliquerAccesDocumentaire === 'function') appliquerAccesDocumentaire();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de l\'opération.');
    }
}

function showForgot() {
    const login = document.getElementById('login-overlay');
    const forgot = document.getElementById('forgot-overlay');
    const status = document.getElementById('forgot-status');
    if (login) login.style.display = 'none';
    if (forgot) forgot.style.display = 'flex';
    if (status) status.textContent = '';
}

async function envoyerReset() {
    const emailInput = document.getElementById('forgot-mail');
    const status = document.getElementById('forgot-status');
    const email = emailInput.value.trim();
    if (!email) { if (status) status.textContent = 'Email requis.'; return; }
    if (status) status.textContent = 'Recherche du compte...';
    try {
        const formula = `AND({Mail}='${email}', {Actif}=1)`;
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const record = (data.records || [])[0];
        if (!record) { if (status) status.textContent = 'Aucun compte actif trouvé avec cet email.'; return; }
        const f = record.fields || {};
        const resetUrl = `${PUBLIC_URL}?reset=${record.id}`;
        if (typeof emailjs !== 'undefined') {
            const templateId = EMAILJS_RESET_TEMPLATE_ID || EMAILJS_TEMPLATE_ID;
            if (status) status.textContent = 'Envoi de l\'email...';
            emailjs.init(EMAILJS_PUBLIC_KEY);
            await emailjs.send(EMAILJS_SERVICE_ID, templateId, {
                to_name: f['Prénom'] || '',
                to_email: email,
                setup_url: resetUrl
            });
            if (status) status.textContent = 'Email envoyé. Vérifie ta boîte de réception.';
            emailInput.value = '';
        } else {
            if (status) status.textContent = 'Service email non disponible.';
        }
    } catch (err) {
        console.error(err);
        if (status) status.textContent = 'Erreur : ' + (err.text || err.message || 'inconnu');
    }
}

const ROLES_MEMBRES = ['Mécanicien', 'Gestion VI', 'Pilote VI', 'Instructeur planeur', 'Élève planeur', 'Pilote planeur', 'Documentaliste', 'Super admin'];

async function chargerUtilisateurs() {
    const tbody = document.getElementById('membres-list');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="carnet-empty">Chargement...</td></tr>';
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}?sort[0][field]=Nom&sort[0][direction]=asc`, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Erreur');
        const records = data.records || [];
        if (records.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="carnet-empty">Aucun utilisateur.</td></tr>'; return; }
        tbody.innerHTML = '';
        records.forEach(r => {
            const f = r.fields || {};
            const prenom = f['Prénom'] || '';
            const nom = f['Nom'] || '';
            const rolesActuels = Array.isArray(f['Rôles']) ? f['Rôles'] : [f['Rôles']].filter(Boolean);
            const rolesText = rolesActuels.join(', ') || '-';
            const tr = document.createElement('tr');
            tr.className = 'ligne-membre';
            tr.innerHTML = `
                <td><span class="membre-nom">${prenom} ${nom}</span></td>
                <td>${f['Mail'] || ''}</td>
                <td>${f['Téléphone'] || ''}</td>
                <td class="roles-cell">${rolesText}</td>
                <td>${f['Identifiant'] || ''}</td>
            `;
            tr.addEventListener('click', () => ouvrirSuiviMembre(r.id));
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="5" class="carnet-empty">Erreur de chargement.</td></tr>';
    }
}

async function mettreAJourRolesMembre(recordId, checkboxes) {
    const roles = Array.from(checkboxes).map(cb => cb.dataset.role);
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}/${recordId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: { 'Rôles': roles } })
        });
        if (!res.ok) throw new Error(await res.text());
    } catch (err) {
        console.error('Erreur mise à jour des rôles :', err);
        alert('Erreur lors de la mise à jour des rôles.');
    }
}

function ouvrirSuiviMembre(id) {
    const viewMembres = document.getElementById('view-membres');
    const viewAccueilMembre = document.getElementById('view-accueil-membre');
    const tabMembres = document.getElementById('tab-membres');
    if (viewMembres) viewMembres.style.display = 'none';
    if (viewAccueilMembre) viewAccueilMembre.style.display = 'block';
    if (tabMembres) tabMembres.classList.add('active');
    if (typeof chargerAccueilMembre === 'function') chargerAccueilMembre(id);
}

async function ajouterUtilisateur(event) {
    event.preventDefault();
    const prenom = document.getElementById('membre-prenom').value.trim();
    const nom = document.getElementById('membre-nom').value.trim();
    const mail = document.getElementById('membre-mail').value.trim();
    const telephone = document.getElementById('membre-telephone').value.trim();
    const roles = Array.from(document.querySelectorAll('input[name="membre-roles"]:checked')).map(cb => cb.value);
    if (!prenom || !nom || !mail) { alert('Prénom, Nom et Mail sont requis.'); return; }
    const fields = {
        'Prénom': prenom,
        'Nom': nom,
        'Mail': mail,
        'Téléphone': telephone,
        'Rôles': roles,
        'Actif': false
    };
    console.log('POST Utilisateurs', fields);
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ fields })
        });
        if (!res.ok) throw new Error(await res.text());
        const record = await res.json();
        afficherInvitation(record, mail);
        await chargerUtilisateurs();
        event.target.reset();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la création : ' + (err.message || 'Vérifiez la console.'));
    }
}

function afficherInvitation(record, email) {
    const f = record.fields || {};
    const destEmail = email || f['Mail'] || '';
    const zone = document.getElementById('membre-invitation');
    if (!zone) return;
    if (!destEmail) {
        zone.innerHTML = `<div style="background:#fef2f2; border:1px solid #fecaca; padding:12px; border-radius:6px; color:#991b1b; margin-top:10px;">Aucune adresse email pour envoyer l'invitation.</div>`;
        return;
    }
    const setupUrl = `${PUBLIC_URL}?token=${record.id}`;
    zone.innerHTML = `
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:12px; border-radius:6px; color:#166534; margin-top:10px;">
            <strong>Invitation créée pour ${f['Prénom'] || ''} ${f['Nom'] || ''}.</strong><br>
            <div id="membre-email-status" style="margin-top:8px; font-weight:500;">Envoi automatique...</div>
        </div>
    `;
    if (typeof emailjs !== 'undefined') {
        emailjs.init(EMAILJS_PUBLIC_KEY);
        emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            to_name: f['Prénom'] || '',
            to_email: destEmail,
            setup_url: setupUrl
        }).then(() => {
            const status = document.getElementById('membre-email-status');
            if (status) status.textContent = 'Email envoyé avec succès.';
        }).catch(err => {
            console.error(err);
            const status = document.getElementById('membre-email-status');
            if (status) status.textContent = 'Erreur envoi : ' + (err.text || err.message || 'inconnu');
        });
    }
}

function ouvrirModaleMembre(record) {
    const modal = document.getElementById('membre-modal');
    if (!modal) return;
    idMembreEnEdition = record.id;
    const f = record.fields || {};
    document.getElementById('edit-membre-prenom').value = f['Prénom'] || '';
    document.getElementById('edit-membre-nom').value = f['Nom'] || '';
    document.getElementById('edit-membre-mail').value = f['Mail'] || '';
    document.getElementById('edit-membre-telephone').value = f['Téléphone'] || '';
    document.getElementById('edit-membre-identifiant').value = f['Identifiant'] || '';
    document.getElementById('edit-membre-password').value = f['Mot de passe'] || '';
    const roles = Array.isArray(f['Rôles']) ? f['Rôles'] : [f['Rôles']].filter(Boolean);
    document.querySelectorAll('input[name="edit-membre-roles"]').forEach(cb => { cb.checked = roles.includes(cb.value); });
    modal.style.display = 'flex';
}

function fermerModaleMembre() {
    const modal = document.getElementById('membre-modal');
    if (modal) modal.style.display = 'none';
    idMembreEnEdition = null;
    const form = document.getElementById('membre-edit-form');
    if (form) form.reset();
}

async function sauvegarderMembre(event) {
    event.preventDefault();
    if (!idMembreEnEdition) return;
    const prenom = document.getElementById('edit-membre-prenom').value.trim();
    const nom = document.getElementById('edit-membre-nom').value.trim();
    const mail = document.getElementById('edit-membre-mail').value.trim();
    const telephone = document.getElementById('edit-membre-telephone').value.trim();
    const identifiant = document.getElementById('edit-membre-identifiant').value.trim();
    const motDePasse = document.getElementById('edit-membre-password').value;
    const roles = Array.from(document.querySelectorAll('input[name="edit-membre-roles"]:checked')).map(cb => cb.value);
    if (!prenom || !nom || !mail || !identifiant) { alert('Prénom, Nom, Mail et Identifiant sont requis.'); return; }
    const fields = { 'Prénom': prenom, 'Nom': nom, 'Mail': mail, 'Téléphone': telephone, 'Identifiant': identifiant, 'Rôles': roles };
    if (motDePasse) fields['Mot de passe'] = motDePasse;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}/${idMembreEnEdition}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields })
        });
        if (!res.ok) throw new Error(await res.text());
        fermerModaleMembre();
        await chargerUtilisateurs();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la sauvegarde.');
    }
}

async function supprimerMembre() {
    if (!idMembreEnEdition) return;
    if (!confirm('Confirmer la suppression de ce membre ?')) return;
    try {
        const res = await cachedFetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_UTILISATEURS)}/${idMembreEnEdition}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error(await res.text());
        fermerModaleMembre();
        await chargerUtilisateurs();
    } catch (err) {
        console.error(err);
        alert('Erreur lors de la suppression.');
    }
}

function initMembres() {
    const loginBtn = document.getElementById('btn-login');
    if (loginBtn) loginBtn.addEventListener('click', seConnecter);
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', seDeconnecter);
    const setupBtn = document.getElementById('btn-setup');
    if (setupBtn) setupBtn.addEventListener('click', validerSetup);
    const form = document.getElementById('membres-form');
    if (form) form.addEventListener('submit', ajouterUtilisateur);
    const editForm = document.getElementById('membre-edit-form');
    if (editForm) editForm.addEventListener('submit', sauvegarderMembre);
    const closeMembre = document.getElementById('close-membre');
    if (closeMembre) closeMembre.addEventListener('click', fermerModaleMembre);
    const deleteMembre = document.getElementById('btn-delete-membre');
    if (deleteMembre) deleteMembre.addEventListener('click', supprimerMembre);
    const forgotBtn = document.getElementById('btn-forgot');
    if (forgotBtn) forgotBtn.addEventListener('click', envoyerReset);
    const forgotLink = document.getElementById('link-forgot');
    if (forgotLink) forgotLink.addEventListener('click', (e) => { e.preventDefault(); showForgot(); });
    const backLogin = document.getElementById('link-back-login');
    if (backLogin) backLogin.addEventListener('click', (e) => { e.preventDefault(); showLogin(); });
}

document.addEventListener('DOMContentLoaded', () => {
    initMembres();
    initAuth();
});
