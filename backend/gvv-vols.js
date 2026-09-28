/* ==========================================================================
   ENVOI D'UN VOL DU CARNET DE ROUTE VERS GVV (vols_avion)
   Appele par POST /v0/:base/gvv-vol dans server.js.

   GVV facture automatiquement le vol sur le compte du payeur ; la synchro
   nocturne reimporte ensuite les soldes/ecritures dans le site.
   ========================================================================== */

const cheerio = require('cheerio');
const { GvvClient } = require('./gvv-client');

// Matching tolerant "NOM Prenom" (GVV) <-> "Prenom Nom" (site) : memes
// regles que normaliserNomGvv/cleNomGvvLettres dans comptes.js.
function normaliserNomGvv(s) {
    return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/[^A-Z\s-]/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');
}

function cleNomGvvLettres(s) {
    return normaliserNomGvv(s).replace(/[\s-]/g, '').split('').sort().join('');
}

function memeNomGvv(a, b) {
    return normaliserNomGvv(a) === normaliserNomGvv(b) || cleNomGvvLettres(a) === cleNomGvvLettres(b);
}

function dateIsoVersFr(val) {
    const m = String(val || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function dureeTexteEnMinutes(str) {
    const m = String(str || '').match(/(\d+)\s*h\s*(\d+)/i);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

// Horametre au format "H.MM" (F-JVIO : 1181.51 = 1181 h 51 min) -> minutes
function hhmmVersMinutes(val) {
    const n = parseFloat(String(val).replace(',', '.'));
    if (isNaN(n)) return null;
    const h = Math.floor(n);
    return h * 60 + Math.round((n - h) * 100);
}

// minutes -> format "H.MM"
function minutesVersHHMM(min) {
    return Math.floor(min / 60) + (Math.round(min % 60) / 100);
}

// Lit le formulaire de saisie GVV : champs caches, listes de comptes, machines
async function chargerFormulaireVolAvion(client) {
    const res = await client.get('/index.php/vols_avion/create');
    if (res.status !== 200) throw new Error(`Formulaire vols_avion inaccessible (HTTP ${res.status})`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const hidden = {};
    const horametresEnMin = {};
    $('input[type="hidden"]').each((_, el) => {
        const name = $(el).attr('name') || '';
        const value = $(el).attr('value') || '';
        const m = name.match(/^horametres_en_min\[(.+)\]$/);
        if (m) { horametresEnMin[m[1]] = value === '1'; return; }
        if (name === 'machines[]') return;
        if (!(name in hidden)) hidden[name] = value;
    });
    const machines = $('input[name="machines[]"]').map((_, el) => $(el).attr('value')).get();
    const selects = {};
    ['vapilid', 'vainst', 'payeur'].forEach(name => {
        selects[name] = $(`select[name="${name}"] option`).map((_, o) => ({
            login: ($(o).attr('value') || '').trim(),
            nom: ($(o).text() || '').trim()
        })).get().filter(o => o.login);
    });
    return { hidden, horametresEnMin, machines, selects };
}

// Nom affiche GVV -> login (compte), avec tolerance accents/espacement
function resoudreLogin(options, nom) {
    const trouves = (options || []).filter(o => o.login && memeNomGvv(o.nom, nom));
    if (trouves.length === 1) return { login: trouves[0].login, nomGvv: trouves[0].nom };
    if (trouves.length > 1) {
        return { erreur: `« ${nom} » correspond à plusieurs comptes GVV (${trouves.map(t => t.nom).join(', ')})` };
    }
    return { erreur: `« ${nom} » introuvable dans les comptes GVV` };
}

// Dernier compteur de fin connu pour la machine dans la liste des vols GVV
async function dernierCompteurMachine(client, immat) {
    const res = await client.get('/index.php/vols_avion/page');
    const html = await res.text();
    const $ = cheerio.load(html);
    let trouve = null;
    $('tr').each((_, tr) => {
        if (trouve !== null) return;
        const tds = $(tr).find('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
        if (tds.length < 7 || !/^\d{2}\/\d{2}\/\d{4}$/.test(tds[0])) return;
        const idx = tds.indexOf(immat);
        if (idx < 0) return;
        const fin = parseFloat((tds[idx + 2] || '').replace(',', '.'));
        if (!isNaN(fin)) trouve = fin;
    });
    return trouve;
}

// Retrouve l'id GVV du vol qui vient d'etre cree (comparaison sur les compteurs)
async function trouverVolCree(client, attendu) {
    const res = await client.get('/index.php/vols_avion/page');
    const html = await res.text();
    const $ = cheerio.load(html);
    let id = null;
    $('tr').each((_, tr) => {
        if (id) return;
        const tds = $(tr).find('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
        if (tds.length < 7 || tds[0] !== attendu.dateFr || tds.indexOf(attendu.immat) < 0) return;
        const idx = tds.indexOf(attendu.immat);
        const deb = parseFloat((tds[idx + 1] || '').replace(',', '.'));
        const fin = parseFloat((tds[idx + 2] || '').replace(',', '.'));
        if (isNaN(deb) || isNaN(fin)) return;
        if (Math.abs(deb - attendu.deb) > 0.005 || Math.abs(fin - attendu.fin) > 0.005) return;
        if (!memeNomGvv(tds[1] || '', attendu.piloteNomGvv)) return;
        const href = $(tr).find('a[href*="vols_avion/edit/"]').attr('href') || '';
        const m = href.match(/edit\/(\d+)/);
        if (m) id = m[1];
    });
    return id;
}

// fields = champs du record "Carnet de route Pilotes" ; aliasCompteGvv =
// champ "Compte GVV" de la fiche membre (quand le nom GVV differe du site).
async function envoyerVolAvion(fields, aliasCompteGvv) {
    const f = fields || {};
    const machine = (f['Machine'] || '').toString().trim();
    const piloteNom = (aliasCompteGvv || f['Pilote'] || '').toString().trim();
    const instructeurNom = (f['Instructeur'] || '').toString().trim();
    const dateFr = dateIsoVersFr(f['Date']);
    if (!machine) return { ok: false, message: 'Machine non renseignée sur le vol' };
    if (!dateFr) return { ok: false, message: 'Date du vol invalide' };
    if (!piloteNom) return { ok: false, message: 'Pilote non renseigné sur le vol' };

    const client = new GvvClient();
    await client.login();
    const form = await chargerFormulaireVolAvion(client);
    if (!form.machines.includes(machine)) {
        return { ok: false, message: `${machine} n'est pas une machine connue de GVV (${form.machines.join(', ')})` };
    }

    const pilote = resoudreLogin(form.selects.vapilid, piloteNom);
    if (pilote.erreur) return { ok: false, message: `Pilote : ${pilote.erreur}` };

    // Instructeur : la liste GVV est restreinte ; si non trouve on n'en met pas
    let instructeurLogin = '';
    if (instructeurNom) {
        const inst = resoudreLogin(form.selects.vainst, instructeurNom);
        if (inst.login) instructeurLogin = inst.login;
    }

    // Categorie / nature
    const nature = `${f['Nature'] || ''} ${f['Précision activité'] || ''}`.toLowerCase();
    let vacategorie = '0';
    if (/initiation/.test(nature)) vacategorie = '1';
    else if (/remorquage|\brem\b/.test(nature)) vacategorie = '3';
    const fonction = (f['Fonction'] || '').toString();
    const doubleCommande = !!instructeurLogin || /\bEP\b|\bFI\b/.test(fonction);
    const deNuit = /nuit/.test(nature);
    const depart = (f['Départ'] || '').toString().trim().toUpperCase();
    const arrivee = (f['Arrivée'] || '').toString().trim().toUpperCase();
    const navigation = !!(depart && arrivee && depart !== arrivee);
    const nbAtt = parseInt(f['Atterrissages'] ?? f['Décollages'] ?? 1, 10) || 1;
    const observations = (f['Observations'] || '').toString().trim();

    // Payeur : le pilote, sauf vol d'initiation -> compte dedie "VI Avion"
    let payeurLogin = pilote.login;
    let payeurNomGvv = pilote.nomGvv;
    if (vacategorie === '1') {
        const vi = resoudreLogin(form.selects.payeur, 'VI Avion');
        if (vi.login) { payeurLogin = vi.login; payeurNomGvv = vi.nomGvv; }
    }

    // Compteurs horaires : les valeurs saisies dans le carnet sont envoyees
    // telles quelles — GVV gere le format "H.MM" de F-JVIO (horametres_en_min)
    // et calcule la duree en heures decimales.
    const enMinutes = !!form.horametresEnMin[machine];
    const num = (v) => {
        const n = parseFloat(String(v ?? '').replace(',', '.'));
        return isNaN(n) ? null : n;
    };
    let vacdeb = null;
    let vacfin = null;
    const hDep = f['Horamètre départ'];
    const hArr = f['Horamètre arrivée'];
    if (hDep !== undefined && hDep !== null && hDep !== '' && hArr !== undefined && hArr !== null && hArr !== '') {
        vacdeb = num(hDep);
        vacfin = num(hArr);
    }
    const dureeDepuisCompteurs = () => {
        if (vacdeb === null || vacfin === null) return null;
        if (enMinutes) {
            const d = hhmmVersMinutes(vacdeb), a = hhmmVersMinutes(vacfin);
            return (d === null || a === null || a <= d) ? null : Math.round((a - d) / 60 * 100) / 100;
        }
        return vacfin > vacdeb ? Math.round((vacfin - vacdeb) * 100) / 100 : null;
    };
    let vaduree = dureeDepuisCompteurs();
    if (vaduree === null) {
        // Repli : dernier compteur GVV + duree du vol
        let minutes = dureeTexteEnMinutes(f['Temps de vol']);
        if (!minutes) {
            const [hd, md] = String(f['Heure départ'] || '').split(':').map(Number);
            const [ha, ma] = String(f['Heure arrivée'] || '').split(':').map(Number);
            if (!isNaN(hd) && !isNaN(md) && !isNaN(ha) && !isNaN(ma)) {
                minutes = (ha * 60 + ma) - (hd * 60 + md);
                if (minutes < 0) minutes += 24 * 60;
            }
        }
        const dernier = await dernierCompteurMachine(client, machine);
        if (dernier === null || !minutes || minutes <= 0) {
            return { ok: false, message: 'Compteurs horaires non renseignés et impossibles à déduire (durée du vol manquante)' };
        }
        vaduree = Math.round(minutes / 60 * 100) / 100;
        vacdeb = Math.round(dernier * 100) / 100;
        vacfin = enMinutes
            ? minutesVersHHMM(hhmmVersMinutes(vacdeb) + minutes)
            : Math.round((vacdeb + minutes / 60) * 100) / 100;
    }

    const corps = {
        ...form.hidden,
        'machines[]': form.machines,
        vadate: dateFr,
        vamacid: machine,
        vapilid: pilote.login,
        vainst: instructeurLogin,
        vahdeb: '',
        vahfin: '',
        vacdeb: vacdeb.toFixed(2),
        vacfin: vacfin.toFixed(2),
        vaduree: vaduree.toFixed(2),
        vaobs: observations,
        vacategorie,
        vanumvi: '',
        payeur: payeurLogin,
        pourcentage: '0',
        vanbpax: '',
        vaatt: String(nbAtt),
        local: navigation ? '1' : '0',
        valieudeco: depart,
        valieuatt: arrivee,
        reappro: '0',
        essence: '',
        button: 'Enregistrer'
    };
    for (const [immat, enMin] of Object.entries(form.horametresEnMin)) {
        corps[`horametres_en_min[${immat}]`] = enMin ? '1' : '0';
    }
    if (doubleCommande) corps.vadc = '1';
    if (deNuit) corps.nuit = '1';

    const res = await client.postRaw('/index.php/vols_avion/formValidation/1', corps);
    if ([301, 302, 303].includes(res.status)) {
        const gvvId = await trouverVolCree(client, {
            dateFr, immat: machine, deb: vacdeb, fin: vacfin, piloteNomGvv: pilote.nomGvv
        });
        return {
            ok: true,
            gvvId,
            resume: {
                pilote: pilote.nomGvv, payeur: payeurNomGvv, machine, date: dateFr,
                compteurs: `${vacdeb.toFixed(2)} → ${vacfin.toFixed(2)}`,
                duree: vaduree, instructeur: instructeurLogin || null,
                categorie: vacategorie
            }
        };
    }
    // Echec : le formulaire est reaffiche avec les erreurs de validation
    const html = await res.text();
    const $ = cheerio.load(html);
    const msgs = [];
    $('.error, .alert-danger, .alert-warning, .validation-error, #flash_message, #info').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim();
        if (t) msgs.push(t);
    });
    return { ok: false, message: msgs.join(' | ') || `GVV a refusé le vol (HTTP ${res.status})` };
}

module.exports = { envoyerVolAvion, normaliserNomGvv, cleNomGvvLettres, memeNomGvv };
