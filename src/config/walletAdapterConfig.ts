import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

export const aptosConfig = new AptosConfig({ network: Network.MAINNET });
export const aptosProvider = new Aptos(aptosConfig);

export const walletAdapterConfig = {
  autoConnect: true,
};
