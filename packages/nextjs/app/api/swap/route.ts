import { NextRequest, NextResponse } from "next/server";
import { isAddress, parseUnits } from "viem";
import { tradeTokenAbi } from "~~/contracts/externalContracts";
import { atlasClient } from "~~/services/atlas/client";
import type { RawAsset } from "~~/services/atlas/types";
import { SESSION_COOKIE, getSession } from "~~/services/auth/session";
import { readTokenData } from "~~/services/portfolio/token-data";
import {
  ALLOWANCE_HOLDER,
  SLIPPAGE_BPS,
  TRADE_CHAIN,
  USDG,
  ZEROX_ENABLED,
  quoteError,
  swapFeeConfig,
  validateQuote,
} from "~~/services/trading/quote";
import { V3_ROUTER, quoteDirect } from "~~/services/trading/uniswap";

export async function GET(request: NextRequest) {
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (process.env.BASQIT_ENABLE_TRADING !== "true") return reply({ error: "Trading is not enabled yet." }, 503);
  const session = await getSession(request.cookies.get(SESSION_COOKIE)?.value).catch(() => undefined);
  if (!session) return reply({ error: "Sign in with your wallet to get a quote." }, 401);
  const p = request.nextUrl.searchParams;
  const provider = p.get("provider") ?? "uniswap";
  if (provider !== "uniswap" && provider !== "0x") return reply({ error: "Unknown swap provider." }, 400);
  if (provider === "0x" && !ZEROX_ENABLED)
    return reply({ error: "0x swaps are currently disabled. Use Direct DEX." }, 503);
  let fee;
  try {
    fee = swapFeeConfig(process.env.BASQIT_SWAP_FEE_BPS, process.env.BASQIT_SWAP_FEE_RECIPIENT);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Invalid swap fee configuration." }, 503);
  }
  if (provider === "0x" && !process.env.ZEROX_API_KEY)
    return reply({ error: "0x is not configured. Select Direct DEX." }, 503);
  const spender = provider === "uniswap" ? V3_ROUTER : ALLOWANCE_HOLDER;
  const token = p.get("token") ?? "";
  const taker = p.get("taker") ?? "";
  const side = p.get("side");
  const amount = p.get("amount") ?? "";
  if (
    !isAddress(token) ||
    !isAddress(taker) ||
    /^0x0{40}$/i.test(taker) ||
    !["buy", "sell"].includes(side ?? "") ||
    !/^\d{1,40}(\.\d{1,36})?$/.test(amount)
  )
    return reply({ error: "Enter a valid wallet, token and positive amount." }, 400);
  if (taker.toLowerCase() !== session.address)
    return reply({ error: "Quotes are only for the signed-in wallet." }, 403);
  try {
    const payload = await readTokenData("assets");
    const asset = (payload.assets as RawAsset[]).find(
      a =>
        a.status === "ASSET_STATUS_ACTIVE" &&
        a.deployments?.some(d => d.chainId === TRADE_CHAIN && d.contractAddress.toLowerCase() === token.toLowerCase()),
    );
    if (!asset) return reply({ error: "This token is not available for trading." }, 400);
    const sellToken = side === "buy" ? USDG : token;
    const buyToken = side === "buy" ? token : USDG;
    const [sellDecimals, buyDecimals, balance, allowance] = await Promise.all([
      atlasClient.readContract({ address: sellToken, abi: tradeTokenAbi, functionName: "decimals" }),
      atlasClient.readContract({ address: buyToken, abi: tradeTokenAbi, functionName: "decimals" }),
      atlasClient.readContract({ address: sellToken, abi: tradeTokenAbi, functionName: "balanceOf", args: [taker] }),
      atlasClient.readContract({
        address: sellToken,
        abi: tradeTokenAbi,
        functionName: "allowance",
        args: [taker, spender],
      }),
    ]);
    if ((amount.split(".")[1]?.length ?? 0) > sellDecimals)
      return reply({ error: `Use at most ${sellDecimals} decimal places.` }, 400);
    const sellAmount = parseUnits(amount, sellDecimals);
    if (sellAmount <= 0n || sellAmount >= 2n ** 256n) return reply({ error: "Enter a positive amount." }, 400);
    if (balance < sellAmount)
      return reply(
        { error: `Insufficient ${side === "buy" ? "USDG" : asset.tokenSymbol} in the connected wallet.` },
        400,
      );
    const common = {
      provider,
      spender,
      sellToken,
      buyToken,
      sellAmount: String(sellAmount),
      sellDecimals,
      buyDecimals,
      balance: String(balance),
      allowance: String(allowance),
      taker,
    };
    if (provider === "uniswap") {
      try {
        const quote = await quoteDirect(atlasClient, sellToken, buyToken, sellAmount, taker, fee);
        return reply({ ...common, ...quote, expiresAt: Date.now() + 30000 });
      } catch {
        return reply(
          {
            error:
              "Direct DEX quote unavailable: no usable direct pool, excessive price impact or RPC failure. Try a smaller amount or retry later.",
          },
          503,
        );
      }
    }
    const params = new URLSearchParams({
      chainId: String(TRADE_CHAIN),
      sellToken,
      buyToken,
      sellAmount: String(sellAmount),
      taker,
      slippageBps: String(SLIPPAGE_BPS),
    });
    if (fee.bps > 0) {
      params.set("swapFeeBps", String(fee.bps));
      params.set("swapFeeRecipient", fee.recipient!);
      params.set("swapFeeToken", buyToken);
    }
    const upstream = await fetch(`https://api.0x.org/swap/allowance-holder/quote?${params}`, {
      headers: { "0x-api-key": process.env.ZEROX_API_KEY!, "0x-version": "v2" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      const details = await upstream.json().catch(() => null);
      const failure = quoteError(upstream.status, details?.name);
      return reply({ error: failure.error }, failure.status);
    }
    const quote = validateQuote(await upstream.json(), sellToken, buyToken, String(sellAmount), fee);
    return reply({
      ...quote,
      ...common,
      expiresAt: Date.now() + 30000,
    });
  } catch {
    return reply({ error: "Could not obtain a verified quote. Please try again later." }, 502);
  }
}
