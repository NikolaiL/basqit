type Log = { blockNumber: bigint | null; blockTimestamp?: bigint | null };

/** A log's block time in seconds. The testnet RPC sends blockTimestamp "0x0" on logs, so zero counts as unknown and
 * the block's own time is read instead, once per block. */
export function blockTimes(getBlock: (blockNumber: bigint) => Promise<{ timestamp: bigint }>) {
  const blocks = new Map<bigint, Promise<number>>();
  return (log: Log) => {
    if (log.blockTimestamp) return Promise.resolve(Number(log.blockTimestamp));
    const number = log.blockNumber!;
    if (!blocks.has(number))
      blocks.set(
        number,
        getBlock(number).then(block => Number(block.timestamp)),
      );
    return blocks.get(number)!;
  };
}
