/* ==========================================================================
   UTILITAIRES - FONCTIONS COMMUNES
   ========================================================================== */

// Coordonnées GPS de LFOY (Le Havre - Octeville / Saint-Romain)
const LFOY_LAT = 49.533;
const LFOY_LON = 0.088;

function normaliserNom(n) {
    return (n || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function correspondanceNom(a, b) {
    const na = normaliserNom(a);
    const nb = normaliserNom(b);
    if (!na || !nb) return false;
    return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

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
    
    const pctFinNuitAeroMatin = positionHeure(Math.max(0, soleil.aubeAero));
    const pctFinNuitMatin = positionHeure(Math.max(0, soleil.leverSoleil));
    const pctDebutNuitSoir = positionHeure(Math.min(24, soleil.coucherSoleil));
    const pctDebutNuitAeroSoir = positionHeure(Math.min(24, soleil.crepusculeAero));

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

const LARGEURS_HEURES = [2,2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,2,2];
const TOTAL_LARGEUR_HEURES = LARGEURS_HEURES.reduce((a,b)=>a+b,0);

function positionHeure(decimalHeure) {
    if (decimalHeure <= 0) return 0;
    if (decimalHeure >= 24) return 100;
    const h = Math.floor(decimalHeure);
    const fraction = decimalHeure - h;
    let cumul = 0;
    for (let i = 0; i < h; i++) cumul += LARGEURS_HEURES[i];
    cumul += LARGEURS_HEURES[h] * fraction;
    return (cumul / TOTAL_LARGEUR_HEURES) * 100;
}

function positionHeureInverse(pourcentage) {
    if (pourcentage <= 0) return 0;
    if (pourcentage >= 100) return 24;
    const cible = (pourcentage / 100) * TOTAL_LARGEUR_HEURES;
    let cumul = 0;
    for (let h = 0; h < 24; h++) {
        if (cumul + LARGEURS_HEURES[h] >= cible) {
            const fraction = (cible - cumul) / LARGEURS_HEURES[h];
            return h + fraction;
        }
        cumul += LARGEURS_HEURES[h];
    }
    return 24;
}

function creerWrapperCellulesGrille(gridBg) {
    const wrapper = document.createElement('div');
    wrapper.className = 'hours-grid-cells';
    gridBg.appendChild(wrapper);
    return wrapper;
}

function formaterDateHeureLocal(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
                    const largeurBar = positionHeure(barInfo.fin) - positionHeure(barInfo.debut);
                    const overlay = document.createElement('div');
                    overlay.className = 'conflit-overlay';
                    overlay.style.position = 'absolute';
                    overlay.style.top = '0';
                    overlay.style.left = `${((positionHeure(chevauchementDebut) - positionHeure(barInfo.debut)) / largeurBar) * 100}%`;
                    overlay.style.width = `${((positionHeure(chevauchementFin) - positionHeure(chevauchementDebut)) / largeurBar) * 100}%`;
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
                json: () => Promise.resolve(entry.data),
                text: () => Promise.resolve(typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data))
            };
        }
    }
    if (method !== 'GET') viderApiCache();
    const res = await fetch(url, options);
    const data = await res.json();
    if (method === 'GET' && res.ok) API_CACHE[url] = { data, ts: Date.now() };
    return {
        ok: res.ok,
        status: res.status,
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data))
    };
}

// --- RECHERCHE PAR FRAPPE DANS LES <select> ---
// Tapez les premières lettres d'une option pour y sauter directement.
(function initRechercheSelects() {
    let buffer = '';
    let resetTimer = null;
    let changeTimer = null;
    const RESET_DELAY = 1200;
    const CHANGE_DELAY = 400;

    const normaliser = (s) => (s || '').toString().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
    const mots = (s) => (s || '').toString().trim().split(/\s+/).filter(Boolean);
    const matchNom = (text, recherche) => {
        const words = mots(text);
        // Plusieurs mots : on cherche dans le(s) mot(s) suivant(s) le premier (nom de famille)
        const cibles = words.length > 1 ? words.slice(1) : words;
        return cibles.some(w => normaliser(w).startsWith(recherche));
    };

    document.addEventListener('keydown', (e) => {
        const select = e.target;
        if (!(select instanceof HTMLSelectElement)) return;
        if (select.multiple || select.disabled) return;
        if (e.altKey || e.ctrlKey || e.metaKey) return;

        const key = e.key;
        if (key === 'Backspace' || key === 'Delete') {
            e.preventDefault();
            buffer = buffer.slice(0, -1);
        } else if (key.length === 1 && key !== ' ') {
            e.preventDefault();
            buffer += key;
        } else {
            return;
        }

        const recherche = normaliser(buffer);
        const options = Array.from(select.options);
        if (recherche && options.length) {
            const idx = options.findIndex(o => matchNom(o.text, recherche));
            if (idx >= 0 && select.selectedIndex !== idx) {
                select.selectedIndex = idx;
                clearTimeout(changeTimer);
                changeTimer = setTimeout(() => {
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }, CHANGE_DELAY);
            }
        }

        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => { buffer = ''; }, RESET_DELAY);
    }, true);
})();

