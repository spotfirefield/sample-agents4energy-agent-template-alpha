import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  CircularProgress,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import ImageIcon from '@mui/icons-material/Image';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

interface FilePreviewProps {
  open: boolean;
  onClose: () => void;
  fileName: string;
  fileUrl: string;
}

const FilePreview: React.FC<FilePreviewProps> = ({ open, onClose, fileName, fileUrl }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  
  // Determine file type based on extension
  const getFileType = (filename: string): 'image' | 'text' | 'other' => {
    const extension = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    
    if (['.jpg', '.jpeg', '.png', '.gif', '.svg'].includes(extension)) {
      return 'image';
    } else if (['.txt', '.md', '.json', '.csv', '.html', '.css', '.js'].includes(extension)) {
      return 'text';
    } else {
      return 'other';
    }
  };
  
  const fileType = getFileType(fileName);
  
  // Fetch text content when needed
  useEffect(() => {
    if (!open || fileType !== 'text') return;
    
    const fetchTextContent = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
        }
        
        const text = await response.text();
        setFileContent(text);
      } catch (err) {
        console.error('Error loading file content:', err);
        setError('Failed to load file content. The file might be too large or not accessible.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchTextContent();
  }, [open, fileUrl, fileType]);
  
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  // Render file content based on type
  const renderFileContent = () => {
    if (loading) {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" height="300px">
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
    
    switch (fileType) {
      case 'image':
        return (
          <Box 
            display="flex" 
            justifyContent="center" 
            p={2} 
            sx={{ 
              maxHeight: '70vh',
              overflow: 'auto'
            }}
          >
            <img 
              src={fileUrl} 
              alt={fileName} 
              style={{ 
                maxWidth: '100%', 
                maxHeight: '100%',
                objectFit: 'contain'
              }} 
              onLoad={() => setLoading(false)}
              onError={() => {
                setError('Failed to load image');
                setLoading(false);
              }}
            />
          </Box>
        );
        
      case 'text':
        return (
          <Paper 
            variant="outlined" 
            sx={{ 
              p: 2, 
              maxHeight: '70vh', 
              overflow: 'auto',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              fontSize: '0.875rem',
              backgroundColor: '#f5f5f5'
            }}
          >
            {fileContent}
          </Paper>
        );
        
      default:
        return (
          <Box 
            display="flex" 
            flexDirection="column" 
            alignItems="center" 
            justifyContent="center" 
            p={4}
          >
            <InsertDriveFileIcon sx={{ fontSize: 80, color: 'primary.main', mb: 2 }} />
            <Typography variant="body1" gutterBottom>
              This file type cannot be previewed directly.
            </Typography>
            <Button 
              variant="contained" 
              color="primary" 
              startIcon={<DownloadIcon />}
              onClick={handleDownload}
              sx={{ mt: 2 }}
            >
              Download File
            </Button>
          </Box>
        );
    }
  };
  
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)'
        }
      }}
    >
      <DialogTitle sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        bgcolor: 'background.paper',
        borderBottom: '1px solid rgba(0, 0, 0, 0.12)'
      }}>
        <Box display="flex" alignItems="center">
          {fileType === 'image' ? (
            <ImageIcon sx={{ mr: 1, color: 'primary.main' }} />
          ) : fileType === 'text' ? (
            <TextSnippetIcon sx={{ mr: 1, color: 'primary.main' }} />
          ) : (
            <InsertDriveFileIcon sx={{ mr: 1, color: 'primary.main' }} />
          )}
          <Typography variant="h6" noWrap>
            {fileName}
          </Typography>
        </Box>
        <IconButton aria-label="close" onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent sx={{ p: 2, mt: 1 }}>
        {renderFileContent()}
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