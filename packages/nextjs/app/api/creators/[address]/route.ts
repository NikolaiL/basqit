import { NextRequest, NextResponse } from "next/server";
import { type Hex, isAddress, isHex } from "viem";
import { factoryEvents } from "~~/services/baskets/abi";
import { packsClient, packsTestnet } from "~~/services/packs/testnet";
import { readProfile, readSocials, saveProfile } from "~~/services/profiles/db";
import { checkIssuedAt, cleanProfile, profileMessage } from "~~/services/profiles/profile";
import { takeAllowance } from "~~/services/rate-limit";

export const runtime = "nodejs";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** A creator's public profile and the baskets they created on testnet. */
export async function GET(_: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return reply({ error: "Not an address" }, 404);
  const [profile, socials, created] = await Promise.all([
    process.env.DATABASE_URL ? readProfile(address) : null,
    process.env.DATABASE_URL ? readSocials(address) : [],
    packsTestnet
      ? packsClient.getLogs({
          address: packsTestnet.factory,
          event: factoryEvents[0],
          args: { creator: address },
          fromBlock: BigInt(packsTestnet.deployBlock),
        })
      : [],
  ]);
  return reply({
    profile: profile && { ...profile, signedAt: undefined },
    socials,
    baskets: created.map(l => ({ address: l.args.basket!, name: l.args.name!, symbol: l.args.symbol! })),
  });
}

/** Saves a profile signed by its own wallet. No session needed: the signature is the authorization. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return reply({ error: "Not an address" }, 404);
  if (!process.env.DATABASE_URL) return reply({ error: "Profiles are not available right now." }, 503);
  if (!takeAllowance(`profile:${address.toLowerCase()}`, 10)) return reply({ error: "Too many updates." }, 429);
  try {
    const raw = await request.text();
    if (raw.length > 100_000) return reply({ error: "Request too large." }, 413);
    const body = JSON.parse(raw);
    if (!isHex(body.signature) || body.signature.length > 20_000) return reply({ error: "Missing signature." }, 400);
    const profile = cleanProfile(body.profile);
    const previous = await readProfile(address);
    const signedAt = checkIssuedAt(body.issuedAt, Date.now(), previous?.signedAt);
    const message = profileMessage(address, profile, body.issuedAt);
    // verifyMessage also accepts smart-contract wallets (ERC-1271 / ERC-6492) deployed on testnet.
    if (!(await packsClient.verifyMessage({ address, message, signature: body.signature as Hex })))
      return reply({ error: "The signature does not match this wallet." }, 401);
    if (!(await saveProfile(address, profile, { message, signature: body.signature, signedAt })))
      return reply({ error: "A newer update is already saved." }, 409);
    return reply({ profile });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Invalid profile." }, 400);
  }
}
