/* ==========================================================================
   CLIENT HTTP GVV PARTAGE (gvvaces.qfu.fr)
   Session PHP classique a cookies. Utilise par gvv-sync.js et gvv-vols.js.
   ========================================================================== */

const cheerio = require('cheerio');

const GVV_BASE = (process.env.GVV_BASE || 'https://gvvaces.qfu.fr').replace(/\/+$/, '');
const GVV_USER = process.env.GVV_USER;
const GVV_PASS = process.env.GVV_PASS;

function corpsForm(fields) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
        if (Array.isArray(v)) v.forEach(x => params.append(k, x));
        else params.append(k, v);
    }
    return params.toString();
}

class GvvClient {
    constructor() {
        this.cookies = new Map(); // nom -> valeur
    }

    cookieHeader() {
        return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    storeCookies(res) {
        const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
        for (const c of raw) {
            const [pair] = c.split(';');
            const idx = pair.indexOf('=');
            if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
        }
    }

    async get(path) {
        const res = await this.getRaw(path);
        // GVV repond souvent par un 302 apres login : suivre a la main
        if ([301, 302, 303].includes(res.status)) {
            const loc = res.headers.get('location') || '';
            const rel = loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc;
            return this.get(rel);
        }
        return res;
    }

    async getRaw(path) {
        const res = await fetch(`${GVV_BASE}${path}`, {
            headers: { Cookie: this.cookieHeader() },
            redirect: 'manual'
        });
        this.storeCookies(res);
        return res;
    }

    async postForm(path, fields) {
        const res = await this.postRaw(path, fields);
        if ([301, 302, 303].includes(res.status)) {
            const loc = res.headers.get('location') || '';
            const rel = loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc;
            return this.get(rel);
        }
        return res;
    }

    // POST sans suivre la redirection (302 = succes chez GVV, 200 = form reaffiche avec erreurs)
    async postRaw(path, fields) {
        const res = await fetch(`${GVV_BASE}${path}`, {
            method: 'POST',
            headers: {
                Cookie: this.cookieHeader(),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: corpsForm(fields),
            redirect: 'manual'
        });
        this.storeCookies(res);
        return res;
    }

    // Login : on lit le formulaire pour trouver les vrais noms de champs
    async login() {
        const page = await this.get('/index.php/auth/login');
        const html = await page.text();
        const $ = cheerio.load(html);
        const form = $('form:has(input[type="password"])').first();
        const action = form.attr('action') || '/index.php/auth/login';
        const actionPath = action.startsWith('http') ? new URL(action).pathname + new URL(action).search : action;

        const fields = {};
        form.find('input').each((_, el) => {
            const name = $(el).attr('name');
            if (!name) return;
            const type = ($(el).attr('type') || 'text').toLowerCase();
            if (type === 'password') fields[name] = GVV_PASS;
            else if (type === 'text' || type === 'email') fields[name] = GVV_USER;
            else if (type === 'checkbox' || type === 'radio') {
                if ($(el).attr('checked')) fields[name] = $(el).attr('value') || '1';
            } else if (type !== 'button') fields[name] = $(el).attr('value') || '';
        });

        const res = await this.postForm(actionPath, fields);
        const resHtml = await res.text();
        const $res = cheerio.load(resHtml);
        if ($res('input[name="username"], input[type="password"]').length > 0) {
            throw new Error('Login GVV refuse (identifiants invalides ?)');
        }
        return resHtml;
    }
}

module.exports = { GvvClient, GVV_BASE, GVV_USER, GVV_PASS };
