# Fase 0 — Scripts de evidencia

Convierten las tareas de cierre de la Fase 0 en evidencia reproducible. Ninguno
modifica producción.

| Script | Dónde se ejecuta | Qué cierra |
| --- | --- | --- |
| `vm-evidence.sh` | En la VM (solo lectura) | VM encendida y accesible, commit en ejecución, artefactos usados, datos reales, backups programados, firewall efectivo, SSH |
| `restore-test.sh <backup>` | En la VM (contenedor temporal) | Restore probado y su tiempo |
| `pr-validation.sh` | En tu máquina, rama `fase-0/baseline` | Build, lint, tests, imagen ARM64, Compose con volumen nuevo, migraciones con RLS, privilegios de `app_user`, aislamiento |

## Orden

1. En la VM: `bash vm-evidence.sh` y copia la carpeta resultante con `scp`.
2. Si la sección 10 del informe muestra datos reales: `bash restore-test.sh <último backup>`.
3. En tu máquina: `docker compose down` (sin `-v`) y `bash scripts/fase0/pr-validation.sh`.
4. Manual: flujos de `TESTING-*.md` con `DATABASE_URL` apuntando a `app_user`.
5. Security List de OCI: exportarla desde la consola (VCN → Security Lists) o captura.
6. Push de la rama y PR: el CI debe quedar en verde.

Con la evidencia de los pasos 1 a 6 se decide el merge y el Go/No-Go de la Fase 0.
