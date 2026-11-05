/**
 * The SEC client: the only code that talks to EDGAR. SEC's fair-access rules
 * (https://www.sec.gov/os/accessing-edgar-data): every request declares who
 * is asking in its User-Agent, a name and a contact, and the client stays
 * under ten requests a second. Here one request starts at most every 150 ms,
 * and a 429, a 5xx or a network error backs off 2, 4, 8, 16 s (or the
 * server's Retry-After, when longer) before giving up.
 *
 * The User-Agent comes from `SEC_USER_AGENT`, set by the operator; the client
 * refuses to run without one. Never write a personal email into code or
 * config.
 */

export const SEC_MIN_GAP_MS = 150;
export const SEC_RETRIES = 4;
export const SEC_BACKOFF_MS = 2_000;

export const EFTS_SEARCH_URL = "https://efts.sec.gov/LATEST/search-index";
export const EDGAR_ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type Sleep = (milliseconds: number) => Promise<void>;
export type Get = (url: string) => Promise<Response>;

export const sleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const EMAIL = /[^\s()<>]+@[^\s()<>@]+\.[A-Za-z]{2,}/;
const HTTPS_URL = /https:\/\/[^\s()<>/]+\.[^\s()<>/]+[^\s()<>]*/;

/**
 * The User-Agent SEC asks for: a name and a contact, the contact an email or
 * an https URL (`OpenMarket-Index/0.1 (+https://openmarket.systems)`).
 * Throws without one.
 */
export function requireSecUserAgent(value: string | undefined): string {
  const userAgent = value?.trim() ?? "";
  const contact = EMAIL.exec(userAgent)?.[0] ?? HTTPS_URL.exec(userAgent)?.[0];
  const name = contact === undefined ? "" : userAgent.replace(contact, "").replace(/[()+<>]/g, "");
  if (contact === undefined || !/[A-Za-z]/.test(name)) {
    throw new Error(
      'set SEC_USER_AGENT to a name and a contact (an email or an https URL), e.g. "OpenMarket-Index/0.1 (+https://openmarket.systems)"',
    );
  }
  return userAgent;
}

export interface PoliteFetcherOptions {
  readonly minGapMs: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: Fetch;
  readonly sleep?: Sleep;
  readonly retries?: number;
  readonly backoffMs?: number;
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get("retry-after");
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0;
}

/**
 * GET with a minimum gap between request starts (a token bucket of one) and
 * retries on 429, 5xx or a network error, backing off exponentially.
 */
export function politeFetcher(options: PoliteFetcherOptions): Get {
  const doFetch = options.fetch ?? fetch;
  const wait = options.sleep ?? sleep;
  const retries = options.retries ?? SEC_RETRIES;
  const backoff = options.backoffMs ?? SEC_BACKOFF_MS;
  let next = 0;
  return async function get(url: string): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const gap = next - Date.now();
      if (gap > 0) await wait(gap);
      next = Date.now() + options.minGapMs;
      let delay = backoff * 2 ** attempt;
      try {
        const response = await doFetch(url, { headers: { ...options.headers } });
        if (response.status !== 429 && response.status < 500) return response;
        if (attempt >= retries) return response;
        delay = Math.max(delay, retryAfterMs(response));
        await response.body?.cancel();
      } catch (error) {
        if (attempt >= retries) throw error;
      }
      await wait(delay);
    }
  };
}

export class SecFetchError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string) {
    super(`${status} from ${url}`);
    this.name = "SecFetchError";
    this.status = status;
    this.url = url;
  }
}

/** What ingest needs from EDGAR: a document's text, or a JSON body. */
export interface SecClient {
  readonly userAgent: string;
  text(url: string): Promise<string>;
  json(url: string): Promise<unknown>;
}

export interface SecClientOptions {
  /** Defaults to `process.env.SEC_USER_AGENT`. */
  readonly userAgent?: string;
  readonly fetch?: Fetch;
  readonly sleep?: Sleep;
  readonly minGapMs?: number;
}

export function createSecClient(options: SecClientOptions = {}): SecClient {
  const userAgent = requireSecUserAgent(options.userAgent ?? process.env.SEC_USER_AGENT);
  const get = politeFetcher({
    minGapMs: options.minGapMs ?? SEC_MIN_GAP_MS,
    headers: { "User-Agent": userAgent, "Accept-Encoding": "gzip, deflate" },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
  async function ok(url: string): Promise<Response> {
    const response = await get(url);
    if (!response.ok) {
      await response.body?.cancel();
      throw new SecFetchError(response.status, url);
    }
    return response;
  }
  return {
    userAgent,
    async text(url) {
      return (await ok(url)).text();
    },
    async json(url) {
      return (await ok(url)).json();
    },
  };
}

/** `0000707823` → `707823`: EDGAR's archive paths take the CIK without padding. */
export function normalizeCik(cik: string): string {
  const digits = cik.trim().replace(/^0+/, "");
  if (!/^\d+$/.test(digits)) throw new Error(`not a CIK: ${cik}`);
  return digits;
}

/** A document inside one filing's archive folder. */
export function filingDocumentUrl(cik: string, accession: string, fileName: string): string {
  return `${EDGAR_ARCHIVES_URL}/${normalizeCik(cik)}/${accession.replaceAll("-", "")}/${fileName}`;
}

/** An N-PORT filing's form, the XML its holdings are read from. */
export function nportPrimaryDocumentUrl(cik: string, accession: string): string {
  return filingDocumentUrl(cik, accession, "primary_doc.xml");
}
