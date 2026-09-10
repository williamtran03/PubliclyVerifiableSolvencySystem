import type {Address,Hex} from 'viem';
import {build} from './build.ts';
import {convert,manifestHash,type Oracle,type Rate,type Conversion} from './oracle.ts';
import {uint} from './tree.ts';
export type LiabilityCustomer={customerId:string;dateOfBirth:string;holdings:{token:Address;rawAmount:bigint}[]};
export async function buildSnapshot(customers:LiabilityCustomer[],oracle:Oracle,snapshotId:Hex,snapshotTime:bigint,maxAge:bigint,capacity=64,minParts=2,maxParts=4,additionalRates:Rate[]=[]) {
 const rates=new Map<string,Rate>();for(const r of additionalRates)rates.set(r.token.toLowerCase(),r);
 const conversions:{customerId:string;conversions:Conversion[]}[]=[];
 const converted=[];
 for(const customer of customers){if(!customer.holdings.length)throw Error('missing holdings');const records=[];let balance=0n;
 for(const h of customer.holdings){const c=await convert(oracle,h.token,h.rawAmount,snapshotTime,maxAge);balance=uint(balance+c.usd);const existing=rates.get(c.token.toLowerCase());if(existing && (existing.feed.toLowerCase()!==c.feed.toLowerCase() || existing.rate!==c.rate || existing.roundId!==c.roundId || existing.updatedAt!==c.updatedAt || existing.tokenDecimals!==c.tokenDecimals || existing.oracleDecimals!==c.oracleDecimals))throw Error('inconsistent rate for token');rates.set(c.token.toLowerCase(),c);records.push(c);}
 converted.push({customerId:customer.customerId,dateOfBirth:customer.dateOfBirth,balance});conversions.push({customerId:customer.customerId,conversions:records});}
 const manifest=[...rates.values()].sort((a,b)=>BigInt(a.token)<BigInt(b.token)?-1:1).map(({token,feed,tokenDecimals,oracleDecimals,rate,roundId,updatedAt})=>({token,feed,tokenDecimals,oracleDecimals,rate,roundId,updatedAt}));
 const rateManifestHash=manifestHash(snapshotId,manifest,snapshotTime,maxAge);
 return {...build(converted,snapshotId,capacity,minParts,maxParts),manifest,rateManifestHash,conversions};
}
