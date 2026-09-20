import prisma from "../lib/prisma.js";

// Append-only trail of lineup activity. Logging must never break the action it
// describes, so failures are swallowed — a missing log line is a smaller
// problem than a court call that 500s.
export async function logQueueEvent(client, { sessionId, entryId = null, type, actorType = "staff", actorId = null, payload = null }) {
  try {
    await (client || prisma).queueEvent.create({
      data: { sessionId, entryId, type, actorType, actorId, payload }
    });
  } catch {
    // ignore
  }
}

export async function logQueueEvents(client, events) {
  for (const event of events) {
    await logQueueEvent(client, event);
  }
}
