const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../api/clean-note.js'),'utf8');

async function request(options={}) {
 let apiCalls=0,verifiedWithRevocation=false;
 const identity=options.identity||{uid:'a',email:'a@example.test',email_verified:true};
 const context={module:{exports:{}},console:{error(){}},process:{env:{ANTHROPIC_API_KEY:options.noKey?'':'test-only',FIREBASE_PRIVATE_KEY:'test-only'}},
  require(name) {
   if(name==='firebase-admin/app')return {initializeApp:()=>({}),cert:x=>x,getApps:()=>[{}]};
   if(name==='firebase-admin/auth')return {getAuth:()=>({verifyIdToken:async(t,revoked)=>{verifiedWithRevocation=revoked;if(options.invalidToken)throw Error('invalid');return identity;}})};
   if(name==='firebase-admin/firestore')return {getFirestore:()=>({collection:n=>{assert.equal(n,'admins');return {doc:e=>{assert.equal(e,identity.email);return {get:async()=>{if(options.lookupFails)throw Error('offline');return {exists:options.allowed!==false};}};}};}})};
   throw Error(name);
  },fetch:async()=>{apiCalls++;return {ok:true,json:async()=>({content:[{type:'text',text:'정리 결과'}]})};}};
 vm.runInNewContext(source,context);
 const req={method:options.method||'POST',headers:{authorization:options.noToken?'':'Bearer test-only'},body:{text:options.text===undefined?'수업 메모':options.text}};
 const res={status(code){this.statusCode=code;return this;},json(body){this.body=body;}};
 await context.module.exports(req,res);
 return {status:res.statusCode,body:res.body,apiCalls,verifiedWithRevocation};
}
test('missing and invalid tokens never call the AI API',async()=>{
 for(const options of [{noToken:true},{invalidToken:true}]){const r=await request(options);assert.equal(r.status,401);assert.equal(r.apiCalls,0);}
});
test('an authenticated but unregistered or unverified user cannot use the paid API',async()=>{
 for(const options of [{allowed:false},{identity:{uid:'a',email:'a@example.test',email_verified:false}},{identity:{uid:'a'}}]){
  const r=await request(options);assert.equal(r.status,403);assert.equal(r.apiCalls,0);
 }
});
test('authorization lookup failure fails closed and does not use the AI API',async()=>{
 const r=await request({lookupFails:true});assert.equal(r.status,503);assert.equal(r.apiCalls,0);
});
test('a verified registered coach succeeds and token revocation is checked',async()=>{
 const r=await request();assert.equal(r.status,200);assert.equal(r.apiCalls,1);assert.equal(r.verifiedWithRevocation,true);assert.equal(r.body.text,'정리 결과');
});
test('invalid text and missing configuration do not call the AI API',async()=>{
 for(const options of [{text:''},{text:'x'.repeat(4001)},{noKey:true}]){const r=await request(options);assert.ok([400,500].includes(r.status));assert.equal(r.apiCalls,0);}
});
test('non-POST requests are rejected',async()=>{const r=await request({method:'GET'});assert.equal(r.status,405);assert.equal(r.apiCalls,0);});
