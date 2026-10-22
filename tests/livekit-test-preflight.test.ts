import {describe,expect,it} from "vitest";
import {compareLocalSupabaseKeys,validateLiveKitTestValues} from "../scripts/check-livekit-test-config.mjs";

const safe={
  NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:"local-anon-test",
  SUPABASE_SERVICE_ROLE_KEY:"local-service-test",
  LIVEKIT_URL:"wss://isolated-test.livekit.cloud",
  NEXT_PUBLIC_LIVEKIT_URL:"wss://isolated-test.livekit.cloud",
  LIVEKIT_TEST_PROJECT_HOST:"isolated-test.livekit.cloud",
  LIVEKIT_API_KEY:"isolated-test-key",LIVEKIT_API_SECRET:"isolated-test-secret",
  VOICE_WORKER_SHARED_SECRET:"independent-test-secret",
  VOICE_CONFIG_ENDPOINT:"http://127.0.0.1:3001/api/internal/voice-agent/config",
  VOICE_CONNECTIVITY_TEST_ENABLED:"false",VOICE_WORKER_ENABLED:"false",
  VOICE_REALTIME_ENABLED:"false",VOICE_OUTBOUND_ENABLED:"false",VOICE_PROVIDER_MODE:"mock",
};

describe("offline isolated LiveKit configuration preflight",()=>{
  it("accepts safely disabled local test configuration",()=>expect(validateLiveKitTestValues(safe)).toEqual([]));
  it("rejects remote Supabase, mismatched projects, public secrets and activation",()=>{
    const issues=validateLiveKitTestValues({...safe,
      NEXT_PUBLIC_SUPABASE_URL:"https://production.supabase.co",
      NEXT_PUBLIC_LIVEKIT_URL:"wss://other.livekit.cloud",
      NEXT_PUBLIC_LIVEKIT_API_SECRET:"leak",
      VOICE_WORKER_ENABLED:"true",
    });
    expect(issues.join(" ")).toMatch(/Supabase URL/);
    expect(issues.join(" ")).toMatch(/LiveKit URLs/);
    expect(issues.join(" ")).toMatch(/public variable/);
    expect(issues.join(" ")).toMatch(/VOICE_WORKER_ENABLED/);
  });
  it("requires the private file's local keys to match local CLI status",()=>{
    const status={API_URL:safe.NEXT_PUBLIC_SUPABASE_URL,ANON_KEY:safe.NEXT_PUBLIC_SUPABASE_ANON_KEY,SERVICE_ROLE_KEY:safe.SUPABASE_SERVICE_ROLE_KEY};
    expect(compareLocalSupabaseKeys(safe,status)).toEqual([]);
    expect(compareLocalSupabaseKeys({...safe,SUPABASE_SERVICE_ROLE_KEY:"wrong"},status)).toEqual(["SUPABASE_SERVICE_ROLE_KEY: does not match isolated local CLI key"]);
  });
});
