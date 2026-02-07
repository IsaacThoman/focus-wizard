import { Router, Status } from "@oak/oak";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const VAULT_KEYPAIR_PATH = new URL("./vault-keypair.json", import.meta.url);

let vaultKeypair: Keypair | null = null;
let connectedWalletAddress: string | null = null;

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
  } catch {
    // Generate a new keypair if none exists
    vaultKeypair = Keypair.generate();
    await Deno.writeTextFile(
      VAULT_KEYPAIR_PATH,
      JSON.stringify(Array.from(vaultKeypair.secretKey)),
    );
    console.log(
      `Generated new vault keypair: ${vaultKeypair.publicKey.toString()}`,
    );
  }

  return vaultKeypair;
}

// Eagerly load the vault keypair on module init
getVaultKeypair().catch((e) =>
  console.error("Failed to init vault keypair:", e)
);

export function createWalletRouter(): Router {
  const router = new Router({ prefix: "/wallet" });

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
      if (typeof body.walletAddress === "string" && body.walletAddress.length > 0) {
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
      console.log(
        `Transaction notification: type=${body.type}, sig=${body.signature}, amount=${body.amount} SOL`,
      );
      ctx.response.body = { ok: true };
    } catch (e) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        error: e instanceof Error ? e.message : "Invalid request",
      };
    }
  });

  // Withdraw SOL from vault to user's wallet
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

      const kp = await getVaultKeypair();
      const vaultBalance = await connection.getBalance(kp.publicKey);
      const lamportsToSend = Math.round(amount * LAMPORTS_PER_SOL);

      // Need to keep some for rent + fees
      const MIN_RESERVE = 5000; // ~0.000005 SOL for tx fee
      if (lamportsToSend + MIN_RESERVE > vaultBalance) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          error: `Insufficient vault balance. Available: ${((vaultBalance - MIN_RESERVE) / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
        };
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

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: kp.publicKey,
          toPubkey,
          lamports: lamportsToSend,
        }),
      );

      console.log(
        `Withdrawing ${amount} SOL from vault to ${toAddress}...`,
      );

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [kp],
      );

      console.log(`Withdrawal complete: ${signature}`);

      ctx.response.body = { signature, amount };
    } catch (e) {
      console.error("Withdrawal failed:", e);
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = {
        error: e instanceof Error ? e.message : "Withdrawal failed",
      };
    }
  });

  // Get wallet status for the Electron app
  router.get("/status", async (ctx) => {
    try {
      const kp = await getVaultKeypair();
      const vaultLamports = await connection.getBalance(kp.publicKey);
      ctx.response.body = {
        vaultAddress: kp.publicKey.toString(),
        vaultBalanceSol: vaultLamports / LAMPORTS_PER_SOL,
        connectedWallet: connectedWalletAddress,
      };
    } catch (e) {
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = {
        error: e instanceof Error ? e.message : "Failed to get status",
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
