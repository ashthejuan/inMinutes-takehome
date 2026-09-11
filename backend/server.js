require('dotenv').config();

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { Server } = require('socket.io');
const { customAlphabet, nanoid } = require('nanoid');
const { z } = require('zod');
const { initDb, getDb, getMenuItems } = require('./db');
const { refreshStockCache } = require('./stock');
const { getSessionVersion, getCartState, applyMutation } = require('./cart');
const participants = require('./participants');
const { performCheckout } = require('./checkout');

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

// Phase 2: cart mutations carry the version the client last saw (PRD §10).
// Aliases (item_id/base_version/added_by) match the REST snake_case style.
const cartMutationSchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  session_id: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  item_id: z.string().trim().min(1).optional(),
  qty: z.number().int().optional(),
  baseVersion: z.number().int().min(0).optional(),
  base_version: z.number().int().min(0).optional(),
  addedBy: z.string().trim().min(1).max(50).optional(),
  added_by: z.string().trim().min(1).max(50).optional(),
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
 * Look up a session by id or join code (Flutter navigates with the code).
 * @param {import('better-sqlite3').Database} database
 */
function findSession(database, rawId) {
  const raw = String(rawId ?? '').trim();
  if (!raw) return undefined;
  return (
    database
      .prepare('SELECT id, join_code, host_id, status, created_at, expires_at FROM group_sessions WHERE id = ?')
      .get(raw) ??
    database
      .prepare('SELECT id, join_code, host_id, status, created_at, expires_at FROM group_sessions WHERE join_code = ?')
      .get(normalizeJoinCode(raw))
  );
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
  // Phase 2: warm the `menu:stock:{itemId}` cache from SQLite.
  refreshStockCache();
  // Phase 3: fresh process has no live ready-gate state (tests get isolation).
  participants.clearAll();

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

    // Phase 3: seed live ready-gate view (host starts not-ready).
    participants.ensureParticipant(id, hostId, {
      name: hostName,
      isHost: true,
      joinedAt: Date.now(),
    });

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

    // Phase 3: seed live ready-gate view (joins start not-ready).
    participants.ensureParticipant(session.id, userId, {
      name: displayName,
      isHost: false,
      joinedAt: Date.now(),
    });

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
    const session = findSession(database, request.params.id);
    if (!session) {
      const rawId = String(request.params.id ?? '').trim();
      if (!rawId) {
        return reply.code(400).send({ error: 'Session id is required' });
      }
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

    // Phase 3: overlay live ready flags onto the audit rows so REST clients
    // see the same gate state as socket clients (PRD §8.2 participants:sync).
    const liveById = new Map(
      require('./participants').getParticipants(session.id).map((p) => [p.userId, p])
    );
    const enriched = participants.map((row) => {
      const live = liveById.get(row.user_id);
      return { ...row, ready: live ? live.ready : false };
    });
    // Ephemeral socket-only users (never REST-joined) still count for the gate.
    for (const live of liveById.values()) {
      if (!enriched.some((row) => row.user_id === live.userId)) {
        enriched.push({
          session_id: session.id,
          user_id: live.userId,
          display_name: live.name,
          is_host: live.isHost ? 1 : 0,
          joined_at: live.joinedAt,
          ready: live.ready,
        });
      }
    }
    const allReady = require('./participants').isAllReady(session.id);

    const orders = database
      .prepare(
        `SELECT id, session_id, total_paise, status, created_at
         FROM orders
         WHERE session_id = ?
         ORDER BY created_at ASC`
      )
      .all(session.id);

    // Cart + version are live in-memory state (Phase 2 OCC); the client
    // reads baseVersion here (or on socket join) for its first mutation.
    return reply.send({
      session,
      participants: enriched,
      orders,
      cart: getCartState(session.id),
      version: getSessionVersion(session.id),
      allReady,
      all_ready: allReady,
      checkoutAvailable: allReady,
      checkout_available: allReady,
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

    // Phase 3: push the ready-gate view to everyone in the room.
    const broadcastReady = (sessionId) => {
      const list = participants.getParticipants(sessionId);
      const available = participants.isAllReady(sessionId);
      io.to(sessionId).emit('participants:sync', list);
      io.to(sessionId).emit('checkout:available', { available });
    };

    // Join a session room; server replies with the current versioned cart
    // so the client has baseVersion for its first mutation (PRD §10.1).
    socket.on('session:join', (raw, ack) => {
      const body = raw ?? {};
      const sessionId = String(
        body.sessionId ?? body.session_id ?? body.session ?? ''
      ).trim();
      if (!sessionId) {
        const err = { code: 'INVALID_PAYLOAD', message: 'sessionId is required' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, ...err });
        return;
      }
      const session = findSession(getDb(), sessionId);
      if (!session) {
        const err = { code: 'SESSION_NOT_FOUND', message: 'Session not found' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, ...err });
        return;
      }
      socket.join(session.id);
      socket.data.sessionId = session.id;
      const userId = body.userId ?? body.user_id;
      if (userId) socket.data.userId = String(userId);
      // Phase 3: register live presence (display name + host flag from audit
      // when available; ephemeral fallback keeps Phase-2-style tests green).
      if (socket.data.userId) {
        let name;
        let isHost = socket.data.userId === session.host_id;
        try {
          const row = getDb()
            .prepare(
              'SELECT display_name, is_host FROM session_participants WHERE session_id = ? AND user_id = ?'
            )
            .get(session.id, socket.data.userId);
          if (row) {
            name = row.display_name;
            isHost = row.is_host === 1;
          }
        } catch {
          // Ephemeral fallback below.
        }
        participants.ensureParticipant(session.id, socket.data.userId, {
          name: name ?? socket.data.userId,
          isHost,
          joinedAt: Date.now(),
        });
      }
      const state = { version: getSessionVersion(session.id), cart: getCartState(session.id) };
      const list = participants.getParticipants(session.id);
      const available = participants.isAllReady(session.id);
      socket.emit('cart:sync', state);
      socket.emit('participants:sync', list);
      socket.emit('checkout:available', { available });
      io.to(session.id).emit('participants:sync', list);
      if (typeof ack === 'function') ack({ ok: true, ...state, participants: list, checkoutAvailable: available });
    });

    // Phase 3: ready toggle → update gate → broadcast (PRD §8.1 user:ready).
    socket.on('user:ready', (raw, ack) => {
      const body = raw ?? {};
      const sessionId = String(
        body.sessionId ?? body.session_id ?? socket.data.sessionId ?? ''
      ).trim();
      const userId = String(body.userId ?? body.user_id ?? socket.data.userId ?? '').trim();
      const ready = body.ready ?? body.isReady;
      if (!sessionId || !userId || typeof ready !== 'boolean') {
        const err = { code: 'INVALID_PAYLOAD', message: 'sessionId, userId and ready:boolean are required' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, ...err });
        return;
      }
      const session = findSession(getDb(), sessionId);
      if (!session) {
        const err = { code: 'SESSION_NOT_FOUND', message: 'Session not found' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, ...err });
        return;
      }
      socket.data.sessionId = session.id;
      socket.data.userId = userId;
      participants.ensureParticipant(session.id, userId, { joinedAt: Date.now() });
      participants.setReady(session.id, userId, ready);
      broadcastReady(session.id);
      const list = participants.getParticipants(session.id);
      if (typeof ack === 'function') {
        ack({ ok: true, participants: list, available: participants.isAllReady(session.id) });
      }
    });

    // Phase 2 OCC: baseVersion match → apply + INCR + broadcast;
    // mismatch → VERSION_CONFLICT with current state for retry.
    const handleCartMutation = async (raw, ack, numberCheck) => {
      const parsed = cartMutationSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        const err = { code: 'INVALID_PAYLOAD', message: 'Invalid mutation payload' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, ...err });
        return;
      }
      const body = parsed.data;
      const sessionId = body.sessionId ?? body.session_id ?? socket.data.sessionId;
      const itemId = body.itemId ?? body.item_id;
      const baseVersion = body.baseVersion ?? body.base_version;
      let { qty } = body;
      if (qty === undefined && numberCheck.removeDefaultsQty) qty = 0;
      if (!sessionId || !itemId || baseVersion === undefined || qty === undefined) {
        const err = { code: 'INVALID_PAYLOAD', message: 'sessionId, itemId, qty and baseVersion are required' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, ...err });
        return;
      }
      if (numberCheck.minQty !== undefined && qty < numberCheck.minQty) {
        const err = { code: 'INVALID_PAYLOAD', message: `qty must be >= ${numberCheck.minQty}` };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, ...err });
        return;
      }
      const session = findSession(getDb(), sessionId);
      if (!session) {
        const err = { code: 'SESSION_NOT_FOUND', message: 'Session not found' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, ...err });
        return;
      }
      const result = await applyMutation(session.id, {
        itemId,
        qty,
        baseVersion,
        addedBy: body.addedBy ?? body.added_by ?? socket.data.userId ?? null,
      });
      if (result.ok) {
        io.to(session.id).emit('cart:sync', {
          version: result.version,
          cart: result.cart,
          delta: result.delta,
        });
      } else {
        socket.emit('error', {
          code: result.code,
          message: result.message,
          currentVersion: result.currentVersion,
          currentState: result.currentState,
          ...(result.available !== undefined ? { available: result.available } : {}),
        });
      }
      if (typeof ack === 'function') ack(result);
    };

    socket.on('cart:add', (raw, ack) => handleCartMutation(raw, ack, { minQty: 1 }));
    socket.on('cart:updateQty', (raw, ack) => handleCartMutation(raw, ack, { minQty: 0 }));
    socket.on('cart:remove', (raw, ack) => handleCartMutation(raw, ack, { removeDefaultsQty: true, minQty: 0 }));

    // Phase 3: host-only checkout behind the all-ready gate (PRD §8.1).
    socket.on('checkout', (raw, ack) => {
      const body = raw ?? {};
      const sessionId = String(
        body.sessionId ?? body.session_id ?? socket.data.sessionId ?? ''
      ).trim();
      const userId = String(body.userId ?? body.user_id ?? socket.data.userId ?? '').trim();
      if (!sessionId || !userId) {
        const err = { code: 'INVALID_PAYLOAD', message: 'sessionId and userId are required' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, ...err });
        return;
      }
      const session = findSession(getDb(), sessionId);
      if (!session) {
        const err = { code: 'SESSION_NOT_FOUND', message: 'Session not found' };
        socket.emit('error', err);
        if (typeof ack === 'function') ack({ ok: false, ...err });
        return;
      }
      const result = performCheckout(session.id, userId);
      if (result.ok) {
        io.to(session.id).emit('session:checkout', { orderId: result.orderId, order_id: result.orderId });
      } else {
        socket.emit('error', {
          code: result.code,
          message: result.message,
          ...(result.notReady ? { notReady: result.notReady } : {}),
        });
      }
      if (typeof ack === 'function') ack(result);
    });

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
