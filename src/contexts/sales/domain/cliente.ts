import {
  AggregateRoot,
  DomainError,
  Result,
  err,
  ok,
} from '@eliza/shared-kernel/domain';

import {
  CustomerCreated,
  CustomerUpdated,
} from './sales-events';
import {
  ClienteId,
  CodigoCliente,
  CondicionesPago,
  DireccionEntrega,
  EstadoCliente,
  Nit,
} from './value-objects';

// =====================================================================
// Cliente — Aggregate Root
// =====================================================================

interface ClienteProps {
  tenantId: string;
  codigo: CodigoCliente;
  nit: Nit;
  razonSocial: string;
  nombreComercial: string | null;
  estado: EstadoCliente;
  condicionesPago: CondicionesPago;
  direccionFiscal: DireccionEntrega;
  direccionEntrega: DireccionEntrega | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  contactoEmail: string | null;
  notas: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Cliente — Aggregate Root.
 *
 * Representa un cliente comercial de la empresa de congelados.
 * Puede ser una distribuidora, un punto de venta, un supermercado, etc.
 *
 * Invariantes:
 *   1. codigo es único por tenant (lo valida el use case).
 *   2. nit es único por tenant (lo valida el use case).
 *   3. razonSocial no puede estar vacía.
 *   4. Un cliente Suspendido no puede recibir nuevos pedidos
 *      (lo valida OrdenDeVenta al crearse).
 *   5. direccionFiscal es obligatoria; direccionEntrega es opcional
 *      (si no se define, los pedidos usan la fiscal).
 */
export class Cliente extends AggregateRoot<ClienteId, ClienteProps> {
  private constructor(id: ClienteId, props: ClienteProps, version: number) {
    super(id, props, version);
  }

  // ---------- Getters ----------
  get tenantId(): string { return this.props.tenantId; }
  get codigo(): string { return this.props.codigo.value; }
  get nit(): string { return this.props.nit.value; }
  get razonSocial(): string { return this.props.razonSocial; }
  get nombreComercial(): string | null { return this.props.nombreComercial; }
  get estado(): EstadoCliente { return this.props.estado; }
  get condicionesPago(): CondicionesPago { return this.props.condicionesPago; }
  get direccionFiscal(): DireccionEntrega { return this.props.direccionFiscal; }
  get direccionEntrega(): DireccionEntrega | null { return this.props.direccionEntrega; }
  get contactoNombre(): string | null { return this.props.contactoNombre; }
  get contactoTelefono(): string | null { return this.props.contactoTelefono; }
  get contactoEmail(): string | null { return this.props.contactoEmail; }
  get notas(): string | null { return this.props.notas; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  /** Dirección efectiva para despachos: la de entrega si existe, si no la fiscal. */
  get direccionDespacho(): DireccionEntrega {
    return this.props.direccionEntrega ?? this.props.direccionFiscal;
  }

  /** ¿Puede recibir nuevos pedidos? */
  puedeRecibirPedidos(): boolean {
    return this.props.estado === EstadoCliente.Activo;
  }

  // ---------- Factory ----------

  static create(args: {
    tenantId: string;
    codigo: string;
    nit: string;
    razonSocial: string;
    nombreComercial?: string;
    condicionesPago?: CondicionesPago;
    direccionFiscal: {
      direccion: string;
      ciudad: string;
      departamento: string;
      telefono?: string;
      notas?: string;
    };
    direccionEntrega?: {
      direccion: string;
      ciudad: string;
      departamento: string;
      telefono?: string;
      notas?: string;
    };
    contactoNombre?: string;
    contactoTelefono?: string;
    contactoEmail?: string;
    notas?: string;
    now: Date;
  }): Result<Cliente, DomainError> {
    const codigoR = CodigoCliente.create(args.codigo);
    if (codigoR.isErr) return err(codigoR.error);

    const nitR = Nit.create(args.nit);
    if (nitR.isErr) return err(nitR.error);

    if (!args.razonSocial || args.razonSocial.trim().length < 3) {
      return err({ code: 'cliente.razon_social_invalid',
        message: 'Razón social must be at least 3 characters' });
    }

    const dirFiscalR = DireccionEntrega.create(args.direccionFiscal);
    if (dirFiscalR.isErr) return err(dirFiscalR.error);

    let dirEntrega: DireccionEntrega | null = null;
    if (args.direccionEntrega) {
      const dirEntregaR = DireccionEntrega.create(args.direccionEntrega);
      if (dirEntregaR.isErr) return err(dirEntregaR.error);
      dirEntrega = dirEntregaR.value;
    }

    if (args.contactoEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.contactoEmail)) {
      return err({ code: 'cliente.email_invalid', message: 'Invalid contact email format' });
    }

    const id = ClienteId.generate();
    const cliente = new Cliente(id, {
      tenantId: args.tenantId,
      codigo: codigoR.value,
      nit: nitR.value,
      razonSocial: args.razonSocial.trim(),
      nombreComercial: args.nombreComercial?.trim() || null,
      estado: EstadoCliente.Activo,
      condicionesPago: args.condicionesPago ?? CondicionesPago.Contado,
      direccionFiscal: dirFiscalR.value,
      direccionEntrega: dirEntrega,
      contactoNombre: args.contactoNombre?.trim() || null,
      contactoTelefono: args.contactoTelefono?.trim() || null,
      contactoEmail: args.contactoEmail?.trim() || null,
      notas: args.notas?.trim() || null,
      createdAt: args.now,
      updatedAt: args.now,
    }, 1);

    cliente.addDomainEvent(new CustomerCreated({
      clienteId: id.value,
      tenantId: args.tenantId,
      codigo: codigoR.value.value,
      nit: nitR.value.value,
      razonSocial: args.razonSocial.trim(),
    }));

    return ok(cliente);
  }

