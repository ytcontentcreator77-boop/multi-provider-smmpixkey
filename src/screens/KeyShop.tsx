import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { refreshMe } from "../me";
import { amount, balance } from "../format";
import { navigate } from "../router";
import { meStore } from "../store";
import { LargeTitle, Notice, Num, Screen, Section, toast } from "../ui";

type Platform = { id:number; name:string; slug:string; icon:string };
type Category = { id:number; name:string; slug:string; icon:string; description:string };
type Product = { id:number; name:string; description:string; android_required:number; plans:number };
type Plan = { id:number; duration_label:string; price:number };
type Purchase = { orderId:number; status:string; product?:string; duration?:string; quantity?:number; charge?:number; balance?:number; keys?:string[]; message?:string };
function CatalogIcon({value,fallback}:{value:string;fallback:string}) { return /^https:\/\//i.test(value||"") ? <img src={value} alt="" width="32" height="32" style={{objectFit:"contain"}}/> : <span>{value||fallback}</span>; }

export function KeyShop(){
 const me=meStore.use()!;
 const [platforms,P]=useState<Platform[]>([]),[categories,C]=useState<Category[]>([]),[products,S]=useState<Product[]>([]),[plans,L]=useState<Plan[]>([]);
 const [platform,SP]=useState<number|null>(null),[category,SC]=useState<number|null>(null),[product,SD]=useState<Product|null>(null),[plan,SL]=useState<Plan|null>(null);
 const [quantity,Q]=useState(1),[androidId,AI]=useState(""),[purchase,BUY]=useState<Purchase|null>(null),[busy,B]=useState(false);
 useEffect(()=>{void api<Platform[]>("/keys/platforms").then(P).catch(()=>toast("Could not load products","error"))},[]);
 const choosePlatform=async(id:number)=>{SP(id);SC(null);SD(null);SL(null);BUY(null);try{C(await api<Category[]>(`/keys/categories?platform=${id}`))}catch{toast("Could not load categories","error")}};
 const chooseCategory=async(id:number)=>{SC(id);SD(null);SL(null);BUY(null);try{S(await api<Product[]>(`/keys/products?category=${id}`))}catch{toast("Could not load products","error")}};
 const chooseProduct=async(p:Product)=>{SD(p);SL(null);BUY(null);try{const r=await api<{plans:Plan[]}>(`/keys/products/${p.id}/plans`);L(r.plans)}catch{toast("Could not load durations","error")}};
 const buy=async()=>{if(!plan||busy)return;const charge=plan.price*quantity;if(me.balance<charge){toast(`Insufficient balance. Required ${amount(charge)}.`,"error");navigate("/topup");return}if(product?.android_required&&!androidId.trim()){toast("Android ID is required for this product.","error");return}B(true);try{const r=await api<Purchase>("/keys/purchase",{body:{planId:plan.id,quantity,androidId:androidId.trim()||undefined}});BUY(r);await refreshMe().catch(()=>{});if(r.status==="delivered")toast("Key delivered successfully","ok");else toast("Order is being checked by support","info")}catch(e){toast((e as Error).message||"Purchase failed","error")}B(false)};
 const reset=()=>{BUY(null);SL(null);SD(null);SC(null);SP(null)};
 return <Screen bottom="none">
  <LargeTitle size="title" title="Digital Key Store" sub={`Wallet balance: ${balance(me.balance)}`}/>
  {purchase? <>
    <Section header={purchase.status==="delivered"?"Purchase completed":"Order under review"}>
      <div class="card info"><b>Order #{purchase.orderId}</b><p>{purchase.product} · {purchase.duration} · Quantity {purchase.quantity}</p>{purchase.status==="review"?<p>{purchase.message||"Your payment is reserved while delivery is checked. Please do not place the order again."}</p>:null}</div>
      {(purchase.keys??[]).map((key,i)=><div class="card pad"><b>Delivery key {i+1}</b><p class="mono" dir="ltr" style={{overflowWrap:"anywhere"}}>{key}</p><button type="button" onClick={()=>{void navigator.clipboard?.writeText(key).then(()=>toast("Key copied","ok")).catch(()=>toast("Could not copy key","error"))}}>Copy key</button></div>)}
      {purchase.status==="delivered"?<Notice tone="success">Your keys are saved in Key Orders history.</Notice>:null}
    </Section>
    <button class="admin-extra-primary" onClick={reset}>Continue shopping</button><button class="plain" onClick={()=>navigate("/keys/orders")}>View key order history</button>
  </>:<>
    {!platform?<Section header="Choose platform">{platforms.length?<div class="grid5">{platforms.map(p=><button class="ptile" onClick={()=>void choosePlatform(p.id)}><CatalogIcon value={p.icon} fallback="📱"/><span>{p.name}</span></button>)}</div>:<Notice tone="plain">No products are available right now. Please check again later.</Notice>}</Section>:null}
    {platform&&!category?<Section header="Choose category"><div class="list">{categories.map(c=><button class="row" onClick={()=>void chooseCategory(c.id)}><b><CatalogIcon value={c.icon} fallback="📁"/> {c.name}</b></button>)}</div></Section>:null}
    {category&&!product?<Section header="Choose product">{products.map(p=><button class="row" onClick={()=>void chooseProduct(p)}><b>{p.name}</b><span>{p.plans} plans</span></button>)}</Section>:null}
    {product&&!plan?<Section header={`${product.name} · Choose duration`}>{product.description?<p>{product.description}</p>:null}{plans.map(pl=><button class="row" onClick={()=>SL(pl)}><b>{pl.duration_label}</b><span><Num>{amount(pl.price)}</Num></span></button>)}</Section>:null}
    {plan?<Section header="Confirm purchase"><div class="card info"><b>{product?.name}</b><p>{plan.duration_label}</p><p>Unit price: {amount(plan.price)}</p></div><label>Quantity (1–100)<input type="number" min="1" max="100" value={quantity} onInput={e=>Q(Math.max(1,Math.min(100,Math.floor(Number((e.currentTarget as HTMLInputElement).value)||1))))}/></label>{product?.android_required?<label>Android ID<input value={androidId} onInput={e=>AI((e.currentTarget as HTMLInputElement).value)} placeholder="Enter your device Android ID"/></label>:null}<div class="card pad"><b>Total: {amount(plan.price*quantity)}</b><p>Remaining balance after purchase: {amount(me.balance-plan.price*quantity)}</p></div><button class="admin-extra-primary" disabled={busy} onClick={()=>void buy()}>{busy?"Processing…":`Confirm purchase · ${amount(plan.price*quantity)}`}</button></Section>:null}
    {platform?<button class="plain" onClick={()=>{if(product){SD(null);SL(null)}else if(category){SC(null);SD(null)}else if(platform){SP(null);SC(null);C([])}}}>← Back</button>:null}
  </>}
 </Screen>;
}
