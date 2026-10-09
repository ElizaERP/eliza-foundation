import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// =====================================================================
// Requests
// =====================================================================

export class LoginRequest {
  @ApiProperty({ example: 'vendedor@bcm-congelados.com', description: 'Usuario o correo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  username!: string;

  @ApiProperty({ example: '********', format: 'password' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}

export class RefreshSessionRequest {
  @ApiProperty({ description: 'Refresh token recibido en el login o en el último refresh' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  refreshToken!: string;
}

// =====================================================================
// Responses
// =====================================================================

export class SessionResponse {
  @ApiProperty({ description: 'JWT para el header Authorization: Bearer' })
  accessToken!: string;

  @ApiProperty({ example: 900, description: 'Segundos hasta que vence el access token' })
  expiresIn!: number;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ example: 1800, description: 'Segundos de inactividad hasta que vence la sesión' })
  refreshExpiresIn!: number;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';
}
