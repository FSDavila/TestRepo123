/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 * 
 * BRy Tecnologia - 2023 - FSD
 * Projeto Hyperledger Fabric - https://git.bry.com.br/ict/blockchain/hyperledger-fabric
 * 
 * Client NodeJS de acesso ao peer para execução de transações no ambiente Hyperledger
 * 
 */

import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Identity, Signer, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';



//ICTSCT-457 - Client NodeJS que pode executar qualquer função do contrato, podendo passar argumentos na linha de comando.
//Execução no terminal: ts-node fabric-client-cli <channel> <contractName> <functionToRun> <argFunction1> <argFunction2..5>
const channelArg = process.argv[0];
const contractArg = process.argv[1];
const functionToRun = process.argv[2];
const argFunction1 = process.argv[3];
const argFunction2 = process.argv[4];
const argFunction3 = process.argv[5];
const argFunction4 = process.argv[6];
const argFunction5 = process.argv[7];

const channelName = envOrDefault('CHANNEL_NAME', channelArg);
const chaincodeName = envOrDefault('CHAINCODE_NAME', contractArg);
const mspId = envOrDefault('MSP_ID', 'Org1MSP');

// Path to crypto materials.
const cryptoPath = envOrDefault('CRYPTO_PATH', path.resolve(__dirname, '..', '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com'));

