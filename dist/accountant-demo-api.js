// Browser-side adapter for the authenticated, fictional-data MARS demo API.
// This module does not activate server mode or replace the existing local demo.
export function createAccountantDemoApi({baseUrl='',fetchImpl=globalThis.fetch}={}){
 if(typeof fetchImpl!=='function')throw Error('Fetch required');
 const request=async(path,payload)=>{
  const response=await fetchImpl(baseUrl+path,{
   method:payload===undefined?'GET':'POST',
   credentials:'same-origin',
   headers:payload===undefined?{}:{'Content-Type':'application/json'},
   ...(payload===undefined?{}:{body:JSON.stringify(payload)})
  });
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Server request failed');
  return data;
 };
 return {
  state:()=>request('/demo/state'),
  previewRows:rows=>request('/demo/import/preview',{rows}),
  previewXlsx:async file=>{
   if(!file||file.size>2_000_000)throw Error('File too large');
   const bytes=new Uint8Array(await file.arrayBuffer());
   let binary='';
   for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   return request('/demo/import/preview-xlsx',{base64:btoa(binary)});
  },
  confirm:token=>{
   if(typeof token!=='string'||!token)throw Error('Preview token required');
   return request('/demo/import/confirm',{token});
  }
 };
}
