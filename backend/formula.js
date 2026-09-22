/* ==========================================================================
   TRADUCTEUR filterByFormula Airtable -> SQL (PostgreSQL, colonne fields JSONB)
   Sous-ensemble supporte : AND OR NOT IF, comparaisons = != > >= < <=,
   DATETIME_FORMAT, DATETIME_PARSE, IS_BEFORE IS_AFTER IS_SAME, FIND SEARCH,
   UPPER LOWER TRIM ARRAYJOIN CONCATENATE, TRUE() FALSE() BLANK(), TODAY() NOW()
   ========================================================================== */

const TZ = 'Europe/Paris';

function tokeniser(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
        if (c === '{') {
            const j = src.indexOf('}', i);
            if (j === -1) throw new Error('Accolade non fermee');
            tokens.push({ type: 'champ', value: src.slice(i + 1, j).trim() });
            i = j + 1;
            continue;
        }
        if (c === "'" || c === '"') {
            let j = i + 1;
            let s = '';
            while (j < src.length) {
                if (src[j] === c) {
                    if (src[j + 1] === c) { s += c; j += 2; continue; }
                    if (c === "'" && src[j + 1] === "'") { s += "'"; j += 2; continue; }
                    break;
                }
                if (src[j] === '\\' && src[j + 1] === c) { s += c; j += 2; continue; }
                s += src[j];
                j++;
            }
            tokens.push({ type: 'str', value: s });
            i = j + 1;
            continue;
        }
        if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] || ''))) {
            let j = i;
            if (src[j] === '-') j++;
            while (j < src.length && /[0-9.]/.test(src[j])) j++;
            tokens.push({ type: 'num', value: parseFloat(src.slice(i, j)) });
            i = j;
            continue;
        }
        if (src.startsWith('!=', i) || src.startsWith('<>', i)) { tokens.push({ type: 'op', value: '!=' }); i += 2; continue; }
        if (src.startsWith('>=', i)) { tokens.push({ type: 'op', value: '>=' }); i += 2; continue; }
        if (src.startsWith('<=', i)) { tokens.push({ type: 'op', value: '<=' }); i += 2; continue; }
        if (c === '=' || c === '>' || c === '<') { tokens.push({ type: 'op', value: c }); i++; continue; }
        if (c === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
        if (c === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
        if (c === ',') { tokens.push({ type: 'comma' }); i++; continue; }
        if (c === '&') { tokens.push({ type: 'op', value: '&' }); i++; continue; }
        if (/[A-Za-z_]/.test(c)) {
            let j = i;
            while (j < src.length && /[A-Za-z_0-9]/.test(src[j])) j++;
            tokens.push({ type: 'ident', value: src.slice(i, j).toUpperCase() });
            i = j;
            continue;
        }
        throw new Error(`Caractere inattendu: ${c} (position ${i})`);
    }
    return tokens;
}

function sqlChamp(nom) {
    return `f->>'${nom.replace(/'/g, "''")}'`;
}

function sqlChampJsonb(nom) {
    return `f->'${nom.replace(/'/g, "''")}'`;
}

function sqlLit(s) {
    return `'${String(s).replace(/'/g, "''")}'`;
}

// Cast numerique protege (NULL si le contenu n'est pas un nombre)
function sqlNum(expr) {
    return `(CASE WHEN (${expr}) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${expr})::numeric END)`;
}

// Cast timestamp protege (NULL si invalide)
function sqlTs(expr) {
    return `(CASE WHEN (${expr}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (${expr})::timestamptz END)`;
}

function sqlDate(expr) {
    return `to_char(${sqlTs(expr)} AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`;
}

class Parseur {
    constructor(tokens) { this.t = tokens; this.pos = 0; }
    courant() { return this.t[this.pos]; }
    avancer() { return this.t[this.pos++]; }
    attendre(type) {
        const tok = this.avancer();
        if (!tok || tok.type !== type) throw new Error(`Attendu ${type}, recu ${JSON.stringify(tok)}`);
        return tok;
    }

    parseExpr() {
        return this.parseComparaison();
    }

    parseComparaison() {
        const gauche = this.parsePrimaire();
        const tok = this.courant();
        if (tok && tok.type === 'op' && ['=', '!=', '>', '>=', '<', '<=', '&'].includes(tok.value)) {
            this.avancer();
            const droite = this.parseComparaison();
            return { kind: 'cmp', op: tok.value, gauche, droite };
        }
        return gauche;
    }

