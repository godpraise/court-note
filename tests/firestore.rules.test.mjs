import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,collection,collectionGroup,getDoc,getDocs,setDoc,updateDoc,deleteDoc} from 'firebase/firestore';

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8787')throw Error('Run only with the configured local Firestore emulator');
const names=['venues','members','lessons','passes','journals','skills','progress'];
let env;
const coach=(uid,email,verified=true)=>env.authenticatedContext(uid,{email,email_verified:verified}).firestore();
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-court-note-isolation',firestore:{host:'127.0.0.1',port:8787,rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  for(const email of ['a@example.test','b@example.test'])await setDoc(doc(db,'admins',email),{enabled:true});
  await setDoc(doc(db,'members','legacy-test-data'),{name:'preserved test member'});
  for(const uid of ['coach-a','coach-b'])for(const name of names)await setDoc(doc(db,'coaches',uid,name,'same-id'),{owner:uid,kind:name});
 });
});
after(async()=>{if(env)await env.cleanup();});
test('each registered coach can read, list, create, update and delete only their own seven collections',async()=>{
 for(const [uid,email] of [['coach-a','a@example.test'],['coach-b','b@example.test']]){
  const db=coach(uid,email);
  for(const name of names){
   const own=doc(db,'coaches',uid,name,'same-id');
   assert.equal((await assertSucceeds(getDoc(own))).data().owner,uid);
   assert.equal((await assertSucceeds(getDocs(collection(db,'coaches',uid,name)))).size,1);
   const added=doc(db,'coaches',uid,name,'new');
   await assertSucceeds(setDoc(added,{name:'new'}));await assertSucceeds(updateDoc(added,{name:'updated'}));await assertSucceeds(deleteDoc(added));
  }
 }
});
test('cross-coach reads, lists, creates, updates and deletes are denied for every collection',async()=>{
 const db=coach('coach-a','a@example.test');
 for(const name of names){
  const other=doc(db,'coaches','coach-b',name,'same-id');
  await assertFails(getDoc(other));await assertFails(getDocs(collection(db,'coaches','coach-b',name)));
  await assertFails(setDoc(doc(db,'coaches','coach-b',name,'new'),{name:'intrusion'}));
  await assertFails(updateDoc(other,{name:'intrusion'}));await assertFails(deleteDoc(other));
 }
 await assertFails(getDocs(collectionGroup(db,'members')));
});
test('unregistered, unverified and unauthenticated users are denied',async()=>{
 for(const db of [coach('unknown','unknown@example.test'),coach('coach-a','a@example.test',false),env.unauthenticatedContext().firestore()]){
  await assertFails(getDoc(doc(db,'coaches','coach-a','members','same-id')));
  await assertFails(setDoc(doc(db,'coaches','coach-a','members','new'),{name:'intrusion'}));
 }
});
test('clients can check only their own access grant and cannot change or enumerate grants',async()=>{
 const db=coach('coach-a','a@example.test');
 await assertSucceeds(getDoc(doc(db,'admins','a@example.test')));
 await assertFails(getDoc(doc(db,'admins','b@example.test')));await assertFails(getDocs(collection(db,'admins')));
 await assertFails(setDoc(doc(db,'admins','other@example.test'),{enabled:true}));
 await assertFails(updateDoc(doc(db,'admins','a@example.test'),{enabled:false}));await assertFails(deleteDoc(doc(db,'admins','a@example.test')));
});
test('unknown paths and legacy shared collections are inaccessible',async()=>{
 const db=coach('coach-a','a@example.test');
 await assertFails(getDoc(doc(db,'members','legacy-test-data')));await assertFails(getDocs(collection(db,'members')));
 await assertFails(setDoc(doc(db,'members','new'),{name:'intrusion'}));
 await assertFails(setDoc(doc(db,'coaches','coach-a','unknown','new'),{name:'intrusion'}));
 await assertFails(getDocs(collection(db,'coaches')));
});
test('revoking the access grant immediately denies subsequent own-coach operations',async()=>{
 await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),'admins','b@example.test')));
 const db=coach('coach-b','b@example.test');
 await assertFails(getDoc(doc(db,'coaches','coach-b','members','same-id')));
 await assertFails(setDoc(doc(db,'coaches','coach-b','members','new'),{name:'intrusion'}));
});
test('legacy test data remains preserved and a new coach starts with an empty workspace',async()=>{
 await env.withSecurityRulesDisabled(async c=>{
  assert.equal((await getDoc(doc(c.firestore(),'members','legacy-test-data'))).data().name,'preserved test member');
  await setDoc(doc(c.firestore(),'admins','new@example.test'),{enabled:true});
 });
 const db=coach('new-coach','new@example.test');
 for(const name of names)assert.equal((await assertSucceeds(getDocs(collection(db,'coaches','new-coach',name)))).size,0);
});
