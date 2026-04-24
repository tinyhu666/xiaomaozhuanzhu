import { resolveAvatarUrlMap } from "../avatar-storage";
import { addShanghaiDays } from "../domain/date-utils";
import { buildDayContributions } from "../domain/stats";
import type { StorageClient } from "../storage/default-storage";
import type { DataStore } from "../store/types";
import type { DailyStat, PublicProfileSettings, SessionPhoto, StudySession, User } from "../types";

export type AdminUserSummary = {
  userId: string;
  openid: string;
  nickname: string;
  avatarUrl: string;
  profileCompleted: boolean;
  lastLoginAt: string;
  latestCheckinDate: string | null;
  recentCheckinDays: number;
  recentUploadCount: number;
};

export type AdminPhotoPreview = SessionPhoto & {
  tempUrl: string;
};

export type AdminSessionPreview = {
  id: string;
  summary: string;
  subjects: StudySession["subjects"];
  tags: StudySession["tags"];
  startedAt: string;
  endedAt: string | null;
  totalMinutes: number;
  photos: AdminPhotoPreview[];
};

export type AdminDayGroup = {
  date: string;
  totalMinutes: number;
  sessionCount: number;
  uploadCount: number;
  sessions: AdminSessionPreview[];
};

export type AdminSelectedUser = {
  userId: string;
  openid: string;
  nickname: string;
  avatarUrl: string;
  profileCompleted: boolean;
  lastLoginAt: string;
  publicProfile: PublicProfileSettings | null;
  recentDays: AdminDayGroup[];
};

export type AdminDateUserRow = {
  userId: string;
  openid: string;
  nickname: string;
  avatarUrl: string;
  totalMinutes: number;
  sessionCount: number;
  uploadCount: number;
  sessions: AdminSessionPreview[];
};

type SessionContext = {
  session: StudySession;
  contributions: Map<string, number>;
  photos: SessionPhoto[];
};

export async function buildAdminUserSummaries(
  store: DataStore,
  storage: StorageClient,
  todayKey: string,
  rangeDays: number,
  search: string
) {
  const recentDateSet = new Set(buildRecentDateKeys(todayKey, rangeDays));
  const normalizedSearch = search.trim().toLowerCase();
  const users = await store.listUsers();
  const avatarUrlByUserId = await resolveAvatarUrlMap(users, storage);

  const summaries = await Promise.all(
    users.map(async (user) => {
      const sessions = await store.listSessions(user.id);
      const completed = sessions.filter((session) => session.status === "completed");
      const dailyStats = await store.getDailyStats(user.id);
      const latestCheckinDate = [...dailyStats.keys()].sort().at(-1) ?? null;
      const recentCheckinDays = [...dailyStats.values()].filter(
        (stat) => recentDateSet.has(stat.date) && stat.totalMinutes > 0
      ).length;

      let recentUploadCount = 0;
      for (const session of completed) {
        const contributions = buildDayContributions(session);
        if (![...contributions.keys()].some((date) => recentDateSet.has(date))) {
          continue;
        }
        recentUploadCount += (await store.getPhotosBySessionId(session.id)).length;
      }

      return {
        userId: user.id,
        openid: user.openid,
        nickname: user.nickname,
        avatarUrl: avatarUrlByUserId.get(user.id) ?? "",
        profileCompleted: user.profileCompleted,
        lastLoginAt: user.lastLoginAt,
        latestCheckinDate,
        recentCheckinDays,
        recentUploadCount
      } satisfies AdminUserSummary;
    })
  );

  return summaries
    .filter((summary) => {
      if (!normalizedSearch) {
        return true;
      }
      return [summary.nickname, summary.openid].some((value) => value.toLowerCase().includes(normalizedSearch));
    })
    .sort(compareUserSummaries);
}

export async function buildAdminSelectedUser(
  store: DataStore,
  storage: StorageClient,
  userKey: string,
  todayKey: string,
  rangeDays: number
) {
  const user = (await store.listUsers()).find((candidate) => candidate.id === userKey || candidate.openid === userKey);
  if (!user) {
    return null;
  }

  const publicProfile = await store.getPublicSettingsByUserId(user.id);
  const recentDateKeys = buildRecentDateKeys(todayKey, rangeDays);
  const dailyStats = await store.getDailyStats(user.id);
  const sessionContexts = await buildSessionContexts(store, user.id);
  const tempUrlByObjectKey = await buildTempUrlLookup(storage, sessionContexts.flatMap((context) => context.photos));
  const avatarUrlByUserId = await resolveAvatarUrlMap([user], storage);

  const recentDays = recentDateKeys.map((date) =>
    buildDayGroup({
      date,
      stat: dailyStats.get(date) ?? null,
      sessionContexts,
      tempUrlByObjectKey
    })
  );

  return {
    userId: user.id,
    openid: user.openid,
    nickname: user.nickname,
    avatarUrl: avatarUrlByUserId.get(user.id) ?? "",
    profileCompleted: user.profileCompleted,
    lastLoginAt: user.lastLoginAt,
    publicProfile,
    recentDays
  } satisfies AdminSelectedUser;
}

