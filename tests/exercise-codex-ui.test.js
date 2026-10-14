"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {JSDOM}=require("jsdom");
const root=path.join(__dirname,"..");
const core=require("../src/renderer/lib/exercise-workspace-core.js");
const ws=core.emptyWorkspace();ws.exerciseOrder=["e"];ws.exercises.e={id:"e",name:"Exercise",nodes:[{id:"readme",type:"file",name:"README.md",parentId:null,content:"Old"}]};
async function setup(desktop=true) {
 const dom=new JSDOM(fs.readFileSync(path.join(root,"src/renderer/repo/index.html"),"utf8"),{url:"https://tinker.beginner.work/repo",runScripts:"outside-only"});
 const w=dom.window,calls=[];w.matchMedia=()=>({matches:false});w.localStorage.setItem("tinker_jwt","session");w.tinkerLearningAuth={isLearningSignedIn:()=>true,onLearningAuthChange:()=>{}};
 w.tinkerExerciseWorkspaceCore=core;w.tinkerExerciseRevision=require("../src/renderer/lib/exercise-revision.js");
 w.tinkerExercisesManifest={modules:[{id:"e",name:"Exercise"}]};
 w.fetch=async(url,opts)=>{const action=new URL(url,w.location.href).searchParams.get("action");calls.push(action);let body={workspace:ws};if(action==="prepare_revision")body={exerciseId:"e",exerciseName:"Exercise",essayBody:"Feedback",files:[{path:"README.md",content:"Old"}],baseFingerprint:"hash"};if(action==="apply_revision"||action==="revise_from_essay")body={workspace:ws,steps:["New step"],filesUpdated:[],changed:true};return {ok:true,json:async()=>body};};
 if(desktop)w.tinker={isDesktopApp:true,reviseExerciseWithCodex:async()=>{calls.push("codex");return {steps:["New step"],files:[]};},cancelCodexExerciseRevision:async()=>{calls.push("cancel");},showCodexExerciseSetup:async()=>{calls.push("setup");}};
 for(const file of ["src/renderer/lib/exercise-codex-client.js","src/renderer/repo/exercise-workspace-ui.js"])w.eval(fs.readFileSync(path.join(root,file),"utf8"));
 await w.tinkerExerciseWorkspaceUi.init();calls.length=0;return {dom,w,calls,ui:w.tinkerExerciseWorkspaceUi};
}
test("desktop UI uses prepare, local Codex and apply; web keeps Claude",async()=>{
 for(const desktop of [true,false]){const f=await setup(desktop);try{await f.ui.applyEssayRevision("e","Feedback");assert.deepEqual(f.calls,desktop?["prepare_revision","codex","apply_revision"]:["revise_from_essay"]);assert.equal(f.ui.transformStatus("e"),"");}finally{f.dom.window.close();}}
});
test("missing login renders native setup and retry without fallback",async()=>{
 const f=await setup();try{f.w.tinker.reviseExerciseWithCodex=async()=>{throw new Error("Sign in to Codex");};await assert.rejects(f.ui.applyEssayRevision("e","Feedback"),/Sign in/);const buttons=[...f.w.document.querySelectorAll("button")];buttons.find(b=>b.textContent==="Codex setup").click();await new Promise(setImmediate);assert.ok(f.calls.includes("setup"));assert.ok(!f.calls.includes("revise_from_essay"));assert.equal(f.ui.transformStatus("e"),"error");}finally{f.dom.window.close();}
});
test("pending UI exposes cancel and does not apply a cancelled generation",async()=>{
 const f=await setup();try{let finish;f.w.tinker.reviseExerciseWithCodex=()=>new Promise(resolve=>{finish=resolve;});const result=f.ui.applyEssayRevision("e","Feedback");await new Promise(setImmediate);[...f.w.document.querySelectorAll("button")].find(b=>b.textContent==="Cancel"&&b.className==="repo-ex-transform-retry").click();finish({steps:["New step"],files:[]});await assert.rejects(result,/cancelled/);assert.ok(!f.calls.includes("apply_revision"));}finally{f.dom.window.close();}
});
