import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { Contract, providers, utils } from "ethers";

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
  const sharedPath = `broadcast/DeployPacks2SharedAssets.s.sol/${chain}/run-latest.json`;
  if (chain === 46630 && existsSync(root + sharedPath)) {
    const shared = read(sharedPath);
    assert(
      shared.transactions.every((tx) =>
        shared.receipts.some(
          (receipt) =>
            receipt.transactionHash === tx.hash && receipt.status === "0x1"
        )
      ),
      "Incomplete shared-assets deployment"
    );
    const created = shared.transactions.filter(
      (tx) => tx.transactionType === "CREATE"
    );
    assert.equal(
      created.length,
      1,
      "Shared deployment must create only the proxy"
    );
    const proxy = created[0];
    assert.equal(proxy.contractName, "ERC1967Proxy");
    const labels = read(`deployments/packs2/${chain}.json`);
    const addresses = Object.fromEntries(
      Object.entries(labels).map(([address, name]) => [name, address])
    );
    assert.equal(
      proxy.contractAddress.toLowerCase(),
      addresses.BasqitPacks2.toLowerCase()
    );
    assert.equal(
      proxy.arguments[0].toLowerCase(),
      addresses.Packs2Implementation.toLowerCase()
    );
    const config = new utils.Interface(packsAbi).decodeFunctionData(
      "initialize",
      proxy.arguments[1]
    );
    const rpc = new providers.JsonRpcProvider(
      "https://rpc.testnet.chain.robinhood.com"
    );
    assert.equal((await rpc.getNetwork()).chainId, chain);
    const factory = new Contract(
      addresses.Packs2AssetFactory,
      [
        "function usdG() view returns(address)",
        "function isAllowedToken(address) view returns(bool)",
      ],
      rpc
    );
    const payment = await factory.usdG();
    assert.equal(
      payment.toLowerCase(),
      addresses.Packs2PaymentToken.toLowerCase()
    );
    assert.equal(config.payment.toLowerCase(), payment.toLowerCase());
    assert.equal(
      config.drand.toLowerCase(),
      addresses.Packs2DrandBeacon.toLowerCase()
    );
    assert.equal(
      utils.keccak256(await rpc.getCode(config.drand)),
      "0x2402f288cf7967abbf2a2301025df12c0ff415b63c02cd1489c6a7ba06fdf924"
    );
    const faucet = new Contract(addresses.Packs2PaymentFaucet, faucetAbi, rpc);
    assert.equal((await faucet.token()).toLowerCase(), payment.toLowerCase());
    const tokenAbi = [
      "function decimals() view returns(uint8)",
      "function symbol() view returns(string)",
    ];
    assert.equal(await new Contract(payment, tokenAbi, rpc).decimals(), 6);
    const core = new Contract(addresses.BasqitPacks2, packsAbi, rpc);
    assert.equal((await core.payToken()).toLowerCase(), payment.toLowerCase());
    const contracts = [
      `BasqitPacks2: {address: ${JSON.stringify(
        addresses.BasqitPacks2
      )}, abi: packsAbi}`,
      `Packs2PaymentToken: {address: ${JSON.stringify(
        payment
      )}, abi: erc20Abi}`,
      `Packs2PaymentFaucet: {address: ${JSON.stringify(
        addresses.Packs2PaymentFaucet
      )}, abi: faucetAbi}`,
      `Packs2DrandBeacon: {address: ${JSON.stringify(
        config.drand
      )}, abi: beaconAbi}`,
    ];
    const stocks = [];
    for (const ticker of ["NVDA", "AAPL", "META", "AMZN", "TSLA"]) {
      const name =
        ticker === "NVDA" ? "Packs2StockToken" : `Packs2Stock${ticker}`;
      const address = addresses[name];
      assert(
        await factory.isAllowedToken(address),
        `Unlisted shared stock ${ticker}`
      );
      const token = new Contract(address, tokenAbi, rpc);
      assert.equal(await token.symbol(), `t${ticker}`);
      assert.equal(await token.decimals(), 18);
      stocks.push(address.toLowerCase());
      contracts.push(
        `${name}: {address: ${JSON.stringify(address)}, abi: erc20Abi}`
      );
    }
    for (let kind = 1; kind <= 3; kind++) {
      const pool = await core.stockPool(await core.currentConfigId(kind));
      assert.deepEqual(
        pool.map((stock) => stock.token.toLowerCase()).sort(),
        [...stocks].sort()
      );
    }
    networks.push(`${chain}: {${contracts.join(",")}}`);
    continue;
  }
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
