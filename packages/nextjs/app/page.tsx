import { redirect } from "next/navigation";

// Discover is the front door for now; the portfolio lives at /portfolio.
export default function Home() {
  redirect("/discover");
}
