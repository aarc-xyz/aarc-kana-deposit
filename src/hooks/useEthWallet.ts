import { useAccount, useWalletClient, useChainId, useSwitchChain } from 'wagmi';
import { ethers } from 'ethers';
import { SupportedChainId } from '../constants';

export const useEthWallet = () => {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const getProvider = () => {
    if (!walletClient) return null;
    return new ethers.BrowserProvider(walletClient);
  };

  const getSigner = async () => {
    const provider = getProvider();
    if (!provider) return null;
    return await provider.getSigner();
  };

  const switchToPolygon = async () => {
    if (chainId !== SupportedChainId.POLYGON) {
      await switchChain({ chainId: SupportedChainId.POLYGON });
      // Wait for chain switch to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  };

  const isConnected = !!address;
  const isOnPolygon = chainId === SupportedChainId.POLYGON;

  return {
    // Wallet state
    address,
    chainId,
    isConnected,
    isOnPolygon,
    
    // Wallet client and provider
    walletClient,
    getProvider,
    getSigner,
    
    // Chain operations
    switchToPolygon,
    switchChain,
    
    // Supported chain ID
    SupportedChainId
  };
}; 