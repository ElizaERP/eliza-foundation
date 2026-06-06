/**
 * prisma/seed-inventory.ts
 *
 * Ejecutar:  pnpm exec ts-node prisma/seed-inventory.ts
 * Requiere:  seed del Catalog ya ejecutado (prisma/seed.ts)
 */
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

const prisma = new PrismaClient() as any;

const TENANT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SEED_USER_ID = '00000000-0000-0000-0000-000000000001';

function ulidToUuid(s: string): string {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = new Uint8Array(16);
  let bits = 0, value = 0, idx = 0;
  for (const c of s.toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes[idx++] = (value >> bits) & 0xff; if (idx === 16) break; }
  }
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const newId = () => ulidToUuid(ulid());

async function main(): Promise<void> {
  console.log('🌱 Seeding inventory…');

  // Limpiar (idempotencia)
  await prisma.reserva.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.movimientoInventario.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.existencia.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.lote.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.location.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.warehouse.deleteMany({ where: { tenantId: TENANT_ID } });
  console.log('  ✓ Cleared previous inventory data');

  // 1) Warehouse
  const warehouseId = newId();
  await prisma.warehouse.create({ data: {
    id: warehouseId, tenantId: TENANT_ID, code: 'PB', name: 'Planta Bucaramanga',
    address: 'Carrera 27 #36-65, Bucaramanga, Santander', isActive: true, version: 1,
  }});
  console.log('  ✓ Created warehouse PB');

  // 2) Locations
  const locRecepId = newId(), locCamFzId = newId(), locCamRfId = newId(), locEstSecoId = newId();
  await prisma.location.createMany({ data: [
    { id: locRecepId, tenantId: TENANT_ID, warehouseId, code: 'PB-RECEP', name: 'Zona de Recepción', tipoUbicacion: 'Recepcion', isActive: true, version: 1 },
    { id: locCamFzId, tenantId: TENANT_ID, warehouseId, code: 'PB-CAM-FZ', name: 'Cámara Congelación -18°C', tipoUbicacion: 'Camara', tempMinC: -22, tempMaxC: -15, capacidadMax: 5000, isActive: true, version: 1 },
    { id: locCamRfId, tenantId: TENANT_ID, warehouseId, code: 'PB-CAM-RF', name: 'Cámara Refrigeración 4°C', tipoUbicacion: 'Camara', tempMinC: 0, tempMaxC: 6, capacidadMax: 1000, isActive: true, version: 1 },
    { id: locEstSecoId, tenantId: TENANT_ID, warehouseId, code: 'PB-EST-SECO', name: 'Estantería Materia Prima Seca', tipoUbicacion: 'Estante', capacidadMax: 3000, isActive: true, version: 1 },
  ]});
  console.log('  ✓ Created 4 locations');

  // 3) Buscar productos del catalog seed
  const arpMini = await prisma.product.findFirst({ where: { tenantId: TENANT_ID, code: 'ARP-MINI-12U' } });
  const queso = await prisma.product.findFirst({ where: { tenantId: TENANT_ID, code: 'RM-QUESO-FRESCO' } });
  const harina = await prisma.product.findFirst({ where: { tenantId: TENANT_ID, code: 'RM-HARINA-MAIZ' } });
  if (!arpMini || !queso || !harina) throw new Error('Required products not found. Run seed.ts first.');
  console.log('  ✓ Found products from catalog seed');

  // 4) Lotes
  const lotePTId = newId(), loteQuesoId = newId(), loteHarinaId = newId();
  const now = new Date();
  await prisma.lote.createMany({ data: [
    { id: lotePTId, tenantId: TENANT_ID, codigoLote: 'BCM-ARP-MINI-2026-04-15-001', productId: arpMini.id,
      fechaProduccion: new Date('2026-04-15'), fechaVencimiento: new Date('2026-10-15'),
      cantidadInicial: 500, estado: 'Disponible', origenTipo: 'Manual',
      notas: 'Lote inicial PT apertura', version: 1, createdAt: now, updatedAt: now },
    { id: loteQuesoId, tenantId: TENANT_ID, codigoLote: 'BCM-RM-QUESO-2026-06-01-001', productId: queso.id,
      fechaProduccion: new Date('2026-06-01'), fechaVencimiento: new Date('2026-07-01'),
      cantidadInicial: 100, estado: 'Disponible', origenTipo: 'Manual',
      notas: 'Queso fresco apertura', version: 1, createdAt: now, updatedAt: now },
    { id: loteHarinaId, tenantId: TENANT_ID, codigoLote: 'BCM-RM-HARINA-2026-05-01-001', productId: harina.id,
      fechaProduccion: new Date('2026-05-01'), fechaVencimiento: new Date('2027-05-01'),
      cantidadInicial: 200, estado: 'Disponible', origenTipo: 'Manual',
      notas: 'Harina de maíz apertura', version: 1, createdAt: now, updatedAt: now },
  ]});
  console.log('  ✓ Created 3 lotes');

  // 5) Existencias iniciales
  await prisma.existencia.createMany({ data: [
    { id: newId(), tenantId: TENANT_ID, productId: arpMini.id, loteId: lotePTId, locationId: locCamFzId,
      cantidadDisponible: 500, cantidadReservada: 0, cantidadBloqueada: 0, version: 1, createdAt: now, updatedAt: now },
    { id: newId(), tenantId: TENANT_ID, productId: queso.id, loteId: loteQuesoId, locationId: locCamRfId,
      cantidadDisponible: 100, cantidadReservada: 0, cantidadBloqueada: 0, version: 1, createdAt: now, updatedAt: now },
    { id: newId(), tenantId: TENANT_ID, productId: harina.id, loteId: loteHarinaId, locationId: locEstSecoId,
      cantidadDisponible: 200, cantidadReservada: 0, cantidadBloqueada: 0, version: 1, createdAt: now, updatedAt: now },
  ]});
  console.log('  ✓ Created 3 existencias');

  // 6) Movimientos kardex apertura
  await prisma.movimientoInventario.createMany({ data: [
    { id: newId(), tenantId: TENANT_ID, tipo: 'Entrada', productId: arpMini.id, loteId: lotePTId,
      locationId: locCamFzId, cantidad: 500, referenciaTipo: 'Manual', referenciaId: 'seed-initial',
      motivo: 'Apertura de inventario', ocurridoEn: now, registradoPor: SEED_USER_ID, createdAt: now },
    { id: newId(), tenantId: TENANT_ID, tipo: 'Entrada', productId: queso.id, loteId: loteQuesoId,
      locationId: locCamRfId, cantidad: 100, referenciaTipo: 'Manual', referenciaId: 'seed-initial',
      motivo: 'Apertura de inventario', ocurridoEn: now, registradoPor: SEED_USER_ID, createdAt: now },
    { id: newId(), tenantId: TENANT_ID, tipo: 'Entrada', productId: harina.id, loteId: loteHarinaId,
      locationId: locEstSecoId, cantidad: 200, referenciaTipo: 'Manual', referenciaId: 'seed-initial',
      motivo: 'Apertura de inventario', ocurridoEn: now, registradoPor: SEED_USER_ID, createdAt: now },
  ]});
  console.log('  ✓ Created 3 opening movements');

  console.log('\n🎉 Inventory seed completed!');
  console.log('Warehouse ID:', warehouseId);
  console.log('PB-CAM-FZ:', locCamFzId, '| PB-CAM-RF:', locCamRfId, '| PB-EST-SECO:', locEstSecoId);
}

main().then(() => (prisma as any).$disconnect()).catch((e: any) => { console.error(e); (prisma as any).$disconnect(); process.exit(1); });
