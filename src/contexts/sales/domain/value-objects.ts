import {
  DomainError,
  Guard,
  Identifier,
  Result,
  ValueObject,
  err,
  newTimeOrderedUuid,
  ok,
} from '@eliza/shared-kernel/domain';

// =====================================================================
// Identifiers
// =====================================================================

export class ClienteId extends Identifier<'Cliente'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): ClienteId { return new ClienteId(v); }
  static generate(): ClienteId { return new ClienteId(newTimeOrderedUuid()); }
}

export class OrdenVentaId extends Identifier<'OrdenVenta'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): OrdenVentaId { return new OrdenVentaId(v); }
  static generate(): OrdenVentaId { return new OrdenVentaId(newTimeOrderedUuid()); }
}

export class LineaPedidoId extends Identifier<'LineaPedido'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): LineaPedidoId { return new LineaPedidoId(v); }
  static generate(): LineaPedidoId { return new LineaPedidoId(newTimeOrderedUuid()); }
}

// =====================================================================
// Enums
// =====================================================================

export enum EstadoCliente {
  Activo = 'Activo',
  Inactivo = 'Inactivo',
  Suspendido = 'Suspendido',
}

/**
 * EstadoOrdenVenta — máquina de estados del pedido.
 *
 *   Borrador    → creada, se pueden agregar/quitar líneas
 *   Confirmada  → líneas cerradas, se dispara reserva FEFO
 *   Reservada   → stock reservado exitosamente en Inventory
 *   Despachada  → stock despachado, sale del inventario
 *   Cerrada     → archivada (terminal)
 *   Cancelada   → abortada, reservas liberadas (terminal)
 */
export enum EstadoOrdenVenta {
  Borrador = 'Borrador',
  Confirmada = 'Confirmada',
  Reservada = 'Reservada',
  Despachada = 'Despachada',
  Cerrada = 'Cerrada',
  Cancelada = 'Cancelada',
}

export enum CondicionesPago {
  Contado = 'Contado',
  Credito15 = 'Credito15',
  Credito30 = 'Credito30',
  Credito60 = 'Credito60',
  Credito90 = 'Credito90',
}

// =====================================================================
// Value Objects
// =====================================================================

interface CodigoClienteProps { value: string; }

/**
 * CodigoCliente — identificador legible del cliente.
 * Ej: "CLI-001", "CLI-DISTRIBUIDORA-BGA".
 */
export class CodigoCliente extends ValueObject<CodigoClienteProps> {
  private static readonly PATTERN = /^CLI-[A-Z0-9][A-Z0-9-]{0,46}$/;
  private constructor(p: CodigoClienteProps) { super(p); }
  get value(): string { return this.props.value; }

  static create(raw: string): Result<CodigoCliente, DomainError> {
    const v = Guard.combine(
      Guard.againstEmptyString(raw, 'codigoCliente'),
      Guard.againstLengthOutOfBounds(raw, 'codigoCliente', 5, 50),
      Guard.againstInvalidPattern(raw, 'codigoCliente', CodigoCliente.PATTERN,
        'must start with CLI- followed by uppercase alphanumeric/hyphens'),
    );
    if (v.isErr) return err(v.error);
    return ok(new CodigoCliente({ value: raw }));
  }
}

interface NitProps { value: string; }

/**
 * Nit — Número de Identificación Tributaria colombiano.
 * Formato aceptado: "900123456-7" o "900.123.456-7" (se normaliza sin puntos).
 * El dígito de verificación (después del guion) es opcional.
 */
export class Nit extends ValueObject<NitProps> {
  private static readonly PATTERN = /^\d{6,12}(-\d)?$/;
  private constructor(p: NitProps) { super(p); }
  get value(): string { return this.props.value; }

  static create(raw: string): Result<Nit, DomainError> {
    // Normalizar: quitar puntos y espacios
    const normalized = raw.replace(/[.\s]/g, '').trim();
    if (!normalized || normalized.length < 6) {
      return err({ code: 'nit.invalid', message: 'NIT must have at least 6 digits' });
    }
    if (!Nit.PATTERN.test(normalized)) {
      return err({ code: 'nit.invalid_format',
        message: 'NIT format: 6-12 digits optionally followed by -DV (e.g. 900123456-7)' });
    }
    return ok(new Nit({ value: normalized }));
  }
}

