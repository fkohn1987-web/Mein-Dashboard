"use client";

import {
  AlertTriangle,
  ArrowUp,
  BriefcaseBusiness,
  Check,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudOff,
  CloudRain,
  CloudSnow,
  CloudSun,
  Compass,
  Droplets,
  House,
  LocateFixed,
  LogIn,
  MapPin,
  Moon,
  RefreshCw,
  Search,
  Sun,
  Star,
  Wind,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";

type CountryCode = "DE" | "IT" | "CH" | "AT";
type PlaceCountry = CountryCode | "LOC";
type FavoriteSlot = "home" | "work";
type WeatherStatus = "loading" | "ready" | "partial" | "unavailable";
type SearchStatus = "idle" | "loading" | "ready" | "error";
type SyncStatus = "loading" | "ready" | "signed-out" | "unavailable";

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

type SearchResult = Place & { population?: number };

type CurrentWeather = {
  time: string;
  temperatureC: number;
  feelsLikeC: number;
  weatherCode: number;
  precipitationMm: number;
  windKmh: number;
  windDirectionDeg: number;
  isDay: boolean;
};

type HourPoint = {
  time: string;
  temperatureC: number;
  precipitationProbabilityPct: number;
  precipitationMm: number;
  weatherCode: number;
  windKmh: number;
};

type DaySummary = {
  date: string;
  minC: number;
  maxC: number;
  precipitationProbabilityPct: number;
  precipitationMm: number;
  weatherCode: number;
  sunrise: string;
  sunset: string;
};

type WeatherSnapshot = {
  place: Place;
  fetchedAt: string;
  status: WeatherStatus;
  current: CurrentWeather | null;
  hourly: HourPoint[];
  daily: DaySummary[];
  error?: string;
};

type FavoriteSlots = Record<FavoriteSlot, Place | null>;

type LocalPreferencesV3 = {
  schemaVersion: 3;
  home: Place | null;
  work: Place | null;
  favorites: Place[];
  activePlaceId: string | null;
};

type ModelContextLike = {
  registerTool: (
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations?: Record<string, boolean>;
      execute: (input: unknown) => unknown | Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

type ModelContextDocument = Document & { modelContext?: ModelContextLike };
type WeatherTone = "clear" | "cloud" | "rain" | "storm" | "snow" | "fog" | "unknown";
type WeatherIconKind = "sun" | "cloud-sun" | "cloud" | "drizzle" | "rain" | "snow" | "storm" | "fog" | "unknown";
type WeatherCondition = { tone: WeatherTone; label: string; icon: WeatherIconKind };

const STORAGE_KEY = "personal-dashboard.weather.v3";
const MAX_FAVORITES = 10;
const WEATHER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const COUNTRY_CODES: CountryCode[] = ["DE", "IT", "CH", "AT"];

const countryLabels: Record<PlaceCountry, string> = {
  DE: "Deutschland",
  IT: "Italien",
  CH: "Schweiz",
  AT: "Österreich",
  LOC: "Mein Standort",
};

const countryFlags: Record<PlaceCountry, string> = {
  DE: "🇩🇪",
  IT: "🇮🇹",
  CH: "🇨🇭",
  AT: "🇦🇹",
  LOC: "⌾",
};

function emptyFavoriteSlots(): FavoriteSlots {
  return { home: null, work: null };
}

function hasSavedData(slots: FavoriteSlots, favorites: Place[]) {
  return Boolean(slots.home || slots.work || favorites.length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlace(value: unknown): value is Place {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    [...COUNTRY_CODES, "LOC"].includes(value.countryCode as PlaceCountry) &&
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    typeof value.timezone === "string" &&
    (value.source === "search" || value.source === "geolocation")
  );
}

function dedupePlaces(places: Place[]) {
  const seen = new Set<string>();
  return places.filter((place) => {
    if (seen.has(place.id)) return false;
    seen.add(place.id);
    return true;
  }).slice(0, MAX_FAVORITES);
}

function slotsFromPreferences(preferences: LocalPreferencesV3): FavoriteSlots {
  return { home: preferences.home, work: preferences.work };
}

function preferencesFromState(slots: FavoriteSlots, favorites: Place[], activePlaceId: string | null): LocalPreferencesV3 {
  return { schemaVersion: 3, home: slots.home, work: slots.work, favorites: dedupePlaces(favorites), activePlaceId };
}

function parsePreferences(value: unknown): LocalPreferencesV3 | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion === 3) {
    const home = value.home === null || value.home === undefined ? null : isPlace(value.home) ? value.home : null;
    const work = value.work === null || value.work === undefined ? null : isPlace(value.work) ? value.work : null;
    const favorites = Array.isArray(value.favorites) ? dedupePlaces(value.favorites.filter(isPlace)) : [];
    return { schemaVersion: 3, home, work, favorites, activePlaceId: typeof value.activePlaceId === "string" ? value.activePlaceId : null };
  }
  if (value.schemaVersion === 2) {
    const home = value.home === null || value.home === undefined ? null : isPlace(value.home) ? value.home : null;
    const work = value.work === null || value.work === undefined ? null : isPlace(value.work) ? value.work : null;
    return { schemaVersion: 3, home, work, favorites: [], activePlaceId: typeof value.activePlaceId === "string" ? value.activePlaceId : null };
  }
  if (value.schemaVersion === 1 && Array.isArray(value.favorites)) {
    const legacyFavorites = value.favorites.filter(isPlace);
    return { schemaVersion: 3, home: legacyFavorites[0] ?? null, work: legacyFavorites[1] ?? null, favorites: dedupePlaces(legacyFavorites.slice(2)), activePlaceId: typeof value.activePlaceId === "string" ? value.activePlaceId : null };
  }
  return null;
}

function readPreferences(): LocalPreferencesV3 | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem("personal-dashboard.weather.v2") ?? window.localStorage.getItem("personal-dashboard.weather.v1");
    if (!raw) return null;
    return parsePreferences(JSON.parse(raw));
  } catch {
    return null;
  }
}

