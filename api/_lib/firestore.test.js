import test from "node:test";
import assert from "node:assert/strict";
import { listUserBooks } from "./firestore.js";

function fakeDb(documents, capture) {
  return { collection(name) { assert.equal(name,"users"); return { doc(uid) { capture.uid=uid; return { collection(sub) { assert.equal(sub,"books"); return { limit(n) { capture.limit=n; return { async get() { return {docs:documents.map(({id,data})=>({id,data:()=>data}))}; } }; } }; } }; } }; }
}
test("lists only the authenticated user's UID path and projects safe fields",async()=>{
 const capture={}; const result=await listUserBooks({db:fakeDb([{id:"book-1",data:{title:"Test Book",share_token:"private",status:"read"}}],capture),uid:"firebase-user-1"});
 assert.equal(capture.uid,"firebase-user-1"); assert.equal(capture.limit,50);
 assert.deepEqual(result,{count:1,books:[{id:"book-1",title:"Test Book",status:"read"}]});
});
test("caps page size at 50",async()=>{const c={};await listUserBooks({db:fakeDb([],c),uid:"reader",limit:500});assert.equal(c.limit,50);});
test("rejects UID path traversal",async()=>{await assert.rejects(listUserBooks({db:fakeDb([] ,{}),uid:"../other"}),/valid Firebase UID/);});
test("rejects invalid page sizes",async()=>{await assert.rejects(listUserBooks({db:fakeDb([] ,{}),uid:"reader",limit:0}),/Invalid page size/);});
test("never returns share tokens, legacy IDs or unapproved fields",async()=>{
 const r=await listUserBooks({db:fakeDb([{id:"b",data:{title:"Private",share_token:"secret",shared_with_ids:["x"],created_by_id:"base44-id",email:"x"}}],{}),uid:"reader"});
 assert.deepEqual(r.books[0],{id:"b",title:"Private"});
});
