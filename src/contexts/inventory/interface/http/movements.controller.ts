import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequireRoles } from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';
import { ApplicationError } from '@eliza/shared-kernel/application/use-case';
import { Result } from '@eliza/shared-kernel/domain';
import {
  GetMovementHistoryOutput,
  GetMovementHistoryUseCase,
} from '@eliza/contexts/inventory/application';
import { MovementHistoryQueryDto } from '@eliza/contexts/inventory/interface/http/dto/inventory.dto';

const READER_ROLES = [
  'Platform.Admin', 'Tenant.Admin',
  'Inventory.Manager', 'Inventory.Operator', 'Inventory.Reader',
  'Billing.Manager', 'Audit.Reader',
];

function unwrap<T>(r: Result<T, ApplicationError>): T {
  if (r.isOk) return r.value;
  throw new BadRequestException({ code: r.error.code, message: r.error.message });
}

@ApiTags('Inventory · Movements')
@ApiBearerAuth()
@Controller({ path: 'inventory/movements', version: '1' })
export class MovementsController {
  constructor(private readonly query: GetMovementHistoryUseCase) {}

  @Get()
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Query inventory movement history (kardex)' })
  async list(@Query() q: MovementHistoryQueryDto): Promise<GetMovementHistoryOutput> {
    return unwrap(await this.query.execute(q));
  }
}
