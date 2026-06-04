import { AuditEntry } from '../../domain';

export interface AuditEntryView {
  id: string;
  tenantId: string;
  chainIndex: string; // bigint → string para JSON
  occurredAt: string;
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
  previousHash: string | null;
  hash: string;
}

export function toAuditEntryView(entry: AuditEntry): AuditEntryView {
  return {
    id: entry.id.value,
    tenantId: entry.tenantId,
    chainIndex: entry.chainIndex.toString(),
    occurredAt: entry.occurredAt.toISOString(),
    userId: entry.userId,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
    action: entry.action.value,
    entityType: entry.entityType,
    entityId: entry.entityId,
    oldValues: entry.oldValues,
    newValues: entry.newValues,
    correlationId: entry.correlationId,
    causationId: entry.causationId,
    previousHash: entry.previousHash,
    hash: entry.hash,
  };
}
