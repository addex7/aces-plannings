/* ==========================================================================
   FICHE D'INFORMATION PASSAGER VLO/VLD (ULM) — reglementation FFPLUM
   Bouton « Départ VIULM » de la page Vol d'Initiation : questionnaire a
   faire remplir au passager avant le vol, conserve 3 mois minimum
   (table « Fiches VLO »).
   ========================================================================== */

const VLO_TABLE = 'Fiches VLO';
const VLO_SITE_DEFAUT = 'Aérodrome du Havre Saint Romain - LFOY';
const VLO_ULM_DEFAUT = '76WB - F-JVIO';
const VLO_TEXTE_REGLEMENTAIRE =
    "Les exigences applicables aux vols en ULM ne garantissent pas un niveau de sécurité aussi élevé que les vols commerciaux de l'aviation certifiée. L'ULM, le pilote et l'exploitant ne sont pas soumis à des opérations de contrôle préalables de la part de l'autorité.";
const VLO_TEXTE_MAJORATION = '* Majoré de 4 kg minimum (vêtements/effets) - §5.3.1 / §6.4.1';
const VLO_TEXTE_CONSERVATION = 'Document à conserver 3 mois minimum après le vol - Art. 5.5.1 / 6.6.1';

function vloDateJourISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function vloChampsDepuisFormulaire() {
    const v = id => (document.getElementById(id) || {}).value || '';
    return {
        'Date du vol': v('vlo-date-vol'),
        'Site de décollage': v('vlo-site').trim(),
        'Identification ULM': v('vlo-ulm').trim(),
        'Nom': v('vlo-nom').trim(),
        'Prénom': v('vlo-prenom').trim(),
        'Date de naissance': v('vlo-naissance'),
        'Poids déclaré': v('vlo-poids').trim(),
        'Passager mineur': !!(document.getElementById('vlo-mineur') || {}).checked,
        'Signature passager': v('vlo-sign-passager').trim(),
        'Représentant légal': v('vlo-sign-legal').trim()
    };
}

function vloRemplirFormulaire(f) {
    const s = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    s('vlo-date-vol', f['Date du vol']);
    s('vlo-site', f['Site de décollage']);
    s('vlo-ulm', f['Identification ULM']);
    s('vlo-nom', f['Nom']);
    s('vlo-prenom', f['Prénom']);
    s('vlo-naissance', f['Date de naissance']);
    s('vlo-poids', f['Poids déclaré']);
    s('vlo-sign-passager', f['Signature passager']);
    s('vlo-sign-legal', f['Représentant légal']);
    const cb = document.getElementById('vlo-mineur');
    if (cb) cb.checked = !!f['Passager mineur'];
}

