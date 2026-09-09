// Pure calculation functions over the match/innings data model.
// Nothing here touches the DOM or storage - keeps this testable & reusable.

import {
  toBalls, ballsToOverString, ballsToOversDecimalForRR, teamName, oppositeSide,
  battingSideForInnings, bowlingSideForInnings, SESSIONS, OVERS_PER_SESSION,
} from './model.js';

export function sortedOvers(innings) {
  return [...innings.overs].sort((a, b) => a.overNumber - b.overNumber);
}

/** Balls legally bowled so far in the innings (completed overs only). */
export function totalBalls(innings) {
  return sortedOvers(innings).length * 6;
}

export function currentScore(innings) {
  const overs = sortedOvers(innings);
  const runs = overs.reduce((sum, o) => sum + o.runs, 0);
  const wickets = Math.min(10, innings.fallOfWickets.length);
  const balls = overs.length * 6;
  return {
    runs,
    wickets,
    balls,
    overString: ballsToOverString(balls),
    runRate: balls > 0 ? runs / ballsToOversDecimalForRR(balls) : 0,
  };
}

export function isInningsClosed(innings) {
  if (!innings) return false;
  return innings.declared || innings.fallOfWickets.length >= 10;
}

/** Find the saved over entry (if any) for a given over number in an innings. */
function overEntryFor(innings, overNumber) {
  return innings.overs.find((o) => o.overNumber === overNumber) || null;
}

/** Over-by-over series with cumulative runs/wickets/run-rate - the main innings table. */
export function overByOverSeries(innings) {
  const overs = sortedOvers(innings);
  let cumRuns = 0;
  return overs.map((o) => {
    cumRuns += o.runs;
    const cumWickets = Math.min(10, innings.fallOfWickets.filter((w) => w.oversCompleted + 1 <= o.overNumber).length);
    const balls = o.overNumber * 6;
    return {
      overNumber: o.overNumber,
      runs: o.runs,
      cumRuns,
      cumWickets,
      runRate: cumRuns / ballsToOversDecimalForRR(balls),
      day: o.day,
      session: o.session,
      ballNumber: o.ballNumber,
    };
  });
}

/** Runs/wickets grouped by which physical ball (new-ball spell) was in use. */
export function ballSummary(innings) {
  const overs = sortedOvers(innings);
  const map = new Map();
  for (const o of overs) {
    if (!map.has(o.ballNumber)) map.set(o.ballNumber, { ballNumber: o.ballNumber, runs: 0, wickets: 0, ballsBowled: 0 });
    const e = map.get(o.ballNumber);
    e.runs += o.runs;
    e.ballsBowled += 6;
  }
  for (const w of innings.fallOfWickets) {
    const tag = overEntryFor(innings, w.oversCompleted + 1);
    if (tag && map.has(tag.ballNumber)) map.get(tag.ballNumber).wickets += 1;
  }
  return [...map.values()]
    .sort((a, b) => a.ballNumber - b.ballNumber)
    .map((e) => ({
      ...e,
      overs: ballsToOverString(e.ballsBowled),
      runRate: e.ballsBowled > 0 ? e.runs / ballsToOversDecimalForRR(e.ballsBowled) : 0,
    }));
}

/**
 * Partnerships derived from the fall-of-wicket log, named by the two batsmen
 * involved. Includes the current (unbroken) partnership - just shown as the
 * current stand, with no special "unbroken" label.
 */
