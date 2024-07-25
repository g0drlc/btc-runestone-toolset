import networkConfig from "../config/network.config"
import { SeedWallet } from "../utils/SeedWallet";
import * as Bitcoin from "bitcoinjs-lib";
import dotenv from "dotenv";
import { createPsbt, getUtxos, selectUTXO } from "./utxo";
import { pushBTCpmt } from "utils/mempool";

dotenv.config();

interface IUtxo {
    txid: string;
    vout: number;
    value: number;
}

const SEND_UTXO_LIMIT = 7000;
const SEND_AMOUNT = 100000;
const INITIAL_FEE = 1000;
const TESTNET_FEERATE = 20;
const RECEIVEADDRESS = 'tb1p04dlalf3vehyh5dfgaseljxcjd7cztrgyagyhpkt4h02deqq8vuqh82xww';
const receivedAddress = "";

const networkType: string = networkConfig.networkType;
const seed: string = process.env.MNEMONIC as string;

const main = async () => {
    let initialFee = 0;
    let redeemFee = INITIAL_FEE;
    let psbt;

    const wallet = new SeedWallet({ networkType: networkType, seed: seed });
    const utxos = await getUtxos(wallet.address, networkType);
    console.log(utxos);

    do {
        initialFee = redeemFee;
        const selectedUTXO = await selectUTXO(utxos, SEND_AMOUNT, initialFee);
        psbt = await createPsbt(selectedUTXO, SEND_AMOUNT, wallet, RECEIVEADDRESS, initialFee);
        psbt = wallet.signPsbt(psbt, wallet.ecPair);
        redeemFee = psbt.extractTransaction().virtualSize() * TESTNET_FEERATE;
    } while (redeemFee != initialFee)

    const txHex = psbt.extractTransaction().toHex();
    console.log("txhex", txHex);
    const txId = await pushBTCpmt(txHex, networkType);
    console.log("txId", txId);
}

main();