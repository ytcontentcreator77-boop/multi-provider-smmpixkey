import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { amount, dateTime } from "../format";
import { BackNav, EmptyState, LargeTitle, Screen, Section, toast } from "../ui";

type KeyOrder={id:number;product_name:string;duration_label:string;quantity:number;charge:number;status:string;created_at:number};
type KeyOrderDetail=KeyOrder&{keys:string[]};
export function KeyOrders(){
 const [orders,S]=useState<KeyOrder[]>([]),[detail,D]=useState<KeyOrderDetail|null>(null);
 useEffect(()=>{void api<KeyOrder[]>("/keys/orders").then(S).catch(()=>toast("Could not load key order history","error"))},[]);
 const open=async(id:number)=>{try{D(await api<KeyOrderDetail>(`/keys/orders/${id}`))}catch{toast("Could not load order details","error")}};
 return <><BackNav to="/keys"/><Screen><LargeTitle size="title" title="Key Orders" sub="Your purchase and delivery history"/>{detail?<Section header={`Order #${detail.id}`}><p><b>{detail.product_name}</b> · {detail.duration_label} · {detail.quantity}</p><p>{amount(detail.charge)} · {detail.status}</p>{detail.keys.map((key,i)=><div class="card pad"><b>Key {i+1}</b><p class="mono" dir="ltr" style={{overflowWrap:"anywhere"}}>{key}</p><button onClick={()=>void navigator.clipboard?.writeText(key).then(()=>toast("Key copied","ok")).catch(()=>toast("Could not copy key","error"))}>Copy key</button></div>)}<button onClick={()=>D(null)}>Back to history</button></Section>:<Section header="Recent orders">{orders.length?orders.map(o=><button class="row" onClick={()=>void open(o.id)}><b>#{o.id} · {o.product_name}</b><span>{amount(o.charge)}</span><small>{o.duration_label} · {o.quantity} · {o.status} · {dateTime(o.created_at)}</small></button>):<EmptyState art="orders" title="No key purchases yet"/>}</Section>}</Screen></>;
}
