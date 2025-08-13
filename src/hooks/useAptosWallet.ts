import { useWallet } from '@aptos-labs/wallet-adapter-react';

export const useAptosWallet = () => {
  const {
    connect,
    connected,
    disconnect,
    account,
    notDetectedWallets,
    wallets,
    wallet,
    signAndSubmitTransaction,
  } = useWallet();

  const aptosWallet = wallet;
  const aptosAddress = account?.address?.toString();
  console.log("notDetectedWallets", notDetectedWallets);
  console.log("wallet", wallet);
  const isAptosWalletvailable = wallets.length >= 1;
  const isAptosWalletConnected = connected && wallets.length >= 1;

  const connectPetra = async () => {
    const petraWallet = wallets.find(wallet => wallet.name === 'Petra');
    if (isAptosWalletvailable && petraWallet) {
      connect(petraWallet?.name || '');
    } else {
      // Redirect to Petra installation page
      window.open('https://petra.app/', '_blank');
    }
  };

  return {
    // Wallet state
    isAptosWalletvailable,
    isAptosWalletConnected,
    aptosAddress,
    
    connect,
    // Wallet actions
    connectPetra,
    disconnect,
    signAndSubmitTransaction,

    // Wallet instance
    aptosWallet
  };
}; 