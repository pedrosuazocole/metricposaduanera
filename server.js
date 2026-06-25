'use strict';
// Cargar variables de entorno desde .env (uso local)
const envPath = require('path').join(__dirname, '.env');
if (require('fs').existsSync(envPath)) {
  require('fs').readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
  });
}

const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const helmet     = require('helmet');
const path       = require('path');
const fs         = require('fs');
const { v4: uuid } = require('uuid');
const PDFDocument = require('pdfkit');

// Honduras UTC-6 helper
function nowHN() {
  const d = new Date();
  d.setHours(d.getHours() - 6);
  return d.toISOString().replace('T', ' ').substring(0, 19);
}
function todayHN() {
  const d = new Date();
  d.setHours(d.getHours() - 6);
  return d.toISOString().substring(0, 10);
}
const initSqlJs  = require('sql.js');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'metricpos_secret_2026_hn';
const LICENSE_SECRET = process.env.LICENSE_SECRET || 'MPOS2026HN_LIC_KEY';
// Railway Volume: detectar automáticamente la ruta correcta con permisos de escritura
function _resolveDataDir() {
  const candidates = [
    process.env.RAILWAY_VOLUME_MOUNT_PATH,      // Volume de Railway (prioridad máxima)
    process.env.DATA_DIR,                        // Variable manual
    '/datos/metricpos',                          // Railway — path real del volumen
    '/datos',                                    // Railway — variante
    '/data',                                     // Mount path alternativo Railway
    path.join(__dirname, 'data'),                // Local Windows/Linux
    '/tmp/metricpos'                             // Último recurso (sin volumen)
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // Verificar que se puede escribir
      const test = path.join(dir, '.write_test');
      fs.writeFileSync(test, 'ok');
      fs.unlinkSync(test);
      console.log(`📁 DATA_DIR: ${dir}`);
      return dir;
    } catch(e) {
      console.warn(`⚠️  Sin permisos en ${dir}, probando siguiente...`);
    }
  }
  throw new Error('No se encontró ningún directorio con permisos de escritura');
}

const DATA_DIR = _resolveDataDir();
const DB_FILE  = path.join(DATA_DIR, 'metricpos.db');

// Confiar en el proxy de Railway/nginx para HTTPS y IPs reales
app.set('trust proxy', 1);

// CORS: en producción solo el dominio propio, en dev abierto
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));

// ── Forzar que el browser NO cachée app.js ni sw.js ──────────────────────────
// Esto evita que el Service Worker antiguo siga sirviendo versiones viejas
app.use((req, res, next) => {
  if (req.path === '/app.js' || req.path === '/sw.js' || req.path === '/manifest.json') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// ── HEALTH CHECK (público, siempre disponible) ────────────────────────────────
app.get('/health', (req, res) => {
  try {
    const suc = db ? all(`SELECT id,nombre FROM sucursales WHERE activa=1`) : [];
    const usr = db ? all(`SELECT id,username,rol FROM usuarios WHERE activo=1`) : [];
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      db_file: DB_FILE,
      db_exists: fs.existsSync(DB_FILE),
      sucursales: suc.length,
      usuarios: usr.length,
      sucursales_lista: suc,
      version: '7.3-aduanera'
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message, db_file: DB_FILE });
  }
});

