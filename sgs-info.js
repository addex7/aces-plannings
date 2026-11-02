/* ==========================================================================
   Informations SGS — bandeau planning (vol de drone, lâché de ballon…)
   Le « Délégué SGS » (et Super admin) publie une information visible de tous
   sur le planning pour la période concernée : dates, horaires, position,
   altitude max, description.
   ========================================================================== */

const TABLE_SGS_INFOS = 'Informations SGS';

function peutGererSgs() {
    return (typeof roleAutorise === 'function' && roleAutorise(['Délégué SGS', 'Super admin']))
        || (typeof isSuperAdmin === 'function' && isSuperAdmin());
}

// --- Bandeau au-dessus du planning ----------------------------------------
async function chargerBandeauSgs() {
    const zone = document.getElementById('bandeau-sgs');
    const btn = document.getElementById('btn-sgs-info');
    if (btn) btn.style.display = peutGererSgs() ? '' : 'none';
    if (!zone || typeof dateAffichee === 'undefined' || !dateAffichee) return;
    const dateStr = dateAffichee.toISOString().split('T')[0];
    try {
        const url = `${API_BASE}/${encodeURIComponent(TABLE_SGS_INFOS)}?pageSize=100`;
        const recs = await fetchTousRecordsCache(url, { headers });
        const actives = (recs || []).filter(r => {
            const f = r.fields || {};
            const d1 = f['Date début'] || '';
            const d2 = f['Date fin'] || d1;
            return d1 && dateStr >= d1 && dateStr <= d2;
        }).sort((a, b) => (a.fields['Heure début'] || '').localeCompare(b.fields['Heure début'] || ''));
        const fmtD = d => (typeof formaterDateFr === 'function' ? formaterDateFr(d) : d);
        zone.innerHTML = actives.map(r => {
            const f = r.fields || {};
            const horaires = [f['Heure début'], f['Heure fin']].filter(Boolean).join(' – ');
            const periode = (f['Date fin'] && f['Date fin'] !== f['Date début'])
                ? ` (${fmtD(f['Date début'])} → ${fmtD(f['Date fin'])})` : '';
            const infos = [
                f['Position'] ? `📍 ${escapeHtml(f['Position'])}` : '',
                f['Altitude max'] ? `⬆️ max ${escapeHtml(String(f['Altitude max']))}` : '',
                horaires ? `🕐 ${horaires}` : '',
                f['Description'] ? escapeHtml(f['Description']) : ''
            ].filter(Boolean).join(' · ');
            return `<div class="bandeau-sgs">
                <span>📢 <strong>Information</strong>${periode} — ${infos}</span>
                ${peutGererSgs() ? `<button type="button" class="bandeau-sgs-sup" onclick="supprimerInfoSgs('${r.id}')" title="Supprimer cette information">✕</button>` : ''}
            </div>`;
        }).join('');
        zone.style.display = actives.length ? 'flex' : 'none';
    } catch (e) {
        console.warn('Bandeau SGS :', e);
        zone.style.display = 'none';
    }
}

async function supprimerInfoSgs(recordId) {
    if (!peutGererSgs()) return;
    if (!(await confirmerSuppression("Supprimer cette information ?"))) return;
    try {
        const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_SGS_INFOS)}?records[]=${recordId}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error(await res.text());
        await chargerBandeauSgs();
    } catch (e) {
        console.error(e);
        alert("Erreur lors de la suppression.");
    }
}

// --- Modale de saisie ------------------------------------------------------
function initSgsInfo() {
    const btn = document.getElementById('btn-sgs-info');
    const modal = document.getElementById('modale-sgs-info');
    const form = document.getElementById('form-sgs-info');
    const closeBtn = document.getElementById('sgs-info-close');
    if (!btn || !modal || !form) return;

    btn.addEventListener('click', () => {
        if (!peutGererSgs()) { alert("Réservé au délégué SGS."); return; }
        const dateStr = (typeof dateAffichee !== 'undefined' && dateAffichee) ? dateAffichee.toISOString().split('T')[0] : '';
        document.getElementById('sgs-date-debut').value = dateStr;
        document.getElementById('sgs-date-fin').value = '';
        modal.style.display = 'flex';
    });
    closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const fields = {
            'Date début': document.getElementById('sgs-date-debut').value,
            'Date fin': document.getElementById('sgs-date-fin').value || '',
            'Heure début': document.getElementById('sgs-heure-debut').value || '',
            'Heure fin': document.getElementById('sgs-heure-fin').value || '',
            'Position': document.getElementById('sgs-position').value.trim(),
            'Altitude max': document.getElementById('sgs-altitude').value.trim(),
            'Description': document.getElementById('sgs-description').value.trim(),
            'Créé par': typeof nomCompletCourant === 'function' ? nomCompletCourant() : ''
        };
        try {
            const res = await cachedFetch(`${API_BASE}/${encodeURIComponent(TABLE_SGS_INFOS)}`, {
                method: 'POST', headers,
                body: JSON.stringify({ records: [{ fields }] })
            });
            if (!res.ok) throw new Error(await res.text());
            modal.style.display = 'none';
            form.reset();
            if (typeof enregistrerAudit === 'function') {
                await enregistrerAudit('Information SGS', fields['Position'], `Du ${fields['Date début']} au ${fields['Date fin'] || fields['Date début']} | Alt : ${fields['Altitude max']}`, 'SGS');
            }
            await chargerBandeauSgs();
        } catch (err) {
            console.error(err);
            alert("Erreur lors de la publication de l'information.");
        }
    });
}

// Le bandeau se recharge avec le planning (changement de date / d'onglet) :
// on enrobe chargerDonneesPlanning pour rafraîchir le bandeau à chaque fois.
document.addEventListener('DOMContentLoaded', () => {
    initSgsInfo();
    const _origChargerPlan = window.chargerDonneesPlanning;
    if (typeof _origChargerPlan === 'function') {
        window.chargerDonneesPlanning = async function (...args) {
            const r = await _origChargerPlan.apply(this, args);
            chargerBandeauSgs();
            return r;
        };
    }
    // Secours : boutons de navigation de date et onglet planning
    ['btn-prev', 'btn-next', 'tab-planning'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => setTimeout(chargerBandeauSgs, 400));
    });
    chargerBandeauSgs();
});
