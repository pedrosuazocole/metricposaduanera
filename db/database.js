const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'metricpos.db');

let db = null;

async function getDB() {
  if (db) return db;
  const SQL = await initSqlJs();
  
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
    initSchema();
    saveDB();
  }
  return db;
}

function saveDB() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function initSchema() {
  db.run(`PRAGMA journal_mode=WAL;`);
  db.run(`PRAGMA foreign_keys=ON;`);

  // Sucursales
  db.run(`CREATE TABLE IF NOT EXISTS sucursales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    direccion TEXT,
    telefono TEXT,
    email TEXT,
    rtn TEXT,
    activa INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Usuarios
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL CHECK(rol IN ('administrador','supervisor','cajero')),
    sucursal_id INTEGER,
    activo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(sucursal_id) REFERENCES sucursales(id)
  )`);

  // Configuración empresa
  db.run(`CREATE TABLE IF NOT EXISTS configuracion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sucursal_id INTEGER NOT NULL,
    empresa_nombre TEXT,
    empresa_rtn TEXT,
    empresa_direccion TEXT,
    empresa_telefono TEXT,
    empresa_email TEXT,
    empresa_logo TEXT,
    cai TEXT,
    rango_inicio TEXT,
    rango_fin TEXT,
    fecha_limite_emision TEXT,
    serie_factura TEXT,
    FOREIGN KEY(sucursal_id) REFERENCES sucursales(id)
  )`);

  // Categorías
  db.run(`CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT
  )`);

  // Productos
  db.run(`CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT UNIQUE NOT NULL,
    codigo_barras TEXT,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    categoria_id INTEGER,
    precio_compra REAL DEFAULT 0,
    precio_venta REAL NOT NULL,
    stock_actual REAL DEFAULT 0,
    stock_minimo REAL DEFAULT 0,
    unidad TEXT DEFAULT 'unidad',
    gravado INTEGER DEFAULT 1,
    activo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(categoria_id) REFERENCES categorias(id)
  )`);

  // Stock por sucursal
  db.run(`CREATE TABLE IF NOT EXISTS stock_sucursal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL,
    sucursal_id INTEGER NOT NULL,
    stock REAL DEFAULT 0,
    UNIQUE(producto_id, sucursal_id),
    FOREIGN KEY(producto_id) REFERENCES productos(id),
    FOREIGN KEY(sucursal_id) REFERENCES sucursales(id)
  )`);

  // Clientes
  db.run(`CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    rtn TEXT,
    direccion TEXT,
    telefono TEXT,
    email TEXT,
    limite_credito REAL DEFAULT 0,
    saldo_pendiente REAL DEFAULT 0,
    activo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Proveedores
  db.run(`CREATE TABLE IF NOT EXISTS proveedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    rtn TEXT,
    contacto TEXT,
    telefono TEXT,
    email TEXT,
    direccion TEXT,
    limite_credito REAL DEFAULT 0,
    saldo_pendiente REAL DEFAULT 0,
    activo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Facturas (ventas)
  db.run(`CREATE TABLE IF NOT EXISTS facturas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_factura TEXT UNIQUE NOT NULL,
    sucursal_id INTEGER NOT NULL,
    cliente_id INTEGER,
    usuario_id INTEGER NOT NULL,
    fecha TEXT DEFAULT (datetime('now')),
    subtotal REAL DEFAULT 0,
    descuento REAL DEFAULT 0,
    importe_gravado REAL DEFAULT 0,
    importe_exento REAL DEFAULT 0,
    importe_exonerado REAL DEFAULT 0,
    isv15 REAL DEFAULT 0,
    isv18 REAL DEFAULT 0,
    total REAL DEFAULT 0,
    exonerado INTEGER DEFAULT 0,
    orden_compra_exenta TEXT,
    constancia_registro TEXT,
    identificativo_sag TEXT,
    estado TEXT DEFAULT 'emitida' CHECK(estado IN ('emitida','anulada','devuelta')),
    next_invoice INTEGER DEFAULT 1,
    FOREIGN KEY(sucursal_id) REFERENCES sucursales(id),
    FOREIGN KEY(cliente_id) REFERENCES clientes(id),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);

  // Detalle facturas
  db.run(`CREATE TABLE IF NOT EXISTS factura_detalle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factura_id INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    cantidad REAL NOT NULL,
    precio_unitario REAL NOT NULL,
    descuento REAL DEFAULT 0,
    subtotal REAL NOT NULL,
    FOREIGN KEY(factura_id) REFERENCES facturas(id),
    FOREIGN KEY(producto_id) REFERENCES productos(id)
  )`);

  // Compras a proveedores
  db.run(`CREATE TABLE IF NOT EXISTS compras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_compra TEXT UNIQUE NOT NULL,
    sucursal_id INTEGER NOT NULL,
    proveedor_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    fecha TEXT DEFAULT (datetime('now')),
    subtotal REAL DEFAULT 0,
    isv REAL DEFAULT 0,
    total REAL DEFAULT 0,
    estado TEXT DEFAULT 'recibida' CHECK(estado IN ('pendiente','recibida','parcial','cancelada')),
    notas TEXT,
    FOREIGN KEY(sucursal_id) REFERENCES sucursales(id),
    FOREIGN KEY(proveedor_id) REFERENCES proveedores(id),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);

  // Detalle compras
  db.run(`CREATE TABLE IF NOT EXISTS compra_detalle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compra_id INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    cantidad REAL NOT NULL,
    precio_compra REAL NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY(compra_id) REFERENCES compras(id),
    FOREIGN KEY(producto_id) REFERENCES productos(id)
  )`);

  // Devoluciones
  db.run(`CREATE TABLE IF NOT EXISTS devoluciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_devolucion TEXT UNIQUE NOT NULL,
    factura_id INTEGER NOT NULL,
    sucursal_id INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    fecha TEXT DEFAULT (datetime('now')),
    motivo TEXT NOT NULL,
    total REAL DEFAULT 0,
    tipo TEXT DEFAULT 'cliente' CHECK(tipo IN ('cliente','proveedor')),
    FOREIGN KEY(factura_id) REFERENCES facturas(id),
    FOREIGN KEY(sucursal_id) REFERENCES sucursales(id),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);

  // Detalle devoluciones
  db.run(`CREATE TABLE IF NOT EXISTS devolucion_detalle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    devolucion_id INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    cantidad REAL NOT NULL,
    precio_unitario REAL NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY(devolucion_id) REFERENCES devoluciones(id),
    FOREIGN KEY(producto_id) REFERENCES productos(id)
  )`);

  // Kardex
  db.run(`CREATE TABLE IF NOT EXISTS kardex (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL,
    sucursal_id INTEGER NOT NULL,
    fecha TEXT DEFAULT (datetime('now')),
    tipo TEXT NOT NULL CHECK(tipo IN ('entrada','salida','ajuste','devolucion','compra','venta','traslado')),
    referencia_tipo TEXT,
    referencia_id INTEGER,
    cantidad REAL NOT NULL,
    costo_unitario REAL DEFAULT 0,
    saldo_anterior REAL DEFAULT 0,
    saldo_nuevo REAL DEFAULT 0,
    usuario_id INTEGER,
    notas TEXT,
    FOREIGN KEY(producto_id) REFERENCES productos(id),
    FOREIGN KEY(sucursal_id) REFERENCES sucursales(id)
  )`);

  // Cuentas por cobrar
  db.run(`CREATE TABLE IF NOT EXISTS cxc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL,
    sucursal_id INTEGER NOT NULL,
    factura_id INTEGER,
    referencia TEXT,
    fecha TEXT DEFAULT (datetime('now')),
    fecha_vencimiento TEXT NOT NULL,
    monto REAL NOT NULL,
    saldo REAL NOT NULL,
    estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente','parcial','pagado','vencido')),
    notas TEXT,
    FOREIGN KEY(cliente_id) REFERENCES clientes(id),
    FOREIGN KEY(sucursal_id) REFERENCES sucursales(id)
  )`);

  // Pagos CxC
  db.run(`CREATE TABLE IF NOT EXISTS cxc_pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cxc_id INTEGER NOT NULL,
    fecha TEXT DEFAULT (datetime('now')),
    monto REAL NOT NULL,
    metodo TEXT DEFAULT 'efectivo',
    notas TEXT,
    usuario_id INTEGER,
    FOREIGN KEY(cxc_id) REFERENCES cxc(id)
  )`);

  // Cuentas por pagar
  db.run(`CREATE TABLE IF NOT EXISTS cxp (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proveedor_id INTEGER NOT NULL,
    sucursal_id INTEGER NOT NULL,
    compra_id INTEGER,
    referencia TEXT,
    fecha TEXT DEFAULT (datetime('now')),
    fecha_vencimiento TEXT NOT NULL,
    monto REAL NOT NULL,
    saldo REAL NOT NULL,
    estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente','parcial','pagado','vencido')),
    notas TEXT,
    FOREIGN KEY(proveedor_id) REFERENCES proveedores(id),
    FOREIGN KEY(sucursal_id) REFERENCES sucursales(id)
  )`);

  // Pagos CxP
  db.run(`CREATE TABLE IF NOT EXISTS cxp_pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cxp_id INTEGER NOT NULL,
    fecha TEXT DEFAULT (datetime('now')),
    monto REAL NOT NULL,
    metodo TEXT DEFAULT 'efectivo',
    notas TEXT,
    usuario_id INTEGER,
    FOREIGN KEY(cxp_id) REFERENCES cxp(id)
  )`);

  // Contador de facturas por sucursal
  db.run(`CREATE TABLE IF NOT EXISTS contadores (
    sucursal_id INTEGER PRIMARY KEY,
    next_invoice INTEGER DEFAULT 1,
    FOREIGN KEY(sucursal_id) REFERENCES sucursales(id)
  )`);

  // Log de sincronización entre sucursales
  db.run(`CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sucursal_origen INTEGER,
    tabla TEXT,
    operacion TEXT,
    registro_id INTEGER,
    fecha TEXT DEFAULT (datetime('now')),
    sincronizado INTEGER DEFAULT 0
  )`);

  // ─── DATOS INICIALES ──────────────────────────────────────────────────────
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');

  // Sucursal principal
  db.run(`INSERT OR IGNORE INTO sucursales (id, nombre, direccion) VALUES (1, 'Casa Matriz', 'Tegucigalpa, Honduras')`);

  // Usuario administrador por defecto
  const hash = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT OR IGNORE INTO usuarios (id, username, password_hash, nombre, rol, sucursal_id) 
    VALUES (1, 'admin', '${hash}', 'Administrador', 'administrador', 1)`);

  // Configuración inicial
  db.run(`INSERT OR IGNORE INTO configuracion (sucursal_id, empresa_nombre, empresa_rtn, cai, serie_factura, rango_inicio, rango_fin, fecha_limite_emision)
    VALUES (1, 'MI EMPRESA S. DE R.L.', '08011985024566', '6542H9-B3C8BC-7442C5-5BD634-5684F5-C0', '002-001-01', '002-001-01-00000001', '002-001-01-00000050', '2026-12-31')`);

  // Contador inicial
  db.run(`INSERT OR IGNORE INTO contadores (sucursal_id, next_invoice) VALUES (1, 1)`);

  // Categorías de ejemplo
  db.run(`INSERT OR IGNORE INTO categorias (id, nombre) VALUES (1,'Alimentos'),(2,'Bebidas'),(3,'Lácteos'),(4,'Limpieza'),(5,'Panadería')`);

  // Cliente consumidor final
  db.run(`INSERT OR IGNORE INTO clientes (id, nombre) VALUES (1, 'Consumidor Final')`);

  console.log('✅ Base de datos inicializada');
}

module.exports = { getDB, run, get, all, saveDB };
