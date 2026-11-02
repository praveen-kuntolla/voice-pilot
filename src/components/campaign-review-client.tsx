"use client";
import { useSearchParams } from "next/navigation";
import { CampaignSimulationStudio } from "@/components/campaign-simulation-studio";

export function CampaignReviewClient() {
  const params = useSearchParams();
  return <CampaignSimulationStudio initialCampaignId={params.get("campaign") ?? undefined} />;
}
