import type { NextRequest } from "next/server";
import { renderShareImage } from "~~/services/discover/shareImage";

export const runtime = "nodejs";
export function GET(request: NextRequest) {
  return renderShareImage(request, true);
}
