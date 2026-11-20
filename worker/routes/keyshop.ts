import { Hono, type Context } from "hono";
import type { AppEnv } from "./app";

import { isOwner } from "../env";
import { buyKeys } from "../keyProvider";
import { getProvider } from "../providers";
import { tg } from "../telegram";

export const keyshopCustomer = new Hono<AppEnv>();
export const keyshopAdmin = new Hono<AppEnv>();
type KeyContext = Context<AppEnv>;
const err = (c: KeyContext, status: number, code: string, details?: Record<string,unknown>) => c.json({error:code,code,details}, status as 400);
async function readBody<T extends object>(c: KeyContext): Promise<T|null> { const b: unknown = await c.req.json().catch(()=>null); return b!==null && typeof b==="object" && !Array.isArray(b) ? b as T : null; }
const HTML_ESCAPES: Record<string,string> = { "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" };
const html = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

keyshopCustomer.get("/wallet/payment-methods", async (c) => {
  const {results}=await c.env.DB.prepare("SELECT id,name,currency,details,icon,min_amount,fee_pct FROM payment_methods WHERE enabled=1 AND kind='manual' ORDER BY sort,id").all();
  return c.json(results);
});
keyshopCustomer.post("/wallet/manual-deposits", async (c) => {
  const b=await readBody<{methodId?:string;amount?:number;proof?:string}>(c);
  const amount=Number(b?.amount); const proof=String(b?.proof??"").trim();
  if(!b?.methodId || !Number.isFinite(amount) || amount<=0 || amount>1_000_000 || proof.length<3 || proof.length>1500) return err(c,400,"INVALID_DEPOSIT");
  const method=await c.env.DB.prepare("SELECT m.id,m.currency,m.min_amount,m.fee_pct,c.per_usd FROM payment_methods m JOIN currencies c ON c.code=m.currency WHERE m.id=?1 AND m.enabled=1 AND c.enabled=1 AND m.kind='manual'").bind(b.methodId).first<{id:string;currency:string;min_amount:number;fee_pct:number;per_usd:number}>();
  if(!method || amount<method.min_amount || !Number.isFinite(method.per_usd) || method.per_usd<=0) return err(c,400,"METHOD_UNAVAILABLE");
  const feePct=Math.max(0,Math.min(100,Number(method.fee_pct)||0)); const credit=Math.round((amount*(1-feePct/100)/method.per_usd)*1_000_000); const now=Math.floor(Date.now()/1000);
  const r=await c.env.DB.prepare("INSERT INTO manual_deposits(user_id,method_id,amount,currency,credit,proof,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,'pending',?7,?7)").bind(c.get("user").id,method.id,amount,method.currency,credit,proof,now).run();
  return c.json({ok:true,depositId:r.meta.last_row_id,status:"pending"},201);
});

keyshopCustomer.get("/keys/platforms", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id,name,slug,icon FROM key_platforms WHERE enabled=1 ORDER BY sort,name").all();
  return c.json(results);
});
keyshopCustomer.get("/keys/categories", async (c) => {
  const platformId = Number(c.req.query("platform"));
  if (!Number.isSafeInteger(platformId) || platformId <= 0) return err(c, 400, "INVALID_PLATFORM");
  const { results } = await c.env.DB.prepare("SELECT cat.id,cat.name,cat.slug,cat.icon,cat.description FROM key_categories cat JOIN key_platforms pf ON pf.id=cat.platform_id WHERE cat.platform_id=?1 AND cat.enabled=1 AND pf.enabled=1 ORDER BY cat.sort,cat.name").bind(platformId).all();
  return c.json(results);
});
keyshopCustomer.get("/keys/products", async (c) => {
  const categoryId = Number(c.req.query("category"));
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) return err(c, 400, "INVALID_CATEGORY");
  const { results } = await c.env.DB.prepare(`SELECT p.id,p.name,p.description,CASE WHEN p.android_required=1 OR pr.android_required=1 THEN 1 ELSE 0 END AS android_required,
      (SELECT COUNT(*) FROM key_plans pl WHERE pl.product_id=p.id AND pl.enabled=1) AS plans
    FROM key_products p JOIN providers pr ON pr.id=p.provider_id JOIN key_categories cat ON cat.id=p.category_id JOIN key_platforms pf ON pf.id=cat.platform_id
    WHERE p.category_id=?1 AND p.enabled=1 AND pr.enabled=1 AND cat.enabled=1 AND pf.enabled=1 ORDER BY p.sort,p.name`).bind(categoryId).all();
  return c.json(results);
});
keyshopCustomer.get("/keys/products/:id/plans", async (c) => {
  const id = Number(c.req.param("id"));
  const product = await c.env.DB.prepare(`SELECT p.id,p.name,p.description,CASE WHEN p.android_required=1 OR pr.android_required=1 THEN 1 ELSE 0 END AS android_required
    FROM key_products p JOIN providers pr ON pr.id=p.provider_id JOIN key_categories cat ON cat.id=p.category_id JOIN key_platforms pf ON pf.id=cat.platform_id
    WHERE p.id=?1 AND p.enabled=1 AND pr.enabled=1 AND cat.enabled=1 AND pf.enabled=1`).bind(id).first();
  if (!product) return err(c, 404, "PRODUCT_NOT_FOUND");
  const { results } = await c.env.DB.prepare("SELECT id,duration_label,price FROM key_plans WHERE product_id=?1 AND enabled=1 ORDER BY sort,id").bind(id).all();
  return c.json({ product, plans: results });
});

