import { Errorable, getErrorMessage } from "./errorable";

const RETAIL_PRICES_ENDPOINT = "https://prices.azure.com/api/retail/prices";
const API_VERSION = "2023-01-01-preview";
const CURRENCY_CODE = "USD";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// The Retail Prices endpoint is public, unauthenticated, and shared, so it is
// aggressively rate limited (HTTP 429). To stay under the limit we:
//   1. serialize every outbound request through a single queue and keep a
//      minimum gap between them (pagination + multiple filters + rapid region
//      changes otherwise burst dozens of requests at once),
//   2. retry transient failures with capped exponential backoff + jitter while
//      honoring any `Retry-After` header the service returns, and
//   3. coalesce concurrent callers for the same filter onto one request.
const MIN_REQUEST_SPACING_MS = 250;
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 20000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export interface RetailPriceItem {
    currencyCode: string;
    retailPrice: number;
    unitPrice: number;
    armRegionName: string;
    location: string;
    meterName: string;
    productName: string;
    skuName: string;
    serviceName: string;
    armSkuName: string;
    unitOfMeasure: string;
    type: string;
    isPrimaryMeterRegion: boolean;
}

interface RetailPricesResponse {
    Items?: RetailPriceItem[];
    NextPageLink?: string | null;
}

interface CacheEntry {
    expiresAt: number;
    items: RetailPriceItem[];
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Errorable<RetailPriceItem[]>>>();

export async function fetchRetailPrices(filter: string): Promise<Errorable<RetailPriceItem[]>> {
    const cached = cache.get(filter);
    if (cached && cached.expiresAt > Date.now()) {
        return { succeeded: true, result: cached.items };
    }

    // Coalesce concurrent callers for the same filter onto a single request so
    // pagination and rapid region switching don't fan out into duplicate calls.
    const existing = inFlight.get(filter);
    if (existing) {
        return existing;
    }

    const request = fetchAllPages(filter);
    inFlight.set(filter, request);
    try {
        return await request;
    } finally {
        inFlight.delete(filter);
    }
}

async function fetchAllPages(filter: string): Promise<Errorable<RetailPriceItem[]>> {
    const items: RetailPriceItem[] = [];
    let nextUrl: string | null = buildInitialUrl(filter);

    try {
        while (nextUrl) {
            const response = await fetchWithRetry(nextUrl);
            if (!response.ok) {
                return {
                    succeeded: false,
                    error: `Azure Retail Prices API returned status ${response.status} (${response.statusText}).`,
                };
            }
            const page = (await response.json()) as RetailPricesResponse;
            if (page.Items) {
                items.push(...page.Items);
            }
            nextUrl = page.NextPageLink ?? null;
        }
    } catch (e) {
        return {
            succeeded: false,
            error: `Unable to fetch data from the Azure Retail Prices API: ${getErrorMessage(e)}`,
        };
    }

    cache.set(filter, { expiresAt: Date.now() + CACHE_TTL_MS, items });
    return { succeeded: true, result: items };
}

// Retry transient failures (429 plus transient 5xx/408) with capped exponential
// backoff. Honors the `Retry-After` header when the service provides one.
async function fetchWithRetry(url: string): Promise<Response> {
    let response = await schedule(() => fetch(url));
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (response.ok || !RETRYABLE_STATUS.has(response.status)) {
            return response;
        }
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        // Release the connection before waiting so the retry starts clean.
        await response.body?.cancel();
        await delay(backoffDelay(attempt, retryAfterMs));
        response = await schedule(() => fetch(url));
    }
    return response;
}

// Serialize all outbound requests and keep a minimum gap between them so bursts
// don't trip the rate limiter.
let requestChain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
        const wait = lastRequestAt + MIN_REQUEST_SPACING_MS - Date.now();
        if (wait > 0) {
            await delay(wait);
        }
        try {
            return await task();
        } finally {
            lastRequestAt = Date.now();
        }
    };

    const result = requestChain.then(run, run);
    // Keep the chain alive regardless of how the individual task settled.
    requestChain = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

function parseRetryAfter(header: string | null): number | null {
    if (!header) {
        return null;
    }
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1000);
    }
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) {
        return Math.max(0, dateMs - Date.now());
    }
    return null;
}

function backoffDelay(attempt: number, retryAfterMs: number | null): number {
    if (retryAfterMs !== null) {
        return Math.min(retryAfterMs, MAX_BACKOFF_MS);
    }
    const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
    // Full jitter keeps multiple clients from retrying in lockstep.
    return Math.random() * exponential;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildInitialUrl(filter: string): string {
    const query = `api-version=${API_VERSION}&currencyCode=${CURRENCY_CODE}&$filter=${encodeURIComponent(filter)}`;
    return `${RETAIL_PRICES_ENDPOINT}?${query}`;
}