// Path to user private key directory.
const keyDirectoryPath = envOrDefault('KEY_DIRECTORY_PATH', path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore'));

// Path to user certificate.
const certPath = envOrDefault('CERT_PATH', path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts', 'cert.pem'));

// Path to peer tls certificate.
const tlsCertPath = envOrDefault('TLS_CERT_PATH', path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt'));

// Gateway peer endpoint.
const peerEndpoint = envOrDefault('PEER_ENDPOINT', 'localhost:7051');

// Gateway peer SSL host name override.
const peerHostAlias = envOrDefault('PEER_HOST_ALIAS', 'peer0.org1.example.com');

const utf8Decoder = new TextDecoder();
const assetId = `asset${Date.now()}`;

async function main(): Promise<void> {

    await displayInputParameters();

    // The gRPC client connection should be shared by all Gateway connections to this endpoint.
    const client = await newGrpcConnection();

    const gateway = connect({
        client,
        identity: await newIdentity(),
        signer: await newSigner(),
        // Default timeouts for different gRPC calls
        //ICTSCT-457 - TODO Permitir timeouts customizados via .env
        evaluateOptions: () => {
            return { deadline: Date.now() + 15000 }; // 5 seconds
        },
        endorseOptions: () => {
            return { deadline: Date.now() + 30000 }; // 15 seconds
        },
        submitOptions: () => {
            return { deadline: Date.now() + 15000 }; // 5 seconds
        },
        commitStatusOptions: () => {
            return { deadline: Date.now() + 60000 }; // 1 minute
        },
    });

    try {
        // Get a network instance representing the channel where the smart contract is deployed.
        const network = gateway.getNetwork(channelName);

        // Get the smart contract from the network.
        const contract = network.getContract(chaincodeName);

        // Pegamos o contrato do Query system chaincode (QSCC) onde ficam guardados todos os dados de transação/IDs
        const contractQscc = network.getContract("qscc");

        //ICTSCT-457 - Escolha de qual função de do contrato iremos executar de acordo com o comando
        switch (functionToRun) {
            case 'initLedger':
                checkArgs(functionToRun, argFunction1, argFunction2, argFunction3, argFunction4, argFunction5);
                await initLedger(contract);
                break;
            case 'getAllAssets':
                await getAllAssets(contract);
                break;
            case 'createAsset':
                checkArgs(functionToRun, argFunction1, argFunction2, argFunction3, argFunction4, argFunction5);
                await createAsset(contract, argFunction1, argFunction2, argFunction3, argFunction4, argFunction5);
                break;
            case 'readAssetByID':
                checkArgs(functionToRun, argFunction1, argFunction2, argFunction3, argFunction4, argFunction5);
                await readAssetByID(contract, argFunction1);
                break;
            case 'updateNonExistentAsset':
                await updateNonExistentAsset(contract);
                break;
            case 'readAssetBySctSerial':
                checkArgs(functionToRun, argFunction1, argFunction2, argFunction3, argFunction4, argFunction5);
                await readAssetBySctSerial(contract, argFunction1);
                break;
            case 'getTransactionByTransactionId':
                checkArgs(functionToRun, argFunction1, argFunction2, argFunction3, argFunction4, argFunction5);
                await getTransactionByTransactionId(contract, argFunction1);
                break;
            default:
                console.error(`Function not recognized: ${functionToRun}`);
                break;
        }
    } finally {
        gateway.close();
        client.close();
    }
}

function checkArgs(func: string, arg1: string, arg2: string, arg3: string, arg4: string, arg5: string): void {
    if (functionToRun === 'createAsset' || functionToRun === 'readAssetByID' || functionToRun === 'readAssetBySctSerial' || 'getTransactionByTransactionId') {
        if (argFunction1 === '' || !argFunction1) {
            console.error('******** FAILED to run the application:', "Argument 1 for function " + functionToRun + " must be specified and valid.");
        } else if (functionToRun === 'createAsset' && argFunction1 === '' || !argFunction1 || argFunction2 === '' || !argFunction2 || argFunction3 === '' 
        || !argFunction3 || argFunction4 === '' || !argFunction4 || argFunction5 === '' || !argFunction5) {
            console.error('******** FAILED to run the application:', "Arguments 2~5 for function createAsset must be specified and valid.");
        }
    }
}

main().catch(error => {
    console.error('******** FAILED to run the application:', error);
    process.exitCode = 1;
});

async function newGrpcConnection(): Promise<grpc.Client> {
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
}

async function newIdentity(): Promise<Identity> {
    const credentials = await fs.readFile(certPath);
    return { mspId, credentials };
}

async function newSigner(): Promise<Signer> {
    const files = await fs.readdir(keyDirectoryPath);
    const keyPath = path.resolve(keyDirectoryPath, files[0]);
    const privateKeyPem = await fs.readFile(keyPath);
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    return signers.newPrivateKeySigner(privateKey);
}

/**
 * This type of transaction would typically only be run once by an application the first time it was started after its
 * initial deployment. A new version of the chaincode deployed later would likely not need to run an "init" function.
 */
async function initLedger(contract: Contract): Promise<void> {
    console.info('\n--> Submit Transaction: InitLedger, function creates the initial set of assets on the ledger');

    var result = await contract.submitTransaction('InitLedger');

    // ICTSCT-457 - Retornando o TXID nos logs para permitir a consulta de transação por TXID com a função getTransactionByTransactionId
    const response = JSON.parse(result.toString());
    const transactionId = response.transactionId;
    console.info(`Transaction ID: ${transactionId}`);

    console.info('*** Transaction committed successfully');
}

/**
 * Evaluate a transaction to query ledger state.
 */
async function getAllAssets(contract: Contract): Promise<void> {
    console.info('\n--> Evaluate Transaction: GetAllAssets, function returns all the current assets on the ledger');

    const resultBytes = await contract.evaluateTransaction('GetAllAssets');

    const resultJson = utf8Decoder.decode(resultBytes);
    const result = JSON.parse(resultJson);
    console.info('*** Result:', result);
}

/**
 * Submit a transaction synchronously, blocking until it has been committed to the ledger.
 */
//ICTSCT-457 - Modificação desta função para o novo padrão do contrato SCT
async function createAsset(contract: Contract, assetId: string, sctSerial: string, sasCommonName: string, merkleRoot: string, currentHash: string): Promise<void> {
    console.info('\n--> Submit Transaction: CreateAsset, creates new asset with ID, Color, Size, Owner and AppraisedValue arguments');

    var result = await contract.submitTransaction(
        'CreateAsset',
        assetId,
        sctSerial,
        sasCommonName,
        merkleRoot,
        currentHash,
    );

    // ICTSCT-457 - Retornando o TXID nos logs para permitir a consulta de transação por TXID com a função getTransactionByTransactionId
    const response = JSON.parse(result.toString());
    const transactionId = response.transactionId;
    console.info(`Transaction ID: ${transactionId}`);

    console.info('*** Transaction committed successfully');
}

async function readAssetByID(contract: Contract, assetId: string): Promise<void> {
    console.info('\n--> Evaluate Transaction: ReadAsset, function returns asset attributes');

    const resultBytes = await contract.evaluateTransaction('ReadAsset', assetId);

    const resultJson = utf8Decoder.decode(resultBytes);
    const result = JSON.parse(resultJson);
    console.info('*** Result:', result);
}

/**
 * submitTransaction() will throw an error containing details of any error responses from the smart contract.
 */
//ICTSCT-457 - Essa função é apenas um teste unitário de erro para quando tentamos enviar uma tx que manda alterar asset inexistente
async function updateNonExistentAsset(contract: Contract): Promise<void> {
    console.info('\n--> Submit Transaction: UpdateAsset -999, -999 does not exist and should return an error');

    try {
        await contract.submitTransaction(
            '-999',
            '1',
            '1',
            '1',
            '1',
            '1',
        );
        console.warn('******** FAILED to return an error');
    } catch (error) {
        console.error('*** Successfully caught the error: \n', error);
    }
}


//ICTSCT-457 - Função que pega asset pelo SCT Serial
async function readAssetBySctSerial(contract: Contract, assetSctSerial: string): Promise<void> {
    console.info('\n--> Evaluate Transaction: readAssetBySctSerial, function returns asset attributes, queried by SCT Serial');

    const resultBytes = await contract.evaluateTransaction('ReadAssetBySctSerial', assetSctSerial);

    const resultJson = utf8Decoder.decode(resultBytes);
    const result = JSON.parse(resultJson);
    console.info('*** Result:', result);
}

async function getTransactionByTransactionId(contract: Contract, txId: string): Promise<void> {
    console.info('\n--> Submit Query: getTransactionByTransactionId, get transaction associated with txId ' + txId);
    try {
        const resultBytes = await contract.evaluateTransaction("GetTransactionByID", channelName, txId)
        const resultJson = utf8Decoder.decode(resultBytes);
        const result = JSON.parse(resultJson);
        console.info('*** Result:', result);
    } catch (error) {
        console.error('*** Successfully caught the error: \n', error);
    }

}

/**
 * envOrDefault() will return the value of an environment variable, or a default value if the variable is undefined.
 */
function envOrDefault(key: string, defaultValue: string): string {
    return process.env[key] || defaultValue;
}

/**
 * displayInputParameters() will print the global scope parameters used by the main driver routine.
 */
async function displayInputParameters(): Promise<void> {
    console.info(`channelName:       ${channelName}`);
    console.info(`chaincodeName:     ${chaincodeName}`);
    console.info(`mspId:             ${mspId}`);
    console.info(`cryptoPath:        ${cryptoPath}`);
    console.info(`keyDirectoryPath:  ${keyDirectoryPath}`);
    console.info(`certPath:          ${certPath}`);
    console.info(`tlsCertPath:       ${tlsCertPath}`);
    console.info(`peerEndpoint:      ${peerEndpoint}`);
    console.info(`peerHostAlias:     ${peerHostAlias}`);
}