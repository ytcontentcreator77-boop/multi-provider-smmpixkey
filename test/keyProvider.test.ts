import { afterEach, describe, expect, it, vi } from "vitest";
import { buyKeys } from "../worker/keyProvider";

const provider = {
  id: 1,
  name: "Test reseller",
  api_url: "https://reseller.example/api/reseller_v1.php",
  api_key: "test-token",
  master_key: "test-master",
  api_mode: "reseller_v1",
  usd_rate: 1,
  enabled: 1,
};

afterEach(() => vi.unstubAllGlobals());

describe("reseller V1 key delivery", () => {
  it("sends the documented form fields and parses bulk keys", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body ?? ""));
      expect(form.get("api_key")).toBe("test-token");
      expect(form.get("action")).toBe("buy");
      expect(form.get("product_id")).toBe("PID-42");
      expect(form.get("duration")).toBe("3 Days");
      expect(form.get("quantity")).toBe("2");
      expect(form.get("android_id")).toBe("device-123");
      expect(new Headers(init?.headers).get("x-master-key")).toBe("test-master");
      return new Response(JSON.stringify({ status: "success", keys: ["KEY-A", "KEY-B"], quantity: 2, total_price: 4.5, order_id: 91 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await buyKeys(provider, { productPid: "PID-42", duration: "3 Days", quantity: 2, androidId: "device-123", androidRequired: true });
    expect(result.keys).toEqual(["KEY-A", "KEY-B"]);
    expect(result.totalPrice).toBe(4.5);
    expect(result.providerReference).toBe("91");
  });

  it("rejects a response with fewer keys than requested", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "success", keys: ["ONLY-ONE"] }), { status: 200 })));
    await expect(buyKeys(provider, { productPid: "PID-42", duration: "1 Day", quantity: 2 })).rejects.toThrow("PROVIDER_KEY_COUNT_MISMATCH_1_OF_2");
  });

  it("requires Android ID only when the product needs it", async () => {
    await expect(buyKeys(provider, { productPid: "PID-42", duration: "1 Day", quantity: 1, androidRequired: true })).rejects.toThrow("ANDROID_ID_REQUIRED");
  });
});
