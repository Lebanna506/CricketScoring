// Data model factories and cricket over/ball helpers for Test match scoring.

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const SESSIONS = ['morning', 'afternoon', 'evening'];
export const OVERS_PER_SESSION = 30;

export function oppositeSide(side) {
  return side === 'home' ? 'away' : 'home';
}

/** Convert (completed overs, ball) -> total legal balls bowled. ball is 1-6. */
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

/** Parse a user-typed "10.4" style string into { oversCompleted, ball }. */
export function parseOverBall(str) {
  const s = String(str ?? '').trim();
  const [wholePart, ballPart] = s.split('.');
  const oversCompleted = Math.max(0, parseInt(wholePart, 10) || 0);
  const ball = Math.max(0, Math.min(6, parseInt(ballPart, 10) || 0));
  return { oversCompleted, ball };
}

export function emptySessionRecord() {
  return { lostMinutes: 0, lost: false };
}

export function newMatch({ homeTeam, awayTeam, venue, startDate, scheduledDays }) {
  const days = [];
  for (let i = 1; i <= (scheduledDays || 5); i++) {
    days.push({
      dayNumber: i,
      date: null,
      sessions: { morning: emptySessionRecord(), afternoon: emptySessionRecord(), evening: emptySessionRecord() },
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
    currentSession: { day: 1, session: 'morning' },
    result: { status: 'in_progress', text: '', winner: null, manualNote: '' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function advanceSession({ day, session }) {
  const idx = SESSIONS.indexOf(session);
  if (idx === SESSIONS.length - 1) return { day: day + 1, session: SESSIONS[0] };
  return { day, session: SESSIONS[idx + 1] };
}

/**
 * Determine which side bats in a given innings (1-4), derived fresh every time
 * from the toss and any follow-on decision - never cached on the innings
 * object, so editing the toss later is reflected everywhere immediately.
 */
export function battingSideForInnings(match, inningsNumber, { followOnOverride } = {}) {
  const { wonBy, decision } = match.toss;
  if (!wonBy || !decision) return null;
  const firstBat = decision === 'bat' ? wonBy : oppositeSide(wonBy);
  const secondBat = oppositeSide(firstBat);
  const i3 = match.innings.find((i) => i.number === 3);
  const enforcedFollowOn = followOnOverride !== undefined ? followOnOverride : !!(i3 && i3.followOn);
  if (inningsNumber === 1) return firstBat;
  if (inningsNumber === 2) return secondBat;
  if (inningsNumber === 3) return enforcedFollowOn ? secondBat : firstBat;
  if (inningsNumber === 4) return enforcedFollowOn ? firstBat : secondBat;
  return null;
}

export function bowlingSideForInnings(match, inningsNumber, opts) {
  const side = battingSideForInnings(match, inningsNumber, opts);
  return side ? oppositeSide(side) : null;
}

/** How many times has this innings' batting team batted, including this innings - i.e. "1st"/"2nd". */
export function inningsOrdinalForTeam(match, inningsNumber) {
  const team = battingSideForInnings(match, inningsNumber);
  if (!team) return 1;
  let count = 0;
  for (let n = 1; n <= inningsNumber; n++) {
    if (battingSideForInnings(match, n) === team) count += 1;
  }
  return count;
}

export function newInnings(match, number, { followOn = false } = {}) {
  return {
    number,
    declared: false,
    followOn,
    overs: [], // { id, overNumber, runs, day, session, ballNumber }
    fallOfWickets: [], // { id, wicketNumber, oversCompleted, ball, score, batsman1, batsman2, outBatsman, inBatsman }
    milestonesLog: [], // { milestone, oversCompleted, ball } - confirmed by the user when crossed
    currentBatsmen: ['', ''],
    currentBallNumber: 1, // a new ball starts every innings
  };
}

export function newOverEntry({ overNumber, runs, day, session, ballNumber }) {
  return {
    id: uid('over'),
    overNumber,
    runs: Number(runs) || 0,
    day: day || 1,
    session: session || 'morning',
    ballNumber: ballNumber || 1,
  };
}

export function newFowEntry({ wicketNumber, oversCompleted, ball, score, batsman1, batsman2, outBatsman, inBatsman }) {
  return {
    id: uid('fow'),
    wicketNumber,
    // oversCompleted follows standard cricket over notation: the number of
    // FULL overs bowled before this ball (so a wicket on the 4th ball of the
    // 6th over is oversCompleted=5, ball=4, written "5.4").
    oversCompleted: Number(oversCompleted) || 0,
    ball: Number(ball) || 0,
    score: Number(score) || 0,
    batsman1: batsman1 || '',
    batsman2: batsman2 || '',
    outBatsman: outBatsman || '',
    inBatsman: inBatsman || '',
  };
}

export function teamName(match, side) {
  return side === 'home' ? match.homeTeam : side === 'away' ? match.awayTeam : '';
}

/**
 * Bring a match object loaded from storage/a file up to the current schema,
 * filling in any fields that didn't exist in earlier versions of the app
 * (e.g. matches saved before the Innings-tab rewrite). Safe to call on an
 * already-current match - it's a no-op in that case.
 */
export function normalizeMatch(match) {
  if (!match || typeof match !== 'object') return match;

  match.lineups = match.lineups || { home: [], away: [] };
  match.lineups.home = match.lineups.home || [];
  match.lineups.away = match.lineups.away || [];
  match.result = match.result || { status: 'in_progress', text: '', winner: null, manualNote: '' };
  match.currentSession = match.currentSession && match.currentSession.day
    ? match.currentSession
    : { day: 1, session: 'morning' };

  match.days = (match.days || []).map((d) => ({
    dayNumber: d.dayNumber,
    date: d.date ?? null,
    sessions: d.sessions ? {
      morning: normalizeSessionRecord(d.sessions.morning),
      afternoon: normalizeSessionRecord(d.sessions.afternoon),
      evening: normalizeSessionRecord(d.sessions.evening),
    } : {
      // Earlier versions stored a single "minutes lost" number per session
      // (under `weather`) instead of {lostMinutes, lost}.
      morning: normalizeSessionRecord(d.weather?.morning),
      afternoon: normalizeSessionRecord(d.weather?.afternoon),
      evening: normalizeSessionRecord(d.weather?.evening),
    },
  }));

  match.innings = (match.innings || []).map(normalizeInnings);

  return match;
}

function normalizeSessionRecord(value) {
  if (value && typeof value === 'object') {
    return { lostMinutes: Number(value.lostMinutes) || 0, lost: !!value.lost };
  }
  if (typeof value === 'number') return { lostMinutes: value, lost: false };
  return emptySessionRecord();
}

function normalizeInnings(inn) {
  return {
    number: inn.number,
    declared: !!inn.declared,
    followOn: !!inn.followOn,
    overs: (inn.overs || []).map((o, idx) => ({
      id: o.id || uid('over'),
      overNumber: o.overNumber ?? idx + 1,
      runs: Number(o.runs) || 0,
      day: o.day || 1,
      session: o.session || 'morning',
      ballNumber: o.ballNumber || 1,
    })),
    fallOfWickets: (inn.fallOfWickets || []).map(normalizeFow),
    milestonesLog: inn.milestonesLog || [],
    currentBatsmen: Array.isArray(inn.currentBatsmen) && inn.currentBatsmen.length === 2
      ? inn.currentBatsmen
      : ['', ''],
    currentBallNumber: inn.currentBallNumber || 1,
  };
}

function normalizeFow(w, idx) {
  return {
    id: w.id || uid('fow'),
    wicketNumber: w.wicketNumber ?? idx + 1,
    oversCompleted: w.oversCompleted ?? w.overNumber ?? 0,
    ball: Number(w.ball) || 0,
    score: Number(w.score) || 0,
    batsman1: w.batsman1 || '',
    batsman2: w.batsman2 || '',
    // Earlier versions called this field batsmanOut.
    outBatsman: w.outBatsman || w.batsmanOut || '',
    inBatsman: w.inBatsman || '',
  };
}