// ── RESET EMERGENCIA (solo si la DB no tiene sucursales) ──────────────────────
// Visitar: /api/reset-db?confirm=RESETEAR para forzar recreación de sucursal+admin
app.get('/api/reset-db', (req, res) => {
  if (req.query.confirm !== 'RESETEAR') {
    return res.json({ mensaje: 'Para resetear, visita /api/reset-db?confirm=RESETEAR', advertencia: 'Esto borrará todos los datos' });
  }
  try {
    const suc = all(`SELECT id FROM sucursales LIMIT 1`);
    if (suc.length > 0) {
      return res.json({ ok: false, mensaje: 'Ya existen sucursales. No se puede resetear. Elimina el volumen en Railway si querés empezar desde cero.' });
    }
    seedData(); saveDB();
    const nuevaSuc = all(`SELECT id,nombre FROM sucursales LIMIT 1`);
    res.json({ ok: true, mensaje: 'Sucursal y admin creados', sucursal: nuevaSuc[0] });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// ── Cache-busting: versión única generada en cada arranque del servidor ──────
// Cada vez que Railway redespliega, el proceso reinicia y esta constante cambia,
// forzando a TODOS los navegadores a descargar app.js fresco (no desde caché).
const APP_BUILD_VERSION = Date.now().toString();

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Servir index.html inyectando la versión de build en la URL de app.js
app.get('/', (req, res) => {
  try {
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    html = html.replace(
      /<script\s+src="\/?app\.js"><\/script>/,
      `<script src="/app.js?v=${APP_BUILD_VERSION}"></script>`
    );
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(html);
  } catch(e) {
    res.status(500).send('Error cargando la aplicación: ' + e.message);
  }
});

let db; let SQL;

async function initDB() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    try {
      db = new SQL.Database(fs.readFileSync(DB_FILE));
      // Verificar que la DB es válida ejecutando una query simple
      db.exec('SELECT 1');
      console.log('📂 DB cargada correctamente desde', DB_FILE);
    } catch(e) {
      console.error('⚠️  DB corrupta o inválida, recreando desde cero:', e.message);
      // Hacer backup del archivo corrupto
      try {
        fs.renameSync(DB_FILE, DB_FILE + '.corrupto.' + Date.now());
        console.log('💾 Backup de DB corrupta creado');
      } catch(be) { /* ignorar si no se puede renombrar */ }
      db = new SQL.Database();
      console.log('🆕 DB nueva creada (DB anterior era inválida)');
    }
  } else {
    db = new SQL.Database();
    console.log('🆕 DB nueva (primer arranque)');
  }
  createSchema(); seedData(); saveDB();
}
function saveDB() { fs.writeFileSync(DB_FILE, Buffer.from(db.export())); }
setInterval(saveDB, 30000);
function run(sql,params=[]){ db.run(sql,params); }
function all(sql,params=[]){ const s=db.prepare(sql),r=[]; s.bind(params); while(s.step())r.push(s.getAsObject()); s.free(); return r; }
function get(sql,params=[]){ return all(sql,params)[0]||null; }

// ── LICENCIAS ──
const crypto=require('crypto');
const TIPOS_LICENCIA={mensual:30,trimestral:90,anual:365,vitalicia:36500,demo:7};

function generarClave(tipo,seed){
  // Formato: MPOS-TIPO-XXXX-XXXX-XXXX  (determinista por seed+tipo+secret)
  const base=`${LICENSE_SECRET}|${tipo}|${seed}`;
  const hash=crypto.createHash('sha256').update(base).digest('hex').toUpperCase();
  const p=t=>hash.substr(t,4);
  return `MPOS-${tipo.substring(0,3).toUpperCase()}-${p(0)}-${p(4)}-${p(8)}`;
}

function validarClave(clave){
  for(const tipo of Object.keys(TIPOS_LICENCIA)){
    for(let seed=1;seed<=9999;seed++){
      if(generarClave(tipo,seed)===clave.toUpperCase()) return tipo;
    }
  }
  return null;
}

function getLicenciaActiva(){
  return get(`SELECT * FROM licencias WHERE activa=1 AND date(fecha_vencimiento)>=date('now') ORDER BY id DESC`);
}

// Endpoint: verificar estado de licencia (público para el frontend antes de login)
app.get('/api/licencia/estado',(req,res)=>{
  const lic=getLicenciaActiva();
  if(lic){
    const diasRestantes=Math.ceil((new Date(lic.fecha_vencimiento)-new Date())/(1000*60*60*24));
    res.json({activa:true,tipo:lic.tipo,vencimiento:lic.fecha_vencimiento,diasRestantes});
  } else {
    res.json({activa:false});
  }
});

// Endpoint: activar licencia
app.post('/api/licencia/activar',(req,res)=>{
  const{clave}=req.body;
  if(!clave)return res.status(400).json({error:'Clave requerida'});
  // Verificar si ya fue usada
  const usada=get(`SELECT id FROM licencias WHERE clave=?`,[clave.toUpperCase()]);
  if(usada)return res.status(400).json({error:'Esta clave ya fue utilizada'});
  const tipo=validarClave(clave);
  if(!tipo)return res.status(400).json({error:'Clave de licencia inválida'});
  const dias=TIPOS_LICENCIA[tipo];
  const hoy=new Date(); hoy.setHours(hoy.getHours()-6);
  const venc=new Date(hoy);
  venc.setDate(venc.getDate()+dias);
  const fechaAct=hoy.toISOString().substring(0,10);
  const fechaVenc=venc.toISOString().substring(0,10);
  // Desactivar licencias anteriores
  run(`UPDATE licencias SET activa=0`);
  run(`INSERT INTO licencias(clave,tipo,fecha_activacion,fecha_vencimiento,activa)VALUES(?,?,?,?,1)`,[clave.toUpperCase(),tipo,fechaAct,fechaVenc]);
  saveDB();
  res.json({ok:true,tipo,vencimiento:fechaVenc,diasRestantes:dias});
});

// Endpoint: generar clave (solo para desarrollo/admin - protegido)
app.post('/api/licencia/generar',auth(['admin']),(req,res)=>{
  const{tipo,seed}=req.body;
  if(!TIPOS_LICENCIA[tipo])return res.status(400).json({error:'Tipo inválido'});
  const s=seed||Math.floor(Math.random()*9000)+1000;
  res.json({clave:generarClave(tipo,s),tipo,dias:TIPOS_LICENCIA[tipo]});
});

function createSchema(){
  db.run(`PRAGMA journal_mode=WAL`);
  db.run(`CREATE TABLE IF NOT EXISTS sucursales(id TEXT PRIMARY KEY,nombre TEXT,direccion TEXT,telefono TEXT,rtn TEXT,cai TEXT,serie TEXT,rango_ini TEXT,rango_fin TEXT,fecha_limite TEXT,logo TEXT,activa INTEGER DEFAULT 1,creado TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS usuarios(id TEXT PRIMARY KEY,nombre TEXT,username TEXT UNIQUE,password TEXT,rol TEXT CHECK(rol IN('admin','supervisor','cajero')),sucursal_id TEXT,activo INTEGER DEFAULT 1,creado TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS categorias(id INTEGER PRIMARY KEY AUTOINCREMENT,nombre TEXT UNIQUE,activa INTEGER DEFAULT 1)`);
  db.run(`CREATE TABLE IF NOT EXISTS productos(id TEXT PRIMARY KEY,codigo TEXT UNIQUE,nombre TEXT,categoria TEXT,precio_venta REAL,costo REAL DEFAULT 0,gravado INTEGER DEFAULT 1,activo INTEGER DEFAULT 1,creado TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS inventario(id INTEGER PRIMARY KEY AUTOINCREMENT,producto_id TEXT,sucursal_id TEXT,stock INTEGER DEFAULT 0,stock_min INTEGER DEFAULT 0,UNIQUE(producto_id,sucursal_id))`);
  db.run(`CREATE TABLE IF NOT EXISTS kardex(id INTEGER PRIMARY KEY AUTOINCREMENT,producto_id TEXT,sucursal_id TEXT,tipo TEXT,cantidad INTEGER,costo_unit REAL DEFAULT 0,precio_unit REAL DEFAULT 0,saldo_stock INTEGER,referencia TEXT,motivo TEXT,usuario_id TEXT,fecha TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS clientes(id TEXT PRIMARY KEY,nombre TEXT,rtn TEXT,direccion TEXT,telefono TEXT,email TEXT,limite_credito REAL DEFAULT 0,saldo REAL DEFAULT 0,activo INTEGER DEFAULT 1,creado TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS proveedores(id TEXT PRIMARY KEY,nombre TEXT,rtn TEXT,direccion TEXT,telefono TEXT,email TEXT,contacto TEXT,limite_credito REAL DEFAULT 0,saldo REAL DEFAULT 0,activo INTEGER DEFAULT 1,creado TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS ventas(id TEXT PRIMARY KEY,numero_factura TEXT,sucursal_id TEXT,cliente_id TEXT,usuario_id TEXT,subtotal REAL,descuento REAL DEFAULT 0,importe_gravado REAL DEFAULT 0,importe_exento REAL DEFAULT 0,importe_exonerado REAL DEFAULT 0,isv15 REAL DEFAULT 0,isv18 REAL DEFAULT 0,total REAL,exonerado INTEGER DEFAULT 0,orden_compra_exenta TEXT,constancia_registro TEXT,identificativo_sag TEXT,estado TEXT DEFAULT 'emitida',fecha TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ventas_suc ON ventas(sucursal_id)`);
  db.run(`CREATE TABLE IF NOT EXISTS venta_items(id INTEGER PRIMARY KEY AUTOINCREMENT,venta_id TEXT,producto_id TEXT,producto_codigo TEXT,producto_nombre TEXT,producto_categoria TEXT,cantidad INTEGER,precio_unit REAL,costo_unit REAL DEFAULT 0,subtotal REAL)`);
  // ── ÓRDENES DE COMPRA — documento administrativo interno, sin ISV/CAI ──────
  db.run(`CREATE TABLE IF NOT EXISTS ordenes_compra(id TEXT PRIMARY KEY,numero_orden TEXT,sucursal_id TEXT,cliente_id TEXT,usuario_id TEXT,emision TEXT,vence TEXT,condicion TEXT DEFAULT 'CONTADO',pagina TEXT DEFAULT '001',subtotal REAL DEFAULT 0,total_impuesto REAL DEFAULT 0,total_descuento REAL DEFAULT 0,total_general REAL DEFAULT 0,nota TEXT,emitido_por TEXT,aprobado_por TEXT,estado TEXT DEFAULT 'emitida',fecha TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS orden_compra_items(id INTEGER PRIMARY KEY AUTOINCREMENT,orden_id TEXT,codigo TEXT,nombre TEXT,unidad TEXT,precio_unit REAL,cantidad REAL,subtotal REAL)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_oc_fecha ON ordenes_compra(fecha)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_oc_suc ON ordenes_compra(sucursal_id)`);
  db.run(`CREATE TABLE IF NOT EXISTS devoluciones(id TEXT PRIMARY KEY,venta_id TEXT,sucursal_id TEXT,usuario_id TEXT,motivo TEXT,total REAL DEFAULT 0,fecha TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS devolucion_items(id INTEGER PRIMARY KEY AUTOINCREMENT,devolucion_id TEXT,producto_id TEXT,cantidad INTEGER,precio_unit REAL,subtotal REAL)`);
  db.run(`CREATE TABLE IF NOT EXISTS compras(id TEXT PRIMARY KEY,proveedor_id TEXT,sucursal_id TEXT,usuario_id TEXT,numero_doc TEXT,subtotal REAL,isv REAL DEFAULT 0,total REAL,estado TEXT DEFAULT 'pendiente',notas TEXT,fecha TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS compra_items(id INTEGER PRIMARY KEY AUTOINCREMENT,compra_id TEXT,producto_id TEXT,producto_nombre TEXT,cantidad INTEGER,costo_unit REAL,subtotal REAL,cantidad_recibida INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS cxc(id TEXT PRIMARY KEY,cliente_id TEXT,sucursal_id TEXT,referencia TEXT,monto REAL,saldo REAL,fecha TEXT,vencimiento TEXT,estado TEXT DEFAULT 'pendiente',creado TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS cxp(id TEXT PRIMARY KEY,proveedor_id TEXT,sucursal_id TEXT,referencia TEXT,monto REAL,saldo REAL,fecha TEXT,vencimiento TEXT,estado TEXT DEFAULT 'pendiente',creado TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS pagos_cxc(id INTEGER PRIMARY KEY AUTOINCREMENT,cxc_id TEXT,monto REAL,usuario_id TEXT,metodo TEXT DEFAULT 'efectivo',banco_id TEXT,fecha TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS pagos_cxp(id INTEGER PRIMARY KEY AUTOINCREMENT,cxp_id TEXT,monto REAL,usuario_id TEXT,fecha TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS config(clave TEXT PRIMARY KEY,valor TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS licencias(id INTEGER PRIMARY KEY AUTOINCREMENT,clave TEXT NOT NULL,tipo TEXT NOT NULL,fecha_activacion TEXT,fecha_vencimiento TEXT,activa INTEGER DEFAULT 1,creado TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS sync_log(id INTEGER PRIMARY KEY AUTOINCREMENT,sucursal_id TEXT,tabla TEXT,operacion TEXT,registro_id TEXT,datos TEXT,fecha TEXT DEFAULT(datetime('now','-6 hours')),sincronizado INTEGER DEFAULT 0)`);
  // ── BANCOS ──
  db.run(`CREATE TABLE IF NOT EXISTS bancos(id TEXT PRIMARY KEY,nombre TEXT NOT NULL,numero_cuenta TEXT,tipo TEXT DEFAULT 'corriente',moneda TEXT DEFAULT 'HNL',saldo_inicial REAL DEFAULT 0,saldo_actual REAL DEFAULT 0,activo INTEGER DEFAULT 1,creado TEXT DEFAULT(datetime('now','-6 hours')))`);
  db.run(`CREATE TABLE IF NOT EXISTS bancos_movimientos(id TEXT PRIMARY KEY,banco_id TEXT NOT NULL,tipo TEXT NOT NULL CHECK(tipo IN('deposito','retiro','transferencia','nota_credito','nota_debito')),fecha TEXT DEFAULT(datetime('now','-6 hours')),monto REAL NOT NULL,descripcion TEXT,referencia TEXT,saldo_anterior REAL DEFAULT 0,saldo_nuevo REAL DEFAULT 0,usuario_id TEXT,FOREIGN KEY(banco_id) REFERENCES bancos(id))`);
  // ── IMPUESTOS ──
  db.run(`CREATE TABLE IF NOT EXISTS impuestos(id TEXT PRIMARY KEY,nombre TEXT NOT NULL,tasa REAL NOT NULL,tipo TEXT DEFAULT 'porcentaje',aplica_a TEXT DEFAULT 'todos',activo INTEGER DEFAULT 1,creado TEXT DEFAULT(datetime('now','-6 hours')))`);
  // ── PERMISOS MÓDULOS POR USUARIO ──
  db.run(`CREATE TABLE IF NOT EXISTS permisos_modulos(id INTEGER PRIMARY KEY AUTOINCREMENT,usuario_id TEXT NOT NULL,modulo TEXT NOT NULL,bloqueado INTEGER DEFAULT 0,UNIQUE(usuario_id,modulo),FOREIGN KEY(usuario_id) REFERENCES usuarios(id))`);
  // ── TURNOS Y FONDO DE CAJA ──
  db.run(`CREATE TABLE IF NOT EXISTS turnos(
    id TEXT PRIMARY KEY,
    sucursal_id TEXT NOT NULL,
    usuario_id TEXT NOT NULL,
    turno_letra TEXT DEFAULT 'A' CHECK(turno_letra IN('A','B','C')),
    fecha_apertura TEXT DEFAULT(datetime('now','-6 hours')),
    fecha_cierre TEXT,
    fondo_inicial REAL DEFAULT 0,
    sin_fondo INTEGER DEFAULT 0,
    total_ventas REAL DEFAULT 0,
    total_efectivo REAL DEFAULT 0,
    total_tarjeta REAL DEFAULT 0,
    total_transferencia REAL DEFAULT 0,
    total_egresos REAL DEFAULT 0,
    efectivo_esperado REAL DEFAULT 0,
    efectivo_contado REAL DEFAULT 0,
    diferencia REAL DEFAULT 0,
    estado TEXT DEFAULT 'abierto' CHECK(estado IN('abierto','cerrado')),
    notas TEXT,
    sobrante REAL DEFAULT 0,
    motivo_sobrante TEXT,
    FOREIGN KEY(sucursal_id) REFERENCES sucursales(id),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS movimientos_caja(
    id TEXT PRIMARY KEY,
    turno_id TEXT NOT NULL,
    sucursal_id TEXT NOT NULL,
    usuario_id TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN('ingreso','egreso')),
    concepto TEXT NOT NULL,
    monto REAL NOT NULL,
    fecha TEXT DEFAULT(datetime('now','-6 hours')),
    FOREIGN KEY(turno_id) REFERENCES turnos(id)
  )`);
  // Migrate ventas: add turno_id column if not exists
  try { db.run(`ALTER TABLE ventas ADD COLUMN turno_id TEXT`); } catch(e) {}
  // Migrate turnos: add columns missing from earlier incomplete versions
  try { db.run(`ALTER TABLE turnos ADD COLUMN total_ventas REAL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN total_efectivo REAL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN total_tarjeta REAL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN total_transferencia REAL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN total_egresos REAL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN efectivo_esperado REAL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN efectivo_contado REAL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN diferencia REAL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN fecha_cierre TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN sin_fondo INTEGER DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN notas TEXT`); } catch(e) {}
  // ── FORMA DE PAGO EN VENTAS ──
  // Migrate: add payment columns to ventas if not exist
  try { db.run(`ALTER TABLE ventas ADD COLUMN forma_pago TEXT DEFAULT 'efectivo'`); } catch(e) {}
  try { db.run(`ALTER TABLE ventas ADD COLUMN monto_recibido REAL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE ventas ADD COLUMN cambio REAL DEFAULT 0`); } catch(e) {}
  // ── FORMA DE PAGO EN COMPRAS + BANCO ──
  try { db.run(`ALTER TABLE compras ADD COLUMN forma_pago TEXT DEFAULT 'efectivo'`); } catch(e) {}
  try { db.run(`ALTER TABLE compras ADD COLUMN banco_id TEXT`); } catch(e) {}
  // ── METODO Y BANCO EN PAGOS CxC ──
  try { db.run(`ALTER TABLE pagos_cxc ADD COLUMN metodo TEXT DEFAULT 'efectivo'`); } catch(e) {}
  try { db.run(`ALTER TABLE pagos_cxc ADD COLUMN banco_id TEXT`); } catch(e) {}
  // ── METODO Y BANCO EN PAGOS CxP ──
  try { db.run(`ALTER TABLE pagos_cxp ADD COLUMN metodo TEXT DEFAULT 'efectivo'`); } catch(e) {}
  try { db.run(`ALTER TABLE pagos_cxp ADD COLUMN banco_id TEXT`); } catch(e) {}
  // ── TABLA DE SERIES DE FACTURACIÓN (múltiples por sucursal) ──
  db.run(`CREATE TABLE IF NOT EXISTS series_factura(
    id TEXT PRIMARY KEY,
    sucursal_id TEXT NOT NULL,
    nombre TEXT,
    serie TEXT NOT NULL,
    cai TEXT,
    rango_ini TEXT,
    rango_fin TEXT,
    fecha_limite TEXT,
    activa INTEGER DEFAULT 1,
    creado TEXT DEFAULT(datetime('now','-6 hours'))
  )`);
  // ── TICKETS DE TURNO ──
  db.run(`CREATE TABLE IF NOT EXISTS tickets(
    id TEXT PRIMARY KEY,
    turno_id TEXT,
    cajero_id TEXT NOT NULL,
    cajero_nombre TEXT,
    turno_letra TEXT,
    fecha_cierre TEXT,
    estado TEXT DEFAULT 'abierto' CHECK(estado IN('abierto','en_revision','resuelto')),
    total_ventas REAL DEFAULT 0,
    reporte_articulos TEXT,
    area TEXT,
    titulo TEXT,
    tipo TEXT,
    descripcion TEXT,
    prioridad TEXT DEFAULT 'media' CHECK(prioridad IN('urgente','alta','media','baja')),
    asignado_a TEXT,
    asignado_nombre TEXT,
    fotos TEXT DEFAULT '[]',
    creado TEXT DEFAULT(datetime('now','-6 hours'))
  )`);
  // Migraciones para BD existentes
  try { db.run(`ALTER TABLE tickets ADD COLUMN area TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE tickets ADD COLUMN titulo TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE tickets ADD COLUMN tipo TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE tickets ADD COLUMN descripcion TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE tickets ADD COLUMN prioridad TEXT DEFAULT 'media'`); } catch(e) {}
  try { db.run(`ALTER TABLE tickets ADD COLUMN asignado_a TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE tickets ADD COLUMN asignado_nombre TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE tickets ADD COLUMN fotos TEXT DEFAULT '[]'`); } catch(e) {}
  try { db.run(`ALTER TABLE tickets ADD COLUMN resolucion TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE tickets ADD COLUMN pdf_resolucion TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE tickets ADD COLUMN pdf_token TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE tickets ADD COLUMN adjunto_token TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE tickets ADD COLUMN adjunto_mime TEXT`); } catch(e) {}
  db.run(`CREATE TABLE IF NOT EXISTS ticket_mensajes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL,
    usuario_id TEXT NOT NULL,
    usuario_nombre TEXT,
    usuario_rol TEXT,
    mensaje TEXT NOT NULL,
    creado TEXT DEFAULT(datetime('now','-6 hours')),
    FOREIGN KEY(ticket_id) REFERENCES tickets(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS whatsapp_numeros(
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    numero TEXT NOT NULL,
    callmebot_apikey TEXT,
    activo INTEGER DEFAULT 1,
    creado TEXT DEFAULT(datetime('now','-6 hours'))
  )`);
  // ── RESUMEN SEMANAL — CallMeBot (gratuito) ───────────────────────────────
  // Cada destinatario tiene su propia API Key de CallMeBot (se obtiene gratis
  // activando el bot desde el WhatsApp de cada número, ver instrucciones en UI).
  db.run(`CREATE TABLE IF NOT EXISTS resumen_semanal_destinatarios(
    id TEXT PRIMARY KEY,
    sucursal_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    numero TEXT NOT NULL,
    callmebot_apikey TEXT NOT NULL,
    activo INTEGER DEFAULT 1,
    creado TEXT DEFAULT(datetime('now','-6 hours'))
  )`);
  // Control de envíos automáticos ya realizados, para no duplicar en el mismo minuto/semana
  db.run(`CREATE TABLE IF NOT EXISTS resumen_semanal_log(
    id TEXT PRIMARY KEY,
    sucursal_id TEXT NOT NULL,
    semana_clave TEXT NOT NULL,
    tipo TEXT NOT NULL,
    enviado_a TEXT,
    ok INTEGER DEFAULT 1,
    detalle TEXT,
    fecha TEXT DEFAULT(datetime('now','-6 hours'))
  )`);
  // Migración para BD existentes
  try { db.run(`ALTER TABLE whatsapp_numeros ADD COLUMN callmebot_apikey TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN turno_letra TEXT DEFAULT 'A'`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN sobrante REAL DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN motivo_sobrante TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN pdf_cierre TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE turnos ADD COLUMN pdf_token TEXT`); } catch(e) {}
  // ── VENTA_ID EN CxC PARA VENTAS A CREDITO ──
  try { db.run(`ALTER TABLE cxc ADD COLUMN venta_id TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE ventas ADD COLUMN serie_id TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE series_factura ADD COLUMN nombre TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE series_factura ADD COLUMN tipo TEXT DEFAULT 'factura'`); } catch(e) {}
  // ── DATOS ADUANEROS — se guardan en la venta para poder reimprimirlos luego ──
  try { db.run(`ALTER TABLE ventas ADD COLUMN aduana_poliza TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE ventas ADD COLUMN aduana_doc_transporte TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE ventas ADD COLUMN aduana_valor_cif TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE ventas ADD COLUMN aduana_num_contenedor TEXT`); } catch(e) {}
  // ── GRAVADO POR ÍTEM — se guarda el estado real de exención de cada artículo ──
  // Antes este dato no se persistía y al reimprimir siempre se asumía "gravado",
  // mostrando ISV incluso en artículos exentos (ej: Formularios DUA, DEVA).
  try { db.run(`ALTER TABLE venta_items ADD COLUMN gravado INTEGER DEFAULT 1`); } catch(e) {}
  try { db.run(`ALTER TABLE venta_items ADD COLUMN tasa_isv REAL DEFAULT 15`); } catch(e) {}
  // Asegurar categoría Servicios e impuesto Exento en instalaciones existentes
  try { db.run(`INSERT OR IGNORE INTO categorias(nombre)VALUES('Servicios')`); } catch(e){}
  try {
    if(!get(`SELECT id FROM impuestos WHERE nombre='Exento' LIMIT 1`)){
      const {v4:_u}=require('uuid');
      run(`INSERT INTO impuestos(id,nombre,tasa,tipo,aplica_a)VALUES(?,?,?,?,?)`,[_u(),'Exento',0,'porcentaje','exentos']);
    }
  } catch(e){}
  console.log('✅ Esquema OK');
}

function seedData(){
  if(get(`SELECT id FROM sucursales LIMIT 1`)) return;
  const sid=uuid();
  db.run(`INSERT INTO sucursales(id,nombre,direccion,telefono,rtn,cai,serie,rango_ini,rango_fin,fecha_limite)VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [sid,'Casa Matriz','Tegucigalpa, Honduras','2234-5678','08011985024566','6542H9-B3C8BC-7442C5-5BD634-5684F5-C0','000-02-01','000-02-01-00017084','000-02-01-00099999','2026-12-31']);
  const hash=bcrypt.hashSync('admin123',10);
  db.run(`INSERT INTO usuarios(id,nombre,username,password,rol,sucursal_id)VALUES(?,?,?,?,?,?)`,
    [uuid(),'Administrador','admin',hash,'admin',sid]);
  const prods=[
    [uuid(),'PROD001','Arroz Premium 5lb','Alimentos',85,55,1],
    [uuid(),'PROD002','Aceite Vegetal 1L','Alimentos',65,40,1],
    [uuid(),'PROD003','Leche Entera 1L','Lácteos',35,22,1],
    [uuid(),'PROD004','Pan Blanco','Panadería',25,15,1],
    [uuid(),'PROD005','Detergente 1kg','Limpieza',95,60,1],
  ];
  for(const p of prods){
    db.run(`INSERT OR IGNORE INTO productos(id,codigo,nombre,categoria,precio_venta,costo,gravado)VALUES(?,?,?,?,?,?,?)`,p);
    db.run(`INSERT OR IGNORE INTO inventario(producto_id,sucursal_id,stock,stock_min)VALUES(?,?,50,10)`,[p[0],sid]);
  }
  db.run(`INSERT INTO clientes(id,nombre,rtn)VALUES(?,?,?)`,[uuid(),'Consumidor Final','']);
  db.run(`INSERT INTO clientes(id,nombre,rtn,telefono,limite_credito)VALUES(?,?,?,?,?)`,[uuid(),'Empresa ABC S.A.','08011990123456','2240-1234',50000]);
  db.run(`INSERT INTO proveedores(id,nombre,rtn,telefono,email)VALUES(?,?,?,?,?)`,[uuid(),'Distribuidora Nacional','08019880001234','2211-0000','ventas@dist.hn']);
  ['Alimentos','Lácteos','Panadería','Limpieza','Bebidas','Varios','Servicios'].forEach(c=>db.run(`INSERT OR IGNORE INTO categorias(nombre)VALUES(?)`,[c]));
  // Impuesto Exento (0%) para servicios
  const {v4:_uuid}=require('uuid');
  if(!get(`SELECT id FROM impuestos WHERE nombre='Exento' LIMIT 1`)){
    run(`INSERT INTO impuestos(id,nombre,tasa,tipo,aplica_a)VALUES(?,?,?,?,?)`,[_uuid(),'Exento',0,'porcentaje','exentos']);
  }
  saveDB();
  console.log('✅ Datos iniciales — admin/admin123');
}

function auth(roles=[]){
  return(req,res,next)=>{
    const t=req.headers.authorization?.split(' ')[1];
    if(!t)return res.status(401).json({error:'Token requerido'});
    try{
      const p=jwt.verify(t,JWT_SECRET);
      req.user=p;
      if(roles.length&&!roles.includes(p.rol))return res.status(403).json({error:'Sin permiso'});
      next();
    }catch{return res.status(401).json({error:'Token inválido'});}
  };
}

function ajustarStock(pid,sid,qty,tipo,ref,motivo,uid,costo=0,precio=0){
  const inv=get(`SELECT stock FROM inventario WHERE producto_id=? AND sucursal_id=?`,[pid,sid]);
  const cur=inv?inv.stock:0;
  const nuevo=(tipo==='entrada'||tipo==='compra')?cur+qty:Math.max(0,cur-qty);
  db.run(`INSERT OR IGNORE INTO inventario(producto_id,sucursal_id,stock,stock_min)VALUES(?,?,0,0)`,[pid,sid]);
  db.run(`UPDATE inventario SET stock=? WHERE producto_id=? AND sucursal_id=?`,[nuevo,pid,sid]);
  db.run(`INSERT INTO kardex(producto_id,sucursal_id,tipo,cantidad,costo_unit,precio_unit,saldo_stock,referencia,motivo,usuario_id)VALUES(?,?,?,?,?,?,?,?,?,?)`,[pid,sid,tipo,qty,costo,precio,nuevo,ref,motivo,uid]);
  return nuevo;
}

// ── AUTH ──
app.post('/api/auth/login',(req,res)=>{
  const{username,password,sucursal_id}=req.body;
  if(!username||!password)return res.status(400).json({error:'Usuario y contraseña requeridos'});
  // Verificar licencia activa
  const lic=getLicenciaActiva();
  if(!lic)return res.status(403).json({error:'Sistema sin licencia activa. Por favor active una licencia.',sinLicencia:true});
  const u=get(`SELECT * FROM usuarios WHERE username=? AND activo=1`,[username]);
  if(!u||!bcrypt.compareSync(password,u.password))return res.status(401).json({error:'Usuario o contraseña incorrectos'});
  // Para admin: usar la sucursal seleccionada si existe, sino la primera sucursal activa
  let sid=u.sucursal_id;
  if(u.rol==='admin'){
    const sucValida=sucursal_id?get(`SELECT id FROM sucursales WHERE id=? AND activa=1`,[sucursal_id]):null;
    if(sucValida)sid=sucursal_id;
    else{const primera=get(`SELECT id FROM sucursales WHERE activa=1`);if(primera)sid=primera.id;}
  }
  const suc=get(`SELECT * FROM sucursales WHERE id=?`,[sid])||get(`SELECT * FROM sucursales WHERE activa=1`);
  const token=jwt.sign({id:u.id,nombre:u.nombre,username:u.username,rol:u.rol,sucursal_id:sid||''},JWT_SECRET,{expiresIn:'12h'});
  res.json({token,user:{id:u.id,nombre:u.nombre,username:u.username,rol:u.rol,sucursal_id:sid},sucursal:suc});
});
app.get('/api/auth/me',auth(),(req,res)=>res.json(get(`SELECT id,nombre,username,rol,sucursal_id FROM usuarios WHERE id=?`,[req.user.id])));

// ── USUARIOS ──
app.get('/api/usuarios',auth(['admin']),(req,res)=>res.json(all(`SELECT u.id,u.nombre,u.username,u.rol,u.activo,u.creado,s.nombre as sucursal_nombre FROM usuarios u LEFT JOIN sucursales s ON s.id=u.sucursal_id`)));
app.post('/api/usuarios',auth(['admin']),(req,res)=>{
  const{nombre,username,password,rol,sucursal_id}=req.body;
  if(get(`SELECT id FROM usuarios WHERE username=?`,[username]))return res.status(400).json({error:'Username ya existe'});
  const sid=sucursal_id||null; const id=uuid(); run(`INSERT INTO usuarios(id,nombre,username,password,rol,sucursal_id)VALUES(?,?,?,?,?,?)`,[id,nombre,username,bcrypt.hashSync(password,10),rol,sid]); saveDB(); res.json({id});
});
app.put('/api/usuarios/:id',auth(['admin']),(req,res)=>{
  const{nombre,rol,sucursal_id,activo,password}=req.body;
  const sid2=sucursal_id||null;
  if(password)run(`UPDATE usuarios SET nombre=?,rol=?,sucursal_id=?,activo=?,password=? WHERE id=?`,[nombre,rol,sid2,activo,bcrypt.hashSync(password,10),req.params.id]);
  else run(`UPDATE usuarios SET nombre=?,rol=?,sucursal_id=?,activo=? WHERE id=?`,[nombre,rol,sid2,activo,req.params.id]);
  saveDB(); res.json({ok:1});
});

// ── SUCURSALES ──
app.get('/api/sucursales',(req,res)=>res.json(all(`SELECT id,nombre FROM sucursales WHERE activa=1`)));
app.post('/api/sucursales',auth(['admin']),(req,res)=>{
  const{nombre,direccion,telefono,rtn,cai,serie,rango_ini,rango_fin,fecha_limite}=req.body;
  const id=uuid(); run(`INSERT INTO sucursales(id,nombre,direccion,telefono,rtn,cai,serie,rango_ini,rango_fin,fecha_limite)VALUES(?,?,?,?,?,?,?,?,?,?)`,[id,nombre,direccion,telefono,rtn,cai,serie,rango_ini,rango_fin,fecha_limite]); saveDB(); res.json({id});
});
app.put('/api/sucursales/:id',auth(['admin']),(req,res)=>{
  try {
    const{nombre,direccion,telefono,rtn,cai,serie,rango_ini,rango_fin,fecha_limite,logo}=req.body;
    run(`UPDATE sucursales SET nombre=?,direccion=?,telefono=?,rtn=?,cai=?,serie=?,rango_ini=?,rango_fin=?,fecha_limite=?,logo=? WHERE id=?`,
      [nombre||'',direccion||'',telefono||'',rtn||'',cai||'',serie||'',rango_ini||'',rango_fin||'',fecha_limite||'',logo||null,req.params.id]);
    saveDB(); res.json({ok:1});
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/sucursales/:id',auth(['admin']),(req,res)=>{
  try {
    // No eliminar si solo queda 1 sucursal activa
    const total = get(`SELECT COUNT(*) as cnt FROM sucursales WHERE activa=1`);
    if(total?.cnt <= 1) return res.status(400).json({error:'No se puede eliminar la única sucursal activa'});
    run(`UPDATE sucursales SET activa=0 WHERE id=?`,[req.params.id]);
    saveDB(); res.json({ok:1});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ── PRODUCTOS ──
app.get('/api/productos',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  const q=req.query.q;
  let sql=`SELECT p.*,COALESCE(i.stock,0) as stock,COALESCE(i.stock_min,0) as stock_min FROM productos p LEFT JOIN inventario i ON i.producto_id=p.id AND i.sucursal_id=? WHERE p.activo=1`;
  const params=[suc];
  if(q){sql+=` AND (p.nombre LIKE ? OR p.codigo LIKE ?)`; params.push(`%${q}%`,`%${q}%`);}
  sql+=` ORDER BY p.nombre`;
  res.json(all(sql,params));
});
app.get('/api/productos/barcode/:codigo',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  const p=get(`SELECT p.*,COALESCE(i.stock,0) as stock FROM productos p LEFT JOIN inventario i ON i.producto_id=p.id AND i.sucursal_id=? WHERE p.codigo=? AND p.activo=1`,[suc,req.params.codigo]);
  if(!p)return res.status(404).json({error:'No encontrado'}); res.json(p);
});
app.post('/api/productos',auth(['admin','supervisor']),(req,res)=>{
  const{codigo,nombre,categoria,precio_venta,costo,gravado,stock,stock_min}=req.body;
  if(get(`SELECT id FROM productos WHERE codigo=?`,[codigo]))return res.status(400).json({error:'Código ya existe'});
  const id=uuid();
  run(`INSERT INTO productos(id,codigo,nombre,categoria,precio_venta,costo,gravado)VALUES(?,?,?,?,?,?,?)`,[id,codigo,nombre,categoria,precio_venta,costo||0,gravado!==false?1:0]);
  const suc=req.user.sucursal_id;
  const initStock=parseInt(stock)||0;
  const initMin=parseInt(stock_min)||0;
  all(`SELECT id FROM sucursales WHERE activa=1`).forEach(s=>{
    run(`INSERT OR IGNORE INTO inventario(producto_id,sucursal_id,stock,stock_min)VALUES(?,?,0,0)`,[id,s.id]);
  });
  if(initStock>0){
    run(`UPDATE inventario SET stock=?,stock_min=? WHERE producto_id=? AND sucursal_id=?`,[initStock,initMin,id,suc]);
    run(`INSERT INTO kardex(producto_id,sucursal_id,tipo,cantidad,costo_unit,precio_unit,saldo_stock,referencia,motivo,usuario_id)VALUES(?,?,?,?,?,?,?,?,?,?)`,[id,suc,'entrada',initStock,costo||0,precio_venta||0,initStock,'ALTA','Stock inicial',req.user.id]);
  } else if(initMin>0){
    run(`UPDATE inventario SET stock_min=? WHERE producto_id=? AND sucursal_id=?`,[initMin,id,suc]);
  }
  saveDB(); res.json({id});
});
app.put('/api/productos/:id',auth(['admin','supervisor']),(req,res)=>{
  const{nombre,categoria,precio_venta,costo,gravado,stock_min}=req.body;
  run(`UPDATE productos SET nombre=?,categoria=?,precio_venta=?,costo=?,gravado=? WHERE id=?`,[nombre,categoria,precio_venta,costo||0,gravado!==false?1:0,req.params.id]);
  if(stock_min!==undefined){
    const suc=req.user.sucursal_id;
    run(`INSERT OR IGNORE INTO inventario(producto_id,sucursal_id,stock,stock_min)VALUES(?,?,0,0)`,[req.params.id,suc]);
    run(`UPDATE inventario SET stock_min=? WHERE producto_id=? AND sucursal_id=?`,[parseInt(stock_min)||0,req.params.id,suc]);
  }
  saveDB(); res.json({ok:1});
});
app.delete('/api/productos/:id',auth(['admin']),(req,res)=>{ run(`UPDATE productos SET activo=0 WHERE id=?`,[req.params.id]); saveDB(); res.json({ok:1}); });

// ── INVENTARIO/KARDEX ──
app.get('/api/inventario',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  res.json(all(`SELECT p.id,p.codigo,p.nombre,p.categoria,p.precio_venta,p.costo,COALESCE(i.stock,0)as stock,COALESCE(i.stock_min,0)as stock_min FROM productos p LEFT JOIN inventario i ON i.producto_id=p.id AND i.sucursal_id=? WHERE p.activo=1 ORDER BY p.categoria,p.nombre`,[suc]));
});
app.post('/api/inventario/ajuste',auth(['admin','supervisor']),(req,res)=>{
  const{producto_id,sucursal_id,tipo,cantidad,motivo,costo}=req.body;
  const suc=sucursal_id||req.user.sucursal_id;
  const nuevo=ajustarStock(producto_id,suc,cantidad,tipo,'AJUSTE',motivo,req.user.id,costo||0); saveDB(); res.json({stock:nuevo});
});
app.put('/api/inventario/stock_min',auth(['admin','supervisor']),(req,res)=>{
  const{producto_id,sucursal_id,stock_min}=req.body;
  run(`UPDATE inventario SET stock_min=? WHERE producto_id=? AND sucursal_id=?`,[stock_min,producto_id,sucursal_id||req.user.sucursal_id]); saveDB(); res.json({ok:1});
});
app.get('/api/kardex/:pid',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  res.json(all(`SELECT k.*,u.nombre as usuario_nombre FROM kardex k LEFT JOIN usuarios u ON u.id=k.usuario_id WHERE k.producto_id=? AND k.sucursal_id=? ORDER BY k.fecha DESC LIMIT 200`,[req.params.pid,suc]));
});

// ── CLIENTES ──
app.get('/api/clientes',auth(),(req,res)=>res.json(all(`SELECT * FROM clientes WHERE activo=1 ORDER BY nombre`)));
// ── IMPORTAR CLIENTES DESDE EXCEL ──
app.post('/api/clientes/importar_excel',auth(['admin','supervisor']),(req,res)=>{
  const{clientes}=req.body;
  if(!Array.isArray(clientes)||clientes.length===0)return res.status(400).json({error:'Sin datos'});
  let creados=0,actualizados=0,errores=[];
  for(const c of clientes){
    try{
      const nombre=(c.nombre||'').toString().trim();
      if(!nombre){errores.push({nombre:'(vacío)',error:'Nombre requerido'});continue;}
      const exist=get(`SELECT id FROM clientes WHERE nombre=? COLLATE NOCASE`,[nombre]);
      if(exist){
        run(`UPDATE clientes SET rtn=?,direccion=?,telefono=?,email=?,limite_credito=? WHERE id=?`,
          [(c.rtn||'').toString().trim(),(c.direccion||'').toString().trim(),
           (c.telefono||'').toString().trim(),(c.email||'').toString().trim(),
           parseFloat(c.limite_credito)||0,exist.id]);
        actualizados++;
      }else{
        run(`INSERT INTO clientes(id,nombre,rtn,direccion,telefono,email,limite_credito)VALUES(?,?,?,?,?,?,?)`,
          [uuid(),nombre,(c.rtn||'').toString().trim(),(c.direccion||'').toString().trim(),
           (c.telefono||'').toString().trim(),(c.email||'').toString().trim(),
           parseFloat(c.limite_credito)||0]);
        creados++;
      }
    }catch(e){errores.push({nombre:c.nombre,error:e.message});}
  }
  saveDB(); res.json({creados,actualizados,errores,total:clientes.length});
});

app.post('/api/clientes',auth(['admin','supervisor','cajero']),(req,res)=>{
  const{nombre,rtn,direccion,telefono,email,limite_credito}=req.body;
  const id=uuid(); run(`INSERT INTO clientes(id,nombre,rtn,direccion,telefono,email,limite_credito)VALUES(?,?,?,?,?,?,?)`,[id,nombre,rtn||'',direccion||'',telefono||'',email||'',limite_credito||0]); saveDB(); res.json({id});
});
app.put('/api/clientes/:id',auth(['admin','supervisor']),(req,res)=>{
  const{nombre,rtn,direccion,telefono,email,limite_credito}=req.body;
  run(`UPDATE clientes SET nombre=?,rtn=?,direccion=?,telefono=?,email=?,limite_credito=? WHERE id=?`,[nombre,rtn||'',direccion||'',telefono||'',email||'',limite_credito||0,req.params.id]); saveDB(); res.json({ok:1});
});
app.delete('/api/clientes/:id',auth(['admin']),(req,res)=>{ run(`UPDATE clientes SET activo=0 WHERE id=?`,[req.params.id]); saveDB(); res.json({ok:1}); });

// ── PROVEEDORES ──
app.get('/api/proveedores',auth(),(req,res)=>res.json(all(`SELECT * FROM proveedores WHERE activo=1 ORDER BY nombre`)));
// ── IMPORTAR PROVEEDORES DESDE EXCEL ──
app.post('/api/proveedores/importar_excel',auth(['admin','supervisor']),(req,res)=>{
  const{proveedores}=req.body;
  if(!Array.isArray(proveedores)||proveedores.length===0)return res.status(400).json({error:'Sin datos'});
  let creados=0,actualizados=0,errores=[];
  for(const p of proveedores){
    try{
      const nombre=(p.nombre||'').toString().trim();
      if(!nombre){errores.push({nombre:'(vacío)',error:'Nombre requerido'});continue;}
      const exist=get(`SELECT id FROM proveedores WHERE nombre=? COLLATE NOCASE`,[nombre]);
      if(exist){
        run(`UPDATE proveedores SET rtn=?,contacto=?,telefono=?,email=?,direccion=?,limite_credito=? WHERE id=?`,
          [(p.rtn||'').toString().trim(),(p.contacto||'').toString().trim(),
           (p.telefono||'').toString().trim(),(p.email||'').toString().trim(),
           (p.direccion||'').toString().trim(),parseFloat(p.limite_credito)||0,exist.id]);
        actualizados++;
      }else{
        run(`INSERT INTO proveedores(id,nombre,rtn,contacto,telefono,email,direccion,limite_credito)VALUES(?,?,?,?,?,?,?,?)`,
          [uuid(),nombre,(p.rtn||'').toString().trim(),(p.contacto||'').toString().trim(),
           (p.telefono||'').toString().trim(),(p.email||'').toString().trim(),
           (p.direccion||'').toString().trim(),parseFloat(p.limite_credito)||0]);
        creados++;
      }
    }catch(e){errores.push({nombre:p.nombre,error:e.message});}
  }
  saveDB(); res.json({creados,actualizados,errores,total:proveedores.length});
});

app.post('/api/proveedores',auth(['admin','supervisor']),(req,res)=>{
  const{nombre,rtn,direccion,telefono,email,contacto,limite_credito}=req.body;
  const id=uuid(); run(`INSERT INTO proveedores(id,nombre,rtn,direccion,telefono,email,contacto,limite_credito)VALUES(?,?,?,?,?,?,?,?)`,[id,nombre,rtn||'',direccion||'',telefono||'',email||'',contacto||'',limite_credito||0]); saveDB(); res.json({id});
});
app.put('/api/proveedores/:id',auth(['admin','supervisor']),(req,res)=>{
  const{nombre,rtn,direccion,telefono,email,contacto,limite_credito}=req.body;
  run(`UPDATE proveedores SET nombre=?,rtn=?,direccion=?,telefono=?,email=?,contacto=?,limite_credito=? WHERE id=?`,[nombre,rtn||'',direccion||'',telefono||'',email||'',contacto||'',limite_credito||0,req.params.id]); saveDB(); res.json({ok:1});
});
app.delete('/api/proveedores/:id',auth(['admin']),(req,res)=>{ run(`UPDATE proveedores SET activo=0 WHERE id=?`,[req.params.id]); saveDB(); res.json({ok:1}); });

// ── VENTAS ──
app.get('/api/ventas',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  const{fecha_ini,fecha_fin,limite}=req.query;
  let sql=`SELECT v.*,c.nombre as cliente_nombre,c.rtn as cliente_rtn,u.nombre as usuario_nombre FROM ventas v LEFT JOIN clientes c ON c.id=v.cliente_id LEFT JOIN usuarios u ON u.id=v.usuario_id WHERE v.sucursal_id=?`;
  const params=[suc];
  if(fecha_ini){sql+=` AND date(v.fecha)>=?`;params.push(fecha_ini);}
  if(fecha_fin){sql+=` AND date(v.fecha)<=?`;params.push(fecha_fin);}
  if(req.query.serie){sql+=` AND v.numero_factura LIKE ?`;params.push(req.query.serie.replace(/-+$/,'')+'%');}
  sql+=` ORDER BY v.fecha DESC LIMIT ?`;params.push(parseInt(limite)||500);
  res.json(all(sql,params));
});
app.get('/api/ventas/:id/items',auth(),(req,res)=>res.json(all(`SELECT * FROM venta_items WHERE venta_id=?`,[req.params.id])));

// ── CORRECCIÓN RETROACTIVA DE ÍTEMS (admin/supervisor) ───────────────────────
// Permite corregir el estado de exención (gravado) de un ítem de una venta YA
// EMITIDA, sin anularla ni cambiar su número de factura. Recalcula automática-
// mente importe_gravado, importe_exento, isv15, isv18 y total de la venta.
app.put('/api/ventas/:ventaId/items/:itemId/gravado', auth(['admin','supervisor']), (req,res) => {
  const { gravado, tasa_isv } = req.body;
  const venta = get(`SELECT * FROM ventas WHERE id=? AND sucursal_id=?`,[req.params.ventaId, req.user.sucursal_id]);
  if (!venta) return res.status(404).json({error:'Venta no encontrada'});
  const item = get(`SELECT * FROM venta_items WHERE id=? AND venta_id=?`,[req.params.itemId, req.params.ventaId]);
  if (!item) return res.status(404).json({error:'Ítem no encontrado en esta venta'});

  run(`UPDATE venta_items SET gravado=?, tasa_isv=? WHERE id=?`,
    [gravado?1:0, tasa_isv||item.tasa_isv||15, req.params.itemId]);

  // Recalcular los totales de la venta completa a partir de TODOS sus ítems actualizados
  const todosItems = all(`SELECT * FROM venta_items WHERE venta_id=?`,[req.params.ventaId]);
  let importeGravado=0, importeExento=0, isv15=0, isv18=0;
  todosItems.forEach(i => {
    const base = (i.precio_unit||0) * (i.cantidad||0);
    const esGravado = i.gravado !== 0 && i.gravado !== null && i.gravado !== undefined ? i.gravado : 1;
    if (esGravado) {
      const tasa = i.tasa_isv || 15;
      importeGravado += base;
      const isvItem = base * (tasa/100);
      if (tasa === 18) isv18 += isvItem; else isv15 += isvItem;
    } else {
      importeExento += base;
    }
  });
  const nuevoTotal = importeGravado + importeExento + isv15 + isv18 - (venta.descuento||0);

  run(`UPDATE ventas SET importe_gravado=?, importe_exento=?, isv15=?, isv18=?, total=? WHERE id=?`,
    [importeGravado, importeExento, isv15, isv18, nuevoTotal, req.params.ventaId]);
  saveDB();
  res.json({ ok:true, importeGravado, importeExento, isv15, isv18, total: nuevoTotal });
});

// ══════════════════════════════════════════════════════════════════════════
//  ÓRDENES DE COMPRA — documento administrativo interno (sin ISV/CAI/SAR)
// ══════════════════════════════════════════════════════════════════════════

// Listar órdenes de la sucursal (más recientes primero)
app.get('/api/ordenes_compra',auth(),(req,res)=>{
  const suc = req.user.sucursal_id;
  const ordenes = all(`SELECT o.*, c.nombre as cliente_nombre, c.rtn as cliente_rtn, c.direccion as cliente_direccion, c.telefono as cliente_telefono
                       FROM ordenes_compra o LEFT JOIN clientes c ON c.id=o.cliente_id
                       WHERE o.sucursal_id=? ORDER BY o.fecha DESC LIMIT 200`,[suc]);
  res.json(ordenes);
});

// Obtener una orden específica con sus ítems
app.get('/api/ordenes_compra/:id',auth(),(req,res)=>{
  const o = get(`SELECT o.*, c.nombre as cliente_nombre, c.rtn as cliente_rtn, c.direccion as cliente_direccion, c.telefono as cliente_telefono
                 FROM ordenes_compra o LEFT JOIN clientes c ON c.id=o.cliente_id
                 WHERE o.id=?`,[req.params.id]);
  if(!o) return res.status(404).json({error:'Orden no encontrada'});
  const items = all(`SELECT * FROM orden_compra_items WHERE orden_id=? ORDER BY id ASC`,[req.params.id]);
  res.json({...o, items});
});

// Buscar órdenes por número (parcial) y/o rango de fechas — para reimpresión
app.get('/api/ordenes_compra/buscar_reimpresion',auth(),(req,res)=>{
  const suc = req.user.sucursal_id;
  const { numero, fecha_ini, fecha_fin } = req.query;
  const numeroLimpio = (numero||'').trim();
  if(!numeroLimpio && !fecha_ini && !fecha_fin){
    return res.status(400).json({error:'Debe indicar un número de orden o un rango de fechas'});
  }
  let sql = `SELECT o.*, c.nombre as cliente_nombre, c.rtn as cliente_rtn, c.direccion as cliente_direccion, c.telefono as cliente_telefono
             FROM ordenes_compra o LEFT JOIN clientes c ON c.id=o.cliente_id WHERE o.sucursal_id=?`;
  const params=[suc];
  if(numeroLimpio){ sql+=` AND o.numero_orden LIKE ?`; params.push('%'+numeroLimpio+'%'); }
  if(fecha_ini){ sql+=` AND date(o.fecha)>=?`; params.push(fecha_ini); }
  if(fecha_fin){ sql+=` AND date(o.fecha)<=?`; params.push(fecha_fin); }
  sql+=` ORDER BY o.fecha DESC LIMIT 100`;
  const ordenes = all(sql,params);
  const resultado = ordenes.map(o=>({
    ...o,
    items: all(`SELECT * FROM orden_compra_items WHERE orden_id=? ORDER BY id ASC`,[o.id])
  }));
  res.json(resultado);
});

// Crear una nueva Orden de Compra
app.post('/api/ordenes_compra',auth(),(req,res)=>{
  const{cliente_id,emision,vence,condicion,items,nota,emitido_por,aprobado_por}=req.body;
  const suc=req.user.sucursal_id;
  if(!items||!items.length) return res.status(400).json({error:'Debe agregar al menos un artículo'});

  // Correlativo propio de Órdenes de Compra (formato 0000-XXXX), independiente del SAR
  const lastOC = get(`SELECT numero_orden FROM ordenes_compra WHERE sucursal_id=? ORDER BY fecha DESC LIMIT 1`,[suc]);
  let nextNum = 1;
  if(lastOC && lastOC.numero_orden){
    const partes = lastOC.numero_orden.split('-');
    const ultimo = parseInt(partes[partes.length-1]);
    if(!isNaN(ultimo)) nextNum = ultimo+1;
  }
  const numero_orden = `0000-${String(nextNum).padStart(4,'0')}`;

  const subtotal = items.reduce((s,i)=>s+(parseFloat(i.precio_unit)||0)*(parseFloat(i.cantidad)||0),0);
  const total_impuesto = 0; // Las Órdenes de Compra de Agencia Aduanera no llevan ISV
  const total_descuento = 0;
  const total_general = subtotal - total_descuento + total_impuesto;

  const id=uuid();
  db.run(`INSERT INTO ordenes_compra(id,numero_orden,sucursal_id,cliente_id,usuario_id,emision,vence,condicion,pagina,subtotal,total_impuesto,total_descuento,total_general,nota,emitido_por,aprobado_por)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,numero_orden,suc,cliente_id||null,req.user.id,emision||todayHN(),vence||emision||todayHN(),condicion||'CONTADO','001',subtotal,total_impuesto,total_descuento,total_general,nota||'',emitido_por||req.user.nombre||'',aprobado_por||'']);

  for(const it of items){
    const cant = parseFloat(it.cantidad)||0;
    const precio = parseFloat(it.precio_unit)||0;
    db.run(`INSERT INTO orden_compra_items(orden_id,codigo,nombre,unidad,precio_unit,cantidad,subtotal)VALUES(?,?,?,?,?,?,?)`,
      [id,it.codigo||'',it.nombre||'',it.unidad||'',precio,cant,precio*cant]);
  }
  saveDB();
  res.json({id,numero_orden,total_general});
});

// Actualizar estado / nota / aprobado_por de una orden existente
app.put('/api/ordenes_compra/:id',auth(['admin','supervisor']),(req,res)=>{
  const{estado,nota,aprobado_por}=req.body;
  const o=get(`SELECT id FROM ordenes_compra WHERE id=? AND sucursal_id=?`,[req.params.id,req.user.sucursal_id]);
  if(!o) return res.status(404).json({error:'Orden no encontrada'});
  if(estado!==undefined) run(`UPDATE ordenes_compra SET estado=? WHERE id=?`,[estado,req.params.id]);
  if(nota!==undefined) run(`UPDATE ordenes_compra SET nota=? WHERE id=?`,[nota,req.params.id]);
  if(aprobado_por!==undefined) run(`UPDATE ordenes_compra SET aprobado_por=? WHERE id=?`,[aprobado_por,req.params.id]);
  saveDB();
  res.json({ok:1});
});

// Eliminar (anular) una orden
app.delete('/api/ordenes_compra/:id',auth(['admin','supervisor']),(req,res)=>{
  const o=get(`SELECT id FROM ordenes_compra WHERE id=? AND sucursal_id=?`,[req.params.id,req.user.sucursal_id]);
  if(!o) return res.status(404).json({error:'Orden no encontrada'});
  run(`DELETE FROM orden_compra_items WHERE orden_id=?`,[req.params.id]);
  run(`DELETE FROM ordenes_compra WHERE id=?`,[req.params.id]);
  saveDB();
  res.json({ok:1});
});

// ── BUSCAR VENTA PARA REIMPRESIÓN (Factura o Nota de Débito) ────────────────
// Busca por número de factura exacto o parcial, devuelve todo lo necesario
// para reconstruir e imprimir el documento (items, cliente, serie/CAI propio).
app.get('/api/ventas/buscar_reimpresion',auth(),(req,res)=>{
  const suc = req.user.sucursal_id;
  const { numero, tipo, fecha_ini, fecha_fin } = req.query; // tipo: 'factura' | 'nota_debito' | vacío=todas
  const numeroLimpio = (numero||'').trim();
  if (!numeroLimpio && !fecha_ini && !fecha_fin) {
    return res.status(400).json({error:'Debe indicar un número de documento o un rango de fechas'});
  }

  let sql = `SELECT v.*, c.nombre as cliente_nombre, c.rtn as cliente_rtn
             FROM ventas v LEFT JOIN clientes c ON c.id=v.cliente_id
             WHERE v.sucursal_id=?`;
  const params = [suc];

  if (numeroLimpio) {
    sql += ` AND v.numero_factura LIKE ?`;
    params.push('%'+numeroLimpio+'%');
  }
  if (fecha_ini) { sql += ` AND date(v.fecha)>=?`; params.push(fecha_ini); }
  if (fecha_fin) { sql += ` AND date(v.fecha)<=?`; params.push(fecha_fin); }

  // Si se especifica tipo, filtrar por el tipo de la serie asociada
  if (tipo) {
    sql += ` AND v.serie_id IN (SELECT id FROM series_factura WHERE tipo=?)`;
    params.push(tipo);
  }
  sql += ` ORDER BY v.fecha DESC LIMIT 100`;

  const ventas = all(sql, params);
  const resultado = ventas.map(v => {
    const items = all(`SELECT * FROM venta_items WHERE venta_id=?`,[v.id]);
    let serieDatos = {};
    if (v.serie_id) {
      serieDatos = get(`SELECT cai,rango_ini,rango_fin,fecha_limite,tipo,nombre,serie FROM series_factura WHERE id=?`,[v.serie_id]) || {};
    }
    return {
      ...v,
      cliente: { nombre: v.cliente_nombre||'Consumidor Final', rtn: v.cliente_rtn||'' },
      items: items.map(i => ({
        id: i.id, codigo: i.producto_codigo, nombre: i.producto_nombre, categoria: i.producto_categoria,
        cantidad: i.cantidad, precio: i.precio_unit,
        // Gravado real del ítem (columna agregada — ventas anteriores a este cambio
        // no la tienen y caerán al valor DEFAULT 1, que es el comportamiento previo)
        gravado: i.gravado !== undefined && i.gravado !== null ? i.gravado : 1,
        tasaIsv: i.tasa_isv || 15
      })),
      serieCai: serieDatos.cai || '',
      serieRangoIni: serieDatos.rango_ini || '',
      serieRangoFin: serieDatos.rango_fin || '',
      serieFechaLimite: serieDatos.fecha_limite || '',
      serieTipo: serieDatos.tipo || 'factura',
    };
  });
  res.json(resultado);
});
app.post('/api/ventas',auth(),(req,res)=>{
  const{cliente_id,items,subtotal,descuento,importe_gravado,importe_exento,importe_exonerado,isv15,isv18,total,exonerado,orden_compra_exenta,constancia_registro,identificativo_sag,forma_pago,monto_recibido,cambio,turno_id,banco_id,serie_id,aduana_poliza,aduana_doc_transporte,aduana_valor_cif,aduana_num_contenedor}=req.body;
  const suc=req.user.sucursal_id;
  const sucursal=get(`SELECT * FROM sucursales WHERE id=?`,[suc]);
  if(!sucursal)return res.status(400).json({error:'Sucursal no encontrada'});
  // Determinar la serie a usar: si viene serie_id usar esa serie, si no la de la sucursal
  let serieConfig = null;
  if(serie_id){
    serieConfig = get(`SELECT * FROM series_factura WHERE id=? AND activa=1`,[serie_id]);
  }
  // Datos de la serie activa (serie específica o configuración de la sucursal)
  const serieActual   = serieConfig ? serieConfig.serie     : (sucursal.serie||'');
  const rango_ini_act = serieConfig ? serieConfig.rango_ini : (sucursal.rango_ini||'');
  const cai_act       = serieConfig ? serieConfig.cai       : (sucursal.cai||'');
  const fecha_lim_act = serieConfig ? serieConfig.fecha_limite : (sucursal.fecha_limite||'');

  // Último número de esta serie específica
  const serieLimpia = serieActual.replace(/-+$/,'');
  const lastF = get(
    `SELECT numero_factura FROM ventas WHERE sucursal_id=? AND numero_factura LIKE ? ORDER BY fecha DESC LIMIT 1`,
    [suc, serieLimpia+'%']
  );
  let nextNum;
  if(lastF){
    const partes=lastF.numero_factura.split('-');
    nextNum=parseInt(partes[partes.length-1])+1;
  } else {
    const riniPartes=rango_ini_act.split('-');
    nextNum=parseInt(riniPartes[riniPartes.length-1])||1;
  }
  const numero_factura=`${serieLimpia}-${String(nextNum).padStart(8,'0')}`;
  const id=uuid();
  db.run(`INSERT INTO ventas(id,numero_factura,sucursal_id,cliente_id,usuario_id,subtotal,descuento,importe_gravado,importe_exento,importe_exonerado,isv15,isv18,total,exonerado,orden_compra_exenta,constancia_registro,identificativo_sag,forma_pago,monto_recibido,cambio,turno_id,serie_id,aduana_poliza,aduana_doc_transporte,aduana_valor_cif,aduana_num_contenedor)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,numero_factura,suc,cliente_id,req.user.id,subtotal,descuento||0,importe_gravado||0,importe_exento||0,importe_exonerado||0,isv15||0,isv18||0,total,exonerado?1:0,orden_compra_exenta||'',constancia_registro||'',identificativo_sag||'',forma_pago||'efectivo',monto_recibido||0,cambio||0,turno_id||null,serie_id||null,aduana_poliza||'',aduana_doc_transporte||'',aduana_valor_cif||'',aduana_num_contenedor||'']);
  for(const item of items){
    const prod=get(`SELECT costo,gravado FROM productos WHERE id=?`,[item.id]);
    // El estado de exención se toma del producto real en la BD (fuente de verdad).
    // Si el ítem no corresponde a un producto existente (ej: ítem libre), se usa
    // el valor que venga en el item del carrito como respaldo.
    const gravadoReal = prod ? (prod.gravado ? 1 : 0) : (item.gravado ? 1 : 0);
    const tasaReal = item.tasaIsv || 15;
    db.run(`INSERT INTO venta_items(venta_id,producto_id,producto_codigo,producto_nombre,producto_categoria,cantidad,precio_unit,costo_unit,subtotal,gravado,tasa_isv)VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[id,item.id,item.codigo,item.nombre,item.categoria||'',item.cantidad,item.precio,prod?.costo||0,item.cantidad*item.precio,gravadoReal,tasaReal]);
    ajustarStock(item.id,suc,item.cantidad,'venta',numero_factura,'Venta POS',req.user.id,prod?.costo||0,item.precio);
  }
  // Si la venta es a crédito, crear CxC automáticamente
  if ((forma_pago||'efectivo') === 'credito' && cliente_id) {
    const hoy = todayHN();
    const venc = new Date(); venc.setDate(venc.getDate() + 30);
    const vencStr = venc.toISOString().substring(0,10);
    const cxcId = uuid();
    db.run(`INSERT INTO cxc(id,cliente_id,sucursal_id,referencia,monto,saldo,fecha,vencimiento,venta_id)VALUES(?,?,?,?,?,?,?,?,?)`,
      [cxcId, cliente_id, suc, numero_factura, total, total, hoy, vencStr, id]);
    // Actualizar saldo del cliente
    db.run(`UPDATE clientes SET saldo=saldo+? WHERE id=?`,[total, cliente_id]);
  }
  // Si el pago es por transferencia o tarjeta, registrar movimiento en banco
  if((forma_pago==='transferencia'||forma_pago==='tarjeta')&&banco_id){
    const banco=get(`SELECT * FROM bancos WHERE id=?`,[banco_id]);
    if(banco){
      const saldo_ant=banco.saldo_actual;
      const saldo_nuevo=saldo_ant+total;
      const mid=uuid();
      run(`INSERT INTO bancos_movimientos(id,banco_id,tipo,fecha,monto,descripcion,referencia,saldo_anterior,saldo_nuevo,usuario_id)VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [mid,banco_id,'deposito',nowHN(),total,`Venta ${forma_pago} — ${numero_factura}`,numero_factura,saldo_ant,saldo_nuevo,req.user.id]);
      run(`UPDATE bancos SET saldo_actual=? WHERE id=?`,[saldo_nuevo,banco_id]);
    }
  }
  saveDB(); res.json({id,numero_factura});
});
app.post('/api/ventas/:id/anular',auth(['admin','supervisor']),(req,res)=>{
  const v=get(`SELECT * FROM ventas WHERE id=?`,[req.params.id]);
  if(!v)return res.status(404).json({error:'No encontrada'});
  if(v.estado==='anulada')return res.status(400).json({error:'Ya anulada'});
  all(`SELECT * FROM venta_items WHERE venta_id=?`,[req.params.id]).forEach(i=>ajustarStock(i.producto_id,v.sucursal_id,i.cantidad,'entrada',`ANULACION-${v.numero_factura}`,'Anulación',req.user.id,i.costo_unit,i.precio_unit));
  run(`UPDATE ventas SET estado='anulada' WHERE id=?`,[req.params.id]); saveDB(); res.json({ok:1});
});

