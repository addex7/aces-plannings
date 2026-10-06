/* ==========================================================================
   RECUPERATION DES FICHES MEMBRES GVV (gvvaces.qfu.fr)
   Combine :
   - /membre/page (HTML) : telephone, mobile, naissance, login GVV
   - /membre/export/csv  : adresse complete (rue + CP + ville)
   Utilise par l'endpoint GET /v0/:base/gvv-membres de server.js.
   ========================================================================== */

const cheerio = require('cheerio');
const { GvvClient } = require('./gvv-client');

function dateFrToIso(s) {
    const m = (s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function normaliser(s) {
    return (s || '').toString().toLowerCase().normalize('NFD')
        .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

// Retourne [{ nom, prenom, login, naissance (ISO), telephone, mobile, mail, adresse }]
async function recupererMembresGvv() {
    const client = new GvvClient();
    await client.login();

    // Page liste : telephones (le CSV ne les contient pas)
    const res = await client.get('/index.php/membre/page');
    const html = await res.text();
    const $ = cheerio.load(html);
    const membres = new Map(); // cle : nom|prenom normalises
    $('table').eq(1).find('tr').slice(1).each((_, tr) => {
        const tds = $(tr).find('td');
        if (tds.length < 7) return;
        const nom = tds.eq(0).text().trim();
        const prenom = tds.eq(1).text().trim();
        if (!nom && !prenom) return;
        const login = (($(tr).find('a[href*="membre/edit/"]').attr('href') || '')
            .match(/membre\/edit\/([^/?#]+)/) || [])[1] || '';
        membres.set(normaliser(nom) + '|' + normaliser(prenom), {
            nom, prenom, login,
            ville: tds.eq(2).text().trim(),
            telephone: tds.eq(3).text().trim(),
            mobile: tds.eq(4).text().trim(),
            mail: tds.eq(5).text().trim(),
            naissance: dateFrToIso(tds.eq(6).text().trim()),
            adresse: ''
        });
    });

    // Export CSV : adresse complete (rue, CP, ville) — la page liste n'a que la ville
    const resCsv = await client.get('/index.php/membre/export/csv');
    const csv = Buffer.from(await resCsv.arrayBuffer()).toString('latin1');
    for (const ligne of csv.split(/\r?\n/)) {
        const c = ligne.split(';').map(x => x.trim());
        if (c.length < 7 || !/^\d+$/.test(c[0])) continue;
        const m = membres.get(normaliser(c[1]) + '|' + normaliser(c[2]));
        if (!m) continue;
        m.adresse = [c[3], [c[4], c[5]].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        if (!m.naissance) m.naissance = dateFrToIso(c[6]);
        if (!m.mail) m.mail = c[7] || '';
    }

    return [...membres.values()];
}

module.exports = { recupererMembresGvv };
