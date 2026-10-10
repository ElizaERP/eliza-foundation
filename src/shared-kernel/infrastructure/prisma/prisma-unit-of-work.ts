import { Injectable } from '@nestjs/common';

import { UnitOfWorkPort } from '../../application/ports';
import { PrismaService } from './prisma.service';

/** UNIT_OF_WORK_PORT sobre PostgreSQL: una transacción compartida (ver PrismaService.inTransaction). */
@Injectable()
export class PrismaUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly prisma: PrismaService) {}

  execute<T>(work: () => Promise<T>): Promise<T> {
    return this.prisma.inTransaction(work);
  }
}
