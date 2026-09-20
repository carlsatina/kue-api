// Open-play pairing. Pure on purpose: everything here is arithmetic over plain
// objects, so the rules that decide who plays next can be reasoned about (and
// argued about at the venue) without a database in the picture. All I/O lives
// in services/queue.js, which loads the rows and calls in here.

const SKILL_RATING = {
  Beginner: 1,
  Intermediate: 2,
  Advance: 3,
  Elite: 4
};

// A player's strength, used only to compare the two sides of one foursome.
// Skill level is the backbone; in-session win rate nudges it by at most half a
// level so a hot beginner isn't treated as an elite.
export function ratingOf(player) {
  const base = SKILL_RATING[player?.skillLevel] || SKILL_RATING.Beginner;
  const played = (player?.wins || 0) + (player?.losses || 0);
  if (!played) return base;
  return base + ((player.wins || 0) / played) * 0.5;
}

// How much a repeated pairing costs, in "rating gap" units. Partnering the same
// person again is the thing players notice and complain about, so it stings
// roughly three times as much as facing the same opponent again.
const REPEAT_PARTNER_WEIGHT = 1.5;
const REPEAT_OPPONENT_WEIGHT = 0.5;

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Count, across recent matches, how often each pair of players was partnered
// and how often they were opponents.
function buildRepeatIndex(history) {
  const partners = new Map();
  const opponents = new Map();

  for (const match of history) {
    const teams = match.teams || [];
    for (const team of teams) {
      for (let i = 0; i < team.length; i += 1) {
        for (let j = i + 1; j < team.length; j += 1) {
          const key = pairKey(team[i], team[j]);
          partners.set(key, (partners.get(key) || 0) + 1);
        }
      }
    }
    if (teams.length === 2) {
      for (const a of teams[0]) {
        for (const b of teams[1]) {
          const key = pairKey(a, b);
          opponents.set(key, (opponents.get(key) || 0) + 1);
        }
      }
    }
  }

  return { partners, opponents };
}

function repeatPenalty(teams, repeats) {
  let penalty = 0;
  for (const team of teams) {
    for (let i = 0; i < team.length; i += 1) {
      for (let j = i + 1; j < team.length; j += 1) {
        penalty += (repeats.partners.get(pairKey(team[i], team[j])) || 0) * REPEAT_PARTNER_WEIGHT;
      }
    }
  }
  for (const a of teams[0]) {
    for (const b of teams[1]) {
      penalty += (repeats.opponents.get(pairKey(a, b)) || 0) * REPEAT_OPPONENT_WEIGHT;
    }
  }
  return penalty;
}

function teamRating(playerIds, players) {
  return playerIds.reduce((sum, id) => sum + ratingOf(players.get(id)), 0);
}

// Take whole entries off the head of the lineup until the court is full.
//
// An entry is never split: two people who queued together as a pair play
// together or not at all. When the entry at the head is too big for the room
// left — a pair when only one slot remains — it is passed over and KEEPS ITS
// POSITION, so it goes first in the next call rather than losing its place.
// That is the rule most likely to need changing per venue; it lives here alone.
function fillCourt(entries, teamSize) {
  const needed = teamSize * 2;
  const taken = [];
  const skipped = [];
  let remaining = needed;

  for (const entry of entries) {
    if (remaining === 0) break;
    const size = entry.playerIds.length;

    // A full-court locked entry is its own match, and only when the court is
    // still empty — it can't be mixed with anyone else.
    const isLockedFullCourt = entry.lockedTeams && size === needed;
    const fits = isLockedFullCourt ? remaining === needed : size <= teamSize && size <= remaining;

    if (!fits) {
      skipped.push(entry);
      continue;
    }

    taken.push(entry);
    remaining -= size;
  }

  return { taken, skipped, filled: remaining === 0 };
}

// Every way to deal the taken entries into two equal sides, keeping each entry
// whole. Canonical form: the earliest entry is always on team 1, so mirrored
// splits aren't counted twice.
function candidateSplits(taken, teamSize) {
  const candidates = [];
  const total = taken.length;

  for (let mask = 0; mask < 1 << total; mask += 1) {
    if (!(mask & 1)) continue; // team 1 always holds the earliest entry
    const teamA = [];
    const teamB = [];
    for (let i = 0; i < total; i += 1) {
      (mask & (1 << i) ? teamA : teamB).push(taken[i]);
    }
    const sizeA = teamA.reduce((n, e) => n + e.playerIds.length, 0);
    const sizeB = teamB.reduce((n, e) => n + e.playerIds.length, 0);
    if (sizeA !== teamSize || sizeB !== teamSize) continue;

    candidates.push({
      teamA,
      teamB,
      teams: [teamA.flatMap((e) => e.playerIds), teamB.flatMap((e) => e.playerIds)],
      // Where team 1's last member sits in the lineup: the smaller this is, the
      // closer the split is to plain arrival order.
      arrivalScore: Math.max(...teamA.map((e) => taken.indexOf(e)))
    });
  }

  return candidates;
}

function scoreCandidate(candidate, { strategy, players, repeats }) {
  if (strategy === "arrival") return candidate.arrivalScore;

  const gap = Math.abs(
    teamRating(candidate.teams[0], players) - teamRating(candidate.teams[1], players)
  );
  if (strategy === "balanced") return gap;
  return gap + repeatPenalty(candidate.teams, repeats);
}

/**
 * Decide the next match from a lineup.
 *
 * @param {object[]} entries  Queued entries, already filtered to eligible ones
 *                            and sorted by position: { id, playerIds, lockedTeams, teams? }
 * @param {Map} players       playerId -> { skillLevel, wins, losses }
 * @param {object[]} history  Recent matches, most recent first: { teams: [[ids],[ids]] }
 * @param {string} strategy   arrival | balanced | avoid_repeat
 * @param {number} teamSize   2 for doubles, 1 for singles
 * @returns {object|null}     { entryIds, teams, skippedEntryIds, strategy, lockedTeams }
 */
export function pickNextMatch({
  entries = [],
  players = new Map(),
  history = [],
  strategy = "arrival",
  teamSize = 2
}) {
  const { taken, skipped, filled } = fillCourt(entries, teamSize);
  if (!filled) return null;

  const skippedEntryIds = skipped.map((e) => e.id);
  const entryIds = taken.map((e) => e.id);

  // An organiser-fixed foursome plays exactly as entered. If the sides didn't
  // come through intact, fall through and split it like any other entry rather
  // than starting a lopsided match.
  if (taken.length === 1 && taken[0].lockedTeams) {
    const teams = taken[0].teams;
    const intact =
      Array.isArray(teams) &&
      teams.length === 2 &&
      teams.every((team) => Array.isArray(team) && team.length === teamSize);
    if (intact) {
      return { entryIds, teams, skippedEntryIds, strategy: "locked", lockedTeams: true };
    }
  }

  const candidates = candidateSplits(taken, teamSize);
  if (!candidates.length) return null;

  const repeats = strategy === "avoid_repeat" ? buildRepeatIndex(history) : null;
  let best = null;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, { strategy, players, repeats });
    // Ties break toward arrival order, so the lineup stays predictable.
    if (score < bestScore || (score === bestScore && candidate.arrivalScore < best.arrivalScore)) {
      best = candidate;
      bestScore = score;
    }
  }

  return {
    entryIds,
    teams: best.teams,
    skippedEntryIds,
    strategy,
    lockedTeams: false
  };
}
