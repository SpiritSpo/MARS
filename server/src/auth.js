import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
const ID=/^[a-zA-Z0-9_-]{3,80}$/;
const ROLES=new Set(['owner','director','accountant','dispatcher','mechanic','operator']);
export async function hashPassword(password){
 if(typeof password!=='string'||password.length<12||password.length>1024)throw Error('Password must be 12-1024 characters');
 const salt=randomBytes(32);
 const derived=await scrypt(password,salt,64,{N:16384,r:8,p:1});
 return 'scrypt$16384$8$1$'+salt.toString('hex')+'$'+derived.toString('hex');
}
export async function verifyPassword(password,encoded){
 if(typeof password!=='string'||typeof encoded!=='string')return false;
 const parts=encoded.split('$');
 if(parts.length!==6||parts[0]!=='scrypt'||parts[1]!=='16384'||parts[2]!=='8'||parts[3]!=='1'||!/^[a-f0-9]{64}$/.test(parts[4])||!/^[a-f0-9]{128}$/.test(parts[5]))return false;
 const expected=Buffer.from(parts[5],'hex');
 const actual=await scrypt(password,Buffer.from(parts[4],'hex'),64,{N:16384,r:8,p:1});
 return timingSafeEqual(actual,expected);
}
export function createSessionToken(){return randomBytes(32).toString('hex')}
export function sessionDigest(token){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid session token');
 return createHash('sha256').update(token).digest('hex');
}
export function sessionCookie(token,{secure=true}={}){
 sessionDigest(token);
 return 'mars_session='+token+'; Path=/; HttpOnly; SameSite=Strict; '+(secure?'Secure; ':'')+'Max-Age=28800';
}
export function clearSessionCookie({secure=true}={}){
 return 'mars_session=; Path=/; HttpOnly; SameSite=Strict; '+(secure?'Secure; ':'')+'Max-Age=0';
}
export function requireRole(user,allowed){
 if(!user||!ID.test(user.id)||!ROLES.has(user.role)||!Array.isArray(allowed)||!allowed.includes(user.role))throw Error('Forbidden');
 return true;
}
export const canReadFinance=user=>requireRole(user,['owner','director']);
