import test from "node:test";
import assert from "node:assert/strict";
import {createBooksHandler} from "./books.js";
function response(){return {headers:{},statusCode:200,body:null,setHeader(n,v){this.headers[n]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};}
test("books endpoint is GET-only",async()=>{const r=response();await createBooksHandler()({method:"POST",headers:{}},r);assert.equal(r.statusCode,405);assert.equal(r.headers.Allow,"GET");});
test("owner UID comes from verified identity, not query parameters",async()=>{const r=response();let uid;await createBooksHandler({verifyToken:async()=>({ok:true,user:{uid:"verified-uid"}}),getDb:async()=>({}),listBooks:async({uid:v})=>(uid=v,{books:[],count:0})})({method:"GET",headers:{},query:{uid:"attacker"}},r);assert.equal(uid,"verified-uid");assert.equal(r.statusCode,200);});
test("unauthenticated calls are rejected",async()=>{const r=response();await createBooksHandler({verifyToken:async()=>({ok:false,status:401,error:"Unauthorized"})})({method:"GET",headers:{}},r);assert.equal(r.statusCode,401);});
test("Firestore failures fail closed",async()=>{const r=response();await createBooksHandler({verifyToken:async()=>({ok:true,user:{uid:"reader"}}),getDb:async()=>{throw Error("denied");}})({method:"GET",headers:{}},r);assert.equal(r.statusCode,503);});
