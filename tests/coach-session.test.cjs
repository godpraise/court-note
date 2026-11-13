const {test} = require('node:test');
const assert = require('node:assert/strict');
const {collections,createScopedDb,createSession} = require('../coach-session');

function database() {
  const listeners=[];
  function ref(path) { return {path,collection:n=>ref(path+'/'+n),doc:n=>ref(path+'/'+n),onSnapshot(next,error) {
    const listener={path,next,error,stopped:false};listeners.push(listener);
    return ()=>{listener.stopped=true;};
  }}; }
  return {collection:n=>ref(n),listeners};
}
test('all collection and document paths are scoped to the authenticated coach',()=>{
 const raw=database(),scope=createScopedDb(raw,{uid:'coach-a'});
 for(const name of collections) {
  assert.equal(scope.collection(name).path,`coaches/coach-a/${name}`);
  assert.equal(scope.doc(name+'/same-id').path,`coaches/coach-a/${name}/same-id`);
 }
 assert.equal(createScopedDb(raw,{uid:'coach-b'}).doc('members/same-id').path,'coaches/coach-b/members/same-id');
});
test('a missing identity or a path outside supported coach collections cannot fall back to shared data',()=>{
 const db=database();
 for(const user of [null,{}, {uid:''},{uid:'a/b'}]) assert.throws(()=>createScopedDb(db,user));
 const scope=createScopedDb(db,{uid:'coach-a'});
 for(const path of ['admins/me','members','members/a/other/b','coaches/a','members/']) assert.throws(()=>scope.doc(path));
 assert.throws(()=>scope.collection('admins'));
});
test('switching coach detaches every old listener and discards late data and errors',()=>{
 const db=database(),events=[],errors=[];
 const session=createSession({onReset:(scope,uid)=>events.push(['reset',uid]),onSnapshot:(n,s)=>events.push(['data',s]),onError:e=>errors.push(e)});
 session.start(db,{uid:'a'});const old=db.listeners.slice();
 old[0].next('A data');
 session.start(db,{uid:'b'});
 assert.ok(old.every(l=>l.stopped));
 assert.deepEqual(events.at(-1),['reset','b']);
 old[0].next('late A data');old[0].error(new Error('late A error'));
 assert.deepEqual(events.at(-1),['reset','b']);assert.equal(errors.length,0);
 db.listeners.at(-1).next('B data');assert.deepEqual(events.at(-1),['data','B data']);
});
test('logout clears state and late snapshots do not restore it',()=>{
 const db=database(),events=[];
 const session=createSession({onReset:(scope,uid)=>events.push(uid),onSnapshot:()=>events.push('data'),onError:()=>{}});
 session.start(db,{uid:'a'});session.stop();db.listeners[0].next({secret:'old'});
 assert.equal(events.at(-1),null);assert.ok(db.listeners.every(l=>l.stopped));
});
test('permission failure clears the whole session rather than rendering cached or partial coach data',()=>{
 const db=database(),events=[];
 const session=createSession({onReset:(scope,uid)=>events.push(uid),onSnapshot:()=>events.push('data'),onError:e=>events.push(e.code)});
 session.start(db,{uid:'a'});db.listeners[0].error({code:'permission-denied'});db.listeners[1].next('late');
 assert.deepEqual(events.slice(-2),[null,'permission-denied']);assert.ok(db.listeners.every(l=>l.stopped));
});
