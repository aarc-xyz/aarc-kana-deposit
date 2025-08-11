import { AccountAddress, Ed25519PublicKey, AptosConfig, Aptos, Network } from "@aptos-labs/ts-sdk";

// Extend Window interface to include Petra wallet
declare global {
  interface Window {
    aptos?: {
      connect(): Promise<{ address: string }>;
      disconnect(): Promise<void>;
      account(): Promise<{ address: string; publicKey: string }>;
      signTransaction(transaction: any): Promise<any>;
      signAndSubmitTransaction(transaction: any): Promise<any>;
    };
  }
}

// Initialize Aptos provider for transaction submission
const aptosConfig = new AptosConfig({ network: Network.MAINNET });
const aptosProvider = new Aptos(aptosConfig);

// Petra wallet integration
export const getAptosWallet = () => {
    if ('aptos' in window) {
        return window.aptos;
    } else {
        window.open('https://petra.app/', `_blank`);
        return null;
    }
};

// PetraSigner class that implements the Aptos SDK's TransactionSigner interface
export class PetraSigner {
    private _address: AccountAddress;
    private _publicKey: Ed25519PublicKey;
  
    constructor(address: string, publicKey: string) {
      this._address = AccountAddress.fromString(address);
      this._publicKey = new Ed25519PublicKey(publicKey);
    }
  
    async signTransaction(rawTxn: any) {
      const wallet = getAptosWallet();
      if (!wallet) throw new Error("Petra not connected");
  
      // Convert the raw transaction to the format Petra expects
      const txnRequest = rawTxn;
      const signedTxn = await wallet.signTransaction(txnRequest);
      return signedTxn;
    }
  
    async signAndSubmitTransaction(rawTxn: any) {
      const wallet = getAptosWallet();
      if (!wallet) throw new Error("Petra not connected");
  
      try {
        // First sign the transaction with Petra
        const signedTxn = await this.signTransaction(rawTxn);
        
        // Then submit the signed transaction using the Aptos provider
        console.log("Submitting signed transaction with Aptos provider...");
        
        // The signedTxn from Petra should contain the signature and other required fields
        // We need to submit it properly through the Aptos provider
        const submittedTransaction = await aptosProvider.transaction.submit.simple({
          transaction: signedTxn,
          senderAuthenticator: signedTxn
        });
        
        console.log(`Transaction submitted successfully with hash: ${submittedTransaction.hash}`);
        
        // Wait for the transaction to be confirmed
        const executedTransaction = await aptosProvider.waitForTransaction({ 
          transactionHash: submittedTransaction.hash 
        });
        
        console.log("Transaction confirmed:", executedTransaction);
        
        return {
          hash: submittedTransaction.hash,
          success: true,
          transaction: executedTransaction
        };
        
      } catch (error) {
        console.error("Error in signAndSubmitTransaction:", error);
        throw new Error(`Failed to submit transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  
    // Getters for the SDK
    get accountAddress() {
      return this._address;
    }
  
    get publicKey() {
      return this._publicKey;
    }
  
    // Methods that might be called by the SDK
    async getPublicKey() {
      return this._publicKey;
    }
  
    async getAccountAddress() {
      return this._address;
    }
  }