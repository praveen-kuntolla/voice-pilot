import { headers } from "next/headers";
import { notFound } from "next/navigation";
import DeveloperPreview from "./preview-client";

export const dynamic = "force-dynamic";

export default async function DeveloperPreviewPage() {
  const headersList = await headers();
  const host = headersList.get("host") ?? "";
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  if (process.env.NODE_ENV !== "development" || !["localhost", "127.0.0.1"].includes(hostname)) notFound();
  return <DeveloperPreview />;
}
