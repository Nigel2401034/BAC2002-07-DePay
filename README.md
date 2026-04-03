# BAC2002-07-DePay

End-to-end DePay marketplace with escrow, tracking, dispute, backend API, and UI.

## 1. Prerequisites

1. Node.js 18+ (Node 20 recommended)
2. npm
3. Docker Desktop (for MongoDB)
4. MetaMask wallet configured for Hela testnet

## 2. Install Dependencies

```powershell
npm install
```

## 3. Environment Setup

1. Copy `.env.example` to `.env`
2. Fill in wallet keys, contract addresses, and tokens

```powershell
Copy-Item .env.example .env
```

Important:

1. `.env` contains secrets and should not be shared.
2. `.env.example` is a safe template only.

### Test-Only Replica Values (Not Good Practice)

For this project replication/testing purpose only, you can paste the current test values below into `.env`.

Do not use this pattern in real projects. Never use these values on production networks.

```env
PRIVATE_KEY=cfb4ec26ae2004b51951415a8a21b4913795a94a82b65c3f375bf09a3c26846c
ORACLE_PRIVATE_KEY=1b533c04926806c63f6c9afedefd3908cb2216dc160b1b928d3d481a36ffce9b
ESCROW_ADDRESS=0xc4Ed2952c050Bd8330084f4C39155878B39939D4
ORDER_TRACKING_ADDRESS=0xC0efdbA6C116e5B3Ca4472E4F085a8fC542F1a82
DISPUTE_ADDRESS=0x6E29f3aBEa7bFed45560a1C270635e25705EB86e
RPC_URL=https://testnet-rpc.helachain.com
CHAIN_ID=0xa2d08
MONGODB_URI=mongodb://root:password@localhost:27018
NODE_ENV=development
SEED_LISTINGS_ON_START=true
```

## 4. Start MongoDB

```powershell
docker compose -f docker-compose.mongodb.yml up -d
```

Default DB in this project:

1. `MONGODB_URI=mongodb://root:password@localhost:27018`

## 5. Compile Contracts

```powershell
npm run build
```

## 6. Deploy / Link Contracts (Hela Testnet)

Run in this order:

1. Deploy Escrow

```powershell
npm run deploy:escrow:hela
```

2. Put the printed address into `.env` as `ESCROW_ADDRESS`

3. Deploy Tracking (also sets oracle where possible)

```powershell
npm run deploy:tracking:hela
```

4. Put the printed address into `.env` as `ORDER_TRACKING_ADDRESS`

5. Deploy Dispute (also links Escrow -> Dispute)

```powershell
npm run deploy:dispute:hela
```

6. Put the printed address into `.env` as `DISPUTE_ADDRESS`

7. Ensure all links are correct (Escrow dispute + oracle addresses)

```powershell
npm run link:contracts:hela
```

## 7. Sync Frontend Contract Addresses

Update `ui/config.js` to match deployed addresses in `.env`:

1. `escrowAddress`
2. `trackingAddress`
3. `disputeAddress`

If these do not match, UI transactions will fail.

## 8. Run Backend

```powershell
npm run backend:dev
```

Health check:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:5000/health | Select-Object -ExpandProperty Content
```

## 9. Run Oracle (Optional / if needed)

```powershell
npm run oracle:dev
```

Use when you want automatic tracking updates / oracle release flow.

## 10. Open App

1. Open `http://localhost:5000`
2. Choose Buyer/Seller role
3. Connect MetaMask on Hela testnet

## NPM Scripts

1. `npm run build`
2. `npm run deploy:escrow:hela`
3. `npm run deploy:tracking:hela`
4. `npm run deploy:dispute:hela`
5. `npm run link:contracts:hela`
6. `npm run backend:dev`
7. `npm run oracle:dev`

## Troubleshooting

1. `EADDRINUSE` on backend:
   Stop existing process on port 5000 or restart terminal.

2. Dispute/open transaction fails:
   Ensure `.env` and `ui/config.js` addresses are identical and `npm run link:contracts:hela` succeeds.

3. Wrong network:
   Switch MetaMask to Hela testnet chain ID `0xa2d08`.

4. Mongo connection failed:
   Ensure Docker MongoDB is running on `localhost:27018`.
