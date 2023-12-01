import * as dotenv from "dotenv";

import {
  UserOperation,
  bundlerActions,
  getAccountNonce,
  signUserOperationHashWithECDSA,
} from "permissionless";
import {
  pimlicoBundlerActions,
  pimlicoPaymasterActions,
} from "permissionless/actions/pimlico";
import {
  createClient,
  createPublicClient,
  encodeFunctionData,
  http,
  Hex,
  getAddress,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { goerli } from "viem/chains";

dotenv.config({ override: true });

console.log("Hello world!");
const chainName = "parallel-l3-testnet";
const chain = defineChain({
  id: 3163830386846714,
  network: chainName,
  name: chainName,
  nativeCurrency: { name: `${chainName} Ether`, symbol: "ETH", decimals: 18 },
  rpcUrls: {
    public: {
      http: ["https://nitrorpc-compact-lime-moose-5r7g6fkl78.t.conduit.xyz"],
      webSocket: ["wss://nitrows-compact-lime-moose-5r7g6fkl78.t.conduit.xyz"],
    },
    default: {
      http: ["https://nitrorpc-compact-lime-moose-5r7g6fkl78.t.conduit.xyz"],
      webSocket: ["wss://nitrows-compact-lime-moose-5r7g6fkl78.t.conduit.xyz"],
    },
  },
  blockExplorers: {
    etherscan: {
      name: "Etherscan",
      url: "https://goerli.etherscan.io",
    },
    default: {
      name: "Etherscan",
      url: "https://goerli.etherscan.io",
    },
  },
  contracts: {
    ensRegistry: {
      address: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
    },
    ensUniversalResolver: {
      address: "0x56522D00C410a43BFfDF00a9A569489297385790",
      blockCreated: 8765204,
    },
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 6507670,
    },
  },
  testnet: true,
});
const aa = `0x955E79CB7cD74099C6A4BC2E86cCa312C1369BC3`;
const ENTRY_POINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
// CREATE THE CLIENTS
const publicClient = createPublicClient({
  transport: http("https://nitrorpc-compact-lime-moose-5r7g6fkl78.t.conduit.xyz"),
  chain,
});

// const chain = goerli; // find the list of chain names on the Pimlico verifying paymaster reference page
// const chainName = "goerli"; // find the list of chain names on the Pimlico verifying paymaster reference page
// const aa = `0x8F77b64181feC4194711615A839D49E83614b4d6`;
// const ENTRY_POINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
// const publicClient = createPublicClient({
//   transport: http("https://rpc.ankr.com/eth_goerli"),
//   chain,
// });

const apiKey = process.env.PIMLICO_API_KEY; // REPLACE THIS
const privateKey = process.env.PRIVATE_KEY || "";
console.log("privateKey", privateKey);
const owner = privateKeyToAccount(privateKey as Hex);

const sender = getAddress(aa, chain.id);

const bundlerClient = createClient({
  transport: http(
    `https://api.pimlico.io/v1/${chainName}/rpc?apikey=${apiKey}`
  ),
  chain,
})
  .extend(bundlerActions)
  .extend(pimlicoBundlerActions);

const paymasterClient = createClient({
  // ⚠️ using v2 of the API ⚠️
  transport: http(
    `https://api.pimlico.io/v2/${chainName}/rpc?apikey=${apiKey}`
  ),
  chain,
}).extend(pimlicoPaymasterActions);

// GENERATE THE CALLDATA
const to = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik
const value = 0n;
const data = "0x68656c6c6f"; // "hello" encoded to utf-8 bytes

const callData = encodeFunctionData({
  abi: [
    {
      inputs: [
        { name: "dest", type: "address" },
        { name: "value", type: "uint256" },
        { name: "func", type: "bytes" },
      ],
      name: "execute",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
  ],
  args: [to, value, data],
});

console.log("Generated callData:", callData);

// FILL OUT REMAINING USER OPERATION VALUES
const gasPrice = await bundlerClient.getUserOperationGasPrice();

// NOTICE: get nonce from entryPoint contract
const nonce = await getAccountNonce(publicClient, {
  entryPoint: ENTRY_POINT_ADDRESS,
  sender: aa as Hex,
});

console.log(nonce);

const userOperation = {
  sender,
  nonce,
  initCode: "0x" as Hex,
  callData,
  maxFeePerGas: gasPrice.fast.maxFeePerGas,
  maxPriorityFeePerGas: gasPrice.fast.maxPriorityFeePerGas,
  // dummy signature, needs to be there so the SimpleAccount doesn't immediately revert because of invalid signature length
  signature:
    "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c" as Hex,
};

// REQUEST PIMLICO VERIFYING PAYMASTER SPONSORSHIP
const sponsorUserOperationResult = await paymasterClient.sponsorUserOperation({
  userOperation,
  entryPoint: ENTRY_POINT_ADDRESS,
});

const sponsoredUserOperation: UserOperation = {
  ...userOperation,
  preVerificationGas: sponsorUserOperationResult.preVerificationGas,
  verificationGasLimit: sponsorUserOperationResult.verificationGasLimit,
  callGasLimit: sponsorUserOperationResult.callGasLimit,
  paymasterAndData: sponsorUserOperationResult.paymasterAndData,
};

console.log("Received paymaster sponsor result:", sponsorUserOperationResult);

// SIGN THE USER OPERATION
const signature = await signUserOperationHashWithECDSA({
  account: owner,
  userOperation: sponsoredUserOperation,
  chainId: chain.id,
  entryPoint: ENTRY_POINT_ADDRESS,
});
sponsoredUserOperation.signature = signature;

console.log("Generated signature:", signature);

// SUBMIT THE USER OPERATION TO BE BUNDLED
const userOperationHash = await bundlerClient.sendUserOperation({
  userOperation: sponsoredUserOperation,
  entryPoint: ENTRY_POINT_ADDRESS,
});

console.log("Received User Operation hash:", userOperationHash);

// let's also wait for the userOperation to be included, by continually querying for the receipts
console.log("Querying for receipts...");
const receipt = await bundlerClient.waitForUserOperationReceipt({
  hash: userOperationHash,
});
const txHash = receipt.receipt.transactionHash;

console.log(`UserOperation included: https://goerli.etherscan.io/tx/${txHash}`);