// ── DEVOLUCIONES ──
app.get('/api/devoluciones',auth(),(req,res)=>{
  const suc=req.user.sucursal_id;
  res.json(all(`SELECT d.*,v.numero_factura,u.nombre as usuario_nombre FROM devoluciones d JOIN ventas v ON v.id=d.venta_id LEFT JOIN usuarios u ON u.id=d.usuario_id WHERE d.sucursal_id=? ORDER BY d.fecha DESC`,[suc]));
});
app.post('/api/devoluciones',auth(['admin','supervisor']),(req,res)=>{
  const{venta_id,items,motivo}=req.body;
  const v=get(`SELECT * FROM ventas WHERE id=?`,[venta_id]);
  if(!v)return res.status(404).json({error:'Venta no encontrada'});
  const id=uuid();
  const total=items.reduce((s,i)=>s+i.cantidad*i.precio_unit,0);
  run(`INSERT INTO devoluciones(id,venta_id,sucursal_id,usuario_id,motivo,total)VALUES(?,?,?,?,?,?)`,[id,venta_id,v.sucursal_id,req.user.id,motivo,total]);
  for(const item of items){
    run(`INSERT INTO devolucion_items(devolucion_id,producto_id,cantidad,precio_unit,subtotal)VALUES(?,?,?,?,?)`,[id,item.producto_id,item.cantidad,item.precio_unit,item.cantidad*item.precio_unit]);
    ajustarStock(item.producto_id,v.sucursal_id,item.cantidad,'devolucion',`DEV-${id}`,motivo,req.user.id,0,item.precio_unit);
  }
  run(`UPDATE ventas SET estado='devolucion_parcial' WHERE id=?`,[venta_id]);
  saveDB(); res.json({id,total});
});
app.get('/api/devoluciones/:id/items',auth(),(req,res)=>res.json(all(`SELECT * FROM devolucion_items WHERE devolucion_id=?`,[req.params.id])));

