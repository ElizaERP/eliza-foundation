// =====================================================================
// PATCH para src/app.module.ts
// =====================================================================
//
// El proyecto actual ya tiene los 5 BCs registrados:
//   - TenantContextModule
//   - IamContextModule
//   - AuditContextModule
//   - OutboxContextModule
//   - CatalogContextModule
//
// Para registrar el sexto (Inventory), aplica los siguientes cambios:
//
// 1. AGREGAR EL IMPORT (al inicio del archivo, junto a los demás contexts):
// ---------------------------------------------------------------------

import { InventoryContextModule } from '@eliza/contexts/inventory/inventory.module';

// 2. AÑADIR AL ARRAY `imports` DEL @Module():
// ---------------------------------------------------------------------
//
// Antes:
//   imports: [
//     ConfigModule.forRoot({ ... }),
//     LoggerModule.forRoot({ ... }),
//     SharedKernelModule,
//     TenantContextModule,
//     IamContextModule,
//     AuditContextModule,
//     OutboxContextModule,
//     CatalogContextModule,
//   ],
//
// Después:
//   imports: [
//     ConfigModule.forRoot({ ... }),
//     LoggerModule.forRoot({ ... }),
//     SharedKernelModule,
//     TenantContextModule,
//     IamContextModule,
//     AuditContextModule,
//     OutboxContextModule,
//     CatalogContextModule,
//     InventoryContextModule,      // ← NUEVO (mantener al final, después de Catalog)
//   ],
//
// IMPORTANTE: InventoryContextModule depende de CatalogContextModule (para
// validar productos al registrar lotes), así que debe ir DESPUÉS de Catalog
// en el orden de imports.
