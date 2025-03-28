import React, { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  Button, 
  Typography, 
  Box, 
  CircularProgress,
  IconButton,
  Paper
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import Image from 'next/image';
import { useFileSystem } from '@/contexts/FileSystemContext';

// File type detection helpers
const isImageFile = (filename: string) => {
  return /\.(jpeg|jpg|png|gif|bmp|svg|webp)$/i.test(filename);
};

const isTextFile = (filename: string) => {
  return /\.(txt|md|js|jsx|ts|tsx|html|css|json|csv|yml|yaml|xml|log)$/i.test(filename);
};

const isPdfFile = (filename: string) => {
  return /\.pdf$/i.test(filename);
};

interface FilePreviewProps {
  open: boolean;
  onClose: () => void;
  fileName: string;
  fileUrl: string;
  embedded?: boolean;
  onDelete?: () => void;
}

const FilePreview: React.FC<FilePreviewProps> = ({ open, onClose, fileName, fileUrl, embedded = false, onDelete }) => {
  const [textContent, setTextContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // Use the file system context to detect changes
  const { lastRefreshTime } = useFileSystem();

  // Fetch text content for text files
  const fetchTextContent = async (url: string) => {
    setLoading(true);
    setError(null);
    
    try {
      // The URL might have a signature/token that needs to be preserved
      // Don't add parameters to the URL directly
      const response = await fetch(url, { 
        // Add cache-busting headers instead of URL parameters
        headers: { 
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        },
        // Prevent browser caching
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
      }
      
      const text = await response.text();
      setTextContent(text);
    } catch (err) {
      console.error('Error fetching text file:', err);
      setError('Failed to load file content.');
    } finally {
      setLoading(false);
    }
  };
  
  // Load text content when component mounts or when the fileUrl changes
  useEffect(() => {
    if (open && fileUrl && isTextFile(fileName)) {
      fetchTextContent(fileUrl);
    }
  }, [open, fileUrl, fileName]);

  // Reload content when file system updates are detected
  useEffect(() => {
    if (open && fileUrl && isTextFile(fileName) && lastRefreshTime > 0) {
      fetchTextContent(fileUrl);
    }
  }, [lastRefreshTime, open, fileUrl, fileName]);

  // For image and PDF content, we'll use a cache-busting query parameter in the actual JSX
  // This avoids modifying the original URL which might have authentication tokens
  const getCacheBustedUrl = (url: string) => {
    // Only add cache busting when we've had a refresh trigger
    if (lastRefreshTime === 0) return url;
    
    // Preserve the original URL but add a timestamp parameter
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_cb=${lastRefreshTime}`;
  };
  
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  // Render file content based on type
  const renderContent = () => {
    if (loading) {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" height="100%">
          <CircularProgress />
        </Box>
      );
    }
    
    if (error) {
      return (
        <Box p={3} textAlign="center">
          <Typography color="error">{error}</Typography>
        </Box>
      );
    }
    
    if (isImageFile(fileName)) {
      return (
        <div className="relative w-full h-full">
          <Image
            src={getCacheBustedUrl(fileUrl)}
            alt="File preview"
            fill
            className="object-contain"
            priority
          />
        </div>
      );
    }
    
    if (isPdfFile(fileName)) {
      return (
        <Box height="100%">
          <iframe 
            src={`${getCacheBustedUrl(fileUrl)}#toolbar=0`} 
            title={fileName}
            width="100%"
            height="100%"
            style={{ border: 'none' }}
          />
        </Box>
      );
    }
    
    if (isTextFile(fileName)) {
      return (
        <Box 
          p={2} 
          overflow="auto" 
          height="100%"
          sx={{ 
            backgroundColor: '#f5f5f5',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            fontSize: '0.9rem',
            lineHeight: 1.5,
            '&::-webkit-scrollbar': {
              width: '8px',
              height: '8px',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(0,0,0,0.2)',
              borderRadius: '4px',
            },
          }}
        >
          {textContent}
        </Box>
      );
    }
    
    return (
      <Box p={3} textAlign="center">
        <Typography>
          Preview not available for this file type. <a href={fileUrl} target="_blank" rel="noreferrer">Download</a>
        </Typography>
      </Box>
    );
  };
  
  // When embedded, return content directly without the Dialog wrapper
  if (embedded) {
    return (
      <Paper 
        elevation={0} 
        sx={{ 
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 1,
          border: '1px solid rgba(0,0,0,0.08)'
        }}
      >
        <Box 
          sx={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            p: 1,
            bgcolor: 'background.paper',
            borderBottom: '1px solid rgba(0,0,0,0.08)'
          }}
        >
          <Typography variant="subtitle2" noWrap sx={{ maxWidth: '80%' }}>
            {fileName}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {onDelete && (
              <IconButton size="small" onClick={onDelete} color="error">
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
        <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
          {renderContent()}
        </Box>
      </Paper>
    );
  }
  
  // Original Dialog view for non-embedded mode
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      sx={{ '& .MuiDialog-paper': { height: '90vh' } }}
    >
      <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6" noWrap component="div" sx={{ paddingRight: 2 }}>
          {fileName}
        </Typography>
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{ color: (theme) => theme.palette.grey[500] }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {renderContent()}
      </DialogContent>
      
      <DialogActions sx={{ borderTop: '1px solid rgba(0, 0, 0, 0.12)', p: 2 }}>
        <Button 
          onClick={handleDownload} 
          startIcon={<DownloadIcon />}
          variant="outlined"
        >
          Download
        </Button>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FilePreview; 