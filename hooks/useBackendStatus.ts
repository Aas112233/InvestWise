import { useState, useEffect } from 'react';
import api from '../services/api';

export const useBackendStatus = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        await api.get('/health', { timeout: 3000 });
        setIsConnected(true);
      } catch (error) {
        setIsConnected(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 10000);

    return () => clearInterval(interval);
  }, []);

  return { isConnected, isChecking };
};
