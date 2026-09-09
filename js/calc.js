// Pure calculation functions over the match/innings data model.
// Nothing here touches the DOM or storage - keeps this testable & reusable.

import { toBalls, ballsToOverString, ballsToOversDecimalForRR, teamName } from './model.js';

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
  const wickets = overs.reduce((sum, o) => sum + o.wickets, 0);
  const balls = overs.length * 6;
  return {
    runs,
    wickets: Math.min(wickets, 10),
    balls,
    overString: ballsToOverString(balls),
    runRate: balls > 0 ? runs / ballsToOversDecimalForRR(balls) : 0,
  };
}

export function isInningsClosed(innings) {
  if (!innings) return false;
  const { wickets } = currentScore(innings);
  return innings.declared || wickets >= 10;
}

export function oppositeSide(side) {
  return side === 'home' ? 'away' : 'home';
}

/** Running cumulative series, one point per completed over - used for charts/milestones. */
export function cumulativeSeries(innings) {
  const overs = sortedOvers(innings);
  let runs = 0;
  let wickets = 0;
  return overs.map((o) => {
    runs += o.runs;
    wickets += o.wickets;
    return { overNumber: o.overNumber, runs, wickets: Math.min(wickets, 10), day: o.day, session: o.session, bowler: o.bowler, runsThisOver: o.runs, wicketsThisOver: o.wickets };
  });
}

/**
 * Partnerships derived from the fall-of-wicket log.
 * Includes the current unbroken partnership (if innings not closed and wickets < 10).
 */
export function partnerships(innings) {
  const fow = [...innings.fallOfWickets].sort((a, b) => a.wicketNumber - b.wicketNumber);
  const results = [];
  let prevScore = 0;
  let prevBalls = 0;
  fow.forEach((w, idx) => {
    const balls = toBalls(w.oversCompleted, w.ball);
    results.push({
      wicketNumber: w.wicketNumber,
      runs: w.score - prevScore,
      balls: Math.max(0, balls - prevBalls),
      fromOver: prevBalls === 0 ? '0.0' : ballsToOverString(prevBalls),
      toOver: ballsToOverString(balls),
      batsmanOut: w.batsmanOut,
      howOut: w.howOut,
      bowler: w.bowler,
      fielder: w.fielder,
      complete: true,
    });
    prevScore = w.score;
    prevBalls = balls;
  });

  const cur = currentScore(innings);
  if (!isInningsClosed(innings) && cur.wickets < 10 && cur.balls > 0) {
    results.push({
      wicketNumber: cur.wickets + 1,
      runs: cur.runs - prevScore,
      balls: Math.max(0, cur.balls - prevBalls),
      fromOver: prevBalls === 0 ? '0.0' : ballsToOverString(prevBalls),
      toOver: cur.overString,
      batsmanOut: '',
      howOut: '',
      bowler: '',
      fielder: '',
      complete: false, // still batting - "unbroken" partnership
    });
  }
  return results;
}

export function bestPartnership(innings) {
  const parts = partnerships(innings);
  if (parts.length === 0) return null;
  return parts.reduce((best, p) => (p.runs > best.runs ? p : best), parts[0]);
}

/**
 * Pace to team milestones (every `step` runs, default 50): interpolates the ball
 * within the over the milestone was reached, assuming runs are spread evenly
 * across that over's six balls (an approximation - it's not ball-by-ball data).
 */
export function teamMilestones(innings, step = 50) {
  const series = cumulativeSeries(innings);
  const milestones = [];
  let nextTarget = step;
  let prevRuns = 0;
  let prevBalls = 0;
  let prevMilestoneBalls = 0;

  for (const point of series) {
    while (point.runs >= nextTarget) {
      const runsThisOver = point.runsThisOver || 1;
      const overStartRuns = point.runs - runsThisOver;
      const runsIntoOver = Math.max(0, nextTarget - overStartRuns);
      const fraction = Math.min(1, runsIntoOver / runsThisOver);
      const ballsIntoOver = Math.max(1, Math.round(fraction * 6));
      const ballsAtMilestone = (point.overNumber - 1) * 6 + ballsIntoOver;
      milestones.push({
        milestone: nextTarget,
        overs: ballsToOverString(ballsAtMilestone),
        balls: ballsAtMilestone,
        ballsForSegment: ballsAtMilestone - prevMilestoneBalls,
        runRateForSegment: ballsAtMilestone > prevMilestoneBalls
          ? step / ballsToOversDecimalForRR(ballsAtMilestone - prevMilestoneBalls)
          : null,
      });
      prevMilestoneBalls = ballsAtMilestone;
      nextTarget += step;
    }
    prevRuns = point.runs;
    prevBalls = point.overNumber * 6;
  }
  return milestones;
}

