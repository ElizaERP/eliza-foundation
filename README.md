# ELIZA Foundation Platform

> Plataforma SaaS ERP multi-tenant para manufactura y comercialización de alimentos congelados. Construida con NestJS + Prisma + PostgreSQL + Redis + Keycloak, aplicando DDD + Hexagonal Architecture en Modular Monolith.

## 🚀 Empezar aquí

**¿Primera vez?** → Sigue paso a paso **[GETTING-STARTED.md](GETTING-STARTED.md)**: en 15 minutos tendrás la app corriendo.

```bash
git clone <repo>
cd eliza-foundation
make install
make infra-up
make db-migrate
make jwt        # genera JWT de prueba
make jwks-server &   # en background
make dev        # en otra terminal
make smoke      # verifica end-to-end
```

## 📚 Documentación

| Archivo | Para qué |
|---|---|
| [GETTING-STARTED.md](GETTING-STARTED.md) | **Guía maestra paso a paso** desde `git clone` a "curl funciona" |
| [API-REFERENCE.md](API-REFERENCE.md) | Catálogo de los 38 endpoints + curls listos |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Manual exhaustivo de variables de entorno |
| [KUBERNETES.md](KUBERNETES.md) | Cómo aplicar los manifiestos k8s + operación día a día |
| [DEPLOYMENT-OCI.md](DEPLOYMENT-OCI.md) | Provisionamiento completo en Oracle Cloud |
| [TESTING.md](TESTING.md), `TESTING-SPRINT1..4.md` | Testing detallado por sprint |

## 🏗️ Arquitectura — Estado actual

La **Foundation Platform** está completa: 124 archivos TS, ~11.200 líneas, 4 Bounded Contexts construidos:

| Sprint | Bounded Context | Estado |
|---|---|---|
| 0 | Shared Kernel + Bootstrap | ✅ |
| 1 | Tenant Management | ✅ |
| 2 | IAM + Keycloak federation | ✅ |
| 3 | Audit log con hash chain | ✅ |
| 4 | Outbox Dispatcher + Read Models | ✅ |

## 🛠️ Stack

- **Backend**: NestJS 10 + TypeScript 5.5 strict
- **ORM**: Prisma 5 + PostgreSQL 16 (con RLS multi-tenant)
- **Cache + Bus de eventos**: Redis 7 (Redis Streams para producción multi-pod)
- **Identity**: Keycloak 25 (RBAC con 20 roles canónicos)
- **Observabilidad**: OpenTelemetry, Pino logs, Prometheus metrics
- **Orquestación**: Kubernetes (OCI OKE), patrón writers + workers
- **IaC**: Terraform para OCI (VCN, OKE, PostgreSQL managed, Vault, OCIR)
- **CI/CD**: GitHub Actions (CI en cada PR, release on tag)

## 📂 Estructura del repo

```
.
├── src/
│   ├── shared-kernel/          # Base común: domain primitives, ports, infra
│   └── contexts/
│       ├── tenant/             # Sprint 1
│       ├── iam/                # Sprint 2
│       ├── audit/              # Sprint 3
│       └── outbox/             # Sprint 4
├── prisma/
│   ├── schema.prisma           # Multi-schema (tenant, iam, audit, platform)
│   └── init/                   # Bootstrap SQL (roles, schemas, helpers)
├── keycloak/realm/             # Realm preconfigurado con 20 roles
├── k8s/                        # Manifiestos Kubernetes
├── terraform/                  # Infraestructura como código (OCI)
├── nginx/                      # Config del LB local en docker compose
├── scripts/                    # JWT generator, smoke test, JWKS server
├── .github/workflows/          # CI + Release
├── Dockerfile                  # Multi-stage productivo
├── docker-compose.yml          # Infra local (Postgres, Redis, Keycloak)
├── docker-compose.app.yml      # Pila completa con writers/workers + nginx
└── Makefile                    # Atajos para TODO
```

## 🎯 Filosofía de diseño

- **Multi-tenant first**: cada request lleva un `tenantId` propagado vía AsyncLocalStorage, enforced por Postgres RLS en la BD
- **Domain-Driven**: agregados encapsulan invariantes, eventos como ciudadanos de primera clase
- **Hexagonal**: dominio no conoce infraestructura; ports + adapters separan claramente
- **Event-Driven**: Outbox transaccional + Dispatcher worker + Read Models materializados
- **Inmutable audit trail**: hash chain SHA-256 por tenant, verificable criptográficamente
- **Cloud-native**: 12-factor, stateless, escalable horizontalmente
- **Production-ready desde sprint 0**: graceful shutdown, healthchecks, observabilidad, security headers

## 🤝 Contribuir

Si extiendes la Foundation con un nuevo Bounded Context, sigue el patrón establecido:

```
src/contexts/<nombre>/
├── domain/                     # Aggregates, VOs, events, ports
├── application/                # Use cases (commands + queries)
├── infrastructure/             # Adapters (Prisma, HTTP clients, ...)
├── interface/http/             # Controllers + DTOs
└── <nombre>.module.ts          # Wiring
```

## 📜 Licencia

Propietaria — © ELIZA Platform team.
