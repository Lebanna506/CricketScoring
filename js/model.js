// Data model factories and cricket over/ball helpers for Test match scoring.

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const SESSIONS = ['morning', 'afternoon', 'evening'];

/** Convert (overs, ball) -> total legal balls bowled. ball is 1-6. */
export function toBalls(overs, ball) {
  return overs * 6 + (ball || 0);
}

/** Convert total legal balls -> cricket over notation string e.g. 145 -> "24.1" */
export function ballsToOverString(balls) {
  const overs = Math.floor(balls / 6);
  const rem = balls % 6;
  return rem === 0 ? `${overs}.0` : `${overs}.${rem}`;
}

export function ballsToOversDecimalForRR(balls) {
  // Run-rate uses true decimal overs (balls/6), not cricket notation.
  return balls / 6;
}

export function newMatch({ homeTeam, awayTeam, venue, startDate, scheduledDays }) {
  const days = [];
  for (let i = 1; i <= (scheduledDays || 5); i++) {
    days.push({
      dayNumber: i,
      date: null,
      weather: { morning: 0, afternoon: 0, evening: 0 },
    });
  }
  return {
    id: uid('match'),
    format: 'test',
    homeTeam: homeTeam || 'Home',
    awayTeam: awayTeam || 'Away',
    venue: venue || '',
    startDate: startDate || null,
    scheduledDays: scheduledDays || 5,
    toss: { wonBy: null, decision: null },
    lineups: { home: [], away: [] },
    innings: [],
    days,
    result: { status: 'in_progress', text: '', winner: null, manualNote: '' },
    activeInningsIndex: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Determine batting/bowling team for a given innings number (1-4) based on toss.
 * side that batted 1st = winner of toss's choice (or the other side if they chose to bowl).
 */
export function battingSideForInnings(match, inningsNumber) {
  const { wonBy, decision } = match.toss;
  if (!wonBy || !decision) return null;
  const firstBat = decision === 'bat' ? wonBy : (wonBy === 'home' ? 'away' : 'home');
  const secondBat = firstBat === 'home' ? 'away' : 'home';
  // innings 1 & 3 batted by firstBat, 2 & 4 by secondBat, UNLESS follow-on flips 3rd innings.
  const followOnInnings1 = match.innings.find((i) => i.number === 1);
  const enforcedFollowOn = match.innings.some((i) => i.number === 3 && i.followOn);
  if (inningsNumber === 1) return firstBat;
  if (inningsNumber === 2) return secondBat;
  if (inningsNumber === 3) return enforcedFollowOn ? secondBat : firstBat;
  if (inningsNumber === 4) return enforcedFollowOn ? firstBat : secondBat;
  return null;
}

export function newInnings(match, number, { followOn = false } = {}) {
  const battingTeam = battingSideForInnings({ ...match, innings: [...match.innings, { number, followOn }] }, number);
  const bowlingTeam = battingTeam === 'home' ? 'away' : 'home';
  return {
    number,
    battingTeam,
    bowlingTeam,
    declared: false,
    allOut: false,
    followOn,
    overs: [], // { overNumber, runs, wickets, extras, day, session, bowler }
    fallOfWickets: [], // { wicketNumber, over, ball, score, batsmanOut, howOut, bowler, fielder }
  };
}

export function newOverEntry({ overNumber, runs, wickets, extras, day, session, bowler }) {
  return {
    id: uid('over'),
    overNumber,
    runs: Number(runs) || 0,
    wickets: Number(wickets) || 0,
    extras: Number(extras) || 0,
    day: day || 1,
    session: session || 'morning',
    bowler: bowler || '',
  };
}

export function newFowEntry({ wicketNumber, oversCompleted, ball, score, batsmanOut, howOut, bowler, fielder }) {
  return {
    id: uid('fow'),
    wicketNumber,
    // oversCompleted follows standard cricket over notation: the number of
    // FULL overs bowled before this ball (so a wicket on the 4th ball of the
    // 6th over is oversCompleted=5, ball=4, written "5.4").
    oversCompleted: Number(oversCompleted) || 0,
    ball: Number(ball) || 0,
    score: Number(score) || 0,
    batsmanOut: batsmanOut || '',
    howOut: howOut || '',
    bowler: bowler || '',
    fielder: fielder || '',
  };
}

export function teamName(match, side) {
  return side === 'home' ? match.homeTeam : side === 'away' ? match.awayTeam : '';
}
