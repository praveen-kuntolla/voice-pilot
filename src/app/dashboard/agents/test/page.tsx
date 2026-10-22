"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {Mic,MicOff,ShieldCheck,Square} from "lucide-react";
import {Room,RoomEvent} from "livekit-client";
import {LocalConversationController,runtimeConfigSchema,type SimulationMode} from "@/lib/voice-runtime";

type State="idle"|"requesting"|"connected"|"ended"|"error";

export default function AgentTest(){
 const [state,setState]=useState<State>("idle"),[transcript,setTranscript]=useState<string[]>([]),[error,setError]=useState(""),[agentId,setAgentId]=useState(""),[participants,setParticipants]=useState(0);
 const [simulatedSpeech,setSimulatedSpeech]=useState("Hello, I need help with my account."),[simulationMode,setSimulationMode]=useState<SimulationMode>("success"),[simulationState,setSimulationState]=useState("idle");
 const roomRef=useRef<Room|null>(null);
 const sessionRef=useRef(0);
 const simulationRef=useRef<LocalConversationController|null>(null);
 useEffect(()=>()=>{sessionRef.current++;const room=roomRef.current;roomRef.current=null;if(room)void room.disconnect().catch(()=>{})},[]);
 async function startMock(){const session=++sessionRef.current;setError("");setState("requesting");try{if(!navigator.mediaDevices?.getUserMedia)throw new Error("Microphone access is unavailable in this browser.");const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());if(sessionRef.current!==session)return;setState("connected");setTranscript(["Mock session connected. No audio was sent externally."])}catch(e){if(sessionRef.current!==session)return;setError(e instanceof Error?e.message:"Microphone permission was denied.");setState("error")}}
 async function startRealtime(){
  const session=++sessionRef.current;
  setError("");setState("requesting");
  let room:Room|null=null;
  try{
   const r=await fetch("/api/livekit/token",{method:"POST",headers:{"content-type":"application/json"},cache:"no-store",body:JSON.stringify({agent_id:agentId})});
   const d=await r.json();
   if(sessionRef.current!==session)return;
   if(!r.ok)throw new Error(d.error||"LiveKit session unavailable");
   if((d.mode!=="connectivity"&&d.mode!=="realtime")||typeof d.url!=="string"||typeof d.token!=="string")throw new Error("Invalid LiveKit response");
   room=new Room();
   const currentRoom=room;
   room.on(RoomEvent.Disconnected,()=>{if(roomRef.current!==currentRoom||sessionRef.current!==session)return;roomRef.current=null;setParticipants(0);setState("ended");setTranscript(x=>[...x,"LiveKit room disconnected."])});
   const refreshParticipants=()=>{if(roomRef.current===currentRoom&&sessionRef.current===session)setParticipants(currentRoom.remoteParticipants.size)};
   room.on(RoomEvent.ParticipantConnected,refreshParticipants);
   room.on(RoomEvent.ParticipantDisconnected,refreshParticipants);
   roomRef.current=room;
   await room.connect(d.url,d.token);
   if(sessionRef.current!==session){await room.disconnect();return}
   refreshParticipants();setState("connected");
   setTranscript([d.mode==="connectivity"?"Connectivity room joined. No microphone or AI provider was activated.":"LiveKit room connected."]);
  }catch(e){if(room){try{await room.disconnect()}catch{}}if(sessionRef.current!==session)return;roomRef.current=null;setParticipants(0);setError(e instanceof Error?e.message:"Unable to connect");setState("error")}
 }
 async function stop(){sessionRef.current++;const room=roomRef.current;roomRef.current=null;setState("requesting");try{if(room)await room.disconnect();setError("");setState("ended");setTranscript(x=>[...x,"Session ended."])}catch{setError("Room disconnect failed; connection state is uncertain.");setState("error")}finally{setParticipants(0)}}
 const simulationLines=(controller:LocalConversationController)=>controller.events.map(event=>`[${event.state}/${event.kind}] ${event.text}`).filter(Boolean);
 async function runSimulation(){try{setError("");const config=runtimeConfigSchema.parse({organizationId:"11111111-1111-4111-8111-111111111111",agentId:"22222222-2222-4222-8222-222222222222",language:"en-US",instructions:"Local simulation only",knowledgeSourceIds:[]});const controller=simulationRef.current??new LocalConversationController(config);simulationRef.current=controller;setSimulationState("running");await controller.runSimulatedTurn(simulatedSpeech,simulationMode);setSimulationState(controller.state);setTranscript(simulationLines(controller))}catch(e){setSimulationState("failed");setError(e instanceof Error?e.message:"Simulation failed")}}
 function interruptSimulation(){const controller=simulationRef.current;if(controller?.interrupt()){setSimulationState(controller.state);setTranscript(simulationLines(controller))}}
 function endSimulation(){const controller=simulationRef.current;if(controller){controller.end();setSimulationState(controller.state);setTranscript(simulationLines(controller))}}
 return <main className="main container"><Link className="muted" href="/dashboard/agents">← Back to agents</Link><div className="section" style={{paddingTop:40}}><div className="eyebrow">Voice test console · mock mode</div><h1>Test your agent safely.</h1><p className="muted">Mock mode is fully local. An approved connectivity test can join an isolated LiveKit room without streaming microphone audio or using AI providers.</p><div className="card" style={{maxWidth:680,marginTop:24}}><div className="notice"><ShieldCheck size={16}/> Realtime and outbound calling are disabled by default.</div><p>Status: <strong>{state}</strong></p>{state==="connected"&&<p className="muted">Remote participants: {participants}</p>}{state!=="connected"&&state!=="requesting"&&<><button className="btn primary" onClick={startMock}><Mic size={16}/> Start mock session</button><input className="input" placeholder="Test agent ID" value={agentId} onChange={e=>setAgentId(e.target.value)}/><button className="btn ghost" disabled={!agentId} onClick={startRealtime}>Connect to LiveKit</button></>}{(state==="connected"||state==="requesting")&&<button className="btn ghost" onClick={stop}><Square size={16}/> End session</button>}{state==="requesting"&&<p className="muted">Starting session…</p>}{state==="error"&&<p style={{color:"#fca5a5"}}><MicOff size={16}/> {error}</p>}<div className="card" style={{marginTop:18}}><h3>Simulation — No Live Audio</h3><p className="muted">Text-only mock STT → LLM → TTS. It has no microphone capture, audio output, provider request, or tool execution.</p><p>Status: <strong>{simulationState}</strong></p><textarea className="input" aria-label="Simulated user speech" value={simulatedSpeech} onChange={e=>setSimulatedSpeech(e.target.value)} maxLength={1000}/><select className="input" aria-label="Simulation outcome" value={simulationMode} onChange={e=>setSimulationMode(e.target.value as SimulationMode)}><option value="success">Successful response</option><option value="slow">Slow response</option><option value="error">Provider failure</option><option value="empty">Empty output</option></select><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}><button className="btn primary" onClick={runSimulation}>Run simulated turn</button><button className="btn ghost" onClick={interruptSimulation}>Simulate interruption</button><button className="btn ghost" onClick={endSimulation}>End simulation</button></div></div><div className="card" style={{marginTop:18}}><h3>Session events</h3>{transcript.length?transcript.map((line,i)=><p className="muted" key={i}>{line}</p>):<p className="muted">No session events yet.</p>}</div></div></div></main>
}
