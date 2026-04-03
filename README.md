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
The env file is included for immediate testing, but it is recommended to resetup the env file to ensure no errors.
1. Copy `.env.example` to `.env`
2. Deploy smart contracts (see 3.1 Deploy / Link Contracts (Hela Testnet)")
2. Fill in wallet keys, contract addresses, and tokens

### 3.1 Deploy / Link Contracts (Hela Testnet)
Run in this order:

```powershell
npm run build
```

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

Update `ui/config.js` to match deployed addresses in `.env`:

1. `escrowAddress`
2. `trackingAddress`
3. `disputeAddress`

If these do not match, UI transactions will fail.

## 4. Start Docker Container
Ensure Docker is running first.
```powershell
docker compose -f docker-compose.mongodb.yml up -d
```

To view DB in MongoDB Compass:
New Connection-> URi -> mongodb://root:password@localhost:27018/listings?authSource=admin


## 5. Run Backend

```powershell
npm run backend
```

Health check:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:5000/health | Select-Object -ExpandProperty Content
```

## 6. Run Oracle (Optional / if needed)

```powershell
npm run oracle:dev
```

Use when you want automatic tracking updates / oracle release flow.

## 7. Open App

1. Open `http://localhost:5000`
2. Choose Buyer/Seller role
3. Connect MetaMask on Hela testnet

## NPM Scripts

1. `npm run build`
2. `npm run deploy:escrow:hela`
3. `npm run deploy:tracking:hela`
4. `npm run deploy:dispute:hela`
5. `npm run link:contracts:hela`
6. `npm run backend`
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