export function partnerships(innings) {
  const fow = [...innings.fallOfWickets].sort((a, b) => a.wicketNumber - b.wicketNumber);
  const results = [];
  let prevScore = 0;
  let prevBalls = 0;
  fow.forEach((w) => {
    const balls = toBalls(w.oversCompleted, w.ball);
    const ballsFaced = Math.max(0, balls - prevBalls);
    const runs = w.score - prevScore;
    results.push({
      wicketNumber: w.wicketNumber,
      batsman1: w.batsman1,
      batsman2: w.batsman2,
      runs,
      balls: ballsFaced,
      fromOver: prevBalls === 0 ? '0.0' : ballsToOverString(prevBalls),
      toOver: ballsToOverString(balls),
      runRate: ballsFaced > 0 ? runs / ballsToOversDecimalForRR(ballsFaced) : 0,
      outBatsman: w.outBatsman,
      broken: true,
    });
    prevScore = w.score;
    prevBalls = balls;
  });

  const cur = currentScore(innings);
  if (!isInningsClosed(innings) && cur.wickets < 10 && cur.balls > 0) {
    const ballsFaced = Math.max(0, cur.balls - prevBalls);
    const runs = cur.runs - prevScore;
    results.push({
      wicketNumber: cur.wickets + 1,
      batsman1: innings.currentBatsmen[0] || 'Batsman 1',
      batsman2: innings.currentBatsmen[1] || 'Batsman 2',
      runs,
      balls: ballsFaced,
      fromOver: prevBalls === 0 ? '0.0' : ballsToOverString(prevBalls),
      toOver: cur.overString,
      runRate: ballsFaced > 0 ? runs / ballsToOversDecimalForRR(ballsFaced) : 0,
      outBatsman: '',
      broken: false,
    });
  }
  return results;
}

export function bestPartnership(innings) {
  const parts = partnerships(innings);
  if (parts.length === 0) return null;
  return parts.reduce((best, p) => (p.runs > best.runs ? p : best), parts[0]);
}

/** Which team-run milestones (multiples of `step`) were just crossed by an over, and aren't logged yet. */
export function crossedMilestones(prevRuns, newRuns, alreadyLogged, step = 50) {
  const logged = new Set(alreadyLogged.map((m) => m.milestone));
  const result = [];
  for (let t = step; t <= newRuns; t += step) {
    if (t > prevRuns && !logged.has(t)) result.push(t);
  }
  return result;
}

/** Pace to each team milestone, built entirely from user-confirmed ball data - no estimation. */
export function teamMilestones(innings) {
  const log = [...innings.milestonesLog].sort((a, b) => a.milestone - b.milestone);
  let prevBalls = 0;
  let prevValue = 0;
  return log.map((m) => {
    const balls = toBalls(m.oversCompleted, m.ball);
    const seg = balls - prevBalls;
    const runsSeg = m.milestone - prevValue;
    const row = {
      milestone: m.milestone,
      overs: ballsToOverString(balls),
      balls,
      ballsForSegment: seg,
      runRateForSegment: seg > 0 ? runsSeg / ballsToOversDecimalForRR(seg) : null,
    };
    prevBalls = balls;
    prevValue = m.milestone;
    return row;
  });
}

/** Follow-on margin per Laws of Cricket 14.1, keyed by scheduled match length in days. */
export function followOnThreshold(scheduledDays) {
  const table = { 1: 75, 2: 100, 3: 150, 4: 150, 5: 200 };
  return table[scheduledDays] || 200;
}

/** Session summary: runs/overs/wickets bowled within each day+session for one innings. */
export function sessionSummary(innings) {
  const overs = sortedOvers(innings);
  const map = new Map();
  for (const o of overs) {
    const key = `${o.day}-${o.session}`;
    if (!map.has(key)) map.set(key, { day: o.day, session: o.session, runs: 0, wickets: 0, ballsBowled: 0 });
    const entry = map.get(key);
    entry.runs += o.runs;
    entry.ballsBowled += 6;
  }
  for (const w of innings.fallOfWickets) {
    const tag = overEntryFor(innings, w.oversCompleted + 1);
    if (!tag) continue;
    const key = `${tag.day}-${tag.session}`;
    if (map.has(key)) map.get(key).wickets += 1;
  }
  return [...map.values()].map((e) => ({
    ...e,
    overs: ballsToOverString(e.ballsBowled),
    runRate: e.ballsBowled > 0 ? e.runs / ballsToOversDecimalForRR(e.ballsBowled) : 0,
  })).sort((a, b) => (a.day - b.day) || (SESSIONS.indexOf(a.session) - SESSIONS.indexOf(b.session)));
}