function numberAt(value: unknown, index: number, fallback = 0) {
  const item = Array.isArray(value) ? value[index] : value;
  return typeof item === "number" && Number.isFinite(item) ? item : fallback;
}

function stringAt(value: unknown, index: number, fallback = "") {
  const item = Array.isArray(value) ? value[index] : value;
  return typeof item === "string" ? item : fallback;
}

function weatherCondition(code: number): WeatherCondition {
  switch (code) {
    case 0: return { tone: "clear", label: "Klar", icon: "sun" };
    case 1: return { tone: "clear", label: "Überwiegend klar", icon: "sun" };
    case 2: return { tone: "cloud", label: "Teilweise bewölkt", icon: "cloud-sun" };
    case 3: return { tone: "cloud", label: "Bedeckt", icon: "cloud" };
    case 45:
    case 48: return { tone: "fog", label: "Nebel", icon: "fog" };
    case 51:
    case 53:
    case 55: return { tone: "rain", label: "Nieselregen", icon: "drizzle" };
    case 56:
    case 57: return { tone: "rain", label: "Gefrierender Nieselregen", icon: "drizzle" };
    case 61:
    case 63:
    case 65: return { tone: "rain", label: "Regen", icon: "rain" };
    case 66:
    case 67: return { tone: "rain", label: "Gefrierender Regen", icon: "rain" };
    case 71:
    case 73:
    case 75: return { tone: "snow", label: "Schneefall", icon: "snow" };
    case 77: return { tone: "snow", label: "Schneekörner", icon: "snow" };
    case 80:
    case 81:
    case 82: return { tone: "rain", label: "Regenschauer", icon: "rain" };
    case 85:
    case 86: return { tone: "snow", label: "Schneeschauer", icon: "snow" };
    case 95: return { tone: "storm", label: "Gewitter", icon: "storm" };
    case 96:
    case 99: return { tone: "storm", label: "Gewitter mit Hagel", icon: "storm" };
    default: return { tone: "unknown", label: "Wetterzustand unbekannt", icon: "unknown" };
  }
}

function weatherTone(code: number): WeatherTone {
  return weatherCondition(code).tone;
}

function WeatherIcon({ code, isDay = true, size = 24 }: { code: number; isDay?: boolean; size?: number }) {
  const iconKind = weatherCondition(code).icon;
  const Icon = iconKind === "sun" ? (isDay ? Sun : Moon) : iconKind === "cloud-sun" ? CloudSun : iconKind === "cloud" ? Cloud : iconKind === "drizzle" ? CloudDrizzle : iconKind === "rain" ? CloudRain : iconKind === "storm" ? CloudLightning : iconKind === "snow" ? CloudSnow : iconKind === "fog" ? CloudFog : Cloud;
  return <Icon aria-hidden="true" size={size} strokeWidth={1.8} />;
}

function SlotIcon({ slot, size = 17 }: { slot: FavoriteSlot; size?: number }) {
  const Icon = slot === "home" ? House : BriefcaseBusiness;
  return <Icon aria-hidden="true" size={size} strokeWidth={1.8} />;
}

