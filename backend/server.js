require('dotenv').config();

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { Server } = require('socket.io');
const { initDb, getMenuItems } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

/**
 * @param {{ dbPath?: string, logger?: boolean | object }} [options]
 */
async function buildServer(options = {}) {
  initDb({
    dbPath: options.dbPath,
    force: Boolean(options.dbPath),
  });

  const app = Fastify({
    logger: options.logger === undefined ? true : options.logger,
  });

  // Phase 0: allow Flutter web/dev origins; tighten in production.
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  app.get('/health', async () => ({ ok: true }));

  app.get('/api/menu', async () => {
    const items = getMenuItems();
    return items;
  });

  // Session routes stubbed in later phases
  app.post('/api/sessions', async (_request, reply) => {
    return reply.code(501).send({ error: 'Not implemented yet' });
  });

  app.post('/api/sessions/join', async (_request, reply) => {
    return reply.code(501).send({ error: 'Not implemented yet' });
  });

  app.get('/api/sessions/:id/state', async (_request, reply) => {
    return reply.code(501).send({ error: 'Not implemented yet' });
  });

  await app.ready();

  // Attach Socket.io to the same HTTP server (Phase 0 skeleton).
  // Room/cart events land in Phase 1.
  const io = new Server(app.server, {
    cors: {
      origin: true,
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    app.log.info({ id: socket.id }, 'socket connected');
    socket.on('disconnect', () => {
      app.log.info({ id: socket.id }, 'socket disconnected');
    });
  });

  app.decorate('io', io);
  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`Server listening on http://localhost:${PORT}`);
    app.log.info(`FRONTEND_URL=${FRONTEND_URL}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = { buildServer };