keyshopCustomer.post("/keys/purchase", async (c) => {
  const body = await readBody<{ planId?: number; quantity?: number; androidId?: string }>(c);
  const planId = Number(body?.planId), quantity = Number(body?.quantity ?? 1);
  if (!Number.isSafeInteger(planId) || planId <= 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) return err(c, 400, "INVALID_REQUEST");
  const row = await c.env.DB.prepare(`SELECT pl.id AS plan_id,pl.duration_label,pl.provider_duration,pl.price,
      p.id AS product_id,p.name AS product_name,p.product_pid,p.android_required,p.provider_id,
      pr.enabled AS provider_enabled,pr.api_mode,pr.android_required AS provider_android_required
    FROM key_plans pl JOIN key_products p ON p.id=pl.product_id JOIN providers pr ON pr.id=p.provider_id
    JOIN key_categories cat ON cat.id=p.category_id JOIN key_platforms pf ON pf.id=cat.platform_id
    WHERE pl.id=?1 AND pl.enabled=1 AND p.enabled=1 AND cat.enabled=1 AND pf.enabled=1`).bind(planId).first<any>();
  if (!row || !row.provider_enabled || row.api_mode !== "reseller_v1") return err(c, 404, "PLAN_UNAVAILABLE");
  const charge = Number(row.price) * quantity;
  if (!Number.isSafeInteger(charge) || charge <= 0) return err(c, 400, "INVALID_PRICE");
  const now = Math.floor(Date.now() / 1000);
  const userId = c.get("user").id;
  const [debit, inserted] = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET balance=balance-?1 WHERE id=?2 AND balance>=?1 AND banned=0").bind(charge,userId),
    c.env.DB.prepare(`INSERT INTO key_orders (user_id,product_id,plan_id,provider_id,product_name,duration_label,quantity,charge,status,created_at,updated_at)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8,'processing',?9,?9 WHERE changes()=1 RETURNING id`)
      .bind(userId,row.product_id,row.plan_id,row.provider_id,row.product_name,row.duration_label,quantity,charge,now),
    c.env.DB.prepare("INSERT INTO ledger (user_id,delta,kind,ref,note,created_at) SELECT ?1,?2,'key_order',last_insert_rowid(),?3,?4 WHERE changes()=1")
      .bind(userId,-charge,`Key order: ${row.product_name}`,now),
  ]);
  const order = (inserted.results?.[0] as {id:number} | undefined);
  if (!debit.meta.changes || !order) return err(c, 402, "INSUFFICIENT_FUNDS", { charge });
  try {
    const provider = await getProvider(c.env, row.provider_id);
    if (!provider) throw new Error("PROVIDER_NOT_FOUND");
    const result = await buyKeys(provider as any, {
      productPid: String(row.product_pid), duration: String(row.provider_duration), quantity,
      androidId: body?.androidId, androidRequired: !!(row.android_required || row.provider_android_required),
    });
    const stmts = result.keys.map((key) => c.env.DB.prepare("INSERT INTO key_deliveries (order_id,user_id,key_value,created_at) VALUES (?1,?2,?3,?4)").bind(order.id,userId,key,now));
    stmts.push(c.env.DB.prepare("UPDATE key_orders SET status='delivered',provider_cost=?1,provider_reference=?2,updated_at=?3 WHERE id=?4").bind(result.totalPrice, result.providerReference, now, order.id));
    await c.env.DB.batch(stmts);
    // Telegram delivery mirrors the Mini App receipt; bulk orders are split to stay under message limits.
    for (let i=0; i<result.keys.length; i+=4) {
      const batchKeys=result.keys.slice(i,i+4);
      const lines=batchKeys.map((key,j)=>`<b>Key ${i+j+1}:</b> <code>${html(key)}</code>`).join("\n");
      await tg(c.env.BOT_TOKEN,"sendMessage",{chat_id:userId,parse_mode:"HTML",text:`<b>Purchase completed</b>\n\n<b>Product:</b> ${html(row.product_name)}\n<b>Duration:</b> ${html(row.duration_label)}\n\n${lines}`,reply_markup:{inline_keyboard:batchKeys.map((key,j)=>[{text:`Copy key ${i+j+1}`,copy_text:{text:key}}])}}).catch(()=>null);
    }
    const user = await c.env.DB.prepare("SELECT balance FROM users WHERE id=?1").bind(userId).first<{balance:number}>();
    const { results: delivered } = await c.env.DB.prepare("SELECT key_value FROM key_deliveries WHERE order_id=?1 ORDER BY id").bind(order.id).all<{key_value:string}>();
    return c.json({ orderId: order.id, status: "delivered", product: row.product_name, duration: row.duration_label, quantity, charge, balance: user?.balance ?? 0, keys: delivered.map((x) => x.key_value) });
  } catch (e) {
    const code = String((e as Error).message || "DELIVERY_REVIEW").slice(0,180);
    await c.env.DB.prepare("UPDATE key_orders SET status='review',error_code=?1,updated_at=?2 WHERE id=?3").bind(code,Math.floor(Date.now()/1000),order.id).run();
    await tg(c.env.BOT_TOKEN,"sendMessage",{chat_id:userId,text:`Your key order #${order.id} is being checked. Your payment is reserved; please do not place the same order again.`}).catch(()=>null);
    // Provider timeouts and malformed responses can be ambiguous: keep the charge reserved until admin verifies provider activity.
    return c.json({ orderId: order.id, status: "review", message: "Your payment is reserved. Delivery is being checked by support; please do not purchase again." }, 202);
  }
});

