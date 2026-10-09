import { KeycloakConfig } from './keycloak.config';
import { KeycloakSessionProvider } from './keycloak-session.provider';

/** Login de la app: cómo se traducen las respuestas de Keycloak. */
describe('KeycloakSessionProvider', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();

  const config = (login = true) =>
    ({
      realmTokenUrl: 'http://keycloak:8080/auth/realms/eliza/protocol/openid-connect/token',
      realmLogoutUrl: 'http://keycloak:8080/auth/realms/eliza/protocol/openid-connect/logout',
      loginClientId: login ? 'eliza-app-login' : null,
      loginClientSecret: login ? 's3cr3t' : null,
    }) as unknown as KeycloakConfig;

  const reply = (status: number, body: unknown) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('login correcto: devuelve los tokens y envía el cliente confidencial', async () => {
    reply(200, { access_token: 'AT', expires_in: 900, refresh_token: 'RT', refresh_expires_in: 1800 });
    const r = await new KeycloakSessionProvider(config()).login('vendedor', 'clave');

    expect(r.unwrap()).toEqual({ accessToken: 'AT', expiresIn: 900, refreshToken: 'RT', refreshExpiresIn: 1800 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://keycloak:8080/auth/realms/eliza/protocol/openid-connect/token');
    const form = new URLSearchParams(init.body as string);
    expect(form.get('grant_type')).toBe('password');
    expect(form.get('client_id')).toBe('eliza-app-login');
    expect(form.get('client_secret')).toBe('s3cr3t');
    expect(form.get('username')).toBe('vendedor');
  });

  it('contraseña incorrecta (o cuenta bloqueada/deshabilitada) → invalid_credentials', async () => {
    reply(401, { error: 'invalid_grant', error_description: 'Invalid user credentials' });
    const r = await new KeycloakSessionProvider(config()).login('vendedor', 'mala');
    expect(r.isErr && r.error).toBe('invalid_credentials');
  });

  it('acciones pendientes (contraseña temporal) → account_setup_required', async () => {
    reply(400, { error: 'invalid_grant', error_description: 'Account is not fully set up' });
    const r = await new KeycloakSessionProvider(config()).login('nuevo', 'temporal');
    expect(r.isErr && r.error).toBe('account_setup_required');
  });

  it('refresh vencido o revocado → session_expired', async () => {
    reply(400, { error: 'invalid_grant', error_description: 'Token is not active' });
    const r = await new KeycloakSessionProvider(config()).refresh('RT-viejo');
    expect(r.isErr && r.error).toBe('session_expired');
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body as string).get('grant_type')).toBe('refresh_token');
  });

  it('secreto del cliente mal configurado → provider_unavailable (no es culpa del usuario)', async () => {
    reply(401, { error: 'unauthorized_client', error_description: 'Invalid client or Invalid client credentials' });
    const r = await new KeycloakSessionProvider(config()).login('vendedor', 'clave');
    expect(r.isErr && r.error).toBe('provider_unavailable');
  });

  it('Keycloak caído → provider_unavailable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const r = await new KeycloakSessionProvider(config()).login('vendedor', 'clave');
    expect(r.isErr && r.error).toBe('provider_unavailable');
  });

  it('sin KEYCLOAK_LOGIN_* → provider_unavailable sin llamar a Keycloak', async () => {
    const r = await new KeycloakSessionProvider(config(false)).login('vendedor', 'clave');
    expect(r.isErr && r.error).toBe('provider_unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logout nunca lanza, aunque Keycloak falle', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(new KeycloakSessionProvider(config()).logout('RT')).resolves.toBeUndefined();
    reply(400, { error: 'invalid_grant' });
    await expect(new KeycloakSessionProvider(config()).logout('RT')).resolves.toBeUndefined();
  });
});
