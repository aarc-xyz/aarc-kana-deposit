import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@rainbow-me/rainbowkit/styles.css';
import './index.css';
import { wagmiConfig } from '@aarc-xyz/eth-connector';
import DepositModal from './components/KanaDepositModal';
import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react';
import { walletAdapterConfig } from './config/walletAdapterConfig';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <AptosWalletAdapterProvider {...walletAdapterConfig}>
          <DepositModal />
        </AptosWalletAdapterProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}

export default App;
