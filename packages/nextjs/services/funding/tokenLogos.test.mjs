import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "basqit-logos-"));
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
process.chdir(dir);
try {
  const { cacheFundingLogos, safeTokenLogo } = await import("./tokenLogos.ts");
  for (const value of [
    undefined,
    "javascript:alert(1)",
    "http://example.com/logo.png",
    "https://user:secret@example.com/a",
    "bad",
  ])
    assert.equal(safeTokenLogo(value), undefined);
  const logo = "https://static.alchemyapi.io/images/assets/3408.png";
  const address = "0x" + "ab".repeat(20);
  const row = (network, url) => ({
    network,
    tokenAddress: address,
    tokenMetadata: { logo: url },
    tokenBalance: "123",
    address: "PRIVATE_WALLET",
  });
  assert.equal(cacheFundingLogos([row("base-mainnet", logo)])[0].tokenMetadata.logo, logo);
  assert.equal(cacheFundingLogos([row("base-mainnet", null)])[0].tokenMetadata.logo, logo);
  assert.equal(
    cacheFundingLogos([{ ...row("base-mainnet", null), tokenAddress: address.toUpperCase().replace("0X", "0x") }])[0]
      .tokenMetadata.logo,
    logo,
  );
  assert.equal(cacheFundingLogos([row("eth-mainnet", null)])[0].tokenMetadata.logo, null, "network-specific cache");
  assert.equal(
    cacheFundingLogos([row("base-mainnet", "https://example.com/new.png")])[0].tokenMetadata.logo,
    logo,
    "stable for thirty days",
  );
  const disk = readFileSync(join(dir, ".next/cache/funding-token-logos.json"), "utf8");
  assert.ok(!disk.includes("PRIVATE_WALLET") && !disk.includes("tokenBalance"));
  const restarted = await import("./tokenLogos.ts?restart");
  assert.equal(
    restarted.cacheFundingLogos([row("base-mainnet", null)])[0].tokenMetadata.logo,
    logo,
    "survives restart",
  );
  now += 31 * 86400000;
  assert.equal(restarted.cacheFundingLogos([row("base-mainnet", null)])[0].tokenMetadata.logo, null);
  assert.equal(
    restarted.cacheFundingLogos([row("base-mainnet", "https://example.com/new.png")])[0].tokenMetadata.logo,
    "https://example.com/new.png",
  );
  const originalFetch = globalThis.fetch;
  const env = { ...process.env };
  try {
    process.env.NODE_ENV = "development";
    process.env.BASQIT_ENABLE_WALLET_SCAN = "true";
    process.env.ALCHEMY_MULTICHAIN_API_KEY = "TEST_ONLY";
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.equal(body.method, "alchemy_getTokenMetadata");
      assert.equal(body.params.length, 1);
      return Response.json({ result: { logo } });
    };
    const contract = "0x" + "cd".repeat(20);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => restarted.readFundingTokenLogo("base-mainnet", contract)),
    );
    assert.equal(calls, 1, "concurrent metadata requests are deduplicated");
    assert.ok(results.every(value => value === logo));
    await restarted.readFundingTokenLogo("base-mainnet", contract);
    assert.equal(calls, 1, "cache hit does not call Alchemy");
    await assert.rejects(restarted.readFundingTokenLogo("unknown", contract));
    await assert.rejects(restarted.readFundingTokenLogo("base-mainnet", "invalid"));
    assert.equal(calls, 1);
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ result: { logo: null } });
    };
    const missing = "0x" + "ef".repeat(20);
    assert.equal(await restarted.readFundingTokenLogo("base-mainnet", missing), null);
    assert.equal(await restarted.readFundingTokenLogo("base-mainnet", missing), null);
    assert.equal(calls, 2, "missing logo is cached");
    now += 8 * 86400000;
    await restarted.readFundingTokenLogo("base-mainnet", missing);
    assert.equal(calls, 3, "negative cache expires after seven days");
    globalThis.fetch = async () => {
      calls++;
      throw new Error("secret upstream URL");
    };
    const failed = "0x" + "12".repeat(20);
    assert.equal(await restarted.readFundingTokenLogo("base-mainnet", failed), null);
    assert.equal(await restarted.readFundingTokenLogo("base-mainnet", failed), null);
    assert.equal(calls, 4, "upstream failure has a retry cooldown");
    now += 6 * 60000;
    await restarted.readFundingTokenLogo("base-mainnet", failed);
    assert.equal(calls, 5, "failure retries after cooldown");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = env;
  }
  console.log("Logo cache: persistence, expiry, network/address keys and safe URLs passed");
} finally {
  Date.now = originalNow;
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
}
