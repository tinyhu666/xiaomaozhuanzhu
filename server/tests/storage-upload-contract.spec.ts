import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import type {
  StorageClient,
  StorageQuery,
  UploadCredential,
  UploadCredentialRequest
} from "../src/storage/default-storage";

/**
 * v0.40 (M2) — COS direct-upload + cloud:// relaxation contract
 * (云托管 → Lighthouse VPS migration).
 *
 *  - POST /api/storage/upload-credential issues presigned PUT creds for
 *    SERVER-chosen, user-namespaced objectKeys (client can't pick paths).
 *  - 503 when the storage backend can't sign uploads (non-COS / 云托管).
 *  - completeSchema accepts a COS photo (objectKey only, no cloud:// fileId).
 *  - profileSchema accepts a `cos://` avatar; it resolves to a signed URL.
 */

class TestClock {
  private current: Date;
  constructor(value: string) {
    this.current = new Date(value);
  }
  now() {
    return new Date(this.current);
  }
  advanceMinutes(n: number) {
    this.current = new Date(this.current.getTime() + n * 60_000);
  }
}

/** A COS-like stub: signs reads + issues fake presigned PUT creds, and
 *  records every objectKey it was asked to sign (to prove the SERVER,
 *  not the client, chose the path). */
function makeStubStorage() {
  const signedKeys: string[] = [];
  const storage: StorageClient = {
    async getTemporaryUrls(items: StorageQuery[]) {
      return items.map((item) => ({
        objectKey: item.objectKey,
        url: `https://signed.example/${item.objectKey}`,
        expiresAt: "2030-01-01T00:00:00.000Z"
      }));
    },
    async createUploadCredentials(items: UploadCredentialRequest[]): Promise<UploadCredential[]> {
      return items.map((item) => {
        signedKeys.push(item.objectKey);
        return {
          objectKey: item.objectKey,
          method: "PUT",
          uploadUrl: `https://put.example/${item.objectKey}?sig=abc`,
          publicUrl: `https://bucket.example/${item.objectKey}`,
          expiresAt: "2030-01-01T00:00:00.000Z"
        };
      });
    }
  };
  return { storage, signedKeys };
}

const errCode = (res: request.Response) => res.body.error?.code ?? res.body.code;

describe("POST /api/storage/upload-credential", () => {
  let clock: TestClock;
  const openid = "uploader-1";

  beforeEach(() => {
    clock = new TestClock("2026-06-07T10:00:00+08:00");
  });

  it("503 when the storage backend cannot sign uploads (云托管 / default)", async () => {
    // Default storage client has no createUploadCredentials.
    const app = createApp({ clock: { now: () => clock.now() }, seedNews: false });
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    const res = await request(app)
      .post("/api/storage/upload-credential")
      .set("x-wx-openid", openid)
      .send({ kind: "checkin", files: [{ ext: "jpg" }] });
    expect(res.status).toBe(503);
    expect(errCode(res)).toBe("UPLOAD_UNAVAILABLE");
  });

  it("issues server-namespaced checkin keys (client cannot choose the path)", async () => {
    const { storage, signedKeys } = makeStubStorage();
    const app = createApp({ clock: { now: () => clock.now() }, seedNews: false, storage });
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);

    const res = await request(app)
      .post("/api/storage/upload-credential")
      .set("x-wx-openid", openid)
      // jpeg should normalize to jpg; png preserved.
      .send({ kind: "checkin", files: [{ ext: "jpeg" }, { ext: "png" }] })
      .expect(200);

    const creds = res.body.credentials as UploadCredential[];
    expect(creds).toHaveLength(2);
    // Server-chosen keys: uploads/<userId>/<yyyymm>/<uuid>.<ext>
    expect(creds[0].objectKey).toMatch(/^uploads\/[\w-]+\/202606\/[\w-]+\.jpg$/);
    expect(creds[1].objectKey).toMatch(/^uploads\/[\w-]+\/202606\/[\w-]+\.png$/);
    // Both files share the same user prefix, and the keys are unique.
    const userPrefix = (k: string) => k.split("/").slice(0, 2).join("/");
    expect(userPrefix(creds[0].objectKey)).toBe(userPrefix(creds[1].objectKey));
    expect(creds[0].objectKey).not.toBe(creds[1].objectKey);
    // Presigned PUT shape.
    expect(creds[0].method).toBe("PUT");
    expect(creds[0].uploadUrl).toContain("sig=");
    expect(creds[0].publicUrl).toContain(creds[0].objectKey);
    // The storage layer only ever saw server keys.
    expect(signedKeys).toEqual([creds[0].objectKey, creds[1].objectKey]);
  });

  it("issues a single avatar key under avatars/<userId>/", async () => {
    const { storage } = makeStubStorage();
    const app = createApp({ clock: { now: () => clock.now() }, seedNews: false, storage });
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);

    const res = await request(app)
      .post("/api/storage/upload-credential")
      .set("x-wx-openid", openid)
      .send({ kind: "avatar", files: [{ ext: "png" }] })
      .expect(200);
    const creds = res.body.credentials as UploadCredential[];
    expect(creds).toHaveLength(1);
    expect(creds[0].objectKey).toMatch(/^avatars\/[\w-]+\/[\w-]+\.png$/);
  });

  it("ignores an extra contentType field — the signed PUT never bound it (option a)", async () => {
    const { storage } = makeStubStorage();
    const app = createApp({ clock: { now: () => clock.now() }, seedNews: false, storage });
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    const res = await request(app)
      .post("/api/storage/upload-credential")
      .set("x-wx-openid", openid)
      // contentType is NOT in the schema; zod (non-strict) strips it.
      .send({ kind: "checkin", files: [{ ext: "jpg", contentType: "image/jpeg" }] })
      .expect(200);
    const cred = res.body.credentials[0] as UploadCredential & { contentType?: string };
    expect(cred.objectKey).toMatch(/^uploads\/[\w-]+\/202606\/[\w-]+\.jpg$/);
    expect(cred).not.toHaveProperty("contentType");
  });

  it("rejects avatar with more than one file, and >3 / empty files", async () => {
    const { storage } = makeStubStorage();
    const app = createApp({ clock: { now: () => clock.now() }, seedNews: false, storage });
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);

    await request(app)
      .post("/api/storage/upload-credential")
      .set("x-wx-openid", openid)
      .send({ kind: "avatar", files: [{ ext: "jpg" }, { ext: "jpg" }] })
      .expect(400);
    await request(app)
      .post("/api/storage/upload-credential")
      .set("x-wx-openid", openid)
      .send({ kind: "checkin", files: [{}, {}, {}, {}] })
      .expect(400);
    await request(app)
      .post("/api/storage/upload-credential")
      .set("x-wx-openid", openid)
      .send({ kind: "checkin", files: [] })
      .expect(400);
  });
});

