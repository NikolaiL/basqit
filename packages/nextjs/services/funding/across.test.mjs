import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
} from "viem";

const { verifyAcrossFunding, isRegisteredBridgeSettler } = await import("./across.ts");

// Real 0x quotes captured on 1 October 2026 (Base, Arbitrum, Ethereum; USDC and ETH sources; USDG and ETH outputs;
// with and without the Basqit fee). See basqit-docs/docs/FUNDING-ROUTE-VERIFICATION.md.
const fixtures = JSON.parse(readFileSync(new URL("./across.fixtures.json", import.meta.url), "utf8"));
const intentOf = f => ({
  ...f.intent,
  sellAmount: BigInt(f.intent.sellAmount),
  minBuyAmount: BigInt(f.intent.minBuyAmount),
});
for (const f of fixtures) {
  const { guaranteed } = verifyAcrossFunding(intentOf(f), f.tx);
  assert.ok(guaranteed >= intentOf(f).minBuyAmount, f.name);
}

// Tampering: decode a real quote, change one thing, re-encode.
const holder = parseAbi(["function exec(address operator, address token, uint256 amount, address target, bytes data)"]);
const settler = parseAbi(["function execute(bytes[] actions, bytes32 zid)"]);
const actions = parseAbi([
  "function BASIC(address bridgeToken, uint256 ppm, address pool, uint256 offset, bytes data)",
  "function BRIDGE_ERC20_TO_ACROSS(address spoke, bytes depositData)",
  "function BRIDGE_TO_LAYER_ZERO_OFT(address token, address oft, bytes sendData)",
  "function SETTLER_SWAP(address token, uint256 amount, address settler, bytes settlerData)",
]);
const swap = parseAbi([
  "function execute((address recipient, address buyToken, uint256 minAmountOut) slippage, bytes[] actions, bytes32 zid)",
]);
const deposit = parseAbiParameters(
  "bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message",
);
const attacker = "0x000000000000000000000000000000000000dead";
const word = address => `0x${address.slice(2).padStart(64, "0")}`;

function tamper(f, change) {
  const outer = decodeFunctionData({ abi: holder, data: f.tx.data }).args;
  const [list, zid] = decodeFunctionData({ abi: settler, data: outer[4] }).args;
  const parts = {
    tx: { ...f.tx },
    outer: [...outer],
    list: [...list],
    zid,
    editDeposit(edit) {
      const index = this.list.findIndex(a =>
        a.startsWith(
          encodeFunctionData({ abi: actions, functionName: "BRIDGE_ERC20_TO_ACROSS", args: [attacker, "0x"] }).slice(
            0,
            10,
          ),
        ),
      );
      const [spoke, data] = decodeFunctionData({ abi: actions, data: this.list[index] }).args;
      const values = [...decodeAbiParameters(deposit, data)];
      const next = edit(values, spoke) ?? {};
      this.list[index] = encodeFunctionData({
        abi: actions,
        functionName: "BRIDGE_ERC20_TO_ACROSS",
        args: [next.spoke ?? spoke, encodeAbiParameters(deposit, values)],
      });
    },
  };
  change(parts);
  parts.outer[4] = encodeFunctionData({ abi: settler, functionName: "execute", args: [parts.list, parts.zid] });
  return {
    ...parts.tx,
    data:
      parts.tx.data === f.tx.data
        ? encodeFunctionData({ abi: holder, functionName: "exec", args: parts.outer })
        : parts.tx.data,
  };
}

const usdc = fixtures.find(f => f.name === "fee-base-usdc");
const eth = fixtures.find(f => f.name === "base-eth");
const rejects = (f, change, pattern, label) =>
  assert.throws(() => verifyAcrossFunding(intentOf(f), tamper(f, change)), pattern, label);

