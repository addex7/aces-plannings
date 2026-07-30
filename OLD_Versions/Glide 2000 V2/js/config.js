// js/config.js

// Tes identifiants Airtable récupérés de ton ancienne version
const AIRTABLE_PAT = 'patJP9u2R0aAapiMk.e61c63109ef017e0f9e6557f2dcf4cd104f3140d4c22ccd35974224963e56f50';
const BASE_ID = 'appufjvD3gYG6H44n';

const AIRTABLE_HEADERS = {
    'Authorization': `Bearer ${AIRTABLE_PAT}`,
    'Content-Type': 'application/json'
};

// Variables globales partagées
let dateAffichee = new Date().toISOString().split('T')[0];
let listeAvionsCache = [];
let reservationsCache = [];