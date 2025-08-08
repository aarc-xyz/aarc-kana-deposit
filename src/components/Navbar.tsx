import { useAccount } from "wagmi";
import StyledConnectButton from "./StyledConnectButton";
import DisconnectButton from "./DisconnectButton";

export const Navbar = ({ handleDisconnect }: { handleDisconnect: () => void }) => {
    const { address } = useAccount();

    return (
        <header className="fixed top-0 left-0 right-0 z-50 bg-aarc-bg/80 backdrop-blur-sm">
            <div className="mx-auto px-4 h-20 w-full flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <img
                        className="h-12 w-auto"
                        src="/aarc-logo.svg"
                        alt="Aarc Logo"
                    />
                    <img
                        src="/cross-icon.svg"
                        alt="Cross"
                        className="w-6 h-6"
                    />
                    <img
                        className="h-6 w-18"
                        src="/kana-name-logo.svg"
                        alt="kana labs Logo"
                    />
                </div>
                <div className="flex items-center space-x-4">
                    {address ? <DisconnectButton handleDisconnect={handleDisconnect} /> : <StyledConnectButton />}
                    {/* <img src="/dark_mode.svg" alt="Theme toggle" className="w-10 h-10" /> */}
                </div>
            </div>
        </header>
    );
};