import { getChatGPTUser } from "@/app/chatgpt-auth";

type CountryCode = "DE" | "IT" | "CH" | "AT";
type PlaceCountry = CountryCode | "LOC";

type Place = {
  id: string;
  name: string;
  countryCode: PlaceCountry;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone: string;
  source: "search" | "geolocation";
};

type PreferencesPayload = {
  schemaVersion: 2;
  home: Place | null;
  work: Place | null;
  activePlaceId: string | null;
};

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type D1DatabaseLike = {
  prepare: (query: string) => D1Statement;
};

const COUNTRY_CODES: PlaceCountry[] = ["DE", "IT", "CH", "AT", "LOC"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlace(value: unknown): value is Place {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    COUNTRY_CODES.includes(value.countryCode as PlaceCountry) &&
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    typeof value.timezone === "string" &&
    (value.source === "search" || value.source === "geolocation")
  );
}

function parsePayload(value: unknown): PreferencesPayload | null {
  if (!isRecord(value) || value.schemaVersion !== 2) return null;
  const home = value.home === null || value.home === undefined ? null : isPlace(value.home) ? value.home : null;
  const work = value.work === null || value.work === undefined ? null : isPlace(value.work) ? value.work : null;
  const activePlaceId = typeof value.activePlaceId === "string" ? value.activePlaceId : null;
  return { schemaVersion: 2, home, work, activePlaceId };
}

async function getD1(): Promise<D1DatabaseLike | null> {
  try {
    const cloudflareWorkers = await import("cloudflare:workers");
    return (cloudflareWorkers.env.DB as unknown as D1DatabaseLike | undefined) ?? null;
  } catch {
    return null;
  }
}

function emptyPayload(): PreferencesPayload {
  return { schemaVersion: 2, home: null, work: null, activePlaceId: null };
}

function invalidPayloadResponse() {
  return Response.json(
    { error: "INVALID_PREFERENCES", message: "Die Standortdaten konnten nicht geprüft werden." },
    { status: 400 },
  );
}

async function getAuthenticatedDatabase() {
  const user = await getChatGPTUser();
  if (!user) {
    return { response: Response.json({ error: "AUTH_REQUIRED" }, { status: 401 }) };
  }

  const db = await getD1();
  if (!db) {
    return {
      response: Response.json(
        { error: "STORAGE_UNAVAILABLE", message: "Die geräteübergreifende Speicherung ist momentan nicht verfügbar." },
        { status: 503 },
      ),
    };
  }

  return { user, db };
}

export async function GET() {
  const context = await getAuthenticatedDatabase();
  if ("response" in context) return context.response;

  try {
    const row = await context.db
      .prepare("SELECT payload, updated_at FROM weather_preferences WHERE user_id = ?1")
      .bind(context.user.userId)
      .first<{ payload: string; updated_at: string }>();

    if (!row) return Response.json({ ...emptyPayload(), updatedAt: null });

    const payload = parsePayload(JSON.parse(row.payload));
    if (!payload) return Response.json({ ...emptyPayload(), updatedAt: row.updated_at, status: "partial" });

    return Response.json({ ...payload, updatedAt: row.updated_at });
  } catch (error) {
    console.error("weather preferences read failed", error);
    return Response.json(
      { error: "STORAGE_UNAVAILABLE", message: "Die gespeicherten Standorte konnten nicht geladen werden." },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  const context = await getAuthenticatedDatabase();
  if ("response" in context) return context.response;

  let payload: PreferencesPayload | null = null;
  try {
    payload = parsePayload(await request.json());
  } catch {
    payload = null;
  }

  if (!payload) return invalidPayloadResponse();

  const updatedAt = new Date().toISOString();
  try {
    await context.db
      .prepare(
        "INSERT INTO weather_preferences (user_id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
      )
      .bind(context.user.userId, JSON.stringify(payload), updatedAt)
      .run();

    return Response.json({ ...payload, updatedAt });
  } catch (error) {
    console.error("weather preferences write failed", error);
    return Response.json(
      { error: "STORAGE_UNAVAILABLE", message: "Die Standorte konnten nicht gespeichert werden." },
      { status: 503 },
    );
  }
}
