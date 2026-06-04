import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
} from '../../infrastructure/auth/auth.guards';
import { GetMe } from '../../application';
import { UserResponse } from './dto/user.dto';
import { toAppErrorOrThrow } from './result-utils';

@ApiTags('IAM · Me')
@ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
export class MeController {
  constructor(private readonly getMe: GetMe) {}

  @Get()
  @ApiOperation({
    summary: 'Información del usuario autenticado',
    description: 'Resuelve el User local que corresponde al JWT actual.',
  })
  @ApiOkResponse({ type: UserResponse })
  async me(): Promise<UserResponse> {
    const result = await this.getMe.execute();
    return toAppErrorOrThrow(result) as UserResponse;
  }

  @Get('claims')
  @ApiOperation({
    summary: 'Claims del JWT validado (debugging)',
    description: 'Devuelve los claims que el JwtAuthGuard verificó. Útil para verificar el flujo de autenticación.',
  })
  claims(@CurrentUser() user: AuthenticatedUser) {
    return {
      keycloakSubject: user.keycloakSubject,
      email: user.email,
      tenantId: user.tenantId,
      plantId: user.plantId,
      warehouseId: user.warehouseId,
      roles: user.roles,
    };
  }
}
