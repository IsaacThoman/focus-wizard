import { Router, Status } from "@oak/oak";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const VAULT_KEYPAIR_PATH = new URL("./vault-keypair.json", import.meta.url);
const WALLET_STATE_PATH = new URL("./wallet-state.json", import.meta.url);

// Conversion rate: 1 SOL = 87.40 USD
const SOL_TO_USD_RATE = 87.40;

let vaultKeypair: Keypair | null = null;
let connectedWalletAddress: string | null = null;

/**
 * Simple async mutex to serialize state mutations.
 * Prevents race conditions when multiple requests try to read-modify-write
 * walletState concurrently (e.g., two /complete-cycle or a /withdraw + /tx-notify).
 */
let _lockQueue: Promise<void> = Promise.resolve();
function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _lockQueue;
  let resolve: () => void;
  _lockQueue = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

// Set of already-processed transaction signatures to prevent replay/double-credit
const seenSignatures = new Set<string>();

// Wallet state: tracks vault vs earned amounts
interface WalletState {
  vaultBalance: number;  // Total deposited (in SOL)
  earnedBalance: number;  // Available for withdrawal (in SOL)
  rewardPerCycle: number;  // SOL earned per completed pomodoro cycle
  totalCyclesCompleted: number;
}

let walletState: WalletState = {
  vaultBalance: 0,
  earnedBalance: 0,
  rewardPerCycle: 0.001,  // Default: 0.001 SOL per cycle
  totalCyclesCompleted: 0,
};

/**
 * Load wallet state from disk or use defaults.
 * Validates all fields at runtime to prevent NaN/corrupt data from propagating.
 */
async function loadWalletState(): Promise<void> {
  try {
    const raw = await Deno.readTextFile(WALLET_STATE_PATH);
    const parsed = JSON.parse(raw);

    // Validate each field individually — only accept finite numbers
    const safeNum = (val: unknown, fallback: number): number => {
      return typeof val === "number" && Number.isFinite(val) ? val : fallback;
    };

    walletState = {
      vaultBalance: Math.max(0, safeNum(parsed.vaultBalance, 0)),
      earnedBalance: Math.max(0, safeNum(parsed.earnedBalance, 0)),
      rewardPerCycle: Math.max(0, safeNum(parsed.rewardPerCycle, 0.001)),
      totalCyclesCompleted: Math.max(0, Math.floor(safeNum(parsed.totalCyclesCompleted, 0))),
    };

    console.log("Loaded wallet state:", walletState);
  } catch (e: unknown) {
    if (e instanceof Deno.errors.NotFound) {
      console.log("No wallet state file found, using defaults");
      await saveWalletState();
    } else {
      console.error("Failed to load wallet state:", e);
    }
  }
}

/**
 * Save wallet state to disk.
 * Includes safety guards: clamps negative balances and refuses to
 * zero-out a state that previously had funds (corruption guard).
 */
async function saveWalletState(): Promise<void> {
  try {
    // Clamp: balances should never go negative
    if (walletState.vaultBalance < 0) {
      console.warn(`[saveWalletState] vaultBalance was negative (${walletState.vaultBalance}), clamping to 0`);
      walletState.vaultBalance = 0;
    }
    if (walletState.earnedBalance < 0) {
      console.warn(`[saveWalletState] earnedBalance was negative (${walletState.earnedBalance}), clamping to 0`);
      walletState.earnedBalance = 0;
    }

    // Corruption guard: if both balances are zero but cycles have been completed,
    // something is wrong. Log a warning but still allow it (could be a legitimate full withdrawal).
    if (walletState.vaultBalance === 0 && walletState.earnedBalance === 0 && walletState.totalCyclesCompleted > 0) {
      console.warn(
        `[saveWalletState] Warning: saving zero balances with ${walletState.totalCyclesCompleted} completed cycles. ` +
        `This may indicate a bug if the user didn't fully withdraw.`
      );
    }

    await Deno.writeTextFile(WALLET_STATE_PATH, JSON.stringify(walletState, null, 2));
  } catch (e) {
    console.error("Failed to save wallet state:", e);
  }
}

/**
 * Convert SOL amount to USD.
 */
function solToUsd(solAmount: number): number {
  return solAmount * SOL_TO_USD_RATE;
}

// Initialize wallet state and keypair. This promise resolves when both are ready.
// All request handlers must await this before accessing walletState or vaultKeypair.
const _initPromise = Promise.all([
  loadWalletState().catch((e) => console.error("Failed to init wallet state:", e)),
  getVaultKeypair().catch((e) => console.error("Failed to init vault keypair:", e)),
]);