// Ouvre la fiche : sans record = formulaire vierge pré-rempli, avec record = edition.
function ouvrirFicheVLO(record) {
    const existing = document.getElementById('vlo-modal');
    if (existing) existing.remove();
    const f = (record && record.fields) || {};
    const overlay = document.createElement('div');
    overlay.id = 'vlo-modal';
    overlay.className = 'modal';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '20000';
    const champTxt = (id, label, val, ph) => `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
            <label for="${id}" style="min-width:150px; font-weight:600; color:#334155; font-size:14px;">${label}</label>
            <input type="text" id="${id}" value="${(val || '').replace(/"/g, '&quot;')}" placeholder="${ph || ''}"
                style="flex:1; padding:7px 10px; border:none; border-bottom:1px solid #94a3b8; font-size:14px; background:transparent;">
        </div>`;
    const champDate = (id, label, val) => `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
            <label for="${id}" style="min-width:150px; font-weight:600; color:#334155; font-size:14px;">${label}</label>
            <input type="date" id="${id}" value="${val || ''}"
                style="flex:1; padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:14px;">
        </div>`;
    const bandeau = (txt, light) => `<div style="background:${light ? '#3b82f6' : '#1e3d59'}; color:#fff; font-weight:700; padding:6px 12px; border-radius:4px; margin:14px 0 12px; font-size:14px;">${txt}</div>`;
    overlay.innerHTML = `
        <div class="modal-content" style="width:640px; max-width:94vw; max-height:90vh; overflow-y:auto; text-align:left;">
            <span class="close-modal" style="font-size:22px; cursor:pointer;">&times;</span>
            <h3 style="text-align:center; color:#1e3d59; margin:0 0 2px;">FICHE D'INFORMATION PASSAGER</h3>
            <p style="text-align:center; color:#3b82f6; font-style:italic; margin:0 0 2px; font-size:14px;">Vols de découverte (VLD) / Vols locaux à titre onéreux (VLO)</p>
            <p style="text-align:center; color:#475569; margin:0; font-size:12px;">Arrêté du 17 février 2025 relatif aux conditions d'utilisation des ULM</p>

            ${bandeau('INFORMATIONS DU VOL')}
            ${champDate('vlo-date-vol', 'Date du vol :', f['Date du vol'] || vloDateJourISO())}
            ${champTxt('vlo-site', 'Site de décollage :', f['Site de décollage'] || VLO_SITE_DEFAUT)}
            ${champTxt('vlo-ulm', 'Identification ULM :', f['Identification ULM'] || VLO_ULM_DEFAUT)}

            ${bandeau('INFORMATIONS PASSAGER', true)}
            ${champTxt('vlo-nom', 'Nom :', f['Nom'])}
            ${champTxt('vlo-prenom', 'Prénom :', f['Prénom'])}
            ${champDate('vlo-naissance', 'Date de naissance :', f['Date de naissance'])}
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                <label for="vlo-poids" style="min-width:150px; font-weight:600; color:#334155; font-size:14px;">Poids déclaré* :</label>
                <input type="number" id="vlo-poids" min="0" step="0.1" value="${(f['Poids déclaré'] || '').toString().replace(/"/g, '&quot;')}"
                    style="width:110px; padding:7px 10px; border:none; border-bottom:1px solid #94a3b8; font-size:14px; background:transparent;">
                <span style="font-size:14px; color:#334155;">kg</span>
            </div>
            <p style="font-size:11px; color:#64748b; margin:0 0 6px;">${VLO_TEXTE_MAJORATION}</p>

            ${bandeau('INFORMATION RÉGLEMENTAIRE OBLIGATOIRE')}
            <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:10px 14px; font-size:13px; line-height:1.55; color:#1e3d59;">${VLO_TEXTE_REGLEMENTAIRE}</div>

            ${bandeau('ATTESTATION ET SIGNATURE', true)}
            <p style="font-size:14px; line-height:1.55; color:#0f172a; margin:0 0 10px;">
                Je soussigné(e) atteste avoir pris connaissance des informations ci-dessus et
                <strong>accepte d'effectuer ce vol dans ces conditions</strong>.
            </p>
            <label style="display:flex; align-items:center; gap:8px; color:#3b82f6; font-size:14px; margin-bottom:14px; cursor:pointer;">
                <input type="checkbox" id="vlo-mineur" ${f['Passager mineur'] ? 'checked' : ''}>
                Passager mineur : signature du représentant légal requise
            </label>
            ${champTxt('vlo-sign-passager', 'Signature passager :', f['Signature passager'], 'Nom en toutes lettres')}
            ${champTxt('vlo-sign-legal', 'Si mineur, représentant légal :', f['Représentant légal'], 'Nom en toutes lettres')}

            <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:18px; flex-wrap:wrap;">
                <button type="button" class="nr-btn-cancel" id="vlo-fermer">Fermer</button>
                <button type="button" class="btn-primary" id="vlo-imprimer">🖨 Imprimer</button>
                <button type="button" class="btn-primary" id="vlo-enregistrer">💾 Enregistrer</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#vlo-fermer').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#vlo-imprimer').addEventListener('click', () => imprimerFicheVLO(vloChampsDepuisFormulaire()));
    overlay.querySelector('#vlo-enregistrer').addEventListener('click', async () => {
        await enregistrerFicheVLO(record && record.id, overlay);
    });
}

async function enregistrerFicheVLO(recordId, overlay) {
    const fields = vloChampsDepuisFormulaire();
    if (!fields['Nom'] && !fields['Prénom']) { alert('Renseigne au moins le nom ou le prénom du passager.'); return; }
    fields['Enregistré par'] = (currentUser && `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim()) || '';
    const btn = overlay && overlay.querySelector('#vlo-enregistrer');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }
    try {
        const url = recordId
            ? `${API_BASE}/${encodeURIComponent(VLO_TABLE)}/${recordId}`
            : `${API_BASE}/${encodeURIComponent(VLO_TABLE)}`;
        const res = await cachedFetch(url, {
            method: recordId ? 'PATCH' : 'POST',
            headers,
            body: JSON.stringify(recordId ? { fields } : { records: [{ fields }] })
        });
        if (!res.ok) throw new Error((await res.json()).error?.message || 'Erreur serveur');
        if (typeof viderApiCache === 'function') viderApiCache();
        if (overlay) overlay.remove();
        const liste = document.getElementById('vlo-liste-modal');
        if (liste) ouvrirListeFichesVLO();
    } catch (e) {
        console.error('Enregistrement fiche VLO:', e);
        alert('Erreur lors de l\'enregistrement : ' + (e.message || ''));
        if (btn) { btn.disabled = false; btn.textContent = '💾 Enregistrer'; }
    }
}

