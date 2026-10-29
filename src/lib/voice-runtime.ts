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
export const MAX_SIMULATION_TURNS=8;
export const MAX_SIMULATION_INPUT_LENGTH=1000;
export const simulationPresetIds=["new-inquiry","price-objection","callback-request","opt-out-request","mock-failure"] as const;
export type SimulationPresetId=typeof simulationPresetIds[number];
export type SimulationPreset={id:SimulationPresetId;label:string;description:string;turns:readonly string[];mode:SimulationMode};
export const simulationPresets:readonly SimulationPreset[]=[
  {id:"new-inquiry",label:"New product inquiry",description:"A synthetic customer asks about a product.",turns:["Hi, I would like to learn more about your product.","What would the next step look like?"],mode:"success"},
  {id:"price-objection",label:"Price objection",description:"A synthetic customer raises a pricing concern.",turns:["I am interested, but the price is higher than I expected.","What options do I have?"],mode:"success"},
  {id:"callback-request",label:"Callback request",description:"A synthetic customer asks to continue later.",turns:["Could someone call me back about this?","Tomorrow afternoon would work for a follow-up."],mode:"success"},
  {id:"opt-out-request",label:"Opt-out request",description:"A synthetic customer asks not to be contacted.",turns:["Please do not contact me again."],mode:"success"},
  {id:"mock-failure",label:"Provider failure",description:"A deterministic mock provider failure.",turns:["Run the failure path for this synthetic scenario."],mode:"error"},
];
export function getSimulationPreset(id:string){return simulationPresets.find((preset)=>preset.id===id);}
/** Client-side fail-closed display guard. The server endpoint remains authoritative. */
export function isAuthorizedAgentTestPreflight(
  preflight: { allowed?: boolean; agentId?: string; organizationId?: string } | null,
  expectedAgentId: string,
  existingOrganizationId?: string,
) {
  return preflight?.allowed === true
    && preflight.agentId === expectedAgentId
    && typeof preflight.organizationId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(preflight.organizationId)
    && (!existingOrganizationId || preflight.organizationId === existingOrganizationId);
}

export function validateSimulationInput(value:string){const text=value.trim();if(!text)return "Simulated speech is required";if(text.length>MAX_SIMULATION_INPUT_LENGTH)return `Simulated speech must be ${MAX_SIMULATION_INPUT_LENGTH} characters or fewer`;return null;}
const delay=(milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds));

/** Local-only deterministic orchestrator. It neither captures audio nor calls a provider. */
export class LocalConversationController {
  readonly events:VoiceEvent[]=[]; state:ConversationState="idle";
  private sequence=0; private activeTurn=0; private ended=false; private turnCountValue=0;
  constructor(readonly config:RuntimeConfig,private readonly maxEvents=200,private readonly maxTurns=MAX_SIMULATION_TURNS){}
  get turnCount(){return this.turnCountValue;}
  get isTurnActive(){return ["listening","transcribing","thinking","speaking"].includes(this.state);}
  private emit(state:ConversationState,kind:VoiceEvent["kind"]="state",text="",turnId=this.activeTurn){this.state=state;const item={sequence:++this.sequence,state,kind,text,turnId};this.events.push(item);if(this.events.length>this.maxEvents)this.events.splice(0,this.events.length-this.maxEvents);return item}
  private current(turn:number){return !this.ended&&turn===this.activeTurn}
  async runSimulatedTurn(userText:string,mode:SimulationMode="success"):Promise<VoiceEvent[]>{
    const text=userText.trim();const validation=validateSimulationInput(text);if(validation)throw new Error(validation);if(this.ended)throw new Error("Session has ended");if(this.isTurnActive)throw new Error("A simulated turn is already active");if(this.state==="failed")throw new Error("Reset the failed simulation before starting another turn");if(this.turnCountValue>=this.maxTurns)throw new Error(`Maximum of ${this.maxTurns} simulated turns reached`);const turn=++this.activeTurn;this.turnCountValue++;const start=this.events.length;
    this.emit("listening","state","Simulation listening — no live audio",turn);this.emit("transcribing","state","Mock STT started",turn);this.emit("transcribing","partial_transcript",text.slice(0,Math.max(1,Math.ceil(text.length/2))),turn);
    if(mode==="slow")await delay(250);if(!this.current(turn))return this.events.slice(start);
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
