const AIRTABLE_PAT = "patbX51fRBLO4v35h.e116a6e20d699408c3a49d07137099bbaf3fe23e734767dea63fa5d890508fff";
const BASE_ID = "appufjvD3gYG6H44n";
const headers = { 
    Authorization: `Bearer ${AIRTABLE_PAT}`,
    "Content-Type": "application/json"
};

async function chargerTableauDeBordMaintenance() {
    const container = document.getElementById('maintenance-dashboard');
    if (!container) return;

    try {
        // 1. Récupérer les données des avions et des réservations
        const resAvions = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}`, { headers });
        const dataAvions = await resAvions.json();
        
        const resReservations = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}`, { headers });
        const dataReservations = await resReservations.json();

        container.innerHTML = ""; // Vider le loader

        if (!dataAvions.records) {
            container.innerHTML = "<div class='loading'>Aucune machine trouvée.</div>";
            return;
        }

        // 2. Traiter chaque avion
        dataAvions.records.forEach(avion => {
            if (!avion.fields) return;

            const avionId = avion.id;
            const immatriculation = avion.fields['Immatriculation'] || 'Inconnue';
            const horametreActuel = parseFloat(avion.fields['Horamètre actuel']) || 0;
            const prochaineButee = parseFloat(avion.fields['Prochaine Butée']) || 0;
            
            // Potentiel réel physique actuel (Formule Airtable)
            const potentielReel = prochaineButee - horametreActuel;

            // 3. Sommer toutes les estimations de vols futurs ou passés enregistrés pour cet avion
            const totalHeuresEstimees = dataReservations.records
                .filter(res => res.fields && res.fields['Machine'] && res.fields['Machine'].includes(avionId))
                .reduce((somme, res) => somme + (parseFloat(res.fields['Temps estimé']) || 0), 0);

            // 4. Calculer le potentiel prédictif final
            const potentielPredictif = potentielReel - totalHeuresEstimees;

            // Déterminer les couleurs et messages d'alerte pour le prédictif
            let couleurBarre = "bg-green";
            let alerteClass = "green";
            let alerteTexte = `✅ Potentiel suffisant pour honorer les vols programmés.`;

            if (potentielPredictif <= 5) {
                couleurBarre = "bg-red";
                alerteClass = "red";
                alerteTexte = `🚨 ATTENTION : Suite aux réservations des pilotes, la machine va dépasser sa butée dans ${potentielPredictif.toFixed(1)}h ! Planifier l'atelier d'urgence.`;
            } else if (potentiefPredictif <= 15) {
                couleurBarre = "bg-orange";
                alerteClass = "orange";
                alerteTexte = `⚠️ À PRÉVOIR : Le potentiel prédictif descend à ${potentielPredictif.toFixed(1)}h. Contactez le responsable mécanique.`;
            }

            // Calcul du pourcentage restant pour la barre de progression visuelle (basé sur un cycle standard de 50h)
            const pourcentageVisuel = Math.max(0, Math.min(100, (potentielPredictif / 50) * 100));

            // 5. Générer la carte HTML de la machine
            const card = document.createElement('div');
            card.className = 'aircraft-maintenance-card';

            card.innerHTML = `
                <div class="aircraft-header">
                    <div class="aircraft-title">✈️ ${immatriculation}</div>
                </div>
                
                <div class="aircraft-stats-grid">
                    <div class="stat-box">
                        <div class="stat-label">POTENTIEL RÉEL ACTUEL (Cellule)</div>
                        <div class="stat-value" style="color: #2563eb;">${potentielReel.toFixed(1)} h</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-label">TOTAL HEURES PLANIFIÉES (Pilotes)</div>
                        <div class="stat-value" style="color: #7c3aed;">${totalHeuresEstimees.toFixed(1)} h</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-label">POTENTIEL PRÉDICTIF RESTANT</div>
                        <div class="stat-value" style="color: ${potentielPredictif <= 5 ? '#dc2626' : (potentielPredictif <= 15 ? '#d97706' : '#16a34a')};">
                            ${potentielPredictif.toFixed(1)} h
                        </div>
                    </div>
                </div>

                <div class="progress-container">
                    <div class="progress-label">Consommation prévisionnelle du potentiel (Butée théorique à 50h) :</div>
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill ${couleurBarre}" style="width: ${pourcentageVisuel}%"></div>
                    </div>
                </div>

                <div class="alert-banner ${alerteClass}">
                    ${alerteTexte}
                </div>
            `;

            container.appendChild(card);
        });

    } catch (error) {
        console.error("Erreur lors du chargement du tableau de bord :", error);
        container.innerHTML = "<div class='loading'>Erreur lors du calcul des potentiels. Vérifiez la console.</div>";
    }
}

// Lancement au chargement de la page
document.addEventListener('DOMContentLoaded', chargerTableauDeBordMaintenance);