assert.doesNotThrow(
  () =>
    verifyAcrossFunding(
      intentOf(usdc),
      tamper(usdc, () => {}),
    ),
  "re-encoding alone changes nothing",
);
rejects(usdc, p => p.editDeposit(v => void (v[1] = word(attacker))), /recipient/, "deposit recipient");
rejects(usdc, p => p.editDeposit(v => void (v[0] = word(attacker))), /recipient/, "refunds to another depositor");
rejects(usdc, p => p.editDeposit(v => void (v[6] = 1n)), /destination/, "destination chain");
rejects(usdc, p => p.editDeposit(v => void (v[11] = "0x1234")), /destination/, "message runs code on arrival");
rejects(usdc, p => p.editDeposit(v => void (v[3] = word(attacker))), /output token/, "output token");
rejects(usdc, p => p.editDeposit(v => void (v[5] = v[5] / 2n)), /below the displayed minimum/, "output halved");
rejects(usdc, p => p.editDeposit(() => ({ spoke: attacker })), /SpokePool/, "unverified spoke");
rejects(
  usdc,
  p =>
    p.list.splice(
      1,
      0,
      encodeFunctionData({
        abi: actions,
        functionName: "BASIC",
        args: [
          usdc.intent.token,
          10_000n,
          usdc.intent.token,
          36n,
          `0xa9059cbb${word(attacker).slice(2)}${"0".repeat(64)}`,
        ],
      }),
    ),
  /provider fee/,
  "extra 1% payment",
);
rejects(
  usdc,
  p =>
    p.list.splice(
      1,
      0,
      encodeFunctionData({ abi: actions, functionName: "BASIC", args: [usdc.intent.token, 100n, attacker, 0n, "0x"] }),
    ),
  /unexpected token payment/,
  "arbitrary call through BASIC",
);
rejects(usdc, p => p.list.splice(1, 1), /Basqit fee missing/, "Basqit fee removed");
rejects(
  usdc,
  p =>
    p.list.push(
      encodeFunctionData({ abi: actions, functionName: "BRIDGE_TO_LAYER_ZERO_OFT", args: [attacker, attacker, "0x"] }),
    ),
  /action after the bridge|unsupported action/,
  "unverified bridge",
);
rejects(usdc, p => void (p.outer[2] = p.outer[2] + 1n), /input token or amount/, "exec amount");
rejects(usdc, p => void (p.tx.to = attacker), /unexpected target/, "target");
rejects(usdc, p => void (p.tx.value = "1"), /native value/, "native value on an ERC-20 source");
rejects(eth, p => void (p.tx.value = (BigInt(eth.tx.value) + 1n).toString()), /native value/, "extra native value");
rejects(
  eth,
  p => {
    const index = p.list.findIndex(a =>
      a.startsWith(
        "0x" +
          encodeFunctionData({
            abi: actions,
            functionName: "SETTLER_SWAP",
            args: [attacker, 0n, attacker, "0x"],
          }).slice(2, 10),
      ),
    );
    const [token, amount, target, data] = decodeFunctionData({ abi: actions, data: p.list[index] }).args;
    const [slippage, swapActions, zid] = decodeFunctionData({ abi: swap, data }).args;
    p.list[index] = encodeFunctionData({
      abi: actions,
      functionName: "SETTLER_SWAP",
      args: [
        token,
        amount,
        target,
        encodeFunctionData({
          abi: swap,
          functionName: "execute",
          args: [{ ...slippage, recipient: attacker }, swapActions, zid],
        }),
      ],
    });
  },
  /swap recipient/,
  "swap output sent elsewhere",
);
assert.throws(
  () => verifyAcrossFunding({ ...intentOf(usdc), wallet: attacker }, usdc.tx),
  /recipient/,
  "a quote for another wallet",
);
assert.throws(() => verifyAcrossFunding({ ...intentOf(usdc), chainId: 4663 }, usdc.tx), /unsupported source network/);

// Registry: only the current or previous bridge settler counts.
const registry = (current, previous) => ({
  readContract: async ({ functionName }) => (functionName === "ownerOf" ? current : previous),
});
const live = "0x7D19077317B7574Cd01AAFA143e5e09f0F4dF466";
assert.equal(await isRegisteredBridgeSettler(registry(live, attacker), live.toLowerCase()), true);
assert.equal(
  await isRegisteredBridgeSettler(registry(attacker, live), live),
  true,
  "previous during 0x's dwell period",
);
assert.equal(await isRegisteredBridgeSettler(registry(attacker, attacker), live), false);
console.log(
  "Across funding: 8 real quotes verified; recipient, refund, chain, token, minimum, spoke, fees, extra actions, value and swap tampering rejected.",
);
