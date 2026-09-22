import { detectMiniapp } from "./miniapp-runtime.ts";
import assert from "node:assert/strict";

const never = new Promise(() => {});
assert.equal(await detectMiniapp({ isInMiniApp: () => never, context: never }, 10), null);
assert.equal(
  await detectMiniapp({
    isInMiniApp: async () => false,
    get context() {
      throw Error("Web must not read context");
    },
  }),
  null,
);
assert.equal(await detectMiniapp({ isInMiniApp: async () => true, context: never }, 10), null);
assert.equal(
  await detectMiniapp({
    isInMiniApp: async () => {
      throw Error("No bridge");
    },
    context: never,
  }),
  null,
);
const context = { user: { fid: 123 }, client: { safeAreaInsets: { bottom: 24 } } };
assert.deepEqual(await detectMiniapp({ isInMiniApp: async () => true, context: Promise.resolve(context) }), context);
console.log("Farcaster context resolves; plain web, missing bridge and stalled host cannot block initialization.");

// Exercise the real connector with a local wallet stub; no external wallet or RPC.
const { sdk } = await import("@farcaster/miniapp-sdk");
const { farcasterMiniApp } = await import("@farcaster/miniapp-wagmi-connector");
const { createConfig, connect, disconnect, getAccount } = await import("@wagmi/core");
const { http } = await import("viem");
const { mainnet, base } = await import("viem/chains");
const { EventEmitter } = await import("node:events");
const provider = new EventEmitter();
const methods = [];
provider.request = async ({ method }) => {
  methods.push(method);
  if (method === "eth_chainId") return "0x2105";
  if (method === "eth_requestAccounts" || method === "eth_accounts")
    return ["0x0000000000000000000000000000000000000001"];
  throw Error(`Unexpected wallet request: ${method}`);
};
sdk.wallet.ethProvider = provider;
const config = createConfig({
  chains: [mainnet, base],
  connectors: [],
  transports: { [mainnet.id]: http(), [base.id]: http() },
  storage: null,
});
await connect(config, { connector: farcasterMiniApp(), chainId: base.id });
assert.equal(getAccount(config).status, "connected");
assert.equal(getAccount(config).chainId, base.id);
assert.equal(getAccount(config).connector.id, "farcaster");
assert.ok(!methods.includes("wallet_switchEthereumChain"));
await disconnect(config);
assert.equal(getAccount(config).status, "disconnected");
console.log("Farcaster connector attaches to wagmi on demand without changing the wallet network.");
