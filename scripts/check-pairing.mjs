// Checks for the pairing rules. No test framework — run it directly:
//   node scripts/check-pairing.mjs
import { pickNextMatch } from "../src/services/pairing.js";

const P = (id, skill, wins = 0, losses = 0) => [id, { skillLevel: skill, wins, losses }];
const solo = (id, player) => ({ id, playerIds: [player], lockedTeams: false });
const pair = (id, a, b) => ({ id, playerIds: [a, b], lockedTeams: false });

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got      ${a}\n       expected ${e}`); }
}

const players = new Map([
  P("a", "Elite"), P("b", "Beginner"), P("c", "Elite"), P("d", "Beginner"),
  P("e", "Intermediate"), P("f", "Intermediate")
]);

console.log("\n1. Four solo rackets, arrival order → first two vs next two");
let r = pickNextMatch({ entries: [solo("e1","a"), solo("e2","b"), solo("e3","c"), solo("e4","d")], players, strategy: "arrival" });
check("teams", r.teams, [["a","b"],["c","d"]]);
check("consumes 4 entries", r.entryIds, ["e1","e2","e3","e4"]);
check("nothing skipped", r.skippedEntryIds, []);

console.log("\n2. Same four, balanced → elites split across teams");
r = pickNextMatch({ entries: [solo("e1","a"), solo("e2","c"), solo("e3","b"), solo("e4","d")], players, strategy: "balanced" });
check("elite+beginner vs elite+beginner", r.teams.map(t => t.map(id => players.get(id).skillLevel)), [["Elite","Beginner"],["Elite","Beginner"]]);

console.log("\n3. Two pairs → they stay together, one split only");
r = pickNextMatch({ entries: [pair("p1","a","b"), pair("p2","c","d")], players, strategy: "balanced" });
check("pairs intact", r.teams, [["a","b"],["c","d"]]);

console.log("\n4. Pair at the head with only 1 slot left → passed over, keeps position");
r = pickNextMatch({ entries: [solo("s1","a"), solo("s2","b"), solo("s3","c"), pair("p1","d","e"), solo("s4","f")], players, strategy: "arrival" });
check("pair skipped, 4th solo pulled up", r.entryIds, ["s1","s2","s3","s4"]);
check("skip recorded", r.skippedEntryIds, ["p1"]);
check("teams", r.teams, [["a","b"],["c","f"]]);

console.log("\n5. Pair + two solos → pair is one team");
r = pickNextMatch({ entries: [pair("p1","a","b"), solo("s1","c"), solo("s2","d")], players, strategy: "arrival" });
check("teams", r.teams, [["a","b"],["c","d"]]);

console.log("\n6. Locked foursome at the head → played exactly as entered");
r = pickNextMatch({
  entries: [{ id: "L1", playerIds: ["a","b","c","d"], lockedTeams: true, teams: [["a","c"],["b","d"]] }, solo("s1","e")],
  players, strategy: "balanced"
});
check("teams verbatim", r.teams, [["a","c"],["b","d"]]);
check("strategy reported", r.strategy, "locked");
check("solo untouched", r.skippedEntryIds, []);

console.log("\n7. avoid_repeat → breaks up a partnership from the last match");
const history = [{ teams: [["a","b"],["c","d"]] }, { teams: [["a","b"],["e","f"]] }];
const even = new Map([P("a","Intermediate"),P("b","Intermediate"),P("c","Intermediate"),P("d","Intermediate")]);
const entries = [solo("e1","a"), solo("e2","b"), solo("e3","c"), solo("e4","d")];
check("arrival would repeat a+b", pickNextMatch({ entries, players: even, history, strategy: "arrival" }).teams, [["a","b"],["c","d"]]);
r = pickNextMatch({ entries, players: even, history, strategy: "avoid_repeat" });
const together = r.teams.some(t => t.includes("a") && t.includes("b"));
check("a and b are no longer partners", together, false);

console.log("\n8. Singles: teamSize 1");
r = pickNextMatch({ entries: [solo("e1","a"), solo("e2","b"), solo("e3","c")], players, teamSize: 1, strategy: "arrival" });
check("1v1 from the head", r.teams, [["a"],["b"]]);

console.log("\n9. Not enough players → null");
check("three solos, doubles", pickNextMatch({ entries: [solo("e1","a"), solo("e2","b"), solo("e3","c")], players }), null);
check("empty lineup", pickNextMatch({ entries: [], players }), null);

console.log("\n10. Oversized/odd entry never gets called");
check("3-player entry alone", pickNextMatch({ entries: [{ id: "x", playerIds: ["a","b","c"], lockedTeams: false }, solo("s1","d")], players }), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