const connection = new Connection(MAINNET_RPC, "confirmed");

/**
 * Load or generate the wizard vault keypair.
 * The keypair is stored as a JSON array of bytes in vault-keypair.json.
 */
async function getVaultKeypair(): Promise<Keypair> {
  if (vaultKeypair) return vaultKeypair;

  try {
    const raw = await Deno.readTextFile(VAULT_KEYPAIR_PATH);
    const secretKey = new Uint8Array(JSON.parse(raw));
    vaultKeypair = Keypair.fromSecretKey(secretKey);
    console.log(
      `Loaded vault keypair: ${vaultKeypair.publicKey.toString()}`,
    );
  } catch (e: unknown) {
    // Only generate a new keypair if the file truly doesn't exist.
    // Any other error (corrupt JSON, permissions, etc.) should be
    // surfaced so we never silently lose access to an existing wallet.
    if (e instanceof Deno.errors.NotFound) {
      // Double-check the file really isn't there before writing
      let fileExists = false;
      try {
        await Deno.stat(VAULT_KEYPAIR_PATH);
        fileExists = true;
      } catch { /* stat failed, file genuinely missing */ }

      if (fileExists) {
        throw new Error(
          "vault-keypair.json exists on disk but could not be read. " +
          "Refusing to overwrite — fix the file manually.",
        );
      }

      vaultKeypair = Keypair.generate();
      await Deno.writeTextFile(
        VAULT_KEYPAIR_PATH,
        JSON.stringify(Array.from(vaultKeypair.secretKey)),
      );
      console.log(
        `Generated new vault keypair: ${vaultKeypair.publicKey.toString()}`,
      );
    } else {
      throw new Error(
        `Failed to load vault-keypair.json (file exists but is unreadable or corrupt). ` +
        `Fix it manually — refusing to generate a new keypair. Original error: ${e}`,
      );
    }
  }

  return vaultKeypair;
}

