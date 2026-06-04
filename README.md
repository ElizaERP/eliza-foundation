# ELIZA Foundation Platform

> Plataforma SaaS Multi-Tenant empresarial — capa base sobre la que se construyen todos los módulos de negocio.

**Stack**: NestJS · TypeScript · Prisma · PostgreSQL 16 · Redis · Keycloak
**Patrón**: Modular Monolith con **DDD + Hexagonal Architecture (Ports & Adapters)**
**Evolución futura**: extracción a microservicios usando **Vertical Slice Architecture**

---

## 🎯 Bounded Contexts de la Foundation Platform

| Contexto | Responsabilidad | Estado |
|---|---|---|
| **Tenant** | Ciclo de vida de tenants, planes, features, configuración | Sprint 1 — pendiente |
| **IAM** | Identidad, autenticación (Keycloak), RBAC + ABAC, membresías | Sprint 2 — pendiente |
| **Audit** | Audit trail inmutable, hash chain, query forense | Sprint 3 — pendiente |

Ningún módulo de negocio (Manufacturing, Inventory, Sales, etc.) puede existir sin esta Foundation.

---

## 🏛️ Estructura del proyecto

```
src/
├── main.ts                          # Bootstrap (seguridad, OpenAPI, filters)
├── app.module.ts                    # Módulo raíz + middleware global
├── config/
│   └── env.validation.ts            # Validación Joi de variables de entorno
├── shared-kernel/                   # Building blocks compartidos
│   ├── domain/                      # AggregateRoot, Entity, ValueObject,
│   │                                # DomainEvent, Identifier, Result, Guard
│   ├── application/                 # UseCase, Command, Query, Ports
│   └── infrastructure/
│       ├── prisma/                  # PrismaService con RLS automático
│       ├── tenant-context/          # AsyncLocalStorage + middleware
│       └── exceptions/              # Problem Details RFC 7807
└── contexts/                        # Bounded Contexts (Sprints 1-3)
    ├── tenant/                      # ← Sprint 1
    ├── iam/                         # ← Sprint 2
    └── audit/                       # ← Sprint 3

prisma/
├── schema.prisma                    # Schema multi-context (tenant, iam, audit, platform)
└── init/                            # Bootstrap SQL (roles, schemas, RLS helpers)
```

**Cada bounded context internamente** mantiene la misma división hexagonal:
```
contexts/<ctx>/
├── domain/                          # Aggregates, VOs, Domain Events, Ports
├── application/                     # Use Cases, DTOs
├── infrastructure/                  # Adapters: Prisma repo, Keycloak, etc.
├── interface/                       # REST controllers, OpenAPI DTOs
└── <ctx>.module.ts                  # Wiring NestJS
```

---

## 🔐 Seguridad multi-tenant — tres barreras

| Capa | Mecanismo | Defensa |
|---|---|---|
| **Aplicación** | `TenantContextMiddleware` extrae `tenant_id` del JWT y lo establece en `AsyncLocalStorage` | Primera defensa |
| **Aplicación** | `PrismaService.withTenant()` hace `SET LOCAL app.tenant_id` por transacción | Vincula app ↔ BD |
| **Base de datos** | PostgreSQL RLS con `FORCE ROW LEVEL SECURITY` sobre el rol `app_user` | Última defensa — inmune a bugs |

El `tenant_id` **nunca** viene de body/query: solo de JWT firmado, header de tooling interno, o subdomain.

---

## 🚀 Setup local

### Prerequisitos
- Node 20+ · pnpm 9+ · Docker · Docker Compose

### Pasos

```bash
# 1. Variables de entorno
cp .env.example .env

# 2. Levantar infraestructura local (Postgres + Redis + Keycloak)
pnpm infra:up

# 3. Instalar dependencias
pnpm install

# 4. Generar Prisma Client + ejecutar migraciones
pnpm prisma:generate
pnpm prisma:migrate:dev

# 5. Arrancar en modo dev
pnpm start:dev
```

La app queda en `http://localhost:3000/api/v1` y la OpenAPI en `http://localhost:3000/docs`.

---

## 🧪 Tests

```bash
pnpm test                  # unit tests
pnpm test:watch            # watch mode
pnpm test:cov              # con cobertura
pnpm test:e2e              # end-to-end (requiere infra arriba)
```

**Política de cobertura mínima** (se enforza en CI):
- Domain layer: ≥ 95%
- Application layer: ≥ 90%
- Infrastructure layer: ≥ 70%

---

## 📐 Decisiones arquitectónicas vinculantes

1. **DDD + Hexagonal** para el Modular Monolith. Las capas Domain y Application **no importan** nada de Infrastructure.
2. **Ports en `application/ports.ts`**: el dominio define los contratos; infraestructura los implementa.
3. **`Result<T, E>`** en lugar de excepciones para errores esperables. Excepciones reservadas para bugs.
4. **`tenant_id` obligatorio** en todo modelo de negocio, todo evento, todo cache key, todo log.
5. **Outbox Pattern** para emisión de eventos: persistencia atómica con el agregado.
6. **Problem Details RFC 7807** para todas las respuestas de error de la API.
7. **`correlationId`** propagado en cada request (header `X-Correlation-Id`) y logueado.

---

## 🗺️ Roadmap de sprints

| Sprint | Entregable | Estado |
|---|---|---|
| **0** | Bootstrap + Shared Kernel | ✅ **completado** |
| **1** | Tenant Context (aggregate, use cases, REST API) | ⏳ siguiente |
| **2** | IAM Context (Keycloak adapter, RBAC + ABAC, guards) | ⏳ |
| **3** | Audit Context (immutable log, hash chain, query API) | ⏳ |
| **4** | Documento 14 — generación del .docx final | ⏳ |

---

## 📚 Documentos arquitectónicos de referencia

Esta implementación se alinea 1:1 con:
- **Doc 1** — BCM
- **Doc 6** — Arquitectura Modular Empresarial
- **Doc 9** — Event Driven Architecture
- **Doc 10** — Cloud y DevOps
- **Doc 11** — Seguridad Empresarial
- **Doc 12** — SaaS Multi-Tenant
- **Doc 13** — Analítica Empresarial

Los documentos 7 (Vertical Slice .NET) y 8 (Datos .NET) son **referencia histórica del stack anterior** y no aplican al desarrollo actual.
