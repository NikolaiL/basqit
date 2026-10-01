import { redirect } from "next/navigation";

// Discover is the front door for now; the portfolio lives at /portfolio. The query (e.g. ?ref=) carries over.
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const query = new URLSearchParams(
    Object.entries(await searchParams).flatMap(([key, value]) => [value].flat().map(v => [key, v])),
  ).toString();
  redirect(query ? `/discover?${query}` : "/discover");
}
