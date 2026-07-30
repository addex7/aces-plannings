/* ==========================================================================
   CONFIG.JS - Configuration Globale & Constants
   ========================================================================== */

export const AIRTABLE_PAT = "patbX51fRBLO4v35h.e116a6e20d699408c3a49d07137099bbaf3fe23e734767dea63fa5d890508fff";
export const BASE_ID = "appufjvD3gYG6H44n";

export const HEADERS = { 
    Authorization: `Bearer ${AIRTABLE_PAT}`,
    "Content-Type": "application/json"
};

// Coordonnées GPS de LFOY (Le Havre - Octeville / Saint-Romain)
export const LFOY_LAT = 49.533;
export const LFOY_LON = 0.088;