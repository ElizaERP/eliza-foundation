/* eslint-disable no-console */
/**
 * prisma/seed.ts — seed mínimo para desarrollo local.
 *
 * Crea:
 *   1. Un Platform Admin user de prueba (sólo entry en iam.users; en
 *      Sprint 2 se sincroniza con Keycloak).
 *   2. Un tenant de prueba "BCM Congelados" en estado Active.
 *
 * Ejecutar:  pnpm db:seed
 *
 * IMPORTANTE: solo para dev. NUNCA correr en producción.
 */

import { PrismaClient, TenantPlan, TenantStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Seeding ELIZA Foundation local database...');

  const platformAdminId = '00000000-0000-0000-0000-000000000001';
  const tenantId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const now = new Date();

  // -------- 1. Tenant de prueba --------
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: {
      id: tenantId,
      code: 'bcm-congelados',
      name: 'BCM Congelados S.A.S.',
      status: TenantStatus.Active,
      plan: TenantPlan.Professional,
      createdAt: now,
      createdBy: platformAdminId,
      updatedAt: now,
      updatedBy: platformAdminId,
      version: 1,
    },
  });

  // -------- 2. User platform admin --------
  await prisma.user.upsert({
    where: { id: platformAdminId },
    update: {},
    create: {
      id: platformAdminId,
      keycloakSubject: '00000000-0000-0000-0000-000000000001',
      email: 'platform-admin@eliza.app',
      fullName: 'Platform Administrator',
      status: 'Active',
      createdAt: now,
      createdBy: platformAdminId, // self
      updatedAt: now,
      updatedBy: platformAdminId,
      version: 1,
    },
  });

  // -------- 3. User Tenant Admin del tenant de prueba --------
  const tenantAdminId = '550e8400-e29b-41d4-a716-446655440000';
  await prisma.user.upsert({
    where: { id: tenantAdminId },
    update: {},
    create: {
      id: tenantAdminId,
      keycloakSubject: uuidv4(),
      email: 'admin@bcm-congelados.com',
      fullName: 'BCM Tenant Admin',
      status: 'Active',
      createdAt: now,
      createdBy: platformAdminId,
      updatedAt: now,
      updatedBy: platformAdminId,
      version: 1,
    },
  });

  await prisma.userTenantMembership.upsert({
    where: { userId_tenantId: { userId: tenantAdminId, tenantId } },
    update: {},
    create: {
      id: uuidv4(),
      userId: tenantAdminId,
      tenantId,
      isActive: true,
      createdAt: now,
      createdBy: platformAdminId,
      updatedAt: now,
      updatedBy: platformAdminId,
      version: 1,
    },
  });

  console.log(`✅ Seeded:`);
  console.log(`   Tenant:        ${tenantId} (bcm-congelados, Active, Professional)`);
  console.log(`   Platform Admin: ${platformAdminId}`);
  console.log(`   Tenant Admin:   ${tenantAdminId}`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
