import { createHash } from 'node:crypto';
import { DomainError, Guard, Identifier, Result, ValueObject, err, newTimeOrderedUuid, ok } from '@eliza/shared-kernel/domain';

/**
 * AuditLogId — identifier ordenable temporalmente (UUID v7).
 */
export class AuditLogId extends Identifier<'AuditLog'> {
  private constructor(value: string) {
    super(value);
  }
  static fromString(value: string): AuditLogId {
    return new AuditLogId(value);
  }
  static generate(): AuditLogId {
    // UUID v7: los primeros 48 bits son el timestamp
    return new AuditLogId(newTimeOrderedUuid());
  }
}

/**
 * AuditAction — verbo controlado de la acción auditada.
 *
 * Sirve para clasificar y filtrar entradas. Es un conjunto cerrado:
 * cualquier verbo debe declararse aquí para mantener consistencia
 * cross-context y permitir queries por categoría.
 *
 * Convención: PascalCase, verbos imperativos pasados.
 */
export const AuditActions = {
  // CRUD genérico
  Create: 'Create',
  Read: 'Read',
  Update: 'Update',
  Delete: 'Delete',

  // Lifecycle
  Activate: 'Activate',
  Suspend: 'Suspend',
  Reactivate: 'Reactivate',

  // IAM
  Login: 'Login',
  Logout: 'Logout',
  LoginFailed: 'LoginFailed',
  PasswordReset: 'PasswordReset',
  RoleAssigned: 'RoleAssigned',
  RoleRevoked: 'RoleRevoked',
  MembershipGranted: 'MembershipGranted',
  MembershipRevoked: 'MembershipRevoked',

  // Tenant
  PlanChanged: 'PlanChanged',
  ConfigurationUpdated: 'ConfigurationUpdated',

  // Security
  SecurityViolation: 'SecurityViolation',
  AccessDenied: 'AccessDenied',
  TokenRevoked: 'TokenRevoked',
} as const;

export type AuditActionValue = typeof AuditActions[keyof typeof AuditActions];

interface AuditActionProps {
  value: string;
}
export class AuditAction extends ValueObject<AuditActionProps> {
  private constructor(props: AuditActionProps) {
    super(props);
  }
  get value(): string {
    return this.props.value;
  }
  static create(raw: string): Result<AuditAction, DomainError> {
    const v = Guard.combine(
      Guard.againstEmptyString(raw, 'action'),
      Guard.againstLengthOutOfBounds(raw, 'action', 1, 100),
    );
    if (v.isErr) return err(v.error);
    return ok(new AuditAction({ value: raw }));
  }
}

// =====================================================================
// AuditEntry — immutable aggregate
// =====================================================================
export interface AuditEntryProps {
  id: AuditLogId;
  tenantId: string;
  chainIndex: bigint;
  occurredAt: Date;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  oldValues: unknown | null;
  newValues: unknown | null;
  correlationId: string | null;
  causationId: string | null;
  previousHash: string | null;
  hash: string;
}

/**
 * AuditEntry — registro inmutable de auditoría.
 *
 * NO es un AggregateRoot porque no muta: una vez creado, vive read-only.
 * No tiene métodos de comportamiento; solo el factory `create()` y getters.
 *
 * El hash se calcula sobre los demás campos + previousHash. Cualquier
 * tampering invalida la cadena (detectable vía verifyHashChain).
 */
export class AuditEntry {
  private constructor(private readonly props: AuditEntryProps) {}

  get id(): AuditLogId { return this.props.id; }
  get tenantId(): string { return this.props.tenantId; }
  get chainIndex(): bigint { return this.props.chainIndex; }
  get occurredAt(): Date { return this.props.occurredAt; }
  get userId(): string | null { return this.props.userId; }
  get ipAddress(): string | null { return this.props.ipAddress; }
  get userAgent(): string | null { return this.props.userAgent; }
  get action(): AuditAction { return this.props.action; }
  get entityType(): string { return this.props.entityType; }
  get entityId(): string | null { return this.props.entityId; }
  get oldValues(): unknown | null { return this.props.oldValues; }
  get newValues(): unknown | null { return this.props.newValues; }
  get correlationId(): string | null { return this.props.correlationId; }
  get causationId(): string | null { return this.props.causationId; }
  get previousHash(): string | null { return this.props.previousHash; }
  get hash(): string { return this.props.hash; }

  /**
   * Factory para crear una nueva entrada. Calcula el hash automáticamente
   * a partir del previousHash y el contenido.
   *
   * El chainIndex y previousHash los provee el repositorio dentro de la
   * transacción para garantizar la integridad de la cadena.
   */
  static create(args: {
    tenantId: string;
    chainIndex: bigint;
    previousHash: string | null;
    occurredAt: Date;
    userId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    action: AuditAction;
    entityType: string;
    entityId: string | null;
    oldValues: unknown | null;
    newValues: unknown | null;
    correlationId: string | null;
    causationId: string | null;
  }): AuditEntry {
    const id = AuditLogId.generate();
    const hash = AuditEntry.computeHash({
      id: id.value,
      tenantId: args.tenantId,
      chainIndex: args.chainIndex,
      occurredAt: args.occurredAt,
      userId: args.userId,
      action: args.action.value,
      entityType: args.entityType,
      entityId: args.entityId,
      newValues: args.newValues,
      previousHash: args.previousHash,
    });

    return new AuditEntry({
      id,
      tenantId: args.tenantId,
      chainIndex: args.chainIndex,
      occurredAt: args.occurredAt,
      userId: args.userId,
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      oldValues: args.oldValues,
      newValues: args.newValues,
      correlationId: args.correlationId,
      causationId: args.causationId,
      previousHash: args.previousHash,
      hash,
    });
  }

  static reconstitute(props: AuditEntryProps): AuditEntry {
    return new AuditEntry(props);
  }

  /**
   * Calcula el hash SHA-256 sobre un canonical JSON estable.
   * Cualquier cambio en los campos significativos rompe la cadena.
   *
   * Notar que oldValues NO entra en el hash — un atacante podría haberlo
   * alterado sin que importe para la integridad: lo que MIGRA es el
   * estado nuevo (newValues). Los oldValues son informacionales.
   */
  static computeHash(input: {
    id: string;
    tenantId: string;
    chainIndex: bigint;
    occurredAt: Date;
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    newValues: unknown | null;
    previousHash: string | null;
  }): string {
    const canonical = JSON.stringify([
      input.id,
      input.tenantId,
      input.chainIndex.toString(),
      input.occurredAt.toISOString(),
      input.userId ?? '',
      input.action,
      input.entityType,
      input.entityId ?? '',
      stableStringify(input.newValues),
      input.previousHash ?? '',
    ]);
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /** Verifica que el hash almacenado coincide con el contenido. */
  verifyHash(): boolean {
    const expected = AuditEntry.computeHash({
      id: this.props.id.value,
      tenantId: this.props.tenantId,
      chainIndex: this.props.chainIndex,
      occurredAt: this.props.occurredAt,
      userId: this.props.userId,
      action: this.props.action.value,
      entityType: this.props.entityType,
      entityId: this.props.entityId,
      newValues: this.props.newValues,
      previousHash: this.props.previousHash,
    });
    return expected === this.props.hash;
  }
}

/**
 * stableStringify — JSON.stringify pero con keys ordenadas alfabéticamente
 * para garantizar que dos objetos equivalentes produzcan exactamente la
 * misma string (esencial para hashing determinístico).
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
