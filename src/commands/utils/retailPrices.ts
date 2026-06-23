import { Errorable, getErrorMessage } from "./errorable";

const RETAIL_PRICES_ENDPOINT = "https://prices.azure.com/api/retail/prices";
const API_VERSION = "2023-01-01-preview";
const CURRENCY_CODE = "USD";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

export async function fetchRetailPrices(filter: string): Promise<Errorable<RetailPriceItem[]>> {
    const cached = cache.get(filter);
    if (cached && cached.expiresAt > Date.now()) {
        return { succeeded: true, result: cached.items };
    }

    const items: RetailPriceItem[] = [];
    let nextUrl: string | null = buildInitialUrl(filter);

    try {
        while (nextUrl) {
            const response = await fetch(nextUrl);
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

function buildInitialUrl(filter: string): string {
    const query = `api-version=${API_VERSION}&currencyCode=${CURRENCY_CODE}&$filter=${encodeURIComponent(filter)}`;
    return `${RETAIL_PRICES_ENDPOINT}?${query}`;
}
