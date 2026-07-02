// TableroPro — backend con Postgres + autenticación (sin frameworks).
// Sirve index.html y expone /api/*. Railway inyecta PORT y DATABASE_URL.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const INVITE_CODE = process.env.INVITE_CODE || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('[aviso] SESSION_SECRET no definido: las sesiones se cierran al reiniciar el server.');
if (!INVITE_CODE) console.warn('[aviso] INVITE_CODE no definido: el registro de nuevas cuentas está deshabilitado.');

const dbUrl = process.env.DATABASE_URL;
const pool = dbUrl
  ? new Pool({ connectionString: dbUrl, ssl: /rlwy\.net|proxy|amazonaws|render\.com|neon\.tech|supabase/.test(dbUrl) ? { rejectUnauthorized: false } : false })
  : null;

async function initDb() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS users(
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    pass_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS workspace(
    id INT PRIMARY KEY,
    data JSONB,
    rev INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now())`);
}

/* ---- passwords (scrypt, sin dependencias) ---- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + dk;
}
function verifyPassword(pw, stored) {
  try {
    const [salt, dk] = stored.split(':');
    const dk2 = crypto.scryptSync(pw, salt, 64).toString('hex');
    const a = Buffer.from(dk, 'hex'), b = Buffer.from(dk2, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}

/* ---- token de sesión firmado (HMAC) ---- */
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(tok) {
  if (!tok) return null;
  const i = tok.indexOf('.');
  if (i < 0) return null;
  const body = tok.slice(0, i), sig = tok.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  let ok = false;
  try { ok = sig.length === expect.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect)); } catch (e) {}
  if (!ok) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); if (p.exp && p.exp < Date.now()) return null; return p; } catch (e) { return null; }
}

function parseCookies(req) {
  const h = req.headers.cookie || ''; const out = {};
  h.split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function readJSON(req) {
  return new Promise(res => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 25 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { res({}); } });
    req.on('error', () => res({}));
  });
}
function send(res, code, obj, headers) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}));
  res.end(JSON.stringify(obj));
}
function sessionUser(req) { return verifyToken(parseCookies(req).session); }
function setSessionCookie(res, req, uid, email) {
  const secure = req.headers['x-forwarded-proto'] === 'https';
  const tok = signToken({ uid, email, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  res.setHeader('Set-Cookie', `session=${tok}; HttpOnly; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax${secure ? '; Secure' : ''}`);
}

const server = http.createServer(async (req, res) => {
  const u = (req.url || '/').split('?')[0];
  try {
    if (u.startsWith('/api/')) {
      if (!pool) return send(res, 500, { error: 'Base de datos no configurada (falta DATABASE_URL).' });

      if (u === '/api/register' && req.method === 'POST') {
        const { email, password, invite } = await readJSON(req);
        if (!INVITE_CODE) return send(res, 403, { error: 'El registro está deshabilitado.' });
        if ((invite || '') !== INVITE_CODE) return send(res, 403, { error: 'Código de invitación inválido.' });
        if (!email || !/.+@.+\..+/.test(email)) return send(res, 400, { error: 'Email inválido.' });
        if (!password || password.length < 6) return send(res, 400, { error: 'La contraseña debe tener al menos 6 caracteres.' });
        const e = email.toLowerCase().trim();
        try {
          const r = await pool.query('INSERT INTO users(email,pass_hash) VALUES($1,$2) RETURNING id', [e, hashPassword(password)]);
          setSessionCookie(res, req, r.rows[0].id, e);
          return send(res, 200, { email: e });
        } catch (err) {
          if (err.code === '23505') return send(res, 409, { error: 'Ese email ya está registrado.' });
          throw err;
        }
      }

      if (u === '/api/login' && req.method === 'POST') {
        const { email, password } = await readJSON(req);
        const e = (email || '').toLowerCase().trim();
        const r = await pool.query('SELECT id,pass_hash FROM users WHERE email=$1', [e]);
        if (!r.rows.length || !verifyPassword(password || '', r.rows[0].pass_hash))
          return send(res, 401, { error: 'Email o contraseña incorrectos.' });
        setSessionCookie(res, req, r.rows[0].id, e);
        return send(res, 200, { email: e });
      }

      if (u === '/api/logout' && req.method === 'POST') {
        res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
        return send(res, 200, { ok: true });
      }

      const sess = sessionUser(req);
      if (u === '/api/me') {
        if (!sess) return send(res, 401, { error: 'no auth' });
        return send(res, 200, { email: sess.email });
      }

      if (u === '/api/state') {
        if (!sess) return send(res, 401, { error: 'no auth' });
        if (req.method === 'GET') {
          const r = await pool.query('SELECT data,rev FROM workspace WHERE id=1');
          if (!r.rows.length) return send(res, 200, { data: null, rev: 0 });
          return send(res, 200, { data: r.rows[0].data, rev: r.rows[0].rev });
        }
        if (req.method === 'PUT') {
          const { data, rev } = await readJSON(req);
          const cur = await pool.query('SELECT rev FROM workspace WHERE id=1');
          if (!cur.rows.length) {
            const r = await pool.query('INSERT INTO workspace(id,data,rev,updated_at) VALUES(1,$1,1,now()) RETURNING rev', [data]);
            return send(res, 200, { rev: r.rows[0].rev });
          }
          if (cur.rows[0].rev !== rev) {
            const latest = await pool.query('SELECT data,rev FROM workspace WHERE id=1');
            return send(res, 409, { error: 'conflict', data: latest.rows[0].data, rev: latest.rows[0].rev });
          }
          const r = await pool.query('UPDATE workspace SET data=$1,rev=rev+1,updated_at=now() WHERE id=1 RETURNING rev', [data]);
          return send(res, 200, { rev: r.rows[0].rev });
        }
      }

      return send(res, 404, { error: 'not found' });
    }

    // Todo lo demás sirve la app (un solo archivo). No expone el código del server.
    fs.readFile(path.join(ROOT, 'index.html'), (err, d) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(d);
    });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Error del servidor.' });
  }
});

initDb()
  .then(() => server.listen(PORT, () => console.log('TableroPro escuchando en el puerto ' + PORT)))
  .catch(e => { console.error('Fallo al inicializar la DB:', e.message); server.listen(PORT, () => console.log('TableroPro en puerto ' + PORT + ' (¡DB no disponible!)')); });