  // ---------- Mutations ----------

  update(args: {
    razonSocial?: string;
    nombreComercial?: string;
    condicionesPago?: CondicionesPago;
    direccionFiscal?: {
      direccion: string;
      ciudad: string;
      departamento: string;
      telefono?: string;
      notas?: string;
    };
    direccionEntrega?: {
      direccion: string;
      ciudad: string;
      departamento: string;
      telefono?: string;
      notas?: string;
    } | null;
    contactoNombre?: string;
    contactoTelefono?: string;
    contactoEmail?: string;
    notas?: string;
    now: Date;
  }): Result<void, DomainError> {
    const cambios: string[] = [];

    let razonSocial = this.props.razonSocial;
    if (args.razonSocial !== undefined) {
      if (args.razonSocial.trim().length < 3) {
        return err({ code: 'cliente.razon_social_invalid',
          message: 'Razón social must be at least 3 characters' });
      }
      razonSocial = args.razonSocial.trim();
      cambios.push('razonSocial');
    }

    let direccionFiscal = this.props.direccionFiscal;
    if (args.direccionFiscal) {
      const dirR = DireccionEntrega.create(args.direccionFiscal);
      if (dirR.isErr) return err(dirR.error);
      direccionFiscal = dirR.value;
      cambios.push('direccionFiscal');
    }

    let direccionEntrega = this.props.direccionEntrega;
    if (args.direccionEntrega !== undefined) {
      if (args.direccionEntrega === null) {
        direccionEntrega = null;
        cambios.push('direccionEntrega:removed');
      } else {
        const dirR = DireccionEntrega.create(args.direccionEntrega);
        if (dirR.isErr) return err(dirR.error);
        direccionEntrega = dirR.value;
        cambios.push('direccionEntrega');
      }
    }

    if (args.contactoEmail !== undefined && args.contactoEmail &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.contactoEmail)) {
      return err({ code: 'cliente.email_invalid', message: 'Invalid contact email format' });
    }

    if (args.condicionesPago !== undefined) cambios.push('condicionesPago');
    if (args.nombreComercial !== undefined) cambios.push('nombreComercial');
    if (args.contactoNombre !== undefined) cambios.push('contactoNombre');
    if (args.contactoTelefono !== undefined) cambios.push('contactoTelefono');
    if (args.contactoEmail !== undefined) cambios.push('contactoEmail');
    if (args.notas !== undefined) cambios.push('notas');

    if (cambios.length === 0) return ok(undefined);

    this.props = {
      ...this.props,
      razonSocial,
      nombreComercial: args.nombreComercial !== undefined
        ? (args.nombreComercial?.trim() || null) : this.props.nombreComercial,
      condicionesPago: args.condicionesPago ?? this.props.condicionesPago,
      direccionFiscal,
      direccionEntrega,
      contactoNombre: args.contactoNombre !== undefined
        ? (args.contactoNombre?.trim() || null) : this.props.contactoNombre,
      contactoTelefono: args.contactoTelefono !== undefined
        ? (args.contactoTelefono?.trim() || null) : this.props.contactoTelefono,
      contactoEmail: args.contactoEmail !== undefined
        ? (args.contactoEmail?.trim() || null) : this.props.contactoEmail,
      notas: args.notas !== undefined
        ? (args.notas?.trim() || null) : this.props.notas,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new CustomerUpdated({
      clienteId: this._id.value,
      tenantId: this.props.tenantId,
      codigo: this.props.codigo.value,
      cambios,
    }));

    return ok(undefined);
  }

  /** Suspende al cliente. No puede recibir nuevos pedidos. */
  suspend(now: Date): Result<void, DomainError> {
    if (this.props.estado === EstadoCliente.Suspendido) {
      return err({ code: 'cliente.already_suspended', message: 'Customer is already suspended' });
    }
    this.props = { ...this.props, estado: EstadoCliente.Suspendido, updatedAt: now };
    this.incrementVersion();
    return ok(undefined);
  }

  /** Reactiva un cliente suspendido o inactivo. */
  activate(now: Date): Result<void, DomainError> {
    if (this.props.estado === EstadoCliente.Activo) {
      return err({ code: 'cliente.already_active', message: 'Customer is already active' });
    }
    this.props = { ...this.props, estado: EstadoCliente.Activo, updatedAt: now };
    this.incrementVersion();
    return ok(undefined);
  }

  // ---------- Reconstitution ----------

  static reconstitute(args: {
    id: ClienteId;
    tenantId: string;
    codigo: CodigoCliente;
    nit: Nit;
    razonSocial: string;
    nombreComercial: string | null;
    estado: EstadoCliente;
    condicionesPago: CondicionesPago;
    direccionFiscal: DireccionEntrega;
    direccionEntrega: DireccionEntrega | null;
    contactoNombre: string | null;
    contactoTelefono: string | null;
    contactoEmail: string | null;
    notas: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): Cliente {
    return new Cliente(args.id, {
      tenantId: args.tenantId,
      codigo: args.codigo,
      nit: args.nit,
      razonSocial: args.razonSocial,
      nombreComercial: args.nombreComercial,
      estado: args.estado,
      condicionesPago: args.condicionesPago,
      direccionFiscal: args.direccionFiscal,
      direccionEntrega: args.direccionEntrega,
      contactoNombre: args.contactoNombre,
      contactoTelefono: args.contactoTelefono,
      contactoEmail: args.contactoEmail,
      notas: args.notas,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    }, args.version);
  }
}