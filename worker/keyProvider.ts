import type { Provider } from "./providers";

export interface KeyPurchaseInput {
  productPid: string;
  duration: string;
  quantity: number;
  androidId?: string;
  androidRequired?: boolean;
}
export interface KeyPurchaseResult {
  keys: string[];
  totalPrice: number | null;
  providerReference: string | null;
  rawStatus: string;
}

function validateEndpoint(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new Error("API endpoint must use HTTPS");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) throw new Error("Private API hosts are not allowed");
  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a,b] = octets;
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) throw new Error("Private API hosts are not allowed");
  }
  if (!host.includes(".") && !host.includes(":")) throw new Error("A public API host name is required");
  return url.toString();
}

/** Reseller V1 key purchase adapter. Credentials are read only from the server-side providers table. */
export async function buyKeys(provider: Provider & { api_mode?: string; master_key?: string | null }, input: KeyPurchaseInput): Promise<KeyPurchaseResult> {
  if (provider.api_mode !== "reseller_v1") throw new Error("PROVIDER_MODE_MISMATCH");
  if (!provider.api_key || !provider.master_key) throw new Error("PROVIDER_CREDENTIALS_MISSING");
  if (!input.productPid.trim() || !input.duration.trim()) throw new Error("PRODUCT_MAPPING_MISSING");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) throw new Error("INVALID_QUANTITY");
  if (input.androidRequired && !input.androidId?.trim()) throw new Error("ANDROID_ID_REQUIRED");

  const form = new URLSearchParams({
    api_key: provider.api_key,
    action: "buy",
    product_id: input.productPid,
    duration: input.duration,
    quantity: String(input.quantity),
  });
  if (input.androidId?.trim()) form.set("android_id", input.androidId.trim());

  const response = await fetch(validateEndpoint(provider.api_url), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "x-master-key": provider.master_key },
    body: form,
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`);
  const data: any = await response.json().catch(() => { throw new Error("PROVIDER_INVALID_JSON"); });
  const status = String(data?.status ?? data?.success ?? "").toLowerCase();
  if (!(status === "success" || status === "1" || data?.success === true)) {
    throw new Error(String(data?.message ?? data?.error ?? "PROVIDER_REJECTED").slice(0, 180));
  }
  const source = Array.isArray(data?.keys) ? data.keys : data?.key ? [data.key] : [];
  const keys = source.map((v: unknown) => String(v ?? "").trim()).filter(Boolean);
  if (keys.length !== input.quantity) {
    // Do not silently mark an incomplete provider response as delivered.
    throw new Error(`PROVIDER_KEY_COUNT_MISMATCH_${keys.length}_OF_${input.quantity}`);
  }
  const total = Number(data?.total_price);
  return {
    keys,
    totalPrice: Number.isFinite(total) ? total : null,
    providerReference: data?.order_id == null ? null : String(data.order_id).slice(0, 120),
    rawStatus: status || "success",
  };
}
