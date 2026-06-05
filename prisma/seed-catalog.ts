/**
 * Seed específico del Catalog (Sprint 5).
 *
 * Crea:
 *   - 15 unidades de medida cross-tenant (kg, g, ml, L, piece, pack, etc.)
 *   - Árbol de categorías para BCM Congelados
 *   - Productos reales: arepas Mini 12u, Tradicional 6u; flautas Paquete 5u
 *   - Materias primas: harina, queso, mantequilla
 *   - BOMs de los productos terminados
 *
 * Para correr este seed específico:
 *   pnpm ts-node prisma/seed-catalog.ts
 *
 * Asume que prisma/seed.ts ya corrió y existe el tenant bcm-congelados.
 */

import { PrismaClient, ProductStatus, ProductType, UomDimension } from '@prisma/client';
import { ulid } from 'ulid';

const prisma = new PrismaClient();

const TENANT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const PLATFORM_ADMIN_ID = '00000000-0000-0000-0000-000000000001';

function ulidToUuid(s: string): string {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = new Uint8Array(16);
  let bits = 0, value = 0, idx = 0;
  for (const c of s.toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[idx++] = (value >> bits) & 0xff;
      if (idx === 16) break;
    }
  }
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}
const uid = () => ulidToUuid(ulid());

async function main() {
  const now = new Date();
  console.log('🌱 Seeding Catalog (Sprint 5)...\n');

  // -------- Unidades de medida --------
  const UOMS = [
    { code: 'g',     name: 'Gramo',        symbol: 'g',     dimension: UomDimension.Mass,    toBaseFactor: 1 },
    { code: 'kg',    name: 'Kilogramo',    symbol: 'kg',    dimension: UomDimension.Mass,    toBaseFactor: 1000 },
    { code: 'mg',    name: 'Miligramo',    symbol: 'mg',    dimension: UomDimension.Mass,    toBaseFactor: 0.001 },
    { code: 'ml',    name: 'Mililitro',    symbol: 'ml',    dimension: UomDimension.Volume,  toBaseFactor: 1 },
    { code: 'L',     name: 'Litro',        symbol: 'L',     dimension: UomDimension.Volume,  toBaseFactor: 1000 },
    { code: 'piece', name: 'Unidad',       symbol: 'u',     dimension: UomDimension.Count,   toBaseFactor: 1 },
    { code: 'pack',  name: 'Paquete',      symbol: 'pkt',   dimension: UomDimension.Count,   toBaseFactor: 1 },
    { code: 'box',   name: 'Caja',         symbol: 'box',   dimension: UomDimension.Count,   toBaseFactor: 1 },
    { code: 'cm',    name: 'Centímetro',   symbol: 'cm',    dimension: UomDimension.Length,  toBaseFactor: 0.01 },
    { code: 'm',     name: 'Metro',        symbol: 'm',     dimension: UomDimension.Length,  toBaseFactor: 1 },
    { code: 'hour',  name: 'Hora',         symbol: 'h',     dimension: UomDimension.Time,    toBaseFactor: 3600 },
    { code: 'min',   name: 'Minuto',       symbol: 'min',   dimension: UomDimension.Time,    toBaseFactor: 60 },
    { code: 'sec',   name: 'Segundo',      symbol: 's',     dimension: UomDimension.Time,    toBaseFactor: 1 },
    { code: 'C',     name: 'Celsius',      symbol: '°C',    dimension: UomDimension.Temperature, toBaseFactor: 1 },
  ];

  const uomIdByCode = new Map<string, string>();
  for (const u of UOMS) {
    const result = await prisma.unitOfMeasure.upsert({
      where: { code: u.code },
      create: { id: uid(), ...u, isActive: true, createdAt: now, updatedAt: now },
      update: {},
    });
    uomIdByCode.set(u.code, result.id);
  }
  console.log(`✅ ${UOMS.length} unidades de medida`);

  // -------- Categorías (árbol) --------
  const cat = {
    congelados: uid(),
    arepas:     uid(),
    arepasMini: uid(),
    arepasTrad: uid(),
    flautas:    uid(),
    materiasPrimas: uid(),
    lacteos:    uid(),
    harinas:    uid(),
  };

  await prisma.category.createMany({
    data: [
      { id: cat.congelados, tenantId: TENANT_ID, code: 'congelados',
        name: 'Congelados', path: '/congelados', parentId: null, isActive: true,
        createdAt: now, updatedAt: now, version: 1 },
      { id: cat.arepas, tenantId: TENANT_ID, code: 'arepas',
        name: 'Arepas', path: '/congelados/arepas', parentId: cat.congelados, isActive: true,
        createdAt: now, updatedAt: now, version: 1 },
      { id: cat.arepasMini, tenantId: TENANT_ID, code: 'arepas-mini',
        name: 'Arepas Mini', path: '/congelados/arepas/arepas-mini', parentId: cat.arepas, isActive: true,
        createdAt: now, updatedAt: now, version: 1 },
      { id: cat.arepasTrad, tenantId: TENANT_ID, code: 'arepas-tradicional',
        name: 'Arepas Tradicional', path: '/congelados/arepas/arepas-tradicional', parentId: cat.arepas, isActive: true,
        createdAt: now, updatedAt: now, version: 1 },
      { id: cat.flautas, tenantId: TENANT_ID, code: 'flautas',
        name: 'Flautas Santandereanas', path: '/congelados/flautas', parentId: cat.congelados, isActive: true,
        createdAt: now, updatedAt: now, version: 1 },
      { id: cat.materiasPrimas, tenantId: TENANT_ID, code: 'materias-primas',
        name: 'Materias Primas', path: '/materias-primas', parentId: null, isActive: true,
        createdAt: now, updatedAt: now, version: 1 },
      { id: cat.lacteos, tenantId: TENANT_ID, code: 'lacteos',
        name: 'Lácteos', path: '/materias-primas/lacteos', parentId: cat.materiasPrimas, isActive: true,
        createdAt: now, updatedAt: now, version: 1 },
      { id: cat.harinas, tenantId: TENANT_ID, code: 'harinas',
        name: 'Harinas y cereales', path: '/materias-primas/harinas', parentId: cat.materiasPrimas, isActive: true,
        createdAt: now, updatedAt: now, version: 1 },
    ],
    skipDuplicates: true,
  });
  console.log('✅ 8 categorías');

  // -------- Materias primas --------
  const rmIds = {
    queso:       uid(),
    harinaMaiz:  uid(),
    mantequilla: uid(),
    sal:         uid(),
    agua:        uid(),
  };

  await prisma.product.createMany({
    data: [
      { id: rmIds.queso, tenantId: TENANT_ID, code: 'RM-QUESO-FRESCO', sku: 'RM-QUESO-FRESCO',
        name: 'Queso Fresco Costeño', type: ProductType.RawMaterial, status: ProductStatus.Active,
        categoryId: cat.lacteos, unitOfSaleId: uomIdByCode.get('kg')!,
        netWeightGrams: 1000, expiryDays: 30, storageTempMinC: 2, storageTempMaxC: 4,
        isControlled: true, createdAt: now, updatedAt: now, version: 1 },
      { id: rmIds.harinaMaiz, tenantId: TENANT_ID, code: 'RM-HARINA-MAIZ', sku: 'RM-HARINA-MAIZ',
        name: 'Harina de Maíz Precocida', type: ProductType.RawMaterial, status: ProductStatus.Active,
        categoryId: cat.harinas, unitOfSaleId: uomIdByCode.get('kg')!,
        netWeightGrams: 1000, expiryDays: 365, isControlled: false,
        createdAt: now, updatedAt: now, version: 1 },
      { id: rmIds.mantequilla, tenantId: TENANT_ID, code: 'RM-MANTEQUILLA', sku: 'RM-MANTEQUILLA',
        name: 'Mantequilla sin sal', type: ProductType.RawMaterial, status: ProductStatus.Active,
        categoryId: cat.lacteos, unitOfSaleId: uomIdByCode.get('kg')!,
        netWeightGrams: 1000, expiryDays: 90, storageTempMinC: 2, storageTempMaxC: 6,
        isControlled: true, createdAt: now, updatedAt: now, version: 1 },
      { id: rmIds.sal, tenantId: TENANT_ID, code: 'RM-SAL', sku: 'RM-SAL',
        name: 'Sal refinada', type: ProductType.RawMaterial, status: ProductStatus.Active,
        categoryId: cat.harinas, unitOfSaleId: uomIdByCode.get('kg')!,
        expiryDays: 1825, isControlled: false,
        createdAt: now, updatedAt: now, version: 1 },
      { id: rmIds.agua, tenantId: TENANT_ID, code: 'RM-AGUA', sku: 'RM-AGUA',
        name: 'Agua potable', type: ProductType.RawMaterial, status: ProductStatus.Active,
        categoryId: cat.harinas, unitOfSaleId: uomIdByCode.get('L')!,
        isControlled: false, createdAt: now, updatedAt: now, version: 1 },
    ],
    skipDuplicates: true,
  });
  console.log('✅ 5 materias primas');

  // -------- Productos terminados --------
  const fgIds = {
    arepaMini12: uid(),
    arepaTrad6:  uid(),
    flauta5:     uid(),
  };

  await prisma.product.createMany({
    data: [
      { id: fgIds.arepaMini12, tenantId: TENANT_ID, code: 'ARP-MINI-12U', sku: 'ARP-MINI-12U',
        barcode: '7702345001234',
        name: 'Arepa de Queso Mini x12 unidades', type: ProductType.FinishedGood, status: ProductStatus.Active,
        categoryId: cat.arepasMini, unitOfSaleId: uomIdByCode.get('pack')!,
        packSize: 12, netWeightGrams: 360, grossWeightGrams: 400,
        expiryDays: 180, storageTempMinC: -18, storageTempMaxC: -15,
        taxRate: 19, isControlled: true,
        description: 'Arepas pequeñas con queso costeño, ideales para snack',
        createdAt: now, updatedAt: now, version: 1 },
      { id: fgIds.arepaTrad6, tenantId: TENANT_ID, code: 'ARP-TRAD-6U', sku: 'ARP-TRAD-6U',
        barcode: '7702345001241',
        name: 'Arepa de Queso Tradicional x6 unidades', type: ProductType.FinishedGood, status: ProductStatus.Active,
        categoryId: cat.arepasTrad, unitOfSaleId: uomIdByCode.get('pack')!,
        packSize: 6, netWeightGrams: 540, grossWeightGrams: 580,
        expiryDays: 180, storageTempMinC: -18, storageTempMaxC: -15,
        taxRate: 19, isControlled: true,
        description: 'Arepas tamaño tradicional, rellenas de queso costeño',
        createdAt: now, updatedAt: now, version: 1 },
      { id: fgIds.flauta5, tenantId: TENANT_ID, code: 'FLT-SAN-5U', sku: 'FLT-SAN-5U',
        barcode: '7702345002033',
        name: 'Flauta Santandereana Paquete x5 unidades', type: ProductType.FinishedGood, status: ProductStatus.Active,
        categoryId: cat.flautas, unitOfSaleId: uomIdByCode.get('pack')!,
        packSize: 5, netWeightGrams: 425, grossWeightGrams: 460,
        expiryDays: 120, storageTempMinC: -18, storageTempMaxC: -15,
        taxRate: 19, isControlled: true,
        description: 'Flautas tradicionales de Santander, rellenas de queso',
        createdAt: now, updatedAt: now, version: 1 },
    ],
    skipDuplicates: true,
  });
  console.log('✅ 3 productos terminados');

  // -------- BOMs --------
  // Arepa Mini 12u: harina, queso, sal, agua (proporción por paquete)
  await prisma.bOMComponent.createMany({
    data: [
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.arepaMini12,
        componentId: rmIds.harinaMaiz, quantity: 180, uomId: uomIdByCode.get('g')!, position: 1,
        notes: 'Base de la masa', createdAt: now },
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.arepaMini12,
        componentId: rmIds.queso, quantity: 120, uomId: uomIdByCode.get('g')!, position: 2,
        notes: 'Relleno', createdAt: now },
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.arepaMini12,
        componentId: rmIds.sal, quantity: 3, uomId: uomIdByCode.get('g')!, position: 3,
        createdAt: now },
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.arepaMini12,
        componentId: rmIds.agua, quantity: 200, uomId: uomIdByCode.get('ml')!, position: 4,
        createdAt: now },
      // Tradicional 6u — mismas materias, otras proporciones
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.arepaTrad6,
        componentId: rmIds.harinaMaiz, quantity: 270, uomId: uomIdByCode.get('g')!, position: 1, createdAt: now },
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.arepaTrad6,
        componentId: rmIds.queso, quantity: 180, uomId: uomIdByCode.get('g')!, position: 2, createdAt: now },
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.arepaTrad6,
        componentId: rmIds.sal, quantity: 5, uomId: uomIdByCode.get('g')!, position: 3, createdAt: now },
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.arepaTrad6,
        componentId: rmIds.agua, quantity: 300, uomId: uomIdByCode.get('ml')!, position: 4, createdAt: now },
      // Flauta 5u — añade mantequilla
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.flauta5,
        componentId: rmIds.harinaMaiz, quantity: 200, uomId: uomIdByCode.get('g')!, position: 1, createdAt: now },
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.flauta5,
        componentId: rmIds.queso, quantity: 150, uomId: uomIdByCode.get('g')!, position: 2, createdAt: now },
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.flauta5,
        componentId: rmIds.mantequilla, quantity: 50, uomId: uomIdByCode.get('g')!, position: 3, createdAt: now },
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.flauta5,
        componentId: rmIds.sal, quantity: 4, uomId: uomIdByCode.get('g')!, position: 4, createdAt: now },
      { id: uid(), tenantId: TENANT_ID, productId: fgIds.flauta5,
        componentId: rmIds.agua, quantity: 220, uomId: uomIdByCode.get('ml')!, position: 5, createdAt: now },
    ],
    skipDuplicates: true,
  });
  console.log('✅ 13 componentes BOM');

  console.log('\n🎉 Catalog seed completo:');
  console.log(`   Tenant:    ${TENANT_ID}`);
  console.log(`   UoMs:      14 (platform-wide)`);
  console.log(`   Categories: 8 (2 raíces + 6 hijas)`);
  console.log(`   Products:  8 (5 raw materials + 3 finished goods)`);
  console.log(`   BOMs:      3 productos con un total de 13 componentes`);
}

main()
  .catch((e) => {
    console.error('Seed-catalog failed:', e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