/** Match-wide session summary: runs/overs/wickets across ALL innings, grouped by day+session. */
export function matchSessionSummary(match) {
  const map = new Map();
  const ensure = (day, session) => {
    const key = `${day}-${session}`;
    if (!map.has(key)) map.set(key, { day, session, runs: 0, wickets: 0, ballsBowled: 0 });
    return map.get(key);
  };
  for (const innings of match.innings) {
    for (const o of sortedOvers(innings)) {
      const e = ensure(o.day, o.session);
      e.runs += o.runs;
      e.ballsBowled += 6;
    }
    for (const w of innings.fallOfWickets) {
      const tag = overEntryFor(innings, w.oversCompleted + 1);
      if (tag) ensure(tag.day, tag.session).wickets += 1;
    }
  }
  return [...map.values()].map((e) => ({
    ...e,
    overs: ballsToOverString(e.ballsBowled),
    oversDecimal: ballsToOversDecimalForRR(e.ballsBowled),
    runRate: e.ballsBowled > 0 ? e.runs / ballsToOversDecimalForRR(e.ballsBowled) : 0,
  })).sort((a, b) => (a.day - b.day) || (SESSIONS.indexOf(a.session) - SESSIONS.indexOf(b.session)));
}

/** How many innings started fresh during this day+session (excludes the very first innings of the match). */
export function inningsChangeCountForSession(match, day, session) {
  let count = 0;
  for (const innings of match.innings) {
    if (innings.number === 1) continue;
    const firstOver = sortedOvers(innings)[0];
    if (firstOver && firstOver.day === day && firstOver.session === session) count += 1;
  }
  return count;
}

export function sessionRecord(match, day, session) {
  return match.days.find((d) => d.dayNumber === day)?.sessions?.[session] || null;
}

/** Expected overs for a session: 30, minus 2 for every innings change that happened during it. */
export function expectedOversForSession(match, day, session) {
  return OVERS_PER_SESSION - 2 * inningsChangeCountForSession(match, day, session);
}

/** Expected overs for a day: sum of its sessions' expectations, skipping any marked fully lost. */
export function expectedOversForDay(match, day) {
  return SESSIONS.reduce((sum, session) => {
    const rec = sessionRecord(match, day, session);
    if (rec?.lost) return sum;
    return sum + expectedOversForSession(match, day, session);
  }, 0);
}

/** Day-by-day summary aggregated across ALL innings that had overs bowled that day. */
export function daySummaries(match) {
  const byDay = new Map();
  for (const innings of match.innings) {
    for (const o of sortedOvers(innings)) {
      if (!byDay.has(o.day)) byDay.set(o.day, { day: o.day, runs: 0, wickets: 0, ballsBowled: 0, inningsTouched: new Set() });
      const d = byDay.get(o.day);
      d.runs += o.runs;
      d.ballsBowled += 6;
      d.inningsTouched.add(innings.number);
    }
    for (const w of innings.fallOfWickets) {
      const tag = overEntryFor(innings, w.oversCompleted + 1);
      if (tag && byDay.has(tag.day)) byDay.get(tag.day).wickets += 1;
    }
  }
  return [...byDay.values()]
    .sort((a, b) => a.day - b.day)
    .map((d) => ({
      day: d.day,
      runs: d.runs,
      wickets: d.wickets,
      overs: ballsToOverString(d.ballsBowled),
      oversDecimal: ballsToOversDecimalForRR(d.ballsBowled),
      runRate: d.ballsBowled > 0 ? d.runs / ballsToOversDecimalForRR(d.ballsBowled) : 0,
      inningsNumbers: [...d.inningsTouched].sort(),
    }));
}

/**
 * Relative match state for one innings (1-4): who's ahead, by how much, and
 * wickets remaining - the "lead by / trail by / require" line used both on
 * the Scorecard's 4-row summary and the live status banner.
 */
