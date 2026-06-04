import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { GetMyTenant } from '../../application';
import { TenantResponse } from './dto/tenant.responses';
import { toAppErrorOrThrow } from './result-utils';

/**
 * Endpoint para que cualquier usuario autenticado consulte su PROPIO tenant.
 * No requiere rol especial — solo el JWT con tenant_id válido.
 */
@ApiTags('Tenant · Self')
@ApiBearerAuth()
@Controller({ path: 'tenants', version: '1' })
export class MyTenantController {
  constructor(private readonly getMyTenant: GetMyTenant) {}

  @Get('me')
  @ApiOperation({
    summary: 'Obtener el tenant del usuario autenticado',
    description:
      'Devuelve el tenant correspondiente al claim tenant_id del JWT. ' +
      'No requiere rol Platform.Admin.',
  })
  @ApiOkResponse({ type: TenantResponse })
  async me(): Promise<TenantResponse> {
    const result = await this.getMyTenant.execute();
    return toAppErrorOrThrow(result) as TenantResponse;
  }
}