function formatTemperature(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}°` : "–";
}

function formatTime(value: string, timezone?: string) {
  if (!value) return "–";
  const parsed = new Date(value.includes("Z") ? value : `${value}:00`);
  if (timezone && !Number.isNaN(parsed.getTime())) return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(parsed);
  return value.slice(11, 16) || value;
}

function formatDay(value: string, timezone?: string) {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: timezone }).format(parsed).replace(",", "");
}

function formatCoordinates(latitude: number, longitude: number) {
  return `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`;
}

function getPlaceLabel(place: Place) {
  return place.source === "geolocation" ? "Mein Standort" : place.name;
}

function searchUrl(query: string, countryCode: CountryCode) {
  const params = new URLSearchParams({ name: query, count: "8", language: "de", format: "json", countryCode });
  return `${GEOCODING_URL}?${params.toString()}`;
}

async function searchLocations(query: string, countryFilter: CountryCode | "all", signal?: AbortSignal) {
  const countries = countryFilter === "all" ? COUNTRY_CODES : [countryFilter];
  const responses = await Promise.all(countries.map((country) => fetch(searchUrl(query, country), { signal })));
  if (responses.some((response) => !response.ok)) throw new Error("Die Ortssuche ist gerade nicht erreichbar.");
  const payloads = (await Promise.all(responses.map((response) => response.json()))) as Array<{ results?: Array<Record<string, unknown>> }>;
  const unique = new Map<string, SearchResult>();
  payloads.forEach((payload) => {
    (payload.results ?? []).forEach((result) => {
      const id = String(result.id ?? "");
      const countryCode = String(result.country_code ?? "").toUpperCase() as CountryCode;
      const latitude = Number(result.latitude);
      const longitude = Number(result.longitude);
      if (!id || !COUNTRY_CODES.includes(countryCode) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      unique.set(id, { id, name: String(result.name ?? "Unbenannter Ort"), countryCode, country: typeof result.country === "string" ? result.country : undefined, admin1: typeof result.admin1 === "string" ? result.admin1 : undefined, latitude, longitude, timezone: String(result.timezone ?? "UTC"), source: "search", population: typeof result.population === "number" ? result.population : undefined });
    });
  });
  return [...unique.values()].sort((a, b) => (b.population ?? 0) - (a.population ?? 0) || a.name.localeCompare(b.name, "de")).slice(0, 12);
}

function buildForecastUrl(place: Place) {
  const params = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day", hourly: "temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m", daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset", forecast_days: "7", forecast_hours: "24", timezone: "auto", temperature_unit: "celsius", wind_speed_unit: "kmh", precipitation_unit: "mm" });
  return `${FORECAST_URL}?${params.toString()}`;
}

async function fetchWeather(place: Place, signal?: AbortSignal): Promise<WeatherSnapshot> {
  const response = await fetch(buildForecastUrl(place), { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Live-Daten nicht erreichbar");
  const payload = (await response.json()) as Record<string, unknown>;
  const current = payload.current as Record<string, unknown> | undefined;
  const hourly = payload.hourly as Record<string, unknown> | undefined;
  const daily = payload.daily as Record<string, unknown> | undefined;
  const currentTime = typeof current?.time === "string" ? current.time : "";
  const hourlyTimes = Array.isArray(hourly?.time) ? hourly.time : [];
  const dailyTimes = Array.isArray(daily?.time) ? daily.time : [];
  const currentData: CurrentWeather | null = currentTime ? { time: currentTime, temperatureC: numberAt(current?.temperature_2m, 0), feelsLikeC: numberAt(current?.apparent_temperature, 0), weatherCode: numberAt(current?.weather_code, 0, -1), precipitationMm: numberAt(current?.precipitation, 0), windKmh: numberAt(current?.wind_speed_10m, 0), windDirectionDeg: numberAt(current?.wind_direction_10m, 0), isDay: numberAt(current?.is_day, 0, 1) === 1 } : null;
  const hourlyData: HourPoint[] = hourlyTimes.slice(0, 24).map((time, index) => ({ time: String(time), temperatureC: numberAt(hourly?.temperature_2m, index), precipitationProbabilityPct: numberAt(hourly?.precipitation_probability, index), precipitationMm: numberAt(hourly?.precipitation, index), weatherCode: numberAt(hourly?.weather_code, index, -1), windKmh: numberAt(hourly?.wind_speed_10m, index) }));
  const dailyData: DaySummary[] = dailyTimes.slice(0, 7).map((date, index) => ({ date: String(date), minC: numberAt(daily?.temperature_2m_min, index), maxC: numberAt(daily?.temperature_2m_max, index), precipitationProbabilityPct: numberAt(daily?.precipitation_probability_max, index), precipitationMm: numberAt(daily?.precipitation_sum, index), weatherCode: numberAt(daily?.weather_code, index, -1), sunrise: stringAt(daily?.sunrise, index), sunset: stringAt(daily?.sunset, index) }));
  const status: WeatherStatus = currentData && hourlyData.length && dailyData.length ? "ready" : currentData || hourlyData.length || dailyData.length ? "partial" : "unavailable";
  return { place: { ...place, timezone: typeof payload.timezone === "string" ? payload.timezone : place.timezone }, fetchedAt: new Date().toISOString(), status, current: currentData, hourly: hourlyData, daily: dailyData };
}

function weatherStatusText(status: WeatherStatus) {
  if (status === "loading") return "Wetter wird geladen";
  if (status === "partial") return "Teilweise geladen";
  if (status === "unavailable") return "Live-Daten nicht erreichbar";
  return "Live-Daten aktuell";
}

function syncStatusText(status: SyncStatus) {
  if (status === "loading") return "Speicher wird verbunden";
  if (status === "ready") return "Geräteübergreifend synchronisiert";
  if (status === "signed-out") return "Nur dieses Gerät · Anmeldung nötig";
  return "Cloud-Speicher nicht erreichbar";
}

type AddressSlotEditorProps = {
  slot: FavoriteSlot;
  place: Place | null;
  activePlaceId: string | null;
  onSave: (slot: FavoriteSlot, place: Place) => void;
  onRemove: (slot: FavoriteSlot) => void;
  onSelect: (place: Place) => void;
};

function AddressSlotEditor({ slot, place, activePlaceId, onSave, onRemove, onSelect }: AddressSlotEditorProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const abortRef = useRef<AbortController | null>(null);
  const label = slot === "home" ? "Zu Hause" : "Arbeit";
  const selected = place?.id === activePlaceId;

  useEffect(() => {
    const trimmedQuery = query.trim();
    abortRef.current?.abort();
    let cancelled = false;
    if (trimmedQuery.length < 2) {
      queueMicrotask(() => { if (!cancelled) { setResults([]); setStatus("idle"); } });
      return () => { cancelled = true; };
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const nextResults = await searchLocations(trimmedQuery, "all", controller.signal);
        if (!cancelled && !controller.signal.aborted) { setResults(nextResults); setStatus("ready"); }
      } catch {
        if (!cancelled && !controller.signal.aborted) { setResults([]); setStatus("error"); }
      }
    }, 280);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  return (
    <article className={`favorite-slot-card ${selected ? "favorite-slot-card--selected" : ""}`}>
      <div className="favorite-slot-card__topline">
        <div className="favorite-slot-card__label"><span className="favorite-slot-card__icon"><SlotIcon slot={slot} /></span><div><p className="eyebrow">{label}</p><h3>{place ? getPlaceLabel(place) : "Noch nicht festgelegt"}</h3></div></div>
        {place ? <button type="button" className="favorite-chip__remove" onClick={() => onRemove(slot)} aria-label={`${label} entfernen`}><X size={14} aria-hidden="true" /></button> : null}
      </div>
      <div className="slot-address-search">
        <Search size={15} aria-hidden="true" />
        <Input aria-label={`${label} Adresse oder Ort suchen`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Adresse, Stadt oder PLZ suchen …" autoComplete="off" />
        {query ? <button type="button" className="slot-search-clear" aria-label={`${label}-Suche leeren`} onClick={() => setQuery("")}><X size={14} aria-hidden="true" /></button> : null}
        {query.trim().length >= 2 ? <div className="slot-search-results" role="listbox" aria-label={`${label} Suchergebnisse`}>
          {status === "loading" ? <div className="search-message"><RefreshCw size={15} className="spin" /> Suche läuft …</div> : null}
          {status === "error" ? <div className="search-message search-message--error"><AlertTriangle size={15} /> Suche nicht erreichbar.</div> : null}
          {status === "ready" && results.length === 0 ? <div className="search-message">Keine passende Ortskoordinate gefunden.</div> : null}
          {results.map((result) => <button key={result.id} type="button" className="slot-search-result" role="option" aria-selected={false} onClick={() => { onSave(slot, result); setQuery(""); }}><span className="search-result__icon"><MapPin size={15} aria-hidden="true" /></span><span className="search-result__text"><strong>{result.name}</strong><small>{result.admin1 ? `${result.admin1} · ` : ""}{countryLabels[result.countryCode]} · {result.timezone}</small></span><span className="search-result__coords">{formatCoordinates(result.latitude, result.longitude)}</span></button>)}
        </div> : null}
      </div>
      <p className="favorite-slot-card__hint">Es wird eine Ortskoordinate gespeichert, keine Hausnummer.</p>
      {place ? <button type="button" className="favorite-slot-card__select" onClick={() => onSelect(place)} aria-current={selected ? "true" : undefined}><span>{countryFlags[place.countryCode]} {place.admin1 ? `${place.admin1} · ` : ""}{formatCoordinates(place.latitude, place.longitude)}</span><span>{selected ? "Aktiv" : "Anzeigen"}</span></button> : null}
    </article>
  );
}

export default function Home() {
  const [favoriteSlots, setFavoriteSlots] = useState<FavoriteSlots>(emptyFavoriteSlots);
  const [favoritePlaces, setFavoritePlaces] = useState<Place[]>([]);
  const [favoriteNotice, setFavoriteNotice] = useState<string | null>(null);
  const [activePlace, setActivePlace] = useState<Place | null>(null);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState<CountryCode | "all">("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [locationStatus, setLocationStatus] = useState<"idle" | "requesting" | "ready" | "denied" | "unsupported">("idle");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [hasHydrated, setHasHydrated] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const weatherAbortRef = useRef<AbortController | null>(null);
  const cloudReadyRef = useRef(false);
  const cloudWriteRef = useRef(0);
  const actionsRef = useRef<{ selectPlace: (place: Place) => Promise<void>; toggleFavorite: (place: Place) => void; search: (input: unknown) => Promise<unknown> }>({ selectPlace: async () => undefined, toggleFavorite: () => undefined, search: async () => [] });

  const favorites = favoritePlaces;
  const favoriteCount = favorites.length;
  const savedPlaces = useMemo(() => dedupePlaces([...favoritePlaces, favoriteSlots.home, favoriteSlots.work].filter((place): place is Place => Boolean(place))), [favoritePlaces, favoriteSlots]);

  const saveLocalPreferences = useCallback((slots: FavoriteSlots, nextFavorites: Place[], activePlaceId: string | null) => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferencesFromState(slots, nextFavorites, activePlaceId))); } catch { /* storage-disabled contexts remain usable */ }
  }, []);

  const persistCloudPreferences = useCallback(async (slots: FavoriteSlots, nextFavorites: Place[], activePlaceId: string | null) => {
    if (!cloudReadyRef.current) return;
    const writeId = ++cloudWriteRef.current;
    try {
      const response = await fetch("/api/preferences", { method: "PUT", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(preferencesFromState(slots, nextFavorites, activePlaceId)) });
      if (writeId !== cloudWriteRef.current) return;
      if (response.status === 401) { cloudReadyRef.current = false; setSyncStatus("signed-out"); return; }
      if (!response.ok) { cloudReadyRef.current = false; setSyncStatus("unavailable"); return; }
      setSyncStatus("ready");
    } catch {
      if (writeId === cloudWriteRef.current) { cloudReadyRef.current = false; setSyncStatus("unavailable"); }
    }
  }, []);

  const updatePreferences = useCallback((nextSlots: FavoriteSlots, nextFavorites: Place[], activePlaceId: string | null) => {
    setFavoriteSlots(nextSlots);
    setFavoritePlaces(dedupePlaces(nextFavorites));
    saveLocalPreferences(nextSlots, nextFavorites, activePlaceId);
    void persistCloudPreferences(nextSlots, nextFavorites, activePlaceId);
  }, [persistCloudPreferences, saveLocalPreferences]);

  const loadPlace = useCallback(async (place: Place) => {
    weatherAbortRef.current?.abort();
    const controller = new AbortController();
    weatherAbortRef.current = controller;
    setActivePlace(place);
    setWeather({ place, fetchedAt: new Date().toISOString(), status: "loading", current: null, hourly: [], daily: [] });
    try {
      const nextWeather = await fetchWeather(place, controller.signal);
      if (!controller.signal.aborted) { setWeather(nextWeather); setActivePlace(nextWeather.place); }
    } catch (error) {
      if (controller.signal.aborted) return;
      setWeather({ place, fetchedAt: new Date().toISOString(), status: "unavailable", current: null, hourly: [], daily: [], error: error instanceof Error ? error.message : "Live-Daten nicht erreichbar" });
    }
  }, []);

  const selectPlace = useCallback(async (place: Place) => {
    setQuery(""); setResults([]); setSearchStatus("idle"); saveLocalPreferences(favoriteSlots, favoritePlaces, place.id); void persistCloudPreferences(favoriteSlots, favoritePlaces, place.id); await loadPlace(place);
  }, [favoritePlaces, favoriteSlots, loadPlace, persistCloudPreferences, saveLocalPreferences]);

  const savePlaceToSlot = useCallback((slot: FavoriteSlot, place: Place) => {
    const otherSlot: FavoriteSlot = slot === "home" ? "work" : "home";
    const nextSlots: FavoriteSlots = { ...favoriteSlots, [slot]: place };
    if (nextSlots[otherSlot]?.id === place.id) nextSlots[otherSlot] = null;
    updatePreferences(nextSlots, favoritePlaces, place.id);
    void loadPlace(place);
  }, [favoritePlaces, favoriteSlots, loadPlace, updatePreferences]);

  const removePlaceFromSlot = useCallback((slot: FavoriteSlot) => {
    updatePreferences({ ...favoriteSlots, [slot]: null }, favoritePlaces, activePlace?.id ?? null);
  }, [activePlace?.id, favoritePlaces, favoriteSlots, updatePreferences]);

  const addFavorite = useCallback((place: Place) => {
    setFavoriteNotice(null);
    if (favoritePlaces.some((favorite) => favorite.id === place.id)) return;
    if (favoritePlaces.length >= MAX_FAVORITES) { setFavoriteNotice(`Maximal ${MAX_FAVORITES} Favoriten gespeichert.`); return; }
    updatePreferences(favoriteSlots, [...favoritePlaces, place], activePlace?.id ?? place.id);
  }, [activePlace?.id, favoritePlaces, favoriteSlots, updatePreferences]);

  const removeFavorite = useCallback((placeId: string) => {
    updatePreferences(favoriteSlots, favoritePlaces.filter((place) => place.id !== placeId), activePlace?.id ?? null);
  }, [activePlace?.id, favoritePlaces, favoriteSlots, updatePreferences]);

  const toggleFavorite = useCallback((place: Place) => {
    if (favoritePlaces.some((favorite) => favorite.id === place.id)) removeFavorite(place.id);
    else addFavorite(place);
  }, [addFavorite, favoritePlaces, removeFavorite]);

  const requestCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) { setLocationStatus("unsupported"); return; }
    setLocationStatus("requesting");
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;
      const place: Place = { id: `geo:${latitude.toFixed(4)},${longitude.toFixed(4)}`, name: "Mein Standort", countryCode: "LOC", latitude, longitude, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin", source: "geolocation" };
      setLocationStatus("ready"); void loadPlace(place);
    }, () => setLocationStatus("denied"), { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 });
  }, [loadPlace]);

  useEffect(() => {
    const localPreferences = readPreferences();
    const localSlots = localPreferences ? slotsFromPreferences(localPreferences) : emptyFavoriteSlots();
    const localFavorites = localPreferences?.favorites ?? [];
    let initialSlots = localSlots;
    let initialFavorites = localFavorites;
    let initialActiveId = localPreferences?.activePlaceId ?? null;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setFavoriteSlots(localSlots); setFavoritePlaces(localFavorites); setHasHydrated(true); } });

    const finishInitialLocation = () => {
      if (cancelled) return;
      const savedPlace = initialActiveId ? [initialSlots.home, initialSlots.work, ...initialFavorites].find((place) => place?.id === initialActiveId) : initialSlots.home ?? initialSlots.work ?? initialFavorites[0];
      if (savedPlace) { setLocationStatus("ready"); void loadPlace(savedPlace); return; }
      requestCurrentLocation();
    };

    const syncInitialPreferences = async () => {
      try {
        const response = await fetch("/api/preferences", { credentials: "same-origin", cache: "no-store" });
        if (response.status === 401) { setSyncStatus("signed-out"); finishInitialLocation(); return; }
        if (!response.ok) { setSyncStatus("unavailable"); finishInitialLocation(); return; }
        const remotePreferences = parsePreferences(await response.json());
        if (!remotePreferences) { setSyncStatus("unavailable"); finishInitialLocation(); return; }
        const remoteSlots = slotsFromPreferences(remotePreferences);
        const remoteFavorites = remotePreferences.favorites;
        if (hasSavedData(remoteSlots, remoteFavorites) || !hasSavedData(localSlots, localFavorites)) {
          initialSlots = remoteSlots; initialFavorites = remoteFavorites; initialActiveId = remotePreferences.activePlaceId; setFavoriteSlots(remoteSlots); setFavoritePlaces(remoteFavorites); saveLocalPreferences(remoteSlots, remoteFavorites, initialActiveId);
        }
        cloudReadyRef.current = true; setSyncStatus("ready");
        if (!hasSavedData(remoteSlots, remoteFavorites) && hasSavedData(localSlots, localFavorites)) await persistCloudPreferences(localSlots, localFavorites, localPreferences?.activePlaceId ?? null);
        finishInitialLocation();
      } catch {
        setSyncStatus("unavailable"); finishInitialLocation();
      }
    };

    void syncInitialPreferences();
    return () => { cancelled = true; };
  }, [loadPlace, persistCloudPreferences, requestCurrentLocation, saveLocalPreferences]);

  useEffect(() => {
    if (!hasHydrated || query.trim().length < 2) { searchAbortRef.current?.abort(); queueMicrotask(() => { setResults([]); setSearchStatus("idle"); }); return; }
    const controller = new AbortController(); searchAbortRef.current?.abort(); searchAbortRef.current = controller;
    const timer = window.setTimeout(async () => {
      setSearchStatus("loading");
      try { const nextResults = await searchLocations(query.trim(), countryFilter, controller.signal); if (!controller.signal.aborted) { setResults(nextResults); setSearchStatus("ready"); } }
      catch { if (!controller.signal.aborted) { setResults([]); setSearchStatus("error"); } }
    }, 320);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [countryFilter, hasHydrated, query]);

  useEffect(() => {
    if (!hasHydrated || !activePlace) return;
    const interval = window.setInterval(() => { void loadPlace(activePlace); }, WEATHER_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [activePlace, hasHydrated, loadPlace]);

  useEffect(() => {
    actionsRef.current = {
      selectPlace,
      toggleFavorite,
      search: async (input) => {
        const value = input as { query?: unknown; countryCode?: unknown };
        const searchQuery = typeof value?.query === "string" ? value.query.trim() : "";
        if (searchQuery.length < 2) throw new Error("Die Suche benötigt mindestens zwei Zeichen.");
        const filter = typeof value.countryCode === "string" && COUNTRY_CODES.includes(value.countryCode.toUpperCase() as CountryCode) ? value.countryCode.toUpperCase() as CountryCode : "all";
        return searchLocations(searchQuery, filter);
      },
    };
  }, [selectPlace, toggleFavorite]);

  useEffect(() => {
    const modelContext = (document as ModelContextDocument).modelContext;
    if (!modelContext?.registerTool) return;
    const controller = new AbortController();
    const register = async () => {
      await modelContext.registerTool({ name: "find_weather_locations", title: "Wetterorte suchen", description: "Suche einen Ort in Deutschland, Italien, der Schweiz oder Österreich für das Wetter-Dashboard.", inputSchema: { type: "object", properties: { query: { type: "string" }, countryCode: { type: "string", enum: ["DE", "IT", "CH", "AT", "all"] } }, required: ["query"], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: (input) => actionsRef.current.search(input) }, { signal: controller.signal });
      await modelContext.registerTool({ name: "show_weather_location", title: "Wetterort anzeigen", description: "Zeigt Wetter für einen zuvor gespeicherten Ort an.", inputSchema: { type: "object", properties: { placeId: { type: "string" } }, required: ["placeId"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input) => { const placeId = typeof (input as { placeId?: unknown })?.placeId === "string" ? (input as { placeId: string }).placeId : ""; const place = savedPlaces.find((favorite) => favorite.id === placeId); if (!place) throw new Error("Dieser Ort ist noch nicht gespeichert."); await actionsRef.current.selectPlace(place); return { placeId, status: "shown" }; } }, { signal: controller.signal });
      await modelContext.registerTool({ name: "toggle_weather_favorite", title: "Wetterort speichern", description: "Speichert oder entfernt einen von bis zu zehn Wetterfavoriten im geräteübergreifenden persönlichen Speicher.", inputSchema: { type: "object", properties: { placeId: { type: "string" } }, required: ["placeId"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: (input) => { const placeId = typeof (input as { placeId?: unknown })?.placeId === "string" ? (input as { placeId: string }).placeId : ""; const place = favorites.find((favorite) => favorite.id === placeId) ?? (activePlace?.id === placeId ? activePlace : null); if (!place) throw new Error("Dieser Ort wurde nicht gefunden."); actionsRef.current.toggleFavorite(place); return { placeId, status: "updated" }; } }, { signal: controller.signal });
    };
    void register().catch(() => undefined);
    return () => controller.abort();
  }, [activePlace, favorites, savedPlaces]);

  const currentCondition = weather?.current ? weatherCondition(weather.current.weatherCode) : null;
  const currentTone = currentCondition?.tone ?? "unknown";
  const headline = currentCondition?.label ?? "Wetterübersicht";
  const locationCaption = activePlace ? `${countryFlags[activePlace.countryCode]} ${countryLabels[activePlace.countryCode]} · ${formatCoordinates(activePlace.latitude, activePlace.longitude)}` : "Noch kein Ort ausgewählt";
  const visibleHourly = useMemo(() => weather?.hourly ?? [], [weather?.hourly]);
  const visibleDaily = useMemo(() => weather?.daily ?? [], [weather?.daily]);
  const activeSlot = activePlace ? ((favoriteSlots.home?.id === activePlace.id ? "home" : favoriteSlots.work?.id === activePlace.id ? "work" : null) as FavoriteSlot | null) : null;

  return (
    <main className="weather-app">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><Image className="brand-logo" src="/dashboard-logo.svg" alt="" width={38} height={38} priority /></div><div><p className="eyebrow">Persönliches Dashboard</p><p className="brand-title">Wetter</p></div></div>
        <div className="topbar-actions"><div className={`topbar-status topbar-status--${syncStatus}`}><span className="topbar-status__icon" aria-hidden="true">{syncStatus === "ready" ? <Cloud size={15} /> : syncStatus === "loading" ? <RefreshCw size={15} className="spin" /> : <CloudOff size={15} />}</span>{syncStatusText(syncStatus)}</div>{syncStatus === "signed-out" ? <Link className="topbar-login-link" href="/login"><LogIn size={15} aria-hidden="true" /> Anmelden</Link> : null}</div>
      </header>

      <div className="dashboard-shell">
        <section className="intro-row" aria-labelledby="page-title"><div><p className="eyebrow accent-eyebrow">Wetterzentrale</p><h1 id="page-title">Was passiert draußen?</h1><p className="intro-copy">Orte suchen und deinen Standort für Zu Hause und Arbeit geräteübergreifend bereithalten.</p></div><span className={`status-pill status-pill--${weather?.status ?? "loading"}`}><span className="status-pill__dot" aria-hidden="true" />{weatherStatusText(weather?.status ?? "loading")}</span></section>

        <section className="search-panel" aria-label="Ortssuche">
          <div className="search-panel__main"><Search className="search-icon" size={20} aria-hidden="true" /><Input aria-label="Stadt oder Postleitzahl suchen" className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Stadt oder Postleitzahl suchen …" autoComplete="off" />{query ? <button className="clear-search" type="button" aria-label="Suche leeren" onClick={() => setQuery("")}><X size={17} aria-hidden="true" /></button> : null}</div>
          <label className="country-select-wrap"><span className="sr-only">Land einschränken</span><select value={countryFilter} onChange={(event) => setCountryFilter(event.target.value as CountryCode | "all")} aria-label="Land einschränken"><option value="all">Alle vier Länder</option>{COUNTRY_CODES.map((code) => <option key={code} value={code}>{countryFlags[code]} {countryLabels[code]}</option>)}</select></label>
          <Button variant="outline" className="location-button" onClick={requestCurrentLocation} aria-label="Mein Standort verwenden" title="Mein Standort verwenden"><LocateFixed size={17} aria-hidden="true" /><span className="location-button__label">Standort</span></Button>
          {query.trim().length >= 2 ? <div className="search-results" role="listbox" aria-label="Suchergebnisse">
            {searchStatus === "loading" ? <div className="search-message"><RefreshCw size={16} className="spin" /> Orte werden gesucht …</div> : null}
            {searchStatus === "error" ? <div className="search-message search-message--error"><AlertTriangle size={16} /> Ortssuche nicht erreichbar.</div> : null}
            {searchStatus === "ready" && results.length === 0 ? <div className="search-message">Keine Orte gefunden. Versuche einen längeren Namen.</div> : null}
            {results.map((result) => <button key={result.id} type="button" className="search-result" role="option" aria-selected={false} onClick={() => void selectPlace(result)}><span className="search-result__icon"><MapPin size={17} aria-hidden="true" /></span><span className="search-result__text"><strong>{result.name}</strong><small>{result.admin1 ? `${result.admin1} · ` : ""}{countryLabels[result.countryCode]} · {result.timezone}</small></span><span className="search-result__coords">{formatCoordinates(result.latitude, result.longitude)}</span></button>)}
          </div> : null}
        </section>

        <section className="favorite-section" aria-labelledby="saved-slots-title"><div className="section-heading"><div><p className="eyebrow">Deine Orte</p><h2 id="saved-slots-title">Zu Hause und Arbeit</h2></div><span className="section-count">{favoriteSlots.home || favoriteSlots.work ? [favoriteSlots.home, favoriteSlots.work].filter(Boolean).length : 0}/2 gespeichert</span></div>
          <div className="favorites-row favorites-row--named">{(["home", "work"] as FavoriteSlot[]).map((slot) => <AddressSlotEditor key={slot} slot={slot} place={favoriteSlots[slot]} activePlaceId={activePlace?.id ?? null} onSave={savePlaceToSlot} onRemove={removePlaceFromSlot} onSelect={(place) => void selectPlace(place)} />)}</div>
          <div className="favorites-library"><div className="section-heading section-heading--compact"><div><p className="eyebrow">Persönliche Liste</p><h2 id="favorites-title">Favoriten</h2></div><span className="section-count">{favoriteCount}/{MAX_FAVORITES} gespeichert</span></div>{favorites.length ? <div className="favorites-row">{favorites.map((favorite) => <div className={`favorite-chip ${favorite.id === activePlace?.id ? "favorite-chip--selected" : ""}`} key={favorite.id}><button type="button" className="favorite-chip__select" onClick={() => void selectPlace(favorite)} aria-current={favorite.id === activePlace?.id ? "true" : undefined}><span>{countryFlags[favorite.countryCode]} {getPlaceLabel(favorite)}</span></button><button type="button" className="favorite-chip__remove" onClick={() => removeFavorite(favorite.id)} aria-label={`${getPlaceLabel(favorite)} aus Favoriten entfernen`}><X size={14} aria-hidden="true" /></button></div>)}</div> : <p className="empty-favorites"><Star size={16} aria-hidden="true" /> Noch keine Favoriten gespeichert. <span className="empty-favorites__hint">Über den Stern in der Wetterkarte hinzufügen.</span></p>}</div>
          {favoriteNotice ? <p className="helper-line helper-line--sync"><AlertTriangle size={15} aria-hidden="true" /> {favoriteNotice}</p> : null}
          {locationStatus === "denied" ? <p className="helper-line"><Compass size={15} aria-hidden="true" /> Standortzugriff abgelehnt – die Ortssuche bleibt verfügbar.</p> : null}{locationStatus === "unsupported" ? <p className="helper-line"><Compass size={15} aria-hidden="true" /> Dieser Browser stellt keinen Standortzugriff bereit.</p> : null}
          {syncStatus === "signed-out" ? <p className="helper-line helper-line--sync"><CloudOff size={15} aria-hidden="true" /> Zu Hause, Arbeit und deine {MAX_FAVORITES} Favoriten werden hier lokal gemerkt; die geräteübergreifende Ablage benötigt den privaten Sites-Login.</p> : null}{syncStatus === "unavailable" ? <p className="helper-line helper-line--sync"><CloudOff size={15} aria-hidden="true" /> Cloud-Speicher nicht erreichbar. Deine Änderungen bleiben lokal und werden später nicht automatisch als synchronisiert ausgegeben.</p> : null}
        </section>

        <section className={`current-card current-card--${currentTone}`} aria-labelledby="current-title"><div className="current-card__glow" aria-hidden="true" /><div className="current-card__topline"><div className="place-heading"><span className="place-heading__pin"><MapPin size={15} aria-hidden="true" /></span><div><p className="eyebrow">Jetzt</p><h2 id="current-title">{activePlace ? getPlaceLabel(activePlace) : "Mein Wetter"}</h2><p className="place-meta">{locationCaption}</p></div></div><div className="current-card__slot-actions" aria-label="Aktuellen Ort speichern"><button type="button" className={`favorite-action ${activePlace && favoritePlaces.some((favorite) => favorite.id === activePlace.id) ? "favorite-action--active" : ""}`} onClick={() => activePlace && toggleFavorite(activePlace)} disabled={!activePlace || weather?.status === "loading"} aria-label={activePlace && favoritePlaces.some((favorite) => favorite.id === activePlace.id) ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"} title={activePlace && favoritePlaces.some((favorite) => favorite.id === activePlace.id) ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}><Star size={18} fill={activePlace && favoritePlaces.some((favorite) => favorite.id === activePlace.id) ? "currentColor" : "none"} aria-hidden="true" /></button><Button variant="outline" size="sm" className={activeSlot === "home" ? "slot-button--active" : ""} onClick={() => activePlace && savePlaceToSlot("home", activePlace)} disabled={!activePlace || weather?.status === "loading"}><House size={15} aria-hidden="true" />{activeSlot === "home" ? <><Check size={14} aria-hidden="true" /> Zu Hause</> : "Zu Hause"}</Button><Button variant="outline" size="sm" className={activeSlot === "work" ? "slot-button--active" : ""} onClick={() => activePlace && savePlaceToSlot("work", activePlace)} disabled={!activePlace || weather?.status === "loading"}><BriefcaseBusiness size={15} aria-hidden="true" />{activeSlot === "work" ? <><Check size={14} aria-hidden="true" /> Arbeit</> : "Arbeit"}</Button></div></div>
          {weather?.status === "loading" ? <div className="current-loading"><div className="loading-orb" /><div className="loading-lines"><span /><span /><span /></div></div> : weather?.status === "unavailable" || !weather?.current ? <div className="unavailable-state"><div className="unavailable-icon"><AlertTriangle size={25} aria-hidden="true" /></div><div><h3>{weather?.error ?? "Wähle einen Ort, um Wetterdaten zu laden."}</h3><p>Es wurden keine Ersatzwerte eingesetzt. Bitte versuche es später erneut oder suche einen anderen Ort.</p></div>{activePlace ? <Button variant="outline" size="sm" onClick={() => void loadPlace(activePlace)}>Erneut laden</Button> : null}</div> : <div className="current-card__content"><div className="current-main"><div className={`weather-icon weather-icon--${currentTone}`}><WeatherIcon code={weather.current.weatherCode} isDay={weather.current.isDay} size={62} /></div><div><p className="current-temperature">{formatTemperature(weather.current.temperatureC)}</p><p className="current-condition">{headline}</p><p className="current-observation">Gefühlt {formatTemperature(weather.current.feelsLikeC)} · {formatTime(weather.current.time, weather.place.timezone)} Uhr</p></div></div><div className="current-details" aria-label="Aktuelle Wetterdetails"><div className="metric"><Droplets size={17} aria-hidden="true" /><span>Niederschlag</span><strong>{weather.current.precipitationMm.toFixed(1)} mm</strong></div><div className="metric"><Wind size={17} aria-hidden="true" /><span>Wind</span><strong>{Math.round(weather.current.windKmh)} km/h</strong></div><div className="metric"><ArrowUp style={{ transform: `rotate(${weather.current.windDirectionDeg}deg)` }} size={17} aria-hidden="true" /><span>Richtung</span><strong>{Math.round(weather.current.windDirectionDeg)}°</strong></div></div></div>}
          {weather?.status === "partial" ? <p className="partial-note"><AlertTriangle size={14} aria-hidden="true" /> Einige Vorhersagebereiche fehlen momentan.</p> : null}
        </section>

        <section className="forecast-grid" aria-label="Vorhersage"><div className="forecast-panel hourly-panel"><div className="section-heading section-heading--compact"><div><p className="eyebrow">Nächste Stunden</p><h2>24-Stunden-Verlauf</h2></div><span className="section-count">lokale Zeit</span></div><div className="hourly-scroll">{visibleHourly.length ? visibleHourly.map((hour, index) => <div className={`hour-card ${index === 0 ? "hour-card--now" : ""}`} key={`${hour.time}-${index}`}><span className="hour-label">{index === 0 ? "Jetzt" : formatTime(hour.time, weather?.place.timezone)}</span><span className={`hour-icon hour-icon--${weatherTone(hour.weatherCode)}`}><WeatherIcon code={hour.weatherCode} isDay={weather?.current?.isDay ?? true} size={23} /></span><strong>{formatTemperature(hour.temperatureC)}</strong><span className="hour-rain"><Droplets size={12} aria-hidden="true" />{Math.round(hour.precipitationProbabilityPct)}%</span></div>) : <div className="forecast-empty">Die stündliche Vorhersage wird hier angezeigt, sobald ein Ort geladen ist.</div>}</div></div><div className="forecast-panel daily-panel"><div className="section-heading section-heading--compact"><div><p className="eyebrow">Ausblick</p><h2>Die nächsten 7 Tage</h2></div><span className="section-count">Temperatur & Niederschlag</span></div><div className="daily-list">{visibleDaily.length ? visibleDaily.map((day, index) => <div className={`daily-row ${index === 0 ? "daily-row--today" : ""}`} key={day.date}><span className="daily-date">{index === 0 ? "Heute" : formatDay(day.date, weather?.place.timezone)}</span><span className={`daily-icon daily-icon--${weatherTone(day.weatherCode)}`}><WeatherIcon code={day.weatherCode} size={22} /></span><span className="daily-temps"><strong>{formatTemperature(day.maxC)}</strong><span>{formatTemperature(day.minC)}</span></span><span className="daily-rain"><Droplets size={13} aria-hidden="true" />{Math.round(day.precipitationProbabilityPct)}%</span><span className="daily-amount">{day.precipitationMm.toFixed(1)} mm</span></div>) : <div className="forecast-empty">Der 7-Tage-Ausblick wird hier angezeigt, sobald ein Ort geladen ist.</div>}</div></div></section>

        <footer className="data-footer"><span><span className="footer-dot" aria-hidden="true" /> Open-Meteo · Vorhersagemodelle</span><span>{weather?.fetchedAt ? `Abgerufen ${new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(weather.fetchedAt))} Uhr` : "Noch keine Live-Daten"}</span><span><RefreshCw size={12} aria-hidden="true" /> Automatisch alle 5 Minuten</span><span>{weather?.place.timezone ?? "Zeitzone folgt dem Ort"}</span></footer>
      </div>
    </main>
  );
}
