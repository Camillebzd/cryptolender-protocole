# Crypto lender Protocole (NFT)

This project contains the basic system for an NFT lending protocol. The goal is to allow an NFT owner to be able to lend his NFT to somebody else. The terms used in this context will be:
- lessor (the owner of the NFT)
- lessee (the renter of the NFT)

## Usage

```
npm install
npx hardhat test
npx hardhat coverage
```

If you want to deploy the protocole you will need a `.env` file like this:
```
SEPOLIA_RPC_URL=
PRIVATE_KEY=
ETHERSCAN_API_KEY=
```

## Context

We think that NFT images are cool but are not enough. The future of this tokens reside in the fact they will have a real utility in specific contexts like in videos games, financial services or real estates management.

The observation that convinced us to do this project is the following: many web3 games that use NFTs are not available to players who want to try it because if you want to play you need an NFT. Because cool games attract a lot of players and therefore increase the demand for these NFTs, their prices explode and it happens that certain games require a purchase of $100 dollars to be able to play. If you had the opportunity to just lend the token for 1 week and be able to play with it for like 5 it would be nice. Or imagine you need a specific really costly NFT to beat one boss in the game and you don't want to buy it, you just lend it for one day, beat the boss and that costed you less than one dollar which can be even worst if you earn money from the game!

Create a real lending system around NFTs allow users to have another layer of possibilities and can create new application or make certain viable that could not be before.

## Description

The operation is similar to that of a traditional property rental but here this is NFT, the only difference is that as it takes place in a decentralized system, trust is not possible: the lessee must therefore use a collateral to be sure that he returns the NFT.

### Non-technical process

These are the non-technicals steps:
1. the lessor create a listing on the protocol with the NFT he wants to lend.
2. the lessee create a proposal linked to the listing.
3. the lessor can accept the proposal from the lessee and it will create a proposal, the lessee will receive the NFT and place tokens as collateral in the protocol.
4. the lessee send back the NFT to the procotol to be able to recover his collateral.
5. the lessor come back and recover the NFT + interest from the rent.

### Technical process

Here is the actual technical process:
1. the lessor has to approve the Escrow on the ERC721 contract.
2. the lessor create a listing on the Listing manager.
3. the lessee has to approve the Escrow on the collateral ERC20 token contract.
4. the lessee create a proposal on the Proposal manager. (multiple proposal possibles)
5. the lessor can accept a proposal and create a rental on the Rental manager. The NFT will be send from the lessor to the lessee and the collateral from the lessee to the Escrow.
6. the lessee has to approve the Escrow on the ERC721 contract.
7. the lessee refund the rental, the NFT is send to the Escrow and the collateral tokens are send back to the lessee minus the price of the rent (+ protocol fees).
8. the lessor retreive his NFT and tokens from the Escrow.

## Architecture

The protocol is composed of 4 differents smart contract linked together to create the system:
- Escrow
- Listing manager
- Proposal manager
- Rental manager

### Escrow

The Escrow, as indicated by his name, is here to be the intermediary / escrow party in the system. It will stock the lessor's NFT after the refund and the collaterals tokens during the rent.

### Listing manager

The Listing manager is the contract used to create the listing by the owners of NFTs who want to rent their tokens.

### Proposal manager

The Proposal manager is the contract used to create proposals by the users who want to rent the NFTs listed in the Listing manager.

### Rental manager

The Rental manager is the contract used to create and handle the rental. It's used by the users that refund their rent and by NFTs owners that come back to retreive their NFT and tokens.