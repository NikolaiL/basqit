import { farcasterManifest } from "~~/services/farcaster";

export const dynamic = "force-dynamic";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=300, s-maxage=300",
};

export function GET() {
  return Response.json(farcasterManifest(), { headers });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers });
}
