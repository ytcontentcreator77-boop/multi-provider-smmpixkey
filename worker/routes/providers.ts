import { Hono } from "hono";
import { isOwner } from "../env";
import { getProvider, importServices, listRemote, smm, type Provider } from "../providers";
import { type AppEnv, err } from "./app";
import { tg } from "../telegram";

export const providers = new Hono<AppEnv>();
providers.use("*", async (c, next) => (isOwner(c.env, c.get("settings"), c.get("user").id) ? next() : err(c, 403, "FORBIDDEN")));

const mask = (p: Provider) => ({ ...p, api_key: p.api_key.slice(0, 4) + "••••", master_key: p.master_key ? "••••••••" : null });

providers.get("/providers", async (c) => c.json({ items: (await c.env.DB.prepare("SELECT * FROM providers ORDER BY id").all<Provider>()).results.map(mask) }));

providers.post("/providers", async (c) => {
  const b = await c.req.json<{ name: string; api_url: string; api_key: string; master_key?: string; api_mode?: string; android_required?: boolean; usd_rate?: number }>().catch(() => null);
  if (!b?.name || !b.api_url || !b.api_key) return err(c, 400, "BAD_REQUEST");
  const mode = b.api_mode === "reseller_v1" ? "reseller_v1" : "smm_v2";
  if (mode === "reseller_v1" && !b.master_key) return err(c, 400, "MASTER_KEY_REQUIRED");
  if (mode === "smm_v2") { try { await smm({ api_url: b.api_url, api_key: b.api_key }, "balance"); } catch { return err(c, 400, "PROVIDER_REJECTED"); } }
  const r = await c.env.DB.prepare("INSERT INTO providers (name, api_url, api_key, master_key, api_mode, android_required, usd_rate, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)").bind(b.name.slice(0, 60), b.api_url, b.api_key, b.master_key ?? null, mode, b.android_required ? 1 : 0, b.usd_rate || 1, Date.now()).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});


providers.put("/providers/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const current = await getProvider(c.env, id);
  if (!current) return err(c, 404, "NOT_FOUND");
  const b = await c.req.json<{ name?: string; api_url?: string; api_key?: string; master_key?: string; api_mode?: string; android_required?: boolean; usd_rate?: number; enabled?: boolean }>().catch(() => null);
  if (!b) return err(c, 400, "BAD_REQUEST");
  const next = { ...current, ...b };
  const nextMode = b.api_mode ?? current.api_mode ?? "smm_v2";
  if (nextMode === "reseller_v1" && !(b.master_key ?? current.master_key)) return err(c,400,"MASTER_KEY_REQUIRED");
  const credentialsChanged = (b.api_url !== undefined && b.api_url !== current.api_url) || (b.api_key !== undefined && b.api_key !== current.api_key) || (b.master_key !== undefined && b.master_key !== current.master_key) || (b.api_mode !== undefined && b.api_mode !== current.api_mode);
  if (credentialsChanged) {
    const active = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE provider_id = ?1 AND status IN ('submitting','pending','processing','in_progress')").bind(id).first<{n:number}>();
    const activeKeys = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM key_orders WHERE provider_id=?1 AND status IN ('processing','review')").bind(id).first<{n:number}>();
    if ((active?.n ?? 0) + (activeKeys?.n ?? 0) > 0) return err(c, 409, "PROVIDER_HAS_OPEN_ORDERS", { count: (active?.n ?? 0) + (activeKeys?.n ?? 0) });
    if (nextMode !== "reseller_v1") { try { await smm({ api_url: next.api_url, api_key: next.api_key }, "balance"); } catch { return err(c, 400, "PROVIDER_REJECTED"); } }
  }
  if (b.usd_rate !== undefined && (!Number.isFinite(b.usd_rate) || b.usd_rate <= 0)) return err(c, 400, "BAD_REQUEST");
  await c.env.DB.prepare("UPDATE providers SET name=?1,api_url=?2,api_key=?3,master_key=?4,api_mode=?5,android_required=?6,usd_rate=?7,enabled=?8 WHERE id=?9")
    .bind((next.name || current.name).slice(0,60), next.api_url || current.api_url, next.api_key || current.api_key, b.master_key ?? current.master_key ?? null, b.api_mode ?? current.api_mode ?? "smm_v2", b.android_required === undefined ? (current.android_required ?? 0) : +b.android_required, next.usd_rate || current.usd_rate, b.enabled === undefined ? current.enabled : +b.enabled, id).run();
  return c.json({ ok: true });
});

