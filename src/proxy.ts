import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";
export async function proxy(request: NextRequest) { return updateSession(request); }
export const config = { matcher: ["/dashboard/:path*", "/onboarding/:path*", "/auth/:path*"] };
