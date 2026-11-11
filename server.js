'use strict';
// Écran TV du showroom - serveur sans dépendance (Node >= 18)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const SESSION_DAYS = 60;
const MAX_UPLOAD = 300 * 1024 * 1024;
const GRACE_MS = 15 * 60 * 1000;          // message effacé 15 min après l'heure de retour
const LEAD_RETENTION_DAYS = 90;           // demandes supprimées après 90 jours (RGPD)

// Formulaire "Nous écrire" :
//  - 'off' (défaut) : pas de formulaire, le QR code mène directement à la page Test Drive de Tesla
//  - 'email' : la demande est envoyée par e-mail à MAIL_TO et n'est pas conservée sur le site
//  - 'store' : demandes conservées dans l'onglet Demandes
const LEADS_MODE = ['email', 'store'].includes(process.env.LEADS_MODE) ? process.env.LEADS_MODE : 'off';
const MAIL_TO = process.env.MAIL_TO || '';
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || '';

if (!PASSWORD) {
  console.error('ADMIN_PASSWORD manquant. Exemple : ADMIN_PASSWORD="monmotdepasse" npm start');
  process.exit(1);
}
const SECRET = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'tesla-tv').update(PASSWORD).digest();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};
const MEDIA_EXT = { '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.webp': 'image', '.gif': 'image', '.mp4': 'video', '.webm': 'video' };

const DEFAULT_PRESETS = [
  { title: 'Nous sommes en Test Drive', sub: 'Installez-vous et découvrez nos véhicules en attendant.', minutes: 10 },
  { title: 'Nous sommes en Test Drive', sub: 'Installez-vous et découvrez nos véhicules en attendant.', minutes: 20 },
  { title: 'Nous sommes en Test Drive', sub: 'Installez-vous et découvrez nos véhicules en attendant.', minutes: 30 },
  { title: 'Nous sommes en Test Drive', sub: 'Installez-vous et découvrez nos véhicules en attendant.', minutes: 0 },
  { title: 'De retour dans quelques instants', sub: 'Merci de votre patience.', minutes: 5 },
  { title: 'De retour dans quelques instants', sub: 'Merci de votre patience.', minutes: 0 },
  { title: 'Un conseiller arrive', sub: 'Merci de patienter quelques instants.', minutes: 0 },
  { title: 'Livraison en cours', sub: 'Un conseiller sera disponible très bientôt.', minutes: 15 },
].map(p => Object.assign({ id: rid() }, p));

fs.mkdirSync(MEDIA_DIR, { recursive: true });
const state = Object.assign({ message: null, slideSeconds: 8, presets: DEFAULT_PRESETS }, readJson(STATE_FILE, {}));
let leads = readJson(LEADS_FILE, []);

let mailer = null;
if (LEADS_MODE === 'email') {
  const nodemailer = require('nodemailer');
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT) || 465;
    mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } else if (process.env.MAIL_DEBUG) {
    mailer = nodemailer.createTransport({ jsonTransport: true }); // test local : affiche l'e-mail sans l'envoyer
  }
  if (!mailer || !MAIL_TO) console.warn('E-mail non configuré (SMTP_HOST / MAIL_TO) : le formulaire « Nous écrire » renverra une erreur.');
}

const escHtml = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const oneLine = v => String(v).replace(/[\r\n]+/g, ' ');

