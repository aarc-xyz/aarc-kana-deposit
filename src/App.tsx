import { WagmiProvider } from "wagmi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import "@rainbow-me/rainbowkit/styles.css"
import "./index.css"
import { AarcEthWalletConnector, wagmiConfig } from "@aarc-xyz/eth-connector"
import DepositModal from "./components/KanaDepositModal"
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react"
import { walletAdapterConfig } from "./config/walletAdapterConfig"
import { aarcConfig } from "./config/aarcConfig"
import { useRef } from "react"
import { AarcFundKitModal } from "@aarc-dev/fundkit-web-sdk"

const queryClient = new QueryClient()

function App() {
    const aarcModalRef = useRef(new AarcFundKitModal(aarcConfig))

    const aarcModal = aarcModalRef.current

    return (
        <QueryClientProvider client={queryClient}>
            <WagmiProvider config={wagmiConfig}>
                <AarcEthWalletConnector
                    aarcWebClient={aarcModal}
                    debugLog={true}
                    externalRainbowKit={true}
                />
                <AptosWalletAdapterProvider {...walletAdapterConfig}>
                    <DepositModal aarcModal={aarcModal} />
                </AptosWalletAdapterProvider>
            </WagmiProvider>
        </QueryClientProvider>
    )
}

export default App