providers.delete("/providers/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const active = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE provider_id = ?1 AND status IN ('submitting','pending','processing','in_progress')").bind(id).first<{n:number}>();
  if ((active?.n ?? 0) > 0) return err(c, 409, "PROVIDER_HAS_OPEN_ORDERS", { count: active?.n });
  const keyProducts = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM key_products WHERE provider_id=?1").bind(id).first<{n:number}>();
  if ((keyProducts?.n ?? 0) > 0) return err(c,409,"PROVIDER_HAS_KEY_PRODUCTS",{count:keyProducts?.n});
  await c.env.DB.prepare("UPDATE services SET enabled = 0 WHERE provider_id = ?1").bind(id).run();
  await c.env.DB.prepare("DELETE FROM providers WHERE id = ?1").bind(id).run();
  return c.json({ ok: true });
});

/** Categories (with counts and cheapest rate) of one provider, to pick from before importing. */
providers.get("/providers/:id/catalog", async (c) => {
  const p = await getProvider(c.env, Number(c.req.param("id")));
  if (!p) return err(c, 404, "NOT_FOUND");
  const q = (c.req.query("category") ?? "").toLowerCase();
  const all = await listRemote(p);
  const cats = new Map<string, number>();
  for (const s of all) cats.set(s.category, (cats.get(s.category) ?? 0) + 1);
  const services = q ? all.filter((s) => s.category.toLowerCase() === q).slice(0, 500) : [];
  return c.json({ categories: [...cats].map(([name, count]) => ({ name, count })), services });
});

providers.post("/providers/:id/import", async (c) => {
  const p = await getProvider(c.env, Number(c.req.param("id")));
  const b = await c.req.json<{ ids: (string | number)[]; platform: string }>().catch(() => null);
  if (!p || !p.enabled || !b?.ids?.length) return err(c, 400, "BAD_REQUEST");
  return c.json({ ok: true, imported: await importServices(c.env, p, b.ids.slice(0, 500), b.platform || "other") });
});

