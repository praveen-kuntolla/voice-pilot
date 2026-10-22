import {z} from "zod";

export const providerIds={stt:["mock","deepgram"],llm:["mock","openai"],tts:["mock","elevenlabs"]} as const;
const providerId=z.enum(["mock","deepgram","openai","elevenlabs"]);
export const runtimeConfigSchema=z.object({
  organizationId:z.string().uuid(),agentId:z.string().uuid(),language:z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/).max(20),
  voiceId:z.string().max(120).optional(),instructions:z.string().min(1).max(10000),knowledgeSourceIds:z.array(z.string().uuid()).max(100).default([]),
  providers:z.object({stt:providerId.default("mock"),llm:providerId.default("mock"),tts:providerId.default("mock")}).default({stt:"mock",llm:"mock",tts:"mock"}),
}).superRefine((value,ctx)=>{
  if(!providerIds.stt.includes(value.providers.stt as "mock"|"deepgram"))ctx.addIssue({code:"custom",path:["providers","stt"],message:"Unsupported STT provider"});
  if(!providerIds.llm.includes(value.providers.llm as "mock"|"openai"))ctx.addIssue({code:"custom",path:["providers","llm"],message:"Unsupported LLM provider"});
  if(!providerIds.tts.includes(value.providers.tts as "mock"|"elevenlabs"))ctx.addIssue({code:"custom",path:["providers","tts"],message:"Unsupported TTS provider"});
});
export type RuntimeConfig=z.infer<typeof runtimeConfigSchema>;
export type ConversationState="idle"|"listening"|"transcribing"|"thinking"|"speaking"|"interrupted"|"ending"|"ended"|"failed";
export type VoiceEvent={sequence:number;state:ConversationState;kind:"state"|"partial_transcript"|"final_transcript"|"response_chunk"|"audio_chunk"|"diagnostic";text:string;turnId:number};
export type SimulationMode="success"|"slow"|"error"|"empty";
const delay=(milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds));

/** Local-only deterministic orchestrator. It neither captures audio nor calls a provider. */
export class LocalConversationController {
  readonly events:VoiceEvent[]=[]; state:ConversationState="idle";
  private sequence=0; private activeTurn=0; private ended=false;
  constructor(readonly config:RuntimeConfig,private readonly maxEvents=200){}
  private emit(state:ConversationState,kind:VoiceEvent["kind"]="state",text="",turnId=this.activeTurn){this.state=state;const item={sequence:++this.sequence,state,kind,text,turnId};this.events.push(item);if(this.events.length>this.maxEvents)this.events.splice(0,this.events.length-this.maxEvents);return item}
  private current(turn:number){return !this.ended&&turn===this.activeTurn}
  async runSimulatedTurn(userText:string,mode:SimulationMode="success"):Promise<VoiceEvent[]>{
    const text=userText.trim();if(!text)throw new Error("Simulated speech is required");if(this.ended)throw new Error("Session has ended");const turn=++this.activeTurn,start=this.events.length;
    this.emit("listening","state","Simulation listening — no live audio",turn);this.emit("transcribing","state","Mock STT started",turn);this.emit("transcribing","partial_transcript",text.slice(0,Math.max(1,Math.ceil(text.length/2))),turn);
    if(mode==="slow")await delay(30);if(!this.current(turn))return this.events.slice(start);
    if(mode==="error"){this.emit("failed","diagnostic","Mock provider failure",turn);return this.events.slice(start)}
    if(mode==="empty"){this.emit("failed","diagnostic","Mock provider returned empty output",turn);return this.events.slice(start)}
    this.emit("thinking","final_transcript",text,turn);const response="Thanks for reaching out. This is a local mock response.";this.emit("thinking","response_chunk",response.slice(0,28),turn);if(!this.current(turn))return this.events.slice(start);
    this.emit("speaking","response_chunk",response,turn);this.emit("speaking","audio_chunk","Mock audio chunk (not playable; no media created)",turn);this.emit("idle","diagnostic","Turn complete",turn);return this.events.slice(start);
  }
  interrupt(){if(this.ended||this.state==="idle"||this.state==="failed")return false;const turn=this.activeTurn;this.activeTurn++;this.emit("interrupted","diagnostic","Simulated interruption; stale output suppressed",turn);this.emit("idle","diagnostic","Ready for next turn",turn);return true}
  end(){if(this.ended)return;this.ended=true;this.activeTurn++;this.emit("ending","diagnostic","Simulation ending");this.emit("ended","diagnostic","Simulation ended")}
}

export function mockConversation(config:RuntimeConfig,userText="Hello"){return [{state:"greeting" as const,text:`Hello. I am your ${config.language} voice assistant.`},{state:"listening" as const,text:"I am listening."},{state:"understanding" as const,text:userText},{state:"responding" as const,text:"Thanks for reaching out. This is a local mock response."},{state:"speaking" as const,text:"Thanks for reaching out. This is a local mock response."},{state:"ended" as const,text:"Mock session ended."}]}
export function roomName(organizationId:string,agentId:string,sessionId:string){return `voicepilot:${organizationId}:${agentId}:${sessionId}`}
