// Write a started match: the match row, its participants, the court it's on,
// and the queue entries it consumed. Takes a Prisma client so callers can pass
// a transaction — the open-play court call needs all of this to be atomic.
export async function startMatchTx(client, { sessionId, courtSessionId, matchType, teams, entryIds, teamIds = [null, null] }) {
  const match = await client.match.create({
    data: {
      sessionId,
      courtSessionId,
      status: "active",
      matchType,
      startedAt: new Date()
    }
  });

  await client.matchParticipant.createMany({
    data: teams.flatMap((team, idx) =>
      team.map((playerId) => ({
        matchId: match.id,
        playerId,
        teamNumber: idx + 1,
        teamId: teamIds[idx] || null
      }))
    )
  });

  await client.courtSession.update({
    where: { id: courtSessionId },
    data: { status: "in_match", currentMatchId: match.id }
  });

  if (entryIds?.length) {
    await client.queueEntry.updateMany({
      where: { id: { in: entryIds } },
      data: { status: "assigned" }
    });
  } else {
    // No explicit entries: retire whatever the players were queued in.
    await client.queueEntry.updateMany({
      where: {
        sessionId,
        status: "queued",
        players: { some: { playerId: { in: teams.flat() } } }
      },
      data: { status: "assigned" }
    });
  }

  return match;
}
