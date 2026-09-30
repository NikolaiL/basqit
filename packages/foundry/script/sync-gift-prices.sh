#!/usr/bin/env bash
# Testnet only: sets the testnet swap adapter's prices to the live mainnet Stock Token prices (mid of token bid and ask),
# so every gift the router buys is priced like the real Stock Tokens right now.
#   BASQIT_URL=https://basqit.app ./script/sync-gift-prices.sh
# Needs TESTNET_DEPLOYER_PRIVATE_KEY (the adapter owner) in packages/foundry/.env.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a && . ./.env && set +a
URL="${BASQIT_URL:-http://localhost:3000}"
RPC=robinhoodTestnet
# Addresses from the latest `yarn deploy --network robinhoodTestnet` broadcast.
RUN=broadcast/Deploy.s.sol/46630/run-latest.json
addr() { node -p "require('./$RUN').transactions.filter(t => t.contractName === '$1').at(-1).contractAddress"; }
SHOP=$(addr TestnetSwapAdapter)
FACTORY=$(addr BasqitFactory)
for token in $(cast call "$FACTORY" 'stockTokens()(address[])' --rpc-url $RPC | tr -d '[],'); do
  symbol=$(cast call "$token" 'symbol()(string)' --rpc-url $RPC | tr -d '"')
  ticker=${symbol#t}
  price=$(curl -fsS "$URL/api/stocks/details?symbol=$ticker" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const q=JSON.parse(s);const mid=(+q.tokenBid + +q.tokenAsk)/2;if(q.currency!=="USD"||!(mid>0))process.exit(1);console.log(Math.round(mid*1e6))})')
  current=$(cast call "$SHOP" 'priceUsdG(address)(uint256)' "$token" --rpc-url $RPC | awk '{print $1}')
  if [ "$price" = "$current" ]; then echo "$symbol unchanged ($price)"; continue; fi
  cast send "$SHOP" 'setPrice(address,uint256)' "$token" "$price" --private-key "$TESTNET_DEPLOYER_PRIVATE_KEY" --rpc-url $RPC >/dev/null
  echo "$symbol $current -> $price"
done
