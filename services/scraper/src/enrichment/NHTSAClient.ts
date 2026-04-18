// ---------------------------------------------------------------------------
// NHTSA vPIC API client (spec §5.5 / F03.5)
// ---------------------------------------------------------------------------

/**
 * Assembly data parsed from the NHTSA vPIC API response.
 */
export interface AssemblyInfo {
  /** ISO 3166-1 alpha-2 country code (e.g. "US", "JP"). `null` when the API
   *  does not return a recognized country or on error. */
  assemblyCountry: string | null;
  /** Human-readable plant location string (e.g. "Smyrna, TN"). `null` when
   *  city/state data is absent from the API response. */
  assemblyPlant: string | null;
  /** True when `assemblyCountry === "US"` — required for OBBBA deduction
   *  eligibility (spec §6.x). */
  obbbaEligible: boolean;
}

/**
 * Thrown when the NHTSA vPIC API returns a non-200 status or malformed JSON.
 */
export class NHTSAError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "NHTSAError";
  }
}

// ---------------------------------------------------------------------------
// Country name → ISO 3166-1 alpha-2 map
// ---------------------------------------------------------------------------

/**
 * Maps NHTSA `Plant Country` strings (returned verbatim from the API) to
 * ISO 3166-1 alpha-2 codes.  Entries are upper-cased for case-insensitive
 * lookup at runtime.
 */
const COUNTRY_ISO_MAP: Record<string, string> = {
  "UNITED STATES (USA)": "US",
  "UNITED STATES": "US",
  USA: "US",
  JAPAN: "JP",
  MEXICO: "MX",
  CANADA: "CA",
  "SOUTH KOREA": "KR",
  "KOREA, SOUTH": "KR",
  GERMANY: "DE",
  "UNITED KINGDOM": "GB",
  UK: "GB",
  CHINA: "CN",
  INDIA: "IN",
  BRAZIL: "BR",
  SLOVAKIA: "SK",
  HUNGARY: "HU",
  AUSTRIA: "AT",
  SWEDEN: "SE",
  ITALY: "IT",
  SPAIN: "ES",
  FRANCE: "FR",
  BELGIUM: "BE",
  CZECHIA: "CZ",
  "CZECH REPUBLIC": "CZ",
  TURKEY: "TR",
  ROMANIA: "RO",
  FINLAND: "FI",
  NETHERLANDS: "NL",
  TAIWAN: "TW",
  AUSTRALIA: "AU",
  "SOUTH AFRICA": "ZA",
  INDONESIA: "ID",
  THAILAND: "TH",
};

// ---------------------------------------------------------------------------
// vPIC response shape (partial — only the fields we consume)
// ---------------------------------------------------------------------------

interface VpicResult {
  Variable: string;
  Value: string | null;
}

interface VpicResponse {
  Results: VpicResult[];
}

// ---------------------------------------------------------------------------
// NHTSAClient
// ---------------------------------------------------------------------------

/**
 * Thin HTTP client for the NHTSA vPIC public API.
 *
 * The `baseUrl` is injectable via the constructor so tests can point to a
 * mock server without patching `global.fetch`.
 *
 * Uses Node.js 22 built-in `fetch` — no external HTTP dependency.
 */
export class NHTSAClient {
  private readonly baseUrl: string;

  constructor(baseUrl = "https://vpic.nhtsa.dot.gov") {
    this.baseUrl = baseUrl;
  }

  /**
   * Decode a VIN using the NHTSA vPIC API and return assembly location data.
   *
   * @param vin - A 17-character VIN string.  Non-alphanumeric characters are
   *              stripped and the value is upper-cased before use.
   * @throws {NHTSAError} on non-200 HTTP status or unparseable response body.
   */
  async decodeVin(vin: string): Promise<AssemblyInfo> {
    const sanitizedVin = vin.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const url = `${this.baseUrl}/api/vehicles/decodevin/${encodeURIComponent(sanitizedVin)}?format=json`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new NHTSAError(
        `NHTSA vPIC returned HTTP ${response.status} for VIN ${sanitizedVin}`,
        response.status,
      );
    }

    let body: VpicResponse;
    try {
      body = (await response.json()) as VpicResponse;
    } catch {
      throw new NHTSAError(
        `NHTSA vPIC returned non-JSON body for VIN ${sanitizedVin}`,
      );
    }

    if (!Array.isArray(body?.Results)) {
      throw new NHTSAError(
        `NHTSA vPIC response missing 'Results' array for VIN ${sanitizedVin}`,
      );
    }

    const findValue = (variable: string): string | null => {
      const entry = body.Results.find(
        (r) => r.Variable.trim() === variable,
      );
      const val = entry?.Value?.trim() ?? null;
      return val && val !== "" && val !== "Not Applicable" ? val : null;
    };

    const rawCountry = findValue("Plant Country");
    const city = findValue("Plant City");
    const state = findValue("Plant State");

    const assemblyCountry = rawCountry
      ? (COUNTRY_ISO_MAP[rawCountry.toUpperCase()] ?? null)
      : null;

    if (rawCountry && !assemblyCountry) {
      console.log(
        JSON.stringify({
          level: "warn",
          message: "NHTSA Plant Country not in ISO map",
          vin: sanitizedVin,
          rawCountry,
        }),
      );
    }

    const assemblyPlantParts = [city, state].filter(Boolean);
    const assemblyPlant =
      assemblyPlantParts.length > 0 ? assemblyPlantParts.join(", ") : null;

    const obbbaEligible = assemblyCountry === "US";

    return { assemblyCountry, assemblyPlant, obbbaEligible };
  }
}