// ── COMPRAS ──
app.get('/api/compras',auth(),(req,res)=>{
  const suc=req.user.sucursal_id;
  res.json(all(`SELECT c.*,p.nombre as proveedor_nombre,u.nombre as usuario_nombre FROM compras c LEFT JOIN proveedores p ON p.id=c.proveedor_id LEFT JOIN usuarios u ON u.id=c.usuario_id WHERE c.sucursal_id=? ORDER BY c.fecha DESC`,[suc]));
});
app.get('/api/compras/:id/items',auth(),(req,res)=>res.json(all(`SELECT * FROM compra_items WHERE compra_id=?`,[req.params.id])));
app.post('/api/compras',auth(['admin','supervisor']),(req,res)=>{
  const{proveedor_id,items,numero_doc,notas,forma_pago,banco_id,vencimiento}=req.body;
  const suc=req.user.sucursal_id;
  const id=uuid();
  const subtotal=items.reduce((s,i)=>s+i.cantidad*i.costo_unit,0);
  run(`INSERT INTO compras(id,proveedor_id,sucursal_id,usuario_id,numero_doc,subtotal,isv,total,notas,forma_pago,banco_id)VALUES(?,?,?,?,?,?,0,?,?,?,?)`,[id,proveedor_id,suc,req.user.id,numero_doc||'',subtotal,subtotal,notas||'',forma_pago||'efectivo',banco_id||null]);
  for(const item of items){
    const pn=get(`SELECT nombre FROM productos WHERE id=?`,[item.producto_id]);
    run(`INSERT INTO compra_items(compra_id,producto_id,producto_nombre,cantidad,costo_unit,subtotal,cantidad_recibida)VALUES(?,?,?,?,?,?,0)`,[id,item.producto_id,pn?.nombre||'',item.cantidad,item.costo_unit,item.cantidad*item.costo_unit]);
  }
  // Si la compra es a crédito, crear CxP automáticamente
  if((forma_pago||'efectivo')==='credito'){
    const hoy=todayHN();
    const venc=vencimiento||new Date(new Date().setDate(new Date().getDate()+30)).toISOString().substring(0,10);
    const cxpId=uuid();
    run(`INSERT INTO cxp(id,proveedor_id,sucursal_id,referencia,monto,saldo,fecha,vencimiento)VALUES(?,?,?,?,?,?,?,?)`,
      [cxpId,proveedor_id,suc,numero_doc||id,subtotal,subtotal,hoy,venc]);
    run(`UPDATE proveedores SET saldo=saldo+? WHERE id=?`,[subtotal,proveedor_id]);
  }
  // Si paga con transferencia o tarjeta y hay banco, registrar movimiento
  if((forma_pago==='transferencia'||forma_pago==='tarjeta')&&banco_id){
    const banco=get(`SELECT * FROM bancos WHERE id=?`,[banco_id]);
    if(banco){
      const saldo_ant=banco.saldo_actual;
      const saldo_nuevo=saldo_ant-subtotal;
      const mid=uuid();
      run(`INSERT INTO bancos_movimientos(id,banco_id,tipo,fecha,monto,descripcion,referencia,saldo_anterior,saldo_nuevo,usuario_id)VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [mid,banco_id,'retiro',nowHN(),subtotal,`Compra ${forma_pago} — ${numero_doc||id}`,numero_doc||'',saldo_ant,saldo_nuevo,req.user.id]);
      run(`UPDATE bancos SET saldo_actual=? WHERE id=?`,[saldo_nuevo,banco_id]);
    }
  }
  saveDB(); res.json({id,subtotal});
});
app.post('/api/compras/:id/recibir',auth(['admin','supervisor']),(req,res)=>{
  const{items}=req.body;
  const compra=get(`SELECT * FROM compras WHERE id=?`,[req.params.id]);
  if(!compra)return res.status(404).json({error:'No encontrada'});
  for(const item of items){
    const ci=get(`SELECT * FROM compra_items WHERE id=?`,[item.compra_item_id]);
    if(!ci)continue;
    run(`UPDATE compra_items SET cantidad_recibida=? WHERE id=?`,[(ci.cantidad_recibida||0)+item.cantidad_recibida,item.compra_item_id]);
    run(`UPDATE productos SET costo=? WHERE id=?`,[ci.costo_unit,ci.producto_id]);
    ajustarStock(ci.producto_id,compra.sucursal_id,item.cantidad_recibida,'compra',`COMPRA-${req.params.id}`,'Recepción compra',req.user.id,ci.costo_unit);
  }
  const pend=all(`SELECT * FROM compra_items WHERE compra_id=? AND cantidad_recibida < cantidad`,[req.params.id]);
  run(`UPDATE compras SET estado=? WHERE id=?`,[pend.length===0?'recibida':'parcial',req.params.id]);
  saveDB(); res.json({ok:1});
});

// ── CxC ──
app.get('/api/cxc',auth(),(req,res)=>{
  const suc=req.user.sucursal_id;
  res.json(all(`SELECT cxc.*,c.nombre as cliente_nombre,c.rtn as cliente_rtn FROM cxc LEFT JOIN clientes c ON c.id=cxc.cliente_id WHERE cxc.sucursal_id=? ORDER BY cxc.vencimiento`,[suc]));
});
app.post('/api/cxc',auth(),(req,res)=>{
  const{cliente_id,referencia,monto,vencimiento}=req.body;
  const id=uuid(); run(`INSERT INTO cxc(id,cliente_id,sucursal_id,referencia,monto,saldo,fecha,vencimiento)VALUES(?,?,?,?,?,?,date('now','-6 hours'),?)`,[id,cliente_id,req.user.sucursal_id,referencia||'',monto,monto,vencimiento]); saveDB(); res.json({id});
});
app.post('/api/cxc/:id/pagar',auth(),(req,res)=>{
  try {
  const{monto,metodo,banco_id}=req.body;
  if(!monto||monto<=0)return res.status(400).json({error:'Monto inválido'});
  const c=get(`SELECT * FROM cxc WHERE id=?`,[req.params.id]);
  if(!c)return res.status(404).json({error:'No encontrada'});
  const ns=Math.max(0,parseFloat((c.saldo-monto).toFixed(2)));
  run(`UPDATE cxc SET saldo=?,estado=? WHERE id=?`,[ns,ns===0?'pagado':'pendiente',req.params.id]);
  try { run(`INSERT INTO pagos_cxc(cxc_id,monto,usuario_id,metodo,banco_id)VALUES(?,?,?,?,?)`,[req.params.id,monto,req.user.id,metodo||'efectivo',banco_id||null]); } catch(e) {
    // Si falla por columnas faltantes, intentar con columnas básicas
    run(`INSERT INTO pagos_cxc(cxc_id,monto,usuario_id)VALUES(?,?,?)`,[req.params.id,monto,req.user.id]);
  }
  run(`UPDATE clientes SET saldo=MAX(0,saldo-?) WHERE id=?`,[monto,c.cliente_id]);
  // Si el pago es por transferencia, registrar movimiento en banco
  if((metodo==='transferencia'||metodo==='tarjeta')&&banco_id){
    const banco=get(`SELECT * FROM bancos WHERE id=?`,[banco_id]);
    if(banco){
      const saldo_ant=banco.saldo_actual;
      const saldo_nuevo=saldo_ant+monto;
      const mid=uuid();
      run(`INSERT INTO bancos_movimientos(id,banco_id,tipo,fecha,monto,descripcion,referencia,saldo_anterior,saldo_nuevo,usuario_id)VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [mid,banco_id,'deposito',nowHN(),monto,`Abono CxC — ${c.referencia||c.id}`,c.referencia||'',saldo_ant,saldo_nuevo,req.user.id]);
      run(`UPDATE bancos SET saldo_actual=? WHERE id=?`,[saldo_nuevo,banco_id]);
    }
  }
  saveDB(); res.json({saldo:ns});
  } catch(e) { console.error('CxC pagar error:',e); res.status(500).json({error:'Error al registrar pago: '+e.message}); }
});
app.delete('/api/cxc/:id',auth(['admin']),(req,res)=>{ run(`DELETE FROM cxc WHERE id=?`,[req.params.id]); saveDB(); res.json({ok:1}); });

