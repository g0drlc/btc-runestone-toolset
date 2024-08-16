import axios from "axios";
import * as Bitcoin from "../node_modules/bitcoinjs-lib";
import networkConfig from "../config/network.config"

interface IUtxo {
    txid: string;
    vout: number;
    value: number;
}

const networkType: string = networkConfig.networkType;

export const getUtxos = async (address: string, networkType: string): Promise<IUtxo[]> => {
    const url = `https://mempool.space/${networkType}/api/address/${address}/utxo`;
    const res = await axios.get(url);
    const utxos: IUtxo[] = [];

    res.data.forEach((utxoData: any) => {
        utxos.push({
            txid: utxoData.txid,
            vout: utxoData.vout,
            value: utxoData.value,
        })
    });

    return utxos;
};

export const selectUTXO = async (utxos: IUtxo[], targetAmount: number, initialFee: number): Promise<IUtxo[]> => {
    const selectUTXO: IUtxo[] = [];
    let sum = targetAmount + initialFee;

    utxos.sort((a, b) => a.value - b.value);
    const utxo = utxos.find((utxo) => utxo.value >= sum);
    if (utxo != undefined) {
        selectUTXO[0] = utxo;
        return selectUTXO;
    }

    for (let i = utxos.length; i > 0; i--) {
        sum = sum - utxos[i - 1].value;
        selectUTXO[utxos.length - i] = utxos[i];
        if (sum <= 0) break;
    }

    if (sum >= 0) throw new Error("No btcs");
    return selectUTXO;
}

export const createPsbt = async (selectedUtxo: IUtxo[], amount: number, wallet: any, receivedAddress: any, fee: number): Promise<Bitcoin.Psbt> => {
    let value = 0;

    const psbt = new Bitcoin.Psbt({
        network: networkType == "testnet" ? Bitcoin.networks.testnet : Bitcoin.networks.bitcoin
    })

    for (let i = 0; i < selectedUtxo.length; i++) {
        psbt.addInput({
            hash: selectedUtxo[i].txid,
            index: selectedUtxo[i].vout,
            witnessUtxo: {
                value: selectedUtxo[i].value,
                script: wallet.output,
            },
            tapInternalKey: Buffer.from(wallet.publicKey, "hex").subarray(1, 33),
        })
        value += selectedUtxo[i].value;
    }

    psbt.addOutput({
        address: wallet.address,
        value: value - amount - fee,
    })

    psbt.addOutput({
        address: receivedAddress,
        value: amount,
    })

    return psbt;
}

export const createSplitPsbt = async (selectedUtxo: IUtxo[], amount: number, wallet: any, receivedAddress: any, splitNum: number, fee: number): Promise<Bitcoin.Psbt> => {
    let value = 0;

    const psbt = new Bitcoin.Psbt({
        network: networkType == "testnet" ? Bitcoin.networks.testnet : Bitcoin.networks.bitcoin
    })

    for (let i = 0; i < selectedUtxo.length; i++) {
        psbt.addInput({
            hash: selectedUtxo[i].txid,
            index: selectedUtxo[i].vout,
            witnessUtxo: {
                value: selectedUtxo[i].value,
                script: wallet.output,
            },
            tapInternalKey: Buffer.from(wallet.publicKey, "hex").subarray(1, 33),
        })
        value += selectedUtxo[i].value;
    }

    for (let i = 0; i < splitNum; i++) {
        psbt.addOutput({
            address: receivedAddress,
            value: amount / splitNum,
        })
    }

    psbt.addOutput({
        address: receivedAddress,
        value: value - amount - fee,
    })

    return psbt;
}