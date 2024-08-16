import networkConfig from "../config/network.config"
import { SeedWallet } from "../utils/SeedWallet";
import dotenv from "dotenv";
import {
    Transaction,
    script,
    Psbt,
    initEccLib,
    networks,
    Signer as BTCSigner,
    crypto,
    payments,
    opcodes,
    address as Address
} from "bitcoinjs-lib";
import ecc from "@bitcoinerlab/secp256k1";
import ECPairFactory, { ECPairAPI } from "ecpair";
import cbor from "cbor";
import { Taptree } from "bitcoinjs-lib/src/types";
import axios, { AxiosResponse } from "axios";
import { createPsbt, getUtxos, selectUTXO } from "./utxo";
import { pushBTCpmt } from "utils/mempool";
dotenv.config();

//test
const network = networks.testnet;

// Connection Wallet
const networkType: string = networkConfig.networkType;
const seed: string = process.env.MNEMONIC as string;
const wallet = new SeedWallet({ networkType: networkType, seed: seed });

initEccLib(ecc as any);
const ECPair: ECPairAPI = ECPairFactory(ecc);

const TESTNET_FEERATE = 20;
const receiveAddress: string = "tb1p55578npg8mx4w5zd7npud4c370d40yj42nhmjy0dy0hdmpar4vwqd6626w";
const metadata = {
    'type': 'Bitmap',
    'description': 'Bitmap Community Parent Ordinal'
}
const metadataBuffer = cbor.encode(metadata);
const transaction_fee = 35000;


const getInscriptionFee = async (keyPair: any, ordinal_p2tr: any, redeem: any): Promise<number> => {
    let initialFee: any = 0;
    const utxos = await getUtxos(wallet.address, networkType);
    let psbt = new Psbt({ network });
    let redeemFee: number = 1000;

    do {
        initialFee = redeemFee;
        let psbt = new Psbt({ network });

        psbt.addInput({
            hash: utxos[0].txid,
            index: utxos[0].vout,
            tapInternalKey: toXOnly(keyPair.publicKey),
            witnessUtxo: {
                value: utxos[0].value,
                script: ordinal_p2tr.output!
            },
            tapLeafScript: [
                {
                    leafVersion: redeem.redeemVersion,
                    script: redeem.output,
                    controlBlock: ordinal_p2tr.witness![ordinal_p2tr.witness!.length - 1],
                },
            ],
        });

        let change: any = utxos[0].value - 546 - initialFee;

        psbt.addOutput({
            address: receiveAddress, //Destination Address
            value: 546,
        });

        psbt = wallet.signSpecPsbt(psbt, wallet.ecPair);
        redeemFee = psbt.extractTransaction().virtualSize() * TESTNET_FEERATE;

    } while (redeemFee != initialFee)

    console.log("feeeeeeee", initialFee);
    return redeemFee;
}

export function createparentInscriptionTapScript(): Array<Buffer> {

    const keyPair = wallet.ecPair;
    const parentOrdinalStacks: any = [
        toXOnly(keyPair.publicKey),
        opcodes.OP_CHECKSIG,
        opcodes.OP_FALSE,
        opcodes.OP_IF,
        Buffer.from("ord", "utf8"),
        1,
        1,
        Buffer.concat([Buffer.from("text/plain;charset=utf-8", "utf8")]),
        1,
        5,
        metadataBuffer,
        opcodes.OP_0,
        Buffer.concat([Buffer.from("364972.bitmap", "utf8")]),
        opcodes.OP_ENDIF,
    ];
    return parentOrdinalStacks;
}

async function parentInscribe() {
    const keyPair = wallet.ecPair;
    const utxoOfWallet = await getUtxos(wallet.address, networkType);
    const parentOrdinalStack = createparentInscriptionTapScript();

    const ordinal_script = script.compile(parentOrdinalStack);

    const scriptTree: Taptree = {
        output: ordinal_script,
    };

    const redeem = {
        output: ordinal_script,
        redeemVersion: 192,
    };

    const ordinal_p2tr = payments.p2tr({
        internalPubkey: toXOnly(keyPair.publicKey),
        network,
        scriptTree,
        redeem,
    });

    const address = ordinal_p2tr.address ?? "";
    console.log("send coin to address", address);

    const inscriptionFee = getInscriptionFee(keyPair, ordinal_p2tr, redeem);
    const resolvedInscriptionFee: number = await inscriptionFee;

    await sendUTXO(resolvedInscriptionFee + 546, address);
    const utxos = await waitUntilUTXO(address as string);
    console.log(`Using UTXO ${utxos[utxos.length - 1].txid}:${utxos[utxos.length - 1].vout}`);


    const psbt = new Psbt({ network });

    psbt.addInput({
        hash: utxos[utxos.length - 1].txid,
        index: utxos[utxos.length - 1].vout,
        tapInternalKey: toXOnly(keyPair.publicKey),
        witnessUtxo: { value: utxos[utxos.length - 1].value, script: ordinal_p2tr.output! },
        tapLeafScript: [
            {
                leafVersion: redeem.redeemVersion,
                script: redeem.output,
                controlBlock: ordinal_p2tr.witness![ordinal_p2tr.witness!.length - 1],
            },
        ],
    });



    psbt.addOutput({
        address: receiveAddress, //Destination Address
        value: 546,
    });


    await signAndSend(keyPair, psbt);
}

