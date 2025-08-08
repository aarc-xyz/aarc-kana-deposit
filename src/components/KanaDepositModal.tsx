import { useState } from 'react';
import { useAccount, useDisconnect, useWalletClient } from 'wagmi';
import { useChainId, useSwitchChain } from 'wagmi';
import { ethers } from 'ethers';
import { AarcFundKitModal, TransactionSuccessData } from '@aarc-dev/fundkit-web-sdk';
import {  SupportedChainId, USDT_ON_APTOS_ADDRESS, USDT_ON_POLYGON_ADDRESS } from '../constants';
import { Navbar } from './Navbar';
import StyledConnectButton from './StyledConnectButton';
import { SwapAggregator, Environment, NetworkId } from '@kanalabs/aggregator';
import { AptosConfig, Aptos, Network, Ed25519PrivateKey, Account, AccountAddress } from "@aptos-labs/ts-sdk";

const aptosConfig = new AptosConfig({ network: Network.MAINNET });
const aptosProvider = new Aptos(aptosConfig);

const aptosSigner = Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(import.meta.env.VITE_APTOS_PRIVATE_KEY || ""),
    address: AccountAddress.from(import.meta.env.VITE_APTOS_ADDRESS || ""),
    legacy: true,
  })

export const KanaDepositModal = ({ aarcModal }: { aarcModal: AarcFundKitModal }) => {
    const [amount, setAmount] = useState('1');
    const [kanaAptosAddress, setKanaAptosAddress] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [showProcessingModal, setShowProcessingModal] = useState(false);
    const { disconnect } = useDisconnect();
    const { data: walletClient } = useWalletClient();
    const { address } = useAccount();
    const chainId = useChainId();
    const { switchChain } = useSwitchChain();

    
    // Helper to perform the cross-chain swap using Kana
    const transferToKana = async () => {
        if (!walletClient || !address || !kanaAptosAddress) return;
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
            const signer = await provider.getSigner();
            const targetKanaAddress = aptosSigner.accountAddress.toString();
            
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
                    aptos: aptosSigner
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

            console.log("Transfer transaction hash:", transfer.txHash);

            const claim = await crossChainAggregator.executeClaim({
                apiKey: import.meta.env.VITE_KANA_API_KEY,
                txHash: transfer.txHash,
                sourceProvider: provider,
                targetProvider: aptosProvider,
                // @ts-ignore
                targetSigner: aptosSigner,
                quote: optimalQuote,
                sourceAddress: address,
                targetAddress: targetKanaAddress,
              })

              console.log("Tokens claimed successfully!")
              console.log("Transaction hash:", claim)

              await transferUSDTOnAptos(aptosSigner.accountAddress.toString(), kanaAptosAddress, amount);

            setShowProcessingModal(false);
            setAmount('');
            setKanaAptosAddress('');
            setIsProcessing(false);
        } catch (error) {
            console.error(error);
            setShowProcessingModal(false);
            setIsProcessing(false);
        }
    };

    // Function to transfer USDT on Aptos
    const transferUSDTOnAptos = async (fromAddress: string, toAddress: string, amountToTransfer: string) => {
        try {
            console.log("Transferring USDT on Aptos from", fromAddress, "to", toAddress);
            
            // USDT token address on Aptos mainnet
            const usdtTokenAddress = USDT_ON_APTOS_ADDRESS;
            
            // 1. Build the transaction
            console.log("Building USDT transfer transaction...");
            const transaction = await aptosProvider.transaction.build.simple({
                sender: fromAddress,
                data: {
                    function: "0x1::coin::transfer",
                    functionArguments: [toAddress, ethers.parseUnits(amountToTransfer, 6).toString()],
                    typeArguments: [`${usdtTokenAddress}::usdt::USDT`]
                }
            });
            console.log("Built the transaction!");
            
            // 2. Sign the transaction
            console.log("Signing transaction...");
            const senderAuthenticator = aptosProvider.transaction.sign({
                signer: aptosSigner,
                transaction
            });
            console.log("Signed the transaction!");
            
            // 3. Submit the transaction
            console.log("Submitting transaction...");
            const submittedTransaction = await aptosProvider.transaction.submit.simple({
                transaction,
                senderAuthenticator
            });
            console.log(`Submitted transaction hash: ${submittedTransaction.hash}`);
            
            // 4. Wait for transaction to be confirmed
            console.log("Waiting for transaction confirmation...");
            const executedTransaction = await aptosProvider.waitForTransaction({ 
                transactionHash: submittedTransaction.hash 
            });
            console.log("Transaction confirmed:", executedTransaction);
            
            console.log("USDT transfer on Aptos completed:", submittedTransaction.hash);
            return submittedTransaction.hash;
        } catch (error) {
            console.error('Error transferring USDT on Aptos:', error);
            throw new Error(`Failed to transfer USDT on Aptos: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    const handleDeposit = async () => {
        if (!address || !walletClient || !kanaAptosAddress) return;

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
        setKanaAptosAddress('');
        setIsProcessing(false);
        setShowProcessingModal(false);

        // Disconnect wallet
        disconnect();
    };


    const shouldDisableInteraction = !address;
    const isKanaAddressValid = kanaAptosAddress.length > 0;

    return (
        <div className="min-h-screen bg-aarc-bg grid-background">
            <Navbar handleDisconnect={handleDisconnect} />
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

                            {/* Kana Address Input */}
                            <div className="w-full">
                                <div className="flex items-center p-3 bg-[#2A2A2A] border border-[#424242] rounded-2xl">
                                    <div className="w-full flex justify-between gap-3">
                                        <img src="/kana-logo.svg" alt="Kana" className="w-6 h-6" />
                                        <input
                                            type="text"
                                            value={kanaAptosAddress}
                                            onChange={(e) => setKanaAptosAddress(e.target.value)}
                                            className="w-full bg-transparent text-[18px] font-semibold text-[#F6F6F6] outline-none"
                                            placeholder="Enter your Kana address"
                                            disabled={shouldDisableInteraction}
                                        />
                                    </div>
                                </div>
                                {!isKanaAddressValid && (
                                    <p className="text-[12px] text-[#FF6B6B] mt-2">
                                        Please enter your Kana address
                                    </p>
                                )}
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
                                disabled={isProcessing || shouldDisableInteraction || !isKanaAddressValid}
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