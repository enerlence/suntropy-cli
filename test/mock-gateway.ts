import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Gateway de Suntropy Connect simulado, con el contrato de pvsyst-api (fases 1-3).
 * Guarda lo que recibe en `calls` para comprobarlo en las pruebas.
 */
export interface MockGateway {
  url: string;
  calls: Array<{ method: string; path: string; body: any; headers: IncomingMessage['headers'] }>;
  state: {
    approveAfterPolls: number;
    polls: number;
    deny: boolean;
    scope: string;
    links: Record<string, number>;
    deviceCounter: number;
  };
  close(): Promise<void>;
}

const CATALOG = [
  {
    provider: 'huawei',
    name: 'Huawei FusionSolar',
    howToConnect: 'link_or_direct',
    fields: [
      { key: 'host', type: 'text', secret: false, required: true, label: 'Servidor' },
      { key: 'username', type: 'text', secret: false, required: true, label: 'Usuario API' },
      { key: 'password', type: 'password', secret: true, required: true, label: 'Contraseña' },
    ],
  },
  { provider: 'sungrow', name: 'iSolarCloud', howToConnect: 'link_only', fields: [] },
];

export async function startMockGateway(): Promise<MockGateway> {
  const calls: MockGateway['calls'] = [];
  const state: MockGateway['state'] = {
    approveAfterPolls: 1,
    polls: 0,
    deny: false,
    scope: 'pvsyst connections:write',
    links: {},
    deviceCounter: 0,
  };
  const approved = new Set<string>();
  const refreshes = new Map<string, number>();
  let tokenCounter = 0;

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const issue = () => {
    tokenCounter++;
    const refresh = `r${tokenCounter}`;
    refreshes.set(refresh, tokenCounter);
    return {
      access_token: `pvo_tok${tokenCounter}`,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refresh,
      scope: state.scope,
    };
  };
  const authed = (req: IncomingMessage) => {
    const a = req.headers['authorization'] ?? '';
    return a.startsWith('Bearer pvo_') && a !== 'Bearer pvo_expired';
  };

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf-8');
    const body = raw ? JSON.parse(raw) : undefined;
    const path = (req.url ?? '').split('?')[0];
    calls.push({ method: req.method ?? '', path, body, headers: req.headers });

    if (req.method === 'POST' && path === '/device_authorization') {
      state.deviceCounter++;
      return send(res, 200, {
        device_code: `dc-${state.deviceCounter}`,
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://app.suntropy.ai/authorize-connector',
        verification_uri_complete: 'https://app.suntropy.ai/authorize-connector?user_code=ABCD-EFGH',
        expires_in: 1800,
        interval: 1,
      });
    }
    if (req.method === 'POST' && path === '/token') {
      if (body.grant_type === 'refresh_token') {
        if (!refreshes.has(body.refresh_token)) return send(res, 400, { error: 'invalid_grant', error_description: 'That refresh token is invalid or has already been used.' });
        refreshes.delete(body.refresh_token);
        return send(res, 200, issue());
      }
      if (!String(body.device_code).startsWith('dc-')) return send(res, 400, { error: 'invalid_grant' });
      if (state.deny) return send(res, 400, { error: 'access_denied' });
      state.polls++;
      if (approved.has(body.device_code) || state.polls > state.approveAfterPolls) {
        approved.delete(body.device_code);
        return send(res, 200, issue());
      }
      return send(res, 400, { error: 'authorization_pending', interval: 1 });
    }
    if (req.method === 'POST' && path === '/device_authorization/email') {
      if (!String(body.email).includes('@')) return send(res, 400, { error: 'invalid_email', error_description: 'That email address is not valid.' });
      return send(res, 202, { sent: true, expires_in: 900 });
    }
    if (req.method === 'POST' && path === '/device_authorization/email/verify') {
      switch (body.code) {
        case '111111':
          approved.add(body.device_code);
          return send(res, 200, { approved: true, trial: { started: true, endsAt: '2026-11-17T00:00:00Z', days: 7 } });
        case '222222':
          return send(res, 400, { error: 'invalid_code', attempts_left: 3 });
        case '333333':
          return send(res, 402, {
            error: 'licence_inactive',
            trialEligible: true,
            verification_uri_complete: 'https://app.suntropy.ai/authorize-connector?user_code=ABCD-EFGH',
          });
        default:
          return send(res, 410, { error: 'expired_token' });
      }
    }
    if (path.startsWith('/integrations') || path.endsWith('/mcp')) {
      if (!authed(req)) return send(res, 401, { error: 'unauthorized', message: 'Missing credentials.' });
    }
    if (req.method === 'POST' && path.endsWith('/mcp')) {
      if (req.headers['mcp-protocol-version'] !== '2026-07-28' || req.headers['mcp-method'] !== body.method) {
        return send(res, 400, { jsonrpc: '2.0', id: body.id, error: { code: -32001, message: 'header mismatch' } });
      }
      if (body.method === 'tools/list') {
        return send(res, 200, {
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: [{ name: 'list_plants', title: 'List plants', inputSchema: { properties: { query: {} } } }] },
        });
      }
      const { name, arguments: args } = body.params;
      if (req.headers['mcp-name'] !== name) return send(res, 400, { error: 'mcp-name' });
      if (name === 'nope') {
        return send(res, 200, { jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Herramienta desconocida: nope. Consulta tools/list.' } });
      }
      if (name === 'failing') {
        return send(res, 200, { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'quota exceeded' }], isError: true } });
      }
      const data =
        name === 'get_connection_catalog'
          ? { providers: CATALOG.filter((c) => !args.provider || c.provider === args.provider) }
          : { tool: name, args };
      return send(res, 200, {
        jsonrpc: '2.0',
        id: body.id,
        result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false },
      });
    }
    if (req.method === 'POST' && path === '/integrations/connection-links') {
      const id = `lk${Object.keys(state.links).length + 1}`;
      state.links[id] = 0;
      return send(res, 201, {
        id,
        provider: body.provider,
        url: `https://app.suntropy.ai/configuration/suntropy-connect/connectors?add=${body.provider}&link=${id}`,
        expiresAt: '2026-11-10T15:42:00.000Z',
      });
    }
    if (req.method === 'GET' && path.startsWith('/integrations/connection-links/')) {
      const id = path.split('/').pop()!;
      if (!(id in state.links)) return send(res, 404, { error: 'not_found' });
      state.links[id]++;
      const done = state.links[id] > 1;
      return send(res, 200, { id, provider: 'huawei', state: done ? 'done' : 'pending', status: done ? 'done' : 'pending', ...(done ? { connectionId: 'c1' } : {}) });
    }
    if (req.method === 'POST' && path === '/integrations/connections') {
      if (!state.scope.includes('connections:write')) {
        return send(res, 403, { error: 'insufficient_scope', scope: 'connections:write', message: 'no' });
      }
      return send(res, 201, { connection: { id: 'c1', provider: body.provider, label: body.label ?? null }, result: { count: 3, unit: 'plants' } });
    }
    return send(res, 404, { error: 'not_found' });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    state,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
