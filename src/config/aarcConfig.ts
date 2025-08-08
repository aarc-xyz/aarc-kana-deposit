import {
  FKConfig,
  ThemeName,
  TransactionSuccessData,
  TransactionErrorData,
  SourceConnectorName,
} from "@aarc-dev/fundkit-web-sdk";
import { SupportedChainId, USDT_ON_ARBITRUM_ADDRESS } from "../constants";

export const aarcConfig: FKConfig = {
  appName: "Kana Labs x Aarc",
  userId: "0x",
  dappId: "Kanademo",
  module: {
    exchange: {
      enabled: true,
    },
    onRamp: {
      enabled: true,
      onRampConfig: {},
    },
    bridgeAndSwap: {
      enabled: true,
      fetchOnlyDestinationBalance: false,
      routeType: "Value",
      connectors: [SourceConnectorName.ETHEREUM],
    },
  },
  destination: {
    chainId: SupportedChainId.ARBITRUM, // Arbitrum chain ID
    tokenAddress: USDT_ON_ARBITRUM_ADDRESS, // USDC on Arbitrum
  },
  appearance: {
    roundness: 42,
    theme: ThemeName.DARK,
  },
  apiKeys: {
    aarcSDK: import.meta.env.VITE_AARC_API_KEY,
  },
  events: {
    onTransactionSuccess: (data: TransactionSuccessData) => {
      console.log("Transaction successful:", data);
    },
    onTransactionError: (data: TransactionErrorData) => {
      console.error("Transaction failed:", data);
    },
    onWidgetClose: () => {
      console.log("Widget closed");
    },
    onWidgetOpen: () => {
      console.log("Widget opened");
    },
  },
  origin: window.location.origin,

}; 