async function sendLeadMail(lead) {
  const name = oneLine(lead.firstName + ' ' + lead.lastName);
  const rows = [['Prénom', lead.firstName], ['Nom', lead.lastName], ['E-mail', lead.email], ['Téléphone', lead.phone], ['Code postal', lead.postalCode]];
  const date = new Date(lead.at).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', dateStyle: 'full', timeStyle: 'short' });
  const info = await mailer.sendMail({
    from: { name: 'Écran shop Tesla', address: MAIL_FROM },
    to: MAIL_TO,
    replyTo: { name, address: lead.email },
    subject: `Nouvelle demande client - ${name} (${oneLine(lead.postalCode)})`,
    text: [`Nouvelle demande reçue via le QR code du shop, ${date}.`, '',
      ...rows.map(([k, v]) => `${k} : ${v}`), '', 'Demande :', lead.message, '',
      'Répondez directement à cet e-mail pour écrire au client.'].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;color:#171a20;max-width:560px">
<p style="color:#5c5e62;margin:0 0 16px">Nouvelle demande reçue via le QR code du shop, ${escHtml(date)}.</p>
<table style="border-collapse:collapse;width:100%">${rows.map(([k, v]) =>
  `<tr><td style="padding:6px 12px 6px 0;color:#5c5e62;white-space:nowrap">${k}</td><td style="padding:6px 0;font-weight:600">${escHtml(v)}</td></tr>`).join('')}</table>
<p style="color:#5c5e62;margin:20px 0 6px">Demande</p>
<div style="background:#f4f4f4;border-radius:6px;padding:12px 14px;white-space:pre-wrap">${escHtml(lead.message)}</div>
<p style="color:#5c5e62;font-size:12px;margin-top:20px">Répondez directement à cet e-mail pour écrire au client.</p></div>`,
  });
  if (process.env.MAIL_DEBUG && info.message) console.log('[MAIL_DEBUG]', JSON.parse(info.message).subject);
}

function rid() { return crypto.randomBytes(6).toString('hex'); }
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
const saveState = () => writeJson(STATE_FILE, state);
const saveLeads = () => writeJson(LEADS_FILE, leads);

function currentMessage() {
  const m = state.message;
  if (m && m.until && Date.now() > m.until + GRACE_MS) { state.message = null; saveState(); }
  return state.message;
}

function pruneLeads() {
  const limit = Date.now() - LEAD_RETENTION_DAYS * 864e5;
  const before = leads.length;
  leads = leads.filter(l => l.at > limit);
  if (leads.length !== before) saveLeads();
}

function listMedia() {
  return fs.readdirSync(MEDIA_DIR)
    .filter(n => !n.startsWith('.') && MEDIA_EXT[path.extname(n).toLowerCase()])
    .sort()
    .map(n => ({ name: n, type: MEDIA_EXT[path.extname(n).toLowerCase()], url: '/media/' + encodeURIComponent(n) }));
}

function publicState(authed) {
  const s = { now: Date.now(), message: currentMessage(), slideSeconds: state.slideSeconds, media: listMedia(), testDriveUrl: state.testDriveUrl || '' };
  if (authed) {
    s.presets = state.presets;
    s.leadsMode = LEADS_MODE;
    if (LEADS_MODE === 'store') {
      pruneLeads();
      s.leads = leads.slice().sort((a, b) => b.at - a.at);
    }
  }
  return s;
}

// --- Sessions -------------------------------------------------------------
function sign(v) { return crypto.createHmac('sha256', SECRET).update(v).digest('hex'); }
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function isAuthed(req) {
  const t = parseCookies(req).tv_session;
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(exp));
}
function sessionCookie(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `tv_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// Limiteur simple par IP
const buckets = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { count: 1, reset: now + windowMs }); return false; }
  b.count++;
  return b.count > max;
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
}

// --- Helpers HTTP ---------------------------------------------------------
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function json(res, status, data, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(JSON.stringify(data));
}
function readBody(req, limit = 64 * 1024) {
  // Exiger du JSON bloque les envois de formulaires cross-site (CSRF)
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    return Promise.reject(httpError(415, 'JSON attendu'));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(httpError(413, 'Requête trop volumineuse')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(httpError(400, 'JSON invalide')); }
    });
    req.on('error', reject);
  });
}
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const clampMinutes = v => Math.max(0, Math.min(240, Math.round(Number(v) || 0)));

function serveFile(req, res, file, extra) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: 'Introuvable' });
    const headers = Object.assign({
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    }, extra);
    // Les vidéos sur TV demandent des plages d'octets
    const m = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (m) {
      let start, end;
      if (m[1] === '') { start = st.size - Number(m[2]); end = st.size - 1; }
      else { start = Number(m[1]); end = m[2] === '' ? st.size - 1 : Math.min(Number(m[2]), st.size - 1); }
      if (start < 0) start = 0;
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
        return res.end();
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function receiveUpload(req) {
  let orig;
  try { orig = decodeURIComponent(String(req.headers['x-filename'] || '')); } catch (e) { orig = ''; }
  const ext = path.extname(orig).toLowerCase();
  if (!MEDIA_EXT[ext]) throw httpError(400, 'Format non supporté (jpg, png, webp, gif, mp4, webm)');
  if (Number(req.headers['content-length']) > MAX_UPLOAD) throw httpError(413, 'Fichier trop volumineux (max 300 Mo)');
  const base = path.basename(orig, ext).normalize('NFD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'media';
  const name = Date.now() + '-' + base + ext;
  const tmp = path.join(MEDIA_DIR, '.' + name + '.part');
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    let size = 0;
    const fail = err => { out.destroy(); fs.unlink(tmp, () => {}); reject(err); };
    req.on('data', c => {
      size += c.length;
      if (size > MAX_UPLOAD) { req.destroy(); fail(httpError(413, 'Fichier trop volumineux (max 300 Mo)')); }
    });
    req.on('aborted', () => fail(httpError(400, 'Envoi interrompu')));
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (size === 0) return fail(httpError(400, 'Fichier vide'));
      fs.renameSync(tmp, path.join(MEDIA_DIR, name));
      resolve(name);
    });
    req.pipe(out);
  });
}