/** Follow-on margin per Laws of Cricket 14.1, keyed by scheduled match length in days. */
export function followOnThreshold(scheduledDays) {
  const table = { 1: 75, 2: 100, 3: 150, 4: 150, 5: 200 };
  return table[scheduledDays] || 200;
}

/** Session summary: runs/overs/wickets bowled within each day+session for one innings. */
export function sessionSummary(innings) {
  const overs = sortedOvers(innings);
  const map = new Map(); // key `${day}-${session}` -> {day, session, runs, wickets, ballsBowled}
  for (const o of overs) {
    const key = `${o.day}-${o.session}`;
    if (!map.has(key)) map.set(key, { day: o.day, session: o.session, runs: 0, wickets: 0, ballsBowled: 0 });
    const entry = map.get(key);
    entry.runs += o.runs;
    entry.wickets += o.wickets;
    entry.ballsBowled += 6;
  }
  return [...map.values()].map((e) => ({
    ...e,
    overs: ballsToOverString(e.ballsBowled),
    runRate: e.ballsBowled > 0 ? e.runs / ballsToOversDecimalForRR(e.ballsBowled) : 0,
  })).sort((a, b) => (a.day - b.day) || (['morning', 'afternoon', 'evening'].indexOf(a.session) - ['morning', 'afternoon', 'evening'].indexOf(b.session)));
}

/** Day-by-day summary aggregated across ALL innings that had overs bowled that day. */
export function daySummaries(match) {
  const byDay = new Map();
  for (const innings of match.innings) {
    for (const o of sortedOvers(innings)) {
      if (!byDay.has(o.day)) byDay.set(o.day, { day: o.day, runs: 0, wickets: 0, ballsBowled: 0, inningsTouched: new Set() });
      const d = byDay.get(o.day);
      d.runs += o.runs;
      d.wickets += o.wickets;
      d.ballsBowled += 6;
      d.inningsTouched.add(innings.number);
    }
  }
  return [...byDay.values()]
    .sort((a, b) => a.day - b.day)
    .map((d) => ({
      day: d.day,
      runs: d.runs,
      wickets: d.wickets,
      overs: ballsToOverString(d.ballsBowled),
      runRate: d.ballsBowled > 0 ? d.runs / ballsToOversDecimalForRR(d.ballsBowled) : 0,
      inningsNumbers: [...d.inningsTouched].sort(),
    }));
}

function s(innings) {
  return currentScore(innings);
}

/**
 * Generates a human-readable match status sentence, mirroring the spreadsheet's
 * MatchStatus logic but generalised to work whichever way the follow-on falls.
 * A manual override (match.result.manualNote) always wins, for cases like
 * "drawn - stumps, day 5" that the auto-logic can't infer on its own.
 */
