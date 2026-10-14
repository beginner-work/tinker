"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createClient } = require("../src/renderer/lib/exercise-codex-client.js");
const { registerCodexExerciseIpc } = require("../src/main/lib/codex-exercise-ipc.js");
const { EventEmitter } = require("node:events");
const prepared = { exerciseId: "e", exerciseName: "Exercise", essayBody: "feedback", files: [{path:"README.md",content:"old",nodeId:"n"}], baseFingerprint:"hash" };
function deferred() { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
function clientFixture() {
  const calls=[]; let session="one";
  const bridge={reviseExerciseWithCodex:async input=>{calls.push(["codex",input]);return {steps:["step"],files:[]};}, cancelCodexExerciseRevision:async()=>{calls.push(["cancel"]);}};
  const options={bridge,session:()=>session,api:async (_method,action,body)=>{calls.push([action,body]);return action==="prepare_revision"?prepared:{workspace:{},changed:true};}};
  return {calls,bridge,options,setSession:value=>{session=value;},create:()=>createClient(options)};
}
test("desktop prepares owner context, generates locally, then applies only a revision",async()=>{
  const f=clientFixture(); const result=await f.create().revise("e","feedback");
  assert.equal(result.changed,true); assert.deepEqual(f.calls.map(x=>x[0]),["prepare_revision","codex","apply_revision"]);
  assert.deepEqual(f.calls[1][1].files,[{path:"README.md",content:"old"}]);
  assert.equal(f.calls[2][1].baseFingerprint,"hash"); assert.equal(f.calls[2][1].workspace,undefined);
});
test("Codex failure never falls back to a paid server provider",async()=>{
  const f=clientFixture(); f.bridge.reviseExerciseWithCodex=async()=>{throw new Error("sign in");};
  await assert.rejects(f.create().revise("e","feedback"),/sign in/);
  assert.deepEqual(f.calls.map(x=>x[0]),["prepare_revision"]);
});
test("cancel while preparing prevents generation and persistence",async()=>{
  const f=clientFixture(), d=deferred(); f.options.api=()=>d.promise;
  const client=f.create(), result=client.revise("e","feedback"); assert.equal(client.cancel(),true); d.resolve(prepared);
  await assert.rejects(result,/cancelled/); assert.deepEqual(f.calls.map(x=>x[0]),["cancel"]);
});
test("cancel during inference and repeat clicks do not apply stale output",async()=>{
  const f=clientFixture(), d=deferred(); f.bridge.reviseExerciseWithCodex=()=>d.promise;
  const client=f.create(), result=client.revise("e","feedback"); await new Promise(setImmediate);
  await assert.rejects(client.revise("e","new feedback"),/already running/);
  assert.equal(client.cancel(),true); d.resolve({steps:["step"],files:[]});
  await assert.rejects(result,/cancelled/); assert.equal(f.calls.some(x=>x[0]==="apply_revision"),false);
});
test("sign-in changes prevent persisting across accounts",async()=>{
  const f=clientFixture(); f.bridge.reviseExerciseWithCodex=async()=>{f.setSession("two");return {steps:["step"],files:[]};};
  await assert.rejects(f.create().revise("e","feedback"),/sign-in changed/);
  assert.equal(f.calls.some(x=>x[0]==="apply_revision"),false);
});
test("cancel refuses to claim rollback after save begins",async()=>{
  const f=clientFixture(), d=deferred(); f.options.api=async(_m,a)=>a==="prepare_revision"?prepared:d.promise;
  const client=f.create(), result=client.revise("e","feedback"); await new Promise(setImmediate);
  assert.equal(client.cancel(),false); d.resolve({changed:true}); assert.equal((await result).changed,true);
});
function ipcFixture() {
  const handlers={}; const sender=new EventEmitter(); sender.id=1; sender.mainFrame={url:"https://tinker.beginner.work/repo"};
  const event={sender,senderFrame:sender.mainFrame};
  const service={checkStatus:async()=>({code:"READY"}),revise:async()=>({steps:["step"],files:[]})};
  registerCodexExerciseIpc({ipcMain:{handle:(key,fn)=>{handlers[key]=fn;}},isTinkerUrl:url=>new URL(url).origin==="https://tinker.beginner.work",service});
  return {handlers,event,sender,service};
}
test("Codex IPC rejects subframes and untrusted origins",async()=>{
  const f=ipcFixture(); await assert.rejects(f.handlers["exercises:codexStatus"]({...f.event,senderFrame:{url:f.sender.mainFrame.url}}),/only available/);
  f.sender.mainFrame.url="https://evil.example"; await assert.rejects(f.handlers["exercises:codexRevise"](f.event,{}),/only available/);
});
test("Codex IPC cancels on navigation, rejects concurrent work, cleans listeners",async()=>{
  const f=ipcFixture(), d=deferred(); let signal;
  f.service.revise=(_input,options)=>{signal=options.signal;return d.promise;};
  const result=f.handlers["exercises:codexRevise"](f.event,{});
  await assert.rejects(f.handlers["exercises:codexRevise"](f.event,{}),/already running/);
  f.sender.emit("did-start-navigation",{},"https://tinker.beginner.work",false,true); assert.equal(signal.aborted,true);
  d.resolve({}); await result; assert.equal(f.sender.listenerCount("did-start-navigation"),0);
});
test("Codex IPC cancels on window close",async()=>{
  const f=ipcFixture(), d=deferred(); let signal;f.service.revise=(_i,o)=>{signal=o.signal;return d.promise;};
  const result=f.handlers["exercises:codexRevise"](f.event,{});f.sender.emit("destroyed");assert.equal(signal.aborted,true);d.resolve({});await result;
});
test("prepare request timeout is bounded and does not launch generation",async()=>{
  const f=clientFixture();f.options.requestTimeoutMs=5;
  f.options.api=(_m,_a,_b,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(new Error("abort"))));
  await assert.rejects(f.create().revise("e","feedback"),/timed out/);assert.equal(f.calls.length,0);
});
test("save timeout reports uncertainty rather than claiming no writes",async()=>{
  const f=clientFixture();f.options.requestTimeoutMs=5;
  f.options.api=async(_m,action,_b,{signal})=>action==="prepare_revision"?prepared:new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(new Error("abort"))));
  await assert.rejects(f.create().revise("e","feedback"),/save could not be confirmed/);
});
test("setup uses native dialog and only copies the generated safe command",async()=>{
  const handlers={};const sender={mainFrame:{url:"https://tinker.beginner.work/repo"}};let copied,dialogOptions;
  registerCodexExerciseIpc({ipcMain:{handle:(k,v)=>{handlers[k]=v;}},isTinkerUrl:()=>true,
    service:{checkStatus:async()=>({authenticated:false,setupCommand:"safe command",setupShell:"terminal"})},
    BrowserWindow:{fromWebContents:()=>({})},dialog:{showMessageBox:async(_win,opts)=>{dialogOptions=opts;return {response:0};}},clipboard:{writeText:text=>{copied=text;}}});
  await handlers["exercises:codexSetup"]({sender,senderFrame:sender.mainFrame});
  assert.equal(copied,"safe command");assert.match(dialogOptions.detail,/separate Codex sign-in folder/);
});
