# ══════════════════════════════════════════════════════════
#  MetricPOS v7.3 — Dockerfile para VPS
#  Imagen: node:20-alpine (~180MB)
# ══════════════════════════════════════════════════════════

FROM node:20-alpine

# Metadatos
LABEL maintainer="MetricPOS Honduras"
LABEL version="7.3.0"
LABEL description="Sistema de Punto de Venta — MetricPOS"

# Directorio de trabajo
WORKDIR /app

# Instalar dependencias del SO necesarias para pdfkit (fuentes)
RUN apk add --no-cache fontconfig ttf-dejavu

# Copiar package.json primero (caching de capas de Docker)
COPY package*.json ./

# Instalar solo dependencias de producción
RUN npm ci --omit=dev && npm cache clean --force

# Copiar el resto del código
COPY . .

# Crear directorio de datos (la BD se monta como volumen)
RUN mkdir -p /datos/metricpos && chown node:node /datos/metricpos

# Variables de entorno por defecto (sobreescribir en docker-compose o runtime)
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/datos/metricpos

# Puerto expuesto
EXPOSE 3000

# Ejecutar como usuario no-root
USER node

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/licencia/estado || exit 1

# Comando de inicio
CMD ["node", "server.js"]
