import { CampaignDashboard } from "@/components/campaign-dashboard";
import { CampaignOperationsPanel } from "@/components/campaign-operations-panel";

export default function Campaigns() {
  return <><main className="main container"><CampaignOperationsPanel /></main><CampaignDashboard /></>;
}
