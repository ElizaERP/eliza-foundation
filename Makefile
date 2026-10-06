# =====================================================================
# ELIZA Foundation Platform — Makefile
# =====================================================================
# Atajos para las operaciones más comunes. Ejecuta `make help` para ver todas.

.DEFAULT_GOAL := help

# Variables sobreescribibles desde la línea de comando, ej: make build VERSION=v0.2.0
VERSION       ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
IMAGE_NAME    ?= eliza-foundation
IMAGE_TAG     ?= $(VERSION)
OCIR_REGION   ?= iad
OCIR_TENANCY  ?= my-tenancy-namespace
FULL_IMAGE    := $(OCIR_REGION).ocir.io/$(OCIR_TENANCY)/$(IMAGE_NAME):$(IMAGE_TAG)

# Conexión PRIVILEGIADA para migraciones y seeds (DDL + escribe sin RLS).
# La app NUNCA usa esta URL: corre con app_user vía DATABASE_URL del .env.
# Local: superusuario de docker-compose. Sobrescribible: make db-migrate MIGRATION_URL=...
MIGRATION_URL ?= postgresql://postgres:postgres@localhost:5432/eliza?schema=public

# ---------- Help ----------
.PHONY: help
help:  ## Muestra esta ayuda
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------- Local development ----------
.PHONY: install
install:  ## Instala dependencias con pnpm
	pnpm install

.PHONY: infra-up
infra-up:  ## Levanta Postgres + Redis + Keycloak (sin app)
	docker compose up -d
	@echo "Postgres: localhost:5432 | Redis: localhost:6379 | Keycloak: localhost:8080"

.PHONY: infra-down
infra-down:  ## Detiene la infra
	docker compose down

.PHONY: infra-clean
infra-clean:  ## Detiene y BORRA volúmenes (cuidado: se pierde la BD)
	docker compose down -v

.PHONY: infra-logs
infra-logs:  ## Tail de logs de la infra
	docker compose logs -f

# ---------- Database ----------
.PHONY: db-migrate
db-migrate:  ## Aplica migraciones de Prisma (dev mode)
	DATABASE_URL="$(MIGRATION_URL)" pnpm prisma migrate dev

.PHONY: db-migrate-deploy
db-migrate-deploy:  ## Aplica migraciones en modo producción (sin prompts)
	DATABASE_URL="$(MIGRATION_URL)" pnpm prisma migrate deploy

.PHONY: db-generate
db-generate:  ## Regenera el Prisma client
	pnpm prisma generate

.PHONY: db-studio
db-studio:  ## Abre Prisma Studio (UI para la BD)
	pnpm prisma studio

.PHONY: db-seed
db-seed:  ## Carga datos de prueba (tenant + admin users)
	DATABASE_URL="$(MIGRATION_URL)" pnpm db:seed

.PHONY: seed-catalog
seed-catalog:  ## Carga datos de Catalog (UoMs + categorías + productos + BOMs)
	DATABASE_URL="$(MIGRATION_URL)" pnpm ts-node prisma/seed-catalog.ts

.PHONY: seed-inventory
seed-inventory:  ## Carga datos de Inventory (bodegas, ubicaciones, lotes)
	DATABASE_URL="$(MIGRATION_URL)" pnpm ts-node prisma/seed-inventory.ts

.PHONY: db-rls-check
db-rls-check:  ## Verifica aislamiento multi-tenant (RLS) contra la BD local — no deja datos
	docker exec -i eliza-postgres psql -U postgres -d eliza < scripts/rls-check.sql

.PHONY: db-reset
db-reset:  ## DROP + migrate + seed (cuidado: borra todo)
	DATABASE_URL="$(MIGRATION_URL)" pnpm prisma migrate reset --force

# ---------- App ----------
.PHONY: dev
dev:  ## Arranca la app en watch mode
	pnpm start:dev

.PHONY: build
build:  ## Compila TypeScript
	pnpm build

