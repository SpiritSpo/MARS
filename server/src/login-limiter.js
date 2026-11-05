// Per-process login throttle. For multi-instance deployment use a shared Redis/store or gateway limit.
export function createLoginLimiter({maxAttempts=5,windowMs=15*60_000,clock=()=>Date.now()}={}){
 const attempts=new Map();
 return {
  check(key){
   const t=clock(),v=attempts.get(key);
   if(!v||t>=v.until){attempts.delete(key);return {allowed:true};}
   return v.count>=maxAttempts?{allowed:false,retryAfter:Math.max(1,Math.ceil((v.until-t)/1000))}:{allowed:true};
  },
  fail(key){
   const t=clock(),v=attempts.get(key);
   if(!v||t>=v.until)attempts.set(key,{count:1,until:t+windowMs});
   else v.count++;
  },
  clear(key){attempts.delete(key);}
 };
}
