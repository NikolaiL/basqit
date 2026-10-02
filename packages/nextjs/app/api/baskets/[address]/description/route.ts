import { NextRequest, NextResponse } from "next/server";
import { type Address, type Hex, isAddress, isHex, parseAbi } from "viem";
import { packsClient, packsTestnet, robinhoodTestnet } from "~~/services/packs/testnet";
import { readDescription, saveDescription } from "~~/services/profiles/db";
import { checkIssuedAt, cleanDescription, descriptionMessage } from "~~/services/profiles/profile";
import { takeAllowance } from "~~/services/rate-limit";

export const runtime = "nodejs";
const CHAIN_ID = robinhoodTestnet.id;
const creatorOfAbi = parseAbi(["function creatorOf(address basket) view returns (address)"]);
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return reply({ error: "Not a basket" }, 404);
  const row = process.env.DATABASE_URL ? await readDescription(CHAIN_ID, address) : null;
  return reply({ description: row?.description ?? "" });
}

/**
 * Saves a description signed by the basket's creator. The creator is read from the factory on chain, so the
 * database only stores text; it never decides who may write it.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address) || !packsTestnet) return reply({ error: "Not a basket" }, 404);
  if (!process.env.DATABASE_URL) return reply({ error: "Descriptions are not available right now." }, 503);
  if (!takeAllowance(`description:${address.toLowerCase()}`, 10)) return reply({ error: "Too many updates." }, 429);
  try {
    const raw = await request.text();
    if (raw.length > 30_000) return reply({ error: "Request too large." }, 413);
    const body = JSON.parse(raw);
    if (!isHex(body.signature) || body.signature.length > 20_000) return reply({ error: "Missing signature." }, 400);
    const description = cleanDescription(body.description);
    const creator: Address = await packsClient.readContract({
      address: packsTestnet.factory,
      abi: creatorOfAbi,
      functionName: "creatorOf",
      args: [address],
    });
    if (/^0x0+$/.test(creator)) return reply({ error: "Not a basket" }, 404);
    const previous = await readDescription(CHAIN_ID, address);
    const signedAt = checkIssuedAt(body.issuedAt, Date.now(), previous?.signedAt);
    const message = descriptionMessage(CHAIN_ID, address, description, body.issuedAt);
    if (!(await packsClient.verifyMessage({ address: creator, message, signature: body.signature as Hex })))
      return reply({ error: "Only the basket's creator can describe it." }, 401);
    if (
      !(await saveDescription(CHAIN_ID, address, creator, description, {
        message,
        signature: body.signature,
        signedAt,
      }))
    )
      return reply({ error: "A newer update is already saved." }, 409);
    return reply({ description });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Invalid description." }, 400);
  }
}
