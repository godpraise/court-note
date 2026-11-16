import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,runTransaction} from 'firebase/firestore';
import completion from '../lesson-completion.js';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8787')throw Error('Local emulator only');
let env,db;
const ref=p=>doc(db,'coaches/coach-a/'+p);
const scope={doc:ref,runTransaction:f=>runTransaction(db,t=>f({get:async r=>{const s=await t.get(r);return {exists:s.exists(),data:()=>s.data()};},update:(...args)=>t.update(...args)}),{maxAttempts:15})};
const lesson=(participants=[{memberId:'m',passId:'p',attendance:'scheduled'}])=>({status:'scheduled',date:'2026-11-16',participants});
const pass=(extra={})=>({status:'active',usedCount:0,totalCount:10,courtFeeAmount:100,...extra});
const read=async p=>(await getDoc(ref(p))).data();
async function seed(values){await env.withSecurityRulesDisabled(async c=>{for(const [p,v] of Object.entries(values))await setDoc(doc(c.firestore(),'coaches/coach-a/'+p),v);});}
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-court-note-isolation',firestore:{host:'127.0.0.1',port:8787,rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});db=env.authenticatedContext('coach-a',{email:'a@example.test',email_verified:true}).firestore();});
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'admins/a@example.test'),{enabled:true}));});
after(async()=>{await env?.cleanup();});
test('repeating the same completion consumes a pass once',async()=>{
 await seed({'lessons/l':lesson(),'passes/p':pass()});
 assert.equal((await completion.completeLesson(scope,'l')).completed,true);
 assert.equal((await completion.completeLesson(scope,'l')).reason,'already_done');
 assert.equal((await read('passes/p')).usedCount,1);assert.equal((await read('lessons/l')).status,'done');
});
test('eight concurrent completions of one lesson commit exactly once',async()=>{
 await seed({'lessons/l':lesson(),'passes/p':pass()});
 const results=await Promise.all(Array.from({length:8},()=>completion.completeLesson(scope,'l')));
 assert.equal(results.filter(r=>r.completed).length,1);assert.equal((await read('passes/p')).usedCount,1);
});
test('two different lessons concurrently using one pass do not lose a charge',async()=>{
 await seed({'lessons/a':lesson(),'lessons/b':lesson(),'passes/p':pass()});
 await Promise.all(['a','b'].map(id=>completion.completeLesson(scope,id)));assert.equal((await read('passes/p')).usedCount,2);
});
test('group lesson updates all passes and preserves both settlement branches',async()=>{
 await seed({'lessons/l':lesson([{memberId:'a',passId:'a',attendance:'scheduled'},{memberId:'b',passId:'b',attendance:'done'}]),'passes/a':pass({totalCount:1}),'passes/b':pass({totalCount:1,courtFeeAmount:0})});
 await completion.completeLesson(scope,'l');assert.equal((await read('passes/a')).status,'ready_settle');assert.equal((await read('passes/b')).status,'settled');
});
test('a missing pass rejects the whole operation without partial completion',async()=>{
 await seed({'lessons/l':lesson([{memberId:'a',passId:'p',attendance:'scheduled'},{memberId:'b',passId:'missing',attendance:'scheduled'}]),'passes/p':pass()});
 await assert.rejects(completion.completeLesson(scope,'l'),{code:'pass_not_found'});assert.equal((await read('lessons/l')).status,'scheduled');assert.equal((await read('passes/p')).usedCount,0);
});
test('exhausted and inactive passes do not leave a completed lesson',async()=>{
 for(const value of [pass({usedCount:10}),pass({status:'settled'})]){
  await seed({'lessons/l':lesson(),'passes/p':value});await assert.rejects(completion.completeLesson(scope,'l'),{code:'pass_not_available'});assert.equal((await read('lessons/l')).status,'scheduled');
 }
});
test('canceled lessons cannot be completed',async()=>{
 await seed({'lessons/l':{...lesson(),status:'canceled'},'passes/p':pass()});await assert.rejects(completion.completeLesson(scope,'l'),{code:'lesson_not_scheduled'});assert.equal((await read('passes/p')).usedCount,0);
});
test('absent participants do not consume a pass',async()=>{
 await seed({'lessons/l':lesson([{memberId:'m',passId:'p',attendance:'absent'}]),'passes/p':pass()});await completion.completeLesson(scope,'l');assert.equal((await read('passes/p')).usedCount,0);
});
test('duplicated participant entries are rejected rather than double charged',async()=>{
 const p={memberId:'m',passId:'p',attendance:'scheduled'};await seed({'lessons/l':lesson([p,p]),'passes/p':pass()});await assert.rejects(completion.completeLesson(scope,'l'),{code:'invalid_lesson_participants'});assert.equal((await read('passes/p')).usedCount,0);
});
test('the same completion cannot access another coach path',async()=>{
 await seed({'lessons/l':lesson(),'passes/p':pass()});const other={...scope,doc:p=>doc(db,'coaches/coach-b/'+p)};await assert.rejects(completion.completeLesson(other,'l'));assert.equal((await read('passes/p')).usedCount,0);
});
