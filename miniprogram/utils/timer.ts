import type { ActiveSession, PauseSegment } from "../types/models";

function getPausedMs(segments: PauseSegment[]) {
  return segments.reduce((sum, segment) => {
    return sum + (new Date(segment.endedAt).getTime() - new Date(segment.startedAt).getTime());
  }, 0);
}

export function getElapsedMs(session: ActiveSession, now = new Date()) {
  const start = new Date(session.startedAt).getTime();
  const paused = getPausedMs(session.pauseSegments);
  const currentPause =
    session.status === "paused" && session.currentPauseStartedAt
      ? now.getTime() - new Date(session.currentPauseStartedAt).getTime()
      : 0;
  return Math.max(0, now.getTime() - start - paused - currentPause);
}

export function formatStopwatch(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