interface CodigoPedidoProps { value: string; }

/**
 * CodigoPedido — código legible del pedido de venta.
 * Ej: "PV-2026-06-001", "PV-CLI001-001".
 */
export class CodigoPedido extends ValueObject<CodigoPedidoProps> {
  private static readonly PATTERN = /^PV-[A-Z0-9][A-Z0-9-]{1,46}$/;
  private constructor(p: CodigoPedidoProps) { super(p); }
  get value(): string { return this.props.value; }

  static create(raw: string): Result<CodigoPedido, DomainError> {
    const v = Guard.combine(
      Guard.againstEmptyString(raw, 'codigoPedido'),
      Guard.againstLengthOutOfBounds(raw, 'codigoPedido', 4, 50),
      Guard.againstInvalidPattern(raw, 'codigoPedido', CodigoPedido.PATTERN,
        'must start with PV- followed by uppercase alphanumeric/hyphens'),
    );
    if (v.isErr) return err(v.error);
    return ok(new CodigoPedido({ value: raw }));
  }
}

interface PrecioUnitarioProps { amount: number; }

/**
 * PrecioUnitario — precio en COP (pesos colombianos).
 * Siempre positivo, hasta 2 decimales.
 */
export class PrecioUnitario extends ValueObject<PrecioUnitarioProps> {
  private constructor(p: PrecioUnitarioProps) { super(p); }
  get amount(): number { return this.props.amount; }

  static create(raw: number): Result<PrecioUnitario, DomainError> {
    if (!Number.isFinite(raw) || raw <= 0) {
      return err({ code: 'precio.must_be_positive',
        message: 'Unit price must be a positive finite number' });
    }
    const rounded = Math.round(raw * 100) / 100;
    return ok(new PrecioUnitario({ amount: rounded }));
  }
}

interface DireccionEntregaProps {
  direccion: string;
  ciudad: string;
  departamento: string;
  telefono: string | null;
  notas: string | null;
}

/**
 * DireccionEntrega — dirección de despacho del pedido.
 * Puede ser diferente a la dirección fiscal del cliente.
 */
export class DireccionEntrega extends ValueObject<DireccionEntregaProps> {
  private constructor(p: DireccionEntregaProps) { super(p); }
  get direccion(): string { return this.props.direccion; }
  get ciudad(): string { return this.props.ciudad; }
  get departamento(): string { return this.props.departamento; }
  get telefono(): string | null { return this.props.telefono; }
  get notas(): string | null { return this.props.notas; }

  static create(args: {
    direccion: string;
    ciudad: string;
    departamento: string;
    telefono?: string;
    notas?: string;
  }): Result<DireccionEntrega, DomainError> {
    if (!args.direccion || args.direccion.trim().length < 5) {
      return err({ code: 'direccion.invalid', message: 'Address must be at least 5 characters' });
    }
    if (!args.ciudad || args.ciudad.trim().length < 2) {
      return err({ code: 'direccion.ciudad_invalid', message: 'City must be at least 2 characters' });
    }
    if (!args.departamento || args.departamento.trim().length < 2) {
      return err({ code: 'direccion.departamento_invalid', message: 'Departamento must be at least 2 characters' });
    }
    return ok(new DireccionEntrega({
      direccion: args.direccion.trim(),
      ciudad: args.ciudad.trim(),
      departamento: args.departamento.trim(),
      telefono: args.telefono?.trim() || null,
      notas: args.notas?.trim() || null,
    }));
  }

  toJson(): Record<string, unknown> {
    return {
      direccion: this.props.direccion,
      ciudad: this.props.ciudad,
      departamento: this.props.departamento,
      telefono: this.props.telefono,
      notas: this.props.notas,
    };
  }

  static fromJson(data: any): DireccionEntrega {
    return new DireccionEntrega({
      direccion: data.direccion,
      ciudad: data.ciudad,
      departamento: data.departamento,
      telefono: data.telefono ?? null,
      notas: data.notas ?? null,
    });
  }
}