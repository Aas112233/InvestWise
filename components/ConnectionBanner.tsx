import React, { useEffect, useState, useRef } from 'react';
import { useGlobalState } from '../context/GlobalStateContext';
import { WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import Toast from './Toast';

const ConnectionBanner: React.FC = () => {
    const { connectionStatus, checkConnection, lastError, clearError } = useGlobalState();
    const [showToast, setShowToast] = useState(false);
    const [toastMessage, setToastMessage] = useState('');
    const [toastType, setToastType] = useState<'success' | 'warning' | 'error'>('warning');
    const prevStatus = useRef(connectionStatus);

    useEffect(() => {
        if (lastError) {
            setToastMessage(lastError.message);
            setToastType(lastError.type);
            setShowToast(true);
        }
    }, [lastError]);

    useEffect(() => {
        if (prevStatus.current === 'offline' && connectionStatus === 'online') {
            setToastMessage('Connection restored');
            setToastType('success');
            setShowToast(true);
        } else if (connectionStatus === 'offline' && prevStatus.current !== 'offline') {
            setToastMessage('You are offline. Check your internet connection.');
            setToastType('warning');
            setShowToast(true);
        }
        prevStatus.current = connectionStatus;
    }, [connectionStatus]);

    const handleCloseToast = () => {
        setShowToast(false);
        clearError();
    };

    if (connectionStatus === 'online' && !lastError) {
        return (
            <Toast
                message={toastMessage}
                type={toastType as any}
                isVisible={showToast}
                onClose={handleCloseToast}
            />
        );
    }

    const isOffline = connectionStatus === 'offline';

    return (
        <>
            <div className={`w-full py-2 px-4 flex items-center justify-between text-sm font-medium z-[50] ${isOffline ? 'bg-red-500/10 text-red-400 border-b border-red-500/20' : 'bg-amber-500/10 text-amber-400 border-b border-amber-500/20'
                }`}>
                <div className="flex items-center gap-3">
                    {isOffline ? <WifiOff size={16} /> : <AlertTriangle size={16} />}
                    <span>
                        {isOffline
                            ? "Server offline. You can keep working; changes will not be saved until connection returns."
                            : "Connection unstable. Some actions may fail."}
                    </span>
                </div>
                <button
                    onClick={() => checkConnection()}
                    className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 hover:bg-white/10 transition-colors text-xs uppercase tracking-wide"
                >
                    <RefreshCw size={12} />
                    Retry
                </button>
            </div>

            <Toast
                message={toastMessage}
                type={toastType as any}
                isVisible={showToast}
                onClose={handleCloseToast}
            />
        </>
    );
};

export default ConnectionBanner;
