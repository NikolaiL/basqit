export type RpcRequest = (args: { method: string; params?: unknown }) => Promise<unknown>;

/** The public testnet RPC allows at most 10 million blocks per log query. */
export function withLogRanges(request: RpcRequest): RpcRequest {
  return async args => {
    if (args.method !== "eth_getLogs") return request(args);
    const [filter] = args.params as [{ fromBlock?: string; toBlock?: string; blockHash?: string }];
    if (filter.blockHash || !filter.fromBlock?.startsWith("0x")) return request(args);
    let end = filter.toBlock;
    if (!end || end === "latest") end = (await request({ method: "eth_blockNumber" })) as string;
    if (!end.startsWith("0x")) return request(args);
    const last = BigInt(end);
    const logs: unknown[] = [];
    for (let from = BigInt(filter.fromBlock); from <= last; from += 10_000_000n) {
      const to = from + 9_999_999n < last ? from + 9_999_999n : last;
      const batch = await request({
        ...args,
        params: [{ ...filter, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
      });
      logs.push(...(batch as unknown[]));
    }
    return logs;
  };
}