// --- SELECT PERSONNALISE AVEC RECHERCHE (liste complète + champ filtre) ---
function rendreSelectRecherchable(select, allowCustom = false) {
    if (typeof select === 'string') select = document.getElementById(select);
    if (!select || select.dataset.searchReady) return;
    if (select.multiple || select.size > 1) return;
    select.dataset.searchReady = '1';
    select.removeAttribute('required');
    select.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = 'select-recherche';
    wrap.style.cssText = 'position:relative; display:inline-block; min-width:200px; max-width:100%;';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'width:100%; padding:8px 28px 8px 12px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; color:#1e3d59; font-size:14px; text-align:left; cursor:pointer; position:relative; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';

    const caret = document.createElement('span');
    caret.textContent = '▾';
    caret.style.cssText = 'position:absolute; right:10px; top:50%; transform:translateY(-50%); opacity:.5; pointer-events:none;';
    btn.appendChild(caret);

    const panel = document.createElement('div');
    panel.style.cssText = 'display:none; position:absolute; top:calc(100% + 4px); left:0; min-width:100%; width:max-content; max-width:320px; background:#fff; border:1px solid #cbd5e1; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.15); z-index:10000; overflow:hidden;';

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Rechercher...';
    search.autocomplete = 'off';
    search.style.cssText = 'width:100%; padding:8px 12px; border:none; border-bottom:1px solid #e2e8f0; font-size:14px; box-sizing:border-box; outline:none;';

    const list = document.createElement('div');
    list.style.cssText = 'max-height:240px; overflow-y:auto;';

    panel.appendChild(search);
    panel.appendChild(list);
    select.parentElement.insertBefore(wrap, select);
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    wrap.appendChild(select);

    const norm = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const label = () => {
        const o = select.options[select.selectedIndex];
        return o ? o.text : '— Choisir —';
    };
    const majBtn = () => {
        const text = document.createTextNode(label() + ' ');
        const span = document.createElement('span');
        span.textContent = '▾';
        span.style.cssText = 'float:right; opacity:.5;';
        btn.innerHTML = '';
        btn.appendChild(text);
        btn.appendChild(span);
        btn.disabled = select.disabled;
    };

    const renderList = (filtre = '') => {
        const f = norm(filtre);
        list.innerHTML = '';
        let count = 0;
        [...select.options].forEach(o => {
            const txt = o.text;
            if (f && !norm(txt).includes(f)) return;
            const item = document.createElement('div');
            item.style.cssText = 'padding:8px 12px; cursor:pointer; font-size:14px; color:#1e3d59; white-space:nowrap;';
            item.textContent = txt;
            if (o.value === select.value) item.style.background = '#eff6ff';
            item.addEventListener('mouseenter', () => { if (o.value !== select.value) item.style.background = '#f1f5f9'; });
            item.addEventListener('mouseleave', () => { item.style.background = (o.value === select.value) ? '#eff6ff' : ''; });
            item.addEventListener('click', () => {
                select.value = o.value;
                majBtn();
                select.dispatchEvent(new Event('change', { bubbles: true }));
                fermer();
            });
            list.appendChild(item);
            count++;
        });
        if (allowCustom && filtre.trim()) {
            const exact = [...select.options].some(o => norm(o.text) === f);
            if (!exact) {
                const addItem = document.createElement('div');
                addItem.style.cssText = 'padding:8px 12px; cursor:pointer; font-size:14px; color:#1e3d59; white-space:nowrap; border-top:1px solid #e2e8f0; font-style:italic;';
                addItem.textContent = `+ "${filtre.trim()}"`;
                addItem.addEventListener('mouseenter', () => { addItem.style.background = '#f1f5f9'; });
                addItem.addEventListener('mouseleave', () => { addItem.style.background = ''; });
                addItem.addEventListener('click', () => {
                    const val = filtre.trim();
                    let opt = [...select.options].find(o => o.value === val);
                    if (!opt) {
                        opt = document.createElement('option');
                        opt.value = val;
                        opt.textContent = val;
                        select.appendChild(opt);
                    }
                    select.value = val;
                    majBtn();
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    fermer();
                });
                list.appendChild(addItem);
                count++;
            }
        }
        if (!count) list.innerHTML = '<div data-empty="1" style="padding:10px 12px; color:#94a3b8; font-size:13px;">Aucun résultat</div>';
    };

    const ouvrir = () => { panel.style.display = 'block'; search.value = ''; renderList(); setTimeout(() => search.focus(), 0); };
    const fermer = () => { panel.style.display = 'none'; };

    btn.addEventListener('click', (e) => { e.stopPropagation(); panel.style.display === 'none' ? ouvrir() : fermer(); });
    search.addEventListener('input', () => renderList(search.value));
    search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); fermer(); btn.focus(); }
        if (e.key === 'Enter') {
            e.preventDefault();
            const first = list.querySelector('div');
            if (first && !first.dataset.empty) first.click();
        }
    });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) fermer(); });
    select.addEventListener('change', majBtn);
    new MutationObserver(majBtn).observe(select, { childList: true });
    majBtn();
}

// Appliquer la recherche aux selects de noms dans les principaux onglets
(function initSelectsRecherche() {
    const ids = [
        'comptes-pilote-select',
        'accueil-select-membre',
        'select-inscrire-autre',
        'form-pilote',
        'form-instructeur',
        'carnet-pilote',
        'carnet-instructeur',
        'select-instructeur-suivi'
    ];

    function essayer() {
        ids.forEach(id => rendreSelectRecherchable(id, id === 'carnet-pilote'));
        if (ids.some(id => document.getElementById(id) && !document.getElementById(id).dataset.searchReady)) {
            setTimeout(essayer, 500);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', essayer);
    } else {
        essayer();
    }
})();