    parsePrimaire() {
        const tok = this.avancer();
        if (!tok) throw new Error('Fin de formule inattendue');
        if (tok.type === 'champ') return { kind: 'champ', nom: tok.value };
        if (tok.type === 'str') return { kind: 'str', value: tok.value };
        if (tok.type === 'num') return { kind: 'num', value: tok.value };
        if (tok.type === 'lparen') {
            const e = this.parseExpr();
            this.attendre('rparen');
            return e;
        }
        if (tok.type === 'ident') {
            const nom = tok.value;
            if (this.courant() && this.courant().type === 'lparen') {
                this.avancer();
                const args = [];
                if (!(this.courant() && this.courant().type === 'rparen')) {
                    args.push(this.parseExpr());
                    while (this.courant() && this.courant().type === 'comma') {
                        this.avancer();
                        args.push(this.parseExpr());
                    }
                }
                this.attendre('rparen');
                return { kind: 'fn', nom, args };
            }
            if (nom === 'TRUE') return { kind: 'bool', value: true };
            if (nom === 'FALSE') return { kind: 'bool', value: false };
            throw new Error(`Identifiant inconnu: ${nom}`);
        }
        throw new Error(`Token inattendu: ${JSON.stringify(tok)}`);
    }
}

function estBool(node) {
    return node && (node.kind === 'bool' ||
        (node.kind === 'fn' && (node.nom === 'TRUE' || node.nom === 'FALSE')) ||
        (node.kind === 'num' && (node.value === 0 || node.value === 1)));
}

function boolVal(node) {
    if (node.kind === 'fn') return node.nom === 'TRUE';
    return !!node.value;
}

// Champ utilise comme booleen : {Lu}, {Actif}
function sqlBoolChamp(nom) {
    return `COALESCE((CASE WHEN (${sqlChamp(nom)}) IN ('true','1') THEN true WHEN (${sqlChamp(nom)}) IN ('false','0') THEN false ELSE (${sqlChamp(nom)})::boolean END), false)`;
}

function valeurSql(node) {
    switch (node.kind) {
        case 'str': return sqlLit(node.value);
        case 'num': return String(node.value);
        case 'bool': return node.value ? 'true' : 'false';
        case 'champ': return sqlChamp(node.nom);
        case 'cmp': return `(${cmpSql(node)})`;
        case 'fn': return fnSql(node);
        default: throw new Error(`Noeud inconnu: ${node.kind}`);
    }
}

// Comparaison champ = valeur (supporte scalaire texte ET tableau de liens recXXX)
function cmpEgal(node) {
    const { gauche, droite } = node;
    if (gauche.kind === 'champ') {
        if (estBool(droite)) return `${sqlBoolChamp(gauche.nom)} = ${boolVal(droite) ? 'true' : 'false'}`;
        if (droite.kind === 'num') return `${sqlNum(sqlChamp(gauche.nom))} = ${droite.value}`;
        if (droite.kind === 'str') return `(${sqlChamp(gauche.nom)} = ${sqlLit(droite.value)} OR ${sqlChampJsonb(gauche.nom)} ? ${sqlLit(droite.value)})`;
        return `${valeurSql(gauche)} = ${valeurSql(droite)}`;
    }
    if (droite.kind === 'champ') return cmpEgal({ kind: 'cmp', op: '=', gauche: droite, droite: gauche });
    if (estBool(droite)) return `(${conditionSql(gauche)}) = ${boolVal(droite) ? 'true' : 'false'}`;
    return `${valeurSql(gauche)} = ${valeurSql(droite)}`;
}

function cmpDiff(node) {
    const { gauche, droite } = node;
    if (gauche.kind === 'champ') {
        if (estBool(droite)) return `${sqlBoolChamp(gauche.nom)} = ${boolVal(droite) ? 'false' : 'true'}`;
        if (droite.kind === 'num') return `(${sqlNum(sqlChamp(gauche.nom))} IS DISTINCT FROM ${droite.value})`;
        if (droite.kind === 'str') return `(${sqlChamp(gauche.nom)} <> ${sqlLit(droite.value)} AND NOT (${sqlChampJsonb(gauche.nom)} ? ${sqlLit(droite.value)}))`;
        return `${valeurSql(gauche)} <> ${valeurSql(droite)}`;
    }
    if (droite.kind === 'champ') return cmpDiff({ kind: 'cmp', op: '!=', gauche: droite, droite: gauche });
    return `${valeurSql(gauche)} <> ${valeurSql(droite)}`;
}

