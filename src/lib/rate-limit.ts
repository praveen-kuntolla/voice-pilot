const buckets = new Map<string,{count:number;reset:number}>();
export function rateLimit(key:string,limit=5,windowMs=60_000){const now=Date.now();const current=buckets.get(key);if(!current||current.reset<=now){buckets.set(key,{count:1,reset:now+windowMs});return true}if(current.count>=limit)return false;current.count++;return true}