// Liste des fiches a conserver : vols des 3 derniers mois (et futurs).
async function ouvrirListeFichesVLO() {
    const existing = document.getElementById('vlo-liste-modal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'vlo-liste-modal';
    overlay.className = 'modal';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '20000';
    overlay.innerHTML = `
        <div class="modal-content" style="width:640px; max-width:94vw; max-height:85vh; overflow-y:auto; text-align:left;">
            <span class="close-modal" style="font-size:22px; cursor:pointer;">&times;</span>
            <h3 style="color:#1e3d59; margin-top:0;">Fiches passager VLO/VLD — 3 derniers mois</h3>
            <p style="font-size:12px; color:#64748b; margin:0 0 12px;">${VLO_TEXTE_CONSERVATION}</p>
            <div id="vlo-liste-contenu"><p style="color:#64748b;">Chargement…</p></div>
            <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:15px;">
                <button type="button" class="btn-primary" id="vlo-liste-nouvelle">+ Nouvelle fiche</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#vlo-liste-nouvelle').addEventListener('click', () => ouvrirFicheVLO(null));
    const contenu = overlay.querySelector('#vlo-liste-contenu');
    try {
        const limite = dateIlYAMois(3);
        const limiteISO = `${limite.getFullYear()}-${String(limite.getMonth() + 1).padStart(2, '0')}-${String(limite.getDate()).padStart(2, '0')}`;
        const formula = `OR({Date du vol} >= "${limiteISO}", {Date du vol} = '')`;
        const url = `${API_BASE}/${encodeURIComponent(VLO_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=${encodeURIComponent('Date du vol')}&sort[0][direction]=desc&pageSize=100`;
        const records = await fetchTousRecordsCache(url, { headers }, 0, true);
        if (!records.length) {
            contenu.innerHTML = '<p style="color:#64748b;">Aucune fiche enregistrée sur les 3 derniers mois.</p>';
            return;
        }
        contenu.innerHTML = records.map(r => {
            const f = r.fields || {};
            const date = f['Date du vol'] ? formaterDateFr(f['Date du vol']) : '—';
            const passager = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim() || 'Passager';
            const mineur = f['Passager mineur'] ? ' <span style="color:#b45309; font-size:12px;">(mineur)</span>' : '';
            return `<div style="display:flex; align-items:center; gap:10px; padding:9px 4px; border-bottom:1px solid #e2e8f0;">
                <div style="flex:1; min-width:0;">
                    <strong>${escapeHtml(passager)}</strong>${mineur}
                    <span style="color:#64748b; font-size:13px;"> — vol du ${date} — ${escapeHtml(f['Identification ULM'] || '')}</span>
                </div>
                <button type="button" class="btn-primary" style="font-size:12px; padding:6px 10px;" data-vlo-ouvrir="${r.id}">Ouvrir</button>
                <button type="button" class="btn-primary" style="font-size:12px; padding:6px 10px;" data-vlo-print="${r.id}" title="Imprimer la fiche">🖨</button>
                <button type="button" style="font-size:12px; padding:6px 10px; background:#ef4444; color:#fff; border:none; border-radius:6px; cursor:pointer;" data-vlo-del="${r.id}" title="Supprimer la fiche">🗑</button>
            </div>`;
        }).join('');
        contenu.querySelectorAll('[data-vlo-ouvrir]').forEach(b => b.addEventListener('click', () => {
            const rec = records.find(x => x.id === b.dataset.vloOuvrir);
            if (rec) ouvrirFicheVLO(rec);
        }));
        contenu.querySelectorAll('[data-vlo-print]').forEach(b => b.addEventListener('click', () => {
            const rec = records.find(x => x.id === b.dataset.vloPrint);
            if (rec) imprimerFicheVLO(rec.fields || {});
        }));
        contenu.querySelectorAll('[data-vlo-del]').forEach(b => b.addEventListener('click', async () => {
            const rec = records.find(x => x.id === b.dataset.vloDel);
            if (!rec) return;
            const f = rec.fields || {};
            const passager = `${f['Prénom'] || ''} ${f['Nom'] || ''}`.trim() || 'ce passager';
            const ok = typeof confirmerSuppression === 'function'
                ? await confirmerSuppression(`Supprimer la fiche VLO de ${passager} ?`)
                : confirm(`Supprimer la fiche VLO de ${passager} ?`);
            if (!ok) return;
            try {
                const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(VLO_TABLE)}/${rec.id}`, { method: 'DELETE', headers });
                if (!res.ok) throw new Error((await res.json()).error?.message || 'Erreur serveur');
                if (typeof viderApiCache === 'function') viderApiCache();
                ouvrirListeFichesVLO();
            } catch (e) {
                console.error('Suppression fiche VLO:', e);
                alert('Erreur lors de la suppression : ' + (e.message || ''));
            }
        }));
    } catch (e) {
        console.error('Liste fiches VLO:', e);
        contenu.innerHTML = '<p style="color:#dc2626;">Erreur de chargement des fiches.</p>';
    }
}

