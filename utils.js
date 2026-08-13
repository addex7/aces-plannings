/* ==========================================================================
   UTILITAIRES - FONCTIONS COMMUNES
   ========================================================================== */

// Coordonnées GPS de LFOY (Le Havre - Octeville / Saint-Romain)
const LFOY_LAT = 49.533;
const LFOY_LON = 0.088;

// --- FORMATAGE DU NOM DU PILOTE (ex: Benjamin Q.) ---
function formaterNomPilote(nomComplet) {
    if (!nomComplet) return '';
    const chaine = nomComplet.trim();
    if (!chaine) return '';

    if (chaine.startsWith('🎯') || chaine.startsWith('VI')) {
        return chaine;
    }

    const parties = chaine.split(/\s+/);
    if (parties.length === 1) {
        return parties[0];
    }

    let prenom = '';
    let nom = '';

    if (parties[0] === parties[0].toUpperCase() && parties[0].length > 1) {
        nom = parties[0];
        prenom = parties.slice(1).join(' ');
    } else {
        prenom = parties[0];
        nom = parties.slice(1).join(' ');
    }

    const initialeNom = nom.charAt(0).toUpperCase();
    return `${prenom} ${initialeNom}.`;
}

function nomPiloteCourant() {
    if (typeof currentUser === 'undefined' || !currentUser) return '';
    const prenom = currentUser.prenom || '';
    const nom = currentUser.nom || '';
    return formaterNomPilote(`${prenom} ${nom}`.trim());
}

// --- CALCUL ASTRONOMIQUE DES HEURES SOLAIRES (LFOY) ---
function calculerSoleilLFOY(date) {
    const lat = LFOY_LAT;
    const lon = LFOY_LON;
    
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay);
    const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
    
    const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
    const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
    let cosHA = Math.cos(90.833 * Math.PI / 180) / (Math.cos(lat * Math.PI / 180) * Math.cos(decl)) - Math.tan(lat * Math.PI / 180) * Math.tan(decl);
    cosHA = Math.min(1, Math.max(-1, cosHA));
    
    const ha = Math.acos(cosHA);
    const haDeg = ha * 180 / Math.PI;
    const offsetHeures = -date.getTimezoneOffset() / 60;
    const sunriseUTC = 720 - 4 * (lon + haDeg) - eqtime;
    const sunsetUTC = 720 - 4 * (lon - haDeg) - eqtime;
    const srDecimal = (sunriseUTC / 60) + offsetHeures; 
    const ssDecimal = (sunsetUTC / 60) + offsetHeures;  
    return {
        aubeAero: srDecimal - 0.5,       
        leverSoleil: srDecimal,          
        coucherSoleil: ssDecimal,        
        crepusculeAero: ssDecimal + 0.5  
    };
}

function genererFondNuitHTML(dateCible) {
    const soleil = calculerSoleilLFOY(dateCible);
    
    const pctFinNuitMatin = (Math.max(0, soleil.leverSoleil) / 24) * 100;
    const pctFinNuitAeroMatin = (Math.max(0, soleil.aubeAero) / 24) * 100;

    const pctDebutNuitAeroSoir = (Math.min(24, soleil.crepusculeAero) / 24) * 100;
    const pctDebutNuitSoir = (Math.min(24, soleil.coucherSoleil) / 24) * 100;

    return `
        <div class="night-overlay-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;">
            <div style="position: absolute; left: 0%; width: ${pctFinNuitAeroMatin}%; height: 100%; 
                        background: repeating-linear-gradient(-45deg, rgba(30, 61, 89, 0.12), rgba(30, 61, 89, 0.12) 6px, rgba(240, 244, 248, 0.4) 6px, rgba(240, 244, 248, 0.4) 12px);">
            </div>
            <div style="position: absolute; left: ${pctFinNuitAeroMatin}%; width: ${pctFinNuitMatin - pctFinNuitAeroMatin}%; height: 100%; 
                        background: repeating-linear-gradient(-45deg, rgba(30, 61, 89, 0.22), rgba(30, 61, 89, 0.22) 6px, rgba(186, 215, 233, 0.45) 6px, rgba(186, 215, 233, 0.45) 12px); 
                        border-right: 1px dashed #1e3d59;">
            </div>
            <div style="position: absolute; left: ${pctDebutNuitSoir}%; width: ${pctDebutNuitAeroSoir - pctDebutNuitSoir}%; height: 100%; 
                        background: repeating-linear-gradient(-45deg, rgba(30, 61, 89, 0.22), rgba(30, 61, 89, 0.22) 6px, rgba(186, 215, 233, 0.45) 6px, rgba(186, 215, 233, 0.45) 12px); 
                        border-left: 1px dashed #1e3d59;">
            </div>
            <div style="position: absolute; left: ${pctDebutNuitAeroSoir}%; width: ${100 - pctDebutNuitAeroSoir}%; height: 100%; 
                        background: repeating-linear-gradient(-45deg, rgba(30, 61, 89, 0.12), rgba(30, 61, 89, 0.12) 6px, rgba(240, 244, 248, 0.4) 6px, rgba(240, 244, 248, 0.4) 12px);">
            </div>
        </div>
    `;
}

