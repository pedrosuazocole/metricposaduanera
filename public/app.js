// ═══════════════════════════════════════════════════════════════════════════
// METRIC POS v7.3 (Servicios) — Frontend App (REST API Mode)
// ═══════════════════════════════════════════════════════════════════════════
const API = '';
let TOKEN = localStorage.getItem('mp_token');
let USER  = JSON.parse(localStorage.getItem('mp_user')||'null');
let BRANCH= JSON.parse(localStorage.getItem('mp_branch')||'null');
// Caches globales compartidas entre módulos (Facturación, ND, Órdenes de Compra, Dashboard, etc.)
// Declaradas aquí arriba para evitar ReferenceError sin importar qué módulo se abra primero.
let products_cache  = [];
let clients_cache   = [];
let impuestos_cache = [];
let bancos_cache    = [];

// ─── API HELPER ──────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + '/api' + path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}
const GET    = (p, q='') => api('GET', p + (q ? '?' + q : ''));
const POST   = (p, b)    => api('POST', p, b);
const PUT    = (p, b)    => api('PUT', p, b);
const DELETE = (p)       => api('DELETE', p);

// ─── UTILS ───────────────────────────────────────────────────────────────────
const fL = n => 'L. ' + (parseFloat(n)||0).toFixed(2);
const fD = d => d ? new Date(d+'T06:00:00Z').toLocaleDateString('es-HN',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Tegucigalpa'}) : '—';
const fDT= d => d ? new Date(d).toLocaleString('es-HN',{timeZone:'America/Tegucigalpa'}) : '—';
const today = () => { const d=new Date(); return new Date(d.getTime()-6*3600000).toISOString().split('T')[0]; };
// Honduras UTC-6 helpers
function nowHN() { const d=new Date(); return new Date(d.getTime()-6*3600000).toISOString().replace('T',' ').substring(0,19); }
function todayHN() { const d=new Date(); return new Date(d.getTime()-6*3600000).toISOString().substring(0,10); }
function nowHNDate() { return new Date(new Date().getTime()-6*3600000); }
const closeModal = id => document.getElementById(id).classList.remove('open');
const openModal  = id => document.getElementById(id).classList.add('open');

function toast(id, ms=3000) {
  const el = document.getElementById(id);
  if(el) { el.style.display='flex'; setTimeout(()=>el.style.display='none',ms); }
}

function numberToWords(n) {
  const ones=['','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE','DIECIOCHO','DIECINUEVE'];
  const tens=['','','VEINTE','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
  const hunds=['','CIEN','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];
  if(n===0)return'CERO';let r='';
  if(Math.floor(n/1000000)>0){r+=(Math.floor(n/1000000)===1?'UN MILLÓN ':numberToWords(Math.floor(n/1000000))+' MILLONES ');n%=1000000;}
  if(Math.floor(n/1000)>0){r+=(Math.floor(n/1000)===1?'MIL ':numberToWords(Math.floor(n/1000))+' MIL ');n%=1000;}
  if(Math.floor(n/100)>0){r+=(n===100?'CIEN ':hunds[Math.floor(n/100)]+' ');n%=100;}
  if(n>0){if(n<20)r+=ones[n]+' ';else{r+=tens[Math.floor(n/10)]+' ';if(n%10>0)r+='Y '+ones[n%10]+' ';}}
  return r.trim();
}
function moneyToWords(a){const i=Math.floor(a),d=Math.round((a-i)*100);return numberToWords(i)+' LEMPIRAS CON '+String(d).padStart(2,'0')+'/100';}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function loadSucursales() {
  const sel = document.getElementById('login-suc');
  sel.innerHTML = '<option value="">Cargando...</option>';
  // Intentar hasta 8 veces con 1.5 segundos entre intentos
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(API + '/api/sucursales');
      const data = await r.json().catch(()=>[]);
      if (Array.isArray(data) && data.length) {
        sel.innerHTML = data.map(s=>`<option value="${s.id}">${s.nombre}</option>`).join('');
        document.getElementById('login-error').textContent = '';
        return; // éxito
      }
      // Si responde pero viene vacío, intentar reset automático
      if (Array.isArray(data) && data.length === 0 && i >= 2) {
        // La DB existe pero no tiene sucursales — ejecutar seed
        await fetch(API + '/api/reset-db?confirm=RESETEAR').catch(()=>{});
        await new Promise(res => setTimeout(res, 800));
        continue;
      }
    } catch(e) { /* servidor no listo aún */ }
    document.getElementById('login-error').textContent = `Conectando al servidor... (${i+1}/8)`;
    await new Promise(res => setTimeout(res, 1500));
  }
  // Después de 8 intentos — mostrar diagnóstico
  sel.innerHTML = '<option value="">⚠ Sin sucursales</option>';
  document.getElementById('login-error').innerHTML =
    'No se encontraron sucursales. <a href="/health" target="_blank" style="color:#2563eb">Ver diagnóstico</a>';
}

document.addEventListener('DOMContentLoaded', () => {
  // Registrar eventos del login INMEDIATAMENTE
  document.getElementById('login-btn').onclick = doLogin;
  document.getElementById('login-pass').onkeydown = e => { if(e.key === 'Enter') doLogin(); };
  document.getElementById('login-user').onkeydown  = e => { if(e.key === 'Enter') doLogin(); };

  // Mostrar login o app segun token guardado
  if (TOKEN && USER) {
    showApp();
  } else {
    document.getElementById('login-screen').style.display = 'flex';
    // Verificar estado de licencia
    verificarLicencia();
  }

  // Cargar sucursales en segundo plano, no bloquea el login
  loadSucursales();
});

async function verificarLicencia() {
  try {
    const r = await fetch('/api/licencia/estado');
    const data = await r.json();
    const badge = document.getElementById('lic-badge');
    const inner = document.getElementById('lic-badge-inner');
    badge.style.display = 'block';
    if (data.activa) {
      const tipo = {mensual:'Mensual',trimestral:'Trimestral',anual:'Anual',vitalicia:'Vitalicia'}[data.tipo] || data.tipo;
      if (data.diasRestantes <= 7) {
        inner.style.cssText = 'display:inline-block;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa';
        inner.textContent = `⚠️ Licencia ${tipo} — vence en ${data.diasRestantes} día(s)`;
      } else {
        inner.style.cssText = 'display:inline-block;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0';
        inner.textContent = `✅ Licencia ${tipo} activa — ${data.diasRestantes} días restantes`;
      }
    } else {
      inner.style.cssText = 'display:inline-block;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;background:#fef2f2;color:#991b1b;border:1px solid #fecaca';
      inner.textContent = '🔒 Sin licencia activa';
      // Modal automático desactivado — el usuario puede ingresar sin licencia
    }
  } catch(e) { /* servidor no disponible */ }
}

function abrirModalLicencia(cancelable=true) {
  document.getElementById('licencia-modal').style.display = 'flex';
  document.getElementById('lic-cancel-btn').style.display = cancelable ? 'block' : 'none';
  document.getElementById('lic-clave').value = '';
  document.getElementById('lic-error').textContent = '';
  setTimeout(()=>document.getElementById('lic-clave').focus(), 100);
}

async function activarLicencia() {
  const clave = document.getElementById('lic-clave').value.trim();
  const errEl = document.getElementById('lic-error');
  errEl.textContent = '';
  if (!clave) { errEl.textContent = 'Ingrese la clave de licencia'; return; }
  try {
    const r = await fetch('/api/licencia/activar', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({clave})
    });
    const data = await r.json();
    if (!r.ok) { errEl.textContent = data.error || 'Error al activar'; return; }
    const tipos = {mensual:'Mensual',trimestral:'Trimestral',anual:'Anual',vitalicia:'Vitalicia'};
    document.getElementById('licencia-modal').style.display = 'none';
    // Mostrar confirmación
    const badge = document.getElementById('lic-badge');
    const inner = document.getElementById('lic-badge-inner');
    badge.style.display = 'block';
    inner.style.cssText = 'display:inline-block;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0';
    inner.textContent = `✅ Licencia ${tipos[data.tipo]||data.tipo} activada — ${data.diasRestantes} días`;
    alert(`🎉 ¡Licencia activada exitosamente!\n\nTipo: ${tipos[data.tipo]||data.tipo}\nVálida hasta: ${data.vencimiento}`);
  } catch(e) {
    errEl.textContent = 'Error de conexión con el servidor';
  }
}

async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const sucursal_id = document.getElementById('login-suc').value;
  const err = document.getElementById('login-error');
  err.textContent = '';
  try {
    const r = await POST('/auth/login', { username, password, sucursal_id });
    TOKEN  = r.token;
    USER   = r.user;
    BRANCH = r.sucursal;
    localStorage.setItem('mp_token', TOKEN);
    localStorage.setItem('mp_user', JSON.stringify(USER));
    localStorage.setItem('mp_branch', JSON.stringify(BRANCH));
    showApp();
  } catch(e) {
    err.textContent = e.message || 'Error al iniciar sesión';
  }
}

function doLogout() {
  TOKEN = null; USER = null; BRANCH = null;
  localStorage.removeItem('mp_token');
  localStorage.removeItem('mp_user');
  localStorage.removeItem('mp_branch');
  location.reload();
}

async function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  const app = document.getElementById('app');
  app.style.display = 'flex';
  document.getElementById('top-user').textContent = USER.nombre;
  document.getElementById('top-role').textContent = USER.rol;
  document.getElementById('top-branch').textContent = BRANCH ? BRANCH.nombre : '—';
  document.getElementById('company-name-footer').textContent = BRANCH ? BRANCH.nombre : '';
  document.getElementById('company-rtn-footer').textContent = BRANCH ? 'RTN: ' + (BRANCH.rtn||'') : '';
  await cargarPermisos();
  buildNav();
  navigateTo('dashboard');
  // Badge inicial de tickets
  setTimeout(actualizarBadgeTickets, 1500);
  setupEvents();
}

// ─── NAVEGACIÓN ──────────────────────────────────────────────────────────────
const NAV = [
  { view:'dashboard',    label:'📈 Dashboard',         roles:['admin','supervisor','cajero'] },
  { view:'facturacion',  label:'Facturación',         roles:['admin','supervisor','cajero'] },
  { view:'nd',           label:'📋 Notas de Débito',   roles:['admin','supervisor','cajero'] },
  { view:'oc',           label:'🧾 Órdenes de Compra', roles:['admin','supervisor','cajero'] },
  { view:'products',     label:'Productos',           roles:['admin','supervisor','cajero'] },
  { view:'clients',      label:'Clientes',            roles:['admin','supervisor','cajero'] },
  { view:'suppliers',    label:'Proveedores',         roles:['admin','supervisor'] },
  { view:'sales',        label:'Ventas',              roles:['admin','supervisor','cajero'] },
  { view:'inventory',    label:'Inventario',          roles:['admin','supervisor'] },
  { view:'kardex',       label:'Kardex / Costos',     roles:['admin','supervisor'] },
  { view:'purchases',    label:'Compras',             roles:['admin','supervisor'] },
  { view:'returns',      label:'Devoluciones',        roles:['admin','supervisor'] },
  { view:'cxc',          label:'Cuentas x Cobrar',    roles:['admin','supervisor','cajero'] },
  { view:'cxp',          label:'Cuentas x Pagar',     roles:['admin','supervisor'] },
  { view:'bancos',       label:'Bancos',              roles:['admin','supervisor'] },
  { view:'impuestos',    label:'Impuestos',           roles:['admin'] },
  { view:'reports',      label:'Reportes',            roles:['admin','supervisor','cajero'] },
  { view:'turnos',       label:'🕐 Turnos',            roles:['cajero','supervisor','admin'] },
  { view:'users',        label:'Usuarios',            roles:['admin'] },
  { view:'branches',     label:'Sucursales',          roles:['admin'] },
  { view:'whatsapp',     label:'📱 WhatsApp',          roles:['admin'] },
  { view:'tickets',      label:'🎫 Tickets',            roles:['admin','supervisor','cajero'] },
  { view:'sync',         label:'Sincronización',      roles:['admin'] },
  { view:'config',       label:'Configuración',       roles:['admin'] },
];

let PERMISOS_BLOQUEADOS = {};   // {modulo: true} → bloqueado

async function cargarPermisos() {
  try {
    const permisos = await GET(`/usuarios/${USER.id}/permisos`);
    PERMISOS_BLOQUEADOS = {};
    permisos.forEach(p => { if(p.bloqueado) PERMISOS_BLOQUEADOS[p.modulo] = true; });
  } catch(e) { PERMISOS_BLOQUEADOS = {}; }
}

function buildNav() {
  const nav = document.getElementById('nav-menu');
  const items = NAV.filter(n =>
    n.roles.includes(USER.rol) && !PERMISOS_BLOQUEADOS[n.view]
  );
  nav.innerHTML = items.map(n => `<button class="nav-item" data-view="${n.view}">${n.label}</button>`).join('');
  nav.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.view)));
}

let currentView = 'dashboard';
function navigateTo(view) {
  // Verificar permiso — dashboard y facturacion siempre accesibles
  if (view !== 'dashboard' && view !== 'facturacion' && view !== 'nd' && view !== 'oc' && PERMISOS_BLOQUEADOS[view]) {
    alert('⚠️ No tienes permiso para acceder a este módulo.');
    return;
  }
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(view + '-view');
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  renderView(view);
}

function renderView(view) {
  switch(view) {
    case 'dashboard':   renderDashboard(); break;
    case 'facturacion': renderFacturacion(); break;
    case 'nd':          renderNotaDebito(); break;
    case 'oc':          renderOrdenCompra(); break;
    case 'products':  renderProducts(); break;
    case 'clients':   renderClients(); break;
    case 'suppliers': renderSuppliers(); break;
    case 'sales':     renderSales(); break;
    case 'inventory': renderInventory(); break;
    case 'kardex':    renderKardexPage(); break;
    case 'purchases': renderPurchases(); break;
    case 'returns':   renderReturns(); break;
    case 'cxc':       renderCxC(); break;
    case 'cxp':       renderCxP(); break;
    case 'reports':   renderReports(); break;
    case 'users':     renderUsers(); break;
    case 'branches':  renderBranches(); break;
    case 'turnos':    renderTurnosCajero(); break;
    case 'whatsapp':  renderWhatsApp(); break;
    case 'tickets':   renderTickets(); break;
    case 'sync':      loadSync(); break;
    case 'bancos':    renderBancos(); break;
    case 'impuestos': renderImpuestos(); break;
    case 'config':    renderConfig(); break;
  }
}

// ─── BARCODE READER ──────────────────────────────────────────────────────────
let barcodeBuffer = '';
let barcodeTimeout = null;

function setupBarcodeReader() {
  document.addEventListener('keydown', e => {
    // No interceptar si el foco está en un input, textarea o select
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Enter' && barcodeBuffer.length > 3 && currentView === 'facturacion') {
      const code = barcodeBuffer;
      barcodeBuffer = '';
      GET('/productos/barcode/' + code).then(p => {
        if (p && p.id) facAddToCart(p);
      }).catch(() => {});
      return;
    }
    if (e.key.length === 1 && currentView === 'facturacion') {
      barcodeBuffer += e.key;
      clearTimeout(barcodeTimeout);
      barcodeTimeout = setTimeout(() => { barcodeBuffer = ''; }, 150);
    }
  });
}

// ─── PRODUCTOS ───────────────────────────────────────────────────────────────
let editingProduct = null;

let _prodView = 'table'; // 'table' | 'grid'

function setProdView(v) {
  _prodView = v;
  document.getElementById('prod-table-container').style.display = v === 'table' ? '' : 'none';
  document.getElementById('prod-grid-container').style.display  = v === 'grid'  ? '' : 'none';
  document.getElementById('prod-view-table').style.cssText = v === 'table'
    ? 'border:none;background:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:14px;box-shadow:0 1px 3px rgba(0,0,0,.1)'
    : 'border:none;background:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:14px';
  document.getElementById('prod-view-grid').style.cssText = v === 'grid'
    ? 'border:none;background:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:14px;box-shadow:0 1px 3px rgba(0,0,0,.1)'
    : 'border:none;background:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:14px';
  _renderProductsFiltered();
}

function _getProductsFiltered() {
  const q    = (document.getElementById('prod-search')||{}).value?.toLowerCase()||'';
  const cat  = (document.getElementById('prod-filter-cat')||{}).value||'';
  const stk  = (document.getElementById('prod-filter-stock')||{}).value||'';
  return products_cache.filter(p => {
    const matchQ   = !q   || p.nombre.toLowerCase().includes(q) || (p.codigo||'').toLowerCase().includes(q);
    const matchCat = !cat || p.categoria === cat;
    const stock = parseInt(p.stock)||0;
    const min   = parseInt(p.stock_min)||0;
    const matchStk = !stk
      || (stk === 'ok'     && stock > min)
      || (stk === 'bajo'   && stock > 0 && stock <= min)
      || (stk === 'agotado'&& stock <= 0);
    return matchQ && matchCat && matchStk;
  });
}

function _renderProductsFiltered() {
  const f = _getProductsFiltered();
  const empty = document.getElementById('prod-empty');

  if (f.length === 0) {
    if(empty) empty.style.display = '';
    document.getElementById('products-table-body').innerHTML = '';
    const gc = document.getElementById('prod-card-grid');
    if (gc) gc.innerHTML = '';
    return;
  }
  if(empty) empty.style.display = 'none';

  if (_prodView === 'table') {
    document.getElementById('products-table-body').innerHTML = f.map(p => {
      const stock  = parseInt(p.stock)||0;
      const min    = parseInt(p.stock_min)||0;
      const precio = parseFloat(p.precio_venta)||0;
      const costo  = parseFloat(p.costo)||0;
      const margen = precio > 0 ? ((precio - costo) / precio * 100) : 0;
      const agotado = stock <= 0;
      const bajo    = stock > 0 && stock <= min;
      const stockColor = agotado ? '#dc2626' : bajo ? '#d97706' : '#16a34a';
      const stockBadge = agotado
        ? '<span style="background:#fef2f2;color:#dc2626;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px">Agotado</span>'
        : bajo
          ? '<span style="background:#fffbeb;color:#d97706;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px">Stock bajo</span>'
          : '<span style="background:#f0fdf4;color:#16a34a;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px">OK</span>';
      return `<tr>
        <td><span style="font-family:monospace;font-size:11px;color:#94a3b8">${p.codigo||''}</span></td>
        <td style="font-weight:600">${p.nombre}</td>
        <td><span class="badge badge-blue">${p.categoria||'—'}</span></td>
        <td style="text-align:right;font-weight:600">L. ${precio.toFixed(2)}</td>
        <td style="text-align:right;color:#64748b">L. ${costo.toFixed(2)}</td>
        <td style="text-align:right;color:${margen>=30?'#16a34a':margen>=15?'#d97706':'#dc2626'};font-weight:600">${margen.toFixed(1)}%</td>
        <td style="text-align:center">${p.gravado!==0?'<span class="badge badge-amber">ISV</span>':'<span class="badge badge-gray">Exento</span>'}</td>
        <td style="text-align:right;font-weight:700;color:${stockColor}">${stock}</td>
        <td style="text-align:right;color:#94a3b8">${min}</td>
        <td style="text-align:center">${stockBadge}</td>
        <td><div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="action-btn edit" onclick="openProductModal('${p.id}')">✏️</button>
          <button class="action-btn delete" onclick="deleteProduct('${p.id}')">🗑️</button>
        </div></td>
      </tr>`;
    }).join('');
  } else {
    const gc = document.getElementById('prod-card-grid');
    if (!gc) return;
    gc.innerHTML = f.map(p => {
      const stock  = parseInt(p.stock)||0;
      const min    = parseInt(p.stock_min)||0;
      const precio = parseFloat(p.precio_venta)||0;
      const costo  = parseFloat(p.costo)||0;
      const margen = precio > 0 ? ((precio - costo) / precio * 100) : 0;
      const agotado = stock <= 0;
      const bajo    = stock > 0 && stock <= min;
      const borderColor = agotado ? '#fca5a5' : bajo ? '#fde68a' : '#bbf7d0';
      const stockColor  = agotado ? '#dc2626' : bajo ? '#d97706' : '#16a34a';
      return `<div style="background:#fff;border:1px solid ${borderColor};border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div>
            <div style="font-weight:700;font-size:14px;color:#0f172a;line-height:1.3">${p.nombre}</div>
            <div style="font-size:11px;color:#94a3b8;font-family:monospace;margin-top:2px">${p.codigo||''}</div>
          </div>
          <span class="badge badge-blue" style="white-space:nowrap;flex-shrink:0">${p.categoria||'—'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:20px;font-weight:800;color:#1e3a5f">L. ${precio.toFixed(2)}</div>
          <div style="font-size:11px;color:#64748b">Costo: L. ${costo.toFixed(2)}</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #f1f5f9;padding-top:8px">
          <div style="font-size:12px">
            <span style="color:#64748b">Stock: </span>
            <span style="font-weight:700;color:${stockColor}">${stock}</span>
            ${min>0?`<span style="color:#94a3b8;font-size:10px"> / mín ${min}</span>`:''}
          </div>
          <div style="font-size:11px;color:${margen>=30?'#16a34a':margen>=15?'#d97706':'#dc2626'};font-weight:700">
            ${margen.toFixed(1)}% margen
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:2px">
          <button class="btn-primary" style="flex:1;padding:6px;font-size:12px;justify-content:center" onclick="openProductModal('${p.id}')">✏️ Editar</button>
          <button class="action-btn delete" onclick="deleteProduct('${p.id}')">🗑️</button>
        </div>
      </div>`;
    }).join('');
  }
}

async function renderProducts() {
  try { products_cache = await GET('/productos', `sucursal_id=${USER.sucursal_id}`); } catch(e) {}

  // KPIs
  const total     = products_cache.length;
  const cats      = new Set(products_cache.map(p => p.categoria)).size;
  const conStock  = products_cache.filter(p => (parseInt(p.stock)||0) > (parseInt(p.stock_min)||0)).length;
  const bajoStock = products_cache.filter(p => { const s=parseInt(p.stock)||0; const m=parseInt(p.stock_min)||0; return s<=0 || (s>0&&s<=m); }).length;
  const valorInv  = products_cache.reduce((s,p)=>s+(parseFloat(p.costo)||0)*(parseInt(p.stock)||0), 0);
  const avgPrecio = total > 0 ? products_cache.reduce((s,p)=>s+(parseFloat(p.precio_venta)||0),0)/total : 0;

  const setKPI = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  setKPI('kpi-total', total);
  setKPI('kpi-cats', cats);
  setKPI('kpi-con-stock', conStock);
  setKPI('kpi-bajo-stock', bajoStock);
  setKPI('kpi-valor', fL(valorInv));
  setKPI('kpi-avg-precio', fL(avgPrecio));
  setKPI('prod-count', total + ' productos · ' + cats + ' categorías');

  // Llenar filtro de categorías
  const catSel = document.getElementById('prod-filter-cat');
  if (catSel) {
    const currentCat = catSel.value;
    const uniqueCats = [...new Set(products_cache.map(p=>p.categoria).filter(Boolean))].sort();
    catSel.innerHTML = '<option value="">Todas las categorías</option>'
      + uniqueCats.map(c=>`<option value="${c}"${c===currentCat?' selected':''}>${c}</option>`).join('');
  }

  // Asignar listeners de filtro solo la primera vez
  if (!renderProducts._listenersSet) {
    renderProducts._listenersSet = true;
    ['prod-search','prod-filter-cat','prod-filter-stock'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', _renderProductsFiltered);
      if (el) el.addEventListener('change', _renderProductsFiltered);
    });
  }

  _renderProductsFiltered();
}

function openProductModal(id) {
  const p = id ? products_cache.find(x => x.id === id) : null;
  editingProduct = p;
  document.getElementById('prod-modal-title').textContent = p ? 'Editar Producto' : 'Nuevo Producto';
  document.getElementById('prod-codigo').value     = p?.codigo || '';
  document.getElementById('prod-nombre').value     = p?.nombre || '';
  document.getElementById('prod-categoria').value  = p?.categoria || '';
  document.getElementById('prod-precio').value     = p?.precio_venta || '';
  document.getElementById('prod-costo').value      = p?.costo || 0;
  document.getElementById('prod-gravado').checked  = p?.gravado !== 0;
  const stockEl    = document.getElementById('prod-stock');
  const stockMinEl = document.getElementById('prod-stock-min');
  if (stockEl)    stockEl.value    = p?.stock     ?? 0;
  if (stockMinEl) stockMinEl.value = p?.stock_min ?? 0;
  openModal('prod-modal');
}

async function saveProduct(e) {
  e.preventDefault();
  const stockEl    = document.getElementById('prod-stock');
  const stockMinEl = document.getElementById('prod-stock-min');
  const data = {
    codigo:      document.getElementById('prod-codigo').value,
    nombre:      document.getElementById('prod-nombre').value,
    categoria:   document.getElementById('prod-categoria').value,
    precio_venta:parseFloat(document.getElementById('prod-precio').value),
    costo:       parseFloat(document.getElementById('prod-costo').value) || 0,
    gravado:     document.getElementById('prod-gravado').checked,
    stock:       stockEl    ? (parseInt(stockEl.value)    || 0) : undefined,
    stock_min:   stockMinEl ? (parseInt(stockMinEl.value) || 0) : undefined,
  };
  // Limpiar campos undefined
  Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
  try {
    if (editingProduct) await PUT('/productos/' + editingProduct.id, data);
    else await POST('/productos', data);
    closeModal('prod-modal');
    renderProducts();
  } catch(e) { alert(e.message); }
}

async function deleteProduct(id) {
  if (!confirm('¿Eliminar este producto?')) return;
  try { await DELETE('/productos/' + id); renderProducts(); } catch(e) { alert(e.message); }
}

// ─── CLIENTES ────────────────────────────────────────────────────────────────
let editingClient = null;

async function renderClients() {
  try { clients_cache = await GET('/clientes'); } catch(e) {}
  document.getElementById('client-count').textContent = clients_cache.length + ' clientes';
  document.getElementById('clients-cards').innerHTML = clients_cache.map(c => `
    <div class="client-card">
      <div class="client-card-header">
        <div class="client-avatar">${c.nombre[0]}</div>
        <div style="display:flex;gap:4px">
          <button class="action-btn edit" onclick="openClientModal('${c.id}')">✏️</button>
          <button class="action-btn delete" onclick="deleteClient('${c.id}')">🗑️</button>
        </div>
      </div>
      <div class="client-name">${c.nombre}</div>
      ${c.rtn ? `<div class="client-rtn">RTN: ${c.rtn}</div>` : ''}
      ${c.telefono ? `<div class="client-info">${c.telefono}</div>` : ''}
      ${c.saldo > 0 ? `<div class="client-info" style="color:#dc2626;font-weight:600">Saldo: ${fL(c.saldo)}</div>` : ''}
    </div>
  `).join('');
}

function openClientModal(id) {
  const c = id ? clients_cache.find(x => x.id === id) : null;
  editingClient = c;
  document.getElementById('client-modal-title').textContent = c ? 'Editar Cliente' : 'Nuevo Cliente';
  ['nombre','rtn','direccion','telefono','email'].forEach(k => document.getElementById('client-'+k).value = c?.[k]||'');
  document.getElementById('client-credito').value = c?.limite_credito || 0;
  openModal('client-modal');
}

async function saveClient(e) {
  e.preventDefault();
  const data = {
    nombre: document.getElementById('client-nombre').value,
    rtn: document.getElementById('client-rtn').value,
    direccion: document.getElementById('client-direccion').value,
    telefono: document.getElementById('client-telefono').value,
    email: document.getElementById('client-email').value,
    limite_credito: parseFloat(document.getElementById('client-credito').value) || 0,
  };
  try {
    if (editingClient) await PUT('/clientes/' + editingClient.id, data);
    else await POST('/clientes', data);
    closeModal('client-modal');
    renderClients();
  } catch(e) { alert(e.message); }
}

async function deleteClient(id) {
  if (!confirm('¿Eliminar este cliente?')) return;
  try { await DELETE('/clientes/' + id); renderClients(); } catch(e) { alert(e.message); }
}

// ─── PROVEEDORES ─────────────────────────────────────────────────────────────
let suppliers_cache = [];
let editingSupplier = null;

async function renderSuppliers() {
  try { suppliers_cache = await GET('/proveedores'); } catch(e) {}
  document.getElementById('supplier-count').textContent = suppliers_cache.length + ' proveedores';
  document.getElementById('suppliers-table-body').innerHTML = suppliers_cache.map(s => `
    <tr>
      <td style="font-weight:600">${s.nombre}</td>
      <td style="font-family:monospace;font-size:11px">${s.rtn||'—'}</td>
      <td>${s.contacto||'—'}</td>
      <td>${s.telefono||'—'}</td>
      <td style="text-align:right;color:${s.saldo>0?'#dc2626':'#16a34a'};font-weight:600">${fL(s.saldo)}</td>
      <td><div style="display:flex;gap:4px;justify-content:flex-end">
        <button class="action-btn edit" onclick="openSupplierModal('${s.id}')">✏️</button>
        <button class="action-btn delete" onclick="deleteSupplier('${s.id}')">🗑️</button>
      </div></td>
    </tr>
  `).join('');
}

function openSupplierModal(id) {
  const s = id ? suppliers_cache.find(x => x.id === id) : null;
  editingSupplier = s;
  document.getElementById('supplier-modal-title').textContent = s ? 'Editar Proveedor' : 'Nuevo Proveedor';
  ['nombre','rtn','contacto','telefono','email','direccion'].forEach(k => document.getElementById('sup-'+k).value = s?.[k]||'');
  document.getElementById('sup-credito').value = s?.limite_credito || 0;
  openModal('supplier-modal');
}

async function saveSupplier(e) {
  e.preventDefault();
  const data = {
    nombre: document.getElementById('sup-nombre').value,
    rtn: document.getElementById('sup-rtn').value,
    contacto: document.getElementById('sup-contacto').value,
    telefono: document.getElementById('sup-telefono').value,
    email: document.getElementById('sup-email').value,
    direccion: document.getElementById('sup-direccion').value,
    limite_credito: parseFloat(document.getElementById('sup-credito').value)||0,
  };
  try {
    if(editingSupplier) await PUT('/proveedores/'+editingSupplier.id, data);
    else await POST('/proveedores', data);
    closeModal('supplier-modal'); renderSuppliers();
  } catch(e) { alert(e.message); }
}

async function deleteSupplier(id) {
  if(!confirm('¿Eliminar este proveedor?')) return;
  try { await DELETE('/proveedores/'+id); renderSuppliers(); } catch(e) { alert(e.message); }
}

// ─── VENTAS ──────────────────────────────────────────────────────────────────
let sales_cache = [];

async function renderSales() {
  try { sales_cache = await GET('/ventas', `sucursal_id=${USER.sucursal_id}`); } catch(e) {}
  document.getElementById('sales-count').textContent = sales_cache.length + ' facturas';
  const container = document.getElementById('sales-list');
  if (!sales_cache.length) { container.innerHTML = `<div class="empty-state"><p>No hay ventas registradas</p></div>`; return; }
  container.innerHTML = sales_cache.map(s => `
    <div class="sale-card">
      <div>
        <div class="sale-num">${s.numero_factura}</div>
        <div class="sale-meta">${fDT(s.fecha)} · ${s.cliente_nombre||'—'}</div>
        <div class="sale-items-count">Usuario: ${s.usuario_nombre||'—'} ${s.exonerado?'<span class="badge badge-amber">Exonerado</span>':''} ${s.estado==='anulada'?'<span class="badge badge-red">Anulada</span>':''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="sale-amount">${fL(s.total)}</div>
        ${s.estado!=='anulada'?`<button class="btn-print-inv" onclick="printSaleById('${s.id}')">🖨️</button>`:''}
        ${USER.rol!=='cajero'&&s.estado==='emitida'?`<button class="action-btn delete" onclick="anularVenta('${s.id}')">✕</button>`:''}
      </div>
    </div>
  `).join('');
}

async function printSaleById(id) {
  const sale = sales_cache.find(s => s.id === id);
  if (!sale) return;
  try {
    const items = await GET('/ventas/'+id+'/items');
    const cl = { nombre: sale.cliente_nombre, rtn: sale.cliente_rtn };
    const mapped = items.map(i => ({ nombre: i.producto_nombre, precio: i.precio_unit, cantidad: i.cantidad }));
    const saleObj = {
      numero_factura: sale.numero_factura, fecha: sale.fecha, cliente: cl, items: mapped,
      subtotal: sale.subtotal, descuento: sale.descuento||0,
      importeGravado: sale.importe_gravado||0, importeExento: sale.importe_exento||0,
      isv: sale.isv15||0, isv18: sale.isv18||0, total: sale.total,
      exonerado: sale.exonerado, ordenCompraExenta: sale.orden_compra_exenta||'',
      constanciaRegistro: sale.constancia_registro||'', identificativoSAG: sale.identificativo_sag||''
    };
    printInvoice(saleObj);
  } catch(e) { alert(e.message); }
}

async function anularVenta(id) {
  if (!confirm('¿Anular esta venta? El stock se restaurará.')) return;
  try { await POST('/ventas/'+id+'/anular', {}); renderSales(); } catch(e) { alert(e.message); }
}

// ─── INVENTARIO ──────────────────────────────────────────────────────────────
async function renderInventory() {
  let inv = [];
  try { inv = await GET('/inventario', `sucursal_id=${USER.sucursal_id}`); } catch(e) {}
  const q = (document.getElementById('inv-search')||{}).value?.toLowerCase()||'';
  const f = inv.filter(p => p.nombre.toLowerCase().includes(q)||p.codigo.toLowerCase().includes(q));
  const total = inv.reduce((s,p) => s+(p.stock||0)*(p.precio_venta||0), 0);
  const low = inv.filter(p => (p.stock||0) <= (p.stock_min||0));
  document.getElementById('inv-total-value').textContent = fL(total);
  document.getElementById('inv-low-count').textContent = low.length + ' bajo mínimo';
  document.getElementById('inv-table-body').innerHTML = f.map(p => {
    const bajo = (p.stock||0) <= (p.stock_min||0);
    return `<tr>
      <td><span style="font-family:monospace;font-size:11px;color:#94a3b8">${p.codigo}</span></td>
      <td style="font-weight:600">${p.nombre}</td>
      <td><span class="badge badge-blue">${p.categoria}</span></td>
      <td style="text-align:right">${p.stock||0}</td>
      <td style="text-align:right">${p.stock_min||0}</td>
      <td style="text-align:right">L. ${(p.costo||0).toFixed(2)}</td>
      <td style="text-align:right">L. ${(p.precio_venta||0).toFixed(2)}</td>
      <td style="text-align:center">${bajo?'<span class="badge badge-red">⚠ Bajo</span>':'<span class="badge badge-green">OK</span>'}</td>
      <td><button class="btn-primary" style="padding:5px 10px;font-size:11px" onclick="openAjusteModal('${p.id}','${p.nombre.replace(/'/g,"\\'")}',${p.stock||0})">Ajustar</button></td>
    </tr>`;
  }).join('');
}

function openAjusteModal(id, nombre, stock) {
  document.getElementById('ajuste-prod-name').textContent = nombre + ' (Stock actual: ' + stock + ')';
  document.getElementById('ajuste-prod-id').value = id;
  document.getElementById('ajuste-cantidad').value = '';
  document.getElementById('ajuste-costo').value = 0;
  document.getElementById('ajuste-motivo').value = '';
  openModal('ajuste-modal');
}

async function saveAjuste(e) {
  e.preventDefault();
  const id = document.getElementById('ajuste-prod-id').value;
  try {
    await POST('/inventario/ajuste', {
      producto_id: id, sucursal_id: USER.sucursal_id,
      tipo: document.getElementById('ajuste-tipo').value,
      cantidad: parseInt(document.getElementById('ajuste-cantidad').value)||0,
      costo: parseFloat(document.getElementById('ajuste-costo').value)||0,
      motivo: document.getElementById('ajuste-motivo').value
    });
    closeModal('ajuste-modal'); renderInventory();
  } catch(e) { alert(e.message); }
}

// ─── KARDEX ──────────────────────────────────────────────────────────────────
async function renderKardexPage() {
  let inv = [];
  try { inv = await GET('/inventario', `sucursal_id=${USER.sucursal_id}`); } catch(e) {}
  const sel = document.getElementById('kardex-prod-sel');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Seleccionar producto —</option>' +
    inv.map(p => `<option value="${p.id}">${p.codigo} — ${p.nombre}</option>`).join('');
  if (cur) sel.value = cur;
  document.getElementById('kardex-table-body').innerHTML = '';
}

async function loadKardex() {
  const id = document.getElementById('kardex-prod-sel').value;
  if (!id) return;
  try {
    const rows = await GET('/kardex/'+id, `sucursal_id=${USER.sucursal_id}`);
    document.getElementById('kardex-table-body').innerHTML = rows.map(r => `
      <tr>
        <td style="font-size:11px">${fDT(r.fecha)}</td>
        <td><span class="kardex-tipo kt-${r.tipo}">${r.tipo}</span></td>
        <td style="font-size:11px;font-family:monospace">${r.referencia||'—'}</td>
        <td style="font-size:11px">${r.motivo||'—'}</td>
        <td style="text-align:right;font-weight:600;color:${r.tipo==='venta'||r.tipo==='salida'?'#dc2626':'#16a34a'}">${r.cantidad}</td>
        <td style="text-align:right">L. ${(r.costo_unit||0).toFixed(2)}</td>
        <td style="text-align:right">L. ${(r.precio_unit||0).toFixed(2)}</td>
        <td style="text-align:right;font-weight:600">${r.saldo_stock}</td>
        <td style="font-size:11px">${r.usuario_nombre||'—'}</td>
      </tr>
    `).join('');
  } catch(e) { alert(e.message); }
}

// ─── COMPRAS ─────────────────────────────────────────────────────────────────
let purchases_cache = [];
let purchaseItems = [];

async function renderPurchases() {
  try { purchases_cache = await GET('/compras'); } catch(e) {}
  document.getElementById('purchases-count').textContent = purchases_cache.length + ' órdenes';
  const fpLabels = {efectivo:'💵 Efectivo',tarjeta:'💳 Tarjeta',transferencia:'🏦 Transfer.',credito:'📋 Crédito'};
  document.getElementById('purchases-table-body').innerHTML = purchases_cache.map(c => `
    <tr>
      <td style="font-size:11px">${fD(c.fecha)}</td>
      <td style="font-weight:600">${c.proveedor_nombre||'—'}</td>
      <td style="font-family:monospace;font-size:11px">${c.numero_doc||'—'}</td>
      <td style="text-align:right;font-weight:600">${fL(c.total)}</td>
      <td style="font-size:11px">${fpLabels[c.forma_pago]||c.forma_pago||'💵 Efectivo'}</td>
      <td><span class="badge ${c.estado==='recibida'?'badge-green':c.estado==='parcial'?'badge-amber':'badge-blue'}">${c.estado}</span></td>
      <td style="font-size:11px">${c.usuario_nombre||'—'}</td>
      <td>${c.estado!=='recibida'?`<button class="btn-primary" style="padding:5px 10px;font-size:11px" onclick="recibirCompra('${c.id}')">Recibir</button>`:''}</td>
    </tr>
  `).join('');
}

let purFormaPago = 'efectivo';

function setPurFormaPago(fp) {
  purFormaPago = fp;
  ['efectivo','tarjeta','transferencia','credito'].forEach(x => {
    const btn = document.getElementById('pur-fp-'+x);
    if (!btn) return;
    const isActive = x === fp;
    btn.style.background = isActive ? '#2563eb' : '#fff';
    btn.style.color = isActive ? '#fff' : '#475569';
    btn.style.border = isActive ? '2px solid #2563eb' : '1px solid #e2e8f0';
  });
  const bancoRow = document.getElementById('pur-banco-row');
  if (bancoRow) bancoRow.style.display = (fp==='transferencia'||fp==='tarjeta') ? 'block' : 'none';
  const creditoRow = document.getElementById('pur-credito-row');
  if (creditoRow) creditoRow.style.display = fp==='credito' ? 'block' : 'none';
}

async function openPurchaseModal() {
  try { suppliers_cache = await GET('/proveedores'); products_cache = await GET('/productos', `sucursal_id=${USER.sucursal_id}`); } catch(e) {}
  // Cargar bancos para el selector
  let bancos = [];
  try { bancos = await GET('/bancos'); } catch(e) {}
  const bancosEl = document.getElementById('pur-banco');
  if (bancosEl) {
    bancosEl.innerHTML = '<option value="">— Seleccionar banco —</option>' +
      bancos.map(b=>`<option value="${b.id}">${b.nombre} — ${b.numero_cuenta||''} (L. ${(b.saldo_actual||0).toFixed(2)})</option>`).join('');
  }
  document.getElementById('pur-proveedor').innerHTML = suppliers_cache.map(s=>`<option value="${s.id}">${s.nombre}</option>`).join('');
  purchaseItems = [];
  document.getElementById('pur-items-list').innerHTML = '';
  document.getElementById('pur-total').textContent = 'Total: L. 0.00';
  document.getElementById('pur-doc').value = '';
  document.getElementById('pur-notas').value = '';
  // Reset forma de pago a efectivo
  purFormaPago = 'efectivo';
  setPurFormaPago('efectivo');
  // Default vencimiento a 30 días
  const vencEl = document.getElementById('pur-vencimiento');
  if (vencEl) { const d = new Date(); d.setDate(d.getDate()+30); vencEl.value = d.toISOString().substring(0,10); }
  openModal('purchase-modal');
}

function addPurchaseItem() {
  const idx = purchaseItems.length;
  purchaseItems.push({ producto_id: '', cantidad: 1, costo_unit: 0 });
  const div = document.createElement('div');
  div.id = `pur-item-${idx}`;
  div.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:center';
  div.innerHTML = `
    <select onchange="updatePurItem(${idx},'producto_id',this.value)" style="border:1px solid #e2e8f0;border-radius:6px;padding:6px;font-size:12px;outline:none">
      <option value="">— Producto —</option>
      ${products_cache.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join('')}
    </select>
    <input type="number" min="1" value="1" placeholder="Cant." onchange="updatePurItem(${idx},'cantidad',+this.value)" style="border:1px solid #e2e8f0;border-radius:6px;padding:6px;font-size:12px;outline:none">
    <input type="number" step="0.01" min="0" value="0" placeholder="Costo" onchange="updatePurItem(${idx},'costo_unit',+this.value)" style="border:1px solid #e2e8f0;border-radius:6px;padding:6px;font-size:12px;outline:none">
    <button onclick="removePurItem(${idx})" style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:6px 10px;color:#dc2626;cursor:pointer">✕</button>
  `;
  document.getElementById('pur-items-list').appendChild(div);
}

function updatePurItem(idx, key, val) { purchaseItems[idx][key] = val; calcPurTotal(); }
function removePurItem(idx) {
  purchaseItems.splice(idx, 1);
  renderPurchases();
  openPurchaseModal();
}
function calcPurTotal() {
  const total = purchaseItems.reduce((s,i) => s + i.cantidad * i.costo_unit, 0);
  document.getElementById('pur-total').textContent = 'Total: ' + fL(total);
}

async function savePurchase(e) {
  e.preventDefault();
  const items = purchaseItems.filter(i => i.producto_id);
  if (!items.length) { alert('Agrega al menos un artículo'); return; }
  const banco_id = (purFormaPago==='transferencia'||purFormaPago==='tarjeta') ? (document.getElementById('pur-banco')?.value||null) : null;
  if ((purFormaPago==='transferencia'||purFormaPago==='tarjeta') && !banco_id) { alert('Seleccione el banco para el pago'); return; }
  const vencimiento = purFormaPago==='credito' ? (document.getElementById('pur-vencimiento')?.value||null) : null;
  try {
    await POST('/compras', {
      proveedor_id: document.getElementById('pur-proveedor').value,
      items, numero_doc: document.getElementById('pur-doc').value,
      notas: document.getElementById('pur-notas').value,
      forma_pago: purFormaPago,
      banco_id,
      vencimiento
    });
    closeModal('purchase-modal'); renderPurchases();
  } catch(e) { alert(e.message); }
}

async function recibirCompra(id) {
  try {
    const items = await GET('/compras/'+id+'/items');
    const pendientes = items.filter(i => i.cantidad_recibida < i.cantidad);
    if (!pendientes.length) { alert('Ya fue totalmente recibida'); return; }
    const receiveItems = pendientes.map(i => {
      const cant = parseInt(prompt(`${i.producto_nombre}: pendiente ${i.cantidad - (i.cantidad_recibida||0)} unidades. ¿Cuántas recibe ahora?`, i.cantidad - (i.cantidad_recibida||0)));
      return { compra_item_id: i.id, cantidad_recibida: isNaN(cant)?0:cant };
    }).filter(i => i.cantidad_recibida > 0);
    if (!receiveItems.length) return;
    await POST('/compras/'+id+'/recibir', { items: receiveItems });
    renderPurchases();
  } catch(e) { alert(e.message); }
}

// ─── DEVOLUCIONES ─────────────────────────────────────────────────────────────
let returns_cache = [];
let retSale = null;

async function renderReturns() {
  try { returns_cache = await GET('/devoluciones'); } catch(e) {}
  document.getElementById('returns-count').textContent = returns_cache.length + ' devoluciones';
  document.getElementById('returns-table-body').innerHTML = returns_cache.map(r => `
    <tr>
      <td style="font-size:11px">${fD(r.fecha)}</td>
      <td style="font-family:monospace;font-size:11px;font-weight:600">${r.numero_factura||'—'}</td>
      <td>${r.motivo||'—'}</td>
      <td style="text-align:right;font-weight:600">${fL(r.total)}</td>
      <td style="font-size:11px">${r.usuario_nombre||'—'}</td>
    </tr>
  `).join('');
}

function openReturnModal() {
  retSale = null;
  document.getElementById('ret-factura').value = '';
  document.getElementById('ret-sale-info').style.display = 'none';
  document.getElementById('ret-items-list').innerHTML = '';
  document.getElementById('ret-motivo').value = '';
  openModal('return-modal');
}

async function searchReturnSale() {
  const num = document.getElementById('ret-factura').value.trim();
  if (!num) return;
  try {
    const sales = await GET('/ventas', `sucursal_id=${USER.sucursal_id}`);
    retSale = sales.find(s => s.numero_factura === num);
    if (!retSale) { alert('Factura no encontrada'); return; }
    const items = await GET('/ventas/'+retSale.id+'/items');
    retSale._items = items;
    document.getElementById('ret-sale-info').style.display = 'block';
    document.getElementById('ret-sale-info').innerHTML = `<strong>${retSale.numero_factura}</strong> · ${retSale.cliente_nombre} · Total: ${fL(retSale.total)}`;
    document.getElementById('ret-items-list').innerHTML = items.map(i => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="flex:1;font-size:12px">${i.producto_nombre}</span>
        <span style="font-size:12px;color:#64748b">× ${i.cantidad} · L.${(i.precio_unit||0).toFixed(2)}</span>
        <input type="number" id="ret-qty-${i.id}" min="0" max="${i.cantidad}" value="${i.cantidad}" style="width:60px;border:1px solid #e2e8f0;border-radius:6px;padding:4px;font-size:12px;outline:none">
      </div>
    `).join('');
  } catch(e) { alert(e.message); }
}

async function saveReturn(e) {
  e.preventDefault();
  if (!retSale) { alert('Busca primero una factura'); return; }
  const items = retSale._items.map(i => ({
    producto_id: i.producto_id,
    cantidad: parseInt(document.getElementById('ret-qty-'+i.id)?.value)||0,
    precio_unit: i.precio_unit
  })).filter(i => i.cantidad > 0);
  if (!items.length) { alert('Selecciona al menos un artículo'); return; }
  try {
    await POST('/devoluciones', { venta_id: retSale.id, items, motivo: document.getElementById('ret-motivo').value });
    closeModal('return-modal'); renderReturns();
  } catch(e) { alert(e.message); }
}

// ─── CxC ─────────────────────────────────────────────────────────────────────
let cxc_cache = [];


async function renderCxC() {
  try { cxc_cache = await GET('/cxc'); } catch(e) {}
  const total = cxc_cache.filter(c=>c.estado!=='pagado').reduce((s,c)=>s+(parseFloat(c.saldo)||0),0);
  const venc = cxc_cache.filter(c=>c.estado!=='pagado'&&new Date(c.vencimiento)<new Date());
  document.getElementById('cxc-total').textContent = fL(total);
  document.getElementById('cxc-vencidas').textContent = venc.length + ' vencidas';
  const tbody = document.getElementById('cxc-table-body');
  if (cxc_cache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#94a3b8">No hay cuentas por cobrar</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  cxc_cache.forEach(c => {
    const vencida = c.estado!=='pagado' && new Date(c.vencimiento)<new Date();
    const badge = vencida ? '<span class="badge badge-red">Vencida</span>'
      : c.estado==='pagado' ? '<span class="badge badge-green">Pagada</span>'
      : '<span class="badge badge-amber">Pendiente</span>';
    const tr = document.createElement('tr');
    tr.dataset.id = c.id;
    tr.dataset.saldo = parseFloat(c.saldo)||0;
    tr.innerHTML = '<td style="font-weight:600">' + (c.cliente_nombre||'—') + '</td>'
      + '<td style="font-size:11px;font-family:monospace">' + (c.referencia||'—') + '</td>'
      + '<td style="font-size:11px">' + fD(c.fecha) + '</td>'
      + '<td style="font-size:11px">' + fD(c.vencimiento) + '</td>'
      + '<td style="text-align:right">' + fL(c.monto) + '</td>'
      + '<td style="text-align:right;color:' + (c.saldo>0?'#dc2626':'#16a34a') + ';font-weight:600">' + fL(c.saldo) + '</td>'
      + '<td>' + badge + '</td>'
      + '<td><div style="display:flex;gap:4px"></div></td>';
    const acciones = tr.querySelector('div');
    if (c.estado !== 'pagado') {
      const btnPagar = document.createElement('button');
      btnPagar.className = 'btn-primary';
      btnPagar.style.cssText = 'padding:5px 10px;font-size:11px';
      btnPagar.textContent = 'Pagar';
      btnPagar.addEventListener('click', () => pagarCxC(c.id, parseFloat(c.saldo)||0));
      acciones.appendChild(btnPagar);
    }
    if (USER.rol === 'admin') {
      const btnDel = document.createElement('button');
      btnDel.className = 'action-btn delete';
      btnDel.textContent = '🗑️';
      btnDel.addEventListener('click', () => deleteCxC(c.id));
      acciones.appendChild(btnDel);
    }
    tbody.appendChild(tr);
  });
}
async function openCxCModal() {
  try { clients_cache = await GET('/clientes'); } catch(e) {}
  document.getElementById('cxc-cliente-sel').innerHTML = clients_cache.map(c=>`<option value="${c.id}">${c.nombre}</option>`).join('');
  ['cxc-monto','cxc-vencimiento','cxc-referencia'].forEach(id => { const el=document.getElementById(id); if(el)el.value=''; });
  openModal('cxc-modal');
}

async function saveCxC(e) {
  e.preventDefault();
  try {
    await POST('/cxc', {
      cliente_id: document.getElementById('cxc-cliente-sel').value,
      referencia: document.getElementById('cxc-referencia').value,
      monto: parseFloat(document.getElementById('cxc-monto').value)||0,
      vencimiento: document.getElementById('cxc-vencimiento').value,
    });
    closeModal('cxc-modal'); renderCxC();
  } catch(e) { alert(e.message); }
}

async function pagarCxC(id, saldo) {
  saldo = parseFloat(saldo) || 0;
  let bancos = [];
  try { bancos = await GET('/bancos'); } catch(e) {}
  const existing = document.getElementById('pago-cxc-modal');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'pago-cxc-modal';
  div.className = 'modal-overlay active';
  // Construir HTML sin template literals anidados
  const saldoFmt = fL(saldo);
  const saldoVal = saldo.toFixed(2);
  let bancosHtml = '<option value="">— Seleccionar banco —</option>';
  bancos.forEach(b => {
    bancosHtml += '<option value="' + b.id + '">' + b.nombre + (b.numero_cuenta ? ' — ' + b.numero_cuenta : '') + ' (L. ' + (b.saldo_actual||0).toFixed(2) + ')</option>';
  });
  div.innerHTML = '<div class="modal" style="max-width:420px">'
    + '<div class="modal-header"><h3>💰 Registrar Abono — CxC</h3>'
    + '<button id="cxc-modal-cerrar" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button></div>'
    + '<div style="padding:20px;display:flex;flex-direction:column;gap:14px">'
    + '<div><label style="font-size:12px;font-weight:600;color:#64748b">Saldo pendiente</label>'
    + '<div style="font-size:20px;font-weight:700;color:#dc2626">' + saldoFmt + '</div></div>'
    + '<div><label style="font-size:12px;font-weight:600;color:#64748b">Monto a abonar</label>'
    + '<input type="number" id="cxc-pago-monto" step="0.01" min="0.01" max="' + saldoVal + '" value="' + saldoVal + '"'
    + ' style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:14px;outline:none;box-sizing:border-box;margin-top:4px"></div>'
    + '<div><label style="font-size:12px;font-weight:600;color:#64748b">Método de pago</label>'
    + '<div style="display:flex;gap:6px;margin-top:6px">'
    + '<button type="button" id="cxc-m-efectivo" style="flex:1;padding:8px 4px;font-size:11px;font-weight:600;border-radius:8px;border:2px solid #2563eb;cursor:pointer;background:#2563eb;color:#fff">💵 Efectivo</button>'
    + '<button type="button" id="cxc-m-tarjeta" style="flex:1;padding:8px 4px;font-size:11px;font-weight:600;border-radius:8px;border:1px solid #e2e8f0;cursor:pointer;background:#fff;color:#475569">💳 Tarjeta</button>'
    + '<button type="button" id="cxc-m-transferencia" style="flex:1;padding:8px 4px;font-size:11px;font-weight:600;border-radius:8px;border:1px solid #e2e8f0;cursor:pointer;background:#fff;color:#475569">🏦 Transferencia</button>'
    + '</div></div>'
    + '<div id="cxc-banco-row" style="display:none"><label style="font-size:12px;font-weight:600;color:#64748b">Banco receptor</label>'
    + '<select id="cxc-pago-banco" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:12px;outline:none;margin-top:4px;box-sizing:border-box">'
    + bancosHtml + '</select></div>'
    + '<button id="cxc-confirmar-btn" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;width:100%">✅ Confirmar Abono</button>'
    + '</div></div>';
  document.body.appendChild(div);
  // Event listeners directos — sin onclick inline
  let metodoActual = 'efectivo';
  div.querySelector('#cxc-modal-cerrar').addEventListener('click', () => div.remove());
  const btnEfectivo = div.querySelector('#cxc-m-efectivo');
  const btnTarjeta = div.querySelector('#cxc-m-tarjeta');
  const btnTransferencia = div.querySelector('#cxc-m-transferencia');
  const styleActivo = 'background:#2563eb;color:#fff;border:2px solid #2563eb';
  const styleInactivo = 'background:#fff;color:#475569;border:1px solid #e2e8f0';
  function setMetodo(m) {
    metodoActual = m;
    btnEfectivo.style.cssText = (m==='efectivo' ? styleActivo : styleInactivo);
    btnTarjeta.style.cssText = (m==='tarjeta' ? styleActivo : styleInactivo);
    btnTransferencia.style.cssText = (m==='transferencia' ? styleActivo : styleInactivo);
    div.querySelector('#cxc-banco-row').style.display = m==='transferencia' ? 'block' : 'none';
  }
  btnEfectivo.addEventListener('click', () => setMetodo('efectivo'));
  btnTarjeta.addEventListener('click', () => setMetodo('tarjeta'));
  btnTransferencia.addEventListener('click', () => setMetodo('transferencia'));
  div.querySelector('#cxc-confirmar-btn').addEventListener('click', async () => {
    const monto = parseFloat(div.querySelector('#cxc-pago-monto').value);
    if (!monto || monto <= 0) { alert('Ingrese un monto válido'); return; }
    const banco_id = metodoActual === 'transferencia' ? (div.querySelector('#cxc-pago-banco')?.value || null) : null;
    if (metodoActual === 'transferencia' && !banco_id) { alert('Seleccione el banco para la transferencia'); return; }
    try {
      await POST('/cxc/' + id + '/pagar', { monto, metodo: metodoActual, banco_id });
      div.remove();
      renderCxC();
    } catch(err) { alert('Error al registrar pago: ' + err.message); }
  });
}

function setCxCMetodo(m) { /* legacy — ya no se usa */ }
async function confirmarPagoCxC(id) { /* legacy — ya no se usa */ }

async function deleteCxC(id) {
  if(!confirm('¿Eliminar esta cuenta?')) return;
  try { await DELETE('/cxc/'+id); renderCxC(); } catch(e) { alert(e.message); }
}

async function estadoCuentaCxC() {
  // Asegurarse que el cache esté actualizado
  try { cxc_cache = await GET('/cxc'); } catch(e) {}
  try { clients_cache = await GET('/clientes'); } catch(e) {}

  const pendientes = cxc_cache.filter(c => c.estado !== 'pagado');
  if (pendientes.length === 0) { alert('No hay cuentas pendientes por cobrar.'); return; }

  // Agrupar por cliente
  const porCliente = {};
  pendientes.forEach(c => {
    const key = c.cliente_id;
    if (!porCliente[key]) porCliente[key] = { nombre: c.cliente_nombre || '—', id: c.cliente_id, cuentas: [] };
    porCliente[key].cuentas.push(c);
  });

  const clientesList = Object.values(porCliente);

  // Eliminar modal anterior si existe
  const existing = document.getElementById('estado-cxc-modal');
  if (existing) existing.remove();

  // Crear modal con selector de cliente
  const div = document.createElement('div');
  div.id = 'estado-cxc-modal';
  div.className = 'modal-overlay active';

  const opcionesClientes = clientesList.map(cl =>
    `<option value="${cl.id}">${cl.nombre} (${cl.cuentas.length} cuenta${cl.cuentas.length>1?'s':''})</option>`
  ).join('');

  div.innerHTML = `
    <div class="modal" style="max-width:520px">
      <div class="modal-header">
        <h3>📋 Estado de Cuenta — CxC</h3>
        <button onclick="document.getElementById('estado-cxc-modal').remove()" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button>
      </div>
      <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
        <div>
          <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:6px">SELECCIONAR CLIENTE</label>
          <select id="estado-cxc-cliente" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:13px;outline:none;font-family:inherit">
            <option value="__todos__">— Todos los clientes —</option>
            ${opcionesClientes}
          </select>
        </div>
        <div id="estado-cxc-preview" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;min-height:80px;font-size:13px"></div>
        <div style="display:flex;gap:8px">
          <button id="estado-cxc-imprimir" style="flex:1;background:#0891b2;color:#fff;border:none;border-radius:8px;padding:11px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">🖨️ Ver / Imprimir</button>
          <button onclick="document.getElementById('estado-cxc-modal').remove()" style="flex:1;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;border-radius:8px;padding:11px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Cancelar</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(div);

  function buildPreview(clienteId) {
    const clientes = clienteId === '__todos__' ? clientesList : clientesList.filter(cl => cl.id === clienteId);
    const preview = document.getElementById('estado-cxc-preview');
    if (clientes.length === 0) { preview.innerHTML = '<span style="color:#94a3b8">Sin datos</span>'; return; }
    let html = '';
    let total = 0;
    clientes.forEach(cl => {
      const sub = cl.cuentas.reduce((s,c) => s + (parseFloat(c.saldo)||0), 0);
      total += sub;
      html += `<div style="font-weight:700;color:#1e3a5f;margin-bottom:4px">👤 ${cl.nombre}</div>`;
      cl.cuentas.forEach(c => {
        const vencida = new Date(c.vencimiento) < new Date();
        html += `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;color:${vencida?'#dc2626':'#475569'}">
          <span>${c.referencia||'—'} · Vence ${fD(c.vencimiento)}${vencida?' ⚠️':''}</span>
          <span style="font-weight:600">${fL(c.saldo)}</span>
        </div>`;
      });
      html += `<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:#0369a1;border-top:1px solid #e2e8f0;margin:6px 0 10px;padding-top:4px">
        <span>Subtotal</span><span>${fL(sub)}</span>
      </div>`;
    });
    html += `<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;color:#1e3a5f;border-top:2px solid #1e3a5f;padding-top:8px;margin-top:4px">
      <span>TOTAL PENDIENTE</span><span>${fL(total)}</span>
    </div>`;
    preview.innerHTML = html;
  }

  // Mostrar preview inicial
  buildPreview('__todos__');

  div.querySelector('#estado-cxc-cliente').addEventListener('change', e => buildPreview(e.target.value));

  div.querySelector('#estado-cxc-imprimir').addEventListener('click', () => {
    const clienteId = div.querySelector('#estado-cxc-cliente').value;
    const clientes = clienteId === '__todos__' ? clientesList : clientesList.filter(cl => cl.id === clienteId);
    const hoy = new Date().toLocaleDateString('es-HN');
    const titulo = clienteId === '__todos__' ? 'Todos los Clientes' : clientes[0]?.nombre || '—';
    let filas = '';
    let totalGeneral = 0;
    clientes.forEach(cl => {
      const subtotal = cl.cuentas.reduce((s,c) => s + (parseFloat(c.saldo)||0), 0);
      totalGeneral += subtotal;
      filas += `<tr style="background:#f0f9ff"><td colspan="5" style="font-weight:700;color:#1e3a5f;padding:8px 12px;font-size:13px">👤 ${cl.nombre}</td></tr>`;
      cl.cuentas.forEach(c => {
        const vencida = new Date(c.vencimiento) < new Date();
        filas += `<tr>
          <td style="padding:6px 12px;font-size:12px;font-family:monospace">${c.referencia||'—'}</td>
          <td style="padding:6px 12px;font-size:12px">${fD(c.fecha)}</td>
          <td style="padding:6px 12px;font-size:12px;color:${vencida?'#dc2626':'#475569'}">${fD(c.vencimiento)}${vencida?' ⚠️':''}</td>
          <td style="padding:6px 12px;font-size:12px;text-align:right">${fL(c.monto)}</td>
          <td style="padding:6px 12px;font-size:12px;text-align:right;font-weight:700;color:#dc2626">${fL(c.saldo)}</td>
        </tr>`;
      });
      filas += `<tr style="background:#e0f2fe"><td colspan="4" style="padding:6px 12px;font-size:12px;font-weight:700;text-align:right;color:#0369a1">Subtotal ${cl.nombre}</td><td style="padding:6px 12px;font-size:13px;font-weight:700;text-align:right;color:#0369a1">${fL(subtotal)}</td></tr>`;
    });
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Estado de Cuenta CxC — ${titulo}</title>
    <style>
      body{font-family:'Segoe UI',sans-serif;margin:0;padding:24px;color:#1e293b}
      h1{font-size:20px;color:#1e3a5f;margin-bottom:2px}
      h2{font-size:14px;font-weight:600;color:#0369a1;margin-bottom:4px}
      .sub{font-size:12px;color:#64748b;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th{background:#1e3a5f;color:#fff;padding:8px 12px;font-size:11px;text-align:left;text-transform:uppercase;letter-spacing:.4px}
      tr:nth-child(even){background:#f8fafc}
      .total-row td{background:#1e3a5f;color:#fff;font-weight:700;padding:10px 12px;font-size:14px}
      @media print{body{padding:0}}
    </style></head><body>
    <h1>📋 Estado de Cuenta — Cuentas por Cobrar</h1>
    <h2>${titulo}</h2>
    <div class="sub">Generado: ${hoy} &nbsp;|&nbsp; Solo cuentas pendientes</div>
    <table>
      <thead><tr><th>Referencia</th><th>Fecha</th><th>Vencimiento</th><th style="text-align:right">Monto</th><th style="text-align:right">Saldo</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr class="total-row"><td colspan="4" style="text-align:right">TOTAL GENERAL PENDIENTE</td><td style="text-align:right">${fL(totalGeneral)}</td></tr></tfoot>
    </table>
    </body></html>`;
    div.remove();
    openPrint(html, 'Estado_Cuenta_CxC');
  });
}


async function estadoCuentaCxP() {
  try { cxp_cache = await GET('/cxp'); } catch(e) {}

  const pendientes = cxp_cache.filter(c => c.estado !== 'pagado');
  if (pendientes.length === 0) { alert('No hay cuentas pendientes por pagar.'); return; }

  // Agrupar por proveedor
  const porProveedor = {};
  pendientes.forEach(c => {
    const key = c.proveedor_id || c.proveedor_nombre || 'Sin proveedor';
    if (!porProveedor[key]) porProveedor[key] = { nombre: c.proveedor_nombre || '—', id: key, cuentas: [] };
    porProveedor[key].cuentas.push(c);
  });

  const provList = Object.values(porProveedor);

  const existing = document.getElementById('estado-cxp-modal');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = 'estado-cxp-modal';
  div.className = 'modal-overlay active';

  const opcionesProv = provList.map(p =>
    `<option value="${p.id}">${p.nombre} (${p.cuentas.length} cuenta${p.cuentas.length>1?'s':''})</option>`
  ).join('');

  div.innerHTML = `
    <div class="modal" style="max-width:520px">
      <div class="modal-header">
        <h3>📋 Estado de Cuenta — CxP</h3>
        <button onclick="document.getElementById('estado-cxp-modal').remove()" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button>
      </div>
      <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
        <div>
          <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:6px">SELECCIONAR PROVEEDOR</label>
          <select id="estado-cxp-proveedor" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:13px;outline:none;font-family:inherit">
            <option value="__todos__">— Todos los proveedores —</option>
            ${opcionesProv}
          </select>
        </div>
        <div id="estado-cxp-preview" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;min-height:80px;font-size:13px"></div>
        <div style="display:flex;gap:8px">
          <button id="estado-cxp-imprimir" style="flex:1;background:#0891b2;color:#fff;border:none;border-radius:8px;padding:11px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">🖨️ Ver / Imprimir</button>
          <button onclick="document.getElementById('estado-cxp-modal').remove()" style="flex:1;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;border-radius:8px;padding:11px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Cancelar</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(div);

  function buildPreview(provId) {
    const lista = provId === '__todos__' ? provList : provList.filter(p => p.id === provId);
    const preview = document.getElementById('estado-cxp-preview');
    if (lista.length === 0) { preview.innerHTML = '<span style="color:#94a3b8">Sin datos</span>'; return; }
    let html = '';
    let total = 0;
    lista.forEach(p => {
      const sub = p.cuentas.reduce((s,c) => s + (parseFloat(c.saldo)||0), 0);
      total += sub;
      html += `<div style="font-weight:700;color:#92400e;margin-bottom:4px">🏢 ${p.nombre}</div>`;
      p.cuentas.forEach(c => {
        const vencida = new Date(c.vencimiento) < new Date();
        html += `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;color:${vencida?'#dc2626':'#475569'}">
          <span>${c.referencia||'—'} · Vence ${fD(c.vencimiento)}${vencida?' ⚠️':''}</span>
          <span style="font-weight:600">${fL(c.saldo)}</span>
        </div>`;
      });
      html += `<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:#92400e;border-top:1px solid #e2e8f0;margin:6px 0 10px;padding-top:4px">
        <span>Subtotal</span><span>${fL(sub)}</span>
      </div>`;
    });
    html += `<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;color:#92400e;border-top:2px solid #92400e;padding-top:8px;margin-top:4px">
      <span>TOTAL PENDIENTE</span><span>${fL(total)}</span>
    </div>`;
    preview.innerHTML = html;
  }

  buildPreview('__todos__');

  div.querySelector('#estado-cxp-proveedor').addEventListener('change', e => buildPreview(e.target.value));

  div.querySelector('#estado-cxp-imprimir').addEventListener('click', () => {
    const provId = div.querySelector('#estado-cxp-proveedor').value;
    const lista = provId === '__todos__' ? provList : provList.filter(p => p.id === provId);
    const hoy = new Date().toLocaleDateString('es-HN');
    const titulo = provId === '__todos__' ? 'Todos los Proveedores' : lista[0]?.nombre || '—';
    let filas = '';
    let totalGeneral = 0;
    lista.forEach(p => {
      const subtotal = p.cuentas.reduce((s,c) => s + (parseFloat(c.saldo)||0), 0);
      totalGeneral += subtotal;
      filas += `<tr style="background:#fff7ed"><td colspan="5" style="font-weight:700;color:#92400e;padding:8px 12px;font-size:13px">🏢 ${p.nombre}</td></tr>`;
      p.cuentas.forEach(c => {
        const vencida = new Date(c.vencimiento) < new Date();
        filas += `<tr>
          <td style="padding:6px 12px;font-size:12px;font-family:monospace">${c.referencia||'—'}</td>
          <td style="padding:6px 12px;font-size:12px">${fD(c.fecha)}</td>
          <td style="padding:6px 12px;font-size:12px;color:${vencida?'#dc2626':'#475569'}">${fD(c.vencimiento)}${vencida?' ⚠️':''}</td>
          <td style="padding:6px 12px;font-size:12px;text-align:right">${fL(c.monto)}</td>
          <td style="padding:6px 12px;font-size:12px;text-align:right;font-weight:700;color:#ea580c">${fL(c.saldo)}</td>
        </tr>`;
      });
      filas += `<tr style="background:#fed7aa"><td colspan="4" style="padding:6px 12px;font-size:12px;font-weight:700;text-align:right;color:#92400e">Subtotal ${p.nombre}</td><td style="padding:6px 12px;font-size:13px;font-weight:700;text-align:right;color:#92400e">${fL(subtotal)}</td></tr>`;
    });
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Estado de Cuenta CxP — ${titulo}</title>
    <style>
      body{font-family:'Segoe UI',sans-serif;margin:0;padding:24px;color:#1e293b}
      h1{font-size:20px;color:#92400e;margin-bottom:2px}
      h2{font-size:14px;font-weight:600;color:#92400e;margin-bottom:4px}
      .sub{font-size:12px;color:#64748b;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th{background:#92400e;color:#fff;padding:8px 12px;font-size:11px;text-align:left;text-transform:uppercase;letter-spacing:.4px}
      tr:nth-child(even){background:#f8fafc}
      .total-row td{background:#92400e;color:#fff;font-weight:700;padding:10px 12px;font-size:14px}
      @media print{body{padding:0}}
    </style></head><body>
    <h1>📋 Estado de Cuenta — Cuentas por Pagar</h1>
    <h2>${titulo}</h2>
    <div class="sub">Generado: ${hoy} &nbsp;|&nbsp; Solo cuentas pendientes</div>
    <table>
      <thead><tr><th>Referencia</th><th>Fecha</th><th>Vencimiento</th><th style="text-align:right">Monto</th><th style="text-align:right">Saldo</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr class="total-row"><td colspan="4" style="text-align:right">TOTAL GENERAL PENDIENTE</td><td style="text-align:right">${fL(totalGeneral)}</td></tr></tfoot>
    </table>
    </body></html>`;
    div.remove();
    openPrint(html, 'Estado_Cuenta_CxP');
  });
}


async function reporteCorteCaja() {
  const data = await GET('/reportes/ventas_resumen', getRepParams());
  const ventas = await GET('/ventas', getRepParams()+'&limite=200');
  const ini = document.getElementById('rep-fecha-ini').value;
  const fin = document.getElementById('rep-fecha-fin').value;
  const b = BRANCH || {};
  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;width:80mm;padding:4mm}@media print{@page{size:80mm auto;margin:0}}
.c{text-align:center}.b{font-weight:700}.sep{border-top:1px dashed #999;margin:5px 0}table{width:100%;border-collapse:collapse}td{padding:2px 0}td:last-child{text-align:right}
</style></head><body>
<div class="c b" style="font-size:14px">CORTE DE CAJA</div>
<div class="c">${b.nombre||''}</div>
<div class="c" style="font-size:10px">RTN: ${b.rtn||''}</div>
<div class="sep"></div>
<div>Período: ${fD(ini)} al ${fD(fin)}</div>
<div>Generado: ${new Date().toLocaleString('es-HN',{timeZone:'America/Tegucigalpa'})}</div>
<div class="sep"></div>
<table>
  <tr><td>N° Ventas</td><td>${data.total_ventas||0}</td></tr>
  <tr><td>Descuentos</td><td>-${fL(data.descuentos||0)}</td></tr>
  <tr><td>ISV 15%</td><td>${fL(data.isv15||0)}</td></tr>
  <tr><td class="b" style="font-size:14px">TOTAL</td><td class="b" style="font-size:14px">${fL(data.total||0)}</td></tr>
</table>
<div class="sep"></div>
${ventas.slice(0,30).map(s=>`<div style="font-size:10px">${s.numero_factura} | ${(s.cliente_nombre||'').substring(0,14)} | ${fL(s.total)}</div>`).join('')}
<div class="sep"></div>
<div class="c" style="font-size:10px">Powered by Metric POS</div>
<div style="height:10mm"></div></body></html>`, "Corte de Caja");
}

async function reporteMasterVentas() {
  const sales = await GET('/ventas', getRepParams()+'&limite=500');
  const ini = document.getElementById('rep-fecha-ini').value;
  const fin = document.getElementById('rep-fecha-fin').value;
  const b = BRANCH || {};
  const total = sales.reduce((s,x)=>s+x.total,0);
  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}body{font-size:11px;padding:20px}
@media print{@page{size:letter landscape;margin:10mm}body{padding:0}}
table{width:100%;border-collapse:collapse}th{background:#1e3a5f;color:#fff;padding:7px 8px;font-size:10px}td{padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:10px}
tr:nth-child(even) td{background:#f8fafc}.total-row td{background:#1e3a5f;color:#fff;font-weight:700}
</style></head><body>
<div style="display:flex;justify-content:space-between;margin-bottom:16px;border-bottom:2px solid #1e3a5f;padding-bottom:12px">
<div><strong style="font-size:18px;color:#1e3a5f">MASTER DE VENTAS</strong><br><span style="color:#64748b">RTN: ${b.rtn||''} | ${b.direccion||''}</span></div>
<div style="text-align:right"><span style="color:#64748b">Período: ${fD(ini)} al ${fD(fin)}</span></div>
</div>
<table><thead><tr><th>N° Factura</th><th>Fecha</th><th>Cliente</th><th>RTN</th><th style="text-align:right">Gravado</th><th style="text-align:right">ISV</th><th style="text-align:right">Desc.</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${sales.map(s=>`<tr><td style="font-family:monospace">${s.numero_factura}</td><td>${fD(s.fecha)}</td><td>${s.cliente_nombre||'—'}</td><td>${s.cliente_rtn||'—'}</td><td style="text-align:right">${fL(s.importe_gravado||0)}</td><td style="text-align:right">${fL(s.isv15||0)}</td><td style="text-align:right">${fL(s.descuento||0)}</td><td style="text-align:right;font-weight:700">${fL(s.total)}</td></tr>`).join('')}</tbody>
<tfoot><tr class="total-row"><td colspan="4">TOTALES (${sales.length} facturas)</td><td style="text-align:right">${fL(sales.reduce((s,x)=>s+(x.importe_gravado||0),0))}</td><td style="text-align:right">${fL(sales.reduce((s,x)=>s+(x.isv15||0),0))}</td><td style="text-align:right">${fL(sales.reduce((s,x)=>s+(x.descuento||0),0))}</td><td style="text-align:right">${fL(total)}</td></tr></tfoot></table>
<div style="margin-top:12px;font-size:10px;color:#94a3b8;text-align:right">Powered by Metric POS</div></body></html>`, "Master de Ventas");
}

async function reporteVentasCategoria() {
  const rows = await GET('/reportes/ventas_por_categoria', getRepParams());
  const ini = document.getElementById('rep-fecha-ini').value;
  const fin = document.getElementById('rep-fecha-fin').value;
  const totalGen = rows.reduce((s,r)=>s+r.total,0);
  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}body{font-size:12px;padding:20px}@media print{@page{size:letter;margin:10mm}}table{width:100%;border-collapse:collapse;margin-top:14px}th{background:#1e3a5f;color:#fff;padding:8px 10px;text-align:left}td{padding:8px 10px;border-bottom:1px solid #f1f5f9}tr:nth-child(even) td{background:#f8fafc}.total-row td{background:#1e3a5f;color:#fff;font-weight:700}.bar{height:10px;background:#2563eb;border-radius:3px;display:inline-block}
</style></head><body>
<div style="display:flex;justify-content:space-between;margin-bottom:16px;border-bottom:2px solid #1e3a5f;padding-bottom:12px">
<strong style="font-size:18px;color:#1e3a5f">VENTAS POR CATEGORÍA</strong>
<span style="color:#64748b">Período: ${fD(ini)} al ${fD(fin)}</span>
</div>
<table><thead><tr><th>Categoría</th><th style="text-align:right">Unidades</th><th style="text-align:right">Total</th><th style="text-align:right">%</th><th>Barra</th></tr></thead>
<tbody>${rows.map(r=>`<tr><td style="font-weight:600">${r.categoria||'Sin categoría'}</td><td style="text-align:right">${r.unidades}</td><td style="text-align:right;font-weight:700">${fL(r.total)}</td><td style="text-align:right">${totalGen>0?((r.total/totalGen)*100).toFixed(1)+'%':'0%'}</td><td><div class="bar" style="width:${totalGen>0?Math.round((r.total/totalGen)*100):0}px"></div></td></tr>`).join('')}</tbody>
<tfoot><tr class="total-row"><td>TOTAL</td><td style="text-align:right">${rows.reduce((s,r)=>s+r.unidades,0)}</td><td style="text-align:right">${fL(totalGen)}</td><td colspan="2"></td></tr></tfoot></table>
<div style="margin-top:12px;font-size:10px;color:#94a3b8;text-align:right">Powered by Metric POS</div></body></html>`, "Ventas por Categoría");
}

async function reporteAnalisisMes() {
  const rows = await GET('/reportes/ventas_por_mes', `sucursal_id=${USER.sucursal_id}`);
  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}body{font-size:12px;padding:20px}@media print{@page{size:letter;margin:10mm}}table{width:100%;border-collapse:collapse;margin-top:14px}th{background:#1e3a5f;color:#fff;padding:8px 10px;text-align:left}td{padding:8px 10px;border-bottom:1px solid #f1f5f9}tr:nth-child(even) td{background:#f8fafc}.total-row td{background:#1e3a5f;color:#fff;font-weight:700}
</style></head><body>
<div style="display:flex;justify-content:space-between;margin-bottom:16px;border-bottom:2px solid #1e3a5f;padding-bottom:12px">
<strong style="font-size:18px;color:#1e3a5f">ANÁLISIS DE VENTAS POR MES</strong>
<span style="color:#64748b">Generado: ${fDT(new Date().toISOString())}</span>
</div>
<table><thead><tr><th>Mes</th><th style="text-align:right">N° Ventas</th><th style="text-align:right">ISV 15%</th><th style="text-align:right">Total</th><th style="text-align:right">Promedio/Venta</th></tr></thead>
<tbody>${rows.map(r=>`<tr><td style="font-weight:600">${r.mes}</td><td style="text-align:right">${r.ventas}</td><td style="text-align:right">${fL(r.isv||0)}</td><td style="text-align:right;font-weight:700">${fL(r.total||0)}</td><td style="text-align:right">${fL(r.ventas>0?r.total/r.ventas:0)}</td></tr>`).join('')}</tbody>
<tfoot><tr class="total-row"><td>TOTAL</td><td style="text-align:right">${rows.reduce((s,r)=>s+r.ventas,0)}</td><td style="text-align:right">${fL(rows.reduce((s,r)=>s+(r.isv||0),0))}</td><td style="text-align:right">${fL(rows.reduce((s,r)=>s+(r.total||0),0))}</td><td></td></tr></tfoot></table>
<div style="margin-top:12px;font-size:10px;color:#94a3b8;text-align:right">Powered by Metric POS</div></body></html>`, "Análisis de Ventas por Mes");
}

async function reporteInventario() {
  const inv = await GET('/reportes/inventario', `sucursal_id=${USER.sucursal_id}`);
  const b = BRANCH || {};
  const totalVal = inv.reduce((s,p)=>s+(p.valor_venta||0),0);
  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}body{font-size:11px;padding:20px}@media print{@page{size:letter;margin:10mm}}table{width:100%;border-collapse:collapse;margin-top:14px}th{background:#1e3a5f;color:#fff;padding:7px 8px;font-size:10px}td{padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:10px}tr:nth-child(even) td{background:#f8fafc}.total-row td{background:#1e3a5f;color:#fff;font-weight:700}
.firma-row{display:flex;justify-content:space-around;margin-top:40px}.firma{border-top:1px solid #333;width:160px;text-align:center;font-size:10px;padding-top:4px}
</style></head><body>
<div style="display:flex;justify-content:space-between;margin-bottom:16px;border-bottom:2px solid #1e3a5f;padding-bottom:12px">
<div><strong style="font-size:18px;color:#1e3a5f">INVENTARIO FÍSICO</strong><br><span style="font-size:10px;color:#64748b">RTN: ${b.rtn||''}</span></div>
<div style="text-align:right;color:#64748b;font-size:11px">Fecha: ${fD(today())}<br>Hora: ${new Date().toLocaleTimeString('es-HN',{timeZone:'America/Tegucigalpa'})}</div>
</div>
<table><thead><tr><th>Código</th><th>Descripción</th><th>Categoría</th><th style="text-align:right">S.Mín</th><th style="text-align:right">S.Actual</th><th style="text-align:right">Conteo Físico</th><th style="text-align:right">Precio</th><th style="text-align:right">Valor</th></tr></thead>
<tbody>${inv.map(p=>`<tr><td style="font-family:monospace">${p.codigo}</td><td style="font-weight:600">${p.nombre}</td><td>${p.categoria}</td><td style="text-align:right">${p.stock_min||0}</td><td style="text-align:right;${(p.stock||0)<=(p.stock_min||0)?'color:#dc2626;font-weight:700':''}">${p.stock||0}</td><td style="text-align:right;border-bottom:1px solid #999">___</td><td style="text-align:right">${fL(p.precio_venta||0)}</td><td style="text-align:right;font-weight:600">${fL(p.valor_venta||0)}</td></tr>`).join('')}</tbody>
<tfoot><tr class="total-row"><td colspan="7">VALOR TOTAL DEL INVENTARIO</td><td style="text-align:right">${fL(totalVal)}</td></tr></tfoot></table>
<div class="firma-row"><div class="firma">Elaborado por</div><div class="firma">Revisado por</div><div class="firma">Autorizado por</div></div>
<div style="margin-top:20px;font-size:10px;color:#94a3b8;text-align:right">Powered by Metric POS</div></body></html>`, "Inventario Físico");
}

async function reporteVentasArticulo() {
  const rows = await GET('/reportes/articulos_por_dia', getRepParams());
  const ini = document.getElementById('rep-fecha-ini').value;
  const fin = document.getElementById('rep-fecha-fin').value;
  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}body{font-size:11px;padding:20px}@media print{@page{size:letter landscape;margin:10mm}}table{width:100%;border-collapse:collapse;margin-top:14px}th{background:#1e3a5f;color:#fff;padding:7px 8px;font-size:10px;text-align:left}td{padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:10px}tr:nth-child(even) td{background:#f8fafc}.total-row td{background:#1e3a5f;color:#fff;font-weight:700}
</style></head><body>
<div style="display:flex;justify-content:space-between;margin-bottom:16px;border-bottom:2px solid #1e3a5f;padding-bottom:12px">
<strong style="font-size:18px;color:#1e3a5f">VENTAS DE ARTÍCULO POR DÍA</strong>
<span style="color:#64748b">Período: ${fD(ini)} al ${fD(fin)}</span>
</div>
<table><thead><tr><th>Fecha</th><th>Código</th><th>Artículo</th><th>Categoría</th><th style="text-align:right">Unidades</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${rows.map(r=>`<tr><td>${fD(r.dia)}</td><td style="font-family:monospace">${r.producto_codigo||'—'}</td><td style="font-weight:600">${r.producto_nombre}</td><td>${r.producto_categoria||'—'}</td><td style="text-align:right">${r.unidades}</td><td style="text-align:right;font-weight:700">${fL(r.total)}</td></tr>`).join('')}</tbody>
<tfoot><tr class="total-row"><td colspan="4">TOTAL</td><td style="text-align:right">${rows.reduce((s,r)=>s+r.unidades,0)}</td><td style="text-align:right">${fL(rows.reduce((s,r)=>s+r.total,0))}</td></tr></tfoot></table>
<div style="margin-top:12px;font-size:10px;color:#94a3b8;text-align:right">Powered by Metric POS</div></body></html>`, "Ventas de Artículo por Día");
}


// ─── REPORTE CxC ─────────────────────────────────────────────────────────────
async function reporteCxC() {
  const cxc = await GET('/cxc');
  const b = BRANCH || {};
  const pendientes = cxc.filter(c => c.estado !== 'pagado');
  const totalPend = pendientes.reduce((s,c) => s + (c.saldo||0), 0);
  const totalMonto = pendientes.reduce((s,c) => s + (c.monto||0), 0);
  const vencidas = pendientes.filter(c => new Date(c.vencimiento) < new Date());
  const totalVenc = vencidas.reduce((s,c) => s + (c.saldo||0), 0);

  const filas = cxc.map(c => {
    const vencida = c.estado !== 'pagado' && new Date(c.vencimiento) < new Date();
    const colorFila = c.estado === 'pagado' ? '' : vencida ? 'background:#fef2f2' : '';
    const colorSaldo = c.estado === 'pagado' ? 'color:#16a34a' : vencida ? 'color:#dc2626;font-weight:700' : 'color:#d97706;font-weight:700';
    return `<tr style="${colorFila}">
      <td style="font-weight:600">${c.cliente_nombre||'—'}</td>
      <td style="font-family:monospace;font-size:10px">${c.referencia||'—'}</td>
      <td style="font-family:monospace;font-size:10px">${c.cliente_rtn||'—'}</td>
      <td>${fD(c.creado)}</td>
      <td style="${vencida?'color:#dc2626;font-weight:600':''}">${fD(c.vencimiento)}</td>
      <td style="text-align:right">${fL(c.monto||0)}</td>
      <td style="text-align:right">${fL((c.monto||0)-(c.saldo||0))}</td>
      <td style="text-align:right;${colorSaldo}">${fL(c.saldo||0)}</td>
      <td style="text-align:center"><span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;${c.estado==='pagado'?'background:#f0fdf4;color:#16a34a':vencida?'background:#fef2f2;color:#dc2626':'background:#fffbeb;color:#d97706'}">${c.estado==='pagado'?'Pagado':vencida?'Vencida':'Pendiente'}</span></td>
    </tr>`;
  }).join('');

  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}
    body{font-size:11px;padding:20px}
    @media print{@page{size:letter landscape;margin:10mm}body{padding:0}}
    table{width:100%;border-collapse:collapse;margin-top:14px}
    th{background:#1e3a5f;color:#fff;padding:7px 8px;font-size:10px;text-align:left}
    td{padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:10px;vertical-align:middle}
    .total-row td{background:#1e3a5f;color:#fff;font-weight:700}
    .resumen{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
    .res-card{border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}
    .res-label{font-size:10px;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
    .res-val{font-size:16px;font-weight:700;color:#1e3a5f}
    .res-val.red{color:#dc2626}.res-val.amber{color:#d97706}
  </style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;border-bottom:2px solid #1e3a5f;padding-bottom:12px">
    <div>
      <div style="font-size:20px;font-weight:700;color:#1e3a5f">CUENTAS POR COBRAR</div>
      <div style="font-size:11px;color:#64748b">${b.nombre||''} &nbsp;|&nbsp; RTN: ${b.rtn||''}</div>
    </div>
    <div style="text-align:right;font-size:11px;color:#64748b">
      Generado: ${new Date().toLocaleString('es-HN',{timeZone:'America/Tegucigalpa'})}<br>
      Usuario: ${USER?.nombre||''}
    </div>
  </div>
  <div class="resumen">
    <div class="res-card"><div class="res-label">Total Cuentas</div><div class="res-val">${cxc.length}</div></div>
    <div class="res-card"><div class="res-label">Monto Original</div><div class="res-val">${fL(totalMonto)}</div></div>
    <div class="res-card"><div class="res-label">Saldo Pendiente</div><div class="res-val amber">${fL(totalPend)}</div></div>
    <div class="res-card"><div class="res-label">Saldo Vencido</div><div class="res-val red">${fL(totalVenc)}</div></div>
  </div>
  <table>
    <thead><tr>
      <th>Cliente</th><th>Referencia</th><th>RTN</th><th>Fecha</th><th>Vencimiento</th>
      <th style="text-align:right">Monto</th><th style="text-align:right">Abonado</th>
      <th style="text-align:right">Saldo</th><th style="text-align:center">Estado</th>
    </tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr class="total-row">
      <td colspan="5">TOTALES (${cxc.length} cuentas — ${vencidas.length} vencidas)</td>
      <td style="text-align:right">${fL(totalMonto)}</td>
      <td style="text-align:right">${fL(totalMonto - totalPend)}</td>
      <td style="text-align:right">${fL(totalPend)}</td>
      <td></td>
    </tr></tfoot>
  </table>
  <div style="margin-top:16px;display:flex;justify-content:space-around">
    <div style="border-top:1px solid #333;width:180px;text-align:center;padding-top:4px;font-size:10px">Elaborado por</div>
    <div style="border-top:1px solid #333;width:180px;text-align:center;padding-top:4px;font-size:10px">Revisado por</div>
    <div style="border-top:1px solid #333;width:180px;text-align:center;padding-top:4px;font-size:10px">Autorizado por</div>
  </div>
  <div style="margin-top:12px;font-size:10px;color:#94a3b8;text-align:right">Powered by Metric POS</div>
  </body></html>`, "Cuentas por Cobrar");
}

// ─── REPORTE CxP ─────────────────────────────────────────────────────────────
async function reporteCxP() {
  const cxp = await GET('/cxp');
  const b = BRANCH || {};
  const pendientes = cxp.filter(c => c.estado !== 'pagado');
  const totalPend = pendientes.reduce((s,c) => s + (c.saldo||0), 0);
  const totalMonto = pendientes.reduce((s,c) => s + (c.monto||0), 0);
  const vencidas = pendientes.filter(c => new Date(c.vencimiento) < new Date());
  const totalVenc = vencidas.reduce((s,c) => s + (c.saldo||0), 0);
  const proximas = pendientes.filter(c => {
    const dias = (new Date(c.vencimiento) - new Date()) / (1000*60*60*24);
    return dias >= 0 && dias <= 7;
  });

  const filas = cxp.map(c => {
    const vencida = c.estado !== 'pagado' && new Date(c.vencimiento) < new Date();
    const proxima = !vencida && c.estado !== 'pagado' && (new Date(c.vencimiento) - new Date()) / (1000*60*60*24) <= 7;
    const colorFila = c.estado === 'pagado' ? '' : vencida ? 'background:#fef2f2' : proxima ? 'background:#fffbeb' : '';
    const colorSaldo = c.estado === 'pagado' ? 'color:#16a34a' : vencida ? 'color:#dc2626;font-weight:700' : 'color:#d97706;font-weight:700';
    return `<tr style="${colorFila}">
      <td style="font-weight:600">${c.proveedor_nombre||'—'}</td>
      <td style="font-family:monospace;font-size:10px">${c.referencia||'—'}</td>
      <td style="font-family:monospace;font-size:10px">${c.proveedor_rtn||'—'}</td>
      <td>${fD(c.creado)}</td>
      <td style="${vencida?'color:#dc2626;font-weight:600':proxima?'color:#d97706;font-weight:600':''}">${fD(c.vencimiento)}</td>
      <td style="text-align:right">${fL(c.monto||0)}</td>
      <td style="text-align:right">${fL((c.monto||0)-(c.saldo||0))}</td>
      <td style="text-align:right;${colorSaldo}">${fL(c.saldo||0)}</td>
      <td style="text-align:center"><span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;${c.estado==='pagado'?'background:#f0fdf4;color:#16a34a':vencida?'background:#fef2f2;color:#dc2626':proxima?'background:#fffbeb;color:#d97706':'background:#eff6ff;color:#2563eb'}">${c.estado==='pagado'?'Pagado':vencida?'Vencida':proxima?'Próxima':'Pendiente'}</span></td>
    </tr>`;
  }).join('');

  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}
    body{font-size:11px;padding:20px}
    @media print{@page{size:letter landscape;margin:10mm}body{padding:0}}
    table{width:100%;border-collapse:collapse;margin-top:14px}
    th{background:#1e3a5f;color:#fff;padding:7px 8px;font-size:10px;text-align:left}
    td{padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:10px;vertical-align:middle}
    .total-row td{background:#1e3a5f;color:#fff;font-weight:700}
    .resumen{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
    .res-card{border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}
    .res-label{font-size:10px;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
    .res-val{font-size:16px;font-weight:700;color:#1e3a5f}
    .res-val.red{color:#dc2626}.res-val.amber{color:#d97706}
  </style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;border-bottom:2px solid #1e3a5f;padding-bottom:12px">
    <div>
      <div style="font-size:20px;font-weight:700;color:#1e3a5f">CUENTAS POR PAGAR</div>
      <div style="font-size:11px;color:#64748b">${b.nombre||''} &nbsp;|&nbsp; RTN: ${b.rtn||''}</div>
    </div>
    <div style="text-align:right;font-size:11px;color:#64748b">
      Generado: ${new Date().toLocaleString('es-HN',{timeZone:'America/Tegucigalpa'})}<br>
      Usuario: ${USER?.nombre||''}
    </div>
  </div>
  <div class="resumen">
    <div class="res-card"><div class="res-label">Total Cuentas</div><div class="res-val">${cxp.length}</div></div>
    <div class="res-card"><div class="res-label">Monto Original</div><div class="res-val">${fL(totalMonto)}</div></div>
    <div class="res-card"><div class="res-label">Saldo Pendiente</div><div class="res-val amber">${fL(totalPend)}</div></div>
    <div class="res-card"><div class="res-label">Vence en 7 días</div><div class="res-val red">${fL(proximas.reduce((s,c)=>s+(c.saldo||0),0))}</div></div>
  </div>
  <table>
    <thead><tr>
      <th>Proveedor</th><th>Referencia</th><th>RTN</th><th>Fecha</th><th>Vencimiento</th>
      <th style="text-align:right">Monto</th><th style="text-align:right">Abonado</th>
      <th style="text-align:right">Saldo</th><th style="text-align:center">Estado</th>
    </tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr class="total-row">
      <td colspan="5">TOTALES (${cxp.length} cuentas — ${vencidas.length} vencidas)</td>
      <td style="text-align:right">${fL(totalMonto)}</td>
      <td style="text-align:right">${fL(totalMonto - totalPend)}</td>
      <td style="text-align:right">${fL(totalPend)}</td>
      <td></td>
    </tr></tfoot>
  </table>
  <div style="margin-top:16px;display:flex;justify-content:space-around">
    <div style="border-top:1px solid #333;width:180px;text-align:center;padding-top:4px;font-size:10px">Elaborado por</div>
    <div style="border-top:1px solid #333;width:180px;text-align:center;padding-top:4px;font-size:10px">Revisado por</div>
    <div style="border-top:1px solid #333;width:180px;text-align:center;padding-top:4px;font-size:10px">Autorizado por</div>
  </div>
  <div style="margin-top:12px;font-size:10px;color:#94a3b8;text-align:right">Powered by Metric POS</div>
  </body></html>`, "Cuentas por Pagar");
}

// ─── USUARIOS ────────────────────────────────────────────────────────────────
let users_cache = [];
let editingUser = null;

async function renderUsers() {
  try { [users_cache, suppliers_cache] = await Promise.all([GET('/usuarios'), GET('/sucursales')]); } catch(e) {}
  document.getElementById('users-count').textContent = users_cache.length + ' usuarios';
  document.getElementById('users-table-body').innerHTML = users_cache.map(u => `
    <tr>
      <td style="font-weight:600">${u.nombre}</td>
      <td style="font-family:monospace;font-size:11px">${u.username}</td>
      <td><span class="badge ${u.rol==='admin'?'badge-blue':u.rol==='supervisor'?'badge-amber':'badge-gray'}">${u.rol}</span></td>
      <td>${u.sucursal_nombre||'—'}</td>
      <td><span class="badge ${u.activo?'badge-green':'badge-red'}">${u.activo?'Activo':'Inactivo'}</span></td>
      <td><div style="display:flex;gap:4px;justify-content:flex-end">
        <button class="action-btn edit" onclick="openUserModal('${u.id}')">✏️</button>
        <button class="action-btn" style="background:#fff7ed;color:#d97706;border:1px solid #fde68a" title="Bloqueo de módulos" onclick="openPermisosModal('${u.id}','${u.nombre.replace(/'/g,"\\'")}')">🔒</button>
      </div></td>
    </tr>
  `).join('');
}

async function openUserModal(id) {
  const u = id ? users_cache.find(x => x.id === id) : null;
  editingUser = u;
  let sucursales = [];
  try { sucursales = await GET('/sucursales'); } catch(e) {}
  document.getElementById('user-modal-title').textContent = u ? 'Editar Usuario' : 'Nuevo Usuario';
  document.getElementById('u-nombre').value = u?.nombre||'';
  document.getElementById('u-username').value = u?.username||'';
  document.getElementById('u-password').value = '';
  document.getElementById('u-rol').value = u?.rol||'cajero';
  document.getElementById('u-sucursal').innerHTML = sucursales.map(s=>`<option value="${s.id}">${s.nombre}</option>`).join('');
  if (u?.sucursal_id) document.getElementById('u-sucursal').value = u.sucursal_id;
  document.getElementById('u-activo').value = u?.activo !== false ? '1' : '0';
  openModal('user-modal');
}

async function saveUser(e) {
  e.preventDefault();
  const data = {
    nombre: document.getElementById('u-nombre').value,
    username: document.getElementById('u-username').value,
    rol: document.getElementById('u-rol').value,
    sucursal_id: document.getElementById('u-sucursal').value,
    activo: document.getElementById('u-activo').value === '1',
  };
  const pwd = document.getElementById('u-password').value;
  if (pwd) data.password = pwd;
  if (!editingUser && !pwd) { alert('La contraseña es requerida para nuevos usuarios'); return; }
  try {
    if (editingUser) await PUT('/usuarios/'+editingUser.id, data);
    else await POST('/usuarios', { ...data, password: pwd });
    closeModal('user-modal'); renderUsers();
  } catch(e) { alert(e.message); }
}

// ─── SUCURSALES ──────────────────────────────────────────────────────────────
let branches_cache = [];
let editingBranch = null;

async function renderBranches() {
  try { branches_cache = await GET('/sucursales'); } catch(e) {}
  document.getElementById('branches-count').textContent = branches_cache.length + ' sucursales';
  document.getElementById('branches-cards').innerHTML = branches_cache.map(b => `
    <div class="client-card">
      <div class="client-card-header">
        <div class="client-avatar">${b.nombre[0]}</div>
        <button class="action-btn edit" onclick="openBranchModal('${b.id}')">✏️</button>
      </div>
      <div class="client-name">${b.nombre}</div>
      ${b.rtn?`<div class="client-rtn">RTN: ${b.rtn}</div>`:''}
      ${b.direccion?`<div class="client-info">${b.direccion}</div>`:''}
      ${b.cai?`<div class="client-info" style="font-family:monospace;font-size:10px">CAI: ${b.cai.substring(0,20)}...</div>`:''}
    </div>
  `).join('');
}

function openBranchModal(id) {
  const b = id ? branches_cache.find(x => x.id === id) : null;
  editingBranch = b;
  document.getElementById('branch-modal-title').textContent = b ? 'Editar Sucursal' : 'Nueva Sucursal';
  ['nombre','rtn','telefono','direccion','cai'].forEach(k => document.getElementById('br-'+k).value = b?.[k]||'');
  document.getElementById('br-serie').value = b?.serie||'';
  document.getElementById('br-rango-ini').value = b?.rango_ini||'';
  document.getElementById('br-rango-fin').value = b?.rango_fin||'';
  document.getElementById('br-fecha-limite').value = b?.fecha_limite||'';
  // Mostrar botón Eliminar solo cuando se edita (no en nueva sucursal)
  const btnDel = document.getElementById('branch-modal-delete');
  if (btnDel) btnDel.style.display = b ? 'inline-block' : 'none';
  openModal('branch-modal');
}

async function saveBranch(e) {
  e.preventDefault();
  const data = {
    nombre: document.getElementById('br-nombre').value,
    rtn: document.getElementById('br-rtn').value,
    telefono: document.getElementById('br-telefono').value,
    direccion: document.getElementById('br-direccion').value,
    cai: document.getElementById('br-cai').value,
    serie: document.getElementById('br-serie').value,
    rango_ini: document.getElementById('br-rango-ini').value,
    rango_fin: document.getElementById('br-rango-fin').value,
    fecha_limite: document.getElementById('br-fecha-limite').value,
  };
  try {
    if(editingBranch) await PUT('/sucursales/'+editingBranch.id, data);
    else await POST('/sucursales', data);
    closeModal('branch-modal'); renderBranches();
  } catch(e) { alert(e.message); }
}

// ─── SYNC ────────────────────────────────────────────────────────────────────
async function loadSync() {
  try {
    const r = await GET('/sync/estado');
    document.getElementById('sync-status').innerHTML = `
      <div style="margin-bottom:12px"><strong>Estado de Sincronización</strong></div>
      <div style="font-size:13px;margin-bottom:8px">Registros pendientes de sincronizar: <strong style="color:${r.pendientes>0?'#f59e0b':'#16a34a'}">${r.pendientes}</strong></div>
      <div style="font-size:12px;color:#64748b">Sucursales activas: ${(r.sucursales||[]).map(s=>s.nombre).join(', ')}</div>
    `;
  } catch(e) { document.getElementById('sync-status').innerHTML = '<div style="color:#dc2626">Error al cargar estado de sincronización</div>'; }
}

// ─── CONFIG ──────────────────────────────────────────────────────────────────
async function renderConfig() {
  const b = BRANCH || {};
  document.getElementById('cfg-nombre').value = b.nombre||'';
  document.getElementById('cfg-rtn').value = b.rtn||'';
  document.getElementById('cfg-telefono').value = b.telefono||'';
  document.getElementById('cfg-direccion').value = b.direccion||'';
  document.getElementById('cfg-cai').value = b.cai||'';
  document.getElementById('cfg-serie').value = b.serie||'';
  document.getElementById('cfg-rango-ini').value = b.rango_ini||'';
  document.getElementById('cfg-rango-fin').value = b.rango_fin||'';
  document.getElementById('cfg-fecha-limite').value = b.fecha_limite||'';
  // Mostrar preview del logo actual si existe
  const preview = document.getElementById('cfg-logo-preview');
  const clearBtn = document.getElementById('cfg-logo-clear');
  const emptyTxt = document.getElementById('cfg-logo-empty-txt');
  if (preview) {
    if (b.logo) {
      preview.src = b.logo;
      preview.style.display = 'block';
      if (clearBtn) clearBtn.style.display = 'inline-block';
      if (emptyTxt) emptyTxt.style.display = 'none';
    } else {
      preview.style.display = 'none';
      if (clearBtn) clearBtn.style.display = 'none';
      if (emptyTxt) emptyTxt.style.display = 'block';
    }
  }
  // Reset: al entrar a config se considera que no hay cambio pendiente aún
  _cfgLogoBase64 = undefined;
}

async function saveConfig(e) {
  e.preventDefault();
  // Leer logo del estado en memoria (se actualiza al seleccionar archivo)
  const logoData = typeof _cfgLogoBase64 !== 'undefined' ? _cfgLogoBase64 : (BRANCH?.logo || null);
  const data = {
    nombre: document.getElementById('cfg-nombre').value,
    rtn: document.getElementById('cfg-rtn').value,
    telefono: document.getElementById('cfg-telefono').value,
    direccion: document.getElementById('cfg-direccion').value,
    cai: document.getElementById('cfg-cai').value,
    serie: document.getElementById('cfg-serie').value,
    rango_ini: document.getElementById('cfg-rango-ini').value,
    rango_fin: document.getElementById('cfg-rango-fin').value,
    fecha_limite: document.getElementById('cfg-fecha-limite').value,
    logo: logoData,
  };
  try {
    await PUT('/sucursales/' + USER.sucursal_id, data);
    BRANCH = { ...BRANCH, ...data };
    localStorage.setItem('mp_branch', JSON.stringify(BRANCH));
    document.getElementById('top-branch').textContent = BRANCH.nombre;
    document.getElementById('company-name-footer').textContent = BRANCH.nombre;
    // Actualizar logo del sidebar si existe
    const sidebarLogo = document.getElementById('sidebar-logo-img');
    if (sidebarLogo && BRANCH.logo) sidebarLogo.src = BRANCH.logo;
    toast('config-toast');
  } catch(e) { alert(e.message); }
}

// ── Logo handler para Configuración ─────────────────────────────────────────
let _cfgLogoBase64 = undefined; // undefined = no cambiado, null = borrado

/** Procesa el archivo seleccionado y muestra preview */
function cfgLogoFileChange(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 500 * 1024) { alert('⚠️ El logo no debe superar 500 KB.'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = function(ev) {
    _cfgLogoBase64 = ev.target.result; // base64 data URL
    const preview  = document.getElementById('cfg-logo-preview');
    const clearBtn = document.getElementById('cfg-logo-clear');
    const emptyTxt = document.getElementById('cfg-logo-empty-txt');
    if (preview)  { preview.src = _cfgLogoBase64; preview.style.display = 'block'; }
    if (clearBtn) clearBtn.style.display = 'inline-block';
    if (emptyTxt) emptyTxt.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

/** Elimina el logo */
function cfgLogoClear() {
  _cfgLogoBase64 = null;
  const preview   = document.getElementById('cfg-logo-preview');
  const clearBtn  = document.getElementById('cfg-logo-clear');
  const fileInput = document.getElementById('cfg-logo-file');
  const emptyTxt  = document.getElementById('cfg-logo-empty-txt');
  if (preview)   { preview.src = ''; preview.style.display = 'none'; }
  if (clearBtn)  clearBtn.style.display = 'none';
  if (fileInput) fileInput.value = '';
  if (emptyTxt)  emptyTxt.style.display = 'block';
}

// ─── IMPRESIÓN FACTURAS ──────────────────────────────────────────────────────
function printInvoice(sale) { _pendingSale = sale; openModal('print-modal'); }
function closePrintModal() { closeModal('print-modal'); _pendingSale = null; }

function doPrint(format) {
  closeModal('print-modal');
  const sale = _pendingSale; if(!sale) return;
  _pendingSale = null;
  if(format==='carta') printCarta(sale); else printTicket(sale);
}

function printCarta(sale) {
  const b = BRANCH || {};
  const logoSrc = b.logo || '';
  const fecha = new Date(sale.fecha);
  const fechaStr = fecha.toLocaleDateString('es-HN',{day:'2-digit',month:'2-digit',year:'numeric'});

  // Datos aduaneros — vienen dentro del objeto sale (pasados desde processFacInvoice)
  const poliza        = sale.aduanaPoliza        || '';
  const docTransporte = sale.aduanaDocTransporte || '';
  const valorCIF      = sale.aduanaValorCIF      || '';
  const numContenedor = sale.aduanaNumContenedor || '';

  // Tabla de ítems con columna % ISV
  // Calcular importeExento real = suma de ítems NO gravados (ISV 0%)
  let importeExentoCalc = 0;
  const itemsHTML = sale.items.map(i => {
    const esGravado = !(i.gravado === 0 || i.gravado === false);
    const tasaReal  = i.tasaIsv || 15;
    const isv_pct   = esGravado ? tasaReal.toFixed(2)+'%' : '0.00%';
    const totalItem = (i.precio||0) * (i.cantidad||1);
    if (!esGravado) importeExentoCalc += totalItem;
    return `<tr>
      <td style="border:1px solid #ccc;padding:6px 8px;text-align:center">${i.cantidad}</td>
      <td style="border:1px solid #ccc;padding:6px 8px">${i.nombre}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;text-align:center">${isv_pct}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;text-align:right">L. ${(i.precio||0).toFixed(2)}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;text-align:right">L. ${totalItem.toFixed(2)}</td>
    </tr>`;
  }).join('');

  // Montos del resumen SAR
  // importeExento: ítems no gravados (calculado arriba) O si es exonerado, el total
  const importeExento    = sale.exonerado ? (sale.total||0) : importeExentoCalc;
  const importeExonerado = sale.exonerado ? importeExento : 0;
  const importeGravado   = sale.importeGravado  || 0;
  const isv15            = sale.isv             || 0;
  const isv18            = sale.isv18           || 0;
  const descuento        = sale.descuento        || 0;
  const total            = sale.total            || 0;
  const ordenCompra      = sale.ordenCompraExenta      || '';
  const constancia       = sale.constanciaRegistro     || '';
  const sag              = sale.identificativoSAG      || '';

  openPrint(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Factura Aduanera ${sale.numero_factura}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
body{font-size:12px;padding:16px;background:#fff}
@media print{@page{size:letter portrait;margin:8mm}body{padding:0}}
.iw{max-width:740px;margin:0 auto;border:1px solid #aaa}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding:14px 18px 12px;border-bottom:2px solid #333}
.hdr-left{display:flex;align-items:flex-start;gap:14px}
.co-name{font-size:15px;font-weight:700;color:#1a1a1a}
.co-sub{font-size:10px;color:#444;margin-top:2px}
.badge-title{font-size:24px;font-weight:700;letter-spacing:2px;color:#1a1a1a;text-align:center}
.badge-num{font-size:12px;font-family:monospace;background:#1e3a5f;color:#fff;padding:3px 12px;border-radius:4px;display:inline-block;margin-top:4px;font-weight:700}
.client-row{padding:10px 18px;background:#f8fafc;border-bottom:1px solid #ddd;display:flex;flex-wrap:wrap;gap:10px 24px}
.cl-label{font-size:9px;font-weight:700;text-transform:uppercase;color:#666;letter-spacing:.5px}
.cl-val{font-size:12px;border-bottom:1px solid #999;padding-bottom:1px;min-width:120px;display:inline-block}
.intro{padding:7px 18px;font-size:11px;border-bottom:1px solid #ddd;color:#333}
.poliza-row{padding:8px 18px;border-bottom:1px solid #ddd;font-size:11px;display:flex;gap:24px;flex-wrap:wrap}
.p-label{font-weight:700;color:#444}
.p-val{border-bottom:1px solid #999;min-width:60px;display:inline-block;padding-bottom:1px}
.items-table{width:100%;border-collapse:collapse}
.items-table thead th{background:#1e3a5f;color:#fff;padding:7px 8px;font-size:11px;text-transform:uppercase;border:1px solid #1e3a5f}
.items-table thead th.r{text-align:right}.items-table thead th.c{text-align:center}
.items-table tbody tr:nth-child(even){background:#f8fafc}
.totals-wrapper{display:flex;justify-content:space-between;align-items:flex-end;padding:12px 18px;border-top:2px solid #333;gap:20px}
.exo-section{flex:1;font-size:11px;display:flex;flex-direction:column;gap:5px}
.exo-line{display:flex;gap:6px;align-items:baseline}
.exo-field{border-bottom:1px solid #999;flex:1;min-width:80px;font-weight:600}
.tt{width:240px;flex-shrink:0;border-collapse:collapse}
.tt td{padding:3px 0;font-size:12px;border:none}
.tt td:last-child{text-align:right;font-weight:600}
.tt .gran td{font-size:15px;font-weight:700;color:#1e3a5f;border-top:2px solid #1e3a5f;padding-top:5px}
.words{padding:8px 18px;border-top:1px solid #ddd;font-size:11px}
.sar{padding:10px 18px;background:#f8fafc;border-top:1px solid #ddd;font-size:10px;color:#444;line-height:1.9}
.cai-val{font-family:monospace;font-weight:700;font-size:11px;color:#1a1a1a}
.copies{margin-top:6px;font-weight:700;font-size:11px;text-align:center}
.exija{margin-top:3px;font-size:11px;font-weight:700;text-align:center}
</style></head><body><div class="iw">
<div class="hdr">
  <div class="hdr-left">
    ${logoSrc?`<img src="${logoSrc}" style="max-height:70px;max-width:120px;object-fit:contain;margin-right:8px"/>`:``}
    <div>
      <div class="co-name">${b.nombre||'AGENCIA ADUANERA'}</div>
      <div class="co-sub">RTN: ${b.rtn||''}</div>
      <div class="co-sub">${b.direccion||''}</div>
      ${b.telefono?`<div class="co-sub">TEL. ${b.telefono}</div>`:''}
    </div>
  </div>
  <div style="text-align:center;min-width:150px">
    <div class="badge-title">Factura</div>
    <div class="badge-num">${sale.numero_factura}</div>
  </div>
</div>
<div class="client-row">
  <div><div class="cl-label">Señores:</div><div class="cl-val">${sale.cliente?.nombre||'—'}</div></div>
  <div><div class="cl-label">Fecha</div><div class="cl-val">${fechaStr}</div></div>
  <div><div class="cl-label">R.T.N.:</div><div class="cl-val">${sale.cliente?.rtn||'—'}</div></div>
</div>
<div class="intro">Hemos Cargado a su apreciable cuenta por registro, peso, trámite, despacho, y pago de impuesto de:</div>
<div class="poliza-row">
  <div><span class="p-label">Número de Póliza:</span> <span class="p-val">${poliza}</span></div>
  <div><span class="p-label">Documento de Transporte:</span> <span class="p-val">${docTransporte}</span></div>
  <div><span class="p-label">Valor C.I.F:</span> <span class="p-val">${valorCIF}</span></div>
  <div><span class="p-label">Número de Contenedor:</span> <span class="p-val">${numContenedor}</span></div>
</div>
<table class="items-table">
<thead><tr>
  <th class="c" style="width:58px">Cantidad</th>
  <th>Nombre del Servicio</th>
  <th class="c" style="width:55px">% ISV</th>
  <th class="r" style="width:95px">Precio Unitario</th>
  <th class="r" style="width:95px">Total neto</th>
</tr></thead>
<tbody>${itemsHTML}</tbody>
</table>
<div class="totals-wrapper">
  <div class="exo-section">
    <div class="exo-line"><span style="font-weight:700;white-space:nowrap">No Orden de Compra Exenta:</span><span class="exo-field">${ordenCompra}</span></div>
    <div class="exo-line"><span style="font-weight:700;white-space:nowrap">No Constancia de Registro Exonerados:</span><span class="exo-field">${constancia}</span></div>
    <div class="exo-line"><span style="font-weight:700;white-space:nowrap">No Registro SAG:</span><span class="exo-field">${sag}</span></div>
  </div>
  <table class="tt">
    <tr><td colspan="2" style="text-align:right;font-size:10px;font-weight:700;color:#555;padding-bottom:4px">Monto en Lempiras (L.)</td></tr>
    <tr><td>Importe Exento</td><td>${importeExento.toFixed(2)}</td></tr>
    <tr><td>Importe Exonerado</td><td>${importeExonerado.toFixed(2)}</td></tr>
    <tr><td>Desc. / Rebajas</td><td>${descuento.toFixed(2)}</td></tr>
    <tr><td>Importe Gravado 15%</td><td>${importeGravado.toFixed(2)}</td></tr>
    <tr><td>Importe Gravado 18%</td><td>0.00</td></tr>
    <tr><td>ISV 15%</td><td>${isv15.toFixed(2)}</td></tr>
    <tr><td>ISV 18%</td><td>${isv18.toFixed(2)}</td></tr>
    <tr class="gran"><td>Total a Pagar</td><td>${total.toFixed(2)}</td></tr>
  </table>
</div>
<div class="words"><strong>Son: L</strong> ${moneyToWords(total)}</div>
<div class="sar">
  <div><strong>C.A.I.:</strong> <span class="cai-val">${sale.serieCai || b.cai || ''}</span></div>
  <div>Rango Autorizado ${sale.serieRangoIni || b.rango_ini || ''} a la ${sale.serieRangoFin || b.rango_fin || ''}</div>
  <div>Fecha Límite de Emisión <strong>${fD(sale.serieFechaLimite || b.fecha_limite || '')}</strong></div>
  <div class="copies">ORIGINAL: CLIENTE &nbsp;&nbsp;&nbsp; COPIA: OBLIGADO TRIBUTARIO EMISOR</div>
  <div class="exija">La Factura es Beneficio de Todos EXÍJALA!!!</div>
</div>
</div></body></html>`, "Factura Aduanera");
}



function printTicket(sale) {
  const b = BRANCH || {};
  const fecha = new Date(sale.fecha);
  const fechaStr = fecha.toLocaleDateString('es-HN',{day:'2-digit',month:'2-digit',year:'numeric'});
  const horaStr = fecha.toLocaleTimeString('es-HN',{hour:'2-digit',minute:'2-digit'});
  const itemsRows = sale.items.map(i => {
    const name = (i.nombre||'').length > 18 ? (i.nombre||'').substring(0,18)+'.' : (i.nombre||'');
    return `<tr><td colspan="2" style="padding:2px 0;font-size:11px">${name}</td></tr>
    <tr><td style="padding:0 0 4px;font-size:11px;color:#555">${i.cantidad} x L.${(i.precio||0).toFixed(2)}</td>
    <td style="padding:0 0 4px;font-size:11px;text-align:right;font-weight:600">L.${((i.precio||0)*(i.cantidad||0)).toFixed(2)}</td></tr>`;
  }).join('');
  const sep = `<tr><td colspan="2"><div style="border-top:1px dashed #999;margin:6px 0"></div></td></tr>`;
  const logoSrc = b.logo || '';
  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ticket ${sale.numero_factura}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;width:68mm;max-width:68mm;padding:1.5mm 1mm}
@media print{
  @page{size:76mm auto;margin:0}
  body{padding:1mm;width:68mm;max-width:68mm;font-size:11px}
  html,body{width:68mm}
}
.c{text-align:center}.b{font-weight:700}
.sep{border-top:1px dashed #666;margin:4px 0}
table{width:100%;border-collapse:collapse;table-layout:fixed}
td{vertical-align:top;padding:1px 0;overflow:hidden}
.total-line td{font-size:13px;font-weight:700;padding-top:4px}
</style></head><body>
${logoSrc?`<div style="text-align:center;margin-bottom:6px"><img src="${logoSrc}" style="max-width:60mm;max-height:20mm;object-fit:contain"/></div>`:''}
<div class="c b" style="font-size:12px">${b.nombre||'METRIC POS'}</div>
<div class="c" style="font-size:10px">RTN: ${b.rtn||''}</div>
<div class="c" style="font-size:10px">${b.direccion||''}</div>
<div class="c" style="font-size:10px">Tel: ${b.telefono||''}</div>
<div class="sep"></div>
<div class="c b" style="font-size:13px">FACTURA</div>
<div class="c" style="font-family:monospace;font-size:11px">${sale.numero_factura}</div>
<div class="c" style="font-size:10px">${fechaStr} ${horaStr}</div>
<div class="sep"></div>
<div style="font-size:11px"><span class="b">Cliente:</span> ${sale.cliente?.nombre||'—'}</div>
${sale.cliente?.rtn?`<div style="font-size:11px"><span class="b">RTN:</span> ${sale.cliente.rtn}</div>`:''}
<div class="sep"></div>
<table>${itemsRows}${sep}
<tr><td style="font-size:11px">Total Neto</td><td style="font-size:11px;text-align:right">L. ${((sale.subtotal||0)-(sale.isv||0)-(sale.isv18||0)).toFixed(2)}</td></tr>
${(sale.descuento||0)>0?`<tr><td style="font-size:11px">Desc. y Rebajas</td><td style="font-size:11px;text-align:right">-L. ${(sale.descuento||0).toFixed(2)}</td></tr>`:''}
<tr><td style="font-size:11px">Imp. Gravado</td><td style="font-size:11px;text-align:right">L. ${(sale.importeGravado||0).toFixed(2)}</td></tr>
<tr><td style="font-size:11px">Imp. Exento</td><td style="font-size:11px;text-align:right">L. ${(sale.importeExento||0).toFixed(2)}</td></tr>
<tr><td style="font-size:11px">Imp. Exonerado</td><td style="font-size:11px;text-align:right">L. ${(sale.exonerado?(sale.importeExento||0):0).toFixed(2)}</td></tr>
${(sale.isv||0)>0?`<tr><td style="font-size:11px">ISV 15%</td><td style="font-size:11px;text-align:right">L. ${(sale.isv||0).toFixed(2)}</td></tr>`:''}
${(sale.isv18||0)>0?`<tr><td style="font-size:11px">ISV 18%</td><td style="font-size:11px;text-align:right">L. ${(sale.isv18||0).toFixed(2)}</td></tr>`:''}
${sep}
<tr class="total-line"><td>TOTAL</td><td style="text-align:right">L. ${(sale.total||0).toFixed(2)}</td></tr>
${sep}
<tr><td style="font-size:10px">F. Pago</td><td style="font-size:10px;text-align:right">${sale.formaPago==='efectivo'?'Efectivo':sale.formaPago==='tarjeta'?'Tarjeta':sale.formaPago==='credito'?'Crédito':'Transferencia'}</td></tr>
${sale.formaPago==='efectivo'&&(sale.montoRecibido||0)>0?`<tr><td style="font-size:10px">Recibido</td><td style="font-size:10px;text-align:right">L. ${(sale.montoRecibido||0).toFixed(2)}</td></tr><tr><td style="font-size:10px;font-weight:700">Cambio</td><td style="font-size:10px;text-align:right;font-weight:700">L. ${(sale.cambio||0).toFixed(2)}</td></tr>`:''}
</table>
<div style="font-size:10px;text-align:center">${moneyToWords(sale.total||0)}</div>
<div class="sep"></div>
<div style="font-size:10px">CAI: ${b.cai||''}</div>
<div style="font-size:10px">Rango: ${b.rango_ini||''}</div>
<div style="font-size:10px">     AL ${b.rango_fin||''}</div>
<div style="font-size:10px">F.Limite: ${fD(b.fecha_limite||'')}</div>
<div class="sep"></div>
<div class="c" style="font-size:10px">Copia Cliente / Copia Emisor</div>
<div class="c b" style="font-size:10px;margin-top:4px">Powered by Metric POS</div>
<div style="height:10mm"></div></body></html>`, "Ticket de Venta");
}



// ─── FACTURACIÓN NORMAL ───────────────────────────────────────────────────────
// Estado independiente del POS
let facCart = [];
let facDiscount = 0;
let facDiscountType = 'porcentaje';
let facExonerado = false;
let facFormaPago = 'efectivo';
let facMontoRecibido = 0;
let facSelClientId = null;
let facOrdenCompra = '';
let facSeriesCache = []; // Cache de series tipo factura con su CAI/rango propios
let facConstancia = '';
let facSAG = '';

// ─── DATOS ADUANEROS — campos adicionales para factura de aduana ──────────────
let facAduanaPoliza = '';
let facAduanaDocTransporte = '';
let facAduanaValorCIF = '';
let facAduanaNumContenedor = '';

/** Abre el modal de datos aduaneros al entrar al módulo de facturación */
function abrirAduanaModal() {
  // Pre-llenar con valores previos si los hay
  document.getElementById('aduana-poliza').value        = facAduanaPoliza;
  document.getElementById('aduana-doc-transporte').value = facAduanaDocTransporte;
  document.getElementById('aduana-valor-cif').value     = facAduanaValorCIF;
  document.getElementById('aduana-num-contenedor').value = facAduanaNumContenedor;
  const m = document.getElementById('aduana-modal');
  m.style.display = 'flex';
}
function cerrarAduanaModal() {
  document.getElementById('aduana-modal').style.display = 'none';
}
function confirmarAduanaModal() {
  facAduanaPoliza         = (document.getElementById('aduana-poliza').value        || '').trim();
  facAduanaDocTransporte  = (document.getElementById('aduana-doc-transporte').value || '').trim();
  facAduanaValorCIF       = (document.getElementById('aduana-valor-cif').value     || '').trim();
  facAduanaNumContenedor  = (document.getElementById('aduana-num-contenedor').value || '').trim();
  cerrarAduanaModal();
}

async function renderFacturacion() {
  try {
    [products_cache, clients_cache, impuestos_cache] = await Promise.all([
      GET('/productos', `sucursal_id=${USER.sucursal_id}`),
      GET('/clientes'),
      GET('/impuestos').catch(() => []),
    ]);
  } catch(e) { products_cache = []; clients_cache = []; }

  // ── Cargar y poblar selector de SERIES ─────────────────────────────────────
  const seriesSel = document.getElementById('fac-serie-id');
  if (seriesSel) {
    try {
      const series = await GET("/series_factura", `sucursal_id=${USER.sucursal_id}&tipo=factura`);
      facSeriesCache = series || [];
      if (series && series.length > 0) {
        seriesSel.innerHTML = series.map(s =>
          `<option value="${s.id}">${s.nombre || s.serie} — ${s.serie}</option>`
        ).join('');
        seriesSel.style.display = 'block';
      } else {
        // No hay series configuradas — ocultar el selector
        seriesSel.innerHTML = '<option value="">— Sin series configuradas —</option>';
        seriesSel.style.display = 'none';
        seriesSel.previousElementSibling && (seriesSel.previousElementSibling.style.display = 'none');
      }
    } catch(e) {
      facSeriesCache = [];
      seriesSel.innerHTML = '<option value="">— Serie por defecto —</option>';
    }
  }

  // Poblar selector de categorías
  const catSel = document.getElementById('fac-cat-filter');
  if (catSel) {
    const cats = [...new Set(products_cache.map(p => p.categoria).filter(Boolean))].sort();
    catSel.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option value="${c}">${c}</option>`).join('');
    catSel.onchange = renderFacProductGrid;
  }

  renderFacProductGrid();
  renderFacClientSelect();
  renderFacCart();

  const search = document.getElementById('fac-search');
  if (search) {
    search.oninput = renderFacProductGrid;
    search.value = '';
  }
  _on('fac-discount', 'input', e => { facDiscount = parseFloat(e.target.value)||0; renderFacCart(); });
  _on('fac-discount-type', 'change', e => { facDiscountType = e.target.value; renderFacCart(); });
  _on('fac-exonerado', 'change', e => { facExonerado = e.target.checked; renderFacCart(); });
  _on('fac-orden-compra', 'input', e => { facOrdenCompra = e.target.value; });
  _on('fac-constancia', 'input', e => { facConstancia = e.target.value; });
  _on('fac-sag', 'input', e => { facSAG = e.target.value; });
  _on('fac-client', 'change', e => { facSelClientId = e.target.value; renderFacClientSelect(); });
  _on('fac-btn-invoice', 'click', processFacInvoice);

  // Abrir automáticamente el modal de Datos Aduaneros al ingresar al módulo
  setTimeout(() => abrirAduanaModal(), 100);
}

function renderFacProductGrid() {
  const q   = (document.getElementById('fac-search')||{}).value?.toLowerCase()||'';
  const cat = (document.getElementById('fac-cat-filter')||{}).value||'';
  const grid = document.getElementById('fac-products-grid');
  const resBox = document.getElementById('fac-results-box');
  const resTbody = document.getElementById('fac-results-body');
  if (!grid) return;

  const esServicio = p => (p.categoria||'').toLowerCase() === 'servicios';

  let f = products_cache.filter(p =>
    (!q || p.nombre.toLowerCase().includes(q) ||
           p.codigo.toLowerCase().includes(q) ||
           (p.categoria||'').toLowerCase().includes(q)) &&
    (!cat || p.categoria === cat)
  );

  if (q || cat) {
    // Modo búsqueda: tabla de resultados
    if (resBox) resBox.style.display = 'block';
    grid.style.display = 'none';
    if (resTbody) {
      resTbody.innerHTML = f.length === 0
        ? `<tr><td colspan="7" style="text-align:center;padding:24px;color:#94a3b8;font-size:13px">Sin resultados para "<b>${q||cat}</b>"</td></tr>`
        : f.map(p => {
            const srv      = esServicio(p);
            const sinStock = !srv && (p.stock||0) <= 0;
            const isvTag   = !p.gravado || srv
              ? `<span style="background:#f0fdf4;color:#15803d;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">Exento</span>`
              : `<span style="background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">ISV 15%</span>`;
            const stkTag   = srv
              ? `<span style="color:#94a3b8;font-size:11px">Servicio</span>`
              : sinStock
                ? `<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">Sin stock</span>`
                : `<span style="background:#f0fdf4;color:#15803d;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">${p.stock} uds</span>`;
            return `<tr style="border-bottom:1px solid #f1f5f9" onmouseover="this.style.background='#f8faff'" onmouseout="this.style.background=''">
              <td style="padding:9px 12px;font-family:monospace;font-size:12px;color:#64748b">${p.codigo}</td>
              <td style="padding:9px 12px;font-weight:600;color:#1e3a5f;font-size:13px">${p.nombre}</td>
              <td style="padding:9px 12px;font-size:12px;color:#64748b">${p.categoria||'—'}</td>
              <td style="padding:9px 12px;text-align:right;font-weight:700;color:#2563eb;font-size:13px">L. ${(p.precio_venta||0).toFixed(2)}</td>
              <td style="padding:9px 12px;text-align:center">${isvTag}</td>
              <td style="padding:9px 12px;text-align:center">${stkTag}</td>
              <td style="padding:9px 12px;text-align:center">
                <button onclick="facAddToCartById('${p.id}')" 
                  style="padding:5px 14px;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;background:#2563eb;color:#fff;transition:background .15s">
                  + Agregar
                </button>
              </td>
            </tr>`;
          }).join('');
    }
  } else {
    // Sin búsqueda: grid de tarjetas
    if (resBox) resBox.style.display = 'none';
    grid.style.display = '';
    grid.innerHTML = f.map(p => {
      const srv      = esServicio(p);
      const sinStock = !srv && (p.stock||0) <= 0;
      const badge    = srv
        ? `<span class="badge" style="background:#eff6ff;color:#2563eb;font-size:10px">Servicio · Exento</span>`
        : sinStock
          ? `<span class="badge badge-red">Sin stock</span>`
          : `<span class="badge badge-gray">${p.stock} uds</span>`;
      return `<button class="product-card" onclick="facAddToCartById('${p.id}')"
        >
        <div class="prod-code">${p.codigo}</div>
        <div class="prod-name">${p.nombre}</div>
        <div class="prod-footer">
          <span class="prod-price">L. ${(p.precio_venta||0).toFixed(2)}</span>${badge}
        </div>
      </button>`;
    }).join('');
  }
}

function renderFacClientSelect() {
  const sel = document.getElementById('fac-client');
  if (!sel) return;
  sel.innerHTML = clients_cache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  if (!facSelClientId && clients_cache.length) facSelClientId = clients_cache[0].id;
  if (facSelClientId) sel.value = facSelClientId;
  const cl = clients_cache.find(c => c.id === facSelClientId);
  const rtnEl = document.getElementById('fac-client-rtn');
  if (rtnEl) rtnEl.textContent = cl?.rtn ? 'RTN: ' + cl.rtn : '';
}

function facUpdatePrecio(id, nuevoPrecio) {
  const i = facCart.findIndex(x => x.id === id);
  if (i >= 0) { facCart[i].precio = nuevoPrecio; renderFacCart(); }
}

function facAddToCartById(id) {
  const p = products_cache.find(x => x.id === id);
  if (p) facAddToCart(p);
}

function facAddToCart(p) {
  const enCarrito = facCart.find(i => i.id === p.id);
  const cantidadEnCarrito = enCarrito ? enCarrito.cantidad : 0;
  const esServ = (p.categoria||'').toLowerCase() === 'servicios';
  const stockDisponible = p.stock || 0;
  // Sin validación de stock — permite facturar sin existencia
  let tasaIsv = 0;
  let isv18Flag = false;
  // Servicios son siempre exentos de ISV
  if (p.gravado && !esServ) {
    const impActivo = (typeof impuestos_cache !== 'undefined' && impuestos_cache.length > 0)
      ? impuestos_cache.find(i => i.activo && (i.aplica_a === 'todos' || i.aplica_a === 'gravados'))
      : null;
    tasaIsv = impActivo ? impActivo.tasa : 15;
    isv18Flag = (tasaIsv === 18);
  }
  if (enCarrito) {
    enCarrito.cantidad++;
  } else {
    facCart.push({
      id: p.id, codigo: p.codigo, nombre: p.nombre,
      categoria: p.categoria, precio: p.precio_venta || 0,
      costo: p.costo || 0, cantidad: 1,
      gravado: esServ ? false : p.gravado,
      isv18: isv18Flag, tasaIsv,
      stockMax: 9999
    });
  }
  renderFacCart();
}

function facRemoveFromCart(id) { facCart = facCart.filter(i => i.id !== id); renderFacCart(); }

function facUpdateQty(id, qty) {
  if (qty <= 0) { facRemoveFromCart(id); return; }
  const item = facCart.find(i => i.id === id);
  facCart = facCart.map(i => i.id===id ? {...i, cantidad: qty} : i);
  renderFacCart();
}

function renderFacCart() {
  const cartEl = document.getElementById('fac-cart-items');
  if (!cartEl) return;
  if (facCart.length === 0) {
    cartEl.innerHTML = `<div class="cart-empty"><p>Carrito vacío</p></div>`;
  } else {
    cartEl.innerHTML = facCart.map(item => `
      <div class="cart-item">
        <div class="cart-item-header">
          <span class="cart-item-name">${item.nombre}</span>
          <button class="cart-item-remove" onclick="facRemoveFromCart('${item.id}')">✕</button>
        </div>
        <div class="cart-item-footer">
          <div class="qty-controls">
            <button class="qty-btn" onclick="facUpdateQty('${item.id}',${item.cantidad-1})">−</button>
            <span class="qty-num">${item.cantidad}</span>
            <button class="qty-btn" onclick="facUpdateQty('${item.id}',${item.cantidad+1})">+</button>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
            <div style="display:flex;align-items:center;gap:3px">
              <span style="font-size:10px;color:#94a3b8">L.</span>
              <input type="number" step="0.01" min="0"
                value="${item.precio.toFixed(2)}"
                onchange="facUpdatePrecio('${item.id}',parseFloat(this.value)||0)"
                style="width:68px;text-align:right;border:1px solid #e2e8f0;border-radius:5px;padding:2px 5px;font-size:12px;font-weight:700;color:#2563eb;outline:none">
            </div>
            <span class="cart-item-total">L. ${(item.precio*item.cantidad).toFixed(2)}</span>
          </div>
        </div>
      </div>
    `).join('');
  }

  // Subtotal = suma de precios base (sin ISV) de cada línea
  const subtotal = facCart.reduce((s,i) => s+i.precio*i.cantidad, 0);
  const discAmt = facDiscountType==='porcentaje' ? subtotal*(facDiscount/100) : facDiscount;
  const baseNetaConDesc = subtotal - discAmt;

  // El ISV se calcula SOBRE la base (precio_venta), no se extrae de un precio "todo incluido".
  // Ej: precio_venta = 500, ISV 15% = 500*0.15 = 75 → línea final = 575.
  let isv15 = 0, isv18 = 0, isvOtros = 0;
  if (!facExonerado) {
    facCart.forEach(item => {
      if (!item.gravado) return;
      const tasa = item.tasaIsv || 15;
      const base = item.precio * item.cantidad;
      const isvItem = base * (tasa / 100);
      if (tasa === 15) isv15 += isvItem;
      else if (tasa === 18) isv18 += isvItem;
      else isvOtros += isvItem;
    });
  }

  // Total Neto = la base ya descontada (sin ISV) — se muestra antes de sumar el ISV
  let rowsHTML = `<div class="total-row-item"><span>Total Neto</span><span>L. ${baseNetaConDesc.toFixed(2)}</span></div>`;
  if (discAmt > 0) rowsHTML += `<div class="total-row-item discount"><span>Descuento</span><span>-L. ${discAmt.toFixed(2)}</span></div>`;
  if (!facExonerado && isv15 > 0)   rowsHTML += `<div class="total-row-item"><span>ISV 15%</span><span>L. ${isv15.toFixed(2)}</span></div>`;
  if (!facExonerado && isv18 > 0)   rowsHTML += `<div class="total-row-item"><span>ISV 18%</span><span>L. ${isv18.toFixed(2)}</span></div>`;
  if (!facExonerado && isvOtros > 0) {
    const otras = [...new Set(facCart.filter(i=>i.gravado&&i.tasaIsv&&i.tasaIsv!==15&&i.tasaIsv!==18).map(i=>i.tasaIsv))];
    otras.forEach(t => {
      const sub = facCart.filter(i=>i.gravado&&i.tasaIsv===t).reduce((s,i)=>s+i.precio*i.cantidad,0);
      const isvT = sub - sub/(1+t/100);
      if (isvT > 0) rowsHTML += `<div class="total-row-item"><span>ISV ${t}%</span><span>L. ${isvT.toFixed(2)}</span></div>`;
    });
  }
  // Total final = base neta con descuento + todo el ISV calculado encima
  const totalConIsv = baseNetaConDesc + isv15 + isv18 + isvOtros;
  rowsHTML += `<div class="total-row-item grand-total"><span>Total</span><span>L. ${totalConIsv.toFixed(2)}</span></div>`;

  // Forma de pago
  rowsHTML += `<div style="margin-top:10px;border-top:1px solid #e2e8f0;padding-top:10px">
    <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">FORMA DE PAGO</div>
    <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <button type="button" onclick="setFacFormaPago('efectivo')" style="flex:1;padding:7px 4px;font-size:11px;font-weight:600;border-radius:8px;border:1px solid #e2e8f0;cursor:pointer;background:${facFormaPago==='efectivo'?'#2563eb':'#fff'};color:${facFormaPago==='efectivo'?'#fff':'#475569'}">💵 Efectivo</button>
      <button type="button" onclick="setFacFormaPago('tarjeta')" style="flex:1;padding:7px 4px;font-size:11px;font-weight:600;border-radius:8px;border:1px solid #e2e8f0;cursor:pointer;background:${facFormaPago==='tarjeta'?'#2563eb':'#fff'};color:${facFormaPago==='tarjeta'?'#fff':'#475569'}">💳 Tarjeta</button>
      <button type="button" onclick="setFacFormaPago('transferencia')" style="flex:1;padding:7px 4px;font-size:11px;font-weight:600;border-radius:8px;border:1px solid #e2e8f0;cursor:pointer;background:${facFormaPago==='transferencia'?'#2563eb':'#fff'};color:${facFormaPago==='transferencia'?'#fff':'#475569'}">🏦 Transfer.</button>
      <button type="button" onclick="setFacFormaPago('credito')" style="flex:1;padding:7px 4px;font-size:11px;font-weight:600;border-radius:8px;border:1px solid #e2e8f0;cursor:pointer;background:${facFormaPago==='credito'?'#dc2626':'#fff'};color:${facFormaPago==='credito'?'#fff':'#475569'}">📋 Crédito</button>
    </div>
    ${facFormaPago==='credito'?`<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:8px;font-size:11px;color:#dc2626;font-weight:600">⚠️ Se abrirá cuenta en Cuentas por Cobrar para el cliente seleccionado</div>`:''}
    ${(facFormaPago==='transferencia'||facFormaPago==='tarjeta')?`<div style="margin-top:4px"><label style="font-size:11px;font-weight:600;color:#64748b">🏦 Banco receptor</label><select id="fac-banco-sel" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:12px;outline:none;margin-top:4px;box-sizing:border-box"><option value="">— Seleccionar banco —</option>${fac_bancos_cache.map(b=>`<option value="${b.id}">${b.nombre}${b.numero_cuenta?' — '+b.numero_cuenta:''} (L. ${(b.saldo_actual||0).toFixed(2)})</option>`).join('')}</select></div>`:''}
    ${facFormaPago==='efectivo'?`<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
      <label style="font-size:11px;color:#64748b;white-space:nowrap">Recibido:</label>
      <input type="number" id="fac-monto-recibido" value="${facMontoRecibido||totalConIsv.toFixed(2)}" step="0.01" min="${totalConIsv.toFixed(2)}" onchange="calcFacCambio(${totalConIsv})" style="flex:1;border:1px solid #e2e8f0;border-radius:6px;padding:5px 8px;font-size:12px;outline:none">
    </div>
    <div style="font-size:12px;font-weight:700;color:#059669">Cambio: L. ${Math.max(0,(facMontoRecibido||totalConIsv)-totalConIsv).toFixed(2)}</div>`:''}
  </div>`;

  document.getElementById('fac-totals-rows').innerHTML = rowsHTML;
  const exFields = document.getElementById('fac-exonerado-fields');
  if (exFields) exFields.className = 'exonerado-fields' + (facExonerado ? ' visible' : '');
  document.getElementById('fac-btn-invoice').disabled = facCart.length === 0;
}

let fac_bancos_cache = [];
async function setFacFormaPago(fp) {
  facFormaPago = fp;
  if(fp!=='efectivo') facMontoRecibido=0;
  if(fp==='transferencia'||fp==='tarjeta') {
    try { fac_bancos_cache = await GET('/bancos'); } catch(e) { fac_bancos_cache=[]; }
  }
  renderFacCart();
}
function calcFacCambio(total) { facMontoRecibido = parseFloat(document.getElementById('fac-monto-recibido')?.value)||total; renderFacCart(); }

async function processFacInvoice() {
  if (facCart.length === 0) return;
  const cl = clients_cache.find(c => c.id === facSelClientId) || clients_cache[0];
  // Validar que crédito no se use con Consumidor Final
  if (facFormaPago === 'credito') {
    if (!facSelClientId || cl.nombre === 'Consumidor Final') {
      alert('⚠️ Para ventas a Crédito debe seleccionar un cliente registrado (no Consumidor Final).');
      return;
    }
  }
  const subtotal = facCart.reduce((s,i) => s+i.precio*i.cantidad, 0);
  const discAmt = facDiscountType==='porcentaje' ? subtotal*(facDiscount/100) : facDiscount;
  const baseNetaConDesc = subtotal - discAmt;

  // El ISV se suma SOBRE el precio_venta (base neta) — no se extrae de un precio "todo incluido"
  let isv15 = 0, isv18 = 0, importeGravado = 0;
  if (!facExonerado) {
    facCart.forEach(item => {
      if (!item.gravado) return;
      const tasa = item.tasaIsv || 15;
      const base = item.precio * item.cantidad;
      const isvItem = base * (tasa / 100);
      importeGravado += base;
      if (tasa === 18) isv18 += isvItem;
      else isv15 += isvItem;
    });
  }
  const totalConIsv = baseNetaConDesc + isv15 + isv18;
  const importeExento = facExonerado ? baseNetaConDesc : 0;
  const recibido = facFormaPago==='efectivo' ? (parseFloat(document.getElementById('fac-monto-recibido')?.value)||totalConIsv) : totalConIsv;
  const cambio = facFormaPago==='efectivo' ? Math.max(0, recibido - totalConIsv) : 0;
  const fac_banco_id = (facFormaPago==='transferencia'||facFormaPago==='tarjeta') ? (document.getElementById('fac-banco-sel')?.value||null) : null;
  if ((facFormaPago==='transferencia'||facFormaPago==='tarjeta') && !fac_banco_id) { alert('⚠️ Debe seleccionar un banco para el pago.'); return; }

  try {
    const facSerieId = (document.getElementById('fac-serie-id')?.value) || null;
    const r = await POST('/ventas', {
      cliente_id: cl.id,
      items: facCart.map(i => ({ id: i.id, codigo: i.codigo, nombre: i.nombre, categoria: i.categoria, precio: i.precio, cantidad: i.cantidad, gravado: i.gravado, tasaIsv: i.tasaIsv })),
      subtotal, descuento: discAmt,
      importe_gravado: importeGravado, importe_exento: importeExento, importe_exonerado: 0,
      isv15, isv18, total: totalConIsv, exonerado: facExonerado,
      forma_pago: facFormaPago, monto_recibido: recibido, cambio, banco_id: fac_banco_id,
      orden_compra_exenta: facOrdenCompra, constancia_registro: facConstancia, identificativo_sag: facSAG,
      turno_id: turnoActivoCajero?.id || null, serie_id: facSerieId,
      // Datos aduaneros — ahora se persisten en la venta para poder reimprimirlos luego
      aduana_poliza: facAduanaPoliza, aduana_doc_transporte: facAduanaDocTransporte,
      aduana_valor_cif: facAduanaValorCIF, aduana_num_contenedor: facAduanaNumContenedor
    });

    // Buscar los datos del CAI/rango de la serie de Factura seleccionada
    const facSerieDatos = facSeriesCache.find(s => s.id === facSerieId) || {};

    // Siempre imprime en carta
    const saleForPrint = {
      id: r.id, numero_factura: r.numero_factura, fecha: nowHN(),
      cliente: cl, items: facCart.map(i=>({...i})),
      subtotal, descuento: discAmt, importeGravado, importeExento,
      isv: isv15, isv18, total: totalConIsv, exonerado: facExonerado,
      formaPago: facFormaPago, montoRecibido: recibido, cambio,
      ordenCompraExenta: facOrdenCompra, constanciaRegistro: facConstancia, identificativoSAG: facSAG,
      // Datos aduaneros — se capturan ANTES del reset de variables
      aduanaPoliza:        facAduanaPoliza,
      aduanaDocTransporte: facAduanaDocTransporte,
      aduanaValorCIF:      facAduanaValorCIF,
      aduanaNumContenedor: facAduanaNumContenedor,
      // CAI/rango propios de la serie de Factura seleccionada
      serieCai:         facSerieDatos.cai          || '',
      serieRangoIni:    facSerieDatos.rango_ini     || '',
      serieRangoFin:    facSerieDatos.rango_fin      || '',
      serieFechaLimite: facSerieDatos.fecha_limite   || '',
    };
    printInvoice(saleForPrint);  // v7: ahora muestra selector de formato (ticket/carta)

    // Limpiar estado
    facCart = []; facDiscount = 0; facExonerado = false;
    facFormaPago = 'efectivo'; facMontoRecibido = 0;
    facOrdenCompra = ''; facConstancia = ''; facSAG = '';
    facAduanaPoliza = ''; facAduanaDocTransporte = ''; facAduanaValorCIF = ''; facAduanaNumContenedor = '';
    document.getElementById('fac-discount').value = '';
    document.getElementById('fac-exonerado').checked = false;
    renderFacCart();
    toast('fac-invoice-toast');
    products_cache = await GET('/productos', `sucursal_id=${USER.sucursal_id}`).catch(()=>products_cache);
    renderFacProductGrid();
  } catch(e) { alert('Error: ' + e.message); }
}

// ─── NOTAS DE DÉBITO ─────────────────────────────────────────────────────────
// Estado propio, independiente del módulo de Facturación
let ndCart = [];
let ndDiscount = 0;
let ndDiscountType = 'porcentaje';
let ndExonerado = false;
let ndFormaPago = 'efectivo';
let ndMontoRecibido = 0;
let ndSelClientId = null;
let ndOrdenCompra = '';
let ndConstancia = '';
let ndSAG = '';
let ndSeriesCache = []; // Cache de series tipo nota_debito con su CAI/rango propios

async function renderNotaDebito() {
  try {
    [products_cache, clients_cache, impuestos_cache] = await Promise.all([
      GET('/productos', `sucursal_id=${USER.sucursal_id}`),
      GET('/clientes'),
      GET('/impuestos').catch(() => []),
    ]);
  } catch(e) { products_cache = []; clients_cache = []; }

  // Cargar SOLO series tipo nota_debito
  const ndSerieSel = document.getElementById('nd-serie-id');
  if (ndSerieSel) {
    try {
      const series = await GET('/series_factura', `sucursal_id=${USER.sucursal_id}&tipo=nota_debito`);
      ndSeriesCache = series || [];
      if (series && series.length > 0) {
        ndSerieSel.innerHTML = series.map(s =>
          `<option value="${s.id}">${s.nombre || s.serie} — ${s.serie}</option>`
        ).join('');
        ndSerieSel.style.display = 'block';
      } else {
        ndSerieSel.innerHTML = '<option value="">— Configurar serie ND en Configuración —</option>';
      }
    } catch(e) {
      ndSeriesCache = [];
      ndSerieSel.innerHTML = '<option value="">— Serie por defecto —</option>';
    }
  }

  // Categorías
  const catSel = document.getElementById('nd-cat-filter');
  if (catSel) {
    const cats = [...new Set(products_cache.map(p => p.categoria).filter(Boolean))].sort();
    catSel.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option value="${c}">${c}</option>`).join('');
    catSel.onchange = ndRenderProductGrid;
  }

  ndRenderProductGrid();
  ndRenderClientSelect();
  ndRenderCart();

  const search = document.getElementById('nd-search');
  if (search) { search.oninput = ndRenderProductGrid; search.value = ''; }

  _on('nd-discount',      'input',  e => { ndDiscount = parseFloat(e.target.value)||0; ndRenderCart(); });
  _on('nd-discount-type', 'change', e => { ndDiscountType = e.target.value; ndRenderCart(); });
  _on('nd-exonerado',     'change', e => { ndExonerado = e.target.checked; ndRenderCart(); });
  _on('nd-orden-compra',  'input',  e => { ndOrdenCompra = e.target.value; });
  _on('nd-constancia',    'input',  e => { ndConstancia  = e.target.value; });
  _on('nd-sag',           'input',  e => { ndSAG         = e.target.value; });
  _on('nd-client',        'change', e => { ndSelClientId = e.target.value; ndRenderClientSelect(); });
  _on('nd-btn-invoice',   'click',  processNdInvoice);
}

function ndRenderProductGrid() {
  const q    = (document.getElementById('nd-search')?.value  || '').toLowerCase();
  const cat  = (document.getElementById('nd-cat-filter')?.value || '');
  let prods  = products_cache.filter(p =>
    (!q   || p.nombre?.toLowerCase().includes(q) || p.codigo?.toLowerCase().includes(q) || p.categoria?.toLowerCase().includes(q)) &&
    (!cat || p.categoria === cat)
  );

  const resultsBox  = document.getElementById('nd-results-box');
  const resultsBody = document.getElementById('nd-results-body');
  const grid        = document.getElementById('nd-products-grid');

  if (q && resultsBox && resultsBody) {
    resultsBox.style.display = 'block';
    resultsBody.innerHTML = prods.slice(0, 50).map(p => `
      <tr style="border-bottom:1px solid #f1f5f9;cursor:pointer" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''" onclick="ndAddToCart('${p.id}')">
        <td style="padding:8px 12px;font-size:12px;font-family:monospace">${p.codigo||'—'}</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#1e3a5f">${p.nombre}</td>
        <td style="padding:8px 12px;font-size:12px;color:#64748b">${p.categoria||'—'}</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:700;text-align:right">L. ${(p.precio_venta||0).toFixed(2)}</td>
        <td style="padding:8px 12px;text-align:center"><span style="font-size:11px;padding:2px 7px;border-radius:10px;background:${p.gravado?'#eff6ff':'#f0fdf4'};color:${p.gravado?'#2563eb':'#16a34a'}">${p.gravado?'15%':'0%'}</span></td>
        <td style="padding:8px 12px;text-align:center;font-size:12px">${p.stock||0}</td>
        <td style="padding:8px 12px;text-align:center"><button onclick="event.stopPropagation();ndAddToCart('${p.id}')" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;font-weight:600">+</button></td>
      </tr>`).join('');
  } else if (resultsBox) {
    resultsBox.style.display = 'none';
  }

  if (grid) {
    grid.innerHTML = prods.slice(0, 60).map(p => `
      <div onclick="ndAddToCart('${p.id}')" style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='#7c3aed';this.style.boxShadow='0 2px 8px rgba(124,58,237,.15)'" onmouseout="this.style.borderColor='#e2e8f0';this.style.boxShadow='none'">
        <div style="font-size:13px;font-weight:700;color:#1e3a5f;margin-bottom:4px;line-height:1.3">${p.nombre}</div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:8px">${p.categoria||''}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:14px;font-weight:800;color:#7c3aed">L. ${(p.precio_venta||0).toFixed(2)}</div>
          <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${p.gravado?'#eff6ff':'#f0fdf4'};color:${p.gravado?'#2563eb':'#16a34a'}">${p.gravado?'ISV 15%':'Exento'}</span>
        </div>
      </div>`).join('');
  }
}

function ndAddToCart(prodId) {
  const p = products_cache.find(x => x.id === prodId);
  if (!p) return;
  const existing = ndCart.find(x => x.id === prodId);
  if (existing) { existing.cantidad++; }
  else { ndCart.push({ id:p.id, codigo:p.codigo, nombre:p.nombre, categoria:p.categoria, precio:p.precio_venta||0, cantidad:1, gravado:p.gravado, tasaIsv:p.gravado?15:0 }); }
  ndRenderCart();
}

function ndUpdatePrecio(id, nuevoPrecio) {
  const i = ndCart.findIndex(x => x.id === id);
  if (i >= 0) { ndCart[i].precio = Math.max(0, nuevoPrecio); ndRenderCart(); }
}

function ndRemoveFromCart(id) { ndCart = ndCart.filter(i => i.id !== id); ndRenderCart(); }

function ndChangeQty(id, delta) {
  const i = ndCart.find(x => x.id === id);
  if (!i) return;
  i.cantidad = Math.max(1, i.cantidad + delta);
  ndRenderCart();
}

function ndRenderClientSelect() {
  const sel = document.getElementById('nd-client');
  if (!sel) return;
  sel.innerHTML = clients_cache.map(c => `<option value="${c.id}" ${c.id==ndSelClientId?'selected':''}>${c.nombre}</option>`).join('');
  const cl = clients_cache.find(c => c.id == (ndSelClientId || clients_cache[0]?.id));
  const rtnEl = document.getElementById('nd-client-rtn');
  if (rtnEl) rtnEl.textContent = cl?.rtn ? `RTN: ${cl.rtn}` : '';
}

function ndRenderCart() {
  const itemsEl   = document.getElementById('nd-cart-items');
  const totalsEl  = document.getElementById('nd-totals-rows');
  const btnInv    = document.getElementById('nd-btn-invoice');
  const exFields  = document.getElementById('nd-exonerado-fields');

  if (exFields) exFields.style.display = ndExonerado ? 'block' : 'none';

  if (!itemsEl) return;
  if (ndCart.length === 0) {
    itemsEl.innerHTML = '<div style="text-align:center;padding:24px;color:#94a3b8;font-size:13px">📋 Carrito vacío</div>';
    if (totalsEl) totalsEl.innerHTML = '';
    if (btnInv)   btnInv.disabled = true;
    return;
  }

  itemsEl.innerHTML = ndCart.map(i => `
    <div style="background:#faf8ff;border:1px solid #ede9fe;border-radius:8px;padding:8px 10px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
        <div style="font-size:12px;font-weight:600;color:#1e3a5f;flex:1;line-height:1.3">${i.nombre}</div>
        <button onclick="ndRemoveFromCart('${i.id}')" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:0;flex-shrink:0">✕</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
        <div style="display:flex;align-items:center;gap:6px">
          <button onclick="ndChangeQty('${i.id}',-1)" style="width:22px;height:22px;border:1px solid #ede9fe;border-radius:4px;background:#f5f3ff;cursor:pointer;font-size:13px;font-weight:700;color:#7c3aed;display:flex;align-items:center;justify-content:center">−</button>
          <span style="font-size:13px;font-weight:700;min-width:20px;text-align:center">${i.cantidad}</span>
          <button onclick="ndChangeQty('${i.id}',1)"  style="width:22px;height:22px;border:1px solid #ede9fe;border-radius:4px;background:#f5f3ff;cursor:pointer;font-size:13px;font-weight:700;color:#7c3aed;display:flex;align-items:center;justify-content:center">+</button>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
          <div style="display:flex;align-items:center;gap:3px">
            <span style="font-size:10px;color:#94a3b8">L.</span>
            <input type="number" step="0.01" min="0"
              value="${i.precio.toFixed(2)}"
              onchange="ndUpdatePrecio('${i.id}',parseFloat(this.value)||0)"
              style="width:68px;text-align:right;border:1px solid #ede9fe;border-radius:5px;padding:2px 5px;font-size:12px;font-weight:700;color:#7c3aed;outline:none">
          </div>
          <span style="font-size:13px;font-weight:700;color:#7c3aed">L. ${(i.precio*i.cantidad).toFixed(2)}</span>
        </div>
      </div>
    </div>`).join('');

  // Calcular totales (ISV se SUMA sobre el precio base, no se extrae hacia atrás)
  const subtotal = ndCart.reduce((s, i) => s + i.precio * i.cantidad, 0);
  let discAmt = ndDiscountType === 'porcentaje' ? subtotal * ndDiscount / 100 : ndDiscount;
  discAmt = Math.min(discAmt, subtotal);
  const baseNetaConDesc = subtotal - discAmt;

  let isv15 = 0, isv18 = 0, rowsHTML = '';
  if (!ndExonerado) {
    ndCart.forEach(item => {
      if (!item.gravado) return;
      const tasa = item.tasaIsv || 15;
      const base = item.precio * item.cantidad;
      const isvItem = base * (tasa / 100);
      if (tasa === 18) isv18 += isvItem;
      else isv15 += isvItem;
    });
  }
  const totalConIsv = baseNetaConDesc + isv15 + isv18;

  rowsHTML += `<div class="total-row-item"><span>Subtotal</span><span>L. ${subtotal.toFixed(2)}</span></div>`;
  if (discAmt > 0) rowsHTML += `<div class="total-row-item"><span>Descuento</span><span>-L. ${discAmt.toFixed(2)}</span></div>`;
  if (!ndExonerado && isv15 > 0) rowsHTML += `<div class="total-row-item"><span>ISV 15%</span><span>L. ${isv15.toFixed(2)}</span></div>`;
  if (!ndExonerado && isv18 > 0) rowsHTML += `<div class="total-row-item"><span>ISV 18%</span><span>L. ${isv18.toFixed(2)}</span></div>`;
  rowsHTML += `<div class="total-row-item total-final"><span>TOTAL</span><span>L. ${totalConIsv.toFixed(2)}</span></div>`;

  // Forma de pago
  rowsHTML += `
    <div style="margin:8px 0 4px;font-size:10px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.5px">Forma de Pago</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">
      ${['efectivo','tarjeta','transferencia','credito'].map(fp => `
        <button onclick="ndSetFormaPago('${fp}')" id="nd-fp-${fp}"
          style="flex:1;padding:6px 4px;font-size:10px;font-weight:600;border-radius:6px;border:${ndFormaPago===fp?'2px solid #7c3aed':'1px solid #e2e8f0'};cursor:pointer;background:${ndFormaPago===fp?'#7c3aed':'#fff'};color:${ndFormaPago===fp?'#fff':'#475569'}">
          ${fp==='efectivo'?'💵 Efectivo':fp==='tarjeta'?'💳 Tarjeta':fp==='transferencia'?'🏦 Transfer.':'📋 Crédito'}
        </button>`).join('')}
    </div>`;

  if (ndFormaPago === 'efectivo') {
    rowsHTML += `<input type="number" id="nd-monto-recibido" placeholder="Monto recibido" value="${ndMontoRecibido||''}" oninput="ndCalcCambio(${totalConIsv})" style="width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;font-size:12px;outline:none;box-sizing:border-box;margin-bottom:4px">`;
    const cambio = Math.max(0, (ndMontoRecibido||totalConIsv) - totalConIsv);
    if (cambio > 0) rowsHTML += `<div class="total-row-item" style="color:#059669"><span>Cambio</span><span>L. ${cambio.toFixed(2)}</span></div>`;
  }
  if (ndFormaPago === 'transferencia' || ndFormaPago === 'tarjeta') {
    rowsHTML += `<select id="nd-banco-sel" style="width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:6px 8px;font-size:12px;outline:none;margin-bottom:4px;box-sizing:border-box">
      <option value="">— Seleccionar banco —</option>
      ${(bancos_cache||[]).map(b=>`<option value="${b.id}">${b.nombre}</option>`).join('')}
    </select>`;
  }

  if (totalsEl) totalsEl.innerHTML = rowsHTML;
  if (btnInv)   btnInv.disabled = ndCart.length === 0;
}

function ndSetFormaPago(fp) { ndFormaPago = fp; ndMontoRecibido = 0; ndRenderCart(); }
function ndCalcCambio(total) { ndMontoRecibido = parseFloat(document.getElementById('nd-monto-recibido')?.value)||total; ndRenderCart(); }

async function processNdInvoice() {
  if (ndCart.length === 0) { alert('Agregá al menos un servicio.'); return; }
  const clId = document.getElementById('nd-client')?.value;
  const cl = clients_cache.find(c => c.id == clId);
  if (!cl) { alert('Seleccioná un cliente.'); return; }

  // Validar que haya una serie de ND seleccionada y que tenga CAI configurado
  const ndSerieIdCheck = document.getElementById('nd-serie-id')?.value || null;
  if (!ndSerieIdCheck) {
    alert('⚠️ No hay una serie de Nota de Débito seleccionada.\nVe a Configuración → Series de Nota de Débito y crea una con su CAI del SAR.');
    return;
  }
  const serieSeleccionada = ndSeriesCache.find(s => s.id === ndSerieIdCheck);
  if (!serieSeleccionada || !serieSeleccionada.cai) {
    alert('⚠️ La serie seleccionada no tiene CAI configurado.\nVe a Configuración → Series de Nota de Débito y completá el CAI, rango y fecha límite del SAR.');
    return;
  }

  const subtotal = ndCart.reduce((s, i) => s + i.precio * i.cantidad, 0);
  let discAmt = ndDiscountType === 'porcentaje' ? subtotal * ndDiscount / 100 : ndDiscount;
  discAmt = Math.min(discAmt, subtotal);
  const baseNetaConDesc = subtotal - discAmt;

  // El ISV se suma SOBRE el precio_venta (base neta) — no se extrae de un precio "todo incluido"
  let isv15 = 0, isv18 = 0, importeGravado = 0;
  if (!ndExonerado) {
    ndCart.forEach(item => {
      if (!item.gravado) return;
      const tasa = item.tasaIsv || 15;
      const base = item.precio * item.cantidad;
      const isvItem = base * (tasa / 100);
      importeGravado += base;
      if (tasa === 18) isv18 += isvItem;
      else isv15 += isvItem;
    });
  }
  const totalConIsv = baseNetaConDesc + isv15 + isv18;
  const importeExento = ndExonerado ? baseNetaConDesc : 0;
  const recibido = ndFormaPago === 'efectivo' ? (parseFloat(document.getElementById('nd-monto-recibido')?.value)||totalConIsv) : totalConIsv;
  const cambio = ndFormaPago === 'efectivo' ? Math.max(0, recibido - totalConIsv) : 0;
  const nd_banco_id = (ndFormaPago==='transferencia'||ndFormaPago==='tarjeta') ? (document.getElementById('nd-banco-sel')?.value||null) : null;
  if ((ndFormaPago==='transferencia'||ndFormaPago==='tarjeta') && !nd_banco_id) { alert('⚠️ Debe seleccionar un banco.'); return; }

  try {
    const ndSerieId = document.getElementById('nd-serie-id')?.value || null;
    const r = await POST('/ventas', {
      cliente_id: cl.id,
      items: ndCart.map(i => ({ id:i.id, codigo:i.codigo, nombre:i.nombre, categoria:i.categoria, precio:i.precio, cantidad:i.cantidad, gravado:i.gravado, tasaIsv:i.tasaIsv })),
      subtotal, descuento: discAmt,
      importe_gravado: importeGravado, importe_exento: importeExento, importe_exonerado: 0,
      isv15, isv18, total: totalConIsv, exonerado: ndExonerado,
      forma_pago: ndFormaPago, monto_recibido: recibido, cambio, banco_id: nd_banco_id,
      orden_compra_exenta: ndOrdenCompra, constancia_registro: ndConstancia, identificativo_sag: ndSAG,
      turno_id: turnoActivoCajero?.id || null, serie_id: ndSerieId
    });

    // Usar la serie ya validada arriba (serieSeleccionada) — evita una segunda
    // búsqueda que podría fallar por timing o por referencia de array distinta.
    const saleForPrint = {
      id: r.id, numero_factura: r.numero_factura, fecha: nowHN(),
      cliente: cl, items: ndCart.map(i=>({...i})),
      subtotal, descuento: discAmt, importeGravado, importeExento,
      isv: isv15, isv18, total: totalConIsv, exonerado: ndExonerado,
      formaPago: ndFormaPago, montoRecibido: recibido, cambio,
      ordenCompraExenta: ndOrdenCompra, constanciaRegistro: ndConstancia, identificativoSAG: ndSAG,
      // CAI/rango propios de la serie de Nota de Débito seleccionada
      serieCai:         serieSeleccionada.cai          || '',
      serieRangoIni:    serieSeleccionada.rango_ini     || '',
      serieRangoFin:    serieSeleccionada.rango_fin      || '',
      serieFechaLimite: serieSeleccionada.fecha_limite   || '',
    };

    printNotaDebito(saleForPrint);

    // Reset
    ndCart = []; ndDiscount = 0; ndExonerado = false;
    ndFormaPago = 'efectivo'; ndMontoRecibido = 0;
    ndOrdenCompra = ''; ndConstancia = ''; ndSAG = '';
    document.getElementById('nd-discount').value = '';
    document.getElementById('nd-exonerado').checked = false;
    ndRenderCart();
    toast('nd-invoice-toast');
    products_cache = await GET('/productos', `sucursal_id=${USER.sucursal_id}`).catch(()=>products_cache);
    ndRenderProductGrid();
  } catch(e) { alert('Error: ' + e.message); }
}

/** Imprime la Nota de Débito — igual que printCarta pero dice "Nota de Débito" */
function printNotaDebito(sale) {
  const b = BRANCH || {};
  const logoSrc = b.logo || '';
  const fecha = new Date(sale.fecha);
  const fechaStr = fecha.toLocaleDateString('es-HN',{day:'2-digit',month:'2-digit',year:'numeric'});

  let importeExentoCalc = 0;
  const itemsHTML = sale.items.map(i => {
    const esGravado = !(i.gravado === 0 || i.gravado === false);
    const tasaReal  = i.tasaIsv || 15;
    const isv_pct   = esGravado ? tasaReal.toFixed(2)+'%' : '0.00%';
    const totalItem = (i.precio||0) * (i.cantidad||1);
    if (!esGravado) importeExentoCalc += totalItem;
    return `<tr>
      <td style="padding:6px 10px;text-align:center;border-bottom:1px solid #eee">${i.cantidad}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${i.nombre}</td>
      <td style="padding:6px 10px;text-align:center;border-bottom:1px solid #eee">${isv_pct}</td>
      <td style="padding:6px 10px;text-align:right;border-bottom:1px solid #eee">${(i.precio||0).toFixed(2)}</td>
      <td style="padding:6px 10px;text-align:right;border-bottom:1px solid #eee">${totalItem.toFixed(2)}</td>
    </tr>`;
  }).join('');

  const importeExento    = sale.exonerado ? (sale.total||0) : importeExentoCalc;
  const importeExonerado = sale.exonerado ? importeExento : 0;
  const importeGravado   = sale.importeGravado  || 0;
  const isv15            = sale.isv             || 0;
  const isv18            = sale.isv18           || 0;
  const descuento        = sale.descuento        || 0;
  const total            = sale.total            || 0;
  const ordenCompra      = sale.ordenCompraExenta      || '';
  const constancia       = sale.constanciaRegistro     || '';
  const sag              = sale.identificativoSAG      || '';

  openPrint(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Nota de Débito ${sale.numero_factura}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
body{font-size:12px;padding:18px;background:#fff;color:#1a1a1a}
@media print{@page{size:letter portrait;margin:10mm}body{padding:0}}
.iw{max-width:780px;margin:0 auto}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #333;margin-bottom:14px}
.hdr-left{display:flex;align-items:flex-start;gap:14px}
.logo-circle{width:64px;height:64px;border-radius:50%;object-fit:cover;flex-shrink:0}
.co-name{font-size:15px;font-weight:700;color:#1a1a1a}
.co-sub{font-size:10.5px;color:#444;margin-top:2px;line-height:1.5}
.badge-title{font-size:24px;font-weight:800;letter-spacing:1px;color:#1a1a1a;text-align:right;white-space:nowrap}
.badge-num-row{text-align:right;margin-top:2px;font-size:11px;color:#444}
.badge-num{font-family:monospace;font-weight:700;font-size:12px;color:#222}
.client-row{display:flex;gap:32px;margin-bottom:12px;flex-wrap:wrap}
.cl-label{font-size:10px;font-weight:700;text-transform:uppercase;color:#555}
.cl-val{font-size:12px;color:#1a1a1a;margin-top:1px}
.items-table{width:100%;border-collapse:collapse;margin-bottom:18px}
.items-table thead th{border-bottom:2px solid #7c3aed;border-top:1px solid #7c3aed;padding:7px 10px;font-size:11px;font-weight:700;text-align:left;color:#1a1a1a;background:#f5f3ff}
.items-table thead th.r{text-align:right}.items-table thead th.c{text-align:center}
.totals-block{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:14px}
.exo-section{flex:1;font-size:11px;display:flex;flex-direction:column;gap:6px;align-self:flex-start}
.exo-line span.exo-lbl{font-weight:700}
.exo-field{border-bottom:1px solid #999;display:inline-block;min-width:140px}
.tt{border-collapse:collapse;min-width:260px}
.tt-title{text-align:right;font-size:10.5px;font-weight:700;color:#444;padding-bottom:4px}
.tt td{padding:2px 0;font-size:12px}
.tt td:first-child{padding-right:16px}
.tt td:last-child{text-align:right;font-weight:600}
.tt .gran{border-top:2px solid #7c3aed;margin-top:4px}
.tt .gran td{padding-top:6px;font-size:14px;font-weight:800;color:#7c3aed}
.words{font-size:11px;margin-bottom:16px}
.sar-block{font-size:11px;line-height:1.9;margin-bottom:4px}
.cai-val{font-family:monospace;font-weight:700;color:#1a1a1a}
.copies{margin-top:10px;font-weight:700;font-size:11px}
.exija{margin-top:6px;font-size:11.5px;font-weight:700}
</style></head><body><div class="iw">

<div class="hdr">
  <div class="hdr-left">
    ${logoSrc?`<img src="${logoSrc}" class="logo-circle"/>`:``}
    <div>
      <div class="co-name">${b.nombre||'AGENCIA ADUANERA'}</div>
      <div class="co-sub">RTN: ${b.rtn||''}<br>${b.direccion||''}<br>${b.telefono?`TEL. ${b.telefono}`:''}</div>
    </div>
  </div>
  <div>
    <div class="badge-title">NOTA DE DEBITO</div>
    <div class="badge-num-row">No&nbsp;&nbsp;<span class="badge-num">${sale.numero_factura}</span></div>
  </div>
</div>

<div class="client-row">
  <div><div class="cl-label">Cliente:</div><div class="cl-val">${sale.cliente?.nombre||'Consumidor Final'}</div></div>
  <div><div class="cl-label">Fecha</div><div class="cl-val">${fechaStr}</div></div>
  <div><div class="cl-label">R.T.N.:</div><div class="cl-val">${sale.cliente?.rtn||'—'}</div></div>
</div>

<table class="items-table">
<thead><tr>
  <th class="c" style="width:60px">Cantidad</th>
  <th>Nombre del Servicio</th>
  <th class="c" style="width:55px">% ISV</th>
  <th class="r" style="width:95px">Precio Unitario</th>
  <th class="r" style="width:95px">Total neto</th>
</tr></thead>
<tbody>${itemsHTML}</tbody>
</table>

<div class="totals-block">
  <div class="exo-section">
    <div class="exo-line"><span class="exo-lbl">No Orden de Compra Exenta:</span> <span class="exo-field">${ordenCompra}</span></div>
    <div class="exo-line"><span class="exo-lbl">No Constancia de Registro Exonerados:</span> <span class="exo-field">${constancia}</span></div>
    <div class="exo-line"><span class="exo-lbl">No Registro SAG:</span> <span class="exo-field">${sag}</span></div>
  </div>
  <table class="tt">
    <tr><td colspan="2" class="tt-title">Monto en Lempiras (L.)</td></tr>
    <tr><td>Importe Exento</td><td>${importeExento.toFixed(2)}</td></tr>
    <tr><td>Importe Exonerado</td><td>${importeExonerado.toFixed(2)}</td></tr>
    <tr><td>Desc. / Rebajas</td><td>${descuento.toFixed(2)}</td></tr>
    <tr><td>Importe Gravado 15%</td><td>${importeGravado.toFixed(2)}</td></tr>
    <tr><td>Importe Gravado 18%</td><td>0.00</td></tr>
    <tr><td>ISV 15%</td><td>${isv15.toFixed(2)}</td></tr>
    <tr><td>ISV 18%</td><td>${isv18.toFixed(2)}</td></tr>
    <tr class="gran"><td>Total a Pagar</td><td>L${total.toFixed(2)}</td></tr>
  </table>
</div>

<div class="words"><strong>Son: L</strong> ${moneyToWords(total)}</div>

<div class="sar-block">
  <div><strong>C.A.I.:</strong> <span class="cai-val">${sale.serieCai||''}</span></div>
  <div>Rango Autorizado <strong>${sale.serieRangoIni||''}</strong> a la <strong>${sale.serieRangoFin||''}</strong></div>
  <div>Fecha Limite de Emision <strong>${sale.serieFechaLimite?fD(sale.serieFechaLimite):'—'}</strong></div>
</div>
<div class="copies">ORIGINAL: CLIENTE<br>COPIA: OBLIGADO TRIBUTARIO EMISOR</div>

</div></body></html>`, "Nota de Débito");
}

// ─── ÓRDENES DE COMPRA ────────────────────────────────────────────────────────
let ocCache = [];
let ocItemsTemp = []; // ítems en edición dentro del modal
let ocItemSeq = 0;    // contador para generar IDs temporales únicos por fila

async function renderOrdenCompra() {
  try {
    [ocCache, clients_cache] = await Promise.all([
      GET('/ordenes_compra'),
      GET('/clientes'),
    ]);
  } catch(e) { ocCache = []; }

  ocRenderTabla();

  const search = document.getElementById('oc-search');
  if (search) { search.oninput = ocRenderTabla; }
}

function ocRenderTabla() {
  const q = (document.getElementById('oc-search')?.value || '').toLowerCase();
  const body = document.getElementById('oc-tabla-body');
  const empty = document.getElementById('oc-empty-state');
  if (!body) return;

  const filtradas = ocCache.filter(o =>
    !q || o.numero_orden?.toLowerCase().includes(q) || o.cliente_nombre?.toLowerCase().includes(q)
  );

  if (filtradas.length === 0) {
    body.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  body.innerHTML = filtradas.map(o => `
    <tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:10px 14px;font-family:monospace;font-weight:700;color:#1e3a5f;font-size:13px">${o.numero_orden}</td>
      <td style="padding:10px 14px;font-size:13px;color:#334155">${o.cliente_nombre||'—'}</td>
      <td style="padding:10px 14px;font-size:12px;color:#64748b">${fD(o.emision)}</td>
      <td style="padding:10px 14px;font-size:12px;color:#64748b">${o.condicion||'CONTADO'}</td>
      <td style="padding:10px 14px;text-align:right;font-size:13px;font-weight:700;color:#1e3a5f">${fL(o.total_general)}</td>
      <td style="padding:10px 14px;text-align:center">
        <button onclick="reimprimirOrdenCompra('${o.id}')" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:5px 11px;font-size:12px;font-weight:600;color:#2563eb;cursor:pointer;font-family:inherit">🖨️ Reimprimir</button>
      </td>
    </tr>`).join('');
}

async function abrirModalOC() {
  ocItemsTemp = [];
  ocItemSeq = 0;

  const clSel = document.getElementById('oc-cliente');
  if (clSel) clSel.innerHTML = clients_cache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');

  document.getElementById('oc-emision').value = todayHN();
  document.getElementById('oc-vence').value = todayHN();
  document.getElementById('oc-condicion').value = 'CONTADO';
  document.getElementById('oc-emitido-por').value = USER?.nombre || '';
  document.getElementById('oc-nota').value = '';

  // Cargar el catálogo de productos para el buscador (si no está ya en cache)
  if (!products_cache || products_cache.length === 0) {
    try { products_cache = await GET('/productos', `sucursal_id=${USER.sucursal_id}`); }
    catch(e) { products_cache = []; }
  }
  const buscador = document.getElementById('oc-buscar-producto');
  if (buscador) {
    buscador.value = '';
    document.getElementById('oc-buscar-resultados').style.display = 'none';
    buscador.oninput = ocBuscarProductos;
  }

  ocAgregarItem(); // arranca con una fila vacía lista para escribir
  openModal('oc-modal');
}

function ocBuscarProductos() {
  const q = (document.getElementById('oc-buscar-producto')?.value || '').toLowerCase().trim();
  const cont = document.getElementById('oc-buscar-resultados');
  if (!cont) return;

  if (!q) { cont.style.display = 'none'; cont.innerHTML = ''; return; }

  const coincidencias = (products_cache||[]).filter(p =>
    p.nombre?.toLowerCase().includes(q) ||
    p.codigo?.toLowerCase().includes(q) ||
    p.categoria?.toLowerCase().includes(q)
  ).slice(0, 25);

  if (coincidencias.length === 0) {
    cont.innerHTML = '<div style="padding:12px;font-size:12px;color:#94a3b8">Sin resultados.</div>';
    cont.style.display = 'block';
    return;
  }

  cont.innerHTML = coincidencias.map(p => `
    <div onclick="ocSeleccionarProducto('${p.id}')"
      style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:10px"
      onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:600;color:#1e3a5f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nombre}</div>
        <div style="font-size:11px;color:#94a3b8">${p.codigo||'—'} ${p.categoria?'· '+p.categoria:''}</div>
      </div>
      <div style="font-size:13px;font-weight:700;color:#1e3a5f;white-space:nowrap">L. ${(p.precio_venta||0).toFixed(2)}</div>
    </div>`).join('');
  cont.style.display = 'block';
}

function ocSeleccionarProducto(productoId) {
  const p = (products_cache||[]).find(x => x.id === productoId);
  if (!p) return;

  // Si la última fila está vacía (sin nombre), se reutiliza; si no, se agrega una nueva
  let fila = ocItemsTemp[ocItemsTemp.length - 1];
  if (!fila || (fila.nombre && fila.nombre.trim())) {
    ocItemSeq++;
    fila = { tempId: ocItemSeq, codigo:'', nombre:'', unidad:'', precio_unit:0, cantidad:1 };
    ocItemsTemp.push(fila);
  }
  fila.codigo = p.codigo || '';
  fila.nombre = p.nombre || '';
  fila.unidad = p.unidad || 'UND';
  fila.precio_unit = p.precio_venta || 0;
  fila.cantidad = fila.cantidad || 1;

  ocRenderItems();

  // Limpiar el buscador y ocultar resultados, listo para la siguiente búsqueda
  const buscador = document.getElementById('oc-buscar-producto');
  if (buscador) buscador.value = '';
  document.getElementById('oc-buscar-resultados').style.display = 'none';
}

function ocAgregarItem() {
  ocItemSeq++;
  ocItemsTemp.push({ tempId: ocItemSeq, codigo:'', nombre:'', unidad:'', precio_unit:0, cantidad:1 });
  ocRenderItems();
}

function ocQuitarItem(tempId) {
  ocItemsTemp = ocItemsTemp.filter(i => i.tempId !== tempId);
  ocRenderItems();
}

function ocUpdateItem(tempId, campo, valor) {
  const item = ocItemsTemp.find(i => i.tempId === tempId);
  if (!item) return;
  if (campo === 'precio_unit' || campo === 'cantidad') {
    item[campo] = parseFloat(valor) || 0;
  } else {
    item[campo] = valor;
  }
  // Solo se recalculan los totales (sin reconstruir los inputs) para no perder
  // el foco ni la posición del cursor mientras el usuario está escribiendo.
  ocActualizarFilaTotal(tempId);
  ocRecalcularTotales();
}

/** Actualiza solo la celda de "Total" de una fila, sin reconstruir el input (evita perder el foco) */
function ocActualizarFilaTotal(tempId) {
  const item = ocItemsTemp.find(i => i.tempId === tempId);
  if (!item) return;
  const idx = ocItemsTemp.findIndex(i => i.tempId === tempId);
  const fila = document.querySelectorAll('#oc-items-body tr')[idx];
  if (!fila) return;
  const celdaTotal = fila.children[5]; // 6ta columna: Total
  if (celdaTotal) celdaTotal.textContent = fL((item.precio_unit||0)*(item.cantidad||0));
}

function ocRenderItems() {
  const body = document.getElementById('oc-items-body');
  if (!body) return;
  body.innerHTML = ocItemsTemp.map(i => `
    <tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:5px 6px"><input type="text" value="${i.codigo}" oninput="ocUpdateItem(${i.tempId},'codigo',this.value)" style="width:100%;border:1px solid #e2e8f0;border-radius:5px;padding:5px 7px;font-size:12px;outline:none"></td>
      <td style="padding:5px 6px"><input type="text" value="${i.nombre}" oninput="ocUpdateItem(${i.tempId},'nombre',this.value)" placeholder="Nombre del artículo" style="width:100%;border:1px solid #e2e8f0;border-radius:5px;padding:5px 7px;font-size:12px;outline:none"></td>
      <td style="padding:5px 6px"><input type="text" value="${i.unidad}" oninput="ocUpdateItem(${i.tempId},'unidad',this.value)" style="width:100%;border:1px solid #e2e8f0;border-radius:5px;padding:5px 7px;font-size:12px;outline:none"></td>
      <td style="padding:5px 6px"><input type="number" inputmode="decimal" step="0.01" min="0" value="${(i.precio_unit||0).toFixed(2)}" placeholder="0.00" oninput="ocUpdateItem(${i.tempId},'precio_unit',this.value)" class="oc-input-decimal" style="width:100%;border:1px solid #e2e8f0;border-radius:5px;padding:5px 7px;font-size:12px;outline:none;text-align:right" onfocus="this.select()" onwheel="this.blur()"></td>
      <td style="padding:5px 6px"><input type="number" inputmode="decimal" step="0.001" min="0" value="${i.cantidad}" placeholder="1" oninput="ocUpdateItem(${i.tempId},'cantidad',this.value)" class="oc-input-decimal" style="width:100%;border:1px solid #e2e8f0;border-radius:5px;padding:5px 7px;font-size:12px;outline:none;text-align:right" onfocus="this.select()" onwheel="this.blur()"></td>
      <td style="padding:5px 6px;text-align:right;font-size:13px;font-weight:600;white-space:nowrap">${fL((i.precio_unit||0)*(i.cantidad||0))}</td>
      <td style="padding:5px 6px;text-align:center"><button type="button" onclick="ocQuitarItem(${i.tempId})" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px">✕</button></td>
    </tr>`).join('');
  ocRecalcularTotales();
}

function ocRecalcularTotales() {
  const subtotal = ocItemsTemp.reduce((s,i) => s + (i.precio_unit||0)*(i.cantidad||0), 0);
  document.getElementById('oc-total-bruto').textContent     = fL(subtotal);
  document.getElementById('oc-total-impuesto').textContent  = fL(0);
  document.getElementById('oc-total-descuento').textContent = fL(0);
  document.getElementById('oc-total-general').textContent   = fL(subtotal);
}

async function guardarOrdenCompra() {
  const cliente_id = document.getElementById('oc-cliente')?.value;
  if (!cliente_id) { alert('Seleccioná un cliente.'); return; }

  const itemsValidos = ocItemsTemp.filter(i => i.nombre && i.nombre.trim());
  if (itemsValidos.length === 0) { alert('Agregá al menos un artículo con nombre.'); return; }

  const payload = {
    cliente_id,
    emision: document.getElementById('oc-emision')?.value || todayHN(),
    vence: document.getElementById('oc-vence')?.value || todayHN(),
    condicion: document.getElementById('oc-condicion')?.value || 'CONTADO',
    nota: document.getElementById('oc-nota')?.value || '',
    emitido_por: document.getElementById('oc-emitido-por')?.value || '',
    items: itemsValidos.map(i => ({
      codigo: i.codigo, nombre: i.nombre, unidad: i.unidad,
      precio_unit: i.precio_unit, cantidad: i.cantidad
    }))
  };

  try {
    const r = await POST('/ordenes_compra', payload);
    closeModal('oc-modal');
    await renderOrdenCompra();
    // Imprimir inmediatamente la orden recién creada
    const ordenCompleta = await GET('/ordenes_compra/' + r.id);
    printOrdenCompra(ordenCompleta);
  } catch(e) {
    alert('Error al guardar la orden: ' + e.message);
  }
}

async function reimprimirOrdenCompra(id) {
  try {
    const orden = await GET('/ordenes_compra/' + id);
    printOrdenCompra(orden);
  } catch(e) {
    alert('Error al cargar la orden: ' + e.message);
  }
}

/** Genera e imprime el documento de Orden de Compra, formato idéntico a la plantilla de Agencia Aduanera Trejo */
function printOrdenCompra(o) {
  const b = BRANCH || {};
  const logoSrc = b.logo || '';

  const itemsHTML = (o.items||[]).map(i => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px">${i.codigo||''}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px">${i.nombre||''}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px">${i.unidad||''}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;text-align:right">${(i.precio_unit||0).toFixed(2)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;text-align:right">${(i.cantidad||0).toFixed(3)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;text-align:right">${((i.precio_unit||0)*(i.cantidad||0)).toFixed(2)}</td>
    </tr>`).join('');

  const totalLetras = moneyToWords(o.total_general||0);

  openPrint(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Orden de Compra ${o.numero_orden}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
body{font-size:12px;padding:18px;background:#fff;color:#1a1a1a}
@media print{@page{size:letter portrait;margin:10mm}body{padding:0}}
.iw{max-width:780px;margin:0 auto}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;margin-bottom:8px}
.hdr-left{display:flex;align-items:flex-start;gap:12px}
.logo-circle{width:58px;height:58px;border-radius:50%;object-fit:cover;flex-shrink:0}
.co-name{font-size:16px;font-weight:800;color:#1a1a1a}
.co-sub{font-size:11px;color:#444;margin-top:2px}
.co-email{font-size:11px;color:#444;margin-top:6px}
.badge-title{font-size:19px;font-weight:800;text-align:right;color:#1a1a1a;line-height:1.2}
.badge-num{font-size:20px;font-weight:800;color:#c0392b;text-align:right;margin-top:4px}
.box{border:1px solid #333;margin-bottom:0}
.row-boxes{display:flex;gap:0;margin-bottom:14px}
.cliente-box{flex:1;border:1px solid #333}
.cliente-box .r{border-bottom:1px solid #333;padding:6px 10px;font-size:11.5px}
.cliente-box .r:last-child{border-bottom:none}
.cliente-box b{font-weight:700}
.meta-box{width:230px;border:1px solid #333;border-left:none}
.meta-row{display:flex;border-bottom:1px solid #333}
.meta-row > div{flex:1;text-align:center;padding:6px 4px;font-size:11px;font-weight:700;border-right:1px solid #333}
.meta-row > div:last-child{border-right:none}
.meta-val{display:flex;border-bottom:1px solid #333}
.meta-val > div{flex:1;text-align:center;padding:6px 4px;font-size:12px;border-right:1px solid #333}
.meta-val > div:last-child{border-right:none}
.meta-full{text-align:center;padding:8px 4px;font-size:13px;font-weight:700}
.items-table{width:100%;border-collapse:collapse;margin-bottom:18px}
.items-table thead th{background:#f1f1f1;padding:7px 10px;font-size:11px;font-weight:700;text-align:left;border-top:1px solid #888;border-bottom:1px solid #888}
.items-table thead th.r{text-align:right}
.nota-totales{display:flex;gap:0;margin-bottom:10px}
.nota-box{flex:1;border:1px solid #333;padding:8px 10px;font-size:11px}
.tot-box{width:280px;border:1px solid #333;border-left:none}
.tot-row{display:flex;border-bottom:1px solid #333}
.tot-row:last-child{border-bottom:none}
.tot-row > div{flex:1;padding:6px 10px;font-size:12px;border-right:1px solid #333}
.tot-row > div:last-child{border-right:none;text-align:right;font-weight:700}
.tot-row.gen{background:#fafafa}
.tot-row.gen div{font-weight:800;font-size:13px}
.son-line{font-size:12px;margin-bottom:18px}
.firmas{display:flex;gap:24px;margin-top:30px}
.firma-box{flex:1;border:1px solid #333;padding:8px 10px;font-size:11px;min-height:50px}
</style></head><body><div class="iw">

<div class="hdr">
  <div class="hdr-left">
    ${logoSrc?`<img src="${logoSrc}" class="logo-circle"/>`:``}
    <div>
      <div class="co-name">${b.nombre||'AGENCIA ADUANERA'}</div>
      <div class="co-sub">RTN: ${b.rtn||''} &nbsp;/&nbsp;</div>
      <div class="co-sub">${b.direccion||''} ${b.telefono?`telf. ${b.telefono}`:''} &nbsp;fax :</div>
      <div class="co-email">e-mail: ${b.email||''}</div>
    </div>
  </div>
  <div>
    <div class="badge-title">ORDEN DE<br>COMPRA</div>
    <div class="badge-num">${o.numero_orden}</div>
  </div>
</div>

<div class="row-boxes">
  <div class="cliente-box">
    <div class="r"><b>Cliente:</b> ${o.cliente_nombre||''}</div>
    <div class="r">RTN: ${o.cliente_rtn||''} &nbsp;/&nbsp;</div>
    <div class="r"><b>Domicilio fiscal:</b> ${o.cliente_direccion||''}</div>
    <div class="r"><b>Teléfonos:</b> ${o.cliente_telefono||''}</div>
    <div class="r"><b>Fax:</b></div>
    <div class="r"><b>Persona contacto:</b></div>
  </div>
  <div class="meta-box">
    <div class="meta-row"><div>Emisión</div><div>Vence</div></div>
    <div class="meta-val"><div>${fD(o.emision)}</div><div>${fD(o.vence)}</div></div>
    <div class="meta-row"><div>Orden #</div><div>Página:</div></div>
    <div class="meta-val"><div></div><div>${o.pagina||'001'}</div></div>
    <div class="meta-full">${o.condicion||'CONTADO'}</div>
  </div>
</div>

<table class="items-table">
<thead><tr>
  <th style="width:70px">Código</th>
  <th>Nombre del artículo</th>
  <th style="width:80px">Unidad</th>
  <th class="r" style="width:100px">Precio Unitario</th>
  <th class="r" style="width:80px">Cantidad</th>
  <th class="r" style="width:100px">Total neto</th>
</tr></thead>
<tbody>${itemsHTML}</tbody>
</table>

<div class="nota-totales">
  <div class="nota-box"><b>Nota:</b><br>${o.nota||''}</div>
  <div class="tot-box">
    <div class="tot-row"><div>Total Bruto:</div><div>L ${(o.subtotal||0).toFixed(2)}</div></div>
    <div class="tot-row"><div>Total Impuesto:</div><div>L ${(o.total_impuesto||0).toFixed(2)}</div></div>
    <div class="tot-row"><div>Total Descuento:</div><div>L ${(o.total_descuento||0).toFixed(2)}</div></div>
    <div class="tot-row gen"><div>TOTAL GENERAL</div><div>L ${(o.total_general||0).toFixed(2)}</div></div>
  </div>
</div>

<div class="son-line">Son: L ${totalLetras}</div>

<div class="firmas">
  <div class="firma-box"><b>Emitido por:</b><br><br><div style="text-align:center">${o.emitido_por||''}</div></div>
  <div class="firma-box"><b>Aprobado por:</b><br><br><div style="text-align:center">${o.aprobado_por||''}</div></div>
</div>

</div></body></html>`, "Orden de Compra");
}

// ─── BANCOS ───────────────────────────────────────────────────────────────────
let editingBanco = null;

async function renderBancos() {
  try { bancos_cache = await GET('/bancos'); } catch(e) {}
  const total = bancos_cache.reduce((s,b) => s+(b.saldo_actual||0), 0);
  document.getElementById('bancos-subtitle').textContent = `${bancos_cache.length} cuentas · Total consolidado: L. ${total.toFixed(2)}`;
  document.getElementById('bancos-cards').innerHTML = bancos_cache.map(b => `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;min-width:200px;flex:1;max-width:280px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="font-size:20px">${b.tipo==='ahorro'?'🏦':'💳'}</div>
        <button class="action-btn edit" onclick="openBancoModal('${b.id}')">✏️</button>
      </div>
      <div style="font-weight:700;color:#1e293b;margin-bottom:2px">${b.nombre}</div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:8px">${b.numero_cuenta||'Sin número'} · ${b.tipo}</div>
      <div style="font-size:18px;font-weight:700;color:#2563eb">L. ${(b.saldo_actual||0).toFixed(2)}</div>
      <div style="font-size:10px;color:#94a3b8">${b.moneda||'HNL'}</div>
    </div>
  `).join('');
  // Populate bank selector
  const sel = document.getElementById('banco-sel-mov');
  sel.innerHTML = '<option value="">— Seleccionar Banco —</option>' + bancos_cache.map(b=>`<option value="${b.id}">${b.nombre}</option>`).join('');
  const selMov = document.getElementById('mov-banco-id');
  if(selMov) selMov.innerHTML = bancos_cache.map(b=>`<option value="${b.id}">${b.nombre} (L. ${(b.saldo_actual||0).toFixed(2)})</option>`).join('');
}

function openBancoModal(id) {
  const b = id ? bancos_cache.find(x=>x.id===id) : null;
  editingBanco = b;
  document.getElementById('banco-modal-title').textContent = b ? 'Editar Banco' : 'Nueva Cuenta Bancaria';
  document.getElementById('banco-nombre').value = b?.nombre||'';
  document.getElementById('banco-cuenta').value = b?.numero_cuenta||'';
  document.getElementById('banco-tipo').value = b?.tipo||'corriente';
  document.getElementById('banco-moneda').value = b?.moneda||'HNL';
  document.getElementById('banco-saldo-ini').value = b?.saldo_inicial||0;
  openModal('banco-modal');
}

async function saveBanco(e) {
  e.preventDefault();
  const data = {
    nombre: document.getElementById('banco-nombre').value,
    numero_cuenta: document.getElementById('banco-cuenta').value,
    tipo: document.getElementById('banco-tipo').value,
    moneda: document.getElementById('banco-moneda').value,
    saldo_inicial: parseFloat(document.getElementById('banco-saldo-ini').value)||0,
  };
  try {
    if(editingBanco) await PUT('/bancos/'+editingBanco.id, data);
    else await POST('/bancos', data);
    closeModal('banco-modal'); renderBancos();
  } catch(e) { alert(e.message); }
}

async function loadMovimientosBanco() {
  const bid = document.getElementById('banco-sel-mov').value;
  if(!bid) return alert('Seleccione un banco');
  const fi = document.getElementById('banco-fecha-ini').value;
  const ff = document.getElementById('banco-fecha-fin').value;
  let qs = '';
  if(fi) qs += `&fecha_ini=${fi}`;
  if(ff) qs += `&fecha_fin=${ff}`;
  const movs = await GET(`/bancos/${bid}/movimientos`, qs.replace('&',''));
  const tipoLabels = {deposito:'💰 Depósito',retiro:'⬆️ Retiro',transferencia:'↔️ Transferencia',nota_credito:'✅ N.Crédito',nota_debito:'❌ N.Débito'};
  document.getElementById('banco-mov-body').innerHTML = movs.length ? movs.map(m=>`
    <tr>
      <td style="font-size:11px">${fDT(m.fecha)}</td>
      <td><span class="badge ${m.tipo==='deposito'||m.tipo==='nota_credito'?'badge-green':'badge-red'}">${tipoLabels[m.tipo]||m.tipo}</span></td>
      <td>${m.descripcion||'—'}</td>
      <td style="font-family:monospace;font-size:11px">${m.referencia||'—'}</td>
      <td style="text-align:right;font-weight:600;color:${m.tipo==='deposito'||m.tipo==='nota_credito'?'#16a34a':'#dc2626'}">L. ${(m.monto||0).toFixed(2)}</td>
      <td style="text-align:right">L. ${(m.saldo_anterior||0).toFixed(2)}</td>
      <td style="text-align:right;font-weight:700">L. ${(m.saldo_nuevo||0).toFixed(2)}</td>
      <td style="font-size:11px">${m.usuario_nombre||'—'}</td>
    </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:24px">Sin movimientos</td></tr>';
}

function openMovimientoModal() {
  const now = new Date();
  const local = new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  document.getElementById('mov-fecha').value = local;
  const sel = document.getElementById('mov-banco-id');
  sel.innerHTML = bancos_cache.map(b=>`<option value="${b.id}">${b.nombre} (L. ${(b.saldo_actual||0).toFixed(2)})</option>`).join('');
  openModal('movimiento-modal');
}

async function saveMovimiento(e) {
  e.preventDefault();
  const data = {
    tipo: document.getElementById('mov-tipo').value,
    fecha: document.getElementById('mov-fecha').value,
    monto: parseFloat(document.getElementById('mov-monto').value)||0,
    descripcion: document.getElementById('mov-descripcion').value,
    referencia: document.getElementById('mov-referencia').value,
  };
  const bid = document.getElementById('mov-banco-id').value;
  if(!bid) return alert('Seleccione un banco');
  try {
    await POST(`/bancos/${bid}/movimientos`, data);
    closeModal('movimiento-modal'); renderBancos();
  } catch(e) { alert(e.message); }
}

async function reporteConsolidacionBancaria() {
  const r = await GET('/bancos/consolidacion');
  const b = BRANCH||{};
  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}body{font-size:12px;padding:20px}@media print{@page{size:letter;margin:10mm}}table{width:100%;border-collapse:collapse;margin-top:14px}th{background:#1e3a5f;color:#fff;padding:8px 10px;text-align:left}td{padding:8px 10px;border-bottom:1px solid #f1f5f9}tr:nth-child(even) td{background:#f8fafc}.total-row td{background:#1e3a5f;color:#fff;font-weight:700}</style></head><body>
  <div style="display:flex;justify-content:space-between;margin-bottom:16px;border-bottom:2px solid #1e3a5f;padding-bottom:12px">
    <div><strong style="font-size:18px;color:#1e3a5f">CONSOLIDACIÓN BANCARIA</strong><br><span style="color:#64748b">${b.nombre||''} — RTN: ${b.rtn||''}</span></div>
    <div style="text-align:right;color:#64748b">Generado: ${new Date().toLocaleString('es-HN',{timeZone:'America/Tegucigalpa'})}</div>
  </div>
  <table><thead><tr><th>Banco</th><th>N° Cuenta</th><th>Tipo</th><th>Moneda</th><th style="text-align:right">Saldo Inicial</th><th style="text-align:right">Saldo Actual</th></tr></thead>
  <tbody>${(r.bancos||[]).map(b=>`<tr><td style="font-weight:600">${b.nombre}</td><td style="font-family:monospace">${b.numero_cuenta||'—'}</td><td>${b.tipo}</td><td>${b.moneda}</td><td style="text-align:right">L. ${(b.saldo_inicial||0).toFixed(2)}</td><td style="text-align:right;font-weight:700">L. ${(b.saldo_actual||0).toFixed(2)}</td></tr>`).join('')}</tbody>
  <tfoot><tr class="total-row"><td colspan="5">TOTAL CONSOLIDADO</td><td style="text-align:right">L. ${(r.total_consolidado||0).toFixed(2)}</td></tr></tfoot></table>
  <div style="margin-top:20px;font-size:10px;color:#94a3b8;text-align:right">Powered by Metric POS</div>
  </body></html>`, "Consolidación Bancaria");
}

// ─── IMPUESTOS ────────────────────────────────────────────────────────────────
let editingImpuesto = null;

async function renderImpuestos() {
  try { impuestos_cache = await GET('/impuestos'); } catch(e) {}
  document.getElementById('imp-count').textContent = impuestos_cache.length + ' impuestos';
  document.getElementById('imp-table-body').innerHTML = impuestos_cache.map(imp=>`
    <tr>
      <td style="font-weight:600">${imp.nombre}</td>
      <td>${imp.tasa}${imp.tipo==='porcentaje'?'%':' L.'}</td>
      <td>${imp.tipo==='porcentaje'?'Porcentaje':'Monto Fijo'}</td>
      <td>${imp.aplica_a}</td>
      <td><span class="badge ${imp.activo?'badge-green':'badge-red'}">${imp.activo?'Activo':'Inactivo'}</span></td>
      <td><div style="display:flex;gap:4px;justify-content:flex-end">
        <button class="action-btn edit" onclick="openImpuestoModal('${imp.id}')">✏️</button>
        <button class="action-btn delete" onclick="deleteImpuesto('${imp.id}')">🗑️</button>
      </div></td>
    </tr>`).join('');
}

function openImpuestoModal(id) {
  const imp = id ? impuestos_cache.find(x=>x.id===id) : null;
  editingImpuesto = imp;
  document.getElementById('imp-modal-title').textContent = imp ? 'Editar Impuesto' : 'Crear Impuesto';
  document.getElementById('imp-nombre').value = imp?.nombre||'';
  document.getElementById('imp-tasa').value = imp?.tasa||'';
  document.getElementById('imp-tipo').value = imp?.tipo||'porcentaje';
  document.getElementById('imp-aplica').value = imp?.aplica_a||'todos';
  openModal('impuesto-modal');
}

async function saveImpuesto(e) {
  e.preventDefault();
  const data = {
    nombre: document.getElementById('imp-nombre').value,
    tasa: parseFloat(document.getElementById('imp-tasa').value)||0,
    tipo: document.getElementById('imp-tipo').value,
    aplica_a: document.getElementById('imp-aplica').value,
  };
  try {
    if(editingImpuesto) await PUT('/impuestos/'+editingImpuesto.id, data);
    else await POST('/impuestos', data);
    closeModal('impuesto-modal'); renderImpuestos();
  } catch(e) { alert(e.message); }
}

async function deleteImpuesto(id) {
  if(!confirm('¿Eliminar este impuesto?')) return;
  try { await DELETE('/impuestos/'+id); renderImpuestos(); } catch(e) { alert(e.message); }
}

// ─── IMPORTAR EXCEL ───────────────────────────────────────────────────────────
// ── Importar Productos Excel (usa SheetJS igual que Clientes/Proveedores) ──
function openExcelModal() {
  document.getElementById('excel-file-input').value = '';
  document.getElementById('excel-preview').style.display = 'none';
  document.getElementById('excel-result').style.display  = 'none';
  document.getElementById('excel-import-btn').style.display = 'none';
  openModal('excel-modal');
}

// Listener del input de archivo
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('excel-file-input');
  if(input) input.addEventListener('change', async e => {
    try {
      const rows = await leerExcel('excel-file-input');
      mostrarPreviewProductos(rows);
    } catch(err) { alert('Error: '+err.message); }
  });
});

function mostrarPreviewProductos(rows) {
  if(!rows.length) return;
  const prev = document.getElementById('excel-preview');
  const muestra = rows.slice(0,5);
  prev.style.display = 'block';
  prev.innerHTML = '<div style="font-weight:700;color:#475569;margin-bottom:6px">Vista previa (' + rows.length + ' registros):</div>' +
    muestra.map((r,i) =>
      '<div style="padding:4px 0;border-bottom:1px solid #e2e8f0;font-size:11px">' +
      (i+1) + '. <b>Código:</b> ' + (r.codigo||'—') + ' | <b>Nombre:</b> ' + (r.nombre||'—') + ' | <b>Precio:</b> L. ' + (parseFloat(r.precio_venta)||0).toFixed(2) +
      '</div>'
    ).join('') +
    (rows.length>5 ? '<div style="color:#94a3b8;font-size:11px;margin-top:4px">...y ' + (rows.length-5) + ' más</div>' : '');
  document.getElementById('excel-import-btn').style.display = 'inline-block';
  window._excelProdCache = rows;
}

async function importarProductosExcel() {
  const rows = window._excelProdCache;
  if(!rows||!rows.length) return;
  const btn = document.getElementById('excel-import-btn');
  btn.disabled = true; btn.textContent = 'Importando...';
  try {
    const productos = rows.map(r => ({
      codigo:       (r.codigo||'').toString().trim(),
      nombre:       (r.nombre||'').toString().trim(),
      categoria:    (r.categoria||'General').toString().trim(),
      precio_venta: parseFloat(r.precio_venta)||0,
      costo:        parseFloat(r.costo)||0,
      gravado:      r.gravado===0||r.gravado==='0'?0:1,
    })).filter(p => p.codigo && p.nombre);
    const r = await POST('/productos/importar_excel', {productos});
    mostrarResultado('excel-result', r);
    window._excelProdCache = null;
    setTimeout(() => { closeModal('excel-modal'); if(currentView==='products') renderProducts(); }, 2000);
  } catch(err) { alert('Error: '+err.message); }
  btn.disabled = false; btn.textContent = '📥 Importar';
}

// ─── PERMISOS DE MÓDULOS ──────────────────────────────────────────────────────
const MODULOS_BLOQUEABLES = [
  {id:'bancos',label:'Bancos'},
  {id:'cxp',label:'Cuentas por Pagar'},
  {id:'cxc',label:'Cuentas por Cobrar'},
  {id:'inventory',label:'Inventario'},
  {id:'purchases',label:'Compras'},
];

let permisosUserId = null;

async function openPermisosModal(userId, userName) {
  permisosUserId = userId;
  document.getElementById('permisos-user-nombre').textContent = `Usuario: ${userName}`;
  const permisos = await GET(`/usuarios/${userId}/permisos`).catch(()=>[]);
  const bloqueados = {};
  permisos.forEach(p => bloqueados[p.modulo] = p.bloqueado);
  document.getElementById('permisos-lista').innerHTML = MODULOS_BLOQUEABLES.map(m=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#f8fafc;border-radius:8px">
      <div>
        <div style="font-weight:600;color:#1e293b">${m.label}</div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <span style="font-size:12px;color:${bloqueados[m.id]?'#dc2626':'#16a34a'}">${bloqueados[m.id]?'Bloqueado':'Activo'}</span>
        <input type="checkbox" ${bloqueados[m.id]?'checked':''} onchange="toggleModuloPermiso('${m.id}',this.checked,'${userName}')" style="width:16px;height:16px;cursor:pointer">
      </label>
    </div>`).join('');
  openModal('permisos-modal');
}

async function toggleModuloPermiso(modulo, bloqueado, userName) {
  try {
    await PUT(`/usuarios/${permisosUserId}/permisos`, {modulo, bloqueado});
    // Refresh labels
    await openPermisosModal(permisosUserId, userName);
  } catch(e) { alert(e.message); }
}

// ─── REPORTES NUEVOS ──────────────────────────────────────────────────────────
async function reporteLibroFiscal() {
  const ini = document.getElementById('rep-fecha-ini').value;
  const fin = document.getElementById('rep-fecha-fin').value;
  const ventas = await GET('/reportes/libro_fiscal', `sucursal_id=${USER.sucursal_id}&fecha_ini=${ini}&fecha_fin=${fin}`);
  const b = BRANCH||{};
  const totGrav = ventas.reduce((s,v)=>s+(v.importe_gravado||0),0);
  const totExento = ventas.reduce((s,v)=>s+(v.importe_exento||0),0);
  const totIsv15 = ventas.reduce((s,v)=>s+(v.isv15||0),0);
  const totIsv18 = ventas.reduce((s,v)=>s+(v.isv18||0),0);
  const totDesc = ventas.reduce((s,v)=>s+(v.descuento||0),0);
  const totTotal = ventas.reduce((s,v)=>s+(v.total||0),0);
  const fpLabel = {efectivo:'Efectivo',tarjeta:'Tarjeta',transferencia:'Transf.'};
  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}body{font-size:10px;padding:15px}
@media print{@page{size:legal landscape;margin:8mm}body{padding:0}}
table{width:100%;border-collapse:collapse;margin-top:10px}
th{background:#1e3a5f;color:#fff;padding:5px 6px;font-size:9px;text-align:left}
td{padding:4px 6px;border-bottom:1px solid #f1f5f9;font-size:9px}
tr:nth-child(even) td{background:#f8fafc}.total-row td{background:#1e3a5f;color:#fff;font-weight:700}
</style></head><body>
<div style="display:flex;justify-content:space-between;margin-bottom:12px;border-bottom:3px solid #1e3a5f;padding-bottom:10px">
  <div><div style="font-size:16px;font-weight:700;color:#1e3a5f">LIBRO DE VENTAS FISCALES</div>
  <div style="font-size:10px;color:#64748b">${b.nombre||''} · RTN: ${b.rtn||''} · CAI: ${b.cai||''}</div></div>
  <div style="text-align:right;font-size:10px;color:#64748b">Período: ${fD(ini)} al ${fD(fin)}<br>Generado: ${new Date().toLocaleString('es-HN',{timeZone:'America/Tegucigalpa'})}</div>
</div>
<table><thead><tr>
  <th>#</th><th>Fecha</th><th>N° Factura</th><th>Cliente</th><th>RTN Cliente</th>
  <th style="text-align:right">Imp.Gravado</th><th style="text-align:right">Imp.Exento</th>
  <th style="text-align:right">ISV 15%</th><th style="text-align:right">ISV 18%</th>
  <th style="text-align:right">Descuento</th><th style="text-align:right">Total</th>
  <th>F.Pago</th><th>Estado</th>
</tr></thead>
<tbody>${ventas.map((v,i)=>`<tr ${v.estado==='anulada'?'style="text-decoration:line-through;color:#94a3b8"':''}>
  <td>${i+1}</td><td>${fDT(v.fecha)}</td>
  <td style="font-family:monospace;font-weight:600">${v.numero_factura}</td>
  <td>${v.cliente_nombre||'Consumidor Final'}</td>
  <td style="font-family:monospace">${v.cliente_rtn||'—'}</td>
  <td style="text-align:right">${fL(v.importe_gravado||0)}</td>
  <td style="text-align:right">${fL(v.importe_exento||0)}</td>
  <td style="text-align:right">${fL(v.isv15||0)}</td>
  <td style="text-align:right">${fL(v.isv18||0)}</td>
  <td style="text-align:right">${fL(v.descuento||0)}</td>
  <td style="text-align:right;font-weight:700">${fL(v.total||0)}</td>
  <td>${fpLabel[v.forma_pago]||v.forma_pago||'Efect.'}</td>
  <td><span style="padding:1px 5px;border-radius:8px;font-size:8px;font-weight:700;background:${v.estado==='emitida'?'#f0fdf4':'#fef2f2'};color:${v.estado==='emitida'?'#16a34a':'#dc2626'}">${v.estado}</span></td>
</tr>`).join('')}</tbody>
<tfoot><tr class="total-row">
  <td colspan="5">TOTALES (${ventas.length} facturas)</td>
  <td style="text-align:right">${fL(totGrav)}</td><td style="text-align:right">${fL(totExento)}</td>
  <td style="text-align:right">${fL(totIsv15)}</td><td style="text-align:right">${fL(totIsv18)}</td>
  <td style="text-align:right">${fL(totDesc)}</td><td style="text-align:right">${fL(totTotal)}</td>
  <td colspan="2"></td>
</tr></tfoot></table>
<div style="margin-top:12px;font-size:9px;color:#94a3b8;text-align:right">Powered by Metric POS</div>
</body></html>`, "Libro de Ventas Fiscales");
}

async function reporteValorizacion() {
  const inv = await GET('/reportes/valorizacion', `sucursal_id=${USER.sucursal_id}`);
  const b = BRANCH||{};
  const totCosto = inv.reduce((s,p)=>s+(p.valor_costo||0),0);
  const totVenta = inv.reduce((s,p)=>s+(p.valor_venta||0),0);
  const totMargen = inv.reduce((s,p)=>s+(p.margen||0),0);
  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}body{font-size:11px;padding:20px}
@media print{@page{size:letter landscape;margin:10mm}body{padding:0}}
table{width:100%;border-collapse:collapse;margin-top:14px}
th{background:#1e3a5f;color:#fff;padding:7px 8px;font-size:10px}
td{padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:10px}
tr:nth-child(even) td{background:#f8fafc}.total-row td{background:#1e3a5f;color:#fff;font-weight:700}
</style></head><body>
<div style="display:flex;justify-content:space-between;margin-bottom:16px;border-bottom:2px solid #1e3a5f;padding-bottom:12px">
  <div><strong style="font-size:18px;color:#1e3a5f">VALORIZACIÓN DE INVENTARIO</strong><br><span style="font-size:10px;color:#64748b">RTN: ${b.rtn||''}</span></div>
  <div style="text-align:right;font-size:11px;color:#64748b">Fecha: ${fD(today())}<br>Hora: ${new Date().toLocaleTimeString('es-HN',{timeZone:'America/Tegucigalpa'})}</div>
</div>
<div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap">
  ${[['Valor a Costo','#eff6ff',fL(totCosto)],['Valor a Precio Venta','#f0fdf4',fL(totVenta)],['Margen Potencial','#fff7ed',fL(totMargen)]].map(([l,bg,v])=>`<div style="flex:1;min-width:160px;background:${bg};border-radius:10px;padding:12px 16px;text-align:center"><div style="font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase">${l}</div><div style="font-size:17px;font-weight:700;color:#1e3a5f;margin-top:4px">${v}</div></div>`).join('')}
</div>
<table><thead><tr>
  <th>Código</th><th>Nombre</th><th>Categoría</th>
  <th style="text-align:right">Stock</th><th style="text-align:right">Costo Unit.</th>
  <th style="text-align:right">Precio Venta</th><th style="text-align:right">Val.Costo</th>
  <th style="text-align:right">Val.Venta</th><th style="text-align:right">Margen</th>
</tr></thead>
<tbody>${inv.map(p=>`<tr>
  <td style="font-family:monospace;font-size:10px">${p.codigo}</td>
  <td style="font-weight:600">${p.nombre}</td><td>${p.categoria||'—'}</td>
  <td style="text-align:right;${(p.stock||0)<=(p.stock_min||0)?'color:#dc2626;font-weight:700':''}">${p.stock||0}</td>
  <td style="text-align:right">${fL(p.costo||0)}</td>
  <td style="text-align:right">${fL(p.precio_venta||0)}</td>
  <td style="text-align:right">${fL(p.valor_costo||0)}</td>
  <td style="text-align:right;font-weight:600">${fL(p.valor_venta||0)}</td>
  <td style="text-align:right;color:#059669;font-weight:600">${fL(p.margen||0)}</td>
</tr>`).join('')}</tbody>
<tfoot><tr class="total-row">
  <td colspan="6">TOTALES (${inv.length} productos)</td>
  <td style="text-align:right">${fL(totCosto)}</td>
  <td style="text-align:right">${fL(totVenta)}</td>
  <td style="text-align:right">${fL(totMargen)}</td>
</tr></tfoot></table>
<div style="margin-top:12px;font-size:10px;color:#94a3b8;text-align:right">Powered by Metric POS</div>
</body></html>`, "Valorización de Inventario");
}

// ─── REPORTE CORTE CAJA CON FILTRO HORA ──────────────────────────────────────
async function reporteCorteCajaDetalle() {
  const ini = document.getElementById('rep-fecha-ini').value;
  const fin = document.getElementById('rep-fecha-fin').value;
  const hi = document.getElementById('rep-hora-ini')?.value||'00:00:00';
  const hf = document.getElementById('rep-hora-fin')?.value||'23:59:59';
  const data = await GET('/reportes/corte_caja_detalle', `sucursal_id=${USER.sucursal_id}&fecha_ini=${ini}&fecha_fin=${fin}&hora_ini=${hi}&hora_fin=${hf}`, "Corte de Caja Detalle");
  const {ventas, resumen} = data;
  const b = BRANCH||{};
  const printHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;width:80mm;padding:4mm}
@media print{@page{size:80mm auto;margin:0}}
.c{text-align:center}.b{font-weight:700}.sep{border-top:1px dashed #999;margin:5px 0}
table{width:100%;border-collapse:collapse}td{padding:2px 0}td:last-child{text-align:right}
</style></head><body>
<div class="c b" style="font-size:14px">CORTE DE CAJA</div>
<div class="c">${b.nombre||''}</div>
<div class="c" style="font-size:10px">RTN: ${b.rtn||''}</div>
<div class="sep"></div>

<div>Período: ${fD(ini)} ${hi} al ${fD(fin)} ${hf}</div>
<div>Generado: ${new Date().toLocaleString('es-HN',{timeZone:'America/Tegucigalpa'})}</div>
<div class="sep"></div>
<table>
  <tr><td>N° Ventas</td><td>${resumen.total_ventas||0}</td></tr>
  <tr><td>Descuentos</td><td>-${fL(resumen.descuentos||0)}</td></tr>
  <tr><td>ISV 15%</td><td>${fL(resumen.isv15||0)}</td></tr>
  <tr><td>ISV 18%</td><td>${fL(resumen.isv18||0)}</td></tr>
  <tr><td class="b">Efectivo</td><td class="b">${fL(resumen.total_efectivo||0)}</td></tr>
  <tr><td class="b">Tarjeta</td><td class="b">${fL(resumen.total_tarjeta||0)}</td></tr>
  <tr><td class="b">Transferencia</td><td class="b">${fL(resumen.total_transferencia||0)}</td></tr>
  <tr><td class="b" style="font-size:14px">TOTAL</td><td class="b" style="font-size:14px">${fL(resumen.total||0)}</td></tr>
</table>
<div class="sep"></div>
${ventas.slice(0,30).map(s=>`<div style="font-size:10px">${s.numero_factura} | ${(s.cliente_nombre||'').substring(0,12)} | ${fL(s.total)}</div>`).join('')}
<div class="sep"></div>
<div class="c" style="font-size:10px">Powered by Metric POS</div>
<div style="height:10mm"></div></body></html>`;
  openPrint(printHTML, "Corte de Caja Detalle");
}

async function reporteCorteCajaCartaDetalle() {
  const ini = document.getElementById('rep-fecha-ini').value;
  const fin = document.getElementById('rep-fecha-fin').value;
  const hi = document.getElementById('rep-hora-ini')?.value||'00:00:00';
  const hf = document.getElementById('rep-hora-fin')?.value||'23:59:59';
  const data = await GET('/reportes/corte_caja_detalle', `sucursal_id=${USER.sucursal_id}&fecha_ini=${ini}&fecha_fin=${fin}&hora_ini=${hi}&hora_fin=${hf}`);
  const {ventas, resumen} = data;
  const b = BRANCH||{};
  openPrint(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}body{font-size:11px;padding:20px}
@media print{@page{size:letter portrait;margin:10mm}body{padding:0}}
table{width:100%;border-collapse:collapse;margin-top:10px}
th{background:#1e3a5f;color:#fff;padding:6px 8px;font-size:10px;text-align:left}
td{padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:10px}
tr:nth-child(even) td{background:#f8fafc}.total-row td{background:#1e3a5f;color:#fff;font-weight:700}
.res{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0}
.rc{background:#f8fafc;border-radius:8px;padding:10px;text-align:center}
.rl{font-size:9px;color:#64748b;text-transform:uppercase;font-weight:700}
.rv{font-size:14px;font-weight:700;color:#1e3a5f;margin-top:3px}
</style></head><body>
<div style="display:flex;justify-content:space-between;margin-bottom:12px;border-bottom:2px solid #1e3a5f;padding-bottom:10px">
  <div><strong style="font-size:18px;color:#1e3a5f">CORTE DE CAJA</strong><br>
  <span style="font-size:10px;color:#64748b">${b.nombre||''} · RTN: ${b.rtn||''}</span></div>
  <div style="text-align:right;font-size:10px;color:#64748b">Período: ${fD(ini)} ${hi}<br>hasta: ${fD(fin)} ${hf}</div>
</div>
<div class="res">
  <div class="rc"><div class="rl">Efectivo</div><div class="rv">${fL(resumen.total_efectivo||0)}</div></div>
  <div class="rc"><div class="rl">Tarjeta</div><div class="rv">${fL(resumen.total_tarjeta||0)}</div></div>
  <div class="rc"><div class="rl">Transferencia</div><div class="rv">${fL(resumen.total_transferencia||0)}</div></div>
  <div class="rc"><div class="rl">ISV 15%</div><div class="rv">${fL(resumen.isv15||0)}</div></div>
  <div class="rc"><div class="rl">ISV 18%</div><div class="rv">${fL(resumen.isv18||0)}</div></div>
  <div class="rc" style="background:#1e3a5f"><div class="rl" style="color:#93c5fd">TOTAL</div><div class="rv" style="color:#fff;font-size:17px">${fL(resumen.total||0)}</div></div>
</div>
<table><thead><tr><th>N° Factura</th><th>Fecha/Hora</th><th>Cliente</th><th>F.Pago</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${ventas.map(v=>`<tr><td style="font-family:monospace">${v.numero_factura}</td><td>${fDT(v.fecha)}</td><td>${(v.cliente_nombre||'').substring(0,20)}</td><td>${v.forma_pago||'efectivo'}</td><td style="text-align:right;font-weight:600">${fL(v.total||0)}</td></tr>`).join('')}</tbody>
<tfoot><tr class="total-row"><td colspan="4">TOTAL (${ventas.length} facturas)</td><td style="text-align:right">${fL(resumen.total||0)}</td></tr></tfoot></table>
<div style="margin-top:12px;font-size:10px;color:#94a3b8;text-align:right">Powered by Metric POS</div>
</body></html>`, "Corte de Caja Carta");
}

// ─── EDITOR DE REPORTES ───────────────────────────────────────────────────────
const REPORT_TEMPLATES_KEY = 'mp_report_templates';

function getReportTemplates() {
  try { return JSON.parse(localStorage.getItem(REPORT_TEMPLATES_KEY)||'{}'); } catch(e) { return {}; }
}

function saveReportTemplate(key, html) {
  const t = getReportTemplates();
  t[key] = html;
  localStorage.setItem(REPORT_TEMPLATES_KEY, JSON.stringify(t));
}

function getDefaultTemplate(key) {
  const defaults = {
    corte_caja: '<!-- Template Corte de Caja -->\n<!-- Variables: {empresa}, {rtn}, {periodo}, {ventas}, {total} -->\n<!-- Edita el HTML a tu gusto y guarda -->',
    libro_fiscal: '<!-- Template Libro Fiscal -->\n<!-- Se generará el libro fiscal con las columnas estándar SAR Honduras -->',
    valorizacion: '<!-- Template Valorización de Inventario -->\n<!-- Muestra valor a costo, precio venta y margen -->',
    inventario_fisico: '<!-- Template Inventario Físico -->\n<!-- Lista de productos con espacio para conteo manual -->',
  };
  return defaults[key]||'<!-- Template vacío -->';
}

function cargarEditorReporte() {
  const key = document.getElementById('editor-rep-sel').value;
  const templates = getReportTemplates();
  document.getElementById('editor-reporte-textarea').value = templates[key]||getDefaultTemplate(key);
}

function guardarEditorReporte() {
  const key = document.getElementById('editor-rep-sel').value;
  const html = document.getElementById('editor-reporte-textarea').value;
  saveReportTemplate(key, html);
  alert('Template guardado correctamente.');
}

function resetEditorReporte() {
  if(!confirm('¿Restaurar el template por defecto? Se perderá la personalización.')) return;
  const key = document.getElementById('editor-rep-sel').value;
  const templates = getReportTemplates();
  delete templates[key];
  localStorage.setItem(REPORT_TEMPLATES_KEY, JSON.stringify(templates));
  cargarEditorReporte();
}

function previewEditorReporte() {
  const html = document.getElementById('editor-reporte-textarea').value;
  openPrint(html, "Corte de Caja Carta");
}

// ─── SETUP EVENTS ─────────────────────────────────────────────────────────────
function _on(id, evt, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(evt, fn);
}
function setupEvents() {
  // inv-search (existe en HTML)
  _on('inv-search', 'input', () => { if(currentView==='inventory') renderInventory(); });
  // Productos
  _on('btn-new-product', 'click', () => openProductModal(null));
  _on('prod-modal-form', 'submit', saveProduct);
  _on('prod-modal-cancel', 'click', () => closeModal('prod-modal'));
  // Clientes
  _on('btn-new-client', 'click', () => openClientModal(null));
  _on('client-modal-form', 'submit', saveClient);
  _on('client-modal-cancel', 'click', () => closeModal('client-modal'));
  // Proveedores
  _on('btn-new-supplier', 'click', () => openSupplierModal(null));
  _on('supplier-modal-form', 'submit', saveSupplier);
  _on('supplier-modal-cancel', 'click', () => closeModal('supplier-modal'));
  // Ajuste
  _on('ajuste-form', 'submit', saveAjuste);
  _on('ajuste-cancel', 'click', () => closeModal('ajuste-modal'));
  // CxC
  _on('btn-new-cxc', 'click', openCxCModal);
  _on('cxc-form', 'submit', saveCxC);
  _on('cxc-modal-cancel', 'click', () => closeModal('cxc-modal'));
  // CxP
  _on('btn-new-cxp', 'click', openCxPModal);
  _on('cxp-form', 'submit', saveCxP);
  _on('cxp-modal-cancel', 'click', () => closeModal('cxp-modal'));
  // Usuarios
  _on('btn-new-user', 'click', () => openUserModal(null));
  _on('user-modal-form', 'submit', saveUser);
  _on('user-modal-cancel', 'click', () => closeModal('user-modal'));
  // Sucursales
  _on('btn-new-branch', 'click', () => openBranchModal(null));
  _on('branch-modal-form', 'submit', saveBranch);
  _on('branch-modal-cancel', 'click', () => closeModal('branch-modal'));
  _on('branch-modal-delete', 'click', async () => {
    if (!editingBranch) return;
    if (!confirm('Eliminar la sucursal ' + editingBranch.nombre + '? Esta accion no se puede deshacer.')) return;
    try {
      await DELETE('/sucursales/' + editingBranch.id);
      closeModal('branch-modal');
      branches_cache = await GET('/sucursales');
      renderBranches();
    } catch(e) { alert('Error: ' + e.message); }
  });
  // Compras
  _on('btn-new-purchase', 'click', openPurchaseModal);
  _on('purchase-modal-form', 'submit', savePurchase);
  _on('purchase-modal-cancel', 'click', () => closeModal('purchase-modal'));
  // Devoluciones
  _on('btn-new-return', 'click', openReturnModal);
  _on('return-modal-form', 'submit', saveReturn);
  _on('return-modal-cancel', 'click', () => closeModal('return-modal'));
  // Config
  _on('config-form', 'submit', saveConfig);
  // Bancos
  _on('btn-new-banco', 'click', () => openBancoModal(null));
  _on('banco-modal-form', 'submit', saveBanco);
  _on('banco-modal-cancel', 'click', () => closeModal('banco-modal'));
  _on('movimiento-modal-form', 'submit', saveMovimiento);
  _on('movimiento-modal-cancel', 'click', () => closeModal('movimiento-modal'));
  // Impuestos
  _on('btn-new-impuesto', 'click', () => openImpuestoModal(null));
  _on('impuesto-modal-form', 'submit', saveImpuesto);
  _on('imp-modal-cancel', 'click', () => closeModal('impuesto-modal'));
  // Permisos
  _on('permisos-modal-cancel', 'click', () => closeModal('permisos-modal'));
  // Excel
  _on('excel-modal-cancel', 'click', () => { closeModal('excel-modal'); window._excelProdCache=null; document.getElementById('excel-preview').style.display='none'; document.getElementById('excel-result').style.display='none'; document.getElementById('excel-import-btn').style.display='none'; });
  // Editor Reportes
  _on('editor-reporte-cancel', 'click', () => closeModal('editor-reporte-modal'));
  _on('serie-modal-form', 'submit', guardarSerie);
  // Movimiento Caja (módulo de turnos eliminado)
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC POS v7 — FUNCIONES FALTANTES (CORREGIDAS)
// ═══════════════════════════════════════════════════════════════════════════

// ─── openPrint: abre ventana emergente para imprimir ─────────────────────
function openPrint(html, title) {
  const w = window.open('', '_blank', 'width=900,height=700,scrollbars=yes,resizable=yes');
  if (!w) {
    alert('⚠️ El navegador bloqueó la ventana emergente.\nPor favor permite las ventanas emergentes para este sitio e intenta de nuevo.');
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try { w.print(); } catch(e) {}
  }, 400);
}

// ─── getRepParams: construye query-string de fechas/sucursal ──────────────
function getRepParams() {
  const ini    = (document.getElementById('rep-fecha-ini')  || {}).value || todayHN();
  const fin    = (document.getElementById('rep-fecha-fin')  || {}).value || todayHN();
  const hIni   = (document.getElementById('rep-hora-ini')   || {}).value || '';
  const hFin   = (document.getElementById('rep-hora-fin')   || {}).value || '';
  const serie  = (document.getElementById('rep-serie')      || {}).value || '';
  let p = `sucursal_id=${USER.sucursal_id}&fecha_ini=${ini}&fecha_fin=${fin}`;
  if (hIni) p += `&hora_ini=${encodeURIComponent(hIni)}`;
  if (hFin) p += `&hora_fin=${encodeURIComponent(hFin)}`;
  if (serie) p += `&serie=${encodeURIComponent(serie)}`;
  return p;
}

// ─── renderReports: inicializa fechas del módulo de reportes ─────────────
async function renderReports() {
  const hoy = todayHN();
  const iniEl = document.getElementById('rep-fecha-ini');
  const finEl = document.getElementById('rep-fecha-fin');
  // Cargar series en el selector del reporte
  const repSerie = document.getElementById('rep-serie');
  if (repSerie) {
    try {
      const series = await GET('/series_factura', `sucursal_id=${USER.sucursal_id}`);
      repSerie.innerHTML = '<option value="">Todas las series</option>' +
        (series||[]).map(s =>
          `<option value="${s.serie}">${s.nombre || s.serie}</option>`
        ).join('');
    } catch(e) { /* sin series */ }
  }
  if (iniEl && !iniEl.value) iniEl.value = hoy.substring(0, 8) + '01'; // primer día del mes
  if (finEl && !finEl.value) finEl.value = hoy;
  // Rellenar hora por defecto si existen los campos
  const hiEl = document.getElementById('rep-hora-ini');
  const hfEl = document.getElementById('rep-hora-fin');
  if (hiEl && !hiEl.value) hiEl.value = '00:00:00';
  if (hfEl && !hfEl.value) hfEl.value = '23:59:59';
}

// ─── REIMPRESIÓN DE FACTURAS / NOTAS DE DÉBITO ───────────────────────────────
let reimpresionTipoActual = 'factura'; // 'factura' | 'nota_debito'

function abrirReimpresion(tipo) {
  reimpresionTipoActual = tipo;
  const esND = tipo === 'nota_debito';
  document.getElementById('reimpresion-modal-title').textContent =
    esND ? '🔁 Reimpresión de Notas de Débito' : '🔁 Reimpresión de Facturas';
  document.getElementById('reimpresion-modal-subtitle').textContent =
    `Buscá la ${esND?'Nota de Débito':'factura'} por número, o dejá el número en blanco para ver todas las del rango de fechas.`;
  document.getElementById('reimpresion-numero').value = '';
  // Precargar el rango de fechas con el día de hoy
  const hoy = todayHN();
  document.getElementById('reimpresion-fecha-ini').value = hoy;
  document.getElementById('reimpresion-fecha-fin').value = hoy;
  document.getElementById('reimpresion-resultados').innerHTML = '';
  openModal('reimpresion-modal');
  // Buscar automáticamente los documentos del día al abrir
  buscarReimpresion();
}

async function buscarReimpresion() {
  const numero = document.getElementById('reimpresion-numero')?.value?.trim() || '';
  const fechaIni = document.getElementById('reimpresion-fecha-ini')?.value || '';
  const fechaFin = document.getElementById('reimpresion-fecha-fin')?.value || '';
  const cont = document.getElementById('reimpresion-resultados');
  cont.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:10px">Buscando...</div>';
  try {
    let qs = `tipo=${reimpresionTipoActual}`;
    if (numero)   qs += `&numero=${encodeURIComponent(numero)}`;
    if (fechaIni) qs += `&fecha_ini=${fechaIni}`;
    if (fechaFin) qs += `&fecha_fin=${fechaFin}`;
    const resultados = await GET('/ventas/buscar_reimpresion', qs);
    if (!resultados || resultados.length === 0) {
      cont.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:10px">No se encontraron documentos con esos filtros.</div>';
      return;
    }
    const colorAccent = reimpresionTipoActual === 'nota_debito' ? '#7c3aed' : '#2563eb';
    cont.innerHTML = `<div style="font-size:11px;color:#94a3b8;margin-bottom:8px">${resultados.length} documento(s) encontrado(s)</div>` +
      resultados.map(v => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;background:#fff">
        <div>
          <div style="font-family:monospace;font-weight:700;color:${colorAccent};font-size:13px">${v.numero_factura}</div>
          <div style="font-size:12px;color:#475569;margin-top:2px">${v.cliente.nombre} ${v.cliente.rtn?'· RTN '+v.cliente.rtn:''}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:1px">${new Date(v.fecha).toLocaleDateString('es-HN')} · Total: L. ${(v.total||0).toFixed(2)}</div>
        </div>
        <button class="btn-primary" style="background:${colorAccent};white-space:nowrap" onclick='reimprimirVenta(${JSON.stringify(v).replace(/'/g,"&apos;")})'>🖨️ Reimprimir</button>
      </div>`).join('');
  } catch(e) {
    cont.innerHTML = `<div style="color:#dc2626;font-size:13px;padding:10px">Error al buscar: ${e.message}</div>`;
  }
}

function reimprimirVenta(v) {
  // Reconstruye el objeto "sale" esperado por printCarta / printNotaDebito
  const sale = {
    numero_factura: v.numero_factura,
    fecha: v.fecha,
    cliente: v.cliente,
    items: (v.items||[]).map(i => ({
      codigo: i.codigo, nombre: i.nombre, categoria: i.categoria,
      cantidad: i.cantidad, precio: i.precio, gravado: i.gravado
    })),
    importeGravado: v.importe_gravado||0,
    isv: v.isv15||0, isv18: v.isv18||0,
    descuento: v.descuento||0, total: v.total||0,
    exonerado: !!v.exonerado,
    ordenCompraExenta: v.orden_compra_exenta||'',
    constanciaRegistro: v.constancia_registro||'',
    identificativoSAG: v.identificativo_sag||'',
    // Datos aduaneros — ahora se persisten en la tabla ventas y se recuperan aquí
    aduanaPoliza: v.aduana_poliza||'', aduanaDocTransporte: v.aduana_doc_transporte||'',
    aduanaValorCIF: v.aduana_valor_cif||'', aduanaNumContenedor: v.aduana_num_contenedor||'',
    // CAI/rango propios de la serie original del documento
    serieCai: v.serieCai||'', serieRangoIni: v.serieRangoIni||'',
    serieRangoFin: v.serieRangoFin||'', serieFechaLimite: v.serieFechaLimite||'',
  };
  if (v.serieTipo === 'nota_debito' || reimpresionTipoActual === 'nota_debito') {
    printNotaDebito(sale);
  } else {
    printCarta(sale);
  }
}

// ─── CxP cache ────────────────────────────────────────────────────────────
let cxp_cache = [];

// ─── renderCxP ────────────────────────────────────────────────────────────
async function renderCxP() {
  try { cxp_cache = await GET('/cxp'); } catch(e) {}
  const total = cxp_cache.filter(c => c.estado !== 'pagado').reduce((s, c) => s + (parseFloat(c.saldo) || 0), 0);
  const venc  = cxp_cache.filter(c => c.estado !== 'pagado' && new Date(c.vencimiento) < new Date());

  const totalEl = document.getElementById('cxp-total');
  if (totalEl) totalEl.textContent = fL(total);
  const vencEl = document.getElementById('cxp-vencidas');
  if (vencEl) vencEl.textContent = venc.length + ' vencidas';

  const tbody = document.getElementById('cxp-table-body');
  if (!tbody) return;

  if (cxp_cache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#94a3b8">No hay cuentas por pagar</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  cxp_cache.forEach(c => {
    const vencida = c.estado !== 'pagado' && new Date(c.vencimiento) < new Date();
    const badge = vencida
      ? '<span class="badge badge-red">Vencida</span>'
      : c.estado === 'pagado'
        ? '<span class="badge badge-green">Pagada</span>'
        : '<span class="badge badge-amber">Pendiente</span>';

    const tr = document.createElement('tr');
    tr.dataset.id = c.id;
    tr.innerHTML =
      '<td style="font-weight:600">' + (c.proveedor_nombre || '—') + '</td>' +
      '<td style="font-size:11px;font-family:monospace">' + (c.referencia || '—') + '</td>' +
      '<td style="font-size:11px">' + fD(c.fecha) + '</td>' +
      '<td style="font-size:11px">' + fD(c.vencimiento) + '</td>' +
      '<td style="text-align:right">' + fL(c.monto) + '</td>' +
      '<td style="text-align:right;color:' + (parseFloat(c.saldo) > 0 ? '#dc2626' : '#16a34a') + ';font-weight:600">' + fL(c.saldo) + '</td>' +
      '<td>' + badge + '</td>' +
      '<td><div style="display:flex;gap:4px"></div></td>';

    const acciones = tr.querySelector('div');
    if (c.estado !== 'pagado') {
      const btnPagar = document.createElement('button');
      btnPagar.className = 'btn-primary';
      btnPagar.style.cssText = 'padding:5px 10px;font-size:11px';
      btnPagar.textContent = 'Pagar';
      btnPagar.addEventListener('click', () => pagarCxP(c.id, parseFloat(c.saldo) || 0));
      acciones.appendChild(btnPagar);
    }
    if (USER.rol === 'admin') {
      const btnDel = document.createElement('button');
      btnDel.className = 'action-btn delete';
      btnDel.textContent = '🗑️';
      btnDel.addEventListener('click', () => deleteCxP(c.id));
      acciones.appendChild(btnDel);
    }
    tbody.appendChild(tr);
  });
}

// ─── openCxPModal ─────────────────────────────────────────────────────────
async function openCxPModal() {
  let provs = [];
  try { provs = await GET('/proveedores'); } catch(e) {}
  const sel = document.getElementById('cxp-prov-sel');
  if (sel) sel.innerHTML = provs.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
  ['cxp-monto', 'cxp-vencimiento', 'cxp-referencia'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  openModal('cxp-modal');
}

// ─── saveCxP ──────────────────────────────────────────────────────────────
async function saveCxP(e) {
  e.preventDefault();
  try {
    await POST('/cxp', {
      proveedor_id: document.getElementById('cxp-prov-sel').value,
      referencia:   (document.getElementById('cxp-referencia') || {}).value || '',
      monto:        parseFloat(document.getElementById('cxp-monto').value) || 0,
      vencimiento:  document.getElementById('cxp-vencimiento').value,
    });
    closeModal('cxp-modal');
    renderCxP();
  } catch(e) { alert(e.message); }
}

// ─── pagarCxP ─────────────────────────────────────────────────────────────
async function pagarCxP(id, saldo) {
  saldo = parseFloat(saldo) || 0;
  let bancos = [];
  try { bancos = await GET('/bancos'); } catch(e) {}

  const existing = document.getElementById('pago-cxp-modal');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = 'pago-cxp-modal';
  div.className = 'modal-overlay active';

  const saldoFmt = fL(saldo);
  const saldoVal = saldo.toFixed(2);
  let bancosHtml = '<option value="">— Seleccionar banco —</option>';
  bancos.forEach(b => {
    bancosHtml += '<option value="' + b.id + '">' + b.nombre +
      (b.numero_cuenta ? ' — ' + b.numero_cuenta : '') +
      ' (L. ' + (b.saldo_actual || 0).toFixed(2) + ')</option>';
  });

  div.innerHTML =
    '<div class="modal" style="max-width:420px">' +
      '<div class="modal-header"><h3>💳 Registrar Abono — CxP</h3>' +
        '<button id="cxp-modal-cerrar" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button></div>' +
      '<div style="padding:20px;display:flex;flex-direction:column;gap:14px">' +
        '<div><label style="font-size:12px;font-weight:600;color:#64748b">Saldo pendiente</label>' +
          '<div style="font-size:20px;font-weight:700;color:#dc2626">' + saldoFmt + '</div></div>' +
        '<div><label style="font-size:12px;font-weight:600;color:#64748b">Monto a abonar</label>' +
          '<input type="number" id="cxp-pago-monto" step="0.01" min="0.01" max="' + saldoVal + '" value="' + saldoVal + '"' +
          ' style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:14px;outline:none;box-sizing:border-box;margin-top:4px"></div>' +
        '<div><label style="font-size:12px;font-weight:600;color:#64748b">Método de pago</label>' +
          '<div style="display:flex;gap:6px;margin-top:6px">' +
            '<button type="button" id="cxp-m-efectivo" style="flex:1;padding:8px 4px;font-size:11px;font-weight:600;border-radius:8px;border:2px solid #2563eb;cursor:pointer;background:#2563eb;color:#fff">💵 Efectivo</button>' +
            '<button type="button" id="cxp-m-tarjeta" style="flex:1;padding:8px 4px;font-size:11px;font-weight:600;border-radius:8px;border:1px solid #e2e8f0;cursor:pointer;background:#fff;color:#475569">💳 Tarjeta</button>' +
            '<button type="button" id="cxp-m-transferencia" style="flex:1;padding:8px 4px;font-size:11px;font-weight:600;border-radius:8px;border:1px solid #e2e8f0;cursor:pointer;background:#fff;color:#475569">🏦 Transferencia</button>' +
          '</div></div>' +
        '<div id="cxp-banco-row" style="display:none"><label style="font-size:12px;font-weight:600;color:#64748b">Banco origen</label>' +
          '<select id="cxp-pago-banco" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:12px;outline:none;margin-top:4px;box-sizing:border-box">' +
            bancosHtml + '</select></div>' +
        '<button id="cxp-confirmar-btn" style="background:#ea580c;color:#fff;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;width:100%">✅ Confirmar Pago</button>' +
      '</div></div>';

  document.body.appendChild(div);

  let metodoActual = 'efectivo';
  div.querySelector('#cxp-modal-cerrar').addEventListener('click', () => div.remove());

  const btnEf  = div.querySelector('#cxp-m-efectivo');
  const btnTj  = div.querySelector('#cxp-m-tarjeta');
  const btnTr  = div.querySelector('#cxp-m-transferencia');
  const activo   = 'background:#2563eb;color:#fff;border:2px solid #2563eb';
  const inactivo = 'background:#fff;color:#475569;border:1px solid #e2e8f0';

  function setMetodoCxP(m) {
    metodoActual = m;
    btnEf.style.cssText = 'flex:1;padding:8px 4px;font-size:11px;font-weight:600;border-radius:8px;cursor:pointer;' + (m === 'efectivo'      ? activo : inactivo);
    btnTj.style.cssText = 'flex:1;padding:8px 4px;font-size:11px;font-weight:600;border-radius:8px;cursor:pointer;' + (m === 'tarjeta'       ? activo : inactivo);
    btnTr.style.cssText = 'flex:1;padding:8px 4px;font-size:11px;font-weight:600;border-radius:8px;cursor:pointer;' + (m === 'transferencia' ? activo : inactivo);
    div.querySelector('#cxp-banco-row').style.display = m === 'transferencia' ? 'block' : 'none';
  }

  btnEf.addEventListener('click', () => setMetodoCxP('efectivo'));
  btnTj.addEventListener('click', () => setMetodoCxP('tarjeta'));
  btnTr.addEventListener('click', () => setMetodoCxP('transferencia'));

  div.querySelector('#cxp-confirmar-btn').addEventListener('click', async () => {
    const monto = parseFloat(div.querySelector('#cxp-pago-monto').value);
    if (!monto || monto <= 0) { alert('Ingrese un monto válido'); return; }
    const banco_id = metodoActual === 'transferencia'
      ? (div.querySelector('#cxp-pago-banco')?.value || null) : null;
    if (metodoActual === 'transferencia' && !banco_id) {
      alert('Seleccione el banco para la transferencia'); return;
    }
    try {
      await POST('/cxp/' + id + '/pagar', { monto, metodo: metodoActual, banco_id });
      div.remove();
      renderCxP();
    } catch(err) { alert('Error al registrar pago: ' + err.message); }
  });
}

// ─── deleteCxP ────────────────────────────────────────────────────────────
async function deleteCxP(id) {
  if (!confirm('¿Eliminar esta cuenta por pagar?')) return;
  try { await DELETE('/cxp/' + id); renderCxP(); } catch(e) { alert(e.message); }
}

// ════════════════════════════════════════════════════════════════════════════
// IMPORTACIÓN EXCEL — Clientes, Proveedores e Inventario
// Requiere SheetJS (ya incluido desde CDN en index.html)
// ════════════════════════════════════════════════════════════════════════════

// ── Utilidad: leer Excel con SheetJS ─────────────────────────────────────────
function leerExcel(inputId) {
  return new Promise((resolve, reject) => {
    const input = document.getElementById(inputId);
    if (!input || !input.files || !input.files[0]) {
      reject(new Error('No se seleccionó ningún archivo'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (typeof XLSX === 'undefined') {
          reject(new Error('La librería Excel (SheetJS) no está cargada'));
          return;
        }
        const wb   = XLSX.read(e.target.result, { type: 'binary' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        resolve(rows);
      } catch(err) {
        reject(new Error('Error al leer el archivo: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('Error al abrir el archivo'));
    reader.readAsBinaryString(input.files[0]);
  });
}

function mostrarPreview(containerId, rows, cols) {
  const el = document.getElementById(containerId);
  if (!el || !rows.length) return;
  const muestra = rows.slice(0, 5);
  el.style.display = 'block';
  el.innerHTML = `<div style="font-weight:700;color:#475569;margin-bottom:6px">
    Vista previa (${rows.length} registros encontrados):</div>` +
    muestra.map((r, i) =>
      `<div style="padding:4px 0;border-bottom:1px solid #e2e8f0;font-size:11px">
        ${i+1}. ${cols.map(c => `<b>${c}:</b> ${r[c]||'—'}`).join(' &nbsp;|&nbsp; ')}
      </div>`
    ).join('') +
    (rows.length > 5 ? `<div style="color:#94a3b8;font-size:11px;margin-top:4px">... y ${rows.length-5} más</div>` : '');
}

function mostrarResultado(containerId, result) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.style.display = 'block';
  const ok  = result.errores === 0;
  el.innerHTML = `
    <div style="background:${ok?'#f0fdf4':'#fff7ed'};border:1px solid ${ok?'#bbf7d0':'#fed7aa'};
      border-radius:8px;padding:10px 14px;font-size:13px">
      <div style="font-weight:700;color:${ok?'#15803d':'#c2410c'};margin-bottom:6px">
        ${ok?'✅':'⚠️'} Importación completada
      </div>
      <div style="color:#475569">
        ✔ Creados: <b>${result.creados||0}</b> &nbsp;|&nbsp;
        ↺ Actualizados: <b>${result.actualizados||0}</b> &nbsp;|&nbsp;
        ❌ Errores: <b>${result.errores?.length||result.errores||0}</b>
      </div>
      ${Array.isArray(result.errores) && result.errores.length ?
        `<div style="margin-top:6px;font-size:11px;color:#dc2626">${result.errores.slice(0,5).map(e=>typeof e==='object'?JSON.stringify(e):e).join('<br>')}</div>` : ''}
    </div>`;
}

// ── IMPORTAR CLIENTES ─────────────────────────────────────────────────────────
function abrirImportarClientes() {
  document.getElementById('import-clientes-file').value = '';
  document.getElementById('import-clientes-preview').style.display = 'none';
  document.getElementById('import-clientes-result').style.display  = 'none';
  openModal('import-clientes-modal');
}

async function procesarImportarClientes() {
  try {
    const rows = await leerExcel('import-clientes-file');
    if (!rows.length) { alert('El archivo está vacío o no tiene datos'); return; }
    mostrarPreview('import-clientes-preview', rows, ['nombre','rtn','telefono','email']);
    const r = await POST('/clientes/importar_excel', { clientes: rows });
    mostrarResultado('import-clientes-result', r);
    if ((r.creados||0) + (r.actualizados||0) > 0) {
      clients_cache = await GET('/clientes');
      renderClients();
    }
  } catch(e) { alert('Error: ' + e.message); }
}

// ── IMPORTAR PROVEEDORES ──────────────────────────────────────────────────────
function abrirImportarProveedores() {
  document.getElementById('import-proveedores-file').value = '';
  document.getElementById('import-proveedores-preview').style.display = 'none';
  document.getElementById('import-proveedores-result').style.display  = 'none';
  openModal('import-proveedores-modal');
}

async function procesarImportarProveedores() {
  try {
    const rows = await leerExcel('import-proveedores-file');
    if (!rows.length) { alert('El archivo está vacío o no tiene datos'); return; }
    mostrarPreview('import-proveedores-preview', rows, ['nombre','rtn','contacto','telefono']);
    const r = await POST('/proveedores/importar_excel', { proveedores: rows });
    mostrarResultado('import-proveedores-result', r);
    if ((r.creados||0) + (r.actualizados||0) > 0) renderSuppliers();
  } catch(e) { alert('Error: ' + e.message); }
}

// ── IMPORTAR INVENTARIO ───────────────────────────────────────────────────────
function abrirImportarInventario() {
  document.getElementById('import-inventario-file').value = '';
  document.getElementById('import-inventario-preview').style.display = 'none';
  document.getElementById('import-inventario-result').style.display  = 'none';
  openModal('import-inventario-modal');
}

async function procesarImportarInventario() {
  try {
    const rows = await leerExcel('import-inventario-file');
    if (!rows.length) { alert('El archivo está vacío o no tiene datos'); return; }
    mostrarPreview('import-inventario-preview', rows, ['codigo','tipo','cantidad','costo_unit']);
    const sucursal_id = USER?.sucursal_id || '';
    const r = await POST('/inventario/importar_excel', { movimientos: rows, sucursal_id });
    mostrarResultado('import-inventario-result', r);
    if ((r.procesados||0) > 0) renderInventory();
  } catch(e) { alert('Error: ' + e.message); }
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
async function renderDashboard() {
  if (!USER) return;
  const suc = USER.sucursal_id || '';

  try {
    const d = await GET('/dashboard', suc ? `sucursal_id=${suc}` : '');

    // ── Fecha subtitle ─────────────────────────────────────────────────────
    const sub = document.getElementById('dash-fecha-sub');
    if (sub) sub.textContent = `Resumen del día — ${d.fechaHoy}`;

    // ── KPIs ───────────────────────────────────────────────────────────────
    const kpi = (label, valor, color, icono, sub2 = '') => `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:4px">
        <div style="font-size:22px">${icono}</div>
        <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">${label}</div>
        <div style="font-size:22px;font-weight:800;color:${color}">${valor}</div>
        ${sub2 ? `<div style="font-size:11px;color:#94a3b8">${sub2}</div>` : ''}
      </div>`;

    document.getElementById('dash-kpis').innerHTML =
      kpi('Ventas Hoy',       d.ventasHoy?.total||0,  '#2563eb', '🧾', 'facturas emitidas') +
      kpi('Monto Hoy',        fL(d.ventasHoy?.monto||0), '#15803d', '💵', 'total cobrado hoy') +
      kpi('Ventas del Mes',   d.ventasMes?.total||0,  '#7c3aed', '📅', 'facturas del mes') +
      kpi('Monto del Mes',    fL(d.ventasMes?.monto||0), '#059669','💰', 'ingreso mensual') +
      kpi('Productos',        d.totalProds?.total||0, '#1e3a5f', '📦', 'en catálogo') +
      kpi('Stock Bajo',       d.stockBajo?.total||0,  d.stockBajo?.total>0?'#dc2626':'#15803d', '⚠️', 'bajo mínimo') +
      kpi('Clientes',         d.totalClientes?.total||0,'#0891b2','👥', 'registrados') +
      kpi('CxC Pendiente',    fL(d.cxcPendiente?.monto||0), '#d97706','📋','por cobrar');

    // ── Últimas ventas ──────────────────────────────────────────────────────
    const ultV = d.ultVentas || [];
    const fpIcon = {efectivo:'💵',tarjeta:'💳',transferencia:'🏦',credito:'📋'};
    document.getElementById('dash-ult-ventas').innerHTML = ultV.length
      ? ultV.map(v => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 14px;border-bottom:1px solid #f1f5f9">
          <div>
            <div style="font-size:12px;font-weight:700;color:#1e3a5f;font-family:monospace">${v.numero_factura}</div>
            <div style="font-size:11px;color:#64748b">${v.cliente_nombre||'Consumidor Final'}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:13px;font-weight:700;color:#15803d">${fL(v.total)}</div>
            <div style="font-size:11px;color:#94a3b8">${fpIcon[v.forma_pago]||'💵'} ${v.forma_pago||''}</div>
          </div>
        </div>`).join('')
      : '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px">Sin ventas registradas hoy</div>';

    // ── Top productos del mes ───────────────────────────────────────────────
    const topP = d.topProds || [];
    document.getElementById('dash-top-prods').innerHTML = topP.length
      ? topP.map((p, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid #f1f5f9">
          <div style="width:24px;height:24px;border-radius:50%;background:${['#1e3a5f','#2563eb','#059669','#7c3aed','#d97706','#dc2626'][i]||'#94a3b8'};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.producto_nombre}</div>
            <div style="font-size:11px;color:#94a3b8">${p.unidades} unidades</div>
          </div>
          <div style="font-size:13px;font-weight:700;color:#15803d;flex-shrink:0">${fL(p.total)}</div>
        </div>`).join('')
      : '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px">Sin ventas en el mes actual</div>';

    // ── Gráfico de barras — últimos 7 días ────────────────────────────────
    const dias7 = d.ventasPorDia || [];
    const maxMonto = Math.max(...dias7.map(x=>x.total), 1);
    document.getElementById('dash-grafico-7dias').innerHTML = dias7.length
      ? `<div style="display:flex;align-items:flex-end;gap:8px;height:120px">
          ${dias7.map(x => {
            const pct = Math.max((x.total / maxMonto) * 100, 2);
            const diaN = new Date(x.dia+'T12:00:00').toLocaleDateString('es-HN',{weekday:'short',day:'numeric'});
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
              <div style="font-size:10px;font-weight:700;color:#1e3a5f">${fL(x.total).replace('L. ','')}</div>
              <div style="width:100%;background:#2563eb;border-radius:4px 4px 0 0;height:${pct}%;min-height:4px;transition:height .3s"></div>
              <div style="font-size:10px;color:#64748b;text-align:center;white-space:nowrap">${diaN}</div>
              <div style="font-size:9px;color:#94a3b8">${x.ventas} ftrs</div>
            </div>`;
          }).join('')}
        </div>`
      : '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px">Sin datos de ventas en los últimos 7 días</div>';

  } catch(e) {
    console.error('Dashboard error:', e.message);
    document.getElementById('dash-kpis').innerHTML =
      '<div style="color:#dc2626;font-size:13px;padding:10px">Error cargando el dashboard: '+e.message+'</div>';
  }


  // ── Turnos del día con estado de tickets ────────────────────────────────
  const hoyStr = todayHN ? todayHN() : new Date().toISOString().substring(0,10);
  const fechaInput = document.getElementById('dash-turnos-fecha');
  if (fechaInput && !fechaInput.value) fechaInput.value = hoyStr;
  await _dashTurnosCargar(fechaInput ? fechaInput.value : hoyStr);
}

// ── Helpers del panel de turnos ─────────────────────────────────────────────
function _dashTurnosDia(delta) {
  const input = document.getElementById('dash-turnos-fecha');
  if (!input) return;
  const d = new Date(input.value + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  input.value = d.toISOString().substring(0,10);
  _dashTurnosCargar(input.value);
}

async function _dashTurnosCargar(fecha) {
  const hoyStr = todayHN ? todayHN() : new Date().toISOString().substring(0,10);
  if (!fecha) fecha = hoyStr;

  const input = document.getElementById('dash-turnos-fecha');
  if (input) input.value = fecha;

  const dashTurnos = document.getElementById('dash-turnos');
  if (!dashTurnos) return;
  dashTurnos.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px">Cargando...</div>';

  try {
    const suc = USER ? (USER.sucursal_id || '') : '';
    const { turnos: turnosDelDia } = await GET('/turnos/consolidado_dia', `fecha=${fecha}${suc?'&sucursal_id='+suc:''}`);

    if (!turnosDelDia || !turnosDelDia.length) {
      dashTurnos.innerHTML = `<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px">No hay turnos registrados el ${fecha}</div>`;
      return;
    }

    const todosTickets = await GET('/tickets').catch(()=>[]);
    const esHoy = fecha === hoyStr;

    dashTurnos.innerHTML = `
      ${!esHoy ? `<div style="background:#fffbeb;border-bottom:1px solid #fcd34d;padding:8px 14px;font-size:12px;color:#92400e;font-weight:600">📅 Mostrando turnos del ${fecha}</div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;padding:14px">
        ${turnosDelDia.map(t => {
          const cerrado  = t.estado === 'cerrado';
          const ticket   = todosTickets.find(tk => tk.turno_id === t.id);
          const tkEstado = ticket ? { abierto:{l:'Pendiente',c:'#dc2626',bg:'#fef2f2'}, en_revision:{l:'En Proceso',c:'#d97706',bg:'#fffbeb'}, resuelto:{l:'Resuelto',c:'#059669',bg:'#f0fdf4'} }[ticket.estado] : null;
          return `
          <div style="background:#f8fafc;border:2px solid ${cerrado?'#e2e8f0':'#22c55e'};border-radius:12px;padding:14px;position:relative">
            <div style="position:absolute;top:10px;right:10px;background:${cerrado?'#f1f5f9':'#dcfce7'};
                        color:${cerrado?'#64748b':'#15803d'};font-size:10px;font-weight:700;
                        padding:3px 8px;border-radius:99px">
              ${cerrado ? '\uD83D\uDD12 CERRADO' : '\uD83D\uDFE2 ABIERTO'}
            </div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
              <div style="width:38px;height:38px;border-radius:50%;
                          background:${cerrado?'#e2e8f0':'#22c55e'};
                          display:flex;align-items:center;justify-content:center;
                          font-size:16px;font-weight:800;color:${cerrado?'#64748b':'#fff'}">
                ${t.turno_letra||'A'}
              </div>
              <div>
                <div style="font-size:13px;font-weight:700;color:#1e293b">${t.usuario_nombre||'Cajero'}</div>
                <div style="font-size:10px;color:#94a3b8">
                  ${t.fecha_apertura?t.fecha_apertura.substring(11,16):''}
                  ${cerrado&&t.fecha_cierre?' \u2192 '+t.fecha_cierre.substring(11,16):''}
                </div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
              <div style="background:#fff;border-radius:8px;padding:7px 10px">
                <div style="font-size:9px;color:#64748b;font-weight:700">VENTAS</div>
                <div style="font-size:14px;font-weight:800;color:#1e3a5f">L.${(t.tv||0).toFixed(2)}</div>
                <div style="font-size:10px;color:#94a3b8">${t.nv||0} facturas</div>
              </div>
              <div style="background:#fff;border-radius:8px;padding:7px 10px">
                <div style="font-size:9px;color:#64748b;font-weight:700">EFECTIVO</div>
                <div style="font-size:14px;font-weight:800;color:#1d4ed8">L.${(t.te||0).toFixed(2)}</div>
                <div style="font-size:10px;color:#94a3b8">Tarj: L.${(t.tt||0).toFixed(2)}</div>
              </div>
            </div>
            ${cerrado ? `
            <div style="background:${tkEstado?tkEstado.bg:'#fef2f2'};border-radius:8px;padding:8px 10px;
                        display:flex;align-items:center;justify-content:space-between">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:11px;color:#64748b;font-weight:600">\uD83C\uDFAB Ticket:</span>
                <span style="font-size:11px;font-weight:700;color:${tkEstado?tkEstado.c:'#dc2626'}">
                  ${tkEstado ? tkEstado.l : 'Sin ticket'}
                </span>
              </div>
              ${ticket ? `
              <button onclick="verTicket('${ticket.id}')"
                style="background:${tkEstado.c};color:#fff;border:none;border-radius:6px;
                       padding:4px 10px;font-size:10px;font-weight:700;cursor:pointer">
                Ver \u2192
              </button>` : ''}
            </div>` : `
            <div style="background:#f0fdf4;border-radius:8px;padding:8px 10px;font-size:11px;color:#15803d;font-weight:600">
              \u2705 Turno en curso
            </div>`}
          </div>`;
        }).join('')}
      </div>`;
  } catch(e) {
    dashTurnos.innerHTML = '<div style="color:#dc2626;font-size:13px;padding:10px">Error: '+e.message+'</div>';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DESCARGAR PLANTILLAS EXCEL
// ════════════════════════════════════════════════════════════════════════════
function descargarPlantilla(tipo) {
  if (typeof XLSX === 'undefined') {
    alert('La librería Excel no está disponible. Recarga la página.');
    return;
  }

  const configs = {
    productos: {
      nombre: 'Plantilla_Productos.xlsx',
      encabezados: ['codigo','nombre','categoria','precio_venta','costo','gravado'],
      ejemplos: [
        ['PROD001','Aceite de Oliva 1L','Alimentos','55.00','35.00','1'],
        ['PROD002','Arroz Premium 5lb','Alimentos','85.00','55.00','1'],
        ['SERV001','Servicio de Entrega','Servicios','150.00','0','0'],
      ],
      notas: [
        [''],
        ['INSTRUCCIONES:'],
        ['codigo       → Código único del producto (requerido)'],
        ['nombre       → Nombre del producto (requerido)'],
        ['categoria    → Categoría: Alimentos, Bebidas, Servicios, Limpieza, etc.'],
        ['precio_venta → Precio de venta al público en Lempiras'],
        ['costo        → Costo de compra en Lempiras'],
        ['gravado      → 1 = Aplica ISV 15%  |  0 = Exento de ISV'],
      ]
    },
    clientes: {
      nombre: 'Plantilla_Clientes.xlsx',
      encabezados: ['nombre','rtn','direccion','telefono','email','limite_credito'],
      ejemplos: [
        ['Empresa ABC S.A.','08011234567890','Col. Palmira, Tegucigalpa','2234-5678','info@abc.hn','50000'],
        ['Juan Pérez','0801199012345','SPS, Honduras','9900-1234','juan@email.com','10000'],
        ['Supermercado XYZ','08019876543210','La Ceiba, Atlántida','2440-0000','','0'],
      ],
      notas: [
        [''],
        ['INSTRUCCIONES:'],
        ['nombre          → Nombre o razón social (requerido)'],
        ['rtn             → RTN del cliente sin guiones (14 dígitos)'],
        ['direccion       → Dirección física del cliente'],
        ['telefono        → Número de teléfono'],
        ['email           → Correo electrónico'],
        ['limite_credito  → Límite de crédito en Lempiras (0 = sin crédito)'],
      ]
    },
    proveedores: {
      nombre: 'Plantilla_Proveedores.xlsx',
      encabezados: ['nombre','rtn','contacto','telefono','email','direccion','limite_credito'],
      ejemplos: [
        ['Distribuidora Nacional','08011111111111','Carlos López','2200-0001','ventas@dist.hn','Tegucigalpa, Honduras','100000'],
        ['Importaciones del Norte','08022222222222','María Flores','2600-0002','mflores@imp.hn','SPS, Honduras','200000'],
        ['Proveedor Local SA','08033333333333','Pedro García','9900-0003','','La Ceiba','50000'],
      ],
      notas: [
        [''],
        ['INSTRUCCIONES:'],
        ['nombre          → Nombre o razón social del proveedor (requerido)'],
        ['rtn             → RTN sin guiones (14 dígitos)'],
        ['contacto        → Nombre de la persona de contacto'],
        ['telefono        → Número de teléfono'],
        ['email           → Correo electrónico'],
        ['direccion       → Dirección del proveedor'],
        ['limite_credito  → Límite de crédito en Lempiras'],
      ]
    },
    inventario: {
      nombre: 'Plantilla_Inventario.xlsx',
      encabezados: ['codigo','tipo','cantidad','costo_unit','motivo'],
      ejemplos: [
        ['PROD001','entrada','50','35.00','Compra inicial de inventario'],
        ['PROD002','entrada','100','55.00','Recepción de mercadería'],
        ['PROD001','ajuste','45','','Ajuste por conteo físico'],
      ],
      notas: [
        [''],
        ['INSTRUCCIONES:'],
        ['codigo     → Código del producto existente en el sistema (requerido)'],
        ['tipo       → "entrada" suma al stock actual  |  "ajuste" fija el stock exacto (requerido)'],
        ['cantidad   → Número entero positivo (requerido)'],
        ['costo_unit → Costo unitario en Lempiras (opcional)'],
        ['motivo     → Descripción del movimiento (opcional)'],
        [''],
        ['TIPOS DE MOVIMIENTO:'],
        ['entrada → Se SUMA al stock actual. Ej: si hay 10 y pones 50, quedará 60'],
        ['ajuste  → Se FIJA el stock exacto. Ej: si hay 10 y pones 45, quedará 45'],
      ]
    }
  };

  const cfg = configs[tipo];
  if (!cfg) return;

  const wb = XLSX.utils.book_new();

  // ── Hoja 1: Datos (para llenar y subir) ─────────────────────────────────
  const datosSheet = [cfg.encabezados, ...cfg.ejemplos];
  const ws1 = XLSX.utils.aoa_to_sheet(datosSheet);

  // Ancho automático por columna
  ws1['!cols'] = cfg.encabezados.map((h, i) => {
    const maxLen = Math.max(
      h.length,
      ...cfg.ejemplos.map(r => (r[i]||'').toString().length)
    );
    return { wch: Math.min(Math.max(maxLen + 4, 12), 40) };
  });

  XLSX.utils.book_append_sheet(wb, ws1, 'Datos');

  // ── Hoja 2: Instrucciones ─────────────────────────────────────────────────
  const instrSheet = [
    ['PLANTILLA DE IMPORTACIÓN — METRIC POS v7.4'],
    ['Módulo: ' + tipo.charAt(0).toUpperCase() + tipo.slice(1)],
    ['Generado: ' + new Date().toLocaleDateString('es-HN')],
    [''],
    ['USO:'],
    ['1. Ve a la pestaña "Datos" de este archivo'],
    ['2. Mantén los encabezados de la fila 1 exactamente como están'],
    ['3. Borra los ejemplos (fila 2 en adelante) y escribe tus datos'],
    ['4. Guarda el archivo como .xlsx'],
    ['5. En Metric POS → módulo correspondiente → botón "Importar Excel"'],
    ...cfg.notas
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(instrSheet);
  ws2['!cols'] = [{ wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Instrucciones');

  XLSX.writeFile(wb, cfg.nombre);
}

// ════════════════════════════════════════════════════════════════════════════
// GESTIÓN DE SERIES DE FACTURACIÓN
// ════════════════════════════════════════════════════════════════════════════
let editingSerieId = null;
let editingSeriesTipo = 'factura'; // track which tipo is being edited

async function renderSeriesLista() {
  await _renderSeriesListaPorTipo('factura',     'series-lista',    '#1e3a5f', '#2563eb');
  await _renderSeriesListaPorTipo('nota_debito', 'series-nd-lista', '#7c3aed', '#7c3aed');
}

async function _renderSeriesListaPorTipo(tipo, containerId, colorPrimario, colorSerie) {
  const cont = document.getElementById(containerId);
  if (!cont) return;
  try {
    const series = await GET('/series_factura', `sucursal_id=${USER.sucursal_id}&tipo=${tipo}`);
    if (!series || series.length === 0) {
      cont.innerHTML = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;text-align:center;color:#1d4ed8;font-size:13px">
          Sin series configuradas. Creá la primera serie con los datos del CAI del SAR.
        </div>`;
      return;
    }
    cont.innerHTML = series.map(s => `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 1px 3px rgba(0,0,0,.05)">
        <div>
          <div style="font-size:14px;font-weight:700;color:${colorPrimario}">${s.nombre || s.serie}</div>
          <div style="font-family:monospace;font-size:12px;color:${colorSerie};margin-top:2px">${s.serie}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">
            Rango: ${s.rango_ini || '—'} al ${s.rango_fin || '—'} · Vence: ${s.fecha_limite || '—'}
          </div>
          ${s.cai ? `<div style="font-size:10px;color:#64748b;font-family:monospace;margin-top:2px">CAI: ${s.cai}</div>` : ''}
        </div>
        <button onclick="abrirModalSerie('${s.id}','${tipo}')"
          style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;color:#475569;font-family:inherit">
          ✏️ Editar
        </button>
      </div>`).join('');
  } catch(e) {
    cont.innerHTML = `<div style="color:#dc2626;font-size:13px">Error cargando series: ${e.message}</div>`;
  }
}

async function abrirModalSerie(id, tipo) {
  editingSerieId    = id || null;
  editingSeriesTipo = tipo || 'factura';
  const esND = editingSeriesTipo === 'nota_debito';
  document.getElementById('serie-modal-title').textContent = id
    ? (esND ? 'Editar Serie — Nota de Débito' : 'Editar Serie — Factura')
    : (esND ? 'Nueva Serie de Nota de Débito'  : 'Nueva Serie de Factura');
  document.getElementById('serie-modal-delete').style.display = id ? 'inline-block' : 'none';

  if (id) {
    try {
      const series = await GET('/series_factura', `sucursal_id=${USER.sucursal_id}`);
      const s = series.find(x => x.id === id);
      if (s) {
        document.getElementById('s-nombre').value      = s.nombre || '';
        document.getElementById('s-serie').value       = s.serie || '';
        document.getElementById('s-cai').value         = s.cai || '';
        document.getElementById('s-rango-ini').value   = s.rango_ini || '';
        document.getElementById('s-rango-fin').value   = s.rango_fin || '';
        document.getElementById('s-fecha-limite').value= s.fecha_limite || '';
      }
    } catch(e) {}
  } else {
    ['s-nombre','s-serie','s-cai','s-rango-ini','s-rango-fin','s-fecha-limite']
      .forEach(fid => { document.getElementById(fid).value = ''; });
  }
  openModal('serie-modal');
}

async function guardarSerie(e) {
  e.preventDefault();
  const data = {
    nombre:       document.getElementById('s-nombre').value.trim(),
    serie:        document.getElementById('s-serie').value.trim(),
    cai:          document.getElementById('s-cai').value.trim(),
    rango_ini:    document.getElementById('s-rango-ini').value.trim(),
    rango_fin:    document.getElementById('s-rango-fin').value.trim(),
    fecha_limite: document.getElementById('s-fecha-limite').value,
    sucursal_id:  USER.sucursal_id,
    tipo:         editingSeriesTipo,
  };
  if (!data.serie) { alert('La serie es requerida'); return; }
  try {
    if (editingSerieId) await PUT('/series_factura/' + editingSerieId, data);
    else                await POST('/series_factura', data);
    closeModal('serie-modal');
    await renderSeriesLista();
    if (currentView === 'facturacion') await renderFacturacion();
    if (currentView === 'nd')          await renderNotaDebito();
  } catch(e) { alert('Error: ' + e.message); }
}

async function eliminarSerie() {
  if (!editingSerieId) return;
  if (!confirm('¿Eliminar esta serie? Ya no estará disponible.')) return;
  try {
    await DELETE('/series_factura/' + editingSerieId);
    closeModal('serie-modal');
    await renderSeriesLista();
    if (currentView === 'facturacion') await renderFacturacion();
    if (currentView === 'nd')          await renderNotaDebito();
  } catch(e) { alert('Error: ' + e.message); }
}

// Registrar el form del modal de serie
document.addEventListener('DOMContentLoaded', () => {
  _on('serie-modal-form', 'submit', guardarSerie);
});

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO: TURNOS CAJERO (A / B / C)
// ═══════════════════════════════════════════════════════════════════════════
let turnoActivoCajero = null;

async function renderTurnosCajero() {
  const v = document.getElementById('turnos-view');
  if (!v) { console.error('turnos-view no encontrado'); return; }

  // Verificar turno activo del usuario
  try {
    const ta = await GET('/turnos/activo');
    turnoActivoCajero = ta || null;
  } catch(e) { turnoActivoCajero = null; }

  // Auto-refresh cada 30 segundos si hay turno activo
  if (turnoActivoCajero && !window._turnoRefreshTimer) {
    window._turnoRefreshTimer = setInterval(async () => {
      if (currentView === 'turnos') renderTurnosCajero();
    }, 30000);
  }
  if (!turnoActivoCajero && window._turnoRefreshTimer) {
    clearInterval(window._turnoRefreshTimer);
    window._turnoRefreshTimer = null;
  }

  const numWha = await GET('/whatsapp').catch(()=>[]);

  v.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">🕐 Gestión de Turno</div>
          <div class="page-subtitle">Turno A · Turno B · Turno C</div>
        </div>
      </div>

      ${turnoActivoCajero ? `
        <!-- TURNO ACTIVO -->
        <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:14px;padding:22px 24px;margin-bottom:20px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <div style="width:48px;height:48px;background:#059669;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:800">
              ${turnoActivoCajero.turno_letra||'A'}
            </div>
            <div>
              <div style="font-size:16px;font-weight:700;color:#15803d">Turno ${turnoActivoCajero.turno_letra||'A'} — ACTIVO</div>
              <div style="font-size:12px;color:#64748b">Iniciado: ${turnoActivoCajero.fecha_apertura||'—'}</div>
            </div>
            <div style="margin-left:auto;background:#059669;color:#fff;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700">● EN CURSO</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:18px">
            <div style="background:#fff;border-radius:10px;padding:12px;text-align:center;border:1px solid #d1fae5">
              <div style="font-size:11px;color:#64748b;font-weight:600">VENTAS</div>
              <div style="font-size:20px;font-weight:800;color:#15803d">L. ${(turnoActivoCajero.total_ventas||0).toFixed(2)}</div>
            </div>
            <div style="background:#fff;border-radius:10px;padding:12px;text-align:center;border:1px solid #d1fae5">
              <div style="font-size:11px;color:#64748b;font-weight:600">EFECTIVO</div>
              <div style="font-size:20px;font-weight:800;color:#1d4ed8">L. ${(turnoActivoCajero.total_efectivo||0).toFixed(2)}</div>
            </div>
            <div style="background:#fff;border-radius:10px;padding:12px;text-align:center;border:1px solid #d1fae5">
              <div style="font-size:11px;color:#64748b;font-weight:600">TARJETA</div>
              <div style="font-size:20px;font-weight:800;color:#7c3aed">L. ${(turnoActivoCajero.total_tarjeta||0).toFixed(2)}</div>
            </div>
            <div style="background:#fff;border-radius:10px;padding:12px;text-align:center;border:1px solid #d1fae5">
              <div style="font-size:11px;color:#64748b;font-weight:600">TRANSF.</div>
              <div style="font-size:20px;font-weight:800;color:#d97706">L. ${(turnoActivoCajero.total_transferencia||0).toFixed(2)}</div>
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-primary" style="background:#dc2626;flex:1;min-width:160px"
              onclick="abrirCerrarTurno('${turnoActivoCajero.id}')">
              🔒 Finalizar Turno ${turnoActivoCajero.turno_letra||'A'}
            </button>
            ${numWha.length ? `
            <button class="btn-primary" style="background:#25d366;flex:1;min-width:160px"
              onclick="abrirEnviarWhatsApp('${turnoActivoCajero.id}')">
              📱 Enviar Corte por WhatsApp
            </button>` : ''}
          </div>
        </div>
      ` : `
        <!-- INICIAR TURNO -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px;max-width:440px">
          <div style="font-size:15px;font-weight:700;color:#1e3a5f;margin-bottom:18px">Seleccionar e Iniciar Turno</div>

          <div style="margin-bottom:16px">
            <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:8px">SELECCIONA TU TURNO</label>
            <div style="display:flex;gap:10px">
              ${['A','B','C'].map(l=>`
                <button id="turno-btn-${l}" onclick="seleccionarLetraTurno('${l}')"
                  style="flex:1;padding:16px;border-radius:10px;border:2px solid #e2e8f0;background:#f8fafc;
                         font-size:22px;font-weight:800;color:#64748b;cursor:pointer;transition:all .2s"
                  onmouseover="this.style.borderColor='#2563eb';this.style.color='#2563eb'"
                  onmouseout="if(window._turnoLetra!=='${l}'){this.style.borderColor='#e2e8f0';this.style.color='#64748b'}">
                  ${l}
                </button>`).join('')}
            </div>
          </div>

          <div class="form-field" style="margin-bottom:14px">
            <label>Fondo Inicial (L.)</label>
            <input type="number" id="turno-fondo" step="0.01" min="0" value="0"
              style="border:1px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;outline:none;width:100%;box-sizing:border-box">
          </div>
          <div style="margin-bottom:16px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#64748b">
              <input type="checkbox" id="turno-sin-fondo" style="width:16px;height:16px">
              Iniciar sin fondo (no requiere efectivo inicial)
            </label>
          </div>

          <button class="btn-primary" style="width:100%;padding:12px;font-size:14px" onclick="iniciarTurno()">
            ▶ Iniciar Turno
          </button>
        </div>
      `}
      <!-- REPORTE CONSOLIDADO DEL DÍA -->
      <div style="margin-top:24px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <div style="font-size:14px;font-weight:700;color:#1e3a5f">📊 Reporte Consolidado del Día</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <input type="date" id="cons-fecha"
              style="border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;outline:none;color:#1e3a5f">
            <button onclick="generarConsolidado()"
              style="background:#1e3a5f;color:#fff;border:none;border-radius:8px;padding:7px 16px;font-size:13px;font-weight:700;cursor:pointer">
              🔍 Ver Consolidado
            </button>
          </div>
        </div>
        <div id="consolidado-container">
          <div style="text-align:center;padding:16px;color:#94a3b8;font-size:13px">
            Selecciona una fecha y presiona Ver Consolidado
          </div>
        </div>
      </div>

      <!-- HISTORIAL DE TURNOS CERRADOS -->
      <div style="margin-top:24px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:14px;font-weight:700;color:#1e3a5f">📋 Turnos Anteriores</div>
          <button onclick="cargarHistorialTurnos()" 
            style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:5px 14px;font-size:12px;font-weight:600;color:#64748b;cursor:pointer">
            🔄 Actualizar
          </button>
        </div>
        <div id="historial-turnos-list">
          <div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px">Cargando...</div>
        </div>
      </div>
    </div>`;

  // Inicializar fecha del consolidado con hoy y cargar historial
  setTimeout(() => {
    const consF = document.getElementById('cons-fecha');
    if (consF && !consF.value) consF.value = todayHN();
    cargarHistorialTurnos();
  }, 100);
}

async function cargarHistorialTurnos() {
  const cont = document.getElementById('historial-turnos-list');
  if (!cont) return;
  try {
    const turnos = await GET('/turnos/mis_turnos', 'limite=10');
    if (!turnos.length) {
      cont.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px">No hay turnos cerrados aún</div>';
      return;
    }
    const numWha = await GET('/whatsapp').catch(()=>[]);
    cont.innerHTML = turnos.map(t => `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.05)">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div style="width:40px;height:40px;background:#f1f5f9;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#64748b">
            ${t.turno_letra||'A'}
          </div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700;color:#1e293b">
              Turno ${t.turno_letra||'A'} — ${t.usuario_nombre||'Cajero'}
            </div>
            <div style="font-size:11px;color:#94a3b8">
              Apertura: ${t.fecha_apertura||'—'} &nbsp;|&nbsp; Cierre: ${t.fecha_cierre||'—'}
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:16px;font-weight:800;color:#1e3a5f">L. ${(t.total_ventas||0).toFixed(2)}</div>
            <div style="font-size:11px;color:#94a3b8">${t.num_ventas||0} venta${(t.num_ventas||0)!==1?'s':''}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
          <div style="background:#f8fafc;border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:10px;color:#64748b;font-weight:600">EFECTIVO</div>
            <div style="font-size:14px;font-weight:700;color:#1d4ed8">L.${(t.total_efectivo||0).toFixed(2)}</div>
          </div>
          <div style="background:#f8fafc;border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:10px;color:#64748b;font-weight:600">TARJETA</div>
            <div style="font-size:14px;font-weight:700;color:#7c3aed">L.${(t.total_tarjeta||0).toFixed(2)}</div>
          </div>
          <div style="background:#f8fafc;border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:10px;color:#64748b;font-weight:600">TRANSF.</div>
            <div style="font-size:14px;font-weight:700;color:#d97706">L.${(t.total_transferencia||0).toFixed(2)}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${(t.sobrante||0)>0 ? `
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:7px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;color:#92400e;font-weight:700">💰 Sobrante:</span>
            <div style="text-align:right">
              <span style="font-size:14px;font-weight:800;color:#d97706">L.${(t.sobrante||0).toFixed(2)}</span>
              ${t.motivo_sobrante?`<div style="font-size:10px;color:#92400e">${t.motivo_sobrante}</div>`:''}
            </div>
          </div>` : ''}
          <button onclick="imprimirCorte('${t.id}')"
            style="flex:1;min-width:120px;background:#1e3a5f;color:#fff;border:none;border-radius:8px;padding:9px 12px;font-size:12px;font-weight:700;cursor:pointer">
            🖨️ Imprimir Corte
          </button>
          ${numWha.length ? `
          <button onclick="enviarCortePDF('${t.id}')"
            style="flex:1;min-width:120px;background:#25d366;color:#fff;border:none;border-radius:8px;padding:9px 12px;font-size:12px;font-weight:700;cursor:pointer">
            📱 Enviar WhatsApp
          </button>` : ''}
        </div>
      </div>`).join('');
  } catch(e) {
    const cont2 = document.getElementById('historial-turnos-list');
    if (cont2) cont2.innerHTML = '<div style="text-align:center;padding:16px;color:#dc2626;font-size:13px">Error al cargar historial</div>';
  }
}

// Imprimir corte de un turno cerrado en ventana nueva
async function imprimirCorte(turnoId) {
  try {
    const data   = await GET('/turnos/'+turnoId+'/resumen');
    const {turno, ventas} = data;
    const arr    = ventas || [];
    const totV   = arr.reduce((s,v)=>s+(parseFloat(v.total)||0),0);
    const totE   = arr.reduce((s,v)=>s+(v.forma_pago==='efectivo'?parseFloat(v.total)||0:0),0);
    const totT   = arr.reduce((s,v)=>s+(v.forma_pago==='tarjeta'?parseFloat(v.total)||0:0),0);
    const totTr  = arr.reduce((s,v)=>s+(v.forma_pago==='transferencia'?parseFloat(v.total)||0:0),0);
    const fondo  = parseFloat(turno.fondo_inicial||0);
    const empresa = USER?.empresa || 'METRIC POS';

    const win = window.open('','_blank','width=420,height=700');
    if (!win) return alert('Habilita las ventanas emergentes para imprimir');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Corte de Caja</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:'Courier New',monospace;font-size:12px;padding:16px;max-width:300px;margin:0 auto}
      h2{text-align:center;font-size:14px;margin-bottom:2px}
      h3{text-align:center;font-size:12px;margin-bottom:8px;font-weight:normal}
      .sep{border-top:1px dashed #000;margin:6px 0}
      .sep2{border-top:2px solid #000;margin:6px 0}
      .row{display:flex;justify-content:space-between;margin:3px 0;font-size:12px}
      .row b{font-weight:700}
      .center{text-align:center}
      .total{font-size:14px;font-weight:700}
      @media print{@page{size:80mm auto;margin:4mm}}
    </style></head>
    <body>
      <h2>${empresa}</h2>
      <h3>CORTE DE CAJA</h3>
      <div class="sep2"></div>
      <div class="row"><span>Turno:</span><b>${turno.turno_letra||'A'}</b></div>
      <div class="row"><span>Cajero:</span><b>${turno.usuario_nombre||'—'}</b></div>
      <div class="row"><span>Apertura:</span><span>${(turno.fecha_apertura||'—').substring(0,16)}</span></div>
      <div class="row"><span>Cierre:</span><span>${(turno.fecha_cierre||'—').substring(0,16)}</span></div>
      <div class="sep"></div>
      <div class="row"><span>N° Ventas:</span><b>${arr.length}</b></div>
      <div class="row total"><span>TOTAL VENTAS:</span><b>L.${totV.toFixed(2)}</b></div>
      <div class="sep"></div>
      <div class="row"><span>Efectivo:</span><span>L.${totE.toFixed(2)}</span></div>
      <div class="row"><span>Tarjeta:</span><span>L.${totT.toFixed(2)}</span></div>
      <div class="row"><span>Transferencia:</span><span>L.${totTr.toFixed(2)}</span></div>
      <div class="sep"></div>
      <div class="row"><span>Fondo Inicial:</span><span>L.${fondo.toFixed(2)}</span></div>
      <div class="row"><span>Efect. Esperado:</span><b>L.${(fondo+totE).toFixed(2)}</b></div>
      <div class="row"><span>Efect. Contado:</span><b>L.${(parseFloat(turno.efectivo_contado)||0).toFixed(2)}</b></div>
      <div class="sep2"></div>
      ${arr.length ? `
      <div class="center" style="font-weight:700;margin:6px 0">FACTURAS EMITIDAS</div>
      <div class="sep"></div>
      ${arr.map(v=>`
      <div class="row" style="font-size:11px">
        <span style="font-family:monospace">${(v.numero_factura||'').slice(-8)}</span>
        <span>${v.forma_pago==='efectivo'?'EFE':v.forma_pago==='tarjeta'?'TAR':'TRF'}</span>
        <b>L.${(parseFloat(v.total)||0).toFixed(2)}</b>
      </div>`).join('')}
      <div class="sep2"></div>` : ''}
      ${(parseFloat(turno.sobrante)||0)>0?`
      <div class="sep"></div>
      <div class="row" style="color:#92400e"><span>SOBRANTE:</span><b>L.${(parseFloat(turno.sobrante)||0).toFixed(2)}</b></div>
      ${turno.motivo_sobrante?'<div class="row" style="font-size:10px;color:#64748b"><span>Motivo:</span><span>'+turno.motivo_sobrante+'</span></div>':''}
      `:''}
      <div class="center" style="margin-top:8px;font-size:10px;color:#666">Powered by MetricPOS</div>
      <script>setTimeout(()=>window.print(),400);<\/script>
    </body></html>`);
    win.document.close();
  } catch(e) { alert('Error: '+e.message); }
}

window._turnoLetra = 'A';
function seleccionarLetraTurno(l) {
  window._turnoLetra = l;
  ['A','B','C'].forEach(x => {
    const b = document.getElementById('turno-btn-'+x);
    if (!b) return;
    if (x === l) {
      b.style.borderColor='#2563eb'; b.style.color='#fff'; b.style.background='#2563eb';
    } else {
      b.style.borderColor='#e2e8f0'; b.style.color='#64748b'; b.style.background='#f8fafc';
    }
  });
}

async function iniciarTurno() {
  const letra = window._turnoLetra || 'A';
  const fondo = parseFloat(document.getElementById('turno-fondo')?.value)||0;
  const sinFondo = document.getElementById('turno-sin-fondo')?.checked||false;
  try {
    await POST('/turnos/abrir', { turno_letra:letra, fondo_inicial:fondo, sin_fondo:sinFondo });
    showToastMsg(`✅ Turno ${letra} iniciado`);
    renderTurnosCajero();
  } catch(e) { alert(e.message); }
}

function abrirCerrarTurno(id) {
  // Modal de cierre con efectivo contado
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9998;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="text-align:center;margin-bottom:18px">
        <div style="font-size:36px">🔒</div>
        <div style="font-size:17px;font-weight:800;color:#1e3a5f;margin-top:6px">Finalizar Turno</div>
        <div style="font-size:12px;color:#64748b;margin-top:3px">Completa los datos de cierre</div>
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:5px">EFECTIVO CONTADO (L.)</label>
        <input type="number" id="modal-efectivo-contado" step="0.01" min="0" value="0"
          style="width:100%;border:2px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-size:18px;font-weight:700;outline:none;box-sizing:border-box;text-align:center"
          autofocus>
      </div>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px;margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:10px">💰 Sobrante de Caja</div>
        <div style="margin-bottom:10px">
          <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:5px">SOBRANTE (L.) <span style="font-weight:400;color:#94a3b8">— ej: 500.00</span></label>
          <input type="number" id="modal-sobrante" step="0.01" min="0" value="0"
            style="width:100%;border:2px solid #fde68a;border-radius:8px;padding:9px 14px;font-size:16px;font-weight:700;outline:none;box-sizing:border-box;text-align:center;background:#fffef5;color:#92400e">
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:5px">MOTIVO DEL SOBRANTE</label>
          <input type="text" id="modal-motivo-sobrante" placeholder="Ej: Diferencia de cambio, vuelto extra..."
            style="width:100%;border:2px solid #fde68a;border-radius:8px;padding:9px 14px;font-size:13px;outline:none;box-sizing:border-box;background:#fffef5;color:#78350f">
        </div>
      </div>

      <div style="display:flex;gap:8px">
        <button onclick="this.closest('div[style*=fixed]').remove()"
          style="flex:1;background:#f1f5f9;border:none;border-radius:10px;padding:12px;font-size:14px;cursor:pointer;color:#64748b;font-weight:600">
          Cancelar
        </button>
        <button id="btn-confirmar-cierre"
          style="flex:1;background:#dc2626;border:none;border-radius:10px;padding:12px;font-size:14px;cursor:pointer;color:#fff;font-weight:800">
          🔒 Confirmar Cierre
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Foco en el input
  setTimeout(()=>{ const inp=document.getElementById('modal-efectivo-contado'); if(inp) inp.select(); },100);

  document.getElementById('btn-confirmar-cierre').onclick = async () => {
    const ef       = parseFloat(document.getElementById('modal-efectivo-contado').value)||0;
    const sobrante = parseFloat(document.getElementById('modal-sobrante').value)||0;
    const motivo   = (document.getElementById('modal-motivo-sobrante')?.value||'').trim();
    overlay.remove();
    await cerrarTurnoCajero(id, ef, sobrante, motivo);
  };
}

async function cerrarTurnoCajero(id, efectivo_contado, sobrante=0, motivo_sobrante='') {
  try {
    const r = await POST(`/turnos/${id}/cerrar`, { efectivo_contado, sobrante, motivo_sobrante });
    showToastMsg('🔒 Turno cerrado correctamente');

    // Recargar vista inmediatamente — sin esperar WhatsApp ni ticket
    renderTurnosCajero();

    // Crear ticket y enviar WhatsApp en paralelo (sin bloquear la UI)
    (async () => {
      try {
        const resumen = await GET(`/turnos/${id}/resumen`);
        const { turno, ventas } = resumen;
        const totV = (ventas||[]).reduce((s,v)=>s+(parseFloat(v.total)||0),0);
        crearTicketDeTurno(id, turno.turno_letra||'A', turno.fecha_cierre||'', totV, turno, ventas||[]);
      } catch(e) { console.error('Error creando ticket turno:', e.message); }
    })();

    // Envío WhatsApp completamente desacoplado — no bloquea el historial
    enviarReportesAlCerrar(id).catch(e => console.error('WhatsApp cierre:', e.message));
  } catch(e) { alert(e.message); }
}

// Enviar corte por WhatsApp
async function abrirEnviarWhatsApp(turnoId) {
  const numeros = await GET('/whatsapp').catch(()=>[]);
  if (!numeros.length) return alert('No hay números de WhatsApp configurados. Pide al administrador que los agregue.');

  const opciones = numeros.map((n,i)=>`${i+1}. ${n.nombre} — ${n.numero}`).join('\n');
  const sel = prompt(`Selecciona el número (1-${numeros.length}):\n\n${opciones}`);
  if (!sel) return;
  const idx = parseInt(sel)-1;
  if (idx < 0 || idx >= numeros.length) return alert('Opción inválida');

  await enviarCortePDF(turnoId);
}

// ── Helper: armar texto de corte de caja formato ticket ──────────────────────
function _textoCorte(turno, ventas) {
  const arr = ventas || [];
  const totVentas = arr.reduce((s,v)=>s+(parseFloat(v.total)||0),0);
  const totEfect  = arr.reduce((s,v)=>s+(v.forma_pago==='efectivo'?parseFloat(v.total)||0:0),0);
  const totTarj   = arr.reduce((s,v)=>s+(v.forma_pago==='tarjeta'?parseFloat(v.total)||0:0),0);
  const totTransf = arr.reduce((s,v)=>s+(v.forma_pago==='transferencia'?parseFloat(v.total)||0:0),0);
  const fondo     = parseFloat(turno.fondo_inicial||0);
  const esperado  = fondo + totEfect;
  const empresa   = USER?.empresa || 'METRIC POS';
  const sep32     = '================================';
  const sep16     = '--------------------------------';
  function pad(l, r, w) {
    const sp = Math.max(1, w - l.length - r.length);
    return l + ' '.repeat(sp) + r;
  }
  const lines = [
    sep32,
    empresa.toUpperCase().padStart(Math.ceil((32+empresa.length)/2)).padEnd(32),
    'CORTE DE CAJA'.padStart(Math.ceil((32+13)/2)).padEnd(32),
    sep16,
    pad('Turno:', turno.turno_letra||'A', 32),
    pad('Cajero:', turno.usuario_nombre||'—', 32),
    pad('Apertura:', (turno.fecha_apertura||'—').substring(0,16), 32),
    pad('Cierre:', (turno.fecha_cierre||'En curso').substring(0,16), 32),
    sep16,
    pad('N° Ventas:', String(arr.length), 32),
    pad('TOTAL VENTAS:', 'L.'+totVentas.toFixed(2), 32),
    sep16,
    pad('Efectivo:', 'L.'+totEfect.toFixed(2), 32),
    pad('Tarjeta:', 'L.'+totTarj.toFixed(2), 32),
    pad('Transferencia:', 'L.'+totTransf.toFixed(2), 32),
    sep16,
    pad('Fondo Inicial:', 'L.'+fondo.toFixed(2), 32),
    pad('Efectivo Esperado:', 'L.'+esperado.toFixed(2), 32),
    sep32,
    'Powered by MetricPOS'.padStart(26),
    sep32,
  ];
  return '```\n' + lines.join('\n') + '\n```';
}

// ── Helper: armar texto de artículos vendidos formato ticket ─────────────────
async function _textoArticulos(turnoId, turno, ventas) {
  const arr = ventas || [];
  const empresa = USER?.empresa || 'METRIC POS';
  const W       = 42; // ancho total de línea — más amplio para código+nombre
  const sep     = '='.repeat(W);
  const sep2    = '-'.repeat(W);
  function pad(l,r,w){ const sp=Math.max(1,w-l.length-r.length); return l+' '.repeat(sp)+r; }

  // Agrupar artículos de todas las facturas del turno
  const articulos = {};
  for (const v of arr) {
    try {
      const items = await GET('/ventas/'+v.id+'/items');
      for (const item of items) {
        const key = item.producto_id || item.codigo || item.producto_nombre || item.nombre || 'Artículo';
        if (!articulos[key]) articulos[key] = {
          cant:0, total:0,
          precio: parseFloat(item.precio_unit||item.precio||0),
          nombre: item.producto_nombre || item.nombre || 'Artículo',
          codigo: item.codigo || item.producto_codigo || item.sku || ''
        };
        const cant  = parseInt(item.cantidad||1);
        const precio = parseFloat(item.precio_unit||item.precio||0);
        articulos[key].cant  += cant;
        articulos[key].total += cant * precio;
      }
    } catch(e) { /* si falla un detalle, continuar */ }
  }

  const totVentas = arr.reduce((s,v)=>s+(parseFloat(v.total)||0),0);
  const lines = [
    sep,
    empresa.toUpperCase().padStart(Math.ceil((W+empresa.length)/2)).padEnd(W),
    'ARTICULOS VENDIDOS'.padStart(Math.ceil((W+18)/2)).padEnd(W),
    pad('Turno:',turno.turno_letra||'A',W),
    pad('Cajero:',turno.usuario_nombre||'—',W),
    sep2,
    pad('COD  PRODUCTO','CANT   TOTAL',W),
    sep2,
  ];

  const sorted = Object.entries(articulos).sort((a,b)=>b[1].total-a[1].total);
  for (const [, data] of sorted) {
    // Línea 1: código + nombre (sin truncar código)
    const cod = data.codigo ? data.codigo+' ' : '';
    const nomDisp = W - cod.length > 6 ? data.nombre.substring(0, W - cod.length - 2) : data.nombre.substring(0,10);
    lines.push(cod + nomDisp);
    // Línea 2: cantidad y total alineados a la derecha
    const val = '  → '+data.cant+'u  L.'+data.total.toFixed(2);
    lines.push(val);
  }

  if (!sorted.length) lines.push('  Sin articulos registrados');
  lines.push(sep2);
  lines.push(pad('TOTAL GENERAL:', 'L.'+totVentas.toFixed(2), W));
  lines.push(pad('N° Facturas:', String(arr.length), W));
  lines.push(sep);
  lines.push('Powered by MetricPOS'.padStart(W-2));
  lines.push(sep);

  return '```\n' + lines.join('\n') + '\n```';
}

// ── Enviar los 2 reportes al cerrar turno (automático) ───────────────────────
async function enviarReportesAlCerrar(turnoId) {
  const numeros = await GET('/whatsapp').catch(()=>[]);
  if (!numeros.length) return; // Sin números configurados

  // Verificar si hay al menos un número con API Key de TextMeBot
  const conApiKey = numeros.filter(n => n.callmebot_apikey);

  if (conApiKey.length > 0) {
    // ── Envío automático vía TextMeBot (sin abrir WhatsApp) ──
    try {
      const data    = await GET('/turnos/'+turnoId+'/resumen');
      const {turno, ventas} = data;
      const msgCorte    = _textoCorte(turno, ventas).replace(/```\n/g,'').replace(/\n```/g,'');
      const msgArticulos = (await _textoArticulos(turnoId, turno, ventas)).replace(/```\n/g,'').replace(/\n```/g,'');

      // Llamar al endpoint del servidor que hace el envío masivo
      const resultado = await POST('/whatsapp/send-turno', {
        turno_id: turnoId,
        mensaje_corte: msgCorte,
        mensaje_articulos: msgArticulos
      });

      if (resultado.enviados > 0) {
        showToastMsg(`📱 Reportes enviados por WhatsApp a ${resultado.enviados} número${resultado.enviados>1?'s':''}`);
      }

      // Si además hay números SIN apikey, mostrar modal para esos
      const sinApiKey = numeros.filter(n => !n.callmebot_apikey);
      if (sinApiKey.length > 0) {
        await _mostrarModalReportes(turnoId, sinApiKey, true);
      }
    } catch(e) {
      console.error('Error envío TextMeBot:', e.message);
      // Fallback: modal manual
      await _mostrarModalReportes(turnoId, numeros, true);
    }
  } else {
    // Sin apikeys — modal tradicional
    await _mostrarModalReportes(turnoId, numeros, true);
  }
}

// ── Envío manual desde el botón del turno ────────────────────────────────────
async function enviarCortePDF(turnoId) {
  const numeros = await GET('/whatsapp').catch(()=>[]);
  if (!numeros.length) return alert('No hay números de WhatsApp configurados. Agrégalos en el módulo WhatsApp.');
  await _mostrarModalReportes(turnoId, numeros, false);
}

// ── Modal principal con los 2 reportes ───────────────────────────────────────
async function _mostrarModalReportes(turnoId, numeros, autoCierre) {
  try {
    const data = await GET('/turnos/'+turnoId+'/resumen');
    const {turno, ventas} = data;

    const textoCorte     = _textoCorte(turno, ventas);
    const textoArticulos = await _textoArticulos(turnoId, turno, ventas);

    // Botón por cada número (con TextMeBot si tiene API Key)
    const _rawCorte = textoCorte.replace(/```\n/g,'').replace(/\n```/g,'');
    const _rawArts  = textoArticulos.replace(/```\n/g,'').replace(/\n```/g,'');
    const botonesHTML = numeros.map(function(wa) {
      const t  = wa.numero.replace(/[^0-9]/g,'');
      const uc = 'https://wa.me/'+t+'?text='+encodeURIComponent(textoCorte);
      const ua = 'https://wa.me/'+t+'?text='+encodeURIComponent(textoArticulos);
      const tieneKey = !!wa.callmebot_apikey;
      const btnAuto = tieneKey
        ? '<button id="cbtn-'+t+'" onclick="_enviarCBManual(\''+wa.numero+'\',\''+wa.callmebot_apikey+'\',\''+t+'\')" '
          +'style="width:100%;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:none;border-radius:8px;'
          +'padding:10px;font-weight:700;font-size:13px;cursor:pointer;margin-bottom:6px">⚡ Enviar automáticamente (TextMeBot)</button>'
        : '';
      const badge = tieneKey
        ? '<span style="margin-left:auto;background:#dcfce7;color:#059669;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px">AUTO</span>'
        : '';
      return '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:6px">'
        +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
        +'<span style="font-size:12px;font-weight:700;color:#1e3a5f">'+(tieneKey?'⚡':'📱')+' '+wa.nombre+'</span>'
        +'<span style="font-family:monospace;font-size:11px;color:#94a3b8">'+wa.numero+'</span>'
        +badge+'</div>'
        +btnAuto
        +'<div style="display:flex;gap:8px">'
        +'<a href="'+uc+'" target="_blank" style="flex:1;display:block;background:#25d366;color:#fff;padding:8px 4px;border-radius:8px;text-decoration:none;font-weight:700;font-size:11px;text-align:center">🧾 Corte (WA)</a>'
        +'<a href="'+ua+'" target="_blank" style="flex:1;display:block;background:#2563eb;color:#fff;padding:8px 4px;border-radius:8px;text-decoration:none;font-weight:700;font-size:11px;text-align:center">📦 Artículos (WA)</a>'
        +'</div></div>';
    }).join('');

    window._enviarCBManual = async function(numero, apikey, tid) {
      const btn = document.getElementById('cbtn-'+tid);
      if (btn) { btn.disabled=true; btn.textContent='📤 Enviando corte...'; }
      try {
        await POST('/whatsapp/send', { numero, apikey, mensaje: _rawCorte });
        if (btn) btn.textContent='📤 Enviando artículos (espera 3s)...';
        await new Promise(r=>setTimeout(r,3500));
        await POST('/whatsapp/send', { numero, apikey, mensaje: _rawArts });
        if (btn) { btn.textContent='✅ Enviado'; btn.style.background='#059669'; }
        showToastMsg('✅ Reportes enviados correctamente por WhatsApp');
      } catch(e) {
        if (btn) { btn.disabled=false; btn.textContent='⚡ Enviar automáticamente (TextMeBot)'; }
        alert('Error TextMeBot: ' + e.message);
      }
    };
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:0;max-width:460px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden;max-height:90vh;display:flex;flex-direction:column">

        <!-- Header -->
        <div style="background:#1e3a5f;padding:18px 22px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:16px;font-weight:800;color:#fff">📱 Enviar Reportes por WhatsApp</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px">${numeros.length} número${numeros.length>1?"s":""} configurado${numeros.length>1?"s":""}</div>
          </div>
          <button onclick="this.closest('div[style*=fixed]').remove()"
            style="background:rgba(255,255,255,.15);border:none;border-radius:8px;padding:6px 12px;color:#fff;cursor:pointer;font-size:16px">✕</button>
        </div>

        <!-- Tabs -->
        <div style="display:flex;border-bottom:2px solid #e2e8f0">
          <button id="tab-corte" onclick="switchTab('corte')"
            style="flex:1;padding:11px;border:none;background:#f0fdf4;color:#059669;font-weight:700;font-size:13px;cursor:pointer;border-bottom:3px solid #059669">
            🧾 Corte de Caja
          </button>
          <button id="tab-arts" onclick="switchTab('arts')"
            style="flex:1;padding:11px;border:none;background:#f8fafc;color:#64748b;font-weight:700;font-size:13px;cursor:pointer;border-bottom:3px solid transparent">
            📦 Artículos Vendidos
          </button>
        </div>

        <!-- Preview corte -->
        <div id="panel-corte" style="flex:1;overflow-y:auto;padding:14px">
          <pre style="font-family:monospace;font-size:11px;color:#15803d;background:#f0fdf4;border-radius:8px;padding:12px;margin:0;line-height:1.5;white-space:pre-wrap">${textoCorte.replace(/\`\`\`\n/g,'').replace(/\n\`\`\`/g,'')}</pre>
        </div>

        <!-- Preview artículos -->
        <div id="panel-arts" style="flex:1;overflow-y:auto;padding:14px;display:none">
          <pre style="font-family:monospace;font-size:11px;color:#1d4ed8;background:#eff6ff;border-radius:8px;padding:12px;margin:0;line-height:1.5;white-space:pre-wrap">${textoArticulos.replace(/\`\`\`\n/g,'').replace(/\n\`\`\`/g,'')}</pre>
        </div>

        <!-- Botones -->
        <div style="padding:14px 18px;border-top:1px solid #e2e8f0;display:flex;flex-direction:column;gap:8px">
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Selecciona a quién enviar:</div>
          ${botonesHTML}
          <button onclick="this.closest('div[style*=fixed]').remove()"
            style="background:#f1f5f9;border:none;border-radius:10px;padding:11px;font-size:13px;cursor:pointer;color:#64748b;font-weight:600;margin-top:4px">
            Cerrar
          </button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });

    // Función de tabs
    window.switchTab = function(tab) {
      document.getElementById('panel-corte').style.display = tab==='corte'?'block':'none';
      document.getElementById('panel-arts').style.display  = tab==='arts'?'block':'none';
      document.getElementById('tab-corte').style.borderBottomColor = tab==='corte'?'#059669':'transparent';
      document.getElementById('tab-corte').style.background = tab==='corte'?'#f0fdf4':'#f8fafc';
      document.getElementById('tab-corte').style.color = tab==='corte'?'#059669':'#64748b';
      document.getElementById('tab-arts').style.borderBottomColor = tab==='arts'?'#2563eb':'transparent';
      document.getElementById('tab-arts').style.background = tab==='arts'?'#eff6ff':'#f8fafc';
      document.getElementById('tab-arts').style.color = tab==='arts'?'#2563eb':'#64748b';
    };

  } catch(e) { if(!autoCierre) alert('Error: '+e.message); }
}

function _htmlCortePDF(turno, ventas) {
  // Calcular totales directamente desde las ventas (no desde la tabla turnos que es 0 en turno abierto)
  const arr = ventas || [];
  const totVentas  = arr.reduce((s,v)=>s+(parseFloat(v.total)||0), 0);
  const totEfect   = arr.reduce((s,v)=>s+(v.forma_pago==='efectivo'?parseFloat(v.total)||0:0), 0);
  const totTarjeta = arr.reduce((s,v)=>s+(v.forma_pago==='tarjeta'?parseFloat(v.total)||0:0), 0);
  const totTransf  = arr.reduce((s,v)=>s+(v.forma_pago==='transferencia'?parseFloat(v.total)||0:0), 0);
  const fondoIni   = parseFloat(turno.fondo_inicial||0);
  const efecEsper  = fondoIni + totEfect;
  const suc = turno.sucursal_nombre || USER?.sucursal || '';
  return `
    <h2>${USER?.empresa || 'METRIC POS'}</h2>
    <h3>CORTE DE CAJA</h3>
    <p style="text-align:center;color:#64748b;font-size:11px">
      Turno ${turno.turno_letra||'A'} — ${turno.usuario_nombre||'Cajero'}<br>
      Apertura: ${turno.fecha_apertura||''}<br>
      Cierre: ${turno.fecha_cierre||'En curso'}
    </p>
    <hr>
    <table>
      <tr><td>N° Ventas</td><td class="right tot">${arr.length}</td></tr>
      <tr><td>Total Ventas</td><td class="right tot">L. ${totVentas.toFixed(2)}</td></tr>
      <tr><td>Efectivo</td><td class="right">L. ${totEfect.toFixed(2)}</td></tr>
      <tr><td>Tarjeta</td><td class="right">L. ${totTarjeta.toFixed(2)}</td></tr>
      <tr><td>Transferencia</td><td class="right">L. ${totTransf.toFixed(2)}</td></tr>
      <tr><td>Fondo Inicial</td><td class="right">L. ${fondoIni.toFixed(2)}</td></tr>
      <tr><td>Efectivo Esperado</td><td class="right">L. ${efecEsper.toFixed(2)}</td></tr>
    </table>
    ${ventas?.length ? `
    <h3 style="margin-top:16px">Detalle de Facturas</h3>
    <table>
      <thead><tr><th>Factura</th><th>Cliente</th><th>Forma Pago</th><th class="right">Total</th></tr></thead>
      <tbody>
        ${ventas.map(v=>`<tr>
          <td style="font-family:monospace;font-size:10px">${v.numero_factura||''}</td>
          <td>${v.cliente_nombre||'Consumidor Final'}</td>
          <td>${v.forma_pago||''}</td>
          <td class="right">L. ${(v.total||0).toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : ''}
    <p style="text-align:center;margin-top:16px;font-size:10px;color:#94a3b8">Powered by MetricPOS</p>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO: WHATSAPP (Admin)
// ═══════════════════════════════════════════════════════════════════════════
async function renderWhatsApp() {
  const v = document.getElementById('whatsapp-view');
  if (!v) { console.error('whatsapp-view no encontrado'); return; }
  const lista = await GET('/whatsapp').catch(()=>[]);
  v.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">📱 Números de WhatsApp</div>
          <div class="page-subtitle">Envío automático + PDF vía TextMeBot al cerrar turno</div>
        </div>
        <button class="btn-primary" onclick="abrirModalWhatsApp()">+ Agregar Número</button>
      </div>

      <!-- Instrucciones TextMeBot -->
      <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:14px 18px;margin-bottom:18px">
        <div style="font-size:13px;font-weight:700;color:#92400e;margin-bottom:6px">⚡ ¿Cómo activar el envío automático con TextMeBot?</div>
        <div style="font-size:12px;color:#78350f;line-height:1.7">
          1. Ve a <b>textmebot.com</b> y obtén tu API Key (trial gratuito disponible)<br>
          2. Activa tu número enviando el mensaje que te indiquen al bot de TextMeBot<br>
          3. Agrega tu API Key en cada número configurado aquí<br>
          4. Al cerrar turno, los reportes se enviarán <b>automáticamente con PDF adjunto</b> 📄
        </div>
        <a href="https://textmebot.com" target="_blank"
          style="font-size:11px;color:#2563eb;text-decoration:underline">📖 Ver TextMeBot — desde $1/mes →</a>
      </div>

      <!-- ═══════════════════ RESUMEN SEMANAL — CallMeBot (gratis) ═══════════════════ -->
      <div style="background:#fff;border:2px solid #16a34a;border-radius:14px;padding:18px;margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <div style="font-size:15px;font-weight:800;color:#15803d">🆓 Resumen Semanal — CallMeBot (100% Gratis)</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px">Cada Lunes 8:00am se envía el total de Facturas, Notas de Débito y Órdenes de Compra de la semana</div>
          </div>
          <button class="btn-primary" style="background:#16a34a;flex-shrink:0" onclick="abrirModalResumenDest()">+ Agregar Número</button>
        </div>

        <!-- Instrucciones CallMeBot -->
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;margin-bottom:14px">
          <div style="font-size:12px;font-weight:700;color:#15803d;margin-bottom:6px">📲 ¿Cómo obtener tu API Key gratis de CallMeBot?</div>
          <div style="font-size:11.5px;color:#166534;line-height:1.7">
            1. Agregá este número a tus contactos: <b>+34 684 72 39 62</b><br>
            2. Desde tu WhatsApp, enviale el mensaje: <code style="background:#dcfce7;padding:1px 5px;border-radius:4px">I allow callmebot to send me messages</code><br>
            3. El bot te va a responder con tu <b>API Key</b> (puede tardar hasta 2 minutos)<br>
            4. Pegá ese número y esa API Key aquí abajo con "+ Agregar Número"
          </div>
        </div>

        <div id="resumen-dest-lista" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px"></div>

        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button onclick="verPreviewResumen()" style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer">👁️ Vista Previa del Mensaje</button>
          <button onclick="enviarResumenAhora()" style="background:#16a34a;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer">📤 Enviar Ahora</button>
        </div>

        <div id="resumen-log-cont" style="margin-top:14px"></div>
      </div>

      ${lista.length === 0 ? `
        <div style="text-align:center;padding:40px;color:#94a3b8">No hay números configurados aún</div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:10px">
          ${lista.map(n=>`
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;
                        box-shadow:0 1px 3px rgba(0,0,0,.05)">
              <div style="display:flex;align-items:center;gap:14px;margin-bottom:${n.callmebot_apikey?'10':'0'}px">
                <div style="width:42px;height:42px;background:${n.callmebot_apikey?'#dcfce7':'#f1f5f9'};border-radius:50%;
                            display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">
                  ${n.callmebot_apikey?'⚡':'📱'}
                </div>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:700;color:#1e293b;font-size:14px">${n.nombre}</div>
                  <div style="font-size:12px;color:#64748b;font-family:monospace">${n.numero}</div>
                  <div style="font-size:11px;margin-top:2px;font-weight:600;
                              color:${n.callmebot_apikey?'#059669':'#dc2626'}">
                    ${n.callmebot_apikey?'✅ Envío automático + PDF activado':'⚠️ Sin API Key — solo envío manual'}
                  </div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0">
                  <a href="https://wa.me/${n.numero.replace(/[^0-9]/g,'')}" target="_blank"
                    style="background:#25d366;color:#fff;border:none;border-radius:8px;padding:7px 12px;
                           font-size:12px;font-weight:700;cursor:pointer;text-decoration:none">💬</a>
                  <button onclick="abrirModalApiKey('${n.id}','${n.callmebot_apikey||''}')"
                    style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:8px;
                           padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer">⚡ API Key</button>
                  <button onclick="eliminarWhatsApp('${n.id}')"
                    style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:8px;
                           padding:7px 10px;font-size:12px;font-weight:700;cursor:pointer">🗑️</button>
                </div>
              </div>
              ${n.callmebot_apikey ? `
              <div style="background:#f0fdf4;border-radius:8px;padding:7px 12px;display:flex;align-items:center;gap:8px">
                <span style="font-size:11px;color:#64748b;font-weight:600">API Key:</span>
                <span style="font-family:monospace;font-size:12px;color:#059669;letter-spacing:1px">${'•'.repeat(n.callmebot_apikey.length)}</span>
                <button onclick="probarCallmebot('${n.id}','${n.numero}','${n.callmebot_apikey}')"
                  style="margin-left:auto;background:#059669;color:#fff;border:none;border-radius:6px;
                         padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">🔔 Probar</button>
              </div>` : ''}
            </div>`).join('')}
        </div>
      `}

      <!-- Modal agregar número -->
      <div id="wa-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:14px;padding:24px;width:90%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.2)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
            <h3 style="margin:0;color:#1e3a5f">Agregar Número WhatsApp</h3>
            <button onclick="document.getElementById('wa-modal').style.display='none'"
              style="background:none;border:none;font-size:20px;cursor:pointer;color:#94a3b8">✕</button>
          </div>
          <div class="form-field" style="margin-bottom:14px">
            <label>Nombre / Descripción *</label>
            <input type="text" id="wa-nombre" placeholder="Ej: Supervisor Pedro" required>
          </div>
          <div class="form-field" style="margin-bottom:14px">
            <label>Número WhatsApp * (con código de país)</label>
            <input type="text" id="wa-numero" placeholder="50498765432">
            <small style="color:#94a3b8;font-size:11px">Sin +, sin guiones. Ej: 50498765432</small>
          </div>
          <div class="form-field" style="margin-bottom:6px">
            <label>API Key de TextMeBot <span style="font-weight:400;color:#94a3b8">(opcional, activa envío automático)</span></label>
            <input type="text" id="wa-apikey" placeholder="Ej: 123456">
            <small style="color:#94a3b8;font-size:11px">Obtenla en <b>textmebot.com</b> — trial gratuito disponible</small>
          </div>
          <div style="display:flex;gap:8px;margin-top:18px">
            <button class="btn-cancel" style="flex:1" onclick="document.getElementById('wa-modal').style.display='none'">Cancelar</button>
            <button class="btn-primary" style="flex:1" onclick="guardarWhatsApp()">💾 Guardar</button>
          </div>
        </div>
      </div>

      <!-- Modal editar API Key -->
      <div id="wa-apikey-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:14px;padding:24px;width:90%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.2)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h3 style="margin:0;color:#1e3a5f">⚡ API Key TextMeBot</h3>
            <button onclick="document.getElementById('wa-apikey-modal').style.display='none'"
              style="background:none;border:none;font-size:20px;cursor:pointer;color:#94a3b8">✕</button>
          </div>
          <p style="font-size:12px;color:#64748b;margin:0 0 14px">Pega aquí la API Key que recibiste de TextMeBot.</p>
          <input type="text" id="wa-apikey-edit" placeholder="Ej: 123456"
            style="width:100%;border:2px solid #2563eb;border-radius:8px;padding:10px 12px;font-size:15px;font-family:monospace;outline:none;box-sizing:border-box">
          <input type="hidden" id="wa-apikey-id">
          <div style="display:flex;gap:8px;margin-top:16px">
            <button class="btn-cancel" style="flex:1" onclick="document.getElementById('wa-apikey-modal').style.display='none'">Cancelar</button>
            <button class="btn-primary" style="flex:1" onclick="guardarApiKey()">💾 Guardar API Key</button>
          </div>
        </div>
      </div>

      <!-- Modal agregar destinatario CallMeBot (Resumen Semanal) -->
      <div id="resumen-dest-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:14px;padding:24px;width:90%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.2)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
            <h3 style="margin:0;color:#15803d">🆓 Destinatario CallMeBot</h3>
            <button onclick="document.getElementById('resumen-dest-modal').style.display='none'"
              style="background:none;border:none;font-size:20px;cursor:pointer;color:#94a3b8">✕</button>
          </div>
          <div class="form-field" style="margin-bottom:14px">
            <label>Nombre / Descripción *</label>
            <input type="text" id="rd-nombre" placeholder="Ej: Pedro - Gerente">
          </div>
          <div class="form-field" style="margin-bottom:14px">
            <label>Número WhatsApp * (con código de país)</label>
            <input type="text" id="rd-numero" placeholder="50498765432">
            <small style="color:#94a3b8;font-size:11px">Sin +, sin guiones. Ej: 50498765432</small>
          </div>
          <div class="form-field" style="margin-bottom:6px">
            <label>API Key de CallMeBot *</label>
            <input type="text" id="rd-apikey" placeholder="Ej: 123123">
            <small style="color:#94a3b8;font-size:11px">La recibís por WhatsApp al activar el bot (ver instrucciones arriba)</small>
          </div>
          <div style="display:flex;gap:8px;margin-top:18px">
            <button class="btn-cancel" style="flex:1" onclick="document.getElementById('resumen-dest-modal').style.display='none'">Cancelar</button>
            <button class="btn-primary" style="flex:1;background:#16a34a" onclick="guardarResumenDest()">💾 Guardar</button>
          </div>
        </div>
      </div>
    </div>`;

  renderResumenDestLista();
  renderResumenLog();
}

function abrirModalWhatsApp() {
  document.getElementById('wa-modal').style.display='flex';
  document.getElementById('wa-nombre').value='';
  document.getElementById('wa-numero').value='';
}

async function guardarWhatsApp() {
  const nombre  = document.getElementById('wa-nombre')?.value.trim();
  const numero  = document.getElementById('wa-numero')?.value.trim().replace(/[^0-9]/g,'');
  const apikey  = document.getElementById('wa-apikey')?.value.trim();
  if (!nombre||!numero) return alert('Nombre y número son requeridos');
  try {
    await POST('/whatsapp', { nombre, numero, callmebot_apikey: apikey||null });
    showToastMsg('✅ Número agregado');
    document.getElementById('wa-modal').style.display='none';
    renderWhatsApp();
  } catch(e) { alert(e.message); }
}

function abrirModalApiKey(id, keyActual) {
  document.getElementById('wa-apikey-id').value = id;
  document.getElementById('wa-apikey-edit').value = keyActual || '';
  document.getElementById('wa-apikey-modal').style.display = 'flex';
  setTimeout(()=>document.getElementById('wa-apikey-edit').focus(), 100);
}

async function guardarApiKey() {
  const id     = document.getElementById('wa-apikey-id').value;
  const apikey = document.getElementById('wa-apikey-edit').value.trim();
  try {
    await fetch(`/api/whatsapp/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+TOKEN },
      body: JSON.stringify({ callmebot_apikey: apikey || null })
    }).then(r=>r.json());
    showToastMsg(apikey ? '⚡ API Key guardada — envío automático activado' : '🔕 API Key eliminada');
    document.getElementById('wa-apikey-modal').style.display = 'none';
    renderWhatsApp();
  } catch(e) { alert(e.message); }
}

async function probarCallmebot(id, numero, apikey) {
  const empresa = USER?.empresa || 'MetricPOS';
  const msg = `✅ *${empresa}*\n🔔 Prueba de conexión TextMeBot\nSi recibes este mensaje, el envío automático con PDF está funcionando correctamente.`;
  try {
    showToastMsg('📤 Enviando mensaje de prueba...');
    const r = await POST('/whatsapp/send', { numero, apikey, mensaje: msg });
    if (r.ok) {
      showToastMsg('✅ Mensaje enviado correctamente a WhatsApp via TextMeBot');
    } else {
      alert('Error: ' + (r.error || 'No se pudo enviar'));
    }
  } catch(e) { alert('Error: ' + e.message); }
}

async function eliminarWhatsApp(id) {
  if (!confirm('¿Eliminar este número de WhatsApp?')) return;
  try {
    const r = await fetch(`/api/whatsapp/${id}`, {method:'DELETE',headers:{'Authorization':'Bearer '+TOKEN}});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    showToastMsg('🗑️ Número eliminado');
    renderWhatsApp();
  } catch(e) { alert(e.message); }
}

// ══════════════════════════════════════════════════════════════════════════
//  RESUMEN SEMANAL — CallMeBot (gratuito)
// ══════════════════════════════════════════════════════════════════════════
let resumenDestCache = [];

async function renderResumenDestLista() {
  const cont = document.getElementById('resumen-dest-lista');
  if (!cont) return;
  try {
    resumenDestCache = await GET('/resumen-semanal/destinatarios');
  } catch(e) { resumenDestCache = []; }

  if (resumenDestCache.length === 0) {
    cont.innerHTML = `<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px;background:#f8fafc;border-radius:8px">Sin destinatarios configurados. Agregá al menos uno para activar el envío.</div>`;
    return;
  }

  cont.innerHTML = resumenDestCache.map(d => `
    <div style="display:flex;align-items:center;gap:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px">
      <div style="width:36px;height:36px;background:${d.activo?'#dcfce7':'#f1f5f9'};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">
        ${d.activo ? '✅' : '⏸️'}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;color:#1e293b;font-size:13px">${d.nombre}</div>
        <div style="font-size:11px;color:#64748b;font-family:monospace">${d.numero}</div>
      </div>
      <button onclick="toggleResumenDest('${d.id}',${d.activo?0:1})"
        style="background:${d.activo?'#fef3c7':'#dcfce7'};color:${d.activo?'#92400e':'#15803d'};border:none;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer">
        ${d.activo?'⏸️ Pausar':'▶️ Activar'}
      </button>
      <button onclick="eliminarResumenDest('${d.id}')"
        style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;padding:5px 9px;font-size:12px;font-weight:700;cursor:pointer">🗑️</button>
    </div>`).join('');
}

function abrirModalResumenDest() {
  document.getElementById('rd-nombre').value = '';
  document.getElementById('rd-numero').value = '';
  document.getElementById('rd-apikey').value = '';
  document.getElementById('resumen-dest-modal').style.display = 'flex';
}

async function guardarResumenDest() {
  const nombre = document.getElementById('rd-nombre')?.value.trim();
  const numero = document.getElementById('rd-numero')?.value.trim().replace(/[^0-9]/g,'');
  const callmebot_apikey = document.getElementById('rd-apikey')?.value.trim();
  if (!nombre || !numero || !callmebot_apikey) return alert('Todos los campos son requeridos.');
  try {
    await POST('/resumen-semanal/destinatarios', { nombre, numero, callmebot_apikey });
    showToastMsg('✅ Destinatario agregado');
    document.getElementById('resumen-dest-modal').style.display = 'none';
    renderResumenDestLista();
  } catch(e) { alert(e.message); }
}

async function toggleResumenDest(id, nuevoEstado) {
  try {
    await PUT('/resumen-semanal/destinatarios/'+id, { activo: nuevoEstado });
    renderResumenDestLista();
  } catch(e) { alert(e.message); }
}

async function eliminarResumenDest(id) {
  if (!confirm('¿Eliminar este destinatario del resumen semanal?')) return;
  try {
    await DELETE('/resumen-semanal/destinatarios/'+id);
    showToastMsg('🗑️ Destinatario eliminado');
    renderResumenDestLista();
  } catch(e) { alert(e.message); }
}

async function verPreviewResumen() {
  try {
    showToastMsg('Generando vista previa...');
    const r = await GET('/resumen-semanal/preview');
    alert(r.texto); // vista previa simple en alert — el mensaje real se ve igual en WhatsApp
  } catch(e) { alert('Error: ' + e.message); }
}

async function enviarResumenAhora() {
  if (!confirm('¿Enviar el resumen semanal ahora mismo a todos los destinatarios activos?')) return;
  try {
    showToastMsg('📤 Enviando resumen semanal...');
    const r = await POST('/resumen-semanal/enviar-ahora', {});
    if (r.ok) {
      showToastMsg('✅ ' + r.mensaje);
    } else {
      alert(r.mensaje || 'No se pudo enviar.');
    }
    renderResumenLog();
  } catch(e) { alert('Error: ' + e.message); }
}

async function renderResumenLog() {
  const cont = document.getElementById('resumen-log-cont');
  if (!cont) return;
  try {
    const log = await GET('/resumen-semanal/log');
    if (!log || log.length === 0) { cont.innerHTML = ''; return; }
    cont.innerHTML = `
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Últimos envíos</div>
      <div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto">
        ${log.slice(0,10).map(l => `
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;padding:4px 8px;background:#f8fafc;border-radius:6px">
            <span>${l.ok ? '✅' : '❌'} ${l.enviado_a} <span style="color:#94a3b8">(${l.tipo})</span></span>
            <span>${fDT(l.fecha)}</span>
          </div>`).join('')}
      </div>`;
  } catch(e) { cont.innerHTML = ''; }
}

// ── Descargar Productos como Excel (.xlsx) ──────────────────────────────────────
function descargarProductosExcel() {
  const datos = products_cache;
  if (!datos || !datos.length) { alert('No hay productos para descargar.'); return; }
  const hdrs = ['Codigo','Nombre','Categoria','Precio Venta (L.)','Costo (L.)','Stock','Stock Minimo','Gravado','ISV %'];
  const filas = datos.map(function(p) {
    return [
      p.codigo||'', p.nombre||'', p.categoria||'',
      parseFloat(p.precio_venta||0),
      parseFloat(p.costo||0),
      parseInt(p.stock||0), parseInt(p.stock_min||0),
      p.gravado ? 'Si' : 'No', p.tasa_isv||15
    ];
  });
  var ws = XLSX.utils.aoa_to_sheet([hdrs].concat(filas));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  XLSX.writeFile(wb, 'productos_'+new Date().toISOString().substring(0,10)+'.xlsx');
}

// ── Descargar Inventario como Excel (.xlsx) ─────────────────────────────────────
async function descargarInventarioExcel() {
  var inv = [];
  try { inv = await GET('/inventario', 'sucursal_id='+USER.sucursal_id); } catch(e) {
    alert('Error al obtener inventario: '+e.message); return;
  }
  if (!inv || !inv.length) { alert('No hay datos de inventario para descargar.'); return; }
  var hdrs = ['Codigo','Nombre','Categoria','Stock Actual','Stock Minimo','Costo Unit. (L.)','Precio Venta (L.)','Valor a Costo (L.)','Valor a Venta (L.)','Estado'];
  var filas = inv.map(function(p) {
    var stock = parseInt(p.stock||0);
    var minimo = parseInt(p.stock_min||0);
    var costo = parseFloat(p.costo||0);
    var precio = parseFloat(p.precio_venta||0);
    var estado = stock<=0?'Sin stock':stock<=minimo?'Bajo minimo':'OK';
    return [p.codigo||'',p.nombre||'',p.categoria||'',stock,minimo,
      costo,precio,parseFloat((stock*costo).toFixed(2)),parseFloat((stock*precio).toFixed(2)),estado];
  });
  var totCosto = inv.reduce(function(s,p){return s+parseInt(p.stock||0)*parseFloat(p.costo||0);},0);
  var totVenta = inv.reduce(function(s,p){return s+parseInt(p.stock||0)*parseFloat(p.precio_venta||0);},0);
  filas.push(['','','TOTALES','','','','',parseFloat(totCosto.toFixed(2)),parseFloat(totVenta.toFixed(2)),'']);
  var ws = XLSX.utils.aoa_to_sheet([hdrs].concat(filas));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  XLSX.writeFile(wb, 'inventario_'+new Date().toISOString().substring(0,10)+'.xlsx');
}

function showToastMsg(msg) {
  const t=document.createElement('div');
  t.textContent=msg;
  t.style.cssText=`position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:#1e3a5f;color:#fff;padding:10px 20px;border-radius:8px;
    font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.2)`;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

// ═══════════════════════════════════════════════════════════════════════════
// REPORTE CONSOLIDADO DEL DÍA
// ═══════════════════════════════════════════════════════════════════════════
async function generarConsolidado() {
  const fecha = document.getElementById('cons-fecha')?.value || todayHN();
  const cont  = document.getElementById('consolidado-container');
  if (!cont) return;

  cont.innerHTML = '<div style="text-align:center;padding:16px;color:#94a3b8;font-size:13px">⏳ Cargando...</div>';

  try {
    const { turnos } = await GET('/turnos/consolidado_dia',
      `sucursal_id=${USER.sucursal_id}&fecha=${fecha}`);

    if (!turnos.length) {
      cont.innerHTML = `<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px">
        No hay turnos registrados para el ${fecha}</div>`;
      return;
    }

    // ── Totales globales ──
    const totV  = turnos.reduce((s,t)=>s+t.tv,0);
    const totE  = turnos.reduce((s,t)=>s+t.te,0);
    const totT  = turnos.reduce((s,t)=>s+t.tt,0);
    const totTr = turnos.reduce((s,t)=>s+t.tr,0);
    const totNV = turnos.reduce((s,t)=>s+t.nv,0);
    const totSob= turnos.reduce((s,t)=>s+(parseFloat(t.sobrante)||0),0);

    // ── Artículos consolidados (sumar todos los turnos) ──
    const artsMap = {};
    turnos.forEach(t => (t.articulos||[]).forEach(a => {
      if (!artsMap[a.producto_nombre]) artsMap[a.producto_nombre] = { cod:a.producto_codigo, cat:a.producto_categoria, u:0, tot:0 };
      artsMap[a.producto_nombre].u   += a.unidades;
      artsMap[a.producto_nombre].tot += a.total;
    }));
    const arts = Object.entries(artsMap).sort((a,b)=>b[1].tot-a[1].tot);

    const numWha = await GET('/whatsapp').catch(()=>[]);

    // ── Render en pantalla ──
    cont.innerHTML = `
      <!-- Resumen global -->
      <div style="background:#1e3a5f;border-radius:10px;padding:14px 18px;margin-bottom:14px;color:#fff">
        <div style="font-size:12px;font-weight:700;color:#94a3b8;margin-bottom:8px">
          ${turnos.length} TURNO${turnos.length>1?'S':''} DEL DÍA — ${fecha}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px">
          ${[['TOTAL VENTAS','L.'+totV.toFixed(2),'#34d399'],
             ['EFECTIVO','L.'+totE.toFixed(2),'#60a5fa'],
             ['TARJETA','L.'+totT.toFixed(2),'#c084fc'],
             ['TRANSF.','L.'+totTr.toFixed(2),'#fbbf24'],
             ['N° FACTURAS',totNV,'#94a3b8'],
             ...(totSob>0?[['SOBRANTE TOTAL','L.'+totSob.toFixed(2),'#fbbf24']]:[])
            ].map(([l,v,c])=>`
            <div style="text-align:center">
              <div style="font-size:10px;color:#94a3b8;font-weight:600">${l}</div>
              <div style="font-size:18px;font-weight:800;color:${c}">${v}</div>
            </div>`).join('')}
        </div>
      </div>

      <!-- Detalle por turno -->
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
        ${turnos.map(t=>`
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <div style="width:34px;height:34px;background:${t.estado==='abierto'?'#059669':'#64748b'};border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;font-weight:800;flex-shrink:0">
                ${t.turno_letra||'A'}
              </div>
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700;color:#1e293b">
                  Turno ${t.turno_letra||'A'} — ${t.usuario_nombre||'Cajero'}
                  <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;margin-left:6px;
                    background:${t.estado==='abierto'?'#dcfce7':'#f1f5f9'};
                    color:${t.estado==='abierto'?'#15803d':'#64748b'}">
                    ${t.estado==='abierto'?'● EN CURSO':'✓ CERRADO'}
                  </span>
                </div>
                <div style="font-size:11px;color:#94a3b8">${(t.fecha_apertura||'').substring(0,16)} → ${t.fecha_cierre?(t.fecha_cierre||'').substring(0,16):'en curso'}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:15px;font-weight:800;color:#1e3a5f">L.${t.tv.toFixed(2)}</div>
                <div style="font-size:11px;color:#94a3b8">${t.nv} fact.</div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
              ${[['EFE','#dbeafe',t.te],['TAR','#ede9fe',t.tt],['TRF','#fef9c3',t.tr]].map(([l,bg,v])=>`
              <div style="background:${bg};border-radius:6px;padding:5px;text-align:center">
                <div style="font-size:9px;color:#64748b;font-weight:700">${l}</div>
                <div style="font-size:12px;font-weight:700;color:#1e293b">L.${v.toFixed(2)}</div>
              </div>`).join('')}
            </div>
            ${(parseFloat(t.sobrante)||0)>0?`
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 10px;margin-top:6px;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:11px;font-weight:700;color:#92400e">💰 Sobrante:</span>
              <div style="text-align:right">
                <span style="font-size:13px;font-weight:800;color:#d97706">L.${(parseFloat(t.sobrante)||0).toFixed(2)}</span>
                ${t.motivo_sobrante?`<div style="font-size:10px;color:#92400e">${t.motivo_sobrante}</div>`:''}
              </div>
            </div>`:''}
          </div>`).join('')}
      </div>

      <!-- Top artículos -->
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:#1e3a5f;margin-bottom:10px">📦 ARTÍCULOS VENDIDOS (TODOS LOS TURNOS)</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#f1f5f9">
              <th style="padding:6px 8px;text-align:left;color:#64748b;font-weight:700">Artículo</th>
              <th style="padding:6px 8px;text-align:right;color:#64748b;font-weight:700">Uds.</th>
              <th style="padding:6px 8px;text-align:right;color:#64748b;font-weight:700">Total</th>
            </tr>
          </thead>
          <tbody>
            ${arts.map(([nom,d],i)=>`
            <tr style="border-bottom:1px solid #f1f5f9;background:${i%2?'#f8fafc':'#fff'}">
              <td style="padding:5px 8px;font-weight:600;color:#1e293b">${nom}</td>
              <td style="padding:5px 8px;text-align:right;color:#64748b">${d.u}</td>
              <td style="padding:5px 8px;text-align:right;font-weight:700;color:#059669">L.${d.tot.toFixed(2)}</td>
            </tr>`).join('')}
            <tr style="background:#1e3a5f">
              <td style="padding:6px 8px;color:#fff;font-weight:700">TOTAL</td>
              <td style="padding:6px 8px;text-align:right;color:#fff;font-weight:700">${arts.reduce((s,[,d])=>s+d.u,0)}</td>
              <td style="padding:6px 8px;text-align:right;color:#34d399;font-weight:700">L.${totV.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Botones de acción -->
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="imprimirConsolidado('${fecha}')"
          style="flex:1;min-width:140px;background:#1e3a5f;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:pointer">
          🖨️ Imprimir Consolidado
        </button>
        ${numWha.length ? `
        <button onclick="enviarConsolidadoWA('${fecha}')"
          style="flex:1;min-width:140px;background:#25d366;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:pointer">
          📱 Enviar por WhatsApp
        </button>` : ''}
      </div>`;

    // Guardar datos en memoria para imprimir/enviar sin nueva llamada
    window._consolidadoData = { fecha, turnos, totV, totE, totT, totTr, totNV, totSob, arts };

  } catch(e) {
    cont.innerHTML = `<div style="text-align:center;padding:16px;color:#dc2626;font-size:13px">Error: ${e.message}</div>`;
  }
}

// ── Imprimir consolidado ────────────────────────────────────────────────────
function imprimirConsolidado(fecha) {
  const d = window._consolidadoData;
  if (!d) return alert('Primero genera el consolidado.');
  const emp = USER?.empresa || 'METRIC POS';
  const sep = '================================';
  const sep2= '--------------------------------';

  // Construir HTML de impresión (ticket 80mm)
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Consolidado</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Courier New',monospace;font-size:12px;padding:12px;max-width:300px;margin:0 auto}
    h2,h3{text-align:center;font-size:13px}
    .sep{border-top:1px dashed #000;margin:5px 0}
    .sep2{border-top:2px solid #000;margin:5px 0}
    .row{display:flex;justify-content:space-between;margin:2px 0}
    .center{text-align:center}
    .bold{font-weight:700}
    @media print{@page{size:80mm auto;margin:3mm}}
  </style></head><body>`;

  html += `<h2>${emp}</h2>`;
  html += `<h3>CONSOLIDADO DEL DÍA</h3>`;
  html += `<div class="center">${d.fecha}</div>`;
  html += `<div class="sep2"></div>`;

  // Totales globales
  html += `<div class="row bold"><span>TOTAL VENTAS:</span><span>L.${d.totV.toFixed(2)}</span></div>`;
  html += `<div class="row"><span>Efectivo:</span><span>L.${d.totE.toFixed(2)}</span></div>`;
  html += `<div class="row"><span>Tarjeta:</span><span>L.${d.totT.toFixed(2)}</span></div>`;
  html += `<div class="row"><span>Transferencia:</span><span>L.${d.totTr.toFixed(2)}</span></div>`;
  html += `<div class="row"><span>N° Facturas:</span><span>${d.totNV}</span></div>`;
  html += `<div class="sep2"></div>`;

  // Corte por turno
  d.turnos.forEach(t => {
    html += `<div class="row bold"><span>TURNO ${t.turno_letra} — ${t.usuario_nombre||'Cajero'}</span></div>`;
    html += `<div class="row"><span>  Ventas:</span><span>L.${t.tv.toFixed(2)}</span></div>`;
    html += `<div class="row"><span>  Efectivo:</span><span>L.${t.te.toFixed(2)}</span></div>`;
    html += `<div class="row"><span>  Tarjeta:</span><span>L.${t.tt.toFixed(2)}</span></div>`;
    html += `<div class="row"><span>  Transf.:</span><span>L.${t.tr.toFixed(2)}</span></div>`;
    html += `<div class="row"><span>  Facturas:</span><span>${t.nv}</span></div>`;
    html += `<div class="row"><span>  Apertura:</span><span>${(t.fecha_apertura||'').substring(11,16)}</span></div>`;
    html += `<div class="row"><span>  Cierre:</span><span>${t.fecha_cierre?(t.fecha_cierre||'').substring(11,16):'En curso'}</span></div>`;
    if((parseFloat(t.sobrante)||0)>0){
      html += `<div class="row" style="color:#d97706"><span>  Sobrante:</span><b>L.${(parseFloat(t.sobrante)||0).toFixed(2)}</b></div>`;
      if(t.motivo_sobrante) html += `<div class="row" style="font-size:10px;color:#64748b"><span>  Motivo:</span><span>${t.motivo_sobrante}</span></div>`;
    }
    html += `<div class="sep"></div>`;
  });

  // Artículos vendidos
  html += `<div class="sep2"></div>`;
  if(d.totSob>0){
    html += `<div class="row bold" style="color:#d97706"><span>SOBRANTE TOTAL:</span><span>L.${d.totSob.toFixed(2)}</span></div>`;
    html += `<div class="sep2"></div>`;
  }
  html += `<div class="center bold">ARTICULOS VENDIDOS</div>`;
  html += `<div class="sep"></div>`;
  d.arts.forEach(([nom,dt]) => {
    const n = nom.length>18 ? nom.substring(0,18) : nom.padEnd(18);
    const v = dt.u+'u L.'+dt.tot.toFixed(2);
    const sp = Math.max(1, 32-n.trim().length-v.length);
    html += `<div style="font-size:11px">${n.trim()}${' '.repeat(sp)}${v}</div>`;
  });
  html += `<div class="sep2"></div>`;
  html += `<div class="row bold"><span>TOTAL:</span><span>L.${d.totV.toFixed(2)}</span></div>`;
  html += `<div class="sep2"></div>`;
  html += `<div class="center" style="font-size:10px;margin-top:6px">Powered by MetricPOS</div>`;
  html += `<script>setTimeout(()=>window.print(),400);<\/script></body></html>`;

  const win = window.open('','_blank','width=420,height=800');
  if (!win) return alert('Habilita las ventanas emergentes para imprimir.');
  win.document.write(html);
  win.document.close();
}

// ── Enviar consolidado por WhatsApp ─────────────────────────────────────────
async function enviarConsolidadoWA(fecha) {
  const d = window._consolidadoData;
  if (!d) return alert('Primero genera el consolidado.');

  const numeros = await GET('/whatsapp').catch(()=>[]);
  if (!numeros.length) return alert('No hay números de WhatsApp configurados.');

  const emp = USER?.empresa || 'METRIC POS';
  const sep = '━━━━━━━━━━━━━━━━━━━━━━';
  const pad = (l,r,w=32) => l + ' '.repeat(Math.max(1,w-l.length-r.length)) + r;

  // Texto 1: Corte consolidado
  const lines1 = [
    `🏪 *${emp}*`,
    `📊 *CONSOLIDADO DEL DÍA: ${d.fecha}*`, sep,
    pad('TOTAL VENTAS:',  'L.'+d.totV.toFixed(2)),
    pad('Efectivo:',       'L.'+d.totE.toFixed(2)),
    pad('Tarjeta:',        'L.'+d.totT.toFixed(2)),
    pad('Transferencia:',  'L.'+d.totTr.toFixed(2)),
    pad('N° Facturas:',    String(d.totNV)),
    ...(d.totSob>0?[pad('SOBRANTE TOTAL:','L.'+d.totSob.toFixed(2))]:[]),
    sep,
  ];
  d.turnos.forEach(t => {
    lines1.push(`*TURNO ${t.turno_letra}* — ${t.usuario_nombre||'Cajero'}`);
    lines1.push(pad('  Ventas:',   'L.'+t.tv.toFixed(2)));
    lines1.push(pad('  Efectivo:', 'L.'+t.te.toFixed(2)));
    lines1.push(pad('  Tarjeta:',  'L.'+t.tt.toFixed(2)));
    lines1.push(pad('  Facturas:', String(t.nv)));
    if((parseFloat(t.sobrante)||0)>0){
      lines1.push(pad('  Sobrante:', 'L.'+(parseFloat(t.sobrante)||0).toFixed(2)));
      if(t.motivo_sobrante) lines1.push('  Motivo: '+t.motivo_sobrante);
    }
    lines1.push('');
  });
  lines1.push('_Powered by MetricPOS_');
  const textoCorte = '```\n' + lines1.join('\n') + '\n```';

  // Texto 2: Artículos del día
  const lines2 = [
    `🏪 *${emp}*`,
    `📦 *ARTÍCULOS VENDIDOS: ${d.fecha}*`, sep,
    pad('ARTÍCULO','UDS  TOTAL',32), sep,
  ];
  d.arts.forEach(([nom,dt]) => {
    const n = nom.length>18 ? nom.substring(0,18) : nom;
    lines2.push(pad(n, dt.u+'u L.'+dt.tot.toFixed(2)));
  });
  lines2.push(sep);
  lines2.push(pad('TOTAL GENERAL:', 'L.'+d.totV.toFixed(2)));
  lines2.push('_Powered by MetricPOS_');
  const textoArts = '```\n' + lines2.join('\n') + '\n```';

  // Generar botones para cada número
  const botonesHTML = numeros.map(wa => {
    const tel = wa.numero.replace(/[^0-9]/g,'');
    const uc  = 'https://wa.me/'+tel+'?text='+encodeURIComponent(textoCorte);
    const ua  = 'https://wa.me/'+tel+'?text='+encodeURIComponent(textoArts);
    return '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:6px">'
      +'<div style="font-size:12px;font-weight:700;color:#1e3a5f;margin-bottom:8px">📱 '+wa.nombre+' — <span style="font-family:monospace;color:#64748b">'+wa.numero+'</span></div>'
      +'<div style="display:flex;gap:8px">'
      +'<a href="'+uc+'" target="_blank" style="flex:1;display:block;background:#25d366;color:#fff;padding:9px 6px;border-radius:8px;text-decoration:none;font-weight:700;font-size:12px;text-align:center">📊 Corte</a>'
      +'<a href="'+ua+'" target="_blank" style="flex:1;display:block;background:#2563eb;color:#fff;padding:9px 6px;border-radius:8px;text-decoration:none;font-weight:700;font-size:12px;text-align:center">📦 Artículos</a>'
      +'</div></div>';
  }).join('');

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:0;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;max-height:90vh;display:flex;flex-direction:column">
      <div style="background:#1e3a5f;padding:16px 20px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:15px;font-weight:800;color:#fff">📱 Enviar Consolidado</div>
          <div style="font-size:12px;color:#94a3b8">${d.fecha} · ${d.turnos.length} turno${d.turnos.length>1?'s':''}</div>
        </div>
        <button onclick="this.closest('div[style*=fixed]').remove()"
          style="background:rgba(255,255,255,.15);border:none;border-radius:8px;padding:6px 12px;color:#fff;cursor:pointer;font-size:16px">✕</button>
      </div>
      <div style="padding:14px 16px;overflow-y:auto">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
          Selecciona a quién enviar:
        </div>
        ${botonesHTML}
      </div>
      <div style="padding:10px 16px;border-top:1px solid #e2e8f0">
        <button onclick="this.closest('div[style*=fixed]').remove()"
          style="width:100%;background:#f1f5f9;border:none;border-radius:10px;padding:11px;font-size:13px;cursor:pointer;color:#64748b;font-weight:600">
          Cerrar
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
}

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO: TICKETS DE TURNO
// ═══════════════════════════════════════════════════════════════════════════

// ── Constantes del módulo de tickets ─────────────────────────────────────────
const TK_AREAS    = ['Caja','Contabilidad','Cuentas por Cobrar','Proveedores','Tienda','Pista'];
const TK_TIPOS    = ['No hay en existencia','Producto No Existe','Precio Malo','Factura Pendiente de Cobrar','Factura Pendiente por Pagar'];
const TK_PRIOR    = { urgente:{label:'🔴 Urgente',color:'#dc2626'}, alta:{label:'🟠 Alta',color:'#ea580c'}, media:{label:'🟡 Media',color:'#d97706'}, baja:{label:'🟢 Baja',color:'#059669'} };
const TK_ESTADO   = { abierto:{label:'Abierto',color:'#dc2626'}, en_revision:{label:'En Proceso',color:'#d97706'}, resuelto:{label:'Resuelto',color:'#059669'} };

// ── Filtros activos del módulo ────────────────────────────────────────────────
let _tkFiltros = { estado:'', prioridad:'', area:'' };

async function renderTickets() {
  const v = document.getElementById('tickets-view');
  if (!v) return;

  const esCajero = USER?.rol === 'cajero';

  // Cargar stats y tickets en paralelo
  let stats = { total:0, abiertos:0, revision:0, resueltos:0 };
  let tickets = [];
  try { [stats, tickets] = await Promise.all([GET('/tickets/stats'), _cargarTicketsFiltrados()]); }
  catch(e) { tickets = []; }

  v.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">🎫 Tickets</div>
          <div class="page-subtitle">Centro de soporte y seguimiento</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary" style="background:#059669" onclick="abrirFormTicket()">
            + Nuevo Ticket
          </button>
          <button class="btn-primary" style="background:#64748b;padding:8px 12px" onclick="renderTickets()">
            🔄
          </button>
        </div>
      </div>

      <!-- Dashboard de stats expandido -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px">
        ${[
          {l:'Total',v:stats.total,c:'#1e3a5f',bg:'#eff6ff',f:'',icon:'🎫',desc:'tickets registrados'},
          {l:'Pendientes',v:stats.abiertos,c:'#dc2626',bg:'#fef2f2',f:'abierto',icon:'🔴',desc:'requieren atención'},
          {l:'En Proceso',v:stats.revision,c:'#d97706',bg:'#fffbeb',f:'en_revision',icon:'🟡',desc:'siendo atendidos'},
          {l:'Resueltos',v:stats.resueltos,c:'#059669',bg:'#f0fdf4',f:'resuelto',icon:'✅',desc:'completados'},
        ].map(s=>{
          const pct = stats.total > 0 ? Math.round((s.v / stats.total) * 100) : 0;
          const isActive = _tkFiltros.estado === s.f && s.f;
          return `
          <div onclick="${s.f?`filtrarTicketsPor('${s.f}')`:''}"
            style="background:${s.bg};border-radius:14px;padding:16px 18px;
                   ${s.f?'cursor:pointer;transition:transform .15s,box-shadow .15s;':''}
                   border:2px solid ${isActive?s.c:'transparent'};
                   box-shadow:${isActive?`0 0 0 3px ${s.c}33`:'0 1px 4px rgba(0,0,0,.06)'}"
            ${s.f?`onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 18px rgba(0,0,0,.1)'"
                   onmouseout="this.style.transform='';this.style.boxShadow='${isActive?`0 0 0 3px ${s.c}33`:`0 1px 4px rgba(0,0,0,.06)`}'"`:''}>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
              <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px">${s.l}</div>
              <div style="font-size:20px;line-height:1">${s.icon}</div>
            </div>
            <div style="font-size:38px;font-weight:900;color:${s.c};line-height:1;margin-bottom:6px">${s.v}</div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:10px">${s.desc}</div>
            ${s.f ? `
            <div style="background:rgba(0,0,0,.07);border-radius:99px;height:5px;overflow:hidden">
              <div style="background:${s.c};height:100%;width:${pct}%;border-radius:99px;transition:width .5s ease"></div>
            </div>
            <div style="font-size:11px;font-weight:700;color:${s.c};margin-top:4px">${pct}%</div>` : `
            <div style="font-size:11px;color:#64748b;font-weight:600">
              ${stats.abiertos + stats.revision > 0 ? `${stats.abiertos + stats.revision} activos` : 'Sin tickets activos'}
            </div>`}
          </div>`;
        }).join('')}
      </div>

      <!-- Filtros -->
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:16px">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div style="flex:1;min-width:130px">
            <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:4px">ESTADO</label>
            <select id="tk-f-estado" onchange="_tkFiltros.estado=this.value;_recargarListaTickets()"
              style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px;font-size:13px;outline:none;background:#fff">
              <option value="">Todos</option>
              <option value="abierto">Abierto</option>
              <option value="en_revision">En Proceso</option>
              <option value="resuelto">Resuelto</option>
            </select>
          </div>
          <div style="flex:1;min-width:130px">
            <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:4px">PRIORIDAD</label>
            <select id="tk-f-prior" onchange="_tkFiltros.prioridad=this.value;_recargarListaTickets()"
              style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px;font-size:13px;outline:none;background:#fff">
              <option value="">Todas</option>
              <option value="urgente">Urgente</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
          <div style="flex:1;min-width:130px">
            <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:4px">ÁREA</label>
            <select id="tk-f-area" onchange="_tkFiltros.area=this.value;_recargarListaTickets()"
              style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px;font-size:13px;outline:none;background:#fff">
              <option value="">Todas</option>
              ${TK_AREAS.map(a=>`<option value="${a}">${a}</option>`).join('')}
            </select>
          </div>
          <button onclick="_tkFiltros={estado:'',prioridad:'',area:''};renderTickets()"
            style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:7px 14px;
                   font-size:12px;font-weight:600;color:#64748b;cursor:pointer;white-space:nowrap">
            ✕ Limpiar
          </button>
        </div>
      </div>

      <!-- Lista de tickets -->
      <div id="tk-lista">
        ${_renderListaTickets(tickets)}
      </div>
    </div>`;

  // Restaurar valores de filtros activos
  const sf=document.getElementById('tk-f-estado'); if(sf&&_tkFiltros.estado) sf.value=_tkFiltros.estado;
  const pf=document.getElementById('tk-f-prior');  if(pf&&_tkFiltros.prioridad) pf.value=_tkFiltros.prioridad;
  const af=document.getElementById('tk-f-area');   if(af&&_tkFiltros.area) af.value=_tkFiltros.area;
}

async function _cargarTicketsFiltrados() {
  const p = Object.entries(_tkFiltros).filter(([,v])=>v).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');
  return await GET('/tickets', p);
}

function _renderListaTickets(tickets) {
  if (!tickets.length) return `
    <div style="text-align:center;padding:40px 24px;color:#94a3b8">
      <div style="font-size:40px;margin-bottom:10px">🎫</div>
      <div style="font-size:15px;font-weight:600">No hay tickets que mostrar</div>
      <div style="font-size:12px;margin-top:4px">Prueba cambiando los filtros o crea un nuevo ticket</div>
    </div>`;
  return `<div style="display:flex;flex-direction:column;gap:8px">
    ${tickets.map(t => {
      const pr = TK_PRIOR[t.prioridad] || {label:'Media',color:'#64748b'};
      const es = TK_ESTADO[t.estado]   || {label:t.estado,color:'#64748b'};
      return `
        <div onclick="abrirTicket('${t.id}')"
          style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;
                 cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.05);border-left:4px solid ${pr.color}"
          onmouseover="this.style.boxShadow='0 4px 14px rgba(0,0,0,.10)'"
          onmouseout="this.style.boxShadow='0 1px 3px rgba(0,0,0,.05)'">
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
                <span style="font-size:13px;font-weight:800;color:#1e293b">
                  ${t.titulo || 'Turno '+( t.turno_letra||'A')+' — '+(t.cajero_nombre||'')}
                </span>
                <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;
                  background:${es.color}18;color:${es.color}">${es.label}</span>
                <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;
                  background:${pr.color}18;color:${pr.color}">${pr.label}</span>
              </div>
              <div style="display:flex;gap:10px;font-size:11px;color:#94a3b8;flex-wrap:wrap">
                ${t.area?`<span>📍 ${t.area}</span>`:''}
                ${t.tipo?`<span>🏷️ ${t.tipo}</span>`:''}
                <span>👤 ${t.cajero_nombre||'—'}</span>
                ${t.asignado_nombre?`<span>→ ${t.asignado_nombre}</span>`:''}
                <span>🕐 ${(t.creado||'').substring(0,16)}</span>
              </div>
              ${t.descripcion?`<div style="margin-top:5px;font-size:12px;color:#64748b">
                ${t.descripcion.substring(0,100)}${t.descripcion.length>100?'...':''}</div>`:''}
              ${t.ultimo_mensaje?`
              <div style="margin-top:6px;background:#f8fafc;border-radius:6px;padding:5px 9px;
                          font-size:11px;color:#64748b;border-left:2px solid #e2e8f0">
                <b style="color:#1e293b">${t.ultimo_mensaje.usuario_nombre}:</b>
                ${t.ultimo_mensaje.mensaje.substring(0,70)}${t.ultimo_mensaje.mensaje.length>70?'...':''}
              </div>`:''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:11px;color:#94a3b8">${t.total_mensajes} msg</div>
              ${(JSON.parse(t.fotos||'[]')).length?`<div style="font-size:10px;color:#94a3b8">📷 ${JSON.parse(t.fotos||'[]').length}</div>`:''}
              <div style="font-size:18px;color:#94a3b8;margin-top:4px">›</div>
            </div>
          </div>
        </div>`;
    }).join('')}
  </div>`;
}

async function _recargarListaTickets() {
  const lista = document.getElementById('tk-lista');
  if (!lista) return;
  try {
    const tickets = await _cargarTicketsFiltrados();
    lista.innerHTML = _renderListaTickets(tickets);
  } catch(e) {}
}

function filtrarTicketsPor(estado) {
  _tkFiltros.estado = _tkFiltros.estado === estado ? '' : estado;
  renderTickets();
}

// ── Detalle de un ticket ──────────────────────────────────────────────────────
async function abrirTicket(id) {
  let ticket;
  try { ticket = await GET('/tickets/'+id); } catch(e) { return alert('Error: '+e.message); }

  const esCajero  = USER?.rol === 'cajero';
  const esSuperAdmin = USER?.rol === 'admin' || USER?.rol === 'supervisor';
  const estadoColor = { abierto:'#dc2626', en_revision:'#d97706', resuelto:'#059669' };
  const estadoLabel = { abierto:'🔴 Abierto', en_revision:'🟡 En revisión', resuelto:'🟢 Resuelto' };

  const modal = document.createElement('div');
  modal.id = 'ticket-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:stretch;justify-content:flex-end';

  modal.innerHTML = `
    <div style="background:#fff;width:100%;max-width:520px;display:flex;flex-direction:column;
                box-shadow:-8px 0 40px rgba(0,0,0,.15);overflow:hidden">

      <!-- Header -->
      <div style="background:#1e3a5f;padding:16px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0">
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:800;color:#fff">
            ${ticket.titulo || ('Turno '+(ticket.turno_letra||'A')+' — '+(ticket.cajero_nombre||'Cajero'))}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
            ${ticket.area?`<span style="font-size:10px;background:rgba(255,255,255,.15);color:#e2e8f0;padding:2px 8px;border-radius:8px">📍 ${ticket.area}</span>`:''}
            ${ticket.tipo?`<span style="font-size:10px;background:rgba(255,255,255,.15);color:#e2e8f0;padding:2px 8px;border-radius:8px">🏷️ ${ticket.tipo}</span>`:''}
            <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;
              background:${(TK_PRIOR[ticket.prioridad]||{color:'#64748b'}).color}33;
              color:${(TK_PRIOR[ticket.prioridad]||{color:'#fff'}).color}">
              ${(TK_PRIOR[ticket.prioridad]||{label:'Media'}).label}
            </span>
            <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;
              background:${(TK_ESTADO[ticket.estado]||{color:'#64748b'}).color}33;
              color:${(TK_ESTADO[ticket.estado]||{color:'#fff'}).color}">
              ${(TK_ESTADO[ticket.estado]||{label:ticket.estado}).label}
            </span>
          </div>
        </div>
        <button onclick="document.getElementById('ticket-modal').remove();renderTickets()"
          style="background:rgba(255,255,255,.15);border:none;border-radius:8px;
                 padding:7px 12px;color:#fff;cursor:pointer;font-size:16px;flex-shrink:0">✕</button>
      </div>

      <!-- Info del ticket -->
      <div style="background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:12px 18px;flex-shrink:0">
        <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:#64748b;margin-bottom:${ticket.descripcion?'8px':'0'}">
          <span>👤 <b>${ticket.cajero_nombre||'—'}</b></span>
          ${ticket.asignado_nombre?`<span>→ Asignado a <b>${ticket.asignado_nombre}</b></span>`:''}
          <span>🕐 ${(ticket.creado||'').substring(0,16)}</span>
          ${(ticket.total_ventas||0)>0?`<span>💰 L.${(ticket.total_ventas||0).toFixed(2)}</span>`:''}
        </div>
        ${ticket.descripcion?`<div style="font-size:13px;color:#1e293b;background:#fff;border-radius:8px;padding:10px 12px;border:1px solid #e2e8f0">${ticket.descripcion.split('\n').join('<br>')}</div>`:''}
      </div>

      <!-- Fotos de evidencia -->
      ${(()=>{
        const fotos = JSON.parse(ticket.fotos||'[]');
        return fotos.length ? `
        <div style="border-bottom:1px solid #e2e8f0;padding:12px 18px;flex-shrink:0">
          <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">📷 EVIDENCIAS (${fotos.length})</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${fotos.map((src,i)=>`
              <img src="${src}" onclick="tkVerFoto('${i}',${JSON.stringify(fotos).replace(/"/g,"'")})"
                style="width:60px;height:60px;object-fit:cover;border-radius:8px;cursor:pointer;
                       border:1px solid #e2e8f0" title="Click para ampliar">`).join('')}
          </div>
        </div>` : '';
      })()}

      <!-- Reporte artículos colapsable -->
      ${ticket.reporte_articulos ? `
      <div style="border-bottom:1px solid #e2e8f0;flex-shrink:0">
        <button onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'"
          style="width:100%;background:#eff6ff;border:none;padding:10px 18px;font-size:12px;
                 font-weight:700;color:#2563eb;cursor:pointer;text-align:left">
          📦 Ver Artículos Vendidos ▾
        </button>
        <div style="display:none;padding:12px 18px;background:#f8fafc;max-height:180px;overflow-y:auto">
          <pre style="font-family:monospace;font-size:11px;color:#1e3a5f;white-space:pre-wrap;margin:0">${ticket.reporte_articulos}</pre>
        </div>
      </div>` : ''}

      <!-- Mensajes -->
      <div id="ticket-msgs" style="flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:10px">
        ${ticket.mensajes.length === 0 ? `
          <div style="text-align:center;padding:24px;color:#94a3b8;font-size:13px">
            Sin respuestas aún. Sé el primero en responder.
          </div>` :
          ticket.mensajes.map(m => {
            const esMio = m.usuario_id === USER?.id;
            const esAdmin = m.usuario_rol === 'admin' || m.usuario_rol === 'supervisor';
            return `
              <div style="display:flex;flex-direction:column;align-items:${esMio?'flex-end':'flex-start'}">
                <div style="font-size:10px;color:#94a3b8;margin-bottom:3px;padding:0 4px">
                  ${m.usuario_nombre} · ${(m.creado||'').substring(0,16)}
                </div>
                <div style="max-width:85%;padding:10px 14px;border-radius:${esMio?'14px 14px 4px 14px':'14px 14px 14px 4px'};
                  background:${esMio?'#1e3a5f':esAdmin?'#f0fdf4':'#f1f5f9'};
                  color:${esMio?'#fff':esAdmin?'#15803d':'#1e293b'};
                  font-size:13px;line-height:1.5;border:${esAdmin&&!esMio?'1px solid #d1fae5':'none'}">
                  ${m.mensaje.replace(/\n/g,'<br>')}
                </div>
              </div>`;
          }).join('')
        }
      </div>

      <!-- Acciones supervisor (cambio de estado) -->
      ${esSuperAdmin ? `
      <div style="padding:10px 18px;border-top:1px solid #e2e8f0;display:flex;gap:6px;flex-shrink:0;background:#f8fafc">
        <button onclick="cambiarEstadoTicket('${ticket.id}','en_revision')"
          style="flex:1;background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:7px;
                 font-size:11px;font-weight:700;color:#92400e;cursor:pointer">
          🟡 En Revisión
        </button>
        <button onclick="cambiarEstadoTicket('${ticket.id}','resuelto')"
          style="flex:1;background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:7px;
                 font-size:11px;font-weight:700;color:#15803d;cursor:pointer">
          🟢 Resolver
        </button>
        <button onclick="cambiarEstadoTicket('${ticket.id}','abierto')"
          style="flex:1;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:7px;
                 font-size:11px;font-weight:700;color:#dc2626;cursor:pointer">
          🔴 Reabrir
        </button>
      </div>` : ''}

      <!-- Input de respuesta -->
      ${ticket.estado !== 'resuelto' ? `
      <div style="padding:14px 18px;border-top:1px solid #e2e8f0;background:#fff;flex-shrink:0">
        <div style="display:flex;gap:8px;align-items:flex-end">
          <textarea id="ticket-reply-txt" placeholder="Escribe tu respuesta..."
            rows="2" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();enviarMensajeTicket('${ticket.id}')}"
            style="flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;
                   font-size:13px;resize:none;outline:none;font-family:inherit"></textarea>
          <button onclick="enviarMensajeTicket('${ticket.id}')"
            style="background:#059669;color:#fff;border:none;border-radius:10px;
                   padding:10px 16px;font-size:20px;cursor:pointer;flex-shrink:0">➤</button>
        </div>
        <div style="font-size:10px;color:#94a3b8;margin-top:5px">Enter para enviar · Shift+Enter para nueva línea</div>
      </div>` : `
      <div style="padding:14px 18px;background:#f0fdf4;border-top:1px solid #d1fae5;\
                  display:flex;align-items:center;justify-content:space-between;flex-shrink:0">\
        <span style="font-size:13px;font-weight:600;color:#15803d">\u2705 Ticket resuelto</span>\
        ${ticket.pdf_resolucion ? `\
        <a href="/api/tickets/${ticket.id}/pdf" target="_blank"\
          style="background:#059669;color:#fff;border-radius:8px;padding:7px 14px;\
                 text-decoration:none;font-size:12px;font-weight:700">\
          \ud83d\udcc4 Descargar PDF\
        </a>` : ''}\
      </div>`}
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if(e.target===modal) { modal.remove(); renderTickets(); } });

  // Scroll al final de los mensajes
  setTimeout(() => {
    const msgs = document.getElementById('ticket-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }, 100);
}

// ── Enviar mensaje ────────────────────────────────────────────────────────────
async function enviarMensajeTicket(ticketId) {
  const txt = document.getElementById('ticket-reply-txt');
  if (!txt || !txt.value.trim()) return;
  const msg = txt.value.trim();
  txt.value = '';
  try {
    await POST('/tickets/'+ticketId+'/mensajes', { mensaje: msg });
    // Recargar el ticket abierto
    document.getElementById('ticket-modal')?.remove();
    await abrirTicket(ticketId);
    // Actualizar badge
    actualizarBadgeTickets();
  } catch(e) { alert('Error: '+e.message); txt.value = msg; }
}

// ── Cambiar estado ────────────────────────────────────────────────────────────
async function cambiarEstadoTicket(ticketId, estado) {
  // Para "resuelto" en tickets de turno → abrir modal de resolución
  if (estado === 'resuelto') {
    await _abrirModalResolucion(ticketId);
    return;
  }
  // Para otros estados → cambio directo
  try {
    const r = await fetch(`/api/tickets/${ticketId}/estado`, {
      method:'PUT', headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},
      body: JSON.stringify({estado})
    });
    const data = await r.json();
    if (!r.ok) { alert(data.error || 'Error'); return; }
    document.getElementById('ticket-modal')?.remove();
    await abrirTicket(ticketId);
    actualizarBadgeTickets();
  } catch(e) { alert('Error: '+e.message); }
}

// ── Modal de resolución con adjunto obligatorio ───────────────────────────────
async function _abrirModalResolucion(ticketId) {
  // Obtener datos del ticket para verificar si tiene adjuntos
  let ticket;
  try { ticket = await GET('/tickets/'+ticketId); } catch(e) { alert('Error: '+e.message); return; }

  const esTurno = !!ticket.turno_id;
  const fotosExistentes = JSON.parse(ticket.fotos||'[]');
  const tieneAdjunto = fotosExistentes.length > 0;

  // Limpiar modal previo si existe
  document.getElementById('modal-resolucion')?.remove();

  const modal = document.createElement('div');
  modal.id = 'modal-resolucion';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px';

  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:480px;
                box-shadow:0 24px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;max-height:90vh;overflow:hidden">

      <!-- Header -->
      <div style="background:#059669;padding:16px 20px;border-radius:16px 16px 0 0;display:flex;align-items:center;justify-content:space-between">
        <div style="color:#fff;font-size:15px;font-weight:700">🟢 Marcar como Resuelto</div>
        <button onclick="document.getElementById('modal-resolucion').remove()"
          style="background:rgba(255,255,255,.2);border:none;border-radius:8px;padding:4px 10px;
                 color:#fff;font-size:16px;cursor:pointer">✕</button>
      </div>

      <div style="padding:18px 20px;overflow-y:auto;flex:1">

        <!-- Aviso adjunto -->
        ${esTurno ? `
        <div style="background:${tieneAdjunto?'#f0fdf4':'#fef2f2'};border:1px solid ${tieneAdjunto?'#86efac':'#fca5a5'};
                    border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:12px">
          ${tieneAdjunto
            ? `<span style="color:#15803d;font-weight:700">✅ Adjunto encontrado</span>
               <span style="color:#64748b"> — ${fotosExistentes.length} imagen${fotosExistentes.length>1?'es':''} ya cargada${fotosExistentes.length>1?'s':''}</span>`
            : `<span style="color:#dc2626;font-weight:700">⚠️ Adjunto obligatorio</span>
               <span style="color:#64748b"> — Este ticket de turno requiere al menos una imagen/documento adjunto</span>`
          }
        </div>` : ''}

        <!-- Adjunto nuevo (siempre visible) -->
        <div style="margin-bottom:14px">
          <label style="font-size:12px;font-weight:700;color:#475569;display:block;margin-bottom:6px">
            📎 ${esTurno && !tieneAdjunto ? 'Adjuntar documento (obligatorio) *' : 'Adjuntar documento adicional (opcional)'}
          </label>
          <input type="file" id="res-adjunto" accept="image/*,.pdf"
            style="display:none">
          <div onclick="document.getElementById('res-adjunto').click()"
            style="width:100%;border:2px dashed ${esTurno && !tieneAdjunto?'#dc2626':'#cbd5e1'};
                   border-radius:8px;padding:14px 16px;cursor:pointer;box-sizing:border-box;
                   background:#f8fafc;display:flex;align-items:center;gap:12px;
                   transition:border-color .2s,background .2s"
            onmouseover="this.style.background='#f1f5f9';this.style.borderColor='#2563eb'"
            onmouseout="this.style.background='#f8fafc';this.style.borderColor='${esTurno && !tieneAdjunto?'#dc2626':'#cbd5e1'}'">
            <div style="width:40px;height:40px;background:${esTurno && !tieneAdjunto?'#fef2f2':'#eff6ff'};
                        border-radius:10px;display:flex;align-items:center;justify-content:center;
                        font-size:20px;flex-shrink:0">📎</div>
            <div>
              <div id="res-adjunto-label" style="font-size:13px;font-weight:600;color:#1e293b">
                Toca aquí para adjuntar
              </div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px">Imágenes o PDF — máx. 5MB</div>
            </div>
          </div>
          <div id="res-adjunto-preview" style="margin-top:8px"></div>
        </div>

        <!-- Texto de resolución -->
        <div style="margin-bottom:6px">
          <label style="font-size:12px;font-weight:700;color:#475569;display:block;margin-bottom:6px">
            📝 Observaciones / Resolución
          </label>
          <textarea id="res-texto" rows="4" placeholder="Describe cómo se resolvió el ticket, observaciones, acciones tomadas..."
            style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;
                   font-size:13px;resize:none;outline:none;font-family:inherit;box-sizing:border-box"></textarea>
        </div>

        <div style="font-size:11px;color:#94a3b8">
          💡 Se generará un PDF con el historial completo y se enviará notificación por WhatsApp.
        </div>
      </div>

      <!-- Botones -->
      <div style="padding:14px 20px;border-top:1px solid #e2e8f0;display:flex;gap:8px;flex-shrink:0">
        <button onclick="document.getElementById('modal-resolucion').remove()"
          style="flex:1;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:10px;
                 font-size:13px;font-weight:700;color:#64748b;cursor:pointer">Cancelar</button>
        <button id="btn-confirmar-resolucion" onclick="_confirmarResolucion('${ticketId}', ${esTurno}, ${tieneAdjunto})"
          style="flex:2;background:#059669;border:none;border-radius:8px;padding:10px;
                 font-size:13px;font-weight:700;color:#fff;cursor:pointer">✅ Confirmar Resolución</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  // Preview del adjunto seleccionado
  document.getElementById('res-adjunto').addEventListener('change', function() {
    const file = this.files[0];
    const prev  = document.getElementById('res-adjunto-preview');
    const label = document.getElementById('res-adjunto-label');
    if (!file) {
      prev.innerHTML = '';
      if (label) label.textContent = 'Toca aquí para adjuntar';
      return;
    }
    // Actualizar label del botón con el nombre del archivo
    if (label) label.textContent = '✅ ' + file.name;
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => {
        prev.innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:120px;border-radius:8px;border:1px solid #e2e8f0">`;
      };
      reader.readAsDataURL(file);
    } else {
      prev.innerHTML = `<div style="background:#eff6ff;border-radius:8px;padding:8px 12px;font-size:12px;color:#2563eb;display:flex;align-items:center;gap:8px"><span style="font-size:18px">📄</span>${file.name}</div>`;
    }
  });
}

async function _confirmarResolucion(ticketId, esTurno, yaTenieAdjunto) {
  const resTexto  = document.getElementById('res-texto')?.value.trim();
  const fileInput = document.getElementById('res-adjunto');
  const file      = fileInput?.files[0];
  const btn       = document.getElementById('btn-confirmar-resolucion');

  // Validar adjunto obligatorio
  if (esTurno && !yaTenieAdjunto && !file) {
    alert('⚠️ Debes adjuntar al menos una imagen o documento antes de resolver este ticket de turno.');
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Procesando...';

  try {
    let adjuntoBase64 = null;
    if (file) {
      adjuntoBase64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload  = e => res(e.target.result); // data URL base64
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
    }

    const r = await fetch(`/api/tickets/${ticketId}/estado`, {
      method: 'PUT',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+TOKEN },
      body: JSON.stringify({
        estado: 'resuelto',
        resolucion: resTexto || null,
        adjunto_resolucion: adjuntoBase64 || null
      })
    });
    const data = await r.json();

    if (!r.ok) {
      alert(data.error || 'Error al resolver el ticket');
      btn.disabled = false;
      btn.textContent = '✅ Confirmar Resolución';
      return;
    }

    document.getElementById('modal-resolucion')?.remove();
    document.getElementById('ticket-modal')?.remove();
    showToastMsg(data.pdf_generado
      ? '✅ Ticket resuelto — PDF generado y notificación enviada'
      : '✅ Ticket marcado como resuelto');
    await renderTickets();
    actualizarBadgeTickets();
  } catch(e) {
    alert('Error: '+e.message);
    btn.disabled = false;
    btn.textContent = '✅ Confirmar Resolución';
  }
}

// ── Crear ticket al cerrar turno ──────────────────────────────────────────────
async function crearTicketDeTurno(turnoId, turnoLetra, fechaCierre, totalVentas, turnoData, ventas) {
  try {
    // Construir reporte de artículos
    const articulos = {};
    for (const v of (ventas||[])) {
      try {
        const items = await GET('/ventas/'+v.id+'/items');
        for (const item of (items||[])) {
          const k = item.producto_nombre||'Artículo';
          if (!articulos[k]) articulos[k] = {u:0, tot:0};
          articulos[k].u   += parseInt(item.cantidad||1);
          articulos[k].tot += parseInt(item.cantidad||1)*parseFloat(item.precio_unit||item.precio||0);
        }
      } catch(e) {}
    }
    const sep = '================================';
    const pad = (l,r,w=32) => l+' '.repeat(Math.max(1,w-l.length-r.length))+r;
    const emp = USER?.empresa||'METRIC POS';
    let reporte = `${emp}\nARTICULOS VENDIDOS — Turno ${turnoLetra}\n${sep}\n`;
    reporte += pad('ARTICULO','UDS  TOTAL',32)+'\n'+sep.replace(/=/g,'-')+'\n';
    const sorted = Object.entries(articulos).sort((a,b)=>b[1].tot-a[1].tot);
    sorted.forEach(([nom,d]) => {
      const n=nom.length>18?nom.substring(0,18):nom;
      reporte += pad(n, d.u+'u L.'+d.tot.toFixed(2))+'\n';
    });
    reporte += sep+'\n'+pad('TOTAL VENTAS:','L.'+totalVentas.toFixed(2));

    await POST('/tickets', {
      turno_id: turnoId,
      turno_letra: turnoLetra,
      fecha_cierre: fechaCierre,
      total_ventas: totalVentas,
      reporte_articulos: reporte,
      titulo: `Cierre Turno ${turnoLetra} — ${turnoData?.usuario_nombre||'Cajero'}`,
      area: 'Caja',
      tipo: 'Corte de turno',
      prioridad: 'media'
    });
    actualizarBadgeTickets();
  } catch(e) { console.error('Error creando ticket:', e.message); }
}

// ── Badge de tickets en el menú ───────────────────────────────────────────────
async function actualizarBadgeTickets() {
  try {
    const { count } = await GET('/tickets/badge');
    // Buscar el ítem de Tickets en el NAV y agregar badge
    document.querySelectorAll('.nav-item').forEach(btn => {
      if (btn.dataset.view === 'tickets') {
        const badge = btn.querySelector('.ticket-badge');
        if (count > 0) {
          if (badge) { badge.textContent = count; }
          else {
            const b = document.createElement('span');
            b.className = 'ticket-badge';
            b.textContent = count;
            b.style.cssText = 'background:#dc2626;color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;margin-left:6px';
            btn.appendChild(b);
          }
        } else if (badge) { badge.remove(); }
      }
    });
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMULARIO NUEVO TICKET
// ═══════════════════════════════════════════════════════════════════════════
async function abrirFormTicket() {
  // Cargar usuarios para el campo "Asignar a"
  let usuarios = [];
  try { usuarios = await GET('/usuarios'); } catch(e) {}

  const modal = document.createElement('div');
  modal.id = 'tk-form-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:flex-end;justify-content:center';

  modal.innerHTML = `
    <div style="background:#fff;width:100%;max-width:580px;border-radius:18px 18px 0 0;
                max-height:94vh;display:flex;flex-direction:column;box-shadow:0 -8px 40px rgba(0,0,0,.18)">

      <!-- Header -->
      <div style="background:#1e3a5f;padding:16px 20px;border-radius:18px 18px 0 0;
                  display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <div style="font-size:16px;font-weight:800;color:#fff">🎫 Nuevo Ticket</div>
        <button onclick="document.getElementById('tk-form-modal').remove()"
          style="background:rgba(255,255,255,.15);border:none;border-radius:8px;
                 padding:6px 12px;color:#fff;cursor:pointer;font-size:16px">✕</button>
      </div>

      <!-- Formulario -->
      <div style="flex:1;overflow-y:auto;padding:20px">
        <div style="display:flex;flex-direction:column;gap:14px">

          <!-- Área -->
          <div>
            <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:5px">
              ÁREA *
            </label>
            <select id="tk-area"
              style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 12px;
                     font-size:14px;outline:none;background:#fff;box-sizing:border-box">
              <option value="">— Selecciona un área —</option>
              ${TK_AREAS.map(a=>`<option value="${a}">${a}</option>`).join('')}
            </select>
          </div>

          <!-- Título -->
          <div>
            <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:5px">
              TÍTULO DEL TICKET *
            </label>
            <input type="text" id="tk-titulo" placeholder="Ej: Falta de cambio en caja"
              style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 12px;
                     font-size:14px;outline:none;box-sizing:border-box">
          </div>

          <!-- Tipo -->
          <div>
            <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:5px">
              TIPO DE TICKET *
            </label>
            <select id="tk-tipo"
              style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 12px;
                     font-size:14px;outline:none;background:#fff;box-sizing:border-box">
              <option value="">— Selecciona el tipo —</option>
              ${TK_TIPOS.map(t=>`<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>

          <!-- Descripción -->
          <div>
            <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:5px">
              DESCRIPCIÓN DETALLADA *
            </label>
            <textarea id="tk-desc" rows="4" placeholder="Describe el problema con detalle..."
              style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 12px;
                     font-size:14px;outline:none;resize:none;box-sizing:border-box;font-family:inherit"></textarea>
          </div>

          <!-- Prioridad -->
          <div>
            <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:8px">
              PRIORIDAD *
            </label>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
              ${Object.entries(TK_PRIOR).map(([k,p])=>`
                <label style="cursor:pointer">
                  <input type="radio" name="tk-prior" value="${k}"
                    ${k==='media'?'checked':''} style="display:none"
                    onchange="document.querySelectorAll('.tk-prior-btn').forEach(b=>b.style.background='#f8fafc');this.nextElementSibling.style.background='${p.color}18'">
                  <div class="tk-prior-btn" style="text-align:center;padding:8px 6px;border-radius:8px;
                    border:1.5px solid ${p.color}40;font-size:11px;font-weight:700;color:${p.color};
                    background:${k==='media'?p.color+'18':'#f8fafc'}">
                    ${p.label}
                  </div>
                </label>`).join('')}
            </div>
          </div>

          <!-- Asignar a -->
          <div>
            <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:5px">
              ASIGNAR A
            </label>
            <select id="tk-asignado"
              style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 12px;
                     font-size:14px;outline:none;background:#fff;box-sizing:border-box">
              <option value="">— Sin asignar —</option>
              ${usuarios.map(u=>`<option value="${u.id}">${u.nombre} (${u.rol})</option>`).join('')}
            </select>
          </div>

          <!-- Fotos de evidencia -->
          <div>
            <label style="font-size:11px;font-weight:700;color:#64748b;display:block;margin-bottom:5px">
              FOTOS DE EVIDENCIA <span style="font-weight:400">(máx. 5)</span>
            </label>
            <div id="tk-fotos-preview"
              style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;min-height:8px"></div>
            <label id="tk-foto-btn"
              style="display:inline-flex;align-items:center;gap:6px;background:#f1f5f9;
                     border:1.5px dashed #cbd5e1;border-radius:8px;padding:10px 16px;
                     cursor:pointer;font-size:13px;color:#64748b;font-weight:600">
              📷 Agregar foto
              <input type="file" id="tk-foto-input" accept="image/*" multiple
                style="display:none" onchange="tkAgregarFotos(this)">
            </label>
            <div style="font-size:10px;color:#94a3b8;margin-top:4px">JPG, PNG — máximo 5 fotos</div>
          </div>

        </div>
      </div>

      <!-- Botones -->
      <div style="padding:14px 20px;border-top:1px solid #e2e8f0;display:flex;gap:8px;flex-shrink:0">
        <button onclick="document.getElementById('tk-form-modal').remove()"
          style="flex:1;background:#f1f5f9;border:none;border-radius:10px;padding:12px;
                 font-size:14px;cursor:pointer;color:#64748b;font-weight:600">
          Cancelar
        </button>
        <button onclick="guardarNuevoTicket()"
          style="flex:2;background:#1e3a5f;border:none;border-radius:10px;padding:12px;
                 font-size:14px;cursor:pointer;color:#fff;font-weight:800">
          🎫 Crear Ticket
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  // Cerrar al click en overlay
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
}

// ── Manejar fotos ─────────────────────────────────────────────────────────────
window._tkFotos = [];

function tkAgregarFotos(input) {
  const files = Array.from(input.files);
  const restantes = 5 - window._tkFotos.length;
  if (restantes <= 0) { alert('Ya tienes 5 fotos. Elimina alguna para agregar.'); return; }
  const toAdd = files.slice(0, restantes);
  toAdd.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      window._tkFotos.push(e.target.result);
      _renderFotosPreview();
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function _renderFotosPreview() {
  const cont = document.getElementById('tk-fotos-preview');
  if (!cont) return;
  cont.innerHTML = window._tkFotos.map((src, i) => `
    <div style="position:relative;width:70px;height:70px">
      <img src="${src}" style="width:70px;height:70px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0">
      <button onclick="window._tkFotos.splice(${i},1);_renderFotosPreview()"
        style="position:absolute;top:-6px;right:-6px;background:#dc2626;color:#fff;border:none;
               border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;
               display:flex;align-items:center;justify-content:center;font-weight:700">✕</button>
    </div>`).join('');
  // Ocultar botón si llegó a 5
  const btn = document.getElementById('tk-foto-btn');
  if (btn) btn.style.display = window._tkFotos.length >= 5 ? 'none' : 'inline-flex';
}

// ── Guardar nuevo ticket ──────────────────────────────────────────────────────
async function guardarNuevoTicket() {
  window._tkFotos = window._tkFotos || [];

  const area      = document.getElementById('tk-area')?.value;
  const titulo    = document.getElementById('tk-titulo')?.value.trim();
  const tipo      = document.getElementById('tk-tipo')?.value;
  const desc      = document.getElementById('tk-desc')?.value.trim();
  const prioridad = document.querySelector('input[name="tk-prior"]:checked')?.value || 'media';
  const asignado  = document.getElementById('tk-asignado')?.value;

  if (!area)   return alert('Selecciona un área.');
  if (!titulo) return alert('Ingresa el título del ticket.');
  if (!tipo)   return alert('Selecciona el tipo de ticket.');
  if (!desc)   return alert('Ingresa una descripción detallada.');

  try {
    const r = await POST('/tickets', {
      area, titulo, tipo, descripcion: desc,
      prioridad, asignado_a: asignado || null,
      fotos: window._tkFotos
    });
    window._tkFotos = [];
    document.getElementById('tk-form-modal')?.remove();
    showToastMsg('🎫 Ticket creado correctamente');
    actualizarBadgeTickets();
    renderTickets();
  } catch(e) { alert('Error: '+e.message); }
}

// ── Ver foto ampliada ─────────────────────────────────────────────────────────
function tkVerFoto(idx, fotos) {
  const arr = typeof fotos === 'string' ? JSON.parse(fotos) : fotos;
  let cur = parseInt(idx);
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:19999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px';

  const render = () => {
    modal.innerHTML = `
      <img src="${arr[cur]}" style="max-width:90vw;max-height:80vh;border-radius:8px;object-fit:contain">
      <div style="display:flex;gap:12px;align-items:center">
        ${arr.length>1?`<button onclick="event.stopPropagation();tkVerFoto(${(cur-1+arr.length)%arr.length},${JSON.stringify(arr).replace(/"/g,"'")})" style="background:rgba(255,255,255,.2);border:none;border-radius:8px;padding:8px 16px;color:#fff;cursor:pointer;font-size:18px">‹</button>`:''}
        <span style="color:#94a3b8;font-size:12px">${cur+1} / ${arr.length}</span>
        ${arr.length>1?`<button onclick="event.stopPropagation();tkVerFoto(${(cur+1)%arr.length},${JSON.stringify(arr).replace(/"/g,"'")})" style="background:rgba(255,255,255,.2);border:none;border-radius:8px;padding:8px 16px;color:#fff;cursor:pointer;font-size:18px">›</button>`:''}
        <button onclick="this.closest('div[style*=fixed]').remove()" style="background:#dc2626;border:none;border-radius:8px;padding:8px 16px;color:#fff;cursor:pointer">✕ Cerrar</button>
      </div>`;
  };
  render();
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
}
