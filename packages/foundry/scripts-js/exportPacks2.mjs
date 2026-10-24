import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { utils } from "ethers";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => JSON.parse(readFileSync(root + path, "utf8"));
const packsAbi = read("out/BasqitPacks2.sol/BasqitPacks2.json").abi;
const faucetAbi = read(
  "out/BasqitTestnetFaucet.sol/BasqitTestnetFaucet.json"
).abi;
const beaconAbi = read("out/IDrandBeacon.sol/IDrandBeacon.json").abi;
const names = {
  BasqitPacks2: "packsAbi",
  Packs2PaymentToken: "erc20Abi",
  Packs2StockToken: "erc20Abi",
  Packs2PaymentFaucet: "faucetAbi",
  Packs2StockFaucet: "faucetAbi",
};
const networks = [];
for (const chain of [31337, 46630]) {
  const path = `broadcast/DeployPacks2.s.sol/${chain}/run-latest.json`;
  if (!existsSync(root + path)) continue;
  const broadcast = read(path);
  const refillPath = `broadcast/DeployPacks2Faucet.s.sol/${chain}/run-latest.json`;
  const refill = existsSync(root + refillPath) ? read(refillPath) : undefined;
  const refillTransactions = refill?.transactions ?? [];
  const manifestPath = `deployments/packs2/${chain}.json`;
  const labels = read(manifestPath);
  const payment = Object.keys(labels).find(
    (address) => labels[address] === "Packs2PaymentToken"
  );
  const replacement = refillTransactions.find(
    (tx) =>
      tx.transactionType === "CREATE" &&
      tx.contractName === "BasqitTestnetFaucet" &&
      tx.arguments[0].toLowerCase() === payment.toLowerCase()
  );
  if (replacement) {
    assert.equal(chain, 31337, "Faucet replacement is local only");
    assert.deepEqual(replacement.arguments.slice(1), [
      "10000000000",
      "60",
      "1000000000000",
    ]);
    const confirmed = (tx) =>
      refill.receipts.some(
        (receipt) =>
          receipt.transactionHash === tx.hash && receipt.status === "0x1"
      );
    assert(confirmed(replacement), "Unconfirmed faucet deployment");
    const grant = refillTransactions.find(
      (tx) =>
        tx.contractAddress?.toLowerCase() === payment.toLowerCase() &&
        tx.function === "setMinter(address,bool)" &&
        tx.arguments[0].toLowerCase() ===
          replacement.contractAddress.toLowerCase() &&
        tx.arguments[1] === "true"
    );
    const revoke = refillTransactions.find(
      (tx) =>
        tx.contractAddress?.toLowerCase() === payment.toLowerCase() &&
        tx.function === "setMinter(address,bool)" &&
        tx.arguments[1] === "false"
    );
    assert(
      grant && confirmed(grant) && revoke && confirmed(revoke),
      "Unconfirmed faucet permissions"
    );
    const previous = Object.keys(labels).find(
      (address) => labels[address] === "Packs2PaymentFaucet"
    );
    assert(
      [replacement.contractAddress, revoke.arguments[0]].some(
        (address) => address.toLowerCase() === previous.toLowerCase()
      ),
      "Wrong previous faucet"
    );
    delete labels[previous];
    labels[replacement.contractAddress] = "Packs2PaymentFaucet";
    writeFileSync(root + manifestPath, JSON.stringify(labels, null, 2) + "\n");
  }
  const entries = Object.entries(labels).filter(([, name]) => name in names);
  assert.equal(entries.length, 5, `Missing Packs2 deployments on ${chain}`);
  const contracts = entries.map(([address, name]) => {
    const transactions =
      name === "Packs2PaymentFaucet"
        ? [...broadcast.transactions, ...refillTransactions]
        : broadcast.transactions;
    const tx = transactions.find(
      (tx) => tx.contractAddress?.toLowerCase() === address.toLowerCase()
    );
    assert(tx?.transactionType === "CREATE", `Unverified deployment ${name}`);
    return `${name}: { address: ${JSON.stringify(address)}, abi: ${
      names[name]
    } }`;
  });
  const [coreAddress] = entries.find(([, name]) => name === "BasqitPacks2");
  const mixedPath = `broadcast/DeployPacks2Mixed.s.sol/${chain}/run-latest.json`;
  const mixed = existsSync(root + mixedPath) ? read(mixedPath) : broadcast;
  const upgrade = mixed?.transactions.find(
    (tx) =>
      tx.contractAddress?.toLowerCase() === coreAddress.toLowerCase() &&
      tx.function === "upgradeToAndCall(address,bytes)"
  );
  const mixedCall = mixed.transactions.find(
    (tx) =>
      tx.contractAddress?.toLowerCase() === coreAddress.toLowerCase() &&
      tx.transaction?.input?.slice(0, 10) ===
        new utils.Interface(packsAbi).getSighash("initializeMixedPackTypes")
  );
  if (upgrade || mixedCall) {
    assert([31337, 46630].includes(chain), "Test deployment only");
    const confirmed = (tx) =>
      mixed.receipts.some(
        (receipt) =>
          receipt.transactionHash === tx.hash && receipt.status === "0x1"
      );
    assert(
      mixed.transactions.every(confirmed),
      "Incomplete mixed stock deployment"
    );
    const migration = new utils.Interface(packsAbi).decodeFunctionData(
      "initializeMixedPackTypes",
      upgrade ? upgrade.arguments[1] : mixedCall.transaction.input
    );
    const [originalStock] = entries.find(
      ([, name]) => name === "Packs2StockToken"
    );
    assert.equal(
      migration.tokens[0].toLowerCase(),
      originalStock.toLowerCase()
    );
    for (const [index, ticker] of ["AAPL", "MSFT", "AMZN", "TSLA"].entries()) {
      const address = migration.tokens[index + 1];
      const token = mixed.transactions.find(
        (tx) =>
          tx.transactionType === "CREATE" &&
          tx.contractAddress?.toLowerCase() === address.toLowerCase()
      );
      assert.equal(token?.contractName, "TestnetToken");
      assert.equal(token.arguments[1], `t${ticker}`);
      assert.equal(token.arguments[2], "18");
      const faucet = mixed.transactions.find(
        (tx) =>
          tx.transactionType === "CREATE" &&
          tx.contractName === "BasqitTestnetFaucet" &&
          tx.arguments[0].toLowerCase() === address.toLowerCase()
      );
      assert(faucet, `Missing ${ticker} faucet`);
      contracts.push(
        `Packs2Stock${ticker}: {address: ${JSON.stringify(
          address
        )}, abi: erc20Abi}`
      );
      contracts.push(
        `Packs2Faucet${ticker}: {address: ${JSON.stringify(
          faucet.contractAddress
        )}, abi: faucetAbi}`
      );
      labels[address] = `Packs2Stock${ticker}`;
      labels[faucet.contractAddress] = `Packs2Faucet${ticker}`;
    }
    if (upgrade) {
      for (const address of Object.keys(labels))
        if (labels[address] === "Packs2Implementation") delete labels[address];
      labels[upgrade.arguments[0]] = "Packs2Implementation";
    }
    writeFileSync(root + manifestPath, JSON.stringify(labels, null, 2) + "\n");
  }
  for (const [script, initializer] of [
    ["DeployPacks2StockSelection", "initializeStockSelection"],
    ["DeployPacks2PayoutSchedule", "initializePayoutSchedule"],
    ["DeployPacks2EightyPercentPayouts", "initializeEightyPercentPayouts"],
  ]) {
    const selectionPath = `broadcast/${script}.s.sol/${chain}/run-latest.json`;
    const selection = existsSync(root + selectionPath)
      ? read(selectionPath)
      : undefined;
    const selectionUpgrade = selection?.transactions.find(
      (tx) =>
        tx.contractAddress?.toLowerCase() === coreAddress.toLowerCase() &&
        tx.function === "upgradeToAndCall(address,bytes)"
    );
    if (selectionUpgrade) {
      assert.equal(chain, 31337, "Catalog migration is local only");
      assert(
        selection.transactions.every((tx) =>
          selection.receipts.some(
            (receipt) =>
              receipt.transactionHash === tx.hash && receipt.status === "0x1"
          )
        ),
        "Incomplete catalog migration"
      );
      const next = selection.transactions.find(
        (tx) =>
          tx.transactionType === "CREATE" &&
          tx.contractAddress?.toLowerCase() ===
            selectionUpgrade.arguments[0].toLowerCase()
      );
      assert.equal(next?.contractName, "BasqitPacks2");
      new utils.Interface(packsAbi).decodeFunctionData(
        initializer,
        selectionUpgrade.arguments[1]
      );
      for (const address of Object.keys(labels))
        if (labels[address] === "Packs2Implementation") delete labels[address];
      labels[selectionUpgrade.arguments[0]] = "Packs2Implementation";
      writeFileSync(
        root + manifestPath,
        JSON.stringify(labels, null, 2) + "\n"
      );
    }
  }
  const proxy = broadcast.transactions.find(
    (tx) => tx.contractAddress?.toLowerCase() === coreAddress.toLowerCase()
  );
  assert.equal(proxy?.contractName, "ERC1967Proxy");
  const implementation = broadcast.transactions.find(
    (tx) =>
      tx.contractAddress?.toLowerCase() === proxy.arguments[0].toLowerCase()
  );
  assert.equal(implementation?.contractName, "BasqitPacks2");
  const config = new utils.Interface(packsAbi).decodeFunctionData(
    "initialize",
    proxy.arguments[1]
  );
  assert.match(config.drand, /^0x[0-9a-fA-F]{40}$/);
  contracts.push(
    `Packs2DrandBeacon: {address: ${JSON.stringify(
      config.drand
    )}, abi: beaconAbi}`
  );
  networks.push(`${chain}: {${contracts.join(",")}}`);
}
assert(networks.length, "Deploy Packs2 before exporting");
const source = `// Exported by packages/foundry/scripts-js/exportPacks2.mjs from the independent Packs2 deployment.
import { erc20Abi } from "viem";
import type { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

const packsAbi = ${JSON.stringify(packsAbi)} as const;
const faucetAbi = ${JSON.stringify(faucetAbi)} as const;
const beaconAbi = ${JSON.stringify(beaconAbi)} as const;
const packs2Contracts = {${networks.join(
  ","
)}} as const satisfies GenericContractsDeclaration;
export default packs2Contracts;`;
writeFileSync(
  root + "../nextjs/contracts/packs2Contracts.ts",
  format(source, { parser: "typescript", printWidth: 120 })
);
console.log(
  "Exported Packs2 contracts without changing the existing deployments."
);
