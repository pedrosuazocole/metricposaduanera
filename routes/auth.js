const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { get, all, run } = require('../db/database');
const { authMiddleware, requireRol, signToken } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = get('SELECT * FROM usuarios WHERE username=? AND activo=1', [username]);
    if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const token = signToken(user);
    res.json({ token, user: { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol, sucursal_id: user.sucursal_id } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => res.json(req.user));

// ─── USUARIOS ───────────────────────────────────────────────────────────────
router.get('/usuarios', authMiddleware, requireRol('administrador','supervisor'), (req, res) => {
  const rows = all('SELECT u.id,u.username,u.nombre,u.rol,u.activo,u.created_at,s.nombre as sucursal FROM usuarios u LEFT JOIN sucursales s ON u.sucursal_id=s.id');
  res.json(rows);
});

router.post('/usuarios', authMiddleware, requireRol('administrador'), (req, res) => {
  try {
    const { username, password, nombre, rol, sucursal_id } = req.body;
    const hash = bcrypt.hashSync(password, 10);
    run('INSERT INTO usuarios (username,password_hash,nombre,rol,sucursal_id) VALUES (?,?,?,?,?)',
      [username, hash, nombre, rol, sucursal_id]);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/usuarios/:id', authMiddleware, requireRol('administrador'), (req, res) => {
  try {
    const { nombre, rol, sucursal_id, activo, password } = req.body;
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      run('UPDATE usuarios SET nombre=?,rol=?,sucursal_id=?,activo=?,password_hash=? WHERE id=?',
        [nombre, rol, sucursal_id, activo, hash, req.params.id]);
    } else {
      run('UPDATE usuarios SET nombre=?,rol=?,sucursal_id=?,activo=? WHERE id=?',
        [nombre, rol, sucursal_id, activo, req.params.id]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/usuarios/:id', authMiddleware, requireRol('administrador'), (req, res) => {
  if (parseInt(req.params.id) === 1) return res.status(400).json({ error: 'No se puede eliminar el administrador principal' });
  run('UPDATE usuarios SET activo=0 WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