// --- Routes ---------------------------------------------------------------
async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  const method = req.method;
  const authed = isAuthed(req);

  if (p === '/' || p === '/admin') return serveFile(req, res, path.join(PUBLIC_DIR, authed ? 'admin.html' : 'login.html'), { 'Cache-Control': 'no-store' });
  if (p === '/tv') return serveFile(req, res, path.join(PUBLIC_DIR, 'tv.html'));
  if (p === '/contact') {
    if (LEADS_MODE !== 'off') return serveFile(req, res, path.join(PUBLIC_DIR, 'contact.html'));
    if (state.testDriveUrl) { res.writeHead(302, { Location: state.testDriveUrl }); return res.end(); }
    return json(res, 404, { error: 'Introuvable' });
  }
  if (p === '/admin.html' || p === '/login.html') return json(res, 404, { error: 'Introuvable' });

  if (p === '/api/state' && method === 'GET') return json(res, 200, publicState(authed));

  if (p === '/api/login' && method === 'POST') {
    if (rateLimited('login:' + clientIp(req), 10, 15 * 60 * 1000)) throw httpError(429, 'Trop de tentatives, réessayez dans 15 minutes');
    const body = await readBody(req);
    if (!safeEqual(str(body.password, 200), PASSWORD)) throw httpError(401, 'Mot de passe incorrect');
    const exp = String(Date.now() + SESSION_DAYS * 864e5);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, exp + '.' + sign(exp), SESSION_DAYS * 86400) });
  }
  if (p === '/api/logout' && method === 'POST') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // Formulaire client (public)
  if (p === '/api/leads' && method === 'POST' && LEADS_MODE !== 'off') {
    if (rateLimited('lead:' + clientIp(req), 5, 60 * 60 * 1000)) throw httpError(429, 'Trop de demandes envoyées, merci de réessayer plus tard');
    const b = await readBody(req, 16 * 1024);
    if (b.website) return json(res, 200, { ok: true }); // piège à robots
    const lead = {
      id: rid(), at: Date.now(), status: 'new',
      firstName: str(b.firstName, 60), lastName: str(b.lastName, 60), email: str(b.email, 120),
      phone: str(b.phone, 40), postalCode: str(b.postalCode, 10), message: str(b.message, 1500),
    };
    const missing = [['firstName', 'votre prénom'], ['lastName', 'votre nom'], ['email', 'votre e-mail'],
      ['phone', 'votre téléphone'], ['postalCode', 'votre code postal'], ['message', 'votre demande']].find(([k]) => !lead[k]);
    if (missing) throw httpError(400, 'Merci d’indiquer ' + missing[1]);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) throw httpError(400, 'Adresse e-mail invalide');
    if (b.consent !== true) throw httpError(400, 'Merci d’accepter d’être recontacté');
    if (LEADS_MODE === 'store') {
      leads.push(lead);
      saveLeads();
    } else {
      if (!mailer || !MAIL_TO) throw httpError(503, 'Envoi momentanément indisponible, merci de réessayer plus tard');
      try { await sendLeadMail(lead); } catch (e) {
        console.error('Échec envoi e-mail :', e.message);
        throw httpError(502, 'Envoi impossible pour le moment, merci de réessayer');
      }
    }
    return json(res, 200, { ok: true });
  }

  if (p.startsWith('/api/')) {
    if (!authed) throw httpError(401, 'Non autorisé');

    if (p === '/api/message' && method === 'POST') {
      const b = await readBody(req);
      const title = str(b.title, 140);
      if (!title) throw httpError(400, 'Message vide');
      const minutes = clampMinutes(b.minutes);
      const now = Date.now();
      state.message = { title, sub: str(b.sub, 200), at: now, until: minutes ? now + minutes * 60000 : null, by: str(b.by, 30) };
      saveState();
      return json(res, 200, publicState(true));
    }
    if (p === '/api/message/extend' && method === 'POST') {
      const b = await readBody(req);
      const m = currentMessage();
      if (!m) throw httpError(400, 'Aucun message affiché');
      const delta = Math.max(-240, Math.min(240, Math.round(Number(b.minutes) || 0)));
      if (delta < 0) {
        if (!m.until) throw httpError(400, 'Ce message n’a pas de minuterie');
        // on ne descend pas sous "maintenant" : la TV affiche alors « Retour imminent »
        m.until = Math.max(Date.now(), m.until + delta * 60000);
      } else {
        m.until = Math.max(m.until || 0, Date.now()) + delta * 60000;
      }
      saveState();
      return json(res, 200, publicState(true));
    }
    if (p === '/api/message' && method === 'DELETE') {
      state.message = null;
      saveState();
      return json(res, 200, publicState(true));
    }
    if (p === '/api/presets' && method === 'PUT') {
      const b = await readBody(req);
      if (!Array.isArray(b.presets)) throw httpError(400, 'Liste attendue');
      state.presets = b.presets.slice(0, 30)
        .map(x => ({ id: str(x.id, 20) || rid(), title: str(x.title, 140), sub: str(x.sub, 200), minutes: clampMinutes(x.minutes) }))
        .filter(x => x.title);
      saveState();
      return json(res, 200, publicState(true));
    }
    if (p === '/api/settings' && method === 'PUT') {
      const b = await readBody(req);
      if (b.slideSeconds !== undefined) state.slideSeconds = Math.max(3, Math.min(120, Math.round(Number(b.slideSeconds) || 8)));
      if (b.testDriveUrl !== undefined) {
        const u = str(b.testDriveUrl, 500);
        if (u && !/^https:\/\/[^\s]+$/.test(u)) throw httpError(400, 'Le lien doit commencer par https://');
        state.testDriveUrl = u;
      }
      saveState();
      return json(res, 200, publicState(true));
    }
    if (p === '/api/media' && method === 'POST') {
      await receiveUpload(req);
      return json(res, 200, publicState(true));
    }
    if (p.startsWith('/api/media/') && method === 'DELETE') {
      const name = path.basename(p.slice('/api/media/'.length));
      if (!MEDIA_EXT[path.extname(name).toLowerCase()]) throw httpError(400, 'Fichier invalide');
      fs.rmSync(path.join(MEDIA_DIR, name), { force: true });
      return json(res, 200, publicState(true));
    }
    if (LEADS_MODE === 'store' && p.startsWith('/api/leads/') && (method === 'PATCH' || method === 'DELETE')) {
      const id = p.slice('/api/leads/'.length);
      const lead = leads.find(l => l.id === id);
      if (!lead) throw httpError(404, 'Demande introuvable');
      if (method === 'DELETE') leads = leads.filter(l => l !== lead);
      else {
        const b = await readBody(req);
        if (['new', 'done'].includes(b.status)) lead.status = b.status;
        if (b.status === 'done') { lead.doneAt = Date.now(); lead.doneBy = str(b.by, 30); }
      }
      saveLeads();
      return json(res, 200, publicState(true));
    }
    throw httpError(404, 'Introuvable');
  }

  if (p.startsWith('/media/')) {
    const name = path.basename(p);
    if (name.startsWith('.') || !MEDIA_EXT[path.extname(name).toLowerCase()]) return json(res, 404, { error: 'Introuvable' });
    return serveFile(req, res, path.join(MEDIA_DIR, name), { 'Cache-Control': 'public, max-age=86400' });
  }

  const file = path.join(PUBLIC_DIR, path.normalize(p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return json(res, 404, { error: 'Introuvable' });
  return serveFile(req, res, file);
}

http.createServer((req, res) => {
  route(req, res).catch(err => {
    if (!err.status) console.error(err);
    if (res.headersSent) return res.end();
    json(res, err.status || 500, { error: err.status ? err.message : 'Erreur serveur' });
  });
}).listen(PORT, () => {
  console.log(`Écran TV prêt : http://localhost:${PORT}/tv`);
  console.log(`Gestion :       http://localhost:${PORT}/`);
});