providers.put("/icons/service/:id", async (c) => {
  const b = await c.req.json<{ icon: string }>().catch(() => null);
  await c.env.DB.prepare("UPDATE services SET icon = ?1 WHERE id = ?2").bind((b?.icon ?? "").slice(0, 300), Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

providers.put("/icons/category", async (c) => {
  const b = await c.req.json<{ platform: string; category: string; icon: string }>().catch(() => null);
  if (!b) return err(c, 400, "BAD_REQUEST");
  await c.env.DB.prepare("INSERT INTO category_icons (platform, category, icon) VALUES (?1,?2,?3) ON CONFLICT DO UPDATE SET icon = excluded.icon").bind(b.platform, b.category, b.icon.slice(0, 300)).run();
  return c.json({ ok: true });
});

providers.get("/currencies", async (c) => c.json({ items: (await c.env.DB.prepare("SELECT * FROM currencies ORDER BY code").all()).results }));
providers.put("/currencies/:code", async (c) => {
  const b = await c.req.json<{ per_usd?: number; enabled?: boolean }>().catch(() => null);
  if (!b) return err(c, 400, "BAD_REQUEST");
  await c.env.DB.prepare("UPDATE currencies SET per_usd = COALESCE(?1, per_usd), enabled = COALESCE(?2, enabled) WHERE code = ?3").bind(b.per_usd ?? null, b.enabled === undefined ? null : +b.enabled, c.req.param("code")).run();
  return c.json({ ok: true });
});

providers.get("/payment-methods", async (c) => c.json({ items: (await c.env.DB.prepare("SELECT id,name,kind,currency,details,min_amount,fee_pct,icon,enabled,sort FROM payment_methods ORDER BY sort").all()).results }));

providers.post("/payment-methods", async (c) => {
  const b = await c.req.json<{id:string;name:string;currency:string;details?:string;icon?:string;sort?:number}>().catch(() => null);
  const id=String(b?.id??"").toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,40);
  if (!id || !b?.name?.trim() || !/^[A-Z]{3}$/.test(b.currency || "")) return err(c,400,"BAD_REQUEST");
  const currency=await c.env.DB.prepare("SELECT 1 FROM currencies WHERE code=?1").bind(b.currency).first(); if(!currency) return err(c,400,"INVALID_CURRENCY");
  await c.env.DB.prepare("INSERT INTO payment_methods(id,name,kind,currency,details,icon,enabled,sort) VALUES(?1,?2,'manual',?3,?4,?5,0,?6)")
    .bind(id,b.name.trim().slice(0,80),b.currency,b.details??"",b.icon??"",Number(b.sort)||0).run();
  return c.json({ok:true});
});
providers.delete("/payment-methods/:id", async (c) => {
  const id=c.req.param("id");
  if (id === "stars") return err(c,400,"CANNOT_DELETE_STARS");
  const used=await c.env.DB.prepare("SELECT COUNT(*) AS n FROM manual_deposits WHERE method_id=?1").bind(id).first<{n:number}>();
  if ((used?.n??0)>0) return err(c,409,"METHOD_HAS_DEPOSIT_HISTORY");
  await c.env.DB.prepare("DELETE FROM payment_methods WHERE id=?1").bind(id).run(); return c.json({ok:true});
});

providers.put("/payment-methods/:id", async (c) => {
  const b = await c.req.json<Record<string, any>>().catch(() => null);
  if (!b) return err(c, 400, "BAD_REQUEST");
  if (b.fee_pct !== undefined && (!Number.isFinite(Number(b.fee_pct)) || Number(b.fee_pct)<0 || Number(b.fee_pct)>100)) return err(c,400,"INVALID_FEE");
  if (b.min_amount !== undefined && (!Number.isFinite(Number(b.min_amount)) || Number(b.min_amount)<0)) return err(c,400,"INVALID_MIN_AMOUNT");
  if (b.currency !== undefined && !/^[A-Z]{3}$/.test(String(b.currency))) return err(c,400,"INVALID_CURRENCY");
  if (b.currency !== undefined && !(await c.env.DB.prepare("SELECT 1 FROM currencies WHERE code=?1").bind(b.currency).first())) return err(c,400,"INVALID_CURRENCY");
  await c.env.DB.prepare("UPDATE payment_methods SET name=COALESCE(?1,name), details=COALESCE(?2,details), currency=COALESCE(?3,currency), min_amount=COALESCE(?4,min_amount), fee_pct=COALESCE(?5,fee_pct), icon=COALESCE(?6,icon), enabled=COALESCE(?7,enabled), api_url=COALESCE(?8,api_url), api_key=COALESCE(?9,api_key) WHERE id=?10")
    .bind(b.name ?? null, b.details ?? null, b.currency ?? null, b.min_amount ?? null, b.fee_pct ?? null, b.icon ?? null, b.enabled === undefined ? null : +b.enabled, b.api_url ?? null, b.api_key ?? null, c.req.param("id")).run();
  return c.json({ ok: true });
});

providers.get("/manual-deposits", async (c) => {
  const status=c.req.query("status")??"pending";
  const {results}=await c.env.DB.prepare(`SELECT d.*,u.first_name,u.last_name,u.username,m.name AS method_name FROM manual_deposits d JOIN users u ON u.id=d.user_id JOIN payment_methods m ON m.id=d.method_id WHERE (?1='all' OR d.status=?1) ORDER BY d.id DESC LIMIT 200`).bind(status).all();
  return c.json({items:results});
});
providers.post("/manual-deposits/:id/approve", async (c) => {
  const id=Number(c.req.param("id")); const now=Math.floor(Date.now()/1000);
  const dep=await c.env.DB.prepare("SELECT user_id,credit FROM manual_deposits WHERE id=?1 AND status='pending'").bind(id).first<{user_id:number;credit:number}>();
  if(!dep) return err(c,404,"DEPOSIT_NOT_PENDING");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE manual_deposits SET status='approved',updated_at=?1 WHERE id=?2 AND status='pending'").bind(now,id),
    c.env.DB.prepare("UPDATE users SET balance=balance+?1 WHERE id=?2 AND changes()=1").bind(dep.credit,dep.user_id),
    c.env.DB.prepare("INSERT INTO ledger(user_id,delta,kind,ref,note,created_at) SELECT ?1,?2,'topup',?3,'Manual deposit approved',?4 WHERE changes()=1").bind(dep.user_id,dep.credit,id,now),
  ]);
  await tg(c.env.BOT_TOKEN,"sendMessage",{chat_id:dep.user_id,text:`Your manual deposit #${id} was approved. Your wallet has been credited.`}).catch(()=>null);
  return c.json({ok:true});
});
providers.post("/manual-deposits/:id/reject", async (c) => {
  const id=Number(c.req.param("id")); const b=await c.req.json<{note?:string}>().catch(()=>({}));
  const dep=await c.env.DB.prepare("SELECT user_id FROM manual_deposits WHERE id=?1 AND status='pending'").bind(id).first<{user_id:number}>();
  if(!dep) return err(c,404,"DEPOSIT_NOT_PENDING");
  const r=await c.env.DB.prepare("UPDATE manual_deposits SET status='rejected',admin_note=?1,updated_at=?2 WHERE id=?3 AND status='pending'").bind(String(b?.note??"").slice(0,300),Math.floor(Date.now()/1000),id).run();
  if(!r.meta.changes) return err(c,404,"DEPOSIT_NOT_PENDING");
  await tg(c.env.BOT_TOKEN,"sendMessage",{chat_id:dep.user_id,text:`Your manual deposit #${id} was rejected. Please contact support if you need help.`}).catch(()=>null);
  return c.json({ok:true});
});
