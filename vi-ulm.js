/* ==========================================================================
   SUIVI « PILOTE VOL D'INITIATION ULM » (VLD/VLO)
   Evalue les conditions reglementaires pour le pilote :
   - plus de 18 ans (et certificat medical si plus de 60 ans)
   - evaluation initiale + evaluation recurrente tous les 3 ans
     (l'initiale couvre les 3 premieres annees) — attestations jointes
   - formation FH — attestation jointe
   - experience recente ULM : 3 decollages + 3 atterrissages / 90 jours
   - attestations conservees 3 ans minimum (documents du membre)
   ========================================================================== */

const VIULM_SUIVI_LABEL = 'Pilote vol initiation ULM';

function viulmNorm(s) {
    return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

}

// Documents du membre (dossier a son nom), actifs ET archives : les
// attestations doivent etre conservees 3 ans, une archive compte donc.
async function chargerDocsVIULM(nomComplet) {
    const nom = (nomComplet || '').replace(/"/g, '\\"');
    const formula = `FIND(UPPER("${nom}"), UPPER({Sous-dossier})) > 0`;
    const url = `${API_BASE}/${encodeURIComponent(TABLE_DOCUMENTS)}?filterByFormula=${encodeURIComponent(formula)}`;
    return await fetchTousRecordsCache(url, { headers });
}

// Un document est « valable » : date de validite dans le futur si renseignee,
// sinon date du doc (ou sa creation) + 3 ans dans le futur.
function viulmDocValable3ans(doc) {
    const f = doc.fields || {};
    const auj = new Date();
    if (f['Date de validité']) {
        const dv = new Date(f['Date de validité'] + 'T00:00:00');
        return !isNaN(dv) && dv >= auj;
    }
    const ref = f['Date'] ? new Date(f['Date']) : (doc.createdTime ? new Date(doc.createdTime) : null);
    if (!ref || isNaN(ref)) return true; // pas de date : on ne peut pas trancher
    const limite = new Date(ref);
    limite.setFullYear(limite.getFullYear() + 3);
    return limite >= auj;
}

// Evalue les conditions. membre = {prenom, nom, fields} ; exp = resultat de
// calculerExperiencesPilote (compteurs ULM inclus).
async function evaluerPiloteVIULM(membre, exp) {
    const f = (membre && membre.fields) || {};
    const nomComplet = `${membre.prenom || f['Prénom'] || ''} ${membre.nom || f['Nom'] || ''}`.trim();
    const auj = new Date();
    const dob = f['Date de naissance'] ? new Date(f['Date de naissance']) : null;
    let age = null;
    if (dob && !isNaN(dob)) {
        age = auj.getFullYear() - dob.getFullYear();
        if (auj.getMonth() < dob.getMonth() || (auj.getMonth() === dob.getMonth() && auj.getDate() < dob.getDate())) age--;
    }

    const docs = await chargerDocsVIULM(nomComplet);
    const trouveDocs = (motCle, motCle2) => docs.filter(r => {
        const t = viulmNorm((r.fields || {})['Titre']);
        return motCle.every(k => t.includes(k)) && (!motCle2 || motCle2.some(k => t.includes(k)));
    });
    const initiale = trouveDocs(['initiale']);
    const recurrente = trouveDocs(['recurrente']);
    const fh = trouveDocs(['fh']).concat(trouveDocs(['formation', 'fh'])).filter((r, i, a) => a.indexOf(r) === i);
    const medical = trouveDocs(['medical']);

    const evalInitialeOk = initiale.length > 0;
    // Recurrente : une eval recurrente valable (<3 ans), ou l'initiale si elle
    // a moins de 3 ans (les 3 premieres annees elle tient lieu de recurrente).
    const recValable = recurrente.some(viulmDocValable3ans);
    const initJeune = initiale.some(viulmDocValable3ans);
    const recurrenteOk = recValable || initJeune;
    const fhOk = fh.length > 0;
    const ageOk = age !== null && age >= 18;
    const medRequis = age !== null && age > 60;
    const medOk = !medRequis || medical.length > 0;
    const recentOk = (exp.decollages3mUlm || 0) >= 3 && (exp.atterrissages3mUlm || 0) >= 3;
    const attestationsOk = evalInitialeOk && recurrenteOk && fhOk && medOk;

    const lignes = [
        { label: 'Âge ≥ 18 ans', ok: ageOk, detail: age === null ? 'date de naissance manquante' : `${age} ans` },
        { label: 'Évaluation initiale (attestation jointe)', ok: evalInitialeOk, detail: evalInitialeOk ? '' : 'document introuvable' },
        { label: 'Évaluation récurrente (< 3 ans, attestation jointe)', ok: recurrenteOk, detail: recurrenteOk ? '' : 'absente ou > 3 ans' },
        { label: 'Formation FH (attestation jointe)', ok: fhOk, detail: fhOk ? '' : 'document introuvable' },
        { label: 'Expérience récente ULM (3 décollages / 3 atterrissages sur 90 j)', ok: recentOk, detail: `${exp.decollages3mUlm || 0} décollages, ${exp.atterrissages3mUlm || 0} atterrissages` },
    ];
    if (medRequis) lignes.push({ label: 'Certificat médical (> 60 ans, attestation jointe)', ok: medical.length > 0, detail: medical.length ? '' : 'document introuvable' });
    lignes.push({ label: 'Attestations conservées ≥ 3 ans', ok: attestationsOk, detail: attestationsOk ? 'toutes présentes' : 'documents manquants' });

    const ok = lignes.every(l => l.ok);
    return { ok, age, lignes, manques: lignes.filter(l => !l.ok).map(l => l.label) };
}