parentInscribe()



export async function signAndSend(
    keypair: BTCSigner,
    psbt: Psbt,
) {
    psbt.signInput(0, keypair);
    psbt.finalizeAllInputs()
    const tx = psbt.extractTransaction();

    console.log(tx.virtualSize())
    console.log(tx.toHex())

    const txid = await broadcast(tx.toHex());
    console.log(`Success! Txid is ${txid}`);
}

export async function waitUntilUTXO(address: string) {
    return new Promise<IUTXO[]>((resolve, reject) => {
        let intervalId: any;
        const checkForUtxo = async () => {
            try {
                const response: AxiosResponse<string> = await blockstream.get(
                    `/address/${address}/utxo`
                );
                const data: IUTXO[] = response.data
                    ? JSON.parse(response.data)
                    : undefined;
                console.log(data);
                if (data.length > 0) {
                    resolve(data);
                    clearInterval(intervalId);
                }
            } catch (error) {
                reject(error);
                clearInterval(intervalId);
            }
        };
        intervalId = setInterval(checkForUtxo, 4000);
    });
}
export async function getTx(id: string): Promise<string> {
    const response: AxiosResponse<string> = await blockstream.get(
        `/tx/${id}/hex`
    );
    return response.data;
}
const blockstream = new axios.Axios({
    baseURL: `https://mempool.space/testnet/api`,
    // baseURL: `https://mempool.space/api`,
});
export async function broadcast(txHex: string) {
    const response: AxiosResponse<string> = await blockstream.post("/tx", txHex);
    return response.data;
}
function tapTweakHash(pubKey: Buffer, h: Buffer | undefined): Buffer {
    return crypto.taggedHash(
        "TapTweak",
        Buffer.concat(h ? [pubKey, h] : [pubKey])
    );
}
function toXOnly(pubkey: Buffer): Buffer {
    return pubkey.subarray(1, 33);
}
function tweakSigner(signer: any, opts: any = {}) {
    let privateKey = signer.privateKey;
    if (!privateKey) {
        throw new Error('Private key is required for tweaking signer!');
    }
    if (signer.publicKey[0] === 3) {
        privateKey = ecc.privateNegate(privateKey);
    }
    const tweakedPrivateKey = ecc.privateAdd(privateKey, tapTweakHash(toXOnly(signer.publicKey), opts.tweakHash));
    if (!tweakedPrivateKey) {
        throw new Error('Invalid tweaked private key!');
    }
    return ECPair.fromPrivateKey(Buffer.from(tweakedPrivateKey), {
        network: opts.network,
    });
}

const sendUTXO = async (amount: number, address: string) => {
    let initialFee = 0;
    let redeemFee = 100;
    let psbt;

    const wallet = new SeedWallet({ networkType: networkType, seed: seed });
    const utxos = await getUtxos(wallet.address, networkType);
    console.log(utxos);

    do {
        initialFee = redeemFee;
        const selectedUTXO = await selectUTXO(utxos, amount, initialFee);
        psbt = await createPsbt(selectedUTXO, amount, wallet, address, initialFee);
        psbt = wallet.signPsbt(psbt, wallet.ecPair);
        redeemFee = psbt.extractTransaction().virtualSize() * TESTNET_FEERATE;
    } while (redeemFee != initialFee)

    console.log("redeemfee", redeemFee);
    const txHex = psbt.extractTransaction().toHex();
    console.log("txhex", txHex);
    const txId = await pushBTCpmt(txHex, networkType);
    console.log("txID", txId);
}
interface IUTXO {
    txid: string;
    vout: number;
    status: {
        confirmed: boolean;
        block_height: number;
        block_hash: string;
        block_time: number;
    };
    value: number;
}