function formaterPourInput(dateObjet) {
    const tzoffset = dateObjet.getTimezoneOffset() * 60000;
    return (new Date(dateObjet - tzoffset)).toISOString().slice(0, 16);
}

function minutesToTimeString(totalMinutes) {
    let hrs = Math.floor(totalMinutes / 60) % 24;
    let mins = Math.round(totalMinutes % 60);
    if (mins === 60) { hrs = (hrs + 1) % 24; mins = 0; }
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

function convertirHeureEnHHMM(decimalHeure) {
    const heures = Math.floor(decimalHeure);
    const minutes = Math.round((decimalHeure - heures) * 60);
    return `${String(heures).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function afficherConflitsReservations(barresInfos) {
    if (!Array.isArray(barresInfos) || barresInfos.length < 2) return;
    for (let i = 0; i < barresInfos.length; i++) {
        for (let j = i + 1; j < barresInfos.length; j++) {
            const a = barresInfos[i];
            const b = barresInfos[j];
            const chevauchementDebut = Math.max(a.debut, b.debut);
            const chevauchementFin = Math.min(a.fin, b.fin);
            if (chevauchementFin > chevauchementDebut) {
                const dureeConflit = chevauchementFin - chevauchementDebut;
                function ajouterOverlay(barInfo) {
                    const dureeBar = barInfo.fin - barInfo.debut;
                    const overlay = document.createElement('div');
                    overlay.className = 'conflit-overlay';
                    overlay.style.position = 'absolute';
                    overlay.style.top = '0';
                    overlay.style.left = `${((chevauchementDebut - barInfo.debut) / dureeBar) * 100}%`;
                    overlay.style.width = `${(dureeConflit / dureeBar) * 100}%`;
                    overlay.style.height = '100%';
                    overlay.style.backgroundColor = 'rgba(255, 255, 0, 0.55)';
                    overlay.style.pointerEvents = 'none';
                    overlay.style.zIndex = '1';
                    overlay.style.border = '1px dashed #c0392b';
                    overlay.style.display = 'flex';
                    overlay.style.alignItems = 'center';
                    overlay.style.justifyContent = 'center';
                    overlay.title = `Conflit horaire de ${convertirHeureEnHHMM(chevauchementDebut)} à ${convertirHeureEnHHMM(chevauchementFin)}`;
                    overlay.innerHTML = '<span style="font-size:14px; pointer-events:none;">⚠️</span>';
                    barInfo.bar.insertBefore(overlay, barInfo.bar.firstChild);
                }
                ajouterOverlay(a);
                ajouterOverlay(b);
                a.bar.title = (a.bar.title ? a.bar.title + ' | ' : '') + 'Conflit horaire détecté';
                b.bar.title = (b.bar.title ? b.bar.title + ' | ' : '') + 'Conflit horaire détecté';
            }
        }
    }
}

// --- CACHE POUR REQUÊTES AIRTABLE (GET) ---
const API_CACHE = {};
const API_CACHE_TTL = 30000; // 30 secondes

function viderApiCache() {
    Object.keys(API_CACHE).forEach(k => delete API_CACHE[k]);
}

async function cachedFetch(url, options = {}, ttl = API_CACHE_TTL, force = false) {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && !force) {
        const now = Date.now();
        const entry = API_CACHE[url];
        if (entry && (now - entry.ts) < ttl) {
            return {
                ok: true,
                status: 200,
                json: () => Promise.resolve(entry.data)
            };
        }
    }
    if (method !== 'GET') viderApiCache();
    const res = await fetch(url, options);
    const data = await res.json();
    if (method === 'GET' && res.ok) API_CACHE[url] = { data, ts: Date.now() };
    return { ok: res.ok, status: res.status, json: () => Promise.resolve(data) };
}
