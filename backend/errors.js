/**
 * Phase 4 — Standardized error codes (PRD §8.2 / §8.3).
 *
 * Every socket `error` event and every REST 4xx carries the same shape:
 * `{ code, message, ...extra }`. REST keeps the legacy `error` alias so
 * older Flutter builds still render the message.
 *
 * Note: single table, no classes.
 */

const ERROR_CODES = {
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  /** Session past `expires_at` or already swept to `expired` (§7.1 TTL). */
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  /** Session already checked out (`status = 'completed'`). */
  SESSION_COMPLETED: 'SESSION_COMPLETED',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  UNKNOWN_ITEM: 'UNKNOWN_ITEM',
  ONLY_HOST_CAN_CHECKOUT: 'ONLY_HOST_CAN_CHECKOUT',
  NOT_ALL_READY: 'NOT_ALL_READY',
  EMPTY_CART: 'EMPTY_CART',
  /** Caller is not a participant of the session. */
  NOT_IN_SESSION: 'NOT_IN_SESSION',
};

/** Build a `{ code, message, ...extra }` payload (socket + REST). */
function errorPayload(code, message, extra = {}) {
  return { code, message, ...extra };
}

/** Emit a standardized `error` event on one socket. */
function emitError(socket, code, message, extra = {}) {
  socket.emit('error', errorPayload(code, message, extra));
}

/**
 * Reply with a standardized REST error (keeps legacy `error` alias).
 * @param {import('fastify').FastifyReply} reply
 */
function restError(reply, status, code, message, extra = {}) {
  return reply.code(status).send({ error: message, code, message, ...extra });
}

module.exports = { ERROR_CODES, errorPayload, emitError, restError };