export function createWalletRouter(): Router {
  const router = new Router({ prefix: "/wallet" });

  // Ensure wallet state and keypair are loaded before handling any request.
  // This prevents early requests from operating on default/zero state.
  router.use(async (_ctx, next) => {
    await _initPromise;
    await next();
  });

  // Serve the wallet HTML page
  router.get("/", async (ctx) => {
    try {
      const htmlPath = new URL("./wallet.html", import.meta.url);
      const html = await Deno.readTextFile(htmlPath);
      ctx.response.type = "text/html";
      ctx.response.body = html;
    } catch (e) {
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { error: "Failed to load wallet page" };
      console.error("Failed to serve wallet.html:", e);
    }
  });

  // Return the vault public address
  router.get("/vault", async (ctx) => {
    try {
      const kp = await getVaultKeypair();
      const pubkey = kp.publicKey;
      const lamports = await connection.getBalance(pubkey);
      ctx.response.body = {
        vaultAddress: pubkey.toString(),
        balanceSol: lamports / LAMPORTS_PER_SOL,
      };
    } catch (e) {
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = {
        error: e instanceof Error ? e.message : "Failed to get vault info",
      };
    }
  });

  // Track wallet connection from the browser page
  router.post("/connect", async (ctx) => {
    try {
      const body = await ctx.request.body.json();
      if (
        typeof body.walletAddress === "string" && body.walletAddress.length > 0
      ) {
        connectedWalletAddress = body.walletAddress;
        console.log(`Wallet connected: ${connectedWalletAddress}`);
        ctx.response.body = { ok: true };
      } else {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { error: "Missing walletAddress" };
      }
    } catch (e) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        error: e instanceof Error ? e.message : "Invalid request",
      };
    }
  });

  // Track wallet disconnection
  router.post("/disconnect", (ctx) => {
    connectedWalletAddress = null;
    console.log("Wallet disconnected");
    ctx.response.body = { ok: true };
  });

  // Notify backend about a send transaction (user -> vault)
  router.post("/tx-notify", async (ctx) => {
    try {
      const body = await ctx.request.body.json();
      const { type, signature, amount } = body;
      console.log(
        `Transaction notification: type=${type}, sig=${signature}, amount=${amount} SOL`,
      );

      if (type !== "send" || typeof amount !== "number" || amount <= 0) {
        ctx.response.body = { ok: true, vaultBalance: walletState.vaultBalance, earnedBalance: walletState.earnedBalance };
        return;
      }

      if (!signature || typeof signature !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { error: "Missing transaction signature" };
        return;
      }

      // Prevent replay: reject already-seen signatures
      if (seenSignatures.has(signature)) {
        console.warn(`[tx-notify] Duplicate signature rejected: ${signature}`);
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { error: "Transaction already processed" };
        return;
      }

      // Verify the transaction on-chain before crediting
      let verifiedAmount: number | null = null;
      try {
        const kp = await getVaultKeypair();
        const txResult = await connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        if (!txResult || !txResult.meta) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = { error: "Transaction not found or not yet confirmed on-chain" };
          return;
        }

        if (txResult.meta.err) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = { error: "Transaction failed on-chain" };
          return;
        }

        // Find the vault's account index and compute the net credit
        const accountKeys = txResult.transaction.message.getAccountKeys();
        const vaultPubkeyStr = kp.publicKey.toString();
        let vaultIndex = -1;
        for (let i = 0; i < accountKeys.length; i++) {
          if (accountKeys.get(i)?.toString() === vaultPubkeyStr) {
            vaultIndex = i;
            break;
          }
        }

        if (vaultIndex === -1) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = { error: "Vault address not found in transaction" };
          return;
        }

        const preBalance = txResult.meta.preBalances[vaultIndex];
        const postBalance = txResult.meta.postBalances[vaultIndex];
        const netLamports = postBalance - preBalance;

        if (netLamports <= 0) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = { error: "Transaction did not credit the vault" };
          return;
        }

        verifiedAmount = netLamports / LAMPORTS_PER_SOL;
      } catch (verifyErr) {
        console.error("[tx-notify] On-chain verification failed:", verifyErr);
        ctx.response.status = Status.InternalServerError;
        ctx.response.body = { error: "Failed to verify transaction on-chain" };
        return;
      }

      // Use the verified on-chain amount (not the client-supplied amount)
      await withStateLock(async () => {
        walletState.vaultBalance += verifiedAmount!;
        await saveWalletState();
        seenSignatures.add(signature);
        console.log(`Updated vault balance: ${walletState.vaultBalance} SOL (verified: ${verifiedAmount} SOL)`);
      });
      
      ctx.response.body = { 
        ok: true,
        vaultBalance: walletState.vaultBalance,
        earnedBalance: walletState.earnedBalance,
        verifiedAmount,
      };
    } catch (e) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        error: e instanceof Error ? e.message : "Invalid request",
      };
    }
  });

  // Complete a pomodoro cycle - move SOL from vault to earned
  router.post("/complete-cycle", async (ctx) => {
    try {
      const result = await withStateLock(async () => {
        // Nothing to move if vault is empty
        if (walletState.vaultBalance <= 0) {
          return { error: "Vault is empty. Deposit SOL to start earning." };
        }

        // Move the reward amount, or whatever's left in the vault if less than the full reward
        const actualReward = Math.min(walletState.rewardPerCycle, walletState.vaultBalance);

        walletState.vaultBalance -= actualReward;
        walletState.earnedBalance += actualReward;
        walletState.totalCyclesCompleted += 1;
        await saveWalletState();

        const wasPartial = actualReward < walletState.rewardPerCycle;
        console.log(
          `Cycle completed! Moved ${actualReward} SOL from vault to earned${wasPartial ? " (partial — vault depleted)" : ""}. ` +
          `Total cycles: ${walletState.totalCyclesCompleted}`
        );

        return {
          success: true,
          rewardAmount: actualReward,
          partial: wasPartial,
          vaultBalance: walletState.vaultBalance,
          earnedBalance: walletState.earnedBalance,
          totalCyclesCompleted: walletState.totalCyclesCompleted,
          earnedUsd: solToUsd(walletState.earnedBalance),
        };
      });

      if ("error" in result) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          error: result.error,
          vaultBalance: walletState.vaultBalance,
          earnedBalance: walletState.earnedBalance,
        };
      } else {
        ctx.response.body = result;
      }
    } catch (e) {
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = {
        error: e instanceof Error ? e.message : "Failed to complete cycle",
      };
    }
  });

  // Get/set reward per cycle configuration
  router.get("/config", async (ctx) => {
    ctx.response.body = {
      rewardPerCycle: walletState.rewardPerCycle,
      solToUsdRate: SOL_TO_USD_RATE,
    };
  });

  router.post("/config", async (ctx) => {
    try {
      const body = await ctx.request.body.json();
      if (typeof body.rewardPerCycle === "number" && body.rewardPerCycle >= 0) {
        walletState.rewardPerCycle = body.rewardPerCycle;
        await saveWalletState();
        ctx.response.body = {
          success: true,
          rewardPerCycle: walletState.rewardPerCycle,
        };
      } else {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { error: "Invalid rewardPerCycle value" };
      }
    } catch (e) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        error: e instanceof Error ? e.message : "Invalid request",
      };
    }
  });

  // Withdraw SOL from EARNED balance to user's wallet
  router.post("/withdraw", async (ctx) => {
    try {
      const body = await ctx.request.body.json();
      const { toAddress, amount } = body;

      if (!toAddress || typeof toAddress !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { error: "Missing toAddress" };
        return;
      }

      if (!amount || typeof amount !== "number" || amount <= 0) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { error: "Invalid amount" };
        return;
      }

      let toPubkey: PublicKey;
      try {
        toPubkey = new PublicKey(toAddress);
      } catch {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { error: "Invalid Solana address" };
        return;
      }

      // Everything from balance check through on-chain send and state update
      // must be serialized to prevent double-spend.
      const result = await withStateLock(async () => {
        // Check earned balance
        if (amount > walletState.earnedBalance) {
          return {
            error: `Insufficient earned balance. Available: ${walletState.earnedBalance.toFixed(4)} SOL ($${solToUsd(walletState.earnedBalance).toFixed(2)} USD)`,
            earnedBalance: walletState.earnedBalance,
            earnedUsd: solToUsd(walletState.earnedBalance),
          };
        }

        const kp = await getVaultKeypair();
        const vaultLamports = await connection.getBalance(kp.publicKey);
        const lamportsToSend = Math.round(amount * LAMPORTS_PER_SOL);

        // Need to keep some for rent + fees
        const MIN_RESERVE = 5000; // ~0.000005 SOL for tx fee
        if (lamportsToSend + MIN_RESERVE > vaultLamports) {
          return {
            error: `Insufficient vault on-chain balance. Available: ${
              ((vaultLamports - MIN_RESERVE) / LAMPORTS_PER_SOL).toFixed(6)
            } SOL`,
          };
        }

        // Deduct from earned balance BEFORE sending on-chain.
        // This prevents double-spend if another request arrives while the tx is in-flight.
        walletState.earnedBalance -= amount;
        await saveWalletState();

        console.log(
          `Withdrawing ${amount} SOL from EARNED balance to ${toAddress}...`,
        );

        try {
          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: kp.publicKey,
              toPubkey,
              lamports: lamportsToSend,
            }),
          );

          const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [kp],
          );

          console.log(`Withdrawal complete: ${signature}`);
          console.log(`Updated earned balance: ${walletState.earnedBalance} SOL`);

          return {
            success: true,
            signature,
            amount,
            remainingEarned: walletState.earnedBalance,
            remainingEarnedUsd: solToUsd(walletState.earnedBalance),
          };
        } catch (txErr) {
          // On-chain send failed — roll back the earned balance deduction
          console.error("On-chain withdrawal failed, rolling back:", txErr);
          walletState.earnedBalance += amount;
          await saveWalletState();
          return {
            error: txErr instanceof Error ? txErr.message : "On-chain withdrawal failed",
          };
        }
      });

      if ("success" in result) {
        ctx.response.body = result;
      } else {
        ctx.response.status = "earnedBalance" in result ? Status.BadRequest : Status.InternalServerError;
        ctx.response.body = result;
      }
    } catch (e) {
      console.error("Withdrawal failed:", e);
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = {
        error: e instanceof Error ? e.message : "Withdrawal failed",
      };
    }
  });

  // Get wallet status for the Electron app (READ-ONLY — never mutates state)
  router.get("/status", async (ctx) => {
    try {
      const kp = await getVaultKeypair();
      const vaultLamports = await connection.getBalance(kp.publicKey);
      const onChainBalance = vaultLamports / LAMPORTS_PER_SOL;
      const trackedTotal = walletState.vaultBalance + walletState.earnedBalance;

      // Report discrepancy between on-chain and tracked state (informational only)
      const discrepancy = onChainBalance - trackedTotal;
      if (Math.abs(discrepancy) > 0.000001) {
        console.log(
          `[status] On-chain: ${onChainBalance} SOL, Tracked: ${trackedTotal} SOL, ` +
          `Discrepancy: ${discrepancy > 0 ? "+" : ""}${discrepancy.toFixed(6)} SOL`
        );
      }
      
      ctx.response.body = {
        vaultAddress: kp.publicKey.toString(),
        onChainBalanceSol: onChainBalance,
        vaultBalanceSol: walletState.vaultBalance,
        earnedBalanceSol: walletState.earnedBalance,
        totalBalanceSol: trackedTotal,
        earnedBalanceUsd: solToUsd(walletState.earnedBalance),
        vaultBalanceUsd: solToUsd(walletState.vaultBalance),
        totalBalanceUsd: solToUsd(trackedTotal),
        rewardPerCycle: walletState.rewardPerCycle,
        rewardPerCycleUsd: solToUsd(walletState.rewardPerCycle),
        totalCyclesCompleted: walletState.totalCyclesCompleted,
        connectedWallet: connectedWalletAddress,
        solToUsdRate: SOL_TO_USD_RATE,
        // Positive = untracked SOL on-chain (external deposit?), negative = tracked > on-chain (fees/timing)
        discrepancySol: Math.abs(discrepancy) > 0.000001 ? discrepancy : 0,
      };
    } catch (e) {
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = {
        error: e instanceof Error ? e.message : "Failed to get status",
      };
    }
  });

  // One-time migration: seed wallet state from on-chain balance.
  // Use this when a user already had SOL on-chain before the vault/earned split
  // was introduced. All existing on-chain SOL goes into the vault.
  router.post("/migrate", async (ctx) => {
    try {
      const trackedTotal = walletState.vaultBalance + walletState.earnedBalance;
      
      // Only allow migration if tracked state is essentially empty
      if (trackedTotal > 0.000001) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          error: `Migration not needed — wallet state already has tracked balances ` +
            `(vault: ${walletState.vaultBalance} SOL, earned: ${walletState.earnedBalance} SOL). ` +
            `Use /wallet/admin/set-state to manually adjust if needed.`,
        };
        return;
      }

      const kp = await getVaultKeypair();
      const vaultLamports = await connection.getBalance(kp.publicKey);
      const onChainBalance = vaultLamports / LAMPORTS_PER_SOL;

      if (onChainBalance <= 0.000001) {
        ctx.response.body = {
          success: true,
          message: "No on-chain balance to migrate.",
          vaultBalance: 0,
          earnedBalance: 0,
        };
        return;
      }

      walletState.vaultBalance = onChainBalance;
      walletState.earnedBalance = 0;
      await saveWalletState();

      console.log(`[migrate] Seeded vault balance from on-chain: ${onChainBalance} SOL`);

      ctx.response.body = {
        success: true,
        message: `Migrated ${onChainBalance} SOL from on-chain balance into vault.`,
        vaultBalance: walletState.vaultBalance,
        earnedBalance: walletState.earnedBalance,
      };
    } catch (e) {
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = {
        error: e instanceof Error ? e.message : "Migration failed",
      };
    }
  });

  // Admin endpoint: manually set wallet state (for debugging/recovery)
  router.post("/admin/set-state", async (ctx) => {
    try {
      const body = await ctx.request.body.json();
      const before = { ...walletState };

      if (typeof body.vaultBalance === "number") {
        walletState.vaultBalance = Math.max(0, body.vaultBalance);
      }
      if (typeof body.earnedBalance === "number") {
        walletState.earnedBalance = Math.max(0, body.earnedBalance);
      }
      if (typeof body.rewardPerCycle === "number") {
        walletState.rewardPerCycle = Math.max(0, body.rewardPerCycle);
      }
      if (typeof body.totalCyclesCompleted === "number") {
        walletState.totalCyclesCompleted = Math.max(0, Math.floor(body.totalCyclesCompleted));
      }

      await saveWalletState();

      console.log(`[admin/set-state] State updated:`, { before, after: { ...walletState } });

      ctx.response.body = {
        success: true,
        before,
        after: { ...walletState },
      };
    } catch (e) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        error: e instanceof Error ? e.message : "Invalid request",
      };
    }
  });

  // Proxy Solana JSON-RPC requests through the backend to avoid
  // browser-origin 403 blocks from the public mainnet RPC endpoint.
  router.post("/rpc", async (ctx) => {
    try {
      const body = await ctx.request.body.text();
      const rpcResp = await fetch(MAINNET_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const rpcText = await rpcResp.text();
      ctx.response.type = "application/json";
      ctx.response.body = rpcText;
    } catch (e) {
      ctx.response.status = Status.BadGateway;
      ctx.response.body = JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: e instanceof Error ? e.message : "RPC proxy error",
        },
        id: null,
      });
      ctx.response.type = "application/json";
    }
  });

  return router;
}