// ── CxP ──
app.get('/api/cxp',auth(),(req,res)=>{
  const suc=req.user.sucursal_id;
  res.json(all(`SELECT cxp.*,p.nombre as proveedor_nombre FROM cxp LEFT JOIN proveedores p ON p.id=cxp.proveedor_id WHERE cxp.sucursal_id=? ORDER BY cxp.vencimiento`,[suc]));
});
app.post('/api/cxp',auth(['admin','supervisor']),(req,res)=>{
  const{proveedor_id,referencia,monto,vencimiento}=req.body;
  const id=uuid(); run(`INSERT INTO cxp(id,proveedor_id,sucursal_id,referencia,monto,saldo,fecha,vencimiento)VALUES(?,?,?,?,?,?,date('now','-6 hours'),?)`,[id,proveedor_id,req.user.sucursal_id,referencia||'',monto,monto,vencimiento]); saveDB(); res.json({id});
});
app.post('/api/cxp/:id/pagar',auth(['admin','supervisor']),(req,res)=>{
  const{monto,metodo,banco_id}=req.body;
  const c=get(`SELECT * FROM cxp WHERE id=?`,[req.params.id]);
  if(!c)return res.status(404).json({error:'No encontrada'});
  const ns=Math.max(0,c.saldo-monto);
  run(`UPDATE cxp SET saldo=?,estado=? WHERE id=?`,[ns,ns===0?'pagado':'pendiente',req.params.id]);
  run(`INSERT INTO pagos_cxp(cxp_id,monto,usuario_id,metodo,banco_id)VALUES(?,?,?,?,?)`,[req.params.id,monto,req.user.id,metodo||'efectivo',banco_id||null]);
  run(`UPDATE proveedores SET saldo=MAX(0,saldo-?) WHERE id=?`,[monto,c.proveedor_id]);
  // Si el pago es por transferencia o tarjeta, registrar retiro en banco
  if((metodo==='transferencia'||metodo==='tarjeta')&&banco_id){
    const banco=get(`SELECT * FROM bancos WHERE id=?`,[banco_id]);
    if(banco){
      const saldo_ant=banco.saldo_actual;
      const saldo_nuevo=saldo_ant-monto;
      const mid=uuid();
      run(`INSERT INTO bancos_movimientos(id,banco_id,tipo,fecha,monto,descripcion,referencia,saldo_anterior,saldo_nuevo,usuario_id)VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [mid,banco_id,'retiro',nowHN(),monto,`Pago CxP — ${c.referencia||c.id}`,c.referencia||'',saldo_ant,saldo_nuevo,req.user.id]);
      run(`UPDATE bancos SET saldo_actual=? WHERE id=?`,[saldo_nuevo,banco_id]);
    }
  }
  saveDB(); res.json({saldo:ns});
});
app.delete('/api/cxp/:id',auth(['admin']),(req,res)=>{ run(`DELETE FROM cxp WHERE id=?`,[req.params.id]); saveDB(); res.json({ok:1}); });

// ── REPORTES ──
app.get('/api/reportes/ventas_resumen',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  const{fecha_ini,fecha_fin,serie}=req.query;
  let w=`WHERE v.sucursal_id=? AND v.estado='emitida'`;const p=[suc];
  if(fecha_ini){w+=` AND date(v.fecha)>=?`;p.push(fecha_ini);}
  if(fecha_fin){w+=` AND date(v.fecha)<=?`;p.push(fecha_fin);}
  if(serie){w+=` AND v.numero_factura LIKE ?`;p.push(serie.replace(/-+$/,'')+'%');}
  res.json(get(`SELECT COUNT(*)as total_ventas,SUM(subtotal)as subtotal,SUM(descuento)as descuentos,SUM(isv15)as isv15,SUM(total)as total FROM ventas v ${w}`,p));
});
app.get('/api/reportes/ventas_por_categoria',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  const{fecha_ini,fecha_fin,serie}=req.query;
  let w=`WHERE v.sucursal_id=? AND v.estado='emitida'`;const p=[suc];
  if(fecha_ini){w+=` AND date(v.fecha)>=?`;p.push(fecha_ini);}
  if(fecha_fin){w+=` AND date(v.fecha)<=?`;p.push(fecha_fin);}
  if(serie){w+=` AND v.numero_factura LIKE ?`;p.push(serie.replace(/-+$/,'')+'%');}
  res.json(all(`SELECT vi.producto_categoria as categoria,SUM(vi.cantidad)as unidades,SUM(vi.subtotal)as total FROM venta_items vi JOIN ventas v ON v.id=vi.venta_id ${w} GROUP BY vi.producto_categoria ORDER BY total DESC`,p));
});
app.get('/api/reportes/ventas_por_mes',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  const{serie}=req.query;
  let w=`WHERE v.sucursal_id=? AND v.estado='emitida'`;const p=[suc];
  if(serie){w+=` AND v.numero_factura LIKE ?`;p.push(serie.replace(/-+$/,'')+'%');}
  res.json(all(`SELECT strftime('%Y-%m',v.fecha)as mes,COUNT(*)as ventas,SUM(v.isv15)as isv,SUM(v.total)as total FROM ventas v ${w} GROUP BY mes ORDER BY mes DESC LIMIT 24`,p));
});
app.get('/api/reportes/articulos_por_dia',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  const{fecha_ini,fecha_fin,hora_ini,hora_fin,serie}=req.query;
  let w=`WHERE v.sucursal_id=? AND v.estado='emitida'`;const p=[suc];
  // Filtro con hora: si hay hora usar datetime completo, si no solo fecha
  if(fecha_ini){
    const dIni = hora_ini ? fecha_ini+'T'+hora_ini : fecha_ini;
    w += hora_ini ? ` AND datetime(v.fecha)>=datetime(?)` : ` AND date(v.fecha)>=?`;
    p.push(dIni);
  }
  if(fecha_fin){
    const dFin = hora_fin ? fecha_fin+'T'+hora_fin : fecha_fin;
    w += hora_fin ? ` AND datetime(v.fecha)<=datetime(?)` : ` AND date(v.fecha)<=?`;
    p.push(dFin);
  }
  if(serie){w+=` AND v.numero_factura LIKE ?`;p.push(serie.replace(/-+$/,'')+'%');}
  res.json(all(`SELECT date(v.fecha)as dia,vi.producto_codigo,vi.producto_nombre,vi.producto_categoria,SUM(vi.cantidad)as unidades,SUM(vi.subtotal)as total FROM venta_items vi JOIN ventas v ON v.id=vi.venta_id ${w} GROUP BY dia,vi.producto_id ORDER BY dia DESC,total DESC`,p));
});
app.get('/api/reportes/inventario',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  res.json(all(`SELECT p.codigo,p.nombre,p.categoria,p.precio_venta,p.costo,COALESCE(i.stock,0)as stock,COALESCE(i.stock_min,0)as stock_min,COALESCE(i.stock,0)*p.costo as valor_costo,COALESCE(i.stock,0)*p.precio_venta as valor_venta FROM productos p LEFT JOIN inventario i ON i.producto_id=p.id AND i.sucursal_id=? WHERE p.activo=1 ORDER BY p.categoria,p.nombre`,[suc]));
});

// ── DASHBOARD ──
app.get('/api/dashboard',auth(),(req,res)=>{
  const suc = req.query.sucursal_id || req.user.sucursal_id;
  const hoy = new Date(); hoy.setHours(hoy.getHours()-6);
  const fechaHoy = hoy.toISOString().substring(0,10);
  const mesIni  = fechaHoy.substring(0,8)+'01';

  const ventasHoy  = get(`SELECT COUNT(*)as total,COALESCE(SUM(total),0)as monto FROM ventas WHERE sucursal_id=? AND estado='emitida' AND date(fecha)=?`,[suc,fechaHoy]);
  const ventasMes  = get(`SELECT COUNT(*)as total,COALESCE(SUM(total),0)as monto FROM ventas WHERE sucursal_id=? AND estado='emitida' AND date(fecha)>=?`,[suc,mesIni]);
  const totalProds = get(`SELECT COUNT(*)as total FROM productos WHERE activo=1`);
  const stockBajo  = get(`SELECT COUNT(*)as total FROM inventario i JOIN productos p ON p.id=i.producto_id WHERE i.sucursal_id=? AND i.stock<=i.stock_min AND i.stock_min>0 AND p.activo=1`,[suc]);
  const totalClientes = get(`SELECT COUNT(*)as total FROM clientes WHERE activo=1`);
  const cxcPendiente  = get(`SELECT COALESCE(SUM(saldo),0)as monto FROM cxc WHERE estado='pendiente'`);
  const ultVentas = all(`SELECT v.numero_factura,v.fecha,v.total,v.forma_pago,c.nombre as cliente_nombre FROM ventas v LEFT JOIN clientes c ON c.id=v.cliente_id WHERE v.sucursal_id=? AND v.estado='emitida' ORDER BY v.fecha DESC LIMIT 8`,[suc]);
  const topProds = all(`SELECT vi.producto_nombre,SUM(vi.cantidad)as unidades,SUM(vi.subtotal)as total FROM venta_items vi JOIN ventas v ON v.id=vi.venta_id WHERE v.sucursal_id=? AND v.estado='emitida' AND date(v.fecha)>=? GROUP BY vi.producto_id ORDER BY total DESC LIMIT 6`,[suc,mesIni]);
  const ventasPorDia = all(`SELECT date(fecha)as dia,COUNT(*)as ventas,COALESCE(SUM(total),0)as total FROM ventas WHERE sucursal_id=? AND estado='emitida' AND date(fecha)>=date('now','-6 hours','-6 days') ORDER BY dia`,[suc]);

  res.json({ventasHoy,ventasMes,totalProds,stockBajo,totalClientes,cxcPendiente,ultVentas,topProds,ventasPorDia,fechaHoy});
});

// ── SERIES DE FACTURACIÓN ──
app.get('/api/series_factura',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  const tipo=req.query.tipo||null;
  if(tipo){
    res.json(all(`SELECT * FROM series_factura WHERE sucursal_id=? AND activa=1 AND (tipo=? OR tipo IS NULL) ORDER BY creado ASC`,[suc,tipo]));
  } else {
    res.json(all(`SELECT * FROM series_factura WHERE sucursal_id=? AND activa=1 ORDER BY creado ASC`,[suc]));
  }
});
app.post('/api/series_factura',auth(['admin','supervisor']),(req,res)=>{
  const{sucursal_id,nombre,serie,cai,rango_ini,rango_fin,fecha_limite,tipo}=req.body;
  const id=uuid();
  run(`INSERT INTO series_factura(id,sucursal_id,nombre,serie,cai,rango_ini,rango_fin,fecha_limite,tipo)VALUES(?,?,?,?,?,?,?,?,?)`,
    [id,sucursal_id||req.user.sucursal_id,nombre||serie,serie||'',cai||'',rango_ini||'',rango_fin||'',fecha_limite||'',tipo||'factura']);
  saveDB(); res.json({id});
});
app.put('/api/series_factura/:id',auth(['admin','supervisor']),(req,res)=>{
  const{nombre,serie,cai,rango_ini,rango_fin,fecha_limite,tipo}=req.body;
  run(`UPDATE series_factura SET nombre=?,serie=?,cai=?,rango_ini=?,rango_fin=?,fecha_limite=?,tipo=? WHERE id=?`,
    [nombre||'',serie||'',cai||'',rango_ini||'',rango_fin||'',fecha_limite||'',tipo||'factura',req.params.id]);
  saveDB(); res.json({ok:1});
});
app.delete('/api/series_factura/:id',auth(['admin']),(req,res)=>{
  run(`UPDATE series_factura SET activa=0 WHERE id=?`,[req.params.id]);
  saveDB(); res.json({ok:1});
});

// ── CONFIG ──
app.get('/api/config',auth(),(req,res)=>{const r={};all(`SELECT * FROM config`).forEach(x=>r[x.clave]=x.valor);res.json(r);});
app.put('/api/config',auth(['admin']),(req,res)=>{for(const[k,v]of Object.entries(req.body))run(`INSERT OR REPLACE INTO config(clave,valor)VALUES(?,?)`,[k,v]);saveDB();res.json({ok:1});});

// ── SYNC ──
app.get('/api/sync/pendiente/:sid',auth(['admin']),(req,res)=>res.json(all(`SELECT * FROM sync_log WHERE sucursal_id!=? AND sincronizado=0 ORDER BY fecha ASC LIMIT 500`,[req.params.sid])));
app.post('/api/sync/confirmar',auth(['admin']),(req,res)=>{(req.body.ids||[]).forEach(id=>run(`UPDATE sync_log SET sincronizado=1 WHERE id=?`,[id]));saveDB();res.json({ok:1});});
app.get('/api/sync/estado',auth(['admin']),(req,res)=>res.json({pendientes:get(`SELECT COUNT(*)as total FROM sync_log WHERE sincronizado=0`).total,sucursales:all(`SELECT id,nombre FROM sucursales WHERE activa=1`)}));

// ── TURNOS Y FONDO DE CAJA ──
app.get('/api/turnos/activo',auth(),(req,res)=>{
  try {
    const suc=req.user.sucursal_id;
    const turno=get(`SELECT t.*,u.nombre as usuario_nombre FROM turnos t LEFT JOIN usuarios u ON u.id=t.usuario_id WHERE t.sucursal_id=? AND t.usuario_id=? AND t.estado='abierto' ORDER BY t.fecha_apertura DESC LIMIT 1`,[suc,req.user.id]);
    if(!turno){ res.json(null); return; }
    // Calcular totales en tiempo real desde las ventas del turno
    const resumen=get(`SELECT
      COALESCE(SUM(total),0) as total_ventas,
      COALESCE(SUM(CASE WHEN forma_pago='efectivo' THEN total ELSE 0 END),0) as total_efectivo,
      COALESCE(SUM(CASE WHEN forma_pago='tarjeta' THEN total ELSE 0 END),0) as total_tarjeta,
      COALESCE(SUM(CASE WHEN forma_pago='transferencia' THEN total ELSE 0 END),0) as total_transferencia
      FROM ventas WHERE turno_id=? AND estado='emitida'`,[turno.id])||{};
    turno.total_ventas        = resumen.total_ventas        || 0;
    turno.total_efectivo      = resumen.total_efectivo      || 0;
    turno.total_tarjeta       = resumen.total_tarjeta       || 0;
    turno.total_transferencia = resumen.total_transferencia || 0;
    res.json(turno);
  } catch(e){ console.error('turnos/activo:',e.message); res.status(500).json({error:e.message}); }
});
app.get('/api/turnos',auth(['admin','supervisor']),(req,res)=>{
  try {
    const suc=req.query.sucursal_id||req.user.sucursal_id;
    const{fecha_ini,fecha_fin}=req.query;
    let w=`WHERE t.sucursal_id=?`;const p=[suc];
    if(fecha_ini){w+=` AND date(t.fecha_apertura)>=?`;p.push(fecha_ini);}
    if(fecha_fin){w+=` AND date(t.fecha_apertura)<=?`;p.push(fecha_fin);}
    res.json(all(`SELECT t.*,u.nombre as usuario_nombre FROM turnos t LEFT JOIN usuarios u ON u.id=t.usuario_id ${w} ORDER BY t.fecha_apertura DESC LIMIT 200`,p));
  } catch(e){ console.error('turnos GET:',e.message); res.status(500).json({error:e.message}); }
});
// Reporte consolidado de todos los turnos del día
app.get('/api/turnos/consolidado_dia', auth(), (req, res) => {
  try {
    const suc  = req.query.sucursal_id || req.user.sucursal_id;
    const fecha = req.query.fecha || new Date(Date.now()-6*3600000).toISOString().substring(0,10);

    // Turnos del día (abiertos y cerrados)
    const turnos = all(
      `SELECT t.*, u.nombre as usuario_nombre
       FROM turnos t LEFT JOIN usuarios u ON u.id=t.usuario_id
       WHERE t.sucursal_id=? AND date(t.fecha_apertura)=?
       ORDER BY t.turno_letra, t.fecha_apertura`,
      [suc, fecha]);

    // Para cada turno calcular totales reales desde ventas
    turnos.forEach(t => {
      const tot = get(
        `SELECT COALESCE(SUM(total),0) as tv,
                COALESCE(SUM(CASE WHEN forma_pago='efectivo'       THEN total ELSE 0 END),0) as te,
                COALESCE(SUM(CASE WHEN forma_pago='tarjeta'        THEN total ELSE 0 END),0) as tt,
                COALESCE(SUM(CASE WHEN forma_pago='transferencia'  THEN total ELSE 0 END),0) as tr,
                COUNT(*) as nv
         FROM ventas WHERE turno_id=? AND estado='emitida'`, [t.id]) || {};
      t.tv = tot.tv||0; t.te = tot.te||0;
      t.tt = tot.tt||0; t.tr = tot.tr||0; t.nv = tot.nv||0;

      // Artículos vendidos en el turno
      t.articulos = all(
        `SELECT vi.producto_codigo, vi.producto_nombre, vi.producto_categoria,
                SUM(vi.cantidad) as unidades, SUM(vi.subtotal) as total
         FROM venta_items vi JOIN ventas v ON v.id=vi.venta_id
         WHERE v.turno_id=? AND v.estado='emitida'
         GROUP BY vi.producto_id ORDER BY total DESC`, [t.id]);
    });

    res.json({ fecha, turnos });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Turnos cerrados del propio cajero (para reimpresión)
app.get('/api/turnos/mis_turnos',auth(),(req,res)=>{
  try {
    const limite = parseInt(req.query.limite)||10;
    const rows = all(
      `SELECT t.*,u.nombre as usuario_nombre FROM turnos t
       LEFT JOIN usuarios u ON u.id=t.usuario_id
       WHERE t.usuario_id=? AND t.estado='cerrado'
       ORDER BY t.fecha_cierre DESC LIMIT ?`,
      [req.user.id, limite]);
    // Agregar totales reales desde ventas para cada turno
    rows.forEach(t => {
      const res2 = get(
        `SELECT COALESCE(SUM(total),0) as tv,
                COALESCE(SUM(CASE WHEN forma_pago='efectivo' THEN total ELSE 0 END),0) as te,
                COALESCE(SUM(CASE WHEN forma_pago='tarjeta' THEN total ELSE 0 END),0) as tt,
                COALESCE(SUM(CASE WHEN forma_pago='transferencia' THEN total ELSE 0 END),0) as tr,
                COUNT(*) as nv
         FROM ventas WHERE turno_id=? AND estado='emitida'`,
        [t.id]) || {};
      t.total_ventas        = res2.tv || 0;
      t.total_efectivo      = res2.te || 0;
      t.total_tarjeta       = res2.tt || 0;
      t.total_transferencia = res2.tr || 0;
      t.num_ventas          = res2.nv || 0;
    });
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/turnos/abrir',auth(),(req,res)=>{
  try {
    const suc=req.user.sucursal_id;
    const existente=get(`SELECT id FROM turnos WHERE sucursal_id=? AND usuario_id=? AND estado='abierto'`,[suc,req.user.id]);
    if(existente)return res.status(400).json({error:'Ya tienes un turno abierto'});
    const{fondo_inicial,sin_fondo,notas,turno_letra}=req.body;
    const letra=(turno_letra||'A').toUpperCase();
    if(!['A','B','C'].includes(letra)) return res.status(400).json({error:'Turno debe ser A, B o C'});
    const id=uuid();
    run(`INSERT INTO turnos(id,sucursal_id,usuario_id,turno_letra,fondo_inicial,sin_fondo,notas)VALUES(?,?,?,?,?,?,?)`,[id,suc,req.user.id,letra,fondo_inicial||0,sin_fondo?1:0,notas||'']);
    saveDB(); res.json({id,turno_letra:letra});
  } catch(e){ console.error('turnos/abrir:',e.message); res.status(500).json({error:e.message}); }
});
app.post('/api/turnos/:id/cerrar',auth(),(req,res)=>{
  try {
    const turno=get(`SELECT * FROM turnos WHERE id=? AND estado='abierto'`,[req.params.id]);
    if(!turno)return res.status(404).json({error:'Turno no encontrado o ya cerrado'});
    const{efectivo_contado,notas,sobrante,motivo_sobrante}=req.body;
    const resumen=get(`SELECT COALESCE(SUM(total),0)as total_ventas,COALESCE(SUM(CASE WHEN forma_pago='efectivo' THEN total ELSE 0 END),0)as total_efectivo,COALESCE(SUM(CASE WHEN forma_pago='tarjeta' THEN total ELSE 0 END),0)as total_tarjeta,COALESCE(SUM(CASE WHEN forma_pago='transferencia' THEN total ELSE 0 END),0)as total_transferencia FROM ventas WHERE turno_id=? AND estado='emitida'`,[req.params.id])||{};
    const egresos=get(`SELECT COALESCE(SUM(monto),0)as total FROM movimientos_caja WHERE turno_id=? AND tipo='egreso'`,[req.params.id])||{};
    const efectivo_esp=(turno.fondo_inicial||0)+(resumen.total_efectivo||0)-(egresos.total||0);
    const contado=parseFloat(efectivo_contado)||0;
    const diferencia=contado-efectivo_esp;
    const sobranteVal=parseFloat(sobrante)||0;
    run(`UPDATE turnos SET estado='cerrado',fecha_cierre=datetime('now','-6 hours'),total_ventas=?,total_efectivo=?,total_tarjeta=?,total_transferencia=?,total_egresos=?,efectivo_esperado=?,efectivo_contado=?,diferencia=?,notas=?,sobrante=?,motivo_sobrante=? WHERE id=?`,
      [resumen.total_ventas||0,resumen.total_efectivo||0,resumen.total_tarjeta||0,resumen.total_transferencia||0,egresos.total||0,efectivo_esp,contado,diferencia,notas||turno.notas||'',sobranteVal,motivo_sobrante||'',req.params.id]);
    saveDB();
    res.json({ok:1,total_ventas:resumen.total_ventas||0,total_efectivo:resumen.total_efectivo||0,total_tarjeta:resumen.total_tarjeta||0,total_transferencia:resumen.total_transferencia||0,fondo_inicial:turno.fondo_inicial||0,egresos:egresos.total||0,efectivo_esperado:efectivo_esp,diferencia});
  } catch(e){ console.error('turnos/cerrar:',e.message); res.status(500).json({error:e.message}); }
});
app.get('/api/turnos/:id/resumen',auth(),(req,res)=>{
  try {
    const turno=get(`SELECT t.*,u.nombre as usuario_nombre FROM turnos t LEFT JOIN usuarios u ON u.id=t.usuario_id WHERE t.id=?`,[req.params.id]);
    if(!turno)return res.status(404).json({error:'No encontrado'});
    const ventas=all(`SELECT * FROM ventas WHERE turno_id=? AND estado='emitida' ORDER BY fecha ASC`,[req.params.id]);
    const movimientos=all(`SELECT * FROM movimientos_caja WHERE turno_id=? ORDER BY fecha ASC`,[req.params.id]);
    res.json({turno,ventas,movimientos});
  } catch(e){ console.error('turnos/resumen:',e.message); res.status(500).json({error:e.message}); }
});
app.post('/api/turnos/:id/movimiento',auth(),(req,res)=>{
  try {
    const{tipo,concepto,monto}=req.body;
    const turno=get(`SELECT id,sucursal_id FROM turnos WHERE id=? AND estado='abierto'`,[req.params.id]);
    if(!turno)return res.status(404).json({error:'Turno no encontrado o cerrado'});
    const id=uuid();
    run(`INSERT INTO movimientos_caja(id,turno_id,sucursal_id,usuario_id,tipo,concepto,monto)VALUES(?,?,?,?,?,?,?)`,[id,req.params.id,turno.sucursal_id,req.user.id,tipo,concepto,monto]);
    saveDB(); res.json({id});
  } catch(e){ console.error('turnos/movimiento:',e.message); res.status(500).json({error:e.message}); }
});

// ── WHATSAPP NUMEROS ──
app.get('/api/whatsapp',auth(),(req,res)=>{
  res.json(all(`SELECT * FROM whatsapp_numeros WHERE activo=1 ORDER BY nombre`));
});
app.post('/api/whatsapp',auth(['admin']),(req,res)=>{
  const{nombre,numero,callmebot_apikey}=req.body;
  if(!nombre||!numero) return res.status(400).json({error:'Nombre y número requeridos'});
  run(`INSERT INTO whatsapp_numeros(id,nombre,numero,callmebot_apikey)VALUES(?,?,?,?)`,
    [uuid(),nombre,numero,callmebot_apikey||null]);
  saveDB(); res.json({ok:1});
});
// Actualizar apikey de un número existente
app.put('/api/whatsapp/:id',auth(['admin']),(req,res)=>{
  const{callmebot_apikey,nombre,numero}=req.body;
  run(`UPDATE whatsapp_numeros SET nombre=COALESCE(?,nombre),numero=COALESCE(?,numero),callmebot_apikey=? WHERE id=?`,
    [nombre||null,numero||null,callmebot_apikey||null,req.params.id]);
  saveDB(); res.json({ok:1});
});
app.delete('/api/whatsapp/:id',auth(['admin']),(req,res)=>{
  run(`UPDATE whatsapp_numeros SET activo=0 WHERE id=?`,[req.params.id]);
  saveDB(); res.json({ok:1});
});
// ── TEXTMEBOT: Envío automático de mensajes ─────────────────────────────────
// TextMeBot API: https://textmebot.com
// Texto: GET https://api.textmebot.com/send.php?recipient=+NUMERO&apikey=KEY&text=MENSAJE
// PDF:   GET https://api.textmebot.com/send.php?recipient=+NUMERO&apikey=KEY&document=URL_SIN_ENCODEAR&filename=archivo.pdf
async function _textmebotEnviar({ numero, apikey, mensaje, pdfUrl, pdfNombre }) {
  const tel = numero.replace(/[^0-9]/g, '');
  let url;
  if (pdfUrl) {
    // IMPORTANTE: pdfUrl NO debe ir encodeada — TextMeBot la necesita en texto plano
    // Solo encodear filename y text
    url = `https://api.textmebot.com/send.php?recipient=%2B${tel}&apikey=${apikey}&document=${pdfUrl}&filename=${encodeURIComponent(pdfNombre||'Reporte.pdf')}&json=yes`;
    if (mensaje) url += `&text=${encodeURIComponent(mensaje)}`;
  } else {
    url = `https://api.textmebot.com/send.php?recipient=%2B${tel}&apikey=${apikey}&text=${encodeURIComponent(mensaje)}&json=yes`;
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const txt = await r.text();
  console.log(`TextMeBot respuesta [${pdfUrl?'PDF':'texto'}]:`, txt.substring(0, 200));
  try { return JSON.parse(txt); } catch(e) { return { status: txt }; }
}

app.post('/api/whatsapp/send', auth(), async (req, res) => {
  const { numero, apikey, mensaje, pdfUrl, pdfNombre } = req.body;
  if (!numero || !apikey || (!mensaje && !pdfUrl)) {
    return res.status(400).json({ error: 'numero, apikey y (mensaje o pdfUrl) son requeridos' });
  }
  try {
    const data = await _textmebotEnviar({ numero, apikey, mensaje, pdfUrl, pdfNombre });
    res.json({ ok: true, respuesta: data });
  } catch(e) {
    res.status(500).json({ error: e.message, ok: false });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  RESUMEN SEMANAL — CallMeBot (100% gratuito, solo texto)
//  Envía cada Lunes 8:00am (hora Honduras) un resumen con el total de
//  Facturas, Notas de Débito y Órdenes de Compra de los últimos 7 días.
//  CallMeBot API: https://www.callmebot.com/blog/free-api-whatsapp-messages/
//  GET https://api.callmebot.com/whatsapp.php?phone=+NUMERO&text=MENSAJE&apikey=APIKEY
// ══════════════════════════════════════════════════════════════════════════
async function _callmebotEnviar({ numero, apikey, mensaje }) {
  const tel = numero.replace(/[^0-9]/g, '');
  const url = `https://api.callmebot.com/whatsapp.php?phone=%2B${tel}&text=${encodeURIComponent(mensaje)}&apikey=${apikey}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const txt = await r.text();
  console.log('CallMeBot respuesta:', txt.substring(0, 200));
  return { status: txt };
}

/** Calcula el rango de los últimos 7 días (incluye hoy) en formato YYYY-MM-DD */
function _rangoUltimaSemana() {
  const hoy = new Date();
  const hace7 = new Date(hoy.getTime() - 7*24*60*60*1000);
  const fIni = hace7.toISOString().substring(0,10);
  const fFin = hoy.toISOString().substring(0,10);
  return { fIni, fFin };
}

/** Construye el texto del resumen semanal (Facturas + Notas de Débito + Órdenes de Compra) */
function generarResumenSemanalTexto(sucursalId) {
  const { fIni, fFin } = _rangoUltimaSemana();
  const sucursal = get(`SELECT nombre FROM sucursales WHERE id=?`,[sucursalId]);
  const nombreSuc = sucursal?.nombre || 'Mi Empresa';

  // Facturas (tipo 'factura' o sin serie asociada = factura por defecto)
  const facturas = all(
    `SELECT v.numero_factura, v.total, v.fecha, c.nombre as cliente
     FROM ventas v LEFT JOIN clientes c ON c.id=v.cliente_id
     WHERE v.sucursal_id=? AND date(v.fecha)>=? AND date(v.fecha)<=? AND v.estado!='anulada'
       AND (v.serie_id IS NULL OR v.serie_id IN (SELECT id FROM series_factura WHERE tipo='factura' OR tipo IS NULL))
     ORDER BY v.fecha ASC`,
    [sucursalId, fIni, fFin]
  );
  // Notas de Débito (serie tipo 'nota_debito')
  const notasDebito = all(
    `SELECT v.numero_factura, v.total, v.fecha, c.nombre as cliente
     FROM ventas v LEFT JOIN clientes c ON c.id=v.cliente_id
     WHERE v.sucursal_id=? AND date(v.fecha)>=? AND date(v.fecha)<=? AND v.estado!='anulada'
       AND v.serie_id IN (SELECT id FROM series_factura WHERE tipo='nota_debito')
     ORDER BY v.fecha ASC`,
    [sucursalId, fIni, fFin]
  );
  // Órdenes de Compra
  const ordenes = all(
    `SELECT o.numero_orden, o.total_general, o.fecha, c.nombre as cliente
     FROM ordenes_compra o LEFT JOIN clientes c ON c.id=o.cliente_id
     WHERE o.sucursal_id=? AND date(o.fecha)>=? AND date(o.fecha)<=?
     ORDER BY o.fecha ASC`,
    [sucursalId, fIni, fFin]
  );

  const totalFacturas = facturas.reduce((s,f)=>s+(f.total||0),0);
  const totalND       = notasDebito.reduce((s,n)=>s+(n.total||0),0);
  const totalOC       = ordenes.reduce((s,o)=>s+(o.total_general||0),0);
  const granTotal     = totalFacturas + totalND + totalOC;

  const fmt = n => 'L. ' + (parseFloat(n)||0).toLocaleString('es-HN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fechaCorta = f => { try { return new Date(f).toLocaleDateString('es-HN',{day:'2-digit',month:'2-digit'}); } catch(e){ return ''; } };

  let msg = `📊 *RESUMEN SEMANAL — ${nombreSuc}*\n`;
  msg += `🗓️ Del ${fechaCorta(fIni)} al ${fechaCorta(fFin)}\n\n`;

  msg += `🧾 *FACTURAS* (${facturas.length})\n`;
  if (facturas.length === 0) {
    msg += `_Sin facturas en este período_\n`;
  } else {
    facturas.forEach(f => { msg += `• ${f.numero_factura} — ${f.cliente||'Consumidor Final'}: ${fmt(f.total)}\n`; });
  }
  msg += `*Subtotal Facturas: ${fmt(totalFacturas)}*\n\n`;

  msg += `📋 *NOTAS DE DÉBITO* (${notasDebito.length})\n`;
  if (notasDebito.length === 0) {
    msg += `_Sin notas de débito en este período_\n`;
  } else {
    notasDebito.forEach(n => { msg += `• ${n.numero_factura} — ${n.cliente||'Consumidor Final'}: ${fmt(n.total)}\n`; });
  }
  msg += `*Subtotal Notas de Débito: ${fmt(totalND)}*\n\n`;

  msg += `📦 *ÓRDENES DE COMPRA* (${ordenes.length})\n`;
  if (ordenes.length === 0) {
    msg += `_Sin órdenes de compra en este período_\n`;
  } else {
    ordenes.forEach(o => { msg += `• ${o.numero_orden} — ${o.cliente||'—'}: ${fmt(o.total_general)}\n`; });
  }
  msg += `*Subtotal Órdenes de Compra: ${fmt(totalOC)}*\n\n`;

  msg += `💰 *TOTAL GENERAL DE LA SEMANA: ${fmt(granTotal)}*\n`;
  msg += `_MetricPOS Aduanera — Reporte automático_`;

  return msg;
}

/** Envía el resumen semanal a todos los destinatarios activos de la sucursal */
async function enviarResumenSemanalASucursal(sucursalId, semanaClave) {
  const destinatarios = all(`SELECT * FROM resumen_semanal_destinatarios WHERE sucursal_id=? AND activo=1`,[sucursalId]);
  if (destinatarios.length === 0) return { enviados: 0, total: 0 };

  const texto = generarResumenSemanalTexto(sucursalId);
  let enviados = 0;
  for (const d of destinatarios) {
    try {
      await _callmebotEnviar({ numero: d.numero, apikey: d.callmebot_apikey, mensaje: texto });
      run(`INSERT INTO resumen_semanal_log(id,sucursal_id,semana_clave,tipo,enviado_a,ok,detalle)VALUES(?,?,?,?,?,?,?)`,
        [uuid(), sucursalId, semanaClave, 'automatico', d.numero, 1, 'Enviado correctamente']);
      enviados++;
      // CallMeBot recomienda esperar unos segundos entre envíos si hay varios destinatarios
      await new Promise(res => setTimeout(res, 3000));
    } catch(e) {
      run(`INSERT INTO resumen_semanal_log(id,sucursal_id,semana_clave,tipo,enviado_a,ok,detalle)VALUES(?,?,?,?,?,?,?)`,
        [uuid(), sucursalId, semanaClave, 'automatico', d.numero, 0, e.message]);
    }
  }
  saveDB();
  return { enviados, total: destinatarios.length };
}

// ── CRUD de destinatarios (números con su API Key de CallMeBot) ─────────────
app.get('/api/resumen-semanal/destinatarios', auth(), (req,res) => {
  res.json(all(`SELECT * FROM resumen_semanal_destinatarios WHERE sucursal_id=? ORDER BY creado ASC`,[req.user.sucursal_id]));
});
app.post('/api/resumen-semanal/destinatarios', auth(['admin','supervisor']), (req,res) => {
  const { nombre, numero, callmebot_apikey } = req.body;
  if (!nombre || !numero || !callmebot_apikey) return res.status(400).json({error:'nombre, numero y callmebot_apikey son requeridos'});
  const id = uuid();
  run(`INSERT INTO resumen_semanal_destinatarios(id,sucursal_id,nombre,numero,callmebot_apikey)VALUES(?,?,?,?,?)`,
    [id, req.user.sucursal_id, nombre, numero, callmebot_apikey]);
  saveDB();
  res.json({id});
});
app.put('/api/resumen-semanal/destinatarios/:id', auth(['admin','supervisor']), (req,res) => {
  const { nombre, numero, callmebot_apikey, activo } = req.body;
  const d = get(`SELECT id FROM resumen_semanal_destinatarios WHERE id=? AND sucursal_id=?`,[req.params.id, req.user.sucursal_id]);
  if (!d) return res.status(404).json({error:'No encontrado'});
  if (nombre!==undefined) run(`UPDATE resumen_semanal_destinatarios SET nombre=? WHERE id=?`,[nombre,req.params.id]);
  if (numero!==undefined) run(`UPDATE resumen_semanal_destinatarios SET numero=? WHERE id=?`,[numero,req.params.id]);
  if (callmebot_apikey!==undefined) run(`UPDATE resumen_semanal_destinatarios SET callmebot_apikey=? WHERE id=?`,[callmebot_apikey,req.params.id]);
  if (activo!==undefined) run(`UPDATE resumen_semanal_destinatarios SET activo=? WHERE id=?`,[activo?1:0,req.params.id]);
  saveDB();
  res.json({ok:1});
});
app.delete('/api/resumen-semanal/destinatarios/:id', auth(['admin','supervisor']), (req,res) => {
  run(`DELETE FROM resumen_semanal_destinatarios WHERE id=? AND sucursal_id=?`,[req.params.id, req.user.sucursal_id]);
  saveDB();
  res.json({ok:1});
});

// ── Vista previa del mensaje (sin enviar nada) ───────────────────────────────
app.get('/api/resumen-semanal/preview', auth(), (req,res) => {
  try {
    const texto = generarResumenSemanalTexto(req.user.sucursal_id);
    res.json({ texto });
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── Envío manual inmediato (botón "Enviar Ahora") ────────────────────────────
app.post('/api/resumen-semanal/enviar-ahora', auth(['admin','supervisor']), async (req,res) => {
  try {
    const semanaClave = 'MANUAL-' + nowHN();
    const resultado = await enviarResumenSemanalASucursal(req.user.sucursal_id, semanaClave);
    if (resultado.total === 0) {
      return res.json({ ok:false, mensaje:'No hay destinatarios configurados con CallMeBot. Agrega al menos uno primero.' });
    }
    res.json({ ok:true, mensaje:`Enviado a ${resultado.enviados} de ${resultado.total} destinatario(s)` });
  } catch(e) { res.status(500).json({ok:false, error:e.message}); }
});

// ── Log de envíos (para ver historial en la UI) ──────────────────────────────
app.get('/api/resumen-semanal/log', auth(), (req,res) => {
  res.json(all(`SELECT * FROM resumen_semanal_log WHERE sucursal_id=? ORDER BY fecha DESC LIMIT 50`,[req.user.sucursal_id]));
});

// ══════════════════════════════════════════════════════════════════════════
//  SCHEDULER — verifica cada minuto si es Lunes 8:00am (hora Honduras, UTC-6)
//  para disparar el envío automático del resumen semanal a todas las sucursales.
//  No se usa node-cron para no agregar una dependencia nueva — un setInterval
//  de 60s es suficientemente preciso para este caso de uso.
// ══════════════════════════════════════════════════════════════════════════
let _ultimaSemanaEnviada = {}; // { sucursal_id: "2026-W26" } — evita doble envío en el mismo minuto

function _semanaISO(fecha) {
  const d = new Date(fecha);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - ((d.getDay()+6)%7)); // ajuste a jueves de esa semana ISO
  const semana1 = new Date(d.getFullYear(),0,4);
  const numSemana = 1 + Math.round(((d - semana1) / 86400000 - 3 + ((semana1.getDay()+6)%7)) / 7);
  return `${d.getFullYear()}-W${String(numSemana).padStart(2,'0')}`;
}

setInterval(async () => {
  try {
    // Hora actual en Honduras (UTC-6), sin depender de timezone del servidor
    const ahoraUTC = new Date();
    const ahoraHN = new Date(ahoraUTC.getTime() - 6*60*60*1000);
    const esLunes = ahoraHN.getDay() === 1; // 0=domingo, 1=lunes
    const horaOk  = ahoraHN.getHours() === 8 && ahoraHN.getMinutes() === 0;
    if (!esLunes || !horaOk) return;

    const semanaClave = _semanaISO(ahoraHN);
    const sucursales = all(`SELECT id FROM sucursales WHERE activa=1`);
    for (const suc of sucursales) {
      if (_ultimaSemanaEnviada[suc.id] === semanaClave) continue; // ya se envió esta semana
      _ultimaSemanaEnviada[suc.id] = semanaClave;
      await enviarResumenSemanalASucursal(suc.id, semanaClave);
      console.log(`📊 Resumen semanal enviado automáticamente — sucursal ${suc.id}, semana ${semanaClave}`);
    }
  } catch(e) {
    console.error('Error en scheduler de resumen semanal:', e.message);
  }
}, 60000); // revisa cada 60 segundos

// Envío masivo al cerrar turno vía TextMeBot (con PDF adjunto)
app.post('/api/whatsapp/send-turno', auth(), async (req, res) => {
  const { turno_id, mensaje_corte, mensaje_articulos } = req.body;
  if (!turno_id) return res.status(400).json({ error: 'turno_id requerido' });

  const numeros = all(`SELECT * FROM whatsapp_numeros WHERE activo=1 AND callmebot_apikey IS NOT NULL AND callmebot_apikey != ''`);
  if (!numeros.length) return res.json({ ok: true, enviados: 0, msg: 'Sin números con API Key configurada' });

  // ── Generar PDF del corte de turno ──────────────────────────────────────────
  let pdfBase64 = null;
  let pdfToken  = null;
  try {
    const data   = get(`SELECT t.*, u.nombre as cajero_nombre FROM turnos t LEFT JOIN usuarios u ON u.id=t.usuario_id WHERE t.id=?`, [turno_id]);
    const ventas = all(`SELECT * FROM ventas WHERE turno_id=? AND estado='emitida' ORDER BY fecha ASC`, [turno_id]);
    const movs   = all(`SELECT * FROM movimientos_caja WHERE turno_id=? ORDER BY fecha ASC`, [turno_id]);
    const ahora  = new Date(new Date().getTime() - 6*3600000).toISOString().replace('T',' ').substring(0,19);

    if (data) {
      pdfBase64 = await new Promise((resolve, reject) => {
        const doc    = new PDFDocument({ margin: 50, size: 'A4' });
        const chunks = [];
        doc.on('data',  c => chunks.push(c));
        doc.on('end',   () => resolve(Buffer.concat(chunks).toString('base64')));
        doc.on('error', reject);

        // ── Encabezado ──
        doc.fontSize(16).fillColor('#1e3a5f')
           .text('REPORTE DE CIERRE DE TURNO', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor('#64748b')
           .text(`Generado: ${ahora}`, { align: 'center' });
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#1e3a5f').lineWidth(2).stroke();
        doc.moveDown(0.5);

        // ── Datos del turno ──
        const campos = [
          ['Turno',           data.turno_letra || 'A'],
          ['Cajero',          data.cajero_nombre || '—'],
          ['Apertura',        (data.fecha_apertura||'—').substring(0,16)],
          ['Cierre',          (data.fecha_cierre||'—').substring(0,16)],
          ['Fondo Inicial',   'L. ' + parseFloat(data.fondo_inicial||0).toFixed(2)],
          ['Total Ventas',    'L. ' + parseFloat(data.total_ventas||0).toFixed(2)],
          ['Efectivo',        'L. ' + parseFloat(data.total_efectivo||0).toFixed(2)],
          ['Tarjeta',         'L. ' + parseFloat(data.total_tarjeta||0).toFixed(2)],
          ['Transferencia',   'L. ' + parseFloat(data.total_transferencia||0).toFixed(2)],
          ['Egresos',         'L. ' + parseFloat(data.total_egresos||0).toFixed(2)],
          ['Efectivo Esperado','L. ' + parseFloat(data.efectivo_esperado||0).toFixed(2)],
          ['Efectivo Contado','L. ' + parseFloat(data.efectivo_contado||0).toFixed(2)],
          ['Diferencia',      'L. ' + parseFloat(data.diferencia||0).toFixed(2)],
        ];
        if (parseFloat(data.sobrante||0) !== 0) {
          campos.push(['Sobrante', 'L. ' + parseFloat(data.sobrante||0).toFixed(2)]);
          if (data.motivo_sobrante) campos.push(['Motivo Sobrante', data.motivo_sobrante]);
        }
        if (data.notas) campos.push(['Notas', data.notas]);

        doc.fontSize(10).fillColor('#1e293b');
        campos.forEach(([l, v]) => {
          doc.font('Helvetica-Bold').text(`${l}: `, { continued: true })
             .font('Helvetica').text(v);
        });
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
        doc.moveDown(0.5);

        // ── Resumen de artículos (desde mensaje_articulos si se pasó) ──
        if (mensaje_articulos) {
          doc.fontSize(11).fillColor('#1e3a5f').font('Helvetica-Bold')
             .text('ARTÍCULOS VENDIDOS EN EL TURNO');
          doc.moveDown(0.2);
          doc.fontSize(8).fillColor('#1e293b').font('Courier')
             .text(mensaje_articulos, { lineGap: 2 });
          doc.moveDown(0.5);
          doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
          doc.moveDown(0.5);
        }

        // ── Detalle de ventas ──
        if (ventas.length) {
          doc.fontSize(11).fillColor('#1e3a5f').font('Helvetica-Bold')
             .text(`DETALLE DE VENTAS (${ventas.length})`);
          doc.moveDown(0.2);
          ventas.forEach(v => {
            doc.fontSize(9).fillColor('#1e293b').font('Helvetica')
               .text(`  ${(v.fecha||'').substring(0,16)}  Fac. ${v.numero_factura||'—'}  ${v.forma_pago||'—'}  L. ${parseFloat(v.total||0).toFixed(2)}`, { lineGap: 1 });
          });
          doc.moveDown(0.5);
          doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
          doc.moveDown(0.5);
        }

        // ── Movimientos de caja ──
        if (movs.length) {
          doc.fontSize(11).fillColor('#1e3a5f').font('Helvetica-Bold')
             .text('MOVIMIENTOS DE CAJA');
          doc.moveDown(0.2);
          movs.forEach(m => {
            doc.fontSize(9).fillColor('#1e293b').font('Helvetica')
               .text(`  ${(m.fecha||'').substring(0,16)}  [${m.tipo||'—'}]  ${m.concepto||'—'}  L. ${parseFloat(m.monto||0).toFixed(2)}`, { lineGap: 1 });
          });
          doc.moveDown(0.5);
          doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
          doc.moveDown(0.5);
        }

        // ── Pie ──
        doc.fontSize(9).fillColor('#94a3b8').font('Helvetica')
           .text(`MetricPOS v7.3 — Turno cerrado el ${ahora}`, { align: 'center' });

        doc.end();
      });

      // Guardar PDF en la tabla turnos para poder servirlo por token
      pdfToken = uuid();
      run(`UPDATE turnos SET pdf_cierre=?, pdf_token=? WHERE id=?`, [pdfBase64, pdfToken, turno_id]);
      saveDB();
    }
  } catch(pdfErr) {
    console.error('Error generando PDF de turno:', pdfErr.message);
  }

  // URL pública del PDF (sin autenticación — TextMeBot la necesita accesible)
  const serverUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.SERVER_URL || 'http://localhost:3000';
  const pdfPublicUrl = pdfToken ? `${serverUrl}/public/pdf-turno/${pdfToken}` : null;

  // ── Enviar a cada número ─────────────────────────────────────────────────────
  const resultados = [];
  for (const wa of numeros) {
    try {
      // 1. Mensaje de texto con corte
      await _textmebotEnviar({ numero: wa.numero, apikey: wa.callmebot_apikey, mensaje: mensaje_corte });
      await new Promise(r => setTimeout(r, 5000));
      // 2. Mensaje de texto con artículos
      await _textmebotEnviar({ numero: wa.numero, apikey: wa.callmebot_apikey, mensaje: mensaje_articulos });
      await new Promise(r => setTimeout(r, 5000));
      // 3. PDF adjunto si se generó correctamente
      if (pdfPublicUrl) {
        const turnoLetra = get(`SELECT turno_letra FROM turnos WHERE id=?`, [turno_id])?.turno_letra || 'A';
        await _textmebotEnviar({
          numero:    wa.numero,
          apikey:    wa.callmebot_apikey,
          pdfUrl:    pdfPublicUrl,
          pdfNombre: `Cierre_Turno_${turnoLetra}.pdf`,
          mensaje:   `📄 Reporte PDF — Cierre Turno ${turnoLetra}`
        });
        await new Promise(r => setTimeout(r, 5000));
      }
      resultados.push({ nombre: wa.nombre, ok: true, pdf: !!pdfPublicUrl });
    } catch(e) {
      resultados.push({ nombre: wa.nombre, ok: false, error: e.message });
    }
  }
  res.json({ ok: true, enviados: resultados.filter(r=>r.ok).length, total: numeros.length, pdf_generado: !!pdfBase64, detalle: resultados });
});

// ── TICKETS ──

// Listar tickets con filtros (admin/supervisor ven todos; cajero solo los suyos)
app.get('/api/tickets', auth(), (req, res) => {
  try {
    const rol = req.user.rol;
    const { estado, prioridad, area, asignado_a } = req.query;
    let w = rol === 'cajero' ? `WHERE t.cajero_id='${req.user.id}'` : 'WHERE 1=1';
    if (estado)     w += ` AND t.estado='${estado}'`;
    if (prioridad)  w += ` AND t.prioridad='${prioridad}'`;
    if (area)       w += ` AND t.area='${area}'`;
    if (asignado_a) w += ` AND t.asignado_a='${asignado_a}'`;
    const rows = all(`SELECT t.*, u.nombre as cajero_nombre2
      FROM tickets t LEFT JOIN usuarios u ON u.id=t.cajero_id
      ${w} ORDER BY
        CASE t.prioridad WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
        t.creado DESC LIMIT 200`);
    rows.forEach(t => {
      const ult = get(`SELECT mensaje, usuario_nombre, creado FROM ticket_mensajes
        WHERE ticket_id=? ORDER BY id DESC LIMIT 1`, [t.id]);
      t.ultimo_mensaje = ult || null;
      t.total_mensajes = (get(`SELECT COUNT(*) as c FROM ticket_mensajes WHERE ticket_id=?`, [t.id])||{}).c||0;
    });
    res.json(rows);
  } catch(e) { res.status(500).json({error: e.message}); }
});

// Crear ticket (manual o automático al cerrar turno)
app.post('/api/tickets', auth(), (req, res) => {
  try {
    const { turno_id, turno_letra, fecha_cierre, total_ventas, reporte_articulos,
            area, titulo, tipo, descripcion, prioridad, asignado_a, fotos } = req.body;
    const id = uuid();
    // Obtener nombre del asignado
    let asigNombre = '';
    if (asignado_a) {
      const u = get(`SELECT nombre FROM usuarios WHERE id=?`, [asignado_a]);
      asigNombre = u?.nombre || '';
    }
    run(`INSERT INTO tickets(id,turno_id,cajero_id,cajero_nombre,turno_letra,fecha_cierre,
          total_ventas,reporte_articulos,area,titulo,tipo,descripcion,prioridad,asignado_a,asignado_nombre,fotos)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, turno_id||null, req.user.id, req.user.nombre, turno_letra||null,
       fecha_cierre||null, total_ventas||0, reporte_articulos||'',
       area||null, titulo||null, tipo||null, descripcion||null,
       prioridad||'media', asignado_a||null, asigNombre,
       JSON.stringify(fotos||[])]);
    saveDB();
    res.json({ id });
  } catch(e) { res.status(500).json({error: e.message}); }
});

// Obtener un ticket con sus mensajes
// Stats del dashboard de tickets
app.get('/api/tickets/stats', auth(), (req, res) => {
  try {
    const rol = req.user.rol;
    let base = rol === 'cajero' ? `WHERE cajero_id='${req.user.id}'` : '';
    const total     = (get(`SELECT COUNT(*) as c FROM tickets ${base}`)||{}).c||0;
    const abiertos  = (get(`SELECT COUNT(*) as c FROM tickets ${base?base+' AND':' WHERE'} estado='abierto'`)||{}).c||0;
    const revision  = (get(`SELECT COUNT(*) as c FROM tickets ${base?base+' AND':' WHERE'} estado='en_revision'`)||{}).c||0;
    const resueltos = (get(`SELECT COUNT(*) as c FROM tickets ${base?base+' AND':' WHERE'} estado='resuelto'`)||{}).c||0;
    res.json({ total, abiertos, revision, resueltos });
  } catch(e) { res.status(500).json({error: e.message}); }
});

// Badge: tickets abiertos sin respuesta (para notificación en menú)
app.get('/api/tickets/badge', auth(), (req, res) => {
  try {
    const rol = req.user.rol;
    let count;
    if (rol === 'cajero') {
      count = (get(`SELECT COUNT(*) as c FROM tickets WHERE cajero_id=? AND estado!='resuelto'`,
        [req.user.id])||{}).c||0;
    } else {
      count = (get(`SELECT COUNT(*) as c FROM tickets WHERE estado='abierto'`)||{}).c||0;
    }
    res.json({ count });
  } catch(e) { res.status(500).json({error: e.message}); }
});

// ── BANCOS ──

app.get('/api/tickets/:id', auth(), (req, res) => {
  try {
    const t = get(`SELECT * FROM tickets WHERE id=?`, [req.params.id]);
    if (!t) return res.status(404).json({error:'Ticket no encontrado'});
    t.mensajes = all(`SELECT * FROM ticket_mensajes WHERE ticket_id=? ORDER BY id ASC`, [req.params.id]);
    res.json(t);
  } catch(e) { res.status(500).json({error: e.message}); }
});

// Agregar mensaje a un ticket
app.post('/api/tickets/:id/mensajes', auth(), (req, res) => {
  try {
    const t = get(`SELECT * FROM tickets WHERE id=?`, [req.params.id]);
    if (!t) return res.status(404).json({error:'Ticket no encontrado'});
    const { mensaje } = req.body;
    if (!mensaje?.trim()) return res.status(400).json({error:'Mensaje vacío'});
    run(`INSERT INTO ticket_mensajes(ticket_id,usuario_id,usuario_nombre,usuario_rol,mensaje)
      VALUES(?,?,?,?,?)`,
      [req.params.id, req.user.id, req.user.nombre, req.user.rol, mensaje.trim()]);
    // Si supervisor/admin responde → pasa a en_revision; si resuelto lo marca
    if (req.user.rol !== 'cajero' && t.estado === 'abierto') {
      run(`UPDATE tickets SET estado='en_revision' WHERE id=?`, [req.params.id]);
    }
    saveDB();
    res.json({ok:1});
  } catch(e) { res.status(500).json({error: e.message}); }
});

// Cambiar estado del ticket (supervisor/admin)
app.put('/api/tickets/:id/estado', auth(['admin','supervisor']), async (req, res) => {
  try {
    const { estado, resolucion, adjunto_resolucion } = req.body;
    if (!['abierto','en_revision','resuelto'].includes(estado))
      return res.status(400).json({error:'Estado inválido'});

    // ── Validaciones solo al resolver ────────────────────────────────────────
    if (estado === 'resuelto') {
      const ticket = get(`SELECT * FROM tickets WHERE id=?`, [req.params.id]);
      if (!ticket) return res.status(404).json({error:'Ticket no encontrado'});

      // 1. Verificar que sea ticket de turno
      if (ticket.turno_id) {
        // 2. Debe tener adjunto (fotos existentes O adjunto nuevo enviado)
        const fotosExistentes = JSON.parse(ticket.fotos||'[]');
        if (!fotosExistentes.length && !adjunto_resolucion) {
          return res.status(400).json({
            error: 'Este ticket de turno requiere un documento adjunto antes de marcarse como Resuelto.',
            code: 'ADJUNTO_REQUERIDO'
          });
        }

        // 3. Generar PDF de resolución
        let pdfBase64 = null;
        try {
          const mensajes = all(
            `SELECT m.*,u.nombre as u_nombre FROM ticket_mensajes m
             LEFT JOIN usuarios u ON u.id=m.usuario_id
             WHERE m.ticket_id=? ORDER BY m.creado`,
            [req.params.id]
          );

          pdfBase64 = await new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const chunks = [];
            doc.on('data',  c => chunks.push(c));
            doc.on('end',   () => resolve(Buffer.concat(chunks).toString('base64')));
            doc.on('error', reject);

            const empresa = ticket.cajero_nombre ? ticket.cajero_nombre : 'MetricPOS';
            const ahora   = new Date(new Date().getTime() - 6*3600000)
                              .toISOString().replace('T',' ').substring(0,19);

            // ── Encabezado ──
            doc.fontSize(16).fillColor('#1e3a5f')
               .text('RESOLUCIÓN DE TICKET DE TURNO', { align: 'center' });
            doc.moveDown(0.3);
            doc.fontSize(10).fillColor('#64748b')
               .text(`Generado: ${ahora}`, { align: 'center' });
            doc.moveDown(0.5);
            doc.moveTo(50,doc.y).lineTo(545,doc.y).strokeColor('#1e3a5f').lineWidth(2).stroke();
            doc.moveDown(0.5);

            // ── Datos del ticket ──
            const campos = [
              ['Ticket',    ticket.id.substring(0,8).toUpperCase()],
              ['Título',    ticket.titulo || `Turno ${ticket.turno_letra||'A'}`],
              ['Cajero',    ticket.cajero_nombre || '—'],
              ['Turno',     ticket.turno_letra   || 'A'],
              ['Cierre',    ticket.fecha_cierre  || '—'],
              ['Total Vtas','L. '+(parseFloat(ticket.total_ventas||0).toFixed(2))],
              ['Área',      ticket.area     || 'Caja'],
              ['Prioridad', ticket.prioridad|| 'media'],
            ];
            doc.fontSize(10).fillColor('#1e293b');
            campos.forEach(([l,v]) => {
              doc.font('Helvetica-Bold').text(`${l}: `, { continued: true })
                 .font('Helvetica').text(v);
            });
            doc.moveDown(0.5);
            doc.moveTo(50,doc.y).lineTo(545,doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
            doc.moveDown(0.5);

            // ── Reporte de artículos ──
            if (ticket.reporte_articulos) {
              doc.fontSize(11).fillColor('#1e3a5f').font('Helvetica-Bold')
                 .text('ARTÍCULOS VENDIDOS EN EL TURNO');
              doc.moveDown(0.2);
              doc.fontSize(8).fillColor('#1e293b').font('Courier')
                 .text(ticket.reporte_articulos, { lineGap: 2 });
              doc.moveDown(0.5);
              doc.moveTo(50,doc.y).lineTo(545,doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
              doc.moveDown(0.5);
            }

            // ── Historial de mensajes ──
            if (mensajes.length) {
              doc.fontSize(11).fillColor('#1e3a5f').font('Helvetica-Bold')
                 .text('HISTORIAL DE MENSAJES');
              doc.moveDown(0.3);
              mensajes.forEach(m => {
                doc.fontSize(9).fillColor('#64748b').font('Helvetica-Bold')
                   .text(`${m.u_nombre||'Sistema'} — ${(m.creado||'').substring(0,16)}`);
                doc.fontSize(9).fillColor('#1e293b').font('Helvetica')
                   .text(m.mensaje, { lineGap: 2 });
                doc.moveDown(0.3);
              });
              doc.moveTo(50,doc.y).lineTo(545,doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
              doc.moveDown(0.5);
            }

            // ── Texto de resolución ──
            if (resolucion) {
              doc.fontSize(11).fillColor('#059669').font('Helvetica-Bold')
                 .text('RESOLUCIÓN / OBSERVACIONES DEL SUPERVISOR');
              doc.moveDown(0.2);
              doc.fontSize(10).fillColor('#1e293b').font('Helvetica')
                 .text(resolucion, { lineGap: 3 });
              doc.moveDown(0.5);
            }

            // ── Firma final ──
            doc.moveTo(50,doc.y).lineTo(545,doc.y).strokeColor('#1e3a5f').lineWidth(2).stroke();
            doc.moveDown(0.5);
            doc.fontSize(9).fillColor('#94a3b8').font('Helvetica')
               .text(`MetricPOS v7.3 — Ticket resuelto el ${ahora}`, { align: 'center' });

            doc.end();
          });
        } catch(pdfErr) {
          console.error('Error generando PDF:', pdfErr.message);
        }

        // Generar token público de un solo uso (expira en 24h — se verifica en el endpoint)
        const pdfToken = pdfBase64 ? uuid() : null;

        // Procesar adjunto del supervisor: extraer MIME y base64 puro desde data URL
        let adjuntoBase64puro = null;
        let adjuntoMime       = null;
        let adjuntoToken      = null;
        if (adjunto_resolucion) {
          // adjunto_resolucion viene como data URL: "data:image/jpeg;base64,XXXXX"
          const match = adjunto_resolucion.match(/^data:([^;]+);base64,(.+)$/s);
          if (match) {
            adjuntoMime      = match[1];          // ej. "image/jpeg" o "application/pdf"
            adjuntoBase64puro = match[2];
            adjuntoToken     = uuid();
          }
        }

        // Guardar PDF y adjunto original en el ticket
        const fotosActuales = JSON.parse(ticket.fotos||'[]');
        const fotasFinales  = adjunto_resolucion
          ? [...fotosActuales, adjunto_resolucion]
          : fotosActuales;

        run(`UPDATE tickets SET
               estado=?,
               resolucion=?,
               pdf_resolucion=?,
               pdf_token=?,
               fotos=?,
               adjunto_token=?,
               adjunto_mime=?
             WHERE id=?`,
          [estado, resolucion||null, pdfBase64, pdfToken, JSON.stringify(fotasFinales),
           adjuntoToken||null, adjuntoMime||null, req.params.id]
        );
        saveDB();

        // 4. Envío automático TextMeBot a números configurados
        const numeros = all(`SELECT * FROM whatsapp_numeros WHERE activo=1 AND callmebot_apikey IS NOT NULL AND callmebot_apikey != ''`);
        if (numeros.length) {
          const serverUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : process.env.SERVER_URL || 'http://localhost:3000';

          const pdfPublicUrl     = pdfToken     ? `${serverUrl}/public/pdf/${pdfToken}`         : null;
          const adjuntoPublicUrl = adjuntoToken ? `${serverUrl}/public/adjunto/${adjuntoToken}` : null;

          const msg = `✅ *MetricPOS — Ticket Resuelto*\n`
            + `🎫 ${ticket.titulo || 'Turno '+ticket.turno_letra}\n`
            + `👤 Cajero: ${ticket.cajero_nombre||'—'}\n`
            + `💰 Total: L. ${parseFloat(ticket.total_ventas||0).toFixed(2)}\n`
            + `📝 ${resolucion || 'Sin observaciones'}\n`
            + `🕐 ${new Date(new Date().getTime()-6*3600000).toISOString().replace('T',' ').substring(0,16)}`;

          (async () => {
            for (const wa of numeros) {
              try {
                // 1. Texto de notificación
                await _textmebotEnviar({ numero: wa.numero, apikey: wa.callmebot_apikey, mensaje: msg });
                await new Promise(r => setTimeout(r, 5000));

                // 2. PDF de resolución generado por MetricPOS
                if (pdfPublicUrl) {
                  await _textmebotEnviar({
                    numero:    wa.numero,
                    apikey:    wa.callmebot_apikey,
                    pdfUrl:    pdfPublicUrl,
                    pdfNombre: `Resolucion_Turno_${ticket.turno_letra||'A'}.pdf`,
                    mensaje:   `📄 Resolución del turno ${ticket.turno_letra||'A'}`
                  });
                  await new Promise(r => setTimeout(r, 5000));
                }

                // 3. Documento adjunto del supervisor (imagen o PDF original)
                if (adjuntoPublicUrl) {
                  const esPdf  = adjuntoMime === 'application/pdf';
                  const ext    = adjuntoMime ? adjuntoMime.split('/')[1].split('+')[0] : 'jpg';
                  const nombre = `Adjunto_Turno_${ticket.turno_letra||'A'}.${esPdf ? 'pdf' : ext}`;
                  await _textmebotEnviar({
                    numero:    wa.numero,
                    apikey:    wa.callmebot_apikey,
                    pdfUrl:    adjuntoPublicUrl,
                    pdfNombre: nombre,
                    mensaje:   `📎 Documento adjunto del supervisor — Turno ${ticket.turno_letra||'A'}`
                  });
                  await new Promise(r => setTimeout(r, 5000));
                }
              } catch(e) { console.error('TextMeBot error:', e.message); }
            }
          })();
        }

        return res.json({ ok:1, pdf_generado: !!pdfBase64, adjunto_enviado: !!adjuntoToken });
      }
    }

    // Para tickets sin turno_id o estados no-resuelto: flujo normal
    run(`UPDATE tickets SET estado=? WHERE id=?`, [estado, req.params.id]);
    saveDB();
    res.json({ok:1});
  } catch(e) { res.status(500).json({error: e.message}); }
});


// Descarga pública del PDF de cierre de turno por token (sin autenticación — válido 24h)
app.get('/public/pdf-turno/:token', (req, res) => {
  try {
    const turno = get(
      `SELECT pdf_cierre, pdf_token, turno_letra,
              datetime(fecha_cierre, '+24 hours') as expira
       FROM turnos WHERE pdf_token=?`,
      [req.params.token]
    );
    if (!turno?.pdf_cierre) {
      return res.status(404).send('<h2>PDF no disponible o link expirado</h2>');
    }
    const ahora = new Date(new Date().getTime() - 6*3600000).toISOString().replace('T',' ').substring(0,19);
    if (turno.expira && ahora > turno.expira) {
      return res.status(410).send('<h2>Este link ha expirado (válido 24 horas)</h2>');
    }
    const buf    = Buffer.from(turno.pdf_cierre, 'base64');
    const nombre = `Cierre_Turno_${turno.turno_letra||'A'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.send(buf);
  } catch(e) { res.status(500).send('Error: ' + e.message); }
});

// Descarga pública del adjunto del supervisor por token (sin autenticación — válido 24h)
app.get('/public/adjunto/:token', (req, res) => {
  try {
    const ticket = get(
      `SELECT fotos, adjunto_token, adjunto_mime, turno_letra, estado,
              datetime(creado, '+24 hours') as expira
       FROM tickets WHERE adjunto_token=? AND estado='resuelto'`,
      [req.params.token]
    );
    if (!ticket) return res.status(404).send('<h2>Adjunto no disponible o link expirado</h2>');

    // Verificar expiración 24h
    const ahora = new Date(new Date().getTime() - 6*3600000).toISOString().replace('T',' ').substring(0,19);
    if (ticket.expira && ahora > ticket.expira) {
      return res.status(410).send('<h2>Este link ha expirado (válido 24 horas)</h2>');
    }

    // El adjunto está guardado en fotos[] como el último elemento (data URL o base64 puro)
    const fotos = JSON.parse(ticket.fotos || '[]');
    // Buscar el adjunto: puede ser data URL "data:mime;base64,XXX" o base64 puro
    // El adjunto del supervisor siempre es el último que se agregó con adjunto_resolucion
    const adjuntoRaw = fotos[fotos.length - 1];
    if (!adjuntoRaw) return res.status(404).send('<h2>Adjunto no encontrado</h2>');

    let mime = ticket.adjunto_mime || 'application/octet-stream';
    let buf;
    const match = adjuntoRaw.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) {
      mime = match[1];
      buf  = Buffer.from(match[2], 'base64');
    } else {
      buf = Buffer.from(adjuntoRaw, 'base64');
    }

    const ext    = mime.split('/')[1]?.split('+')[0] || 'bin';
    const nombre = `Adjunto_Turno_${ticket.turno_letra||'A'}.${ext}`;
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.send(buf);
  } catch(e) { res.status(500).send('Error: ' + e.message); }
});

// Descarga pública de PDF por token (sin autenticación — válido 24h desde resolución)
app.get('/public/pdf/:token', (req, res) => {
  try {
    const ticket = get(
      `SELECT pdf_resolucion, pdf_token, titulo, turno_letra, estado,
              datetime(creado, '+24 hours') as expira
       FROM tickets WHERE pdf_token=? AND estado='resuelto'`,
      [req.params.token]
    );
    if (!ticket?.pdf_resolucion) {
      return res.status(404).send('<h2>PDF no disponible o link expirado</h2>');
    }
    // Verificar expiración 24h (comparando con hora Honduras UTC-6)
    const ahora = new Date(new Date().getTime() - 6*3600000).toISOString().replace('T',' ').substring(0,19);
    if (ticket.expira && ahora > ticket.expira) {
      return res.status(410).send('<h2>Este link ha expirado (válido 24 horas)</h2>');
    }
    const buf = Buffer.from(ticket.pdf_resolucion, 'base64');
    const nombre = `Resolucion_Turno_${ticket.turno_letra||'A'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.send(buf);
  } catch(e) { res.status(500).send('Error: '+e.message); }
});

// Descarga PDF autenticada (para uso interno desde el módulo de tickets)
app.get('/api/tickets/:id/pdf', auth(), (req, res) => {
  try {
    const ticket = get(`SELECT pdf_resolucion, titulo, turno_letra FROM tickets WHERE id=?`, [req.params.id]);
    if (!ticket?.pdf_resolucion) return res.status(404).json({error:'PDF no disponible'});
    const buf = Buffer.from(ticket.pdf_resolucion, 'base64');
    const nombre = `Resolucion_Turno_${ticket.turno_letra||'A'}.pdf`;
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${nombre}"`);
    res.send(buf);
  } catch(e) { res.status(500).json({error: e.message}); }
});

// ── BANCOS ──
app.get('/api/bancos',auth(),(req,res)=>res.json(all(`SELECT * FROM bancos WHERE activo=1 ORDER BY nombre`)));
app.get('/api/bancos/consolidacion',auth(),(req,res)=>{
  const bancos=all(`SELECT * FROM bancos WHERE activo=1`);
  const total=bancos.reduce((s,b)=>s+b.saldo_actual,0);
  res.json({bancos,total_consolidado:total});
});
app.post('/api/bancos',auth(['admin']),(req,res)=>{
  const{nombre,numero_cuenta,tipo,moneda,saldo_inicial}=req.body;
  const id=uuid();
  run(`INSERT INTO bancos(id,nombre,numero_cuenta,tipo,moneda,saldo_inicial,saldo_actual)VALUES(?,?,?,?,?,?,?)`,[id,nombre,numero_cuenta||'',tipo||'corriente',moneda||'HNL',saldo_inicial||0,saldo_inicial||0]);
  saveDB(); res.json({id});
});
app.put('/api/bancos/:id',auth(['admin']),(req,res)=>{
  const{nombre,numero_cuenta,tipo,moneda}=req.body;
  run(`UPDATE bancos SET nombre=?,numero_cuenta=?,tipo=?,moneda=? WHERE id=?`,[nombre,numero_cuenta||'',tipo||'corriente',moneda||'HNL',req.params.id]);
  saveDB(); res.json({ok:1});
});
app.delete('/api/bancos/:id',auth(['admin']),(req,res)=>{ run(`UPDATE bancos SET activo=0 WHERE id=?`,[req.params.id]); saveDB(); res.json({ok:1}); });
app.get('/api/bancos/:id/movimientos',auth(),(req,res)=>{
  const{fecha_ini,fecha_fin}=req.query;
  let sql=`SELECT bm.*,u.nombre as usuario_nombre FROM bancos_movimientos bm LEFT JOIN usuarios u ON u.id=bm.usuario_id WHERE bm.banco_id=?`;
  const p=[req.params.id];
  if(fecha_ini){sql+=` AND date(bm.fecha)>=?`;p.push(fecha_ini);}
  if(fecha_fin){sql+=` AND date(bm.fecha)<=?`;p.push(fecha_fin);}
  sql+=` ORDER BY bm.fecha DESC LIMIT 500`;
  res.json(all(sql,p));
});
app.post('/api/bancos/:id/movimientos',auth(['admin','supervisor']),(req,res)=>{
  const{tipo,monto,descripcion,referencia,fecha}=req.body;
  const banco=get(`SELECT * FROM bancos WHERE id=?`,[req.params.id]);
  if(!banco)return res.status(404).json({error:'Banco no encontrado'});
  const saldo_ant=banco.saldo_actual;
  const nuevo_saldo=(tipo==='deposito'||tipo==='nota_credito')?saldo_ant+monto:saldo_ant-monto;
  const id=uuid();
  run(`INSERT INTO bancos_movimientos(id,banco_id,tipo,fecha,monto,descripcion,referencia,saldo_anterior,saldo_nuevo,usuario_id)VALUES(?,?,?,?,?,?,?,?,?,?)`,[id,req.params.id,tipo,fecha||nowHN(),monto,descripcion||'',referencia||'',saldo_ant,nuevo_saldo,req.user.id]);
  run(`UPDATE bancos SET saldo_actual=? WHERE id=?`,[nuevo_saldo,req.params.id]);
  saveDB(); res.json({id,saldo_actual:nuevo_saldo});
});

// ── IMPUESTOS ──
app.get('/api/impuestos',auth(),(req,res)=>res.json(all(`SELECT * FROM impuestos WHERE activo=1 ORDER BY nombre`)));
app.post('/api/impuestos',auth(['admin']),(req,res)=>{
  const{nombre,tasa,tipo,aplica_a}=req.body;
  const id=uuid();
  run(`INSERT INTO impuestos(id,nombre,tasa,tipo,aplica_a)VALUES(?,?,?,?,?)`,[id,nombre,tasa,tipo||'porcentaje',aplica_a||'todos']);
  saveDB(); res.json({id});
});
app.put('/api/impuestos/:id',auth(['admin']),(req,res)=>{
  const{nombre,tasa,tipo,aplica_a,activo}=req.body;
  run(`UPDATE impuestos SET nombre=?,tasa=?,tipo=?,aplica_a=?,activo=? WHERE id=?`,[nombre,tasa,tipo||'porcentaje',aplica_a||'todos',activo!==false?1:0,req.params.id]);
  saveDB(); res.json({ok:1});
});
app.delete('/api/impuestos/:id',auth(['admin']),(req,res)=>{ run(`UPDATE impuestos SET activo=0 WHERE id=?`,[req.params.id]); saveDB(); res.json({ok:1}); });

// ── PERMISOS MÓDULOS ──
app.get('/api/usuarios/:id/permisos',auth(['admin']),(req,res)=>{
  const permisos=all(`SELECT modulo,bloqueado FROM permisos_modulos WHERE usuario_id=?`,[req.params.id]);
  res.json(permisos);
});
app.put('/api/usuarios/:id/permisos',auth(['admin']),(req,res)=>{
  const{modulo,bloqueado}=req.body;
  run(`INSERT OR REPLACE INTO permisos_modulos(usuario_id,modulo,bloqueado)VALUES(?,?,?)`,[req.params.id,modulo,bloqueado?1:0]);
  saveDB(); res.json({ok:1});
});

// ── CARGA EXCEL DE PRODUCTOS ──
app.post('/api/productos/importar_excel',auth(['admin','supervisor']),(req,res)=>{
  const{productos}=req.body;
  if(!Array.isArray(productos)||productos.length===0)return res.status(400).json({error:'Sin productos'});
  let creados=0,actualizados=0,errores=[];
  for(const p of productos){
    try{
      const{codigo,nombre,categoria,precio_venta,costo,gravado}=p;
      // Precio en 0 es válido (ej: servicios cuyo precio se define al facturar).
      // Solo se descarta la fila si falta código o nombre.
      if(!codigo||!nombre){ errores.push({codigo:codigo||'(sin código)',error:'Falta código o nombre'}); continue; }
      const exist=get(`SELECT id FROM productos WHERE codigo=?`,[codigo]);
      if(exist){
        run(`UPDATE productos SET nombre=?,categoria=?,precio_venta=?,costo=?,gravado=? WHERE id=?`,[nombre,categoria||'General',parseFloat(precio_venta)||0,parseFloat(costo)||0,gravado!==false&&gravado!=='0'?1:0,exist.id]);
        actualizados++;
      }else{
        const id=uuid();
        run(`INSERT INTO productos(id,codigo,nombre,categoria,precio_venta,costo,gravado)VALUES(?,?,?,?,?,?,?)`,[id,codigo,nombre,categoria||'General',parseFloat(precio_venta)||0,parseFloat(costo)||0,gravado!==false&&gravado!=='0'?1:0]);
        all(`SELECT id FROM sucursales WHERE activa=1`).forEach(s=>run(`INSERT OR IGNORE INTO inventario(producto_id,sucursal_id,stock,stock_min)VALUES(?,?,0,0)`,[id,s.id]));
        creados++;
      }
    }catch(e){errores.push({codigo:p.codigo,error:e.message});}
  }
  saveDB(); res.json({creados,actualizados,errores,total:productos.length});
});

// ── IMPORTAR MOVIMIENTOS DE INVENTARIO DESDE EXCEL ──
app.post('/api/inventario/importar_excel',auth(['admin','supervisor']),(req,res)=>{
  const{movimientos,sucursal_id}=req.body;
  if(!Array.isArray(movimientos)||movimientos.length===0)return res.status(400).json({error:'Sin datos'});
  const suc=sucursal_id||req.user.sucursal_id;
  let procesados=0,errores=[];
  for(const m of movimientos){
    try{
      const codigo=(m.codigo||'').toString().trim();
      const tipo=(m.tipo||'entrada').toString().toLowerCase().trim();
      const cantidad=parseInt(m.cantidad)||0;
      if(!codigo||cantidad<=0){errores.push({codigo,error:'Código o cantidad inválida'});continue;}
      if(!['entrada','ajuste'].includes(tipo)){errores.push({codigo,error:`Tipo inválido: ${tipo} (use entrada o ajuste)`});continue;}
      const prod=get(`SELECT id FROM productos WHERE codigo=? AND activo=1`,[codigo]);
      if(!prod){errores.push({codigo,error:'Producto no encontrado'});continue;}
      // Para servicios no se aplica movimiento
      const categ=get(`SELECT categoria FROM productos WHERE id=?`,[prod.id]);
      if((categ?.categoria||'').toLowerCase()==='servicios'){errores.push({codigo,error:'Servicios no manejan inventario'});continue;}
      const costo=parseFloat(m.costo_unit)||0;
      const motivo=(m.motivo||'Importación masiva Excel').toString().trim();
      if(tipo==='ajuste'){
        // Ajuste: establece stock exacto
        const inv=get(`SELECT stock FROM inventario WHERE producto_id=? AND sucursal_id=?`,[prod.id,suc]);
        const cur=inv?inv.stock:0;
        const diff=cantidad-cur;
        ajustarStock(prod.id,suc,diff,'ajuste','IMP-EXCEL',motivo,req.user.id,costo,0);
      }else{
        // Entrada: suma al stock existente
        ajustarStock(prod.id,suc,cantidad,'entrada','IMP-EXCEL',motivo,req.user.id,costo,0);
      }
      procesados++;
    }catch(e){errores.push({codigo:m.codigo,error:e.message});}
  }
  saveDB(); res.json({procesados,errores,total:movimientos.length});
});

// ── REPORTE LIBRO FISCAL ──
app.get('/api/reportes/libro_fiscal',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  const{fecha_ini,fecha_fin,serie}=req.query;
  let w=`WHERE v.sucursal_id=? AND v.estado='emitida'`;const p=[suc];
  if(fecha_ini){w+=` AND date(v.fecha)>=?`;p.push(fecha_ini);}
  if(fecha_fin){w+=` AND date(v.fecha)<=?`;p.push(fecha_fin);}
  if(serie){w+=` AND v.numero_factura LIKE ?`;p.push(serie.replace(/-+$/,'')+'%');}
  const ventas=all(`SELECT v.*,c.nombre as cliente_nombre,c.rtn as cliente_rtn FROM ventas v LEFT JOIN clientes c ON c.id=v.cliente_id ${w} ORDER BY v.fecha ASC`,p);
  res.json(ventas);
});

// ── REPORTE VALORIZACIÓN DE INVENTARIO ──
app.get('/api/reportes/valorizacion',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  res.json(all(`SELECT p.codigo,p.nombre,p.categoria,p.precio_venta,p.costo,
    COALESCE(i.stock,0) as stock,COALESCE(i.stock_min,0) as stock_min,
    COALESCE(i.stock,0)*p.costo as valor_costo,
    COALESCE(i.stock,0)*p.precio_venta as valor_venta,
    (COALESCE(i.stock,0)*p.precio_venta)-(COALESCE(i.stock,0)*p.costo) as margen
    FROM productos p LEFT JOIN inventario i ON i.producto_id=p.id AND i.sucursal_id=?
    WHERE p.activo=1 ORDER BY p.categoria,p.nombre`,[suc]));
});

// ── REPORTE CORTE CAJA CON HORA ──
app.get('/api/reportes/corte_caja_detalle',auth(),(req,res)=>{
  const suc=req.query.sucursal_id||req.user.sucursal_id;
  const{fecha_ini,fecha_fin,hora_ini,hora_fin,serie}=req.query;
  let w=`WHERE v.sucursal_id=? AND v.estado!='anulada'`;const p=[suc];
  if(fecha_ini&&hora_ini){w+=` AND datetime(v.fecha)>=?`;p.push(`${fecha_ini} ${hora_ini}`);}
  else if(fecha_ini){w+=` AND date(v.fecha)>=?`;p.push(fecha_ini);}
  if(fecha_fin&&hora_fin){w+=` AND datetime(v.fecha)<=?`;p.push(`${fecha_fin} ${hora_fin}`);}
  else if(fecha_fin){w+=` AND date(v.fecha)<=?`;p.push(fecha_fin);}
  if(serie){w+=` AND v.numero_factura LIKE ?`;p.push(serie.replace(/-+$/,'')+'%');}
  const ventas=all(`SELECT v.*,c.nombre as cliente_nombre FROM ventas v LEFT JOIN clientes c ON c.id=v.cliente_id ${w} ORDER BY v.fecha ASC`,p);
  const resumen=get(`SELECT COUNT(*)as total_ventas,SUM(subtotal)as subtotal,SUM(descuento)as descuentos,SUM(isv15)as isv15,SUM(isv18)as isv18,SUM(total)as total,
    SUM(CASE WHEN forma_pago='efectivo' THEN total ELSE 0 END) as total_efectivo,
    SUM(CASE WHEN forma_pago='tarjeta' THEN total ELSE 0 END) as total_tarjeta,
    SUM(CASE WHEN forma_pago='transferencia' THEN total ELSE 0 END) as total_transferencia
    FROM ventas v ${w}`,p)||{};
  res.json({ventas,resumen});
});

// ── SPA fallback ──
app.get('/{*path}',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

initDB().then(()=>{
  app.listen(PORT,'0.0.0.0',()=>{
    const env = process.env.NODE_ENV || 'development';
    const url = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : process.env.SERVER_URL || `http://localhost:${PORT}`;
    console.log(`\n🚀 MetricPOS v7.3 [${env.toUpperCase()}]`);
    console.log(`   URL:    ${url}`);
    console.log(`   Puerto: ${PORT}`);
    console.log(`   BD:     ${DB_FILE}`);
    console.log(`   Login:  admin / admin123\n`);
  });
}).catch(err=>{console.error(err);process.exit(1);});