keyshopCustomer.get("/keys/orders", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id,product_name,duration_label,quantity,charge,status,created_at FROM key_orders WHERE user_id=?1 ORDER BY id DESC LIMIT 50").bind(c.get("user").id).all();
  return c.json(results);
});
keyshopCustomer.get("/keys/orders/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const order = await c.env.DB.prepare("SELECT id,product_name,duration_label,quantity,charge,status,created_at FROM key_orders WHERE id=?1 AND user_id=?2").bind(id,c.get("user").id).first();
  if (!order) return err(c,404,"ORDER_NOT_FOUND");
  const { results } = await c.env.DB.prepare("SELECT key_value FROM key_deliveries WHERE order_id=?1 AND user_id=?2 ORDER BY id").bind(id,c.get("user").id).all<{key_value:string}>();
  return c.json({ ...order, keys: results.map((x) => x.key_value) });
});

keyshopAdmin.use("*", async (c,next) => isOwner(c.env,c.get("settings"),c.get("user").id) ? next() : err(c,403,"FORBIDDEN"));
keyshopAdmin.get("/keyshop/platforms", async (c) => c.json((await c.env.DB.prepare("SELECT * FROM key_platforms ORDER BY sort,id").all()).results));
keyshopAdmin.post("/keyshop/platforms", async (c) => {
  const b = await readBody<{name?:string;slug?:string;icon?:string;sort?:number}>(c);
  if (!b?.name?.trim() || !b.slug?.trim()) return err(c,400,"INVALID_BODY");
  const r = await c.env.DB.prepare("INSERT INTO key_platforms(name,slug,icon,sort,created_at) VALUES(?1,?2,?3,?4,?5)").bind(b.name.trim().slice(0,80),b.slug.trim().toLowerCase().slice(0,80),String(b.icon??"").slice(0,300),Number(b.sort)||0,Date.now()).run();
  return c.json({ok:true,id:r.meta.last_row_id});
});
keyshopAdmin.put("/keyshop/platforms/:id", async (c) => {
  const b = await readBody<Record<string,unknown>>(c); if (!b) return err(c,400,"INVALID_BODY");
  await c.env.DB.prepare("UPDATE key_platforms SET name=COALESCE(?1,name),slug=COALESCE(?2,slug),icon=COALESCE(?3,icon),enabled=COALESCE(?4,enabled),sort=COALESCE(?5,sort) WHERE id=?6").bind(typeof b.name==="string"?b.name.slice(0,80):null,typeof b.slug==="string"?b.slug.toLowerCase().slice(0,80):null,typeof b.icon==="string"?b.icon.slice(0,300):null,b.enabled===undefined?null:+!!b.enabled,Number.isFinite(Number(b.sort))?Number(b.sort):null,Number(c.req.param("id"))).run();
  return c.json({ok:true});
});
keyshopAdmin.get("/keyshop/categories", async (c) => c.json((await c.env.DB.prepare("SELECT * FROM key_categories WHERE (?1 IS NULL OR platform_id=?1) ORDER BY sort,id").bind(c.req.query("platform") ? Number(c.req.query("platform")) : null).all()).results));
keyshopAdmin.post("/keyshop/categories", async (c) => {
  const b = await readBody<{platformId?:number;name?:string;slug?:string;icon?:string;description?:string;sort?:number}>(c);
  if (!b?.platformId || !b.name?.trim() || !b.slug?.trim()) return err(c,400,"INVALID_BODY");
  const r = await c.env.DB.prepare("INSERT INTO key_categories(platform_id,name,slug,icon,description,sort) VALUES(?1,?2,?3,?4,?5,?6)").bind(b.platformId,b.name.trim().slice(0,80),b.slug.trim().toLowerCase().slice(0,80),String(b.icon??"").slice(0,300),String(b.description??"").slice(0,500),Number(b.sort)||0).run();
  return c.json({ok:true,id:r.meta.last_row_id});
});
keyshopAdmin.put("/keyshop/categories/:id", async (c) => {
  const b = await readBody<Record<string,unknown>>(c); if (!b) return err(c,400,"INVALID_BODY");
  await c.env.DB.prepare("UPDATE key_categories SET name=COALESCE(?1,name),slug=COALESCE(?2,slug),icon=COALESCE(?3,icon),description=COALESCE(?4,description),enabled=COALESCE(?5,enabled),sort=COALESCE(?6,sort) WHERE id=?7").bind(typeof b.name==="string"?b.name.slice(0,80):null,typeof b.slug==="string"?b.slug.toLowerCase().slice(0,80):null,typeof b.icon==="string"?b.icon.slice(0,300):null,typeof b.description==="string"?b.description.slice(0,500):null,b.enabled===undefined?null:+!!b.enabled,Number.isFinite(Number(b.sort))?Number(b.sort):null,Number(c.req.param("id"))).run();
  return c.json({ok:true});
});
keyshopAdmin.get("/keyshop/products", async (c) => c.json((await c.env.DB.prepare(`SELECT p.*,pr.name AS provider_name FROM key_products p JOIN providers pr ON pr.id=p.provider_id ORDER BY p.id DESC`).all()).results));
keyshopAdmin.post("/keyshop/products", async (c) => {
  const b = await readBody<{categoryId?:number;providerId?:number;name?:string;description?:string;productPid?:string;androidRequired?:boolean;sort?:number}>(c);
  if (!b?.categoryId || !b.providerId || !b.name?.trim() || !b.productPid?.trim()) return err(c,400,"INVALID_BODY");
  const provider = await getProvider(c.env,b.providerId);
  if (!provider || !provider.enabled || (provider as any).api_mode !== "reseller_v1") return err(c,400,"INVALID_KEY_PROVIDER");
  const r = await c.env.DB.prepare("INSERT INTO key_products(category_id,provider_id,name,description,product_pid,android_required,sort,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)").bind(b.categoryId,b.providerId,b.name.trim().slice(0,100),String(b.description??"").slice(0,1000),b.productPid.trim().slice(0,100),b.androidRequired?1:0,Number(b.sort)||0,Date.now()).run();
  return c.json({ok:true,id:r.meta.last_row_id});
});
keyshopAdmin.put("/keyshop/products/:id", async (c) => {
  const b = await readBody<Record<string,unknown>>(c); if (!b) return err(c,400,"INVALID_BODY");
  await c.env.DB.prepare("UPDATE key_products SET category_id=COALESCE(?1,category_id),provider_id=COALESCE(?2,provider_id),name=COALESCE(?3,name),description=COALESCE(?4,description),product_pid=COALESCE(?5,product_pid),android_required=COALESCE(?6,android_required),enabled=COALESCE(?7,enabled),sort=COALESCE(?8,sort) WHERE id=?9").bind(Number.isFinite(Number(b.categoryId))?Number(b.categoryId):null,Number.isFinite(Number(b.providerId))?Number(b.providerId):null,typeof b.name==="string"?b.name.slice(0,100):null,typeof b.description==="string"?b.description.slice(0,1000):null,typeof b.productPid==="string"?b.productPid.slice(0,100):null,b.androidRequired===undefined?null:+!!b.androidRequired,b.enabled===undefined?null:+!!b.enabled,Number.isFinite(Number(b.sort))?Number(b.sort):null,Number(c.req.param("id"))).run();
  return c.json({ok:true});
});
keyshopAdmin.get("/keyshop/products/:id/plans", async (c) => c.json((await c.env.DB.prepare("SELECT * FROM key_plans WHERE product_id=?1 ORDER BY sort,id").bind(Number(c.req.param("id"))).all()).results));
keyshopAdmin.post("/keyshop/products/:id/plans", async (c) => {
  const b = await readBody<{durationLabel?:string;providerDuration?:string;price?:number;sort?:number}>(c);
  if (!b?.durationLabel?.trim() || !b.providerDuration?.trim() || !Number.isSafeInteger(b.price) || Number(b.price)<=0) return err(c,400,"INVALID_BODY");
  const r = await c.env.DB.prepare("INSERT INTO key_plans(product_id,duration_label,provider_duration,price,sort) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(product_id,provider_duration) DO UPDATE SET duration_label=excluded.duration_label,price=excluded.price,sort=excluded.sort RETURNING id").bind(Number(c.req.param("id")),b.durationLabel.trim().slice(0,100),b.providerDuration.trim().slice(0,100),b.price,Number(b.sort)||0).first<{id:number}>();
  return c.json({ok:true,id:r?.id});
});
keyshopAdmin.put("/keyshop/plans/:id", async (c) => {
  const b = await readBody<Record<string,unknown>>(c); if (!b) return err(c,400,"INVALID_BODY");
  await c.env.DB.prepare("UPDATE key_plans SET duration_label=COALESCE(?1,duration_label),provider_duration=COALESCE(?2,provider_duration),price=COALESCE(?3,price),enabled=COALESCE(?4,enabled),sort=COALESCE(?5,sort) WHERE id=?6").bind(typeof b.durationLabel==="string"?b.durationLabel.slice(0,100):null,typeof b.providerDuration==="string"?b.providerDuration.slice(0,100):null,Number.isSafeInteger(Number(b.price))?Number(b.price):null,b.enabled===undefined?null:+!!b.enabled,Number.isFinite(Number(b.sort))?Number(b.sort):null,Number(c.req.param("id"))).run();
  return c.json({ok:true});
});
keyshopAdmin.get("/keyshop/orders", async (c) => c.json((await c.env.DB.prepare("SELECT o.*,u.username,u.first_name FROM key_orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 200").all()).results));
keyshopAdmin.get("/keyshop/orders/:id", async (c) => { const id=Number(c.req.param("id")); const order=await c.env.DB.prepare("SELECT o.*,u.username,u.first_name FROM key_orders o JOIN users u ON u.id=o.user_id WHERE o.id=?1").bind(id).first(); if(!order)return err(c,404,"NOT_FOUND"); const {results}=await c.env.DB.prepare("SELECT key_value,created_at FROM key_deliveries WHERE order_id=?1 ORDER BY id").bind(id).all(); return c.json({order,deliveries:results}); });
keyshopAdmin.post("/keyshop/orders/:id/refund", async (c) => {
  const id = Number(c.req.param("id"));
  const order = await c.env.DB.prepare("SELECT * FROM key_orders WHERE id=?1 AND status='review'").bind(id).first<any>();
  if (!order) return err(c,404,"REVIEW_ORDER_NOT_FOUND");
  const now = Math.floor(Date.now()/1000);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE key_orders SET status='refunded',updated_at=?1 WHERE id=?2 AND status='review'").bind(now,id),
    c.env.DB.prepare("UPDATE users SET balance=balance+?1 WHERE id=?2 AND changes()=1").bind(order.charge,order.user_id),
    c.env.DB.prepare("INSERT INTO ledger(user_id,delta,kind,ref,note,created_at) SELECT ?1,?2,'key_refund',?3,'Key order refund',?4 WHERE changes()=1").bind(order.user_id,order.charge,id,now),
  ]); return c.json({ok:true});
});
