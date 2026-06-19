#!/bin/sh
# ══════════════════════════════════════════════════════════
#  Entrypoint — corrige permisos del volumen montado por Railway
#  antes de arrancar la aplicación como usuario no-root.
# ══════════════════════════════════════════════════════════
set -e

DATA_DIR="${DATA_DIR:-/datos/metricpos}"

echo "🔧 Verificando permisos en $DATA_DIR..."

# Crear el directorio si no existe (por si el volumen está vacío)
mkdir -p "$DATA_DIR"

# Forzar dueño 'node' sobre el punto de montaje del volumen.
# Railway monta los volúmenes con dueño root por defecto, lo que
# bloquea la escritura cuando el proceso corre como usuario node.
chown -R node:node "$DATA_DIR" 2>/dev/null || true

echo "✅ Permisos corregidos en $DATA_DIR — iniciando como usuario 'node'"

# Bajar privilegios y ejecutar el comando real (node server.js)
exec su-exec node "$@"
