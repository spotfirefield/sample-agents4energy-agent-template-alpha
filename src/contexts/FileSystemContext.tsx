"use client"
import React, { createContext, useContext, useState, ReactNode, useCallback, useRef } from 'react';

// Interface for file system context
interface FileSystemContextType {
  // Trigger a refresh of the file list
  refreshFiles: () => void;
  // Last time files were refreshed
  lastRefreshTime: number;
  // Flag to indicate if a refresh is in progress
  isRefreshing: boolean;
}

// Create the context with a default value
const FileSystemContext = createContext<FileSystemContextType>({
  refreshFiles: () => {},
  lastRefreshTime: 0,
  isRefreshing: false,
});

// Provider props interface
interface FileSystemProviderProps {
  children: ReactNode;
}

export const FileSystemProvider: React.FC<FileSystemProviderProps> = ({ children }) => {
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(Date.now());
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  
  // Use a ref to track if a refresh is already in progress to prevent duplicate triggers
  const refreshInProgressRef = useRef(false);

  // Function to trigger a refresh - stabilized with useCallback to prevent infinite loops
  const refreshFiles = useCallback(() => {
    if (refreshInProgressRef.current) return; // Don't trigger multiple refreshes
    
    refreshInProgressRef.current = true;
    setIsRefreshing(true);
    // Update the timestamp to trigger useEffect hooks in components
    setLastRefreshTime(Date.now());
    
    // Add a small delay before setting isRefreshing to false to allow components to respond
    setTimeout(() => {
      setIsRefreshing(false);
      refreshInProgressRef.current = false;
    }, 500);
  }, []);

  // Stable context value to prevent unnecessary re-renders
  const contextValue = React.useMemo(() => ({
    refreshFiles,
    lastRefreshTime,
    isRefreshing,
  }), [refreshFiles, lastRefreshTime, isRefreshing]);

  return (
    <FileSystemContext.Provider value={contextValue}>
      {children}
    </FileSystemContext.Provider>
  );
};

// Custom hook for using the file system context
export const useFileSystem = () => useContext(FileSystemContext); 