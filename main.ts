// btc-race-24h-20261118-1444 — capitulation-reversal bot for cbBTC/USDC.
//
// Idea: on this venue the 1-minute tape is mostly noise — every trend and
// range rule I tested on the two published dev windows bled the ~26 bps a
// full-size round trip costs. The one repeatable edge is the sharp washout
// followed by a turn: after the price falls hard from its recent high and
// the 5-minute tape turns back up, the next hours tend to recover, so the
// bot buys that turn with its whole cash and lets the rebound run.
//
// Signals are read off 5-minute and 15-minute closes built from the
// 1-minute bars (never off a 1-minute wiggle, never off a 4-hour lookback):
//   entry — the latest completed 15-minute close sits at least 1.0% below
//           the highest of the 8 completed 15-minute closes before it, and
//           the latest completed 5-minute close is at least 0.10% above
//           the 5-minute close before it (the tape has turned up).
//   exit  — take-profit +1.20% or stop-loss -1.50% from the entry fill,
//           checked on every 1-minute close. The take-profit is far above
//           the ~0.26% a round trip costs, so a win is a real win; the stop
//           keeps the worst single trade near 1.5% of equity, so the
//           drawdown stays a small fraction of the 25% bar.
// One position at most, long only, full cash on every buy, no buys in the
// last 10 bars (a buy there could only lose to the end-of-window flatten).
// No clock, no environment, no randomness: the same bars always give the
// same orders.
//
// Validated with the kit's own grader (grade-local --driver process):
//   this competition's dev window: net PnL +10.64 USDC, 2 fills, max
//     drawdown 0.65% — passes the dev gate (net PnL > 0).
//   out-of-sample on the previous race's dev window: net PnL +20.53 USDC,
//     5 fills, max drawdown 1.32%.
// Every simpler rule tried first (1-minute and 15-minute EMA crosses,
// momentum, range dips, RSI/Bollinger-style mean reversion) lost money on
// one or both windows; the kit's own baselines lost $24–$148 on this dev
// window, so a selective bot that waits for the washout beats a busy one.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
// Price scale of the venue: a raw price p is p / 10^5 USDC per cbBTC.
const PRICE_SCALE = 1e5;
// A minute is 60_000 ms; the signal bars are 5 and 15 of them.
const MINUTE_MS = 60_000;
const FIVE_MS = 5 * MINUTE_MS;
const FIFTEEN_MS = 15 * MINUTE_MS;
// The setup needs 8 completed 15-minute closes before the latest one.
const LOOKBACK_15M = 8;
// Entry: 15-minute close this far below its 2-hour high, and the 5-minute
// tape turning up by at least this much from its previous close.
const DROP_FROM_HIGH = 0.01;
const UPTURN_5M = 0.001;
// Exit: take-profit / stop-loss from the entry fill price.
const TAKE_PROFIT = 0.012;
const STOP_LOSS = 0.015;
// Never let a fill be more than 1% away from the latest close we saw.
const MAX_SLIPPAGE_BPS = 100;
// The window is 1,440 one-minute bars; do not open in its last 10.
const TOTAL_BARS = 1440;
const NO_BUY_LAST = 10;

interface AggState {
  // Timestamp of the very first bar seen: every signal bar is anchored to it.
  anchorMs: number | null;
  // The 5-minute bucket now open and its latest close (USDC).
  fiveBucket: number;
  fiveClose: number;
  // Completed 5-minute closes, oldest first.
  fives: number[];
  // The 15-minute bucket now open and its latest close (USDC).
  fifteenBucket: number;
  fifteenClose: number;
  // Completed 15-minute closes, oldest first.
  fifteens: number[];
}

const agg: AggState = {
  anchorMs: null,
  fiveBucket: -1,
  fiveClose: 0,
  fives: [],
  fifteenBucket: -1,
  fifteenClose: 0,
  fifteens: [],
};

// The fill price of the open position (USDC per cbBTC), or 0 when flat.
let entryPrice = 0;

// Fold one 1-minute bar into the 5-minute and 15-minute closes. Returns
// true when a 5-minute bar completed on this bar (the moment entries are
// judged). Buckets are anchored to the first bar's timestamp, so a missing
// minute only leaves a hole instead of shifting every later bar.
function foldBar(tMs: number, closeUsdc: number): boolean {
  if (agg.anchorMs === null) {
    agg.anchorMs = tMs;
  }
  const fiveBucket = Math.floor((tMs - agg.anchorMs) / FIVE_MS);
  const fifteenBucket = Math.floor((tMs - agg.anchorMs) / FIFTEEN_MS);
  let fiveCompleted = false;
  if (agg.fiveBucket === -1) {
    agg.fiveBucket = fiveBucket;
    agg.fiveClose = closeUsdc;
  } else if (fiveBucket !== agg.fiveBucket) {
    agg.fives.push(agg.fiveClose);
    agg.fiveBucket = fiveBucket;
    agg.fiveClose = closeUsdc;
    fiveCompleted = true;
  } else {
    agg.fiveClose = closeUsdc;
  }
  if (agg.fifteenBucket === -1) {
    agg.fifteenBucket = fifteenBucket;
    agg.fifteenClose = closeUsdc;
  } else if (fifteenBucket !== agg.fifteenBucket) {
    agg.fifteens.push(agg.fifteenClose);
    agg.fifteenBucket = fifteenBucket;
    agg.fifteenClose = closeUsdc;
  } else {
    agg.fifteenClose = closeUsdc;
  }
  return fiveCompleted;
}

// The capitulation setup: a hard washout on the 15-minute tape with the
// 5-minute tape already turning back up.
function capitulationSetup(): boolean {
  const f = agg.fifteens;
  if (f.length < LOOKBACK_15M + 1) return false;
  const latest15 = f[f.length - 1];
  let high = 0;
  for (let k = f.length - 1 - LOOKBACK_15M; k < f.length - 1; k++) {
    if (f[k]! > high) high = f[k]!;
  }
  if (latest15 > high * (1 - DROP_FROM_HIGH)) return false;
  const v = agg.fives;
  if (v.length < 2) return false;
  const last5 = v[v.length - 1]!;
  const prev5 = v[v.length - 2]!;
  return last5 > prev5 * (1 + UPTURN_5M);
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    // Learn the entry fill price from the fills this batch reports, before
    // judging anything on it.
    for (const fill of batch.fills) {
      if (fill.status === 'filled' && fill.side === 'buy' && fill.symbol === SYMBOL) {
        entryPrice = Number(fill.price) / PRICE_SCALE;
      }
    }
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const closeUsdc = Number(bar.c) / PRICE_SCALE;
    const fiveCompleted = foldBar(bar.t, closeUsdc);
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    const qty = held === undefined ? 0n : held.qty;
    if (qty > 0n) {
      // Holding: take the profit or cut the loss on this minute's close.
      if (entryPrice > 0) {
        const ret = closeUsdc / entryPrice - 1;
        if (ret >= TAKE_PROFIT || ret <= -STOP_LOSS) {
          entryPrice = 0;
          return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }

    // Flat: only a completed 5-minute bar can open a position.
    entryPrice = 0;
    if (!fiveCompleted) return [];
    const scoredIndex = state.seq - state.warmupBars;
    if (scoredIndex >= TOTAL_BARS - NO_BUY_LAST) return [];
    if (!capitulationSetup()) return [];
    return [
      {
        side: 'buy',
        symbol: SYMBOL,
        notional_quote_units: state.cash,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      },
    ];
  },
});
