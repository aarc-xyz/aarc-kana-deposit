import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useDisconnect } from 'wagmi';
import { USDT_ON_APTOS_ADDRESS, USDT_ON_POLYGON_ADDRESS } from '../constants';
import { Navbar } from './Navbar';
import StyledConnectButton from './StyledConnectButton';
import { SwapAggregator, Environment, NetworkId } from '@kanalabs/aggregator';
import type { ConnectionProviders } from '@kanalabs/aggregator';
import { useAptosWallet } from '../hooks/useAptosWallet';
import { useEthWallet } from '../hooks/useEthWallet';
import { aptosProvider } from '../config/walletAdapterConfig';
import { AarcFundKitModal, TransactionSuccessData } from '@aarc-dev/fundkit-web-sdk';

// Persisted session for resuming cross-chain deposit
// Infer quote type from aggregator method signature to avoid deep imports
type QuoteType = Awaited<ReturnType<SwapAggregator['crossChainQuote']>>['data'][number];

type KanaDepositStep = 'awaiting_claim' | 'completed';

interface KanaDepositSession {
  step: KanaDepositStep;
  amount: string; // decimal string
  sourceChain: 'polygon';
  targetChain: 'aptos';
  sourceAddress: string; // EVM
  targetAddress: string; // Aptos
  txHash: string; // transfer tx hash on source chain
  quote: QuoteType; // quote payload from Kana
  updatedAt: number; // epoch ms
}

const KANA_DEPOSIT_STORAGE_KEY = 'kanaDepositSession';