describe("completeSchema — COS photo (no cloud:// fileId)", () => {
  let clock: TestClock;
  const openid = "cos-photo-user";
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    clock = new TestClock("2026-06-07T09:00:00+08:00");
    const { storage } = makeStubStorage();
    app = createApp({ clock: { now: () => clock.now() }, seedNews: false, storage });
  });

  async function startSession() {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    const started = await request(app)
      .post("/api/sessions/start")
      .set("x-wx-openid", openid)
      .send({ mode: "free" })
      .expect(200);
    clock.advanceMinutes(25);
    return started.body.session.id as string;
  }

  it("accepts a photo with only an objectKey (COS direct upload)", async () => {
    const id = await startSession();
    const res = await request(app)
      .post(`/api/sessions/${id}/complete`)
      .set("x-wx-openid", openid)
      .send({ subject: "会计", photos: [{ objectKey: "uploads/u/202606/a.jpg" }] });
    expect(res.status).toBe(200);

    // Persisted + readable on the calendar day.
    const day = await request(app)
      .get("/api/calendar/2026-06-07")
      .set("x-wx-openid", openid)
      .expect(200);
    const keys = day.body.sessions.flatMap((s: { photos: { objectKey: string }[] }) =>
      s.photos.map((p) => p.objectKey)
    );
    expect(keys).toContain("uploads/u/202606/a.jpg");
  });

  it("still accepts a 云托管 cloud:// photo (back-compat)", async () => {
    const id = await startSession();
    await request(app)
      .post(`/api/sessions/${id}/complete`)
      .set("x-wx-openid", openid)
      .send({ photos: [{ fileId: "cloud://env.appid/uploads/k.jpg", objectKey: "uploads/k.jpg" }] })
      .expect(200);
  });

  it("still rejects an unsafe objectKey (leading slash)", async () => {
    const id = await startSession();
    await request(app)
      .post(`/api/sessions/${id}/complete`)
      .set("x-wx-openid", openid)
      .send({ photos: [{ objectKey: "/etc/passwd" }] })
      .expect(400);
  });
});

