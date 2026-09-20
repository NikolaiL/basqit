import { NextResponse } from "next/server";
import { getActions } from "~~/services/portfolio/server";

export async function GET() {
  try {
    return NextResponse.json(await getActions());
  } catch {
    return NextResponse.json(
      { error: "Corporate events are temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
}
