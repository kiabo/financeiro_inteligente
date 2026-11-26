import { WifiOff } from 'lucide-react';
import React, { useEffect, useState } from 'react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 left-4 z-50 flex items-center gap-2 rounded-[4px] border border-[#F59E0B] bg-[#FFFBEB] px-3 py-2 text-[12px] font-medium text-[#92400E] shadow-sm md:bottom-4 dark:border-[#D97706] dark:bg-[#2E1A04] dark:text-[#FDE68A]"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>Modo offline — exibindo dados em cache local.</span>
    </div>
  );
};
