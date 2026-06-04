import { AuditEntry } from '../audit-entry';

/**
 * AuditLogRepository — port para persistencia y consulta de la cadena
 * de auditoría.
 *
 * Operaciones permitidas:
 *   - append: añadir una nueva entrada al final de la cadena del tenant
 *   - query: leer entradas (con filtros y paginación)
 *   - verify: validar que la cadena de un tenant es consistente
 *
 * NO HAY update ni delete — la auditoría es inmutable por contrato.
 * El rol `app_user` solo tiene INSERT y SELECT en `audit_logs`
 * (ver prisma/init/01_bootstrap.sql).
 */
export interface AuditLogRepository {
  /**
   * Appends una nueva entrada a la cadena del tenant.
   * El repositorio se encarga de:
   *   1. Tomar un advisory lock sobre el tenant
   *   2. Leer la última entrada (chainIndex + hash)
   *   3. Construir la nueva con esos valores como previousHash
   *   4. INSERT atómico
   *
   * El input es solo el "contenido" — chainIndex, previousHash y hash
   * los calcula el repositorio.
   */
  append(args: AppendAuditInput): Promise<AuditEntry>;

  /** Lee una entrada por ID. */
  findById(tenantId: string, auditLogId: string): Promise<AuditEntry | null>;

  /** Lista entradas con filtros y paginación. */
  query(filter: AuditQueryFilter): Promise<AuditQueryResult>;

  /**
   * Verifica la integridad de la cadena del tenant.
   * Recorre todas las entradas en orden de chainIndex y comprueba que:
   *   - El hash recalculado coincide con el almacenado
   *   - El previousHash de cada entrada coincide con el hash de la anterior
   */
  verifyChain(args: VerifyChainInput): Promise<VerifyChainResult>;
}

export interface AppendAuditInput {
  tenantId: string;
  occurredAt: Date;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: unknown | null;
  newValues: unknown | null;
  correlationId: string | null;
  causationId: string | null;
}

export interface AuditQueryFilter {
  tenantId: string;
  userId?: string;
  action?: string[];
  entityType?: string;
  entityId?: string;
  correlationId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export interface AuditQueryResult {
  items: AuditEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface VerifyChainInput {
  tenantId: string;
  /** Si se especifica, verifica solo desde este chainIndex. */
  fromChainIndex?: bigint;
  /** Si se especifica, verifica solo hasta este chainIndex. */
  toChainIndex?: bigint;
}

export interface VerifyChainResult {
  tenantId: string;
  entriesChecked: number;
  isValid: boolean;
  firstBrokenChainIndex: bigint | null;
  brokenReason: 'hash_mismatch' | 'broken_link' | null;
}

export const AUDIT_LOG_REPOSITORY = Symbol('AuditLogRepository');
