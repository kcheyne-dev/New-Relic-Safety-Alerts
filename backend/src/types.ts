/**
 * Canonical Event shape — what every adapter must produce after normalization.
 * Matches the prototype's alert object so the dashboard stays compatible.
 */
export type Severity = 'low' | 'mod' | 'high' | 'ext';
export type Category = 'natural' | 'civil' | 'public_safety' | 'travel' | 'health';

export interface NormalizedEvent {
  /** Stable per-source ID. Used to upsert. */
  sourceEventId: string;
  /** Source registry id (e.g. 'usgs'). */
  primarySourceId: string;
  title: string;
  summary: string;
  severity: Severity;
  category: Category;
  type: string;            // 'earthquake', 'flood', 'protest', etc.
  location: string;
  lat: number;
  lng: number;
  radiusKm: number | null;
  issuedAt: Date;
  expiresAt: Date | null;
  sourceUrl: string | null;
}

/** What the API returns to the dashboard. */
export interface ApiEvent {
  id: string;
  title: string;
  summary: string;
  sev: Severity;
  type: string;
  source: string;
  location: string;
  lat: number;
  lng: number;
  radiusKm: number | null;
  issued: string;          // ISO 8601
  officeId: string | null; // first matching office, for compatibility with prototype
  affectedOfficeIds: string[];
  sourceUrl: string | null;
  contributingSources: string[];
}

export interface SourceHealth {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  status: 'ok' | 'stale' | 'error';
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  url: string;
}

/** Adapter contract — implemented per source. */
export interface SourceAdapter {
  id: string;
  name: string;
  intervalSeconds: number;
  /** Fetch the source feed and return raw items + their normalized form. */
  fetch(): Promise<RawAndNormalized[]>;
}

export interface RawAndNormalized {
  sourceEventId: string;
  payload: unknown;            // stored as-is in raw_events
  normalized: NormalizedEvent;
}
