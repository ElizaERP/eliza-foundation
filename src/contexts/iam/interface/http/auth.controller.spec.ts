import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClsService } from 'nestjs-cls';
import request from 'supertest';

import { err, ok } from '@eliza/shared-kernel/domain';
import { ProblemDetailsExceptionFilter } from '@eliza/shared-kernel/infrastructure/exceptions/problem-details.filter';

import { Login, Logout, RefreshSession } from '../../application';
import { SESSION_PROVIDER_PORT } from '../../domain';
import { AuthController } from './auth.controller';

/** /v1/auth/*: contrato HTTP, errores y límite de intentos. */
describe('AuthController (HTTP)', () => {
  let app: INestApplication;
  const sessions = { login: jest.fn(), refresh: jest.fn(), logout: jest.fn() };
  const tokens = { accessToken: 'AT', expiresIn: 900, refreshToken: 'RT', refreshExpiresIn: 1800 };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [AuthController],
      providers: [Login, RefreshSession, Logout, { provide: SESSION_PROVIDER_PORT, useValue: sessions }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1', prefix: 'v' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsExceptionFilter({ get: () => 'test-correlation' } as unknown as ClsService));
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('login correcto → 200 con tokens y Cache-Control: no-store', async () => {
    sessions.login.mockResolvedValueOnce(ok(tokens));
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: '  vendedor@qa.test ', password: 'clave' })
      .expect(200);

    expect(res.body).toEqual({ ...tokens, tokenType: 'Bearer' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(sessions.login).toHaveBeenCalledWith('vendedor@qa.test', 'clave');
  });

  it('credenciales incorrectas → 401 auth.invalid_credentials', async () => {
    sessions.login.mockResolvedValueOnce(err('invalid_credentials'));
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'otro@qa.test', password: 'mala' })
      .expect(401);
    expect(res.body.code).toBe('auth.invalid_credentials');
  });

  it('Keycloak no disponible → 503 auth.provider_unavailable', async () => {
    sessions.login.mockResolvedValueOnce(err('provider_unavailable'));
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'tercero@qa.test', password: 'clave' })
      .expect(503);
    expect(res.body.code).toBe('auth.provider_unavailable');
  });

  it('cuerpo inválido o con campos extra → 400', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username: 'x' }).expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'x', password: 'y', tenantId: 'z' })
      .expect(400);
    expect(sessions.login).not.toHaveBeenCalled();
  });

  it('refresh vencido → 401 auth.session_expired', async () => {
    sessions.refresh.mockResolvedValueOnce(err('session_expired'));
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'RT-viejo' })
      .expect(401);
    expect(res.body.code).toBe('auth.session_expired');
  });

  it('logout → 204', async () => {
    sessions.logout.mockResolvedValueOnce(undefined);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').send({ refreshToken: 'RT' }).expect(204);
    expect(sessions.logout).toHaveBeenCalledWith('RT');
  });

  it('más de 10 intentos por minuto del mismo usuario → 429, sin afectar a otro usuario', async () => {
    sessions.login.mockResolvedValue(err('invalid_credentials'));
    const intento = (username: string) =>
      request(app.getHttpServer()).post('/api/v1/auth/login').send({ username, password: 'mala' });

    for (let i = 0; i < 10; i++) await intento('atacado@qa.test').expect(401);
    await intento('atacado@qa.test').expect(429);
    await intento('ATACADO@qa.test').expect(429); // mismo usuario, otra capitalización
    await intento('inocente@qa.test').expect(401);
  });
});