// Version imprimable de la fiche, ouverte dans une nouvelle fenetre.
function imprimerFicheVLO(f) {
    const date = f['Date du vol'] ? formaterDateFr(f['Date du vol']) : '';
    const naiss = f['Date de naissance'] ? formaterDateFr(f['Date de naissance']) : '';
    const ligne = (label, val, suffix) => `<div class="ligne"><span class="lb">${label}</span><span class="val">${escapeHtml(val || '')}</span>${suffix || ''}</div>`;
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Fiche d'information passager VLO/VLD</title>
<style>
    body { font-family: Arial, sans-serif; color: #1e3d59; max-width: 720px; margin: 24px auto; padding: 0 16px; }
    h1 { text-align: center; font-size: 20px; margin: 0 0 4px; }
    .sous-titre { text-align: center; color: #3b82f6; font-style: italic; margin: 0; font-size: 14px; }
    .arrete { text-align: center; color: #475569; font-size: 11px; margin: 2px 0 14px; }
    .bandeau { color: #fff; font-weight: 700; padding: 5px 12px; margin: 16px 0 12px; font-size: 14px; }
    .b1 { background: #1e3d59; } .b2 { background: #3b82f6; }
    .ligne { display: flex; align-items: flex-end; gap: 8px; margin-bottom: 12px; font-size: 14px; }
    .lb { font-weight: 700; }
    .val { flex: 1; border-bottom: 1px solid #94a3b8; min-height: 18px; padding: 0 6px 2px; }
    .regl { background: #eff6ff; border: 1px solid #bfdbfe; padding: 10px 14px; font-size: 12.5px; line-height: 1.5; }
    .att { font-size: 14px; line-height: 1.55; }
    .case { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #3b82f6; margin-right: 8px; vertical-align: -2px; text-align: center; line-height: 13px; font-size: 12px; }
    .mineur { color: #3b82f6; font-size: 13px; margin: 10px 0 30px; }
    .sign { display: flex; gap: 60px; margin-top: 40px; font-size: 13px; }
    .sign .val { min-width: 220px; }
    .pied { margin-top: 36px; text-align: center; font-size: 11px; color: #64748b; }
    .petit { font-size: 10.5px; color: #64748b; margin: -6px 0 4px; }
    @media print { body { margin: 0; } }
</style></head><body>
    <h1>FICHE D'INFORMATION PASSAGER</h1>
    <p class="sous-titre">Vols de découverte (VLD) / Vols locaux à titre onéreux (VLO)</p>
    <p class="arrete">Arrêté du 17 février 2025 relatif aux conditions d'utilisation des ULM</p>

    <div class="bandeau b1">INFORMATIONS DU VOL</div>
    ${ligne('Date du vol :', date)}
    ${ligne('Site de décollage :', f['Site de décollage'])}
    ${ligne('Identification ULM :', f['Identification ULM'])}

    <div class="bandeau b2">INFORMATIONS PASSAGER</div>
    ${ligne('Nom :', f['Nom'])}
    ${ligne('Prénom :', f['Prénom'])}
    ${ligne('Date de naissance :', naiss)}
    ${ligne('Poids déclaré* :', f['Poids déclaré'], '<span>kg</span>')}
    <p class="petit">${VLO_TEXTE_MAJORATION}</p>

    <div class="bandeau b1">INFORMATION RÉGLEMENTAIRE OBLIGATOIRE</div>
    <div class="regl">${VLO_TEXTE_REGLEMENTAIRE}</div>

    <div class="bandeau b2">ATTESTATION ET SIGNATURE</div>
    <p class="att">Je soussigné(e) atteste avoir pris connaissance des informations ci-dessus et <strong>accepte d'effectuer ce vol dans ces conditions</strong>.</p>
    <p class="mineur"><span class="case">${f['Passager mineur'] ? '☒' : ''}</span>Passager mineur : signature du représentant légal requise</p>
    <div class="sign">
        ${ligne('Signature passager :', f['Signature passager'])}
        ${ligne('Si mineur, représentant légal :', f['Représentant légal'])}
    </div>
    <p class="pied">${VLO_TEXTE_CONSERVATION}</p>
    <script>window.onload = function(){ window.print(); }<\/script>
</body></html>`;
    const win = window.open('', '_blank', 'width=820,height=1000');
    if (!win) { alert('La fenêtre d\'impression a été bloquée par le navigateur.'); return; }
    win.document.write(html);
    win.document.close();
}

function initFicheVLO() {
    const actions = document.querySelector('#view-initiation .header-actions');
    if (!actions) return;
    if (!document.getElementById('btn-depart-viulm')) {
        const btn = document.createElement('button');
        btn.id = 'btn-depart-viulm';
        btn.className = 'btn-primary';
        btn.type = 'button';
        btn.textContent = '🛫 Départ VLD ULM';
        btn.title = 'Fiche d\'information passager VLO/VLD — à faire signer avant le départ';
        btn.addEventListener('click', () => ouvrirFicheVLO(null));
        actions.appendChild(btn);
    }
    if (!document.getElementById('btn-depart-vip')) {
        const btn = document.createElement('button');
        btn.id = 'btn-depart-vip';
        btn.className = 'btn-primary';
        btn.type = 'button';
        btn.textContent = '🛫 Départ VIP';
        btn.title = 'Déclaration de départ VIP — plateforme HEVA FFVP (nouvel onglet)';
        btn.addEventListener('click', () => window.open('https://public.heva.ffvp.fr/club/237602/z6SJ11hCqleK3aXC3T-NCFs4Bp7fuZYnNn3AwRv3uJubkWeChEx1', '_blank'));
        actions.appendChild(btn);
    }
    if (!document.getElementById('btn-fiches-vlo')) {
        const btn = document.createElement('button');
        btn.id = 'btn-fiches-vlo';
        btn.className = 'btn-primary';
        btn.type = 'button';
        btn.textContent = 'Fiches VLD';
        btn.title = 'Fiches passager VLO/VLD conservées (3 derniers mois)';
        btn.addEventListener('click', ouvrirListeFichesVLO);
        actions.appendChild(btn);
    }
}

document.addEventListener('DOMContentLoaded', initFicheVLO);