describe("profileSchema — cos:// avatar accept + resolve", () => {
  let clock: TestClock;
  const openid = "cos-avatar-user";
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    clock = new TestClock("2026-06-07T09:00:00+08:00");
    const { storage } = makeStubStorage();
    app = createApp({ clock: { now: () => clock.now() }, seedNews: false, storage });
  });

  it("accepts a cos:// avatar and https, rejects an unknown scheme", async () => {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", openid)
      .send({ nickname: "喵", avatarUrl: "cos://avatars/u/a.jpg" })
      .expect(200);
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", openid)
      .send({ nickname: "喵", avatarUrl: "https://cdn.example/a.jpg" })
      .expect(200);
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", openid)
      .send({ nickname: "喵", avatarUrl: "ftp://evil/a.jpg" })
      .expect(400);
  });

  it("resolves an OWNED cos:// avatar to a signed URL on the public profile", async () => {
    const boot = await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    const slug = boot.body.profile.shareSlug as string;
    const userId = boot.body.profile.id as string;
    const key = `avatars/${userId}/a.jpg`;

    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", openid)
      .send({ nickname: "喵", avatarUrl: `cos://${key}` })
      .expect(200);
    await request(app)
      .post("/api/share/me")
      .set("x-wx-openid", openid)
      .send({ isPublic: true, requireWechatAuth: false })
      .expect(200);

    const pub = await request(app).get(`/api/public/${slug}`).expect(200);
    expect(pub.body.profile.avatarUrl).toBe(`https://signed.example/${key}`);
  });

  it("does NOT sign a cross-user cos:// avatar (ownership guard → empty)", async () => {
    const boot = await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    const slug = boot.body.profile.shareSlug as string;

    // The schema still ACCEPTS the write (scheme-only check), but the read
    // path must refuse to sign a key in someone else's namespace.
    await request(app)
      .post("/api/me/profile")
      .set("x-wx-openid", openid)
      .send({ nickname: "喵", avatarUrl: "cos://avatars/another-user-id/secret.jpg" })
      .expect(200);
    await request(app)
      .post("/api/share/me")
      .set("x-wx-openid", openid)
      .send({ isPublic: true, requireWechatAuth: false })
      .expect(200);

    const pub = await request(app).get(`/api/public/${slug}`).expect(200);
    expect(pub.body.profile.avatarUrl).toBe("");
  });
});

describe("POST /api/storage/temp-urls — per-user ownership guard", () => {
  let clock: TestClock;
  const openid = "temp-url-user";
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    clock = new TestClock("2026-06-07T09:00:00+08:00");
    const { storage } = makeStubStorage();
    app = createApp({ clock: { now: () => clock.now() }, seedNews: false, storage });
  });

  // A server-issued key reveals the caller's userId as its 2nd segment.
  async function ownUploadKey(): Promise<{ userId: string; key: string }> {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    const cred = await request(app)
      .post("/api/storage/upload-credential")
      .set("x-wx-openid", openid)
      .send({ kind: "checkin", files: [{ ext: "jpg" }] })
      .expect(200);
    const key = cred.body.credentials[0].objectKey as string;
    return { userId: key.split("/")[1], key };
  }

  it("signs the caller's own uploads/<userId> key", async () => {
    const { key } = await ownUploadKey();
    const res = await request(app)
      .post("/api/storage/temp-urls")
      .set("x-wx-openid", openid)
      .send({ objectKeys: [key] })
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].url).toContain(key);
  });

  it("refuses to sign another user's uploads/ or avatars/ key, keeps the caller's own", async () => {
    const { userId, key } = await ownUploadKey();
    const foreignUpload = `uploads/${userId}-someone-else/202606/x.jpg`;
    const foreignAvatar = "avatars/victim-user-id/face.jpg";
    const res = await request(app)
      .post("/api/storage/temp-urls")
      .set("x-wx-openid", openid)
      .send({ objectKeys: [key, foreignUpload, foreignAvatar] })
      .expect(200);
    const signed = (res.body.items as Array<{ objectKey: string }>).map((i) => i.objectKey);
    expect(signed).toEqual([key]);
    expect(signed).not.toContain(foreignUpload);
    expect(signed).not.toContain(foreignAvatar);
  });

  it("passes through legacy 云托管 checkins/ keys (not user-namespaced)", async () => {
    await request(app).post("/api/me/bootstrap").set("x-wx-openid", openid).expect(200);
    const legacy = "checkins/2026/06/1717000000.jpg";
    const res = await request(app)
      .post("/api/storage/temp-urls")
      .set("x-wx-openid", openid)
      .send({ items: [{ objectKey: legacy, fileId: "cloud://env.appid/checkins/2026/06/1717000000.jpg" }] })
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].objectKey).toBe(legacy);
  });
});
