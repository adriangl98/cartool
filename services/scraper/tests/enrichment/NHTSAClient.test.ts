import { NHTSAClient, NHTSAError } from "../../src/enrichment/NHTSAClient";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVpicResponse(results: Array<{ Variable: string; Value: string | null }>) {
  return {
    Results: results,
  };
}

function mockFetchOk(body: unknown): void {
  jest.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockFetchStatus(status: number): void {
  jest.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as Response);
}

function usTundraResults() {
  return makeVpicResponse([
    { Variable: "Plant Country", Value: "UNITED STATES (USA)" },
    { Variable: "Plant City", Value: "San Antonio" },
    { Variable: "Plant State", Value: "TX" },
    { Variable: "Make", Value: "Toyota" },
    { Variable: "Model", Value: "Tundra" },
  ]);
}

function japanResults() {
  return makeVpicResponse([
    { Variable: "Plant Country", Value: "JAPAN" },
    { Variable: "Plant City", Value: "Tahara" },
    { Variable: "Plant State", Value: null },
    { Variable: "Make", Value: "Toyota" },
    { Variable: "Model", Value: "4Runner" },
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NHTSAClient.decodeVin", () => {
  let client: NHTSAClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    // Point at a dummy base URL — fetch is mocked so the URL is never hit.
    client = new NHTSAClient("https://mock-vpic.local");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── US assembly (Toyota Tundra) ───────────────────────────────────────────

  it("returns assemblyCountry='US' and obbbaEligible=true for a US-assembled VIN", async () => {
    mockFetchOk(usTundraResults());

    const result = await client.decodeVin("5TFDW5F15HX640000");

    expect(result.assemblyCountry).toBe("US");
    expect(result.obbbaEligible).toBe(true);
  });

  it("returns assemblyPlant='San Antonio, TX' for the Tundra VIN", async () => {
    mockFetchOk(usTundraResults());

    const result = await client.decodeVin("5TFDW5F15HX640000");

    expect(result.assemblyPlant).toBe("San Antonio, TX");
  });

  // ── Japan assembly (Toyota 4Runner) ──────────────────────────────────────

  it("returns assemblyCountry='JP' and obbbaEligible=false for a Japan-assembled VIN", async () => {
    mockFetchOk(japanResults());

    const result = await client.decodeVin("JTEBU5JR8G5408415");

    expect(result.assemblyCountry).toBe("JP");
    expect(result.obbbaEligible).toBe(false);
  });

  it("returns assemblyPlant with only city when state is null", async () => {
    mockFetchOk(japanResults());

    const result = await client.decodeVin("JTEBU5JR8G5408415");

    expect(result.assemblyPlant).toBe("Tahara");
  });

  // ── Missing / null Plant Country ──────────────────────────────────────────

  it("returns assemblyCountry=null and obbbaEligible=false when Plant Country is absent", async () => {
    mockFetchOk(
      makeVpicResponse([
        { Variable: "Plant City", Value: "Unknown City" },
        { Variable: "Plant State", Value: "Unknown" },
      ]),
    );

    const result = await client.decodeVin("1NXBR32E25Z395049");

    expect(result.assemblyCountry).toBeNull();
    expect(result.obbbaEligible).toBe(false);
  });

  it("returns assemblyCountry=null when Plant Country Value is null", async () => {
    mockFetchOk(
      makeVpicResponse([
        { Variable: "Plant Country", Value: null },
        { Variable: "Plant City", Value: "Detroit" },
        { Variable: "Plant State", Value: "MI" },
      ]),
    );

    const result = await client.decodeVin("1FTFW1EF0EFA12345");

    expect(result.assemblyCountry).toBeNull();
  });

  it("returns assemblyCountry=null when Plant Country is 'Not Applicable'", async () => {
    mockFetchOk(
      makeVpicResponse([
        { Variable: "Plant Country", Value: "Not Applicable" },
        { Variable: "Plant City", Value: null },
        { Variable: "Plant State", Value: null },
      ]),
    );

    const result = await client.decodeVin("1FTFW1EF0EFA12345");

    expect(result.assemblyCountry).toBeNull();
  });

  // ── Unmapped country ──────────────────────────────────────────────────────

  it("returns assemblyCountry=null and logs a warning for an unmapped country", async () => {
    mockFetchOk(
      makeVpicResponse([
        { Variable: "Plant Country", Value: "ATLANTIS" },
        { Variable: "Plant City", Value: null },
        { Variable: "Plant State", Value: null },
      ]),
    );

    const result = await client.decodeVin("1FTFW1EF0EFA12345");

    expect(result.assemblyCountry).toBeNull();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("NHTSA Plant Country not in ISO map"),
    );
  });

  // ── assemblyPlant is null when both city and state are absent ────────────

  it("returns assemblyPlant=null when both city and state are null", async () => {
    mockFetchOk(
      makeVpicResponse([
        { Variable: "Plant Country", Value: "MEXICO" },
        { Variable: "Plant City", Value: null },
        { Variable: "Plant State", Value: null },
      ]),
    );

    const result = await client.decodeVin("3VWXX7AJ0DM000001");

    expect(result.assemblyCountry).toBe("MX");
    expect(result.assemblyPlant).toBeNull();
  });

  // ── VIN sanitization ──────────────────────────────────────────────────────

  it("strips non-alphanumeric chars from the VIN before building the URL", async () => {
    mockFetchOk(usTundraResults());
    const fetchSpy = jest.spyOn(global, "fetch");

    // Already set up one mock above; need a fresh spy to capture the URL.
    jest.restoreAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(usTundraResults()),
    } as Response);

    await client.decodeVin("5TFDW5F15HX640000");

    const calledUrl = (fetchSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(calledUrl).not.toMatch(/[^A-Za-z0-9%/.:?=&_-]/);
  });

  it("upper-cases the VIN in the request URL", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(usTundraResults()),
    } as Response);

    await client.decodeVin("5tfdw5f15hx640000");

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("5TFDW5F15HX640000");
  });

  // ── HTTP error handling ───────────────────────────────────────────────────

  it("throws NHTSAError when the API returns HTTP 500", async () => {
    mockFetchStatus(500);

    await expect(client.decodeVin("5TFDW5F15HX640000")).rejects.toThrow(NHTSAError);
  });

  it("includes the HTTP status code in the NHTSAError", async () => {
    mockFetchStatus(503);

    await expect(client.decodeVin("5TFDW5F15HX640000")).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("throws NHTSAError when the response body is not valid JSON", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    } as unknown as Response);

    await expect(client.decodeVin("5TFDW5F15HX640000")).rejects.toThrow(NHTSAError);
  });

  it("throws NHTSAError when the response body is missing the Results array", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ Count: 0 }),
    } as Response);

    await expect(client.decodeVin("5TFDW5F15HX640000")).rejects.toThrow(NHTSAError);
  });

  // ── Mexico / Canada ───────────────────────────────────────────────────────

  it("maps 'MEXICO' to 'MX'", async () => {
    mockFetchOk(
      makeVpicResponse([
        { Variable: "Plant Country", Value: "MEXICO" },
        { Variable: "Plant City", Value: "Toluca" },
        { Variable: "Plant State", Value: null },
      ]),
    );

    const result = await client.decodeVin("3VWXX7AJ0DM000001");

    expect(result.assemblyCountry).toBe("MX");
    expect(result.obbbaEligible).toBe(false);
  });

  it("maps 'CANADA' to 'CA'", async () => {
    mockFetchOk(
      makeVpicResponse([
        { Variable: "Plant Country", Value: "CANADA" },
        { Variable: "Plant City", Value: "Cambridge" },
        { Variable: "Plant State", Value: "ON" },
      ]),
    );

    const result = await client.decodeVin("2T1BURHE0EC000001");

    expect(result.assemblyCountry).toBe("CA");
    expect(result.obbbaEligible).toBe(false);
  });
});
