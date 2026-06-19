# MetricPOS v7.3 — Guía de Despliegue en Producción

---

## 🚂 Opción A: Railway (Recomendado — más fácil)

### Pasos

1. **Subir a GitHub**
   ```bash
   git init
   git add .
   git commit -m "MetricPOS v7.3"
   git remote add origin https://github.com/tu-usuario/metricpos-buenosaires.git
   git push -u origin main
   ```

2. **Crear proyecto en Railway**
   - Ve a [railway.app](https://railway.app) → New Project → Deploy from GitHub
   - Selecciona tu repositorio

3. **Agregar Volume (BD persistente)**
   - En Railway: tu servicio → Storage → Add Volume
   - Mount Path: `/data`

4. **Configurar variables de entorno**
   En Railway → Variables, agregar:
   ```
   NODE_ENV=production
   JWT_SECRET=<clave-aleatoria-64-chars>
   SERVER_URL=https://<tu-subdominio>.up.railway.app
   CORS_ORIGIN=https://<tu-subdominio>.up.railway.app
   ```
   Generar JWT_SECRET:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

5. **Dominio personalizado** (opcional)
   - Railway → Settings → Domains → Add Custom Domain
   - Apuntar DNS de tu dominio al CNAME de Railway

---

## 🖥️ Opción B: VPS con Docker (Ubuntu 20/22/24)

### Requisitos
- Ubuntu 20.04+ con 1GB RAM mínimo
- Docker y Docker Compose instalados
- Puerto 80/443 abierto

### Instalación

```bash
# 1. Instalar Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 2. Instalar Docker Compose
sudo apt install docker-compose-plugin -y

# 3. Subir los archivos al VPS
scp -r metricposbuenosaires/ usuario@tu-vps:/opt/metricpos/

# 4. Configurar variables de entorno
cd /opt/metricpos/metricposbuenosaires
cp .env.example .env
nano .env   # Editar JWT_SECRET, SERVER_URL, etc.

# 5. Construir y levantar
docker compose up -d --build

# 6. Verificar que funciona
curl http://localhost:3000/api/licencia/estado
```

### Nginx + SSL (HTTPS gratuito con Certbot)

```bash
# 1. Instalar Nginx y Certbot
sudo apt install nginx certbot python3-certbot-nginx -y

# 2. Copiar configuración
sudo cp nginx.conf /etc/nginx/sites-available/metricpos
# Editar "tu-dominio.com" en el archivo
sudo nano /etc/nginx/sites-available/metricpos
sudo ln -s /etc/nginx/sites-available/metricpos /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 3. Generar certificado SSL gratuito
sudo certbot --nginx -d tu-dominio.com

# 4. Cambiar docker-compose.yml: puerto solo local
# ports: - "127.0.0.1:3000:3000"
docker compose up -d
```

---

## 🖥️ Opción C: VPS con PM2 (sin Docker)

### Requisitos
- Node.js 18+ instalado en el VPS

```bash
# 1. Subir archivos
scp -r metricposbuenosaires/ usuario@tu-vps:/opt/metricpos/

# 2. Instalar dependencias
cd /opt/metricpos/metricposbuenosaires
npm install --omit=dev

# 3. Configurar variables
cp .env.example .env
nano .env

# 4. Instalar PM2 y arrancar
npm install -g pm2
pm2 start server.js --name metricpos-buenosaires
pm2 save
pm2 startup   # Auto-inicio en boot

# 5. Nginx igual que Opción B
```

---

## ✅ Verificación post-despliegue

```bash
# Verificar que responde
curl https://tu-dominio.com/api/licencia/estado

# Ver logs (Railway)
railway logs

# Ver logs (Docker)
docker compose logs -f

# Ver logs (PM2)
pm2 logs metricpos-buenosaires
```

---

## 🔒 Seguridad en producción

- Cambiar contraseña de `admin` inmediatamente
- Usar JWT_SECRET aleatorio y largo (mínimo 64 chars)
- Habilitar HTTPS (Certbot o Railway lo hace automático)
- Configurar CORS_ORIGIN con tu dominio exacto
- Hacer backup periódico de la BD

### Backup de la BD

**Railway:** Descargar el archivo desde Railway → Volume → Files

**Docker:**
```bash
docker cp metricpos-buenosaires:/datos/metricpos/metricpos.db ./backup-$(date +%Y%m%d).db
```

**PM2:**
```bash
cp /opt/metricpos/metricposbuenosaires/data/metricpos.db ./backup-$(date +%Y%m%d).db
```

---

*MetricPOS v7.3 — Inversiones Buenos Aires S.A.*
