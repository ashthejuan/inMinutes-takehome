require('dotenv').config();

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { Server } = require('socket.io');
const { customAlphabet, nanoid } = require('nanoid');
const { z } = require('zod');
const { initDb, getDb, getMenuItems } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24h
const JOIN_CODE_LENGTH = 6;
// Unambiguous alphabet: no 0/O, 1/I (matches PRD 6-char uppercase code).
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const generateJoinCode = customAlphabet(JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH);

const displayNameField = z.string().trim().min(1).max(50);

const createSessionSchema = z.object({
  display_name: displayNameField.optional(),
});

const joinSessionSchema = z.object({
  join_code: z.string().trim().min(1).max(12),
  display_name: displayNameField.optional(),
});

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function normalizeJoinCode(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

function defaultGuestName(userId) {
  return `Guest-${String(userId).slice(0, 4).toUpperCase()}`;
}

/**
 * Generate a join code that does not collide with existing sessions.
 * @param {import('better-sqlite3').Database} database
 */
function generateUniqueJoinCode(database) {
  const lookup = database.prepare('SELECT 1 FROM group_sessions WHERE join_code = ?');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateJoinCode();
    if (!lookup.get(code)) {
      return code;
    }
  }
  // Extremely unlikely fallback: longer code to guarantee uniqueness.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `${generateJoinCode()}${generateJoinCode()}`.slice(0, 8);
    if (!lookup.get(code)) {
      return code;
    }
  }
  throw new Error('Failed to generate unique join code');
}

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

  // Phase 1: session management (REST only; no room broadcasts yet).
  app.post('/api/sessions', async (request, reply) => {
    const database = getDb();
    const body = request.body ?? {};

    // Accept camelCase alias from future Flutter clients.
    const normalizedBody = {
      display_name: body.display_name ?? body.displayName ?? body.host_name ?? undefined,
    };
    const parsed = createSessionSchema.safeParse(normalizedBody);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.flatten() });
    }

    const id = nanoid(12);
    const hostId = nanoid(12);
    const joinCode = generateUniqueJoinCode(database);
    const createdAt = nowSeconds();
    const expiresAt = createdAt + SESSION_TTL_SECONDS;
    const hostName = parsed.data.display_name ?? 'Host';

    try {
      const insertSession = database.prepare(`
        INSERT INTO group_sessions (id, join_code, host_id, status, created_at, expires_at)
        VALUES (?, ?, ?, 'active', ?, ?)
      `);
      const insertHost = database.prepare(`
        INSERT INTO session_participants (session_id, user_id, display_name, is_host, joined_at)
        VALUES (?, ?, ?, 1, ?)
      `);
      const createAll = database.transaction(() => {
        insertSession.run(id, joinCode, hostId, createdAt, expiresAt);
        insertHost.run(id, hostId, hostName, Date.now());
      });
      createAll();
    } catch (err) {
      request.log.error(err, 'failed to create session');
      return reply.code(500).send({ error: 'Failed to create session' });
    }

    return reply.code(201).send({
      id,
      join_code: joinCode,
      status: 'active',
      created_at: createdAt,
      expires_at: expiresAt,
      host_id: hostId,
      // Aliases matching PRD §11 for Flutter clients.
      sessionId: id,
      joinCode,
      hostId,
    });
  });

  app.post('/api/sessions/join', async (request, reply) => {
    const database = getDb();
    const body = request.body ?? {};

    const normalizedBody = {
      join_code: normalizeJoinCode(body.join_code ?? body.joinCode ?? ''),
      display_name: body.display_name ?? body.displayName ?? body.name ?? undefined,
    };
    const parsed = joinSessionSchema.safeParse(normalizedBody);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'join_code is required', details: parsed.error.flatten() });
    }

    const session = database
      .prepare('SELECT id, join_code, host_id, status, created_at, expires_at FROM group_sessions WHERE join_code = ?')
      .get(parsed.data.join_code);

    if (!session) {
      return reply.code(404).send({ error: 'Invalid join code' });
    }
    if (session.status !== 'active' || session.expires_at <= nowSeconds()) {
      return reply.code(410).send({ error: 'Session expired' });
    }

    const userId = nanoid(12);
    const displayName = parsed.data.display_name ?? defaultGuestName(userId);

    try {
      database
        .prepare(`
          INSERT INTO session_participants (session_id, user_id, display_name, is_host, joined_at)
          VALUES (?, ?, ?, 0, ?)
        `)
        .run(session.id, userId, displayName, Date.now());
    } catch (err) {
      request.log.error(err, 'failed to join session');
      return reply.code(500).send({ error: 'Failed to join session' });
    }

    return reply.send({
      session_id: session.id,
      user_id: userId,
      display_name: displayName,
      is_host: 0,
      join_code: session.join_code,
      // Aliases matching PRD §11.
      sessionId: session.id,
      userId,
      isHost: false,
    });
  });

  app.get('/api/sessions/:id/state', async (request, reply) => {
    const database = getDb();
    const rawId = String(request.params.id ?? '').trim();
    if (!rawId) {
      return reply.code(400).send({ error: 'Session id is required' });
    }

    // Accept either the session id or the 6-char join code for convenience.
    const session =
      database
        .prepare('SELECT id, join_code, host_id, status, created_at, expires_at FROM group_sessions WHERE id = ?')
        .get(rawId) ??
      database
        .prepare('SELECT id, join_code, host_id, status, created_at, expires_at FROM group_sessions WHERE join_code = ?')
        .get(normalizeJoinCode(rawId));

    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const participants = database
      .prepare(
        `SELECT session_id, user_id, display_name, is_host, joined_at
         FROM session_participants
         WHERE session_id = ?
         ORDER BY joined_at ASC`
      )
      .all(session.id);

    const orders = database
      .prepare(
        `SELECT id, session_id, total_paise, status, created_at
         FROM orders
         WHERE session_id = ?
         ORDER BY created_at ASC`
      )
      .all(session.id);

    // Cart lives in ephemeral in-memory state in later phases; Phase 1 is REST-only.
    return reply.send({
      session,
      participants,
      orders,
      cart: {},
      version: 0,
    });
  });

  await app.ready();

  // Attach Socket.io to the same HTTP server (Phase 0 skeleton).
  // Phase 1 is REST-only per build plan deferral: no room join/broadcasts yet.
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
