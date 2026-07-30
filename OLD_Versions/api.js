/* ==========================================================================
   API.JS - Services de communication avec Airtable
   ========================================================================== */

import { BASE_ID, HEADERS } from './config.js';

// Récupérer la liste des aéronefs
export async function fetchAeronefs() {
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Aéronefs')}`, { headers: HEADERS });
    const data = await res.json();
    return data.records || [];
}

// Récupérer la liste des réservations
export async function fetchReservations() {
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}`, { headers: HEADERS });
    const data = await res.json();
    return data.records || [];
}

// Créer ou modifier une réservation
export async function saveReservation(recordData, isEdition = false) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}`;
    const methode = isEdition ? 'PATCH' : 'POST';
    
    return await fetch(url, {
        method: methode,
        headers: HEADERS,
        body: JSON.stringify({ records: [recordData] })
    });
}

// Déplacer / Redimensionner rapidement une réservation
export async function updateReservationDates(reservationId, fields) {
    return await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}`, {
        method: 'PATCH',
        headers: HEADERS,
        body: JSON.stringify({ records: [{ id: reservationId, fields }] })
    });
}

// Supprimer une réservation
export async function deleteReservation(reservationId) {
    return await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Réservations')}?records[]=${reservationId}`, {
        method: 'DELETE',
        headers: HEADERS
    });
}

// Récupérer les présences planeur
export async function fetchPresencesPlaneur(dateIsoStr) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Planeur')}?filterByFormula=IS_SAME({Date}, '${dateIsoStr}', 'day')`;
    const res = await fetch(url, { headers: HEADERS });
    const data = await res.json();
    return data.records || [];
}

// S'inscrire planeur
export async function addPresencePlaneur(nom, role, dateIsoStr) {
    return await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Planeur')}`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ records: [{ fields: { "Nom du pilote": nom, "Rôle": role, "Date": dateIsoStr } }] })
    });
}

// Supprimer présence planeur
export async function removePresencePlaneur(recordId) {
    return await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Présences Planeur')}?records[]=${recordId}`, {
        method: 'DELETE',
        headers: HEADERS
    });
}