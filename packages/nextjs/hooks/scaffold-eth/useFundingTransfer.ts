import { useTransactor } from "./useTransactor";
import { BaseError, createPublicClient, encodeFunctionData, erc20Abi, http } from "viem";
import { useConfig, useWalletClient } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import { type FundingQuote, NATIVE, assertFundingGasReserve, fundingChains } from "~~/services/funding/shared";

export function useFundingTransfer() {
  const config = useConfig();
  const { data: wallet } = useWalletClient();
  const transact = useTransactor(wallet);
  async function clients(q: FundingQuote) {
    const chain = fundingChains.find(c => c.id === q.chainId);
    if (!chain) throw new Error("Unsupported funding network.");
    const signer = await getWalletClient(config, { chainId: chain.id });
    if (
      (await signer.getChainId()) !== q.chainId ||
      (await signer.getAddresses())[0]?.toLowerCase() !== q.wallet.toLowerCase()
    )
      throw new Error("Wallet changed. Reconnect the quoted wallet.");
    return { chain, signer, rpc: createPublicClient({ chain, transport: http() }) };
  }
  async function approve(q: FundingQuote) {
    if (q.token.toLowerCase() === NATIVE) return;
    if (!q.spender) throw new Error("Missing allowance spender. Request a new quote.");
    const { rpc } = await clients(q);
    const allowance = await rpc.readContract({
      address: q.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [q.wallet, q.spender],
    });
    if (allowance >= BigInt(q.sellAmount)) return;
    for (const value of allowance > 0n ? [0n, BigInt(q.sellAmount)] : [BigInt(q.sellAmount)]) {
      const { chain, signer } = await clients(q);
      const tx = {
        account: q.wallet,
        chain,
        to: q.token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [q.spender, value] }),
      };
      await rpc.estimateGas(tx);
      await clients(q);
      await transact(() => signer.sendTransaction(tx));
    }
  }
  async function send(
    q: FundingQuote,
    beforeSend: () => void,
    submitted: (hash: `0x${string}`) => void,
    rejected: () => void,
  ) {
    const { chain, signer, rpc } = await clients(q);
    if (Date.now() >= q.expiresAt) throw new Error("Funding quote expired. Refresh it first.");
    const native = await rpc.getBalance({ address: q.wallet });
    if (q.token.toLowerCase() !== NATIVE) {
      if (!q.spender) throw new Error("Missing allowance spender.");
      const [balance, allowance] = await Promise.all([
        rpc.readContract({ address: q.token, abi: erc20Abi, functionName: "balanceOf", args: [q.wallet] }),
        rpc.readContract({ address: q.token, abi: erc20Abi, functionName: "allowance", args: [q.wallet, q.spender] }),
      ]);
      if (balance < BigInt(q.sellAmount) || allowance < BigInt(q.sellAmount))
        throw new Error("Balance or allowance changed. Refresh your quote.");
    }
    const tx = {
      account: q.wallet,
      chain,
      to: q.transaction.to,
      data: q.transaction.data,
      value: BigInt(q.transaction.value),
    };
    const gas = await rpc.estimateGas(tx),
      fees = await rpc.estimateFeesPerGas();
    assertFundingGasReserve(
      native,
      tx.value,
      ((gas * 120n) / 100n) * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n),
      q.token.toLowerCase() === NATIVE,
    );
    await clients(q);
    if (Date.now() >= q.expiresAt) throw new Error("Funding quote expired. Refresh it first.");
    await transact(async () => {
      // Persist before opening the wallet; an uncertain send must never be retried automatically.
      beforeSend();
      let hash: `0x${string}`;
      try {
        hash = await signer.sendTransaction(tx);
      } catch (error) {
        const cause =
          error instanceof BaseError
            ? error.walk(e => !!e && typeof e === "object" && "code" in e && e.code === 4001)
            : error;
        // Only an explicit wallet rejection proves this intent was not submitted.
        if (cause && typeof cause === "object" && "code" in cause && cause.code === 4001) rejected();
        throw error;
      }
      submitted(hash);
      return hash;
    });
  }
  return { approve, send, switchSource: (chainId: number) => switchChain(config, { chainId }) };
}