export function inningsRelativeState(match, inningsNumber) {
  const inn = match.innings.find((i) => i.number === inningsNumber);
  if (!inn) return null;
  const team = battingSideForInnings(match, inningsNumber);
  const sc = currentScore(inn);
  const wicketsRemaining = 10 - sc.wickets;

  if (inningsNumber === 1) {
    return { team, verb: 'lead', amount: sc.runs, wicketsRemaining, sc };
  }
  if (inningsNumber === 2) {
    const i1 = match.innings.find((i) => i.number === 1);
    const diff = sc.runs - currentScore(i1).runs;
    return { team, verb: diff >= 0 ? 'lead' : 'trail', amount: Math.abs(diff), wicketsRemaining, sc };
  }
  if (inningsNumber === 3) {
    const i1 = match.innings.find((i) => i.number === 1);
    const i2 = match.innings.find((i) => i.number === 2);
    const teamFirstInnings = battingSideForInnings(match, 1) === team ? i1 : i2;
    const oppInnings = teamFirstInnings === i1 ? i2 : i1;
    const battingCombined = currentScore(teamFirstInnings).runs + sc.runs;
    const oppTotal = currentScore(oppInnings).runs;
    const diff = battingCombined - oppTotal;
    return { team, verb: diff >= 0 ? 'lead' : 'trail', amount: Math.abs(diff), wicketsRemaining, sc };
  }
  if (inningsNumber === 4) {
    const i3 = match.innings.find((i) => i.number === 3);
    if (!i3) return null;
    const battingSideI3 = battingSideForInnings(match, 3);
    const bowlingSideI3 = oppositeSide(battingSideI3);
    const i1 = match.innings.find((i) => i.number === 1);
    const i2 = match.innings.find((i) => i.number === 2);
    const i3TeamFirst = battingSideForInnings(match, 1) === battingSideI3 ? i1 : i2;
    const oppFirst = i3TeamFirst === i1 ? i2 : i1;
    const battingCombined = currentScore(i3TeamFirst).runs + currentScore(i3).runs;
    const bowlingTotal = currentScore(oppFirst).runs;
    const target = battingCombined - bowlingTotal + 1;
    const runsRequired = Math.max(0, target - sc.runs);
    return { team, verb: 'require', amount: runsRequired, wicketsRemaining, sc, target };
  }
  return null;
}

/**
 * Generates a human-readable match status sentence. A manual override
 * (match.result.manualNote) always wins, for cases like "drawn - stumps,
 * day 5" that the auto-logic can't infer on its own.
 */
