// js/api.js

/**
 * Fonction générique pour récupérer les enregistrements d'une table Airtable avec gestion d'erreurs visible
 */
async function fetchAirtableData(tableName, filterFormula = '') {
    try {
        if (!AIRTABLE_PAT || AIRTABLE_PAT.includes('TON_TOKEN')) {
            throw new Error("Le token Airtable (AIRTABLE_PAT) n'est pas configuré dans js/config.js !");
        }
        if (!BASE_ID || BASE_ID.includes('TON_BASE_ID')) {
            throw new Error("L'ID de la base Airtable (BASE_ID) n'est pas configuré dans js/config.js !");
        }

        let url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`;
        if (filterFormula) {
            url += `?filterByFormula=${encodeURIComponent(filterFormula)}`;
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: AIRTABLE_HEADERS
        });

        if (!response.ok) {
            const errDetails = await response.text();
            throw new Error(`Airtable [${tableName}] (Erreur ${response.status}) : ${errDetails}`);
        }

        const data = await response.json();
        return data.records;
    } catch (error) {
        console.error(`Erreur critique Airtable sur la table ${tableName} :`, error);
        
        const activeContainer = document.getElementById('planning-view-content') && document.getElementById('planning-view-content').style.display !== 'none' 
            ? document.getElementById('planning-view-content') 
            : document.getElementById('aeronefs-view-content');
            
        if (activeContainer) {
            activeContainer.innerHTML = `
                <div style="background: #fee2e2; border: 1px solid #ef4444; color: #991b1b; padding: 20px; border-radius: 8px; margin: 20px;">
                    <h3>Erreur de chargement Airtable</h3>
                    <p>Impossible de récupérer la table <strong>${tableName}</strong>.</p>
                    <p style="font-family: monospace; background: #f8fafc; padding: 10px; border-radius: 4px;">${error.message}</p>
                    <p style="font-size: 0.9rem; margin-top: 10px;">Vérifie le nom de ta table dans Airtable et tes identifiants dans <code>js/config.js</code>.</p>
                </div>
            `;
        }
        return [];
    }
}

/**
 * Fonction pour créer un nouvel enregistrement sur Airtable
 */
async function createAirtableRecord(tableName, fieldsData) {
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: AIRTABLE_HEADERS,
            body: JSON.stringify({ fields: fieldsData })
        });

        if (!response.ok) {
            const errDetails = await response.text();
            throw new Error(`Erreur de création Airtable [${tableName}] (${response.status}) : ${errDetails}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`Erreur lors de la création dans ${tableName} :`, error);
        throw error;
    }
}

/**
 * Fonction pour mettre à jour un enregistrement existant sur Airtable
 */
async function updateAirtableRecord(tableName, recordId, fieldsData) {
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}/${recordId}`;
        const response = await fetch(url, {
            method: 'PATCH',
            headers: AIRTABLE_HEADERS,
            body: JSON.stringify({ fields: fieldsData })
        });

        if (!response.ok) {
            const errDetails = await response.text();
            throw new Error(`Erreur de mise à jour Airtable [${tableName}] (${response.status}) : ${errDetails}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`Erreur lors de la mise à jour de l'enregistrement ${recordId} dans ${tableName} :`, error);
        throw error;
    }
}

/**
 * Fonction pour supprimer un enregistrement sur Airtable
 */
async function deleteAirtableRecord(tableName, recordId) {
    try {
        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}/${recordId}`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: AIRTABLE_HEADERS
        });

        if (!response.ok) {
            const errDetails = await response.text();
            throw new Error(`Erreur de suppression Airtable [${tableName}] (${response.status}) : ${errDetails}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`Erreur lors de la suppression de l'enregistrement ${recordId} dans ${tableName} :`, error);
        throw error;
    }
}