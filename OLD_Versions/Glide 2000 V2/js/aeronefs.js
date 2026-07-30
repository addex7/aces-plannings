// js/aeronefs.js
async function initAeronefsView() {
    const container = document.getElementById('aeronefs-view-content');
    if (!container) return;

    container.innerHTML = `<p style="padding: 20px; font-style: italic;">Chargement des potentiels...</p>`;

    const avions = await fetchAirtableData('Aéronefs');
    listeAvionsCache = avions;

    let html = `
        <div class="view-header">
            <h1>Suivi du Potentiel & Maintenance</h1>
            <div class="date-navigator">
                <span>Prévisionnel sur 14 jours</span>
            </div>
        </div>

        <div class="legend-box">
            <div class="legend-item"><div class="legend-green"></div> OK</div>
            <div class="legend-item"><div class="legend-yellow"></div> Alerte révision</div>
            <div class="legend-item"><div class="legend-red"></div> Dépassement</div>
        </div>

        <div class="planning-card">
            <table class="aeronefs-timeline-table" style="width:100%; border-collapse: collapse; text-align: left;">
                <thead>
                    <tr style="border-bottom: 2px solid #e2e8f0;">
                        <th style="padding: 12px;">Immatriculation</th>
                        <th style="padding: 12px;">Statut</th>
                        <th style="padding: 12px;">Horamètre actuel</th>
                        <th style="padding: 12px;">Prochaine Butée</th>
                        <th style="padding: 12px;">Potentiel Restant</th>
                        <th style="padding: 12px;">Alerte Maintenance</th>
                    </tr>
                </thead>
                <tbody>
    `;

    if (!avions || avions.length === 0) {
        html += `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 20px;">Aucune donnée d'aéronef trouvée.</td></tr>`;
    } else {
        avions.forEach(avion => {
            let f = avion.fields;
            let immat = f.Immatriculation || '-';
            let statut = f.Statut || '-';
            let horametre = f['Horamètre actuel'] !== undefined ? f['Horamètre actuel'] : '-';
            let butee = f['Prochaine Butée'] !== undefined ? f['Prochaine Butée'] : '-';
            let potentielRestant = f['Potentiel restant'] !== undefined ? f['Potentiel restant'] + ' h' : '-';
            let alerte = f['Alerte Maintenance'] || 'OK';

            let badgeStyle = alerte.includes('OK') ? 'background:#dcfce7; color:#166534;' : 'background:#fef9c3; color:#854d0e;';

            html += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px;"><strong>${immat}</strong></td>
                    <td style="padding: 12px;">${statut}</td>
                    <td style="padding: 12px;">${horametre} h</td>
                    <td style="padding: 12px;">${butee} h</td>
                    <td style="padding: 12px; font-weight: bold;">${potentielRestant}</td>
                    <td style="padding: 12px;"><span style="padding:4px 10px; border-radius:12px; font-size:0.85rem; font-weight:bold; ${badgeStyle}">${alerte}</span></td>
                </tr>
            `;
        });
    }

    html += `
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}