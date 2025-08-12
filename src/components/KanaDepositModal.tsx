import { useState, useEffect } from 'react';
import { useAccount, useDisconnect, useWalletClient } from 'wagmi';
import { useChainId, useSwitchChain } from 'wagmi';
import { ethers } from 'ethers';
import { AarcFundKitModal, TransactionSuccessData } from '@aarc-dev/fundkit-web-sdk';
import {  SupportedChainId, USDT_ON_APTOS_ADDRESS, USDT_ON_POLYGON_ADDRESS } from '../constants';
import { Navbar } from './Navbar';
import StyledConnectButton from './StyledConnectButton';
import { SwapAggregator, Environment, NetworkId } from '@kanalabs/aggregator';
import { AptosConfig, Aptos, Network } from "@aptos-labs/ts-sdk";
import { PetraSigner, getAptosWallet } from '../services/petraSigner';

const aptosConfig = new AptosConfig({ network: Network.MAINNET });
const aptosProvider = new Aptos(aptosConfig);

export const KanaDepositModal = ({ aarcModal }: { aarcModal: AarcFundKitModal }) => {
    const [amount, setAmount] = useState('1');
    const [isProcessing, setIsProcessing] = useState(false);
    const [showProcessingModal, setShowProcessingModal] = useState(false);
    const [isPetraConnected, setIsPetraConnected] = useState(false);
    const [petraAddress, setPetraAddress] = useState('');
    const [petraSigner, setPetraSigner] = useState<PetraSigner | null>(null);
    
    const { disconnect } = useDisconnect();
    const { data: walletClient } = useWalletClient();
    const { address } = useAccount();
    const chainId = useChainId();
    const { switchChain } = useSwitchChain();

    // Check if Petra is installed and connected on component mount
    useEffect(() => {
        const checkPetraConnection = async () => {
            const wallet = getAptosWallet();
            if (wallet) {
                try {
                    const account = await wallet.account();
                    if (account && account.address && account.publicKey) {
                        setIsPetraConnected(true);
                        setPetraAddress(account.address);
                        // Create PetraSigner instance
                        const signer = new PetraSigner(account.address, account.publicKey);
                        setPetraSigner(signer);
                    }
                } catch (error) {
                    console.log("Petra not connected yet");
                }
            }
        };
        
        checkPetraConnection();
    }, []);

    // Connect to Petra wallet
    const connectPetra = async () => {
        const wallet = getAptosWallet();
        if (!wallet) return;

        try {
            const response = await wallet.connect();
            console.log("Petra connected:", response);
            
            const account = await wallet.account();
            console.log("Petra account:", account);
            
            setIsPetraConnected(true);
            setPetraAddress(account.address);
            
            // Create PetraSigner instance
            const signer = new PetraSigner(account.address, account.publicKey);
            setPetraSigner(signer);
            
        } catch (error) {
            console.error("Failed to connect to Petra:", error);
        }
    };

    // Disconnect from Petra wallet
    const disconnectPetra = async () => {
        const wallet = getAptosWallet();
        if (wallet) {
            try {
                await wallet.disconnect();
                setIsPetraConnected(false);
                setPetraAddress('');
                setPetraSigner(null);
            } catch (error) {
                console.error("Failed to disconnect from Petra:", error);
            }
        }
    };

    // Helper to perform the cross-chain swap using Kana
    const transferToKana = async () => {
        if (!walletClient || !address || !isPetraConnected || !petraSigner) return;
        try {
            setIsProcessing(true);
            setShowProcessingModal(true);
            
            // Ensure on Polygin
            if (chainId !== SupportedChainId.POLYGON) {
                await switchChain({ chainId: SupportedChainId.POLYGON });
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // Get provider and signer
            const provider = new ethers.BrowserProvider(walletClient);
            console.log("Provider:", provider);
            const signer = await provider.getSigner();
            const targetKanaAddress = petraAddress;
            
            const crossChainAggregator = new SwapAggregator(Environment.production, {
                providers: {
                    polygon: provider,
                    // @ts-ignore
                    aptos: aptosProvider
                },
                signers: {
                    // @ts-ignore
                    polygon: signer,
                    // @ts-ignore
                    aptos: petraSigner
                }
            });

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
                sourceAddress: address,
                targetAddress: targetKanaAddress,
                sourceProvider: provider,
                sourceSigner: signer,
            });
            // this trigers transfer on polygon

            console.log("Transfer transaction hash:", transfer.txHash);

            const claim = await crossChainAggregator.executeClaim({
                apiKey: import.meta.env.VITE_KANA_API_KEY,
                txHash: transfer.txHash,
                sourceProvider: provider,
                targetProvider: aptosProvider,
                // @ts-ignore
                targetSigner: petraSigner,
                quote: optimalQuote,
                sourceAddress: address,
                targetAddress: targetKanaAddress,
              })

              // after this suer will endup with USDT on aptos

              console.log("Tokens claimed successfully!")
              console.log("Transaction hash:", claim)

              // now we need to send USDT on aptos to kana perps on aptos (0x7a38039fffd016adcac2c53795ee49325e5ec6fddf3bf02651c09f9a583655a6)
              
            setShowProcessingModal(false);
            setAmount('');
            setIsProcessing(false);
        } catch (error) {
            console.error(error);
            setShowProcessingModal(false);
            setIsProcessing(false);
        }
    };

    const handleDeposit = async () => {
        if (!address || !walletClient || !petraAddress) return;

        try {
            setIsProcessing(true);

            // Step 1: Use AArc to convert assets to USDT (if needed)
            aarcModal.updateRequestedAmount(Number(amount));
            aarcModal.updateDestinationWalletAddress(address as `0x${string}`);

            aarcModal.updateEvents({
                onTransactionSuccess: (data: TransactionSuccessData) => {
                    console.log("Transaction success data:", data.data.txHash);
                    aarcModal.close();
                    setShowProcessingModal(true);
                    transferToKana();
                }
            });

            // Open the Aarc modal
            aarcModal.openModal();
            setAmount('');
            setIsProcessing(false);
        } catch (error) {
            console.error('Error preparing deposit:', error);
            setIsProcessing(false);
            aarcModal.close();
        }
    };

    const handleDisconnect = () => {
        // Reset all state values
        setAmount('20');
        setIsProcessing(false);
        setShowProcessingModal(false);

        // Disconnect wallet
        disconnect();
    };


    const shouldDisableInteraction = !address;
    const isKanaAddressValid = petraAddress.length > 0;

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
                                {chainId !== SupportedChainId.POLYGON 
                                    ? "Switching to Polygin Network..."
                                    : "Transferring to "}
                                {chainId === SupportedChainId.POLYGON && (
                                    <a href="https://www.kana.trade/?market=BTC-PERP" target="_blank" rel="noopener noreferrer" className="underline text-[#A5E547]">Kana Labs</a>
                                )}
                            </h3>
                            <p className="text-[14px] text-[#C3C3C3] text-center">
                                {chainId !== SupportedChainId.POLYGON
                                    ? "Please approve the network switch in your wallet."
                                    : "Please confirm the transaction in your wallet to complete the deposit."}
                            </p>
                        </div>
                    ) : (
                        // Main Deposit Modal
                        <>
                            <div className="w-full relative">
                                {!address && <StyledConnectButton />}
                            </div>

                            {/* Petra Wallet Connection */}
                            {address && !isPetraConnected && (
                                <div className="w-full">
                                    <button
                                        onClick={connectPetra}
                                        disabled={isProcessing}
                                        className="w-full h-11 bg-[#8B5CF6] hover:opacity-90 text-white font-semibold rounded-2xl border border-[rgba(139,92,246,0.2)] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="#3DDC84"/>
                                            <path d="M2 17L12 22L22 17" stroke="#3DDC84" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M2 12L12 17L22 12" stroke="#3DDC84" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                        Connect Petra Wallet
                                    </button>
                                    <p className="text-[12px] text-[#C3C3C3] mt-2 text-center">
                                        Connect your Petra wallet to use Aptos
                                    </p>
                                </div>
                            )}

                            {/* Petra Wallet Status */}
                            {address && isPetraConnected && (
                                <div className="w-full flex items-center justify-between p-3 bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.2)] rounded-2xl">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                        <span className="text-[14px] text-green-400 font-medium">Petra Connected</span>
                                    </div>
                                    <button
                                        onClick={disconnectPetra}
                                        className="text-[12px] text-red-400 hover:text-red-300 underline"
                                    >
                                        Disconnect
                                    </button>
                                </div>
                            )}

                            {/* Petra Address Display */}
                            {address && isPetraConnected && petraAddress && (
                                <div className="w-full p-3 bg-[rgba(139,92,246,0.1)] border border-[rgba(139,92,246,0.2)] rounded-2xl">
                                    <p className="text-[12px] text-[#C3C3C3] mb-1">Petra Address:</p>
                                    <p className="text-[12px] text-[#8B5CF6] font-mono break-all">{petraAddress}</p>
                                </div>
                            )}

                            {/* Amount Input */}
                            <div className="w-full">
                                <a href="https://www.kana.trade/?market=BTC-PERP" target="_blank" rel="noopener noreferrer" className="block">
                                    <h3 className="text-[14px] font-semibold text-[#F6F6F6] mb-4">Deposit in <span className="underline text-[#A5E547]">Kana</span></h3>
                                </a>
                                <div className="flex items-center p-3 bg-[#2A2A2A] border border-[#424242] rounded-2xl">
                                    <div className="flex items-center gap-3">
                                        <img src="/usdc-icon.svg" alt="USDC" className="w-6 h-6" />
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            pattern="^[0-9]*[.,]?[0-9]*$"
                                            value={amount}
                                            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                                            className="w-full bg-transparent text-[18px] font-semibold text-[#F6F6F6] outline-none"
                                            placeholder="Enter amount"
                                            disabled={shouldDisableInteraction}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Quick Amount Buttons */}
                            <div className="flex gap-[14px] w-full">
                                {['1', '5', '10', '20'].map((value) => (
                                    <button
                                        key={value}
                                        onClick={() => setAmount(value)}
                                        disabled={shouldDisableInteraction}
                                        className="flex items-center justify-center px-2 py-2 bg-[rgba(83,83,83,0.2)] border border-[#424242] rounded-lg h-[34px] flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <span className="text-[14px] font-semibold text-[#F6F6F6]">{value} USDC</span>
                                    </button>
                                ))}
                            </div>

                            {/* Warning Message */}
                            <div className="w-full flex gap-x-2 items-start p-4 bg-[rgba(255,183,77,0.05)] border border-[rgba(255,183,77,0.2)] rounded-2xl mt-2">
                                <img src="/info-icon.svg" alt="Info" className="w-4 h-4 mt-[2px]" />
                                <p className="text-xs font-bold text-[#F6F6F6] leading-5">
                                    The funds will be deposited in Kana.
                                </p>
                            </div>

                            {/* Continue Button */}
                            <button
                                onClick={transferToKana}
                                disabled={isProcessing || shouldDisableInteraction || !isKanaAddressValid || !isPetraConnected}
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
                                <p className="text-[10px] text-[#C3C3C3]">
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