const loadKanaSession = (): KanaDepositSession | null => {
  try {
    const raw = localStorage.getItem(KANA_DEPOSIT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as KanaDepositSession;
  } catch {
    return null;
  }
};

const saveKanaSession = (session: KanaDepositSession) => {
  try {
    localStorage.setItem(
      KANA_DEPOSIT_STORAGE_KEY,
      JSON.stringify({ ...session, updatedAt: Date.now() })
    );
  } catch {
    // ignore storage errors
  }
};

const clearKanaSession = () => {
  try {
    localStorage.removeItem(KANA_DEPOSIT_STORAGE_KEY);
  } catch {
    // ignore
  }
};

export const KanaDepositModal = ({ aarcModal }: { aarcModal: AarcFundKitModal }) => {
    const [amount, setAmount] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [showProcessingModal, setShowProcessingModal] = useState(false);
    
    // Use wagmi disconnect hook directly
    const { disconnect: disconnectEVM } = useDisconnect();
    
    // Use the new wallet hooks
    const {
        address,
        isConnected,
        isOnPolygon,
        walletClient,
        getProvider,
        getSigner,
        switchToPolygon
    } = useEthWallet();

    const {
        isAptosWalletvailable,
        isAptosWalletConnected,
        aptosAddress,
        aptosWallet,
        connectPetra,
        disconnect: disconnectAptos,
        signAndSubmitTransaction
    } = useAptosWallet();

    // Message event listener for Aarc iframe communication
    useEffect(() => {
        const handleReceiveMessage = async (event: MessageEvent) => {
            // // Handle messages from Aarc iframe
            // if (event?.data?.type === "depositAmountUSD") {
            //     console.log("Received message from Aarc:", event.data);
            //     const depositAmount = event.data.data;
            //     if (depositAmount) {
            //         setAmount(depositAmount.toString());
            //     }
            // }

            if (event?.data?.type === "requestStatus") {
                const statusObj = event.data.data;
                console.log("Received status object from Aarc:", statusObj);
                if (statusObj) {
                    setAmount(statusObj.destinationTokenAmount);
                }
            }
        };

        // Add event listener
        window.addEventListener("message", handleReceiveMessage);

        // Cleanup on unmount
        return () => {
            window.removeEventListener("message", handleReceiveMessage);
        };
    }, []);

    // If a session exists and both wallets are connected, surface a subtle resume indicator
    useEffect(() => {
      const session = loadKanaSession();
      if (!session) return;
      if (!isConnected || !isAptosWalletConnected) return;
      // Auto-fill amount so user can just continue
      if (session.amount) setAmount(session.amount);
    }, [isConnected, isAptosWalletConnected]);

    // Helper to perform the cross-chain swap using Kana
    const transferToKana = useCallback(async () => {
        if (!isConnected || !isAptosWalletConnected || !aptosWallet) return;
        
        try {
            setIsProcessing(true);
            setShowProcessingModal(true);

            // Ensure on Polygon
            if (!isOnPolygon) {
                await switchToPolygon();
            }
            
            // Get provider and signer
            const provider = getProvider();
            if (!provider) throw new Error('Failed to get provider');
            
            const signer = await getSigner();
            if (!signer) throw new Error('Failed to get signer');

            const targetKanaAddress = aptosWallet?.accounts[0]?.address?.toString() || '';
            const sourceEvmAddress = address || '';

            // Construct aggregator; cast aptos provider against ConnectionProviders type shape
            const crossChainAggregator = new SwapAggregator(Environment.production, {
                providers: {
                    polygon: provider,
                    aptos: aptosProvider as unknown as NonNullable<ConnectionProviders['aptos']>,
                },
                signers: {
                    polygon: walletClient,
                    aptos: signAndSubmitTransaction,
                }
            });

            // 1) If we have a pending session after transfer, resume claim directly
            const existing = loadKanaSession();
            if (
              existing &&
              existing.step === 'awaiting_claim' &&
              existing.sourceAddress?.toLowerCase() === sourceEvmAddress.toLowerCase() &&
              existing.targetAddress === targetKanaAddress
            ) {
              // Resume claim
              const claim = await crossChainAggregator.executeClaim({
                apiKey: import.meta.env.VITE_KANA_API_KEY,
                txHash: existing.txHash,
                sourceProvider: provider,
                targetProvider: aptosProvider,
                targetSigner: signAndSubmitTransaction,
                quote: existing.quote,
                sourceAddress: sourceEvmAddress,
                targetAddress: targetKanaAddress,
              });

              // Claim done, mark completed then clear
              const completedSession: KanaDepositSession = { ...existing, step: 'completed', updatedAt: Date.now() };
              saveKanaSession(completedSession);
              clearKanaSession();

              console.log('Tokens claimed successfully!');
              console.log('Transaction hash:', claim);

              setShowProcessingModal(false);
              setAmount('');
              setIsProcessing(false);
              return;
            }

            // 2) Fresh flow: fetch quotes → transfer → save session → claim
            const quotes = await crossChainAggregator.crossChainQuote({
                apiKey: import.meta.env.VITE_KANA_API_KEY,
                sourceToken: USDT_ON_POLYGON_ADDRESS,
                targetToken: USDT_ON_APTOS_ADDRESS,
                sourceChain: NetworkId.polygon,
                targetChain: NetworkId.aptos,
                amountIn: ethers.parseUnits(amount, 6).toString(), // USDT has 6 decimals
                sourceSlippage: 2,
                targetSlippage: 2,
            });
            
            console.log("Quotes response:", quotes);
            console.log("Quotes data:", quotes.data);
            
            if (!quotes.data || quotes.data.length === 0) {
                throw new Error("No quotes available for this transfer. Please try a different amount or check your connection.");
            }
            
            const optimalQuote = quotes.data[0];
            console.log("Optimal quote:", optimalQuote);

            const transfer = await crossChainAggregator.executeTransfer({
                apiKey: import.meta.env.VITE_KANA_API_KEY,
                quote: optimalQuote,
                sourceAddress: sourceEvmAddress,
                targetAddress: targetKanaAddress,
                sourceProvider: provider,
                sourceSigner: signer,
            });
            // this triggers transfer on polygon

            console.log("Transfer transaction hash:", transfer.txHash);

            // Persist session after transfer sign/send so we can resume claim later
            const sessionToSave: KanaDepositSession = {
              step: 'awaiting_claim',
              amount,
              sourceChain: 'polygon',
              targetChain: 'aptos',
              sourceAddress: sourceEvmAddress,
              targetAddress: targetKanaAddress,
              txHash: transfer.txHash,
              quote: optimalQuote,
              updatedAt: Date.now(),
            };
            saveKanaSession(sessionToSave);

            const claim = await crossChainAggregator.executeClaim({
                apiKey: import.meta.env.VITE_KANA_API_KEY,
                txHash: transfer.txHash,
                sourceProvider: provider,
                targetProvider: aptosProvider,
                targetSigner: signAndSubmitTransaction,
                quote: optimalQuote,
                sourceAddress: sourceEvmAddress,
                targetAddress: targetKanaAddress,
              })

              // after this user will end up with USDT on aptos

              console.log("Tokens claimed successfully!")
              console.log("Transaction hash:", claim)

              // Mark completed then clear persisted session
              const completed: KanaDepositSession = {
                step: 'completed',
                amount,
                sourceChain: 'polygon',
                targetChain: 'aptos',
                sourceAddress: sourceEvmAddress,
                targetAddress: targetKanaAddress,
                txHash: transfer.txHash,
                quote: optimalQuote,
                updatedAt: Date.now(),
              };
              saveKanaSession(completed);
              clearKanaSession();
              
            setShowProcessingModal(false);
            setAmount('');
            setIsProcessing(false);
        } catch (error) {
            console.error(error);
            setShowProcessingModal(false);
            setIsProcessing(false);
        }
    }, [aarcModal, isConnected, isAptosWalletConnected, aptosAddress, address, isOnPolygon, switchToPolygon, getProvider, getSigner, walletClient, signAndSubmitTransaction, aptosWallet]);

    const handleAarcModal = () => {
        if(!aarcModal || !isConnected || !isAptosWalletConnected || !aptosAddress || !address) return;
        try {
            setIsProcessing(true);
            aarcModal.updateDestinationWalletAddress(address)
            aarcModal.updateEvents({
                onTransactionSuccess: (data: TransactionSuccessData) => {
                    console.log("Transaction success data:", data.data.txHash);
                    aarcModal.close();
                    setShowProcessingModal(true);
                    transferToKana();
                }
            });
            aarcModal.openModal()
        } catch (error) {
            console.error(error);
        } finally {
            setIsProcessing(false);
        }
    }

    const shouldDisableInteraction = !isConnected;
    const isKanaAddressValid = aptosAddress && aptosAddress.length > 0;

    return (
        <div className="min-h-screen bg-aarc-bg grid-background">
            <Navbar />
            <main className="mt-24 gradient-border flex items-center justify-center mx-auto max-w-md shadow-[4px_8px_8px_4px_rgba(0,0,0,0.1)]">
                <div className="flex flex-col items-center w-[440px] bg-[#2D2D2D] rounded-[24px] p-8 pb-[22px] gap-3">
                    {showProcessingModal ? (
                        // Processing Modal
                        <div className="flex flex-col items-center gap-4">
                            <img src="/kana-name-logo.svg" alt="Kana" className="w-32 h-16" />
                            <h3 className="text-[18px] font-semibold text-[#F6F6F6]">
                                {!isOnPolygon 
                                    ? "Switching to Polygon Network..."
                                    : "Transferring to "}
                                {isOnPolygon && (
                                    <a href="https://www.kana.trade/?market=BTC-PERP" target="_blank" rel="noopener noreferrer" className="underline text-[#A5E547]">Kana Labs</a>
                                )}
                            </h3>
                            <p className="text-[14px] text-[#C3C3C3] text-center">
                                {!isOnPolygon
                                    ? "Please approve the network switch in your wallet."
                                    : "Please confirm the transaction in your wallet to complete the deposit."}
                            </p>
                        </div>
                    ) : (
                        // Main Deposit Modal
                        <>
                            <div className="w-full relative">
                                {!isConnected && <StyledConnectButton />}
                            </div>

                            {/* Wallet Connections - Side by Side */}
                            {isConnected && (
                                <div className="w-full flex gap-3">
                                    {/* EVM Wallet Connection */}
                                    <div className="flex-1 p-3 bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.2)] rounded-2xl">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                                <span className="text-[12px] text-green-400 font-medium">EVM</span>
                                            </div>
                                            <button
                                                onClick={() => disconnectEVM()}
                                                className="text-[10px] text-red-400 hover:text-red-300 underline"
                                            >
                                                Disconnect
                                            </button>
                                        </div>
                                        {address && (
                                            <p className="text-[10px] text-green-400 font-mono mt-1">
                                                {address.slice(0, 6)}...{address.slice(-4)}
                                            </p>
                                        )}
                                    </div>

                                    {/* Petra Wallet Connection */}
                                    {isAptosWalletConnected ? (
                                        <div className="flex-1 p-3 bg-[rgba(139,92,246,0.1)] border border-[rgba(139,92,246,0.2)] rounded-2xl">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                                                    <span className="text-[12px] text-purple-400 font-medium">Petra</span>
                                                </div>
                                                <button
                                                    onClick={disconnectAptos}
                                                    className="text-[10px] text-red-400 hover:text-red-300 underline"
                                                >
                                                    Disconnect
                                                </button>
                                            </div>
                                            {aptosAddress && (
                                                <p className="text-[10px] text-purple-400 font-mono mt-1">
                                                    {aptosAddress.slice(0, 6)}...{aptosAddress.slice(-4)}
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="flex-1">
                                            <button
                                                onClick={connectPetra}
                                                disabled={isProcessing || !isAptosWalletvailable}
                                                className="w-full h-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-aarc-primary border border-[#0033000D] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <div className="flex items-center justify-center gap-2 w-full">
                                                    <span className="text-aarc-button-text font-semibold whitespace-nowrap">
                                                        {isAptosWalletvailable ? 'Connect Petra' : 'Install Petra'}
                                                    </span>
                                                   <img src="/petra.ico" alt="Petra" className="w-4 h-4" />
                                                </div>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="w-full">
                                <a href="https://www.kana.trade/?market=BTC-PERP" target="_blank" rel="noopener noreferrer" className="block">
                                    <h3 className="text-[14px] font-semibold text-[#F6F6F6] mb-4">Deposit in <span className="underline text-[#A5E547]">Kana</span></h3>
                                </a>
                            </div>

                            {/* Warning Message */}
                            <div className="w-full flex gap-x-2 items-start p-4 bg-[rgba(255,183,77,0.05)] border border-[rgba(255,183,77,0.2)] rounded-2xl">
                                <img src="/info-icon.svg" alt="Info" className="w-4 h-4 mt-[2px]" />
                                <p className="text-xs font-bold text-[#F6F6F6] leading-5">
                                    The funds will be deposited in Kana.
                                </p>
                            </div>

                            {/* Continue Button */}
                            <button
                                onClick={handleAarcModal}
                                    disabled={isProcessing || shouldDisableInteraction || !isKanaAddressValid || !isAptosWalletConnected}
                                className="w-full h-11 mt-2 bg-[#A5E547] hover:opacity-90 text-[#003300] font-semibold rounded-2xl border border-[rgba(0,51,0,0.05)] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isProcessing ? 'Processing...' : 'Continue'}
                            </button>

                            {/* Powered by Footer */}
                            <div className="flex flex-col items-center gap-3 mt-2">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-semibold text-[#F6F6F6]">Powered by</span>
                                    <img src="/aarc-logo-small.svg" alt="Aarc" />
                                </div>
                                <p className="text-xs text-[#C3C3C3]">
                                    By using this service, you agree to Aarc <span className="underline cursor-pointer">terms</span>
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </main>
        </div>
    );
};

export default KanaDepositModal;