export async function buildAdminDateRows(
  store: DataStore,
  storage: StorageClient,
  dateKey: string
) {
  const users = await store.listUsers();
  const avatarUrlByUserId = await resolveAvatarUrlMap(users, storage);
  const rows = await Promise.all(
    users.map(async (user) => {
      const sessionContexts = await buildSessionContexts(store, user.id);
      const matchingContexts = sessionContexts.filter((context) => context.contributions.has(dateKey));
      if (!matchingContexts.length) {
        return null;
      }

      const tempUrlByObjectKey = await buildTempUrlLookup(storage, matchingContexts.flatMap((context) => context.photos));
      const sessions = matchingContexts.map((context) =>
        buildSessionPreview(context, dateKey, tempUrlByObjectKey)
      );

      return {
        userId: user.id,
        openid: user.openid,
        nickname: user.nickname,
        avatarUrl: avatarUrlByUserId.get(user.id) ?? "",
        totalMinutes: sessions.reduce((sum, session) => sum + session.totalMinutes, 0),
        sessionCount: sessions.length,
        uploadCount: sessions.reduce((sum, session) => sum + session.photos.length, 0),
        sessions
      } satisfies AdminDateUserRow;
    })
  );

  return rows.filter((row): row is AdminDateUserRow => Boolean(row)).sort(
    (left, right) => right.totalMinutes - left.totalMinutes || safeName(left.nickname).localeCompare(safeName(right.nickname))
  );
}

export function buildRecentDateKeys(todayKey: string, rangeDays: number) {
  return Array.from({ length: rangeDays }, (_, index) => addShanghaiDays(todayKey, -index));
}

function compareUserSummaries(left: AdminUserSummary, right: AdminUserSummary) {
  const latestLeft = left.latestCheckinDate ?? "";
  const latestRight = right.latestCheckinDate ?? "";
  return (
    latestRight.localeCompare(latestLeft) ||
    right.lastLoginAt.localeCompare(left.lastLoginAt) ||
    safeName(left.nickname).localeCompare(safeName(right.nickname))
  );
}

async function buildSessionContexts(store: DataStore, userId: string) {
  const sessions = (await store.listSessions(userId)).filter((session) => session.status === "completed");
  return Promise.all(
    sessions.map(async (session) => ({
      session,
      contributions: buildDayContributions(session),
      photos: await store.getPhotosBySessionId(session.id)
    }))
  );
}

async function buildTempUrlLookup(storage: StorageClient, photos: SessionPhoto[]) {
  const objectKeys = [...new Set(photos.map((photo) => photo.objectKey))];
  if (!objectKeys.length) {
    return new Map<string, string>();
  }

  const items = await storage.getTemporaryUrls(objectKeys);
  return new Map(items.map((item) => [item.objectKey, item.url]));
}

function buildDayGroup({
  date,
  stat,
  sessionContexts,
  tempUrlByObjectKey
}: {
  date: string;
  stat: DailyStat | null;
  sessionContexts: SessionContext[];
  tempUrlByObjectKey: Map<string, string>;
}) {
  const sessions = sessionContexts
    .filter((context) => context.contributions.has(date))
    .map((context) => buildSessionPreview(context, date, tempUrlByObjectKey))
    .sort((left, right) => (right.endedAt ?? "").localeCompare(left.endedAt ?? ""));

  return {
    date,
    totalMinutes: stat?.totalMinutes ?? sessions.reduce((sum, session) => sum + session.totalMinutes, 0),
    sessionCount: stat?.sessionCount ?? sessions.length,
    uploadCount: sessions.reduce((sum, session) => sum + session.photos.length, 0),
    sessions
  } satisfies AdminDayGroup;
}

function buildSessionPreview(
  context: SessionContext,
  date: string,
  tempUrlByObjectKey: Map<string, string>
) {
  return {
    id: context.session.id,
    summary: context.session.summary,
    subjects: context.session.subjects,
    tags: context.session.tags,
    startedAt: context.session.startedAt,
    endedAt: context.session.endedAt,
    totalMinutes: context.contributions.get(date) ?? context.session.durationMinutes,
    photos: context.photos.map((photo) => ({
      ...photo,
      tempUrl: tempUrlByObjectKey.get(photo.objectKey) ?? ""
    }))
  } satisfies AdminSessionPreview;
}

function safeName(value: string) {
  return value.trim() || "~";
}
