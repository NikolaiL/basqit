type Log = { blockNumber: bigint | null; blockTimestamp?: bigint | null };

/** A log's block time in seconds. The testnet RPC sends blockTimestamp "0x0" on logs, so zero counts as unknown and
 * the block's own time is read instead, once per block. */
export function blockTimes(getBlock: (blockNumber: bigint) => Promise<{ timestamp: bigint }>) {
  const blocks = new Map<bigint, Promise<number>>();
  return (log: Log) => {
    if (log.blockTimestamp) return Promise.resolve(Number(log.blockTimestamp));
    const number = log.blockNumber!;
    if (!blocks.has(number)) {
      const time = getBlock(number).then(block => Number(block.timestamp));
      // Forget failures: one RPC timeout must not break this block for the life of the server.
      time.catch(() => blocks.delete(number));
      blocks.set(number, time);
    }
    return blocks.get(number)!;
  };
}