.PHONY: lint
lint:  ## Ejecuta linter
	pnpm lint

.PHONY: test
test:  ## Tests unitarios
	pnpm test

.PHONY: test-cov
test-cov:  ## Tests con cobertura
	pnpm test:cov

.PHONY: test-e2e
test-e2e:  ## Tests end-to-end (requiere infra arriba)
	pnpm test:e2e

# ---------- JWT testing local ----------
.PHONY: jwt
jwt:  ## Genera un JWT de Platform.Admin para curl rápido
	@pnpm -s ts-node scripts/gen-test-jwt.ts --roles Platform.Admin 2>/dev/null | tail -3

.PHONY: jwks-server
jwks-server:  ## Sirve el JWKS local en :9999 (para validación sin Keycloak)
	pnpm ts-node scripts/jwks-server.ts

# ---------- Docker ----------
.PHONY: docker-build
docker-build:  ## Construye la imagen Docker
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) -t $(IMAGE_NAME):latest .

.PHONY: docker-build-arm64
docker-build-arm64:  ## Construye la imagen para la VM OCI A1 (ARM64) con buildx
	docker buildx build --platform linux/arm64 -t $(IMAGE_NAME):$(IMAGE_TAG)-arm64 --load .

.PHONY: docker-run
docker-run:  ## Corre la app + infra en contenedores (modo writers/worker)
	docker compose -f docker-compose.yml -f docker-compose.app.yml up --build

.PHONY: docker-stop
docker-stop:  ## Detiene los contenedores del modo completo
	docker compose -f docker-compose.yml -f docker-compose.app.yml down

.PHONY: docker-tag-ocir
docker-tag-ocir:  ## Etiqueta la imagen para OCIR
	docker tag $(IMAGE_NAME):$(IMAGE_TAG) $(FULL_IMAGE)
	@echo "Tagged as $(FULL_IMAGE)"

.PHONY: docker-push-ocir
docker-push-ocir: docker-tag-ocir  ## Push a OCI Container Registry
	docker push $(FULL_IMAGE)

# ---------- Kubernetes ----------
.PHONY: k8s-apply
k8s-apply:  ## Aplica todos los manifiestos en k8s/
	kubectl apply -f k8s/namespace.yaml
	kubectl apply -f k8s/

.PHONY: k8s-status
k8s-status:  ## Estado de los pods en el namespace eliza
	kubectl get all -n eliza

.PHONY: k8s-logs-writers
k8s-logs-writers:  ## Logs en vivo de los writers
	kubectl logs -f -n eliza -l role=writer --tail=100

.PHONY: k8s-logs-workers
k8s-logs-workers:  ## Logs en vivo de los workers
	kubectl logs -f -n eliza -l role=worker --tail=100

.PHONY: k8s-restart
k8s-restart:  ## Reinicia ambos Deployments sin downtime
	kubectl rollout restart deployment/eliza-foundation-writers -n eliza
	kubectl rollout restart deployment/eliza-foundation-workers -n eliza

# ---------- Terraform ----------
.PHONY: tf-init
tf-init:  ## terraform init
	cd terraform && terraform init

.PHONY: tf-plan
tf-plan:  ## terraform plan
	cd terraform && terraform plan -var-file=staging.tfvars

.PHONY: tf-apply
tf-apply:  ## terraform apply (cuidado: provisiona recursos OCI reales)
	cd terraform && terraform apply -var-file=staging.tfvars

# ---------- Smoke test ----------
.PHONY: smoke
smoke:  ## Ejecuta el smoke test end-to-end contra la app local
	@bash scripts/smoke-test.sh

# ---------- Limpieza ----------
.PHONY: clean
clean:  ## Limpia node_modules, dist, coverage
	rm -rf node_modules dist coverage .dev-keys

.PHONY: nuke
nuke: clean infra-clean  ## Limpieza total (cuidado: borra BD también)
	@echo "💀 Todo borrado. Para empezar de cero: make install && make infra-up && make db-migrate && make db-seed"
