// Run from packages/nextjs after `forge script script/DeployPacks.s.sol --broadcast` on Robinhood Chain testnet.
// Collects the deployed addresses and ABIs into contracts/packsTestnet.json for the /gifts and /packs demos.
import { readFile, writeFile } from "node:fs/promises";

const foundry = "../foundry";
const run = JSON.parse(await readFile(`${foundry}/broadcast/DeployPacks.s.sol/46630/run-latest.json`, "utf8"));
const created = run.transactions.filter(tx => tx.transactionType === "CREATE");
const byName = name => created.filter(tx => tx.contractName === name).map(tx => tx.contractAddress);
const abi = async name => JSON.parse(await readFile(`${foundry}/out/${name}.sol/${name}.json`, "utf8")).abi;
const tokens = byName("TestnetToken");
const deployBlock = Math.min(...run.receipts.map(receipt => Number(BigInt(receipt.blockNumber))));

const deployment = {
  chainId: 46630,
  deployBlock,
  usdg: tokens[0],
  stocks: tokens.slice(1),
  faucet: byName("BasqitTestnetFaucet")[0],
  gifts: byName("BasqitGifts")[0],
  packs: byName("BasqitPacks")[0],
  giftRouter: byName("BasqitGiftRouter")[0],
  swapAdapter: byName("TestnetSwapAdapter")[0],
  dice: "0x43c8A7B1a85384cabf3D3Fd45a15C01F5b51A42D",
  abis: {
    gifts: await abi("BasqitGifts"),
    packs: await abi("BasqitPacks"),
    giftRouter: await abi("BasqitGiftRouter"),
    swapAdapter: await abi("TestnetSwapAdapter"),
    faucet: await abi("BasqitTestnetFaucet"),
    token: await abi("TestnetToken"),
  },
};
if (
  !deployment.usdg ||
  deployment.stocks.length !== 5 ||
  !deployment.gifts ||
  !deployment.packs ||
  !deployment.giftRouter ||
  !deployment.swapAdapter ||
  !deployment.faucet
)
  throw new Error("Unexpected DeployPacks broadcast; expected 6 tokens, faucet, gifts and packs contracts.");
await writeFile("contracts/packsTestnet.json", JSON.stringify({ deployment }, null, 2) + "\n");
console.log("packsTestnet.json", { ...deployment, abis: Object.keys(deployment.abis) });