export function matchStatusText(match) {
  if (match.result?.manualNote) return match.result.manualNote;

  const byNum = {};
  match.innings.forEach((i) => { byNum[i.number] = i; });
  const i1 = byNum[1], i2 = byNum[2], i3 = byNum[3], i4 = byNum[4];
  const teamOf = (side) => teamName(match, side);

  if (!i1 || totalBalls(i1) === 0) return 'Match not started';

  if (!isInningsClosed(i1)) {
    const sc = s(i1);
    return `${teamOf(i1.battingTeam)} are ${sc.runs}/${sc.wickets} (${sc.overString} ov) in the 1st innings`;
  }

  if (!i2 || totalBalls(i2) === 0) {
    return `${teamOf(i1.battingTeam)} finished on ${s(i1).runs}/${s(i1).wickets}; ${teamOf(oppositeSide(i1.battingTeam))} yet to bat`;
  }

  if (!isInningsClosed(i2)) {
    const sc = s(i2);
    const diff = sc.runs - s(i1).runs;
    const rel = diff >= 0 ? 'lead' : 'trail';
    return `${teamOf(i2.battingTeam)} ${rel} by ${Math.abs(diff)} runs with ${10 - sc.wickets} wickets remaining in the 2nd innings (${sc.overString} ov)`;
  }

  const leadAfter2 = s(i1).runs - s(i2).runs;
  if (!i3 || totalBalls(i3) === 0) {
    const leaderSide = leadAfter2 >= 0 ? i1.battingTeam : i2.battingTeam;
    const trailSide = oppositeSide(leaderSide);
    const threshold = followOnThreshold(match.scheduledDays);
    let note = '';
    if (Math.abs(leadAfter2) >= threshold && leaderSide === i1.battingTeam) {
      note = ` (follow-on available, lead ≥ ${threshold})`;
    }
    return `${teamOf(leaderSide)} lead by ${Math.abs(leadAfter2)} runs after two innings; ${teamOf(trailSide)} to bat again${note}`;
  }

  if (!isInningsClosed(i3)) {
    const battingSide = i3.battingTeam;
    const bowlingSide = oppositeSide(battingSide);
    const oppTotal = bowlingSide === i1.battingTeam ? s(i1).runs : s(i2).runs;
    const battingCombinedSoFar = (battingSide === i1.battingTeam ? s(i1).runs : s(i2).runs) + s(i3).runs;
    const diff = battingCombinedSoFar - oppTotal;
    const rel = diff >= 0 ? 'lead' : 'trail';
    const sc = s(i3);
    return `${teamOf(battingSide)} ${rel} by ${Math.abs(diff)} runs with ${10 - sc.wickets} wickets remaining in the 3rd innings (${sc.overString} ov)`;
  }

  const battingSideI3 = i3.battingTeam;
  const bowlingSideI3 = oppositeSide(battingSideI3);
  const battingCombined = (battingSideI3 === i1.battingTeam ? s(i1).runs : s(i2).runs) + s(i3).runs;
  const bowlingTotal = bowlingSideI3 === i1.battingTeam ? s(i1).runs : s(i2).runs;

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

  const sc4 = s(i4);
  if (sc4.runs >= target) {
    return `${teamOf(i4.battingTeam)} won by ${10 - sc4.wickets} wickets!`;
  }
  if (sc4.wickets >= 10) {
    return `${teamOf(battingSideI3)} won by ${target - 1 - sc4.runs} runs!`;
  }
  return `${teamOf(i4.battingTeam)} require ${target - sc4.runs} more runs to win with ${10 - sc4.wickets} wickets remaining (${sc4.overString} ov)`;
}

/** Required run rate for the team batting 4th, if a target has been set (i3 closed). */
export function requiredRunRate(match, oversRemainingToday) {
  const byNum = {};
  match.innings.forEach((i) => { byNum[i.number] = i; });
  const i1 = byNum[1], i2 = byNum[2], i3 = byNum[3], i4 = byNum[4];
  if (!i1 || !i2 || !i3 || !isInningsClosed(i3) || !i4) return null;
  const battingSideI3 = i3.battingTeam;
  const bowlingSideI3 = oppositeSide(battingSideI3);
  const battingCombined = (battingSideI3 === i1.battingTeam ? s(i1).runs : s(i2).runs) + s(i3).runs;
  const bowlingTotal = bowlingSideI3 === i1.battingTeam ? s(i1).runs : s(i2).runs;
  const target = battingCombined - bowlingTotal + 1;
  const sc4 = s(i4);
  const runsNeeded = target - sc4.runs;
  if (runsNeeded <= 0 || !oversRemainingToday || oversRemainingToday <= 0) return null;
  return runsNeeded / oversRemainingToday;
}
