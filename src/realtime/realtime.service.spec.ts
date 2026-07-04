import { createServer, type Server as HttpServer } from 'http';
import { Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import {
  io as createClient,
  type Socket as ClientSocket,
} from 'socket.io-client';
import { RealtimeService } from './realtime.service';

const payload = {
  page_id: '331141913426390',
  conversation_id: 'conv-pancake-1',
  message_id: 'msg-1',
  timestamp: '2026-07-04T01:00:00.000Z',
  source: 'pancake' as const,
};

describe('RealtimeService', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['message.created', 'emitMessageCreated'],
    ['message.updated', 'emitMessageUpdated'],
    ['conversation.updated', 'emitConversationUpdated'],
    ['conversation.assigned', 'emitConversationAssigned'],
    ['conversation.read', 'emitConversationRead'],
  ] as const)(
    'emits %s to the exact page and conversation rooms',
    (event, method) => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      const rooms = new Map<string, Set<string>>([
        [`page:${payload.page_id}`, new Set(['socket-1'])],
      ]);
      const service = new RealtimeService();
      service.setServer({ sockets: { adapter: { rooms } }, to } as any);
      jest.spyOn(Logger.prototype, 'log').mockImplementation();

      const result = service[method](payload);

      expect(to).toHaveBeenCalledWith(`page:${payload.page_id}`);
      expect(to).toHaveBeenCalledWith(
        `conversation:${payload.conversation_id}`,
      );
      expect(emit).toHaveBeenCalledWith(event, {
        ...payload,
        event,
      });
      expect(result.rooms).toContainEqual({
        room: `page:${payload.page_id}`,
        sockets: 1,
      });
    },
  );
});

describe('RealtimeService Socket.IO integration', () => {
  let httpServer: HttpServer;
  let server: Server;
  let client: ClientSocket;

  afterEach(async () => {
    client?.disconnect();
    await server?.close();
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
    jest.restoreAllMocks();
  });

  it('delivers message.created to a client that joined the page room', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    httpServer = createServer();
    server = new Server(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string')
      throw new Error('No test port');

    server.on('connection', (socket) => {
      socket.on('join_page', ({ page_id }) => socket.join(`page:${page_id}`));
    });

    client = createClient(`http://127.0.0.1:${address.port}`, {
      transports: ['websocket'],
      forceNew: true,
    });
    await new Promise<void>((resolve) =>
      client.once('connect', () => resolve()),
    );
    client.emit('join_page', { page_id: payload.page_id });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    const received = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('message.created timeout')),
        1000,
      );
      client.once('message.created', (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });

    const service = new RealtimeService();
    service.setServer(server);
    const result = service.emitMessageCreated(payload);

    await expect(received).resolves.toEqual({
      ...payload,
      event: 'message.created',
    });
    expect(result.rooms).toContainEqual({
      room: `page:${payload.page_id}`,
      sockets: 1,
    });
  });
});