export function matchStatusText(match) {
  if (match.result?.manualNote) return match.result.manualNote;

  const i1 = match.innings.find((i) => i.number === 1);
  const i2 = match.innings.find((i) => i.number === 2);
  const i3 = match.innings.find((i) => i.number === 3);
  const i4 = match.innings.find((i) => i.number === 4);
  const teamOf = (side) => teamName(match, side);

  if (!i1 || totalBalls(i1) === 0) return 'Match not started';

  if (!isInningsClosed(i1)) {
    const st = inningsRelativeState(match, 1);
    return `${teamOf(st.team)} lead by ${st.amount} with ${st.wicketsRemaining} wickets remaining (${st.sc.overString} ov) in the 1st innings`;
  }

  if (!i2 || totalBalls(i2) === 0) {
    const side1 = battingSideForInnings(match, 1);
    return `${teamOf(side1)} finished on ${currentScore(i1).runs}/${currentScore(i1).wickets}; ${teamOf(oppositeSide(side1))} yet to bat`;
  }

  if (!isInningsClosed(i2)) {
    const st = inningsRelativeState(match, 2);
    return `${teamOf(st.team)} ${st.verb} by ${st.amount} with ${st.wicketsRemaining} wickets remaining (${st.sc.overString} ov) in the 2nd innings`;
  }

  if (!i3 || totalBalls(i3) === 0) {
    const side1 = battingSideForInnings(match, 1);
    const leadAfter2 = currentScore(i1).runs - currentScore(i2).runs;
    const leaderSide = leadAfter2 >= 0 ? side1 : oppositeSide(side1);
    const trailSide = oppositeSide(leaderSide);
    const threshold = followOnThreshold(match.scheduledDays);
    let note = '';
    if (Math.abs(leadAfter2) >= threshold && leaderSide === side1) {
      note = ` (follow-on available, lead ≥ ${threshold})`;
    }
    return `${teamOf(leaderSide)} lead by ${Math.abs(leadAfter2)} runs after two innings; ${teamOf(trailSide)} to bat again${note}`;
  }

  if (!isInningsClosed(i3)) {
    const st = inningsRelativeState(match, 3);
    return `${teamOf(st.team)} ${st.verb} by ${st.amount} with ${st.wicketsRemaining} wickets remaining (${st.sc.overString} ov) in the 3rd innings`;
  }

  const battingSideI3 = battingSideForInnings(match, 3);
  const bowlingSideI3 = oppositeSide(battingSideI3);
  const i3TeamFirst = battingSideForInnings(match, 1) === battingSideI3 ? i1 : i2;
  const oppFirst = i3TeamFirst === i1 ? i2 : i1;
  const battingCombined = currentScore(i3TeamFirst).runs + currentScore(i3).runs;
  const bowlingTotal = currentScore(oppFirst).runs;

  if (battingCombined <= bowlingTotal) {
    const margin = bowlingTotal - battingCombined;
    return margin === 0
      ? `Scores level - ${teamOf(bowlingSideI3)} win by an innings on first-innings countback (check local rules)`
      : `${teamOf(bowlingSideI3)} won by an innings and ${margin} runs!`;
  }

  const target = battingCombined - bowlingTotal + 1;
  if (!i4 || totalBalls(i4) === 0) {
    return `${teamOf(bowlingSideI3)} require ${target} runs to win`;
  }

  const sc4 = currentScore(i4);
  const battingSideI4 = battingSideForInnings(match, 4);
  if (sc4.runs >= target) {
    return `${teamOf(battingSideI4)} won by ${10 - sc4.wickets} wickets!`;
  }
  if (sc4.wickets >= 10) {
    return `${teamOf(battingSideI3)} won by ${target - 1 - sc4.runs} runs!`;
  }
  const st4 = inningsRelativeState(match, 4);
  return `${teamOf(st4.team)} require ${st4.amount} more runs to win with ${st4.wicketsRemaining} wickets remaining (${sc4.overString} ov)`;
}

/** Required run rate for the team batting 4th, if a target has been set (i3 closed). */
export function requiredRunRate(match, oversRemainingToday) {
  const i3 = match.innings.find((i) => i.number === 3);
  const i4 = match.innings.find((i) => i.number === 4);
  if (!i3 || !isInningsClosed(i3) || !i4) return null;
  const st4 = inningsRelativeState(match, 4);
  if (!st4 || st4.amount <= 0 || !oversRemainingToday || oversRemainingToday <= 0) return null;
  return st4.amount / oversRemainingToday;
}

/** Cross-innings comparison of partnerships by wicket number, for the top-level Partnerships tab. */
export function partnershipsComparison(match) {
  const rows = [];
  for (let w = 1; w <= 10; w++) {
    const cells = match.innings.map((inn) => {
      const p = partnerships(inn).find((p) => p.wicketNumber === w);
      return p ? { runs: p.runs, balls: p.balls, runRate: p.runRate, broken: p.broken } : null;
    });
    if (cells.every((c) => c === null)) continue;
    rows.push({ wicket: w, cells });
  }
  return rows;
}

/** Cross-innings comparison of team milestones, for the top-level Milestones tab. */
export function milestonesComparison(match) {
  const values = new Set();
  match.innings.forEach((inn) => inn.milestonesLog.forEach((m) => values.add(m.milestone)));
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.map((milestone) => ({
    milestone,
    cells: match.innings.map((inn) => {
      const m = inn.milestonesLog.find((x) => x.milestone === milestone);
      if (!m) return null;
      const balls = toBalls(m.oversCompleted, m.ball);
      return { overs: ballsToOverString(balls), balls };
    }),
  }));
}

export { battingSideForInnings, bowlingSideForInnings, oppositeSide };
