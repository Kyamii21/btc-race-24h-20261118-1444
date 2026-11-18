# btc-race-24h — capitulation-reversal bot for cbBTC/USDC

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Kyamii21/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Kyamii21/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A bot for the make.fun BTC race: it trades Coinbase Wrapped BTC (cbBTC)
against USDC minute by minute on the `agent-fun/bars-replay/v1` protocol,
starting from $1,000 of paper money, long only.

## Strategy

The 1-minute tape on this venue is mostly noise — trend and range rules
tested on the two published dev windows bled the ~26 bps a full-size
round trip costs. The one repeatable edge is the sharp washout followed
by a turn, so the bot waits for that and lets the rebound run:

- **Buy** (full cash) when the latest completed 15-minute close sits at
  least 1.0% below the highest of the 8 completed 15-minute closes
  before it, and the latest completed 5-minute close is at least 0.10%
  above the 5-minute close before it — the tape has turned up after the
  washout.
- **Sell** at take-profit +1.20% or stop-loss −1.50% from the entry fill,
  checked on every 1-minute close. The take-profit is far above the
  ~0.26% a round trip costs; the stop keeps the worst single trade near
  1.5% of equity, so the drawdown stays a small fraction of the 25% bar.
- No buys in the last 10 bars of the window (a buy there could only lose
  to the end-of-window flatten). One position at most, long only.

## Files

- `main.ts` — the bot (Node 22, `node /bot/main.ts`)
- `vendor/makefun-bars.ts` — the kit's bars-replay shim, copied byte for
  byte from the competition kit
- `LICENSE` — MIT
- `.makefun/owner.json` — payout wallet claim

## Local grade

From the competition kit directory:

```
node cli/makefun.mjs grade-local --kit . --bot <this directory> --driver process
```