function cmpOrdre(node) {
    const { gauche, droite, op } = node;
    const g = valeurSql(gauche);
    const d = valeurSql(droite);
    // Comparaison numerique si un cote est un nombre
    if (droite.kind === 'num') return `${sqlNum(g)} ${op} ${d}`;
    if (gauche.kind === 'num') return `${g} ${op} ${sqlNum(d)}`;
    return `${g} ${op} ${d}`;
}

function cmpSql(node) {
    if (node.op === '=') return cmpEgal(node);
    if (node.op === '!=') return cmpDiff(node);
    if (node.op === '&') return `(${valeurSql(node.gauche)} || ${valeurSql(node.droite)})`;
    return cmpOrdre(node);
}

// Argument "positionnable" : FIND(cherche, dans) -> strpos(dans, cherche)
function positionDans(cherche, dans) {
    return `strpos(${valeurSql(dans)}, ${valeurSql(cherche)})`;
}

function positionDansInsensible(cherche, dans) {
    return `strpos(lower(${valeurSql(dans)}), lower(${valeurSql(cherche)}))`;
}

function fnSql(node) {
    const { nom, args } = node;
    switch (nom) {
        case 'AND': return `(${args.map(a => conditionSql(a)).join(' AND ')})`;
        case 'OR': return `(${args.map(a => conditionSql(a)).join(' OR ')})`;
        case 'NOT': return `(NOT ${conditionSql(args[0])})`;
        case 'XOR': return `((${args.map(a => conditionSql(a)).join(') <> (')}))`;
        case 'IF': return `(CASE WHEN ${conditionSql(args[0])} THEN ${valeurSql(args[1])} ELSE ${args[2] ? valeurSql(args[2]) : 'NULL'} END)`;
        case 'TRUE': return 'true';
        case 'FALSE': return 'false';
        case 'BLANK': return 'NULL';
        case 'TODAY': return 'CURRENT_DATE';
        case 'NOW': return 'now()';
        case 'DATETIME_FORMAT': {
            const fmt = args[1] && args[1].kind === 'str' ? args[1].value : 'YYYY-MM-DD';
            if (fmt === 'YYYY-MM-DD') return sqlDate(valeurSql(args[0]));
            const fmtPg = fmt.replace(/YYYY/g, 'YYYY').replace(/MM/g, 'MM').replace(/DD/g, 'DD');
            return `to_char(${sqlTs(valeurSql(args[0]))} AT TIME ZONE '${TZ}', ${sqlLit(fmtPg)})`;
        }
        case 'DATETIME_PARSE': return sqlTs(args[0] ? valeurSql(args[0]) : 'NULL');
        case 'IS_BEFORE': return `(${sqlTs(valeurSql(args[0]))} < ${sqlTs(valeurSql(args[1]))})`;
        case 'IS_AFTER': return `(${sqlTs(valeurSql(args[0]))} > ${sqlTs(valeurSql(args[1]))})`;
        case 'IS_SAME': return `(${sqlDate(valeurSql(args[0]))} = ${sqlDate(valeurSql(args[1]))})`;
        case 'FIND': return positionDans(args[0], args[1]);
        case 'SEARCH': return positionDansInsensible(args[0], args[1]);
        case 'UPPER': return `upper(${valeurSql(args[0])})`;
        case 'LOWER': return `lower(${valeurSql(args[0])})`;
        case 'TRIM': return `btrim(${valeurSql(args[0])})`;
        case 'LEN': return `length(${valeurSql(args[0])})`;
        case 'CONCATENATE': return `(${args.map(a => valeurSql(a)).join(' || ')})`;
        case 'ARRAYJOIN': {
            const a = args[0];
            const sep = args[1] ? valeurSql(args[1]) : `','`;
            if (a.kind === 'champ') {
                return `COALESCE((SELECT string_agg(v, ${sep}) FROM jsonb_array_elements_text(${sqlChampJsonb(a.nom)}) v), ${sqlChamp(a.nom)})`;
            }
            return valeurSql(a);
        }
        default:
            throw new Error(`Fonction non supportee: ${nom}`);
    }
}

// Un noeud utilise en contexte booleen
function conditionSql(node) {
    if (node.kind === 'champ') return sqlBoolChamp(node.nom);
    return valeurSql(node);
}

function formulaToSql(formula) {
    if (!formula || !String(formula).trim()) return null;
    const tokens = tokeniser(String(formula));
    const p = new Parseur(tokens);
    const ast = p.parseExpr();
    if (p.pos !== tokens.length) throw new Error('Formule mal terminee');
    return conditionSql(ast);
}

module.exports = { formulaToSql };
