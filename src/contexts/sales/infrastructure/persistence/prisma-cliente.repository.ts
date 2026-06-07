import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import { TENANT_CONTEXT_PORT, TenantContextPort } from '@eliza/shared-kernel/application/ports';
import {
  Cliente,
  ClienteFilter,
  ClienteId,
  ClienteRepository,
  CodigoCliente,
  CondicionesPago,
  DireccionEntrega,
  EstadoCliente,
  Nit,
} from '@eliza/contexts/sales/domain';

@Injectable()
export class PrismaClienteRepository implements ClienteRepository {
  private readonly logger = new Logger(PrismaClienteRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async findById(id: ClienteId): Promise<Cliente | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).cliente.findUnique({ where: { id: id.value } });
      return row ? this.toDomain(row) : null;
    });
  }

  async findByCodigo(codigo: string): Promise<Cliente | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).cliente.findFirst({ where: { codigo } });
      return row ? this.toDomain(row) : null;
    });
  }

  async findByNit(nit: string): Promise<Cliente | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).cliente.findFirst({ where: { nit } });
      return row ? this.toDomain(row) : null;
    });
  }

  async list(filter: ClienteFilter): Promise<Cliente[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await (tx as any).cliente.findMany({
        where: this.buildWhere(filter),
        orderBy: { razonSocial: 'asc' },
        take: filter.limit,
        skip: filter.offset,
      });
      return rows
        .map((r: any) => this.toDomain(r))
        .filter((c: Cliente | null): c is Cliente => c !== null);
    });
  }

  async countBy(filter: ClienteFilter): Promise<number> {
    return this.prisma.withTenant(async (tx) => {
      return (tx as any).cliente.count({ where: this.buildWhere(filter) });
    });
  }

  async save(cliente: Cliente): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const events = cliente.pullDomainEvents();
      const expectedVersion = cliente.version - 1;

      const existing = await (tx as any).cliente.findUnique({
        where: { id: cliente.id.value },
        select: { id: true },
      });

      if (!existing) {
        await (tx as any).cliente.create({
          data: {
            id: cliente.id.value,
            tenantId: cliente.tenantId,
            codigo: cliente.codigo,
            nit: cliente.nit,
            razonSocial: cliente.razonSocial,
            nombreComercial: cliente.nombreComercial,
            estado: cliente.estado,
            condicionesPago: cliente.condicionesPago,
            direccionFiscal: cliente.direccionFiscal.toJson() as Prisma.InputJsonValue,
            direccionEntrega: cliente.direccionEntrega
              ? (cliente.direccionEntrega.toJson() as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            contactoNombre: cliente.contactoNombre,
            contactoTelefono: cliente.contactoTelefono,
            contactoEmail: cliente.contactoEmail,
            notas: cliente.notas,
            version: cliente.version,
            createdAt: cliente.createdAt,
            updatedAt: cliente.updatedAt,
          },
        });
      } else {
        const result = await (tx as any).cliente.updateMany({
          where: { id: cliente.id.value, version: expectedVersion },
          data: {
            razonSocial: cliente.razonSocial,
            nombreComercial: cliente.nombreComercial,
            estado: cliente.estado,
            condicionesPago: cliente.condicionesPago,
            direccionFiscal: cliente.direccionFiscal.toJson() as Prisma.InputJsonValue,
            direccionEntrega: cliente.direccionEntrega
              ? (cliente.direccionEntrega.toJson() as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            contactoNombre: cliente.contactoNombre,
            contactoTelefono: cliente.contactoTelefono,
            contactoEmail: cliente.contactoEmail,
            notas: cliente.notas,
            version: cliente.version,
            updatedAt: cliente.updatedAt,
          },
        });
        if (result.count === 0) {
          throw new Error(`OptimisticConcurrencyConflict: Cliente ${cliente.id.value}`);
        }
      }

      if (events.length > 0) {
        await tx.outboxEvent.createMany({
          data: events.map((e) => ({
            id: ulid(),
            tenantId: e.metadata.tenantId,
            aggregateType: e.metadata.aggregateType,
            aggregateId: e.metadata.aggregateId,
            eventType: e.metadata.eventType,
            eventVersion: e.metadata.eventVersion,
            payload: e.payload() as Prisma.InputJsonValue,
            metadata: {
              eventId: e.metadata.eventId,
              occurredAt: e.metadata.occurredAt.toISOString(),
              correlationId: this.ctx.getCorrelationId(),
              userId: this.ctx.tryGetUserId(),
            } as Prisma.InputJsonValue,
            occurredAt: e.metadata.occurredAt,
          })),
        });
      }
    });
  }

  // ---------- Helpers ----------

  private buildWhere(filter: ClienteFilter): any {
    const where: any = {};
    if (filter.estado) where.estado = filter.estado;
    if (filter.search) {
      where.OR = [
        { razonSocial: { contains: filter.search, mode: 'insensitive' } },
        { nit: { contains: filter.search } },
        { nombreComercial: { contains: filter.search, mode: 'insensitive' } },
        { codigo: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private toDomain(row: any): Cliente | null {
    const codigoR = CodigoCliente.create(row.codigo);
    if (codigoR.isErr) {
      this.logger.error(`Invalid codigo in DB: ${row.codigo}`);
      return null;
    }

    const nitR = Nit.create(row.nit);
    if (nitR.isErr) {
      this.logger.error(`Invalid NIT in DB: ${row.nit}`);
      return null;
    }

    const dirFiscal = DireccionEntrega.fromJson(row.direccionFiscal);
    const dirEntrega = row.direccionEntrega && row.direccionEntrega !== null
      ? DireccionEntrega.fromJson(row.direccionEntrega)
      : null;

    return Cliente.reconstitute({
      id: ClienteId.fromString(row.id),
      tenantId: row.tenantId,
      codigo: codigoR.value,
      nit: nitR.value,
      razonSocial: row.razonSocial,
      nombreComercial: row.nombreComercial,
      estado: row.estado as EstadoCliente,
      condicionesPago: row.condicionesPago as CondicionesPago,
      direccionFiscal: dirFiscal,
      direccionEntrega: dirEntrega,
      contactoNombre: row.contactoNombre,
      contactoTelefono: row.contactoTelefono,
      contactoEmail: row.contactoEmail,
      notas: row.notas,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}