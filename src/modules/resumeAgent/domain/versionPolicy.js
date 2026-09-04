export function canCreateResumeVersion({ changeCount, scoreBefore, scoreAfter }) {
  const before = Number(scoreBefore?.overall);
  const after = Number(scoreAfter?.overall);
  return Number(changeCount) > 0
    && Number.isFinite(before)
    && Number.isFinite(after)
    && after >= before;
}
