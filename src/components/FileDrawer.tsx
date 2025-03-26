import React, { useState } from 'react';
import { 
  Drawer, 
  Box, 
  Typography, 
  IconButton, 
  Divider,
  useTheme,
  useMediaQuery,
  Paper,
  Stack,
  Button,
  Snackbar,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import { uploadData, remove } from '@aws-amplify/storage';
import FolderIcon from '@mui/icons-material/Folder';
import CloseIcon from '@mui/icons-material/Close';
import UploadFileIcon from '@mui/icons-material/UploadFile';

import FileExplorer from './FileExplorer';
import FilePreview from './FilePreview';
import { useFileSystem } from '@/contexts/FileSystemContext';

interface FileItem {
  key: string;
  path: string;
  isFolder: boolean;
  name: string;
  url?: string;
  children?: FileItem[];
}

interface FileDrawerProps {
  open: boolean;
  onClose: () => void;
  chatSessionId: string;
  variant?: 'temporary' | 'persistent' | 'permanent';
}

const FileDrawer: React.FC<FileDrawerProps> = ({ 
  open, 
  onClose, 
  chatSessionId
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  
  // State for the currently selected file to preview
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  
  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [showUploadMessage, setShowUploadMessage] = useState(false);
  
  // Use the file system context to trigger refreshes
  const { refreshFiles } = useFileSystem();
  
  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null);
  
  // Handle file selection for preview
  const handleFileSelect = (file: FileItem) => {
    if (!file.isFolder) {
      setSelectedFile(file);
    }
  };

  const handleDeleteClick = (file: FileItem) => {
    setFileToDelete(file);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!fileToDelete) return;

    try {
      await remove({ path: fileToDelete.key });
      setSelectedFile(null);
      refreshFiles();
      setDeleteDialogOpen(false);
      setFileToDelete(null);
      setUploadMessage('File deleted successfully');
      setShowUploadMessage(true);
    } catch (error) {
      console.error('Error deleting file:', error);
      setUploadMessage('Failed to delete file. Please try again.');
      setShowUploadMessage(true);
    }
  };

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadMessage('Uploading files...');
    setShowUploadMessage(true);

    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        const key = `chatSessionArtifacts/sessionId=${chatSessionId}/${file.name}`;
        
        await uploadData({
          path: key,
          data: file,
          options: {
            contentType: file.type
          }
        });
      });

      await Promise.all(uploadPromises);
      setUploadMessage('Files uploaded successfully');
      
      // Add a small delay before refreshing to allow S3 to propagate changes
      setTimeout(() => {
        refreshFiles();
      }, 1000);
    } catch (error) {
      console.error('Error uploading files:', error);
      setUploadMessage('Failed to upload files. Please try again.');
    } finally {
      setIsUploading(false);
      // Clear the file input
      event.target.value = '';
    }
  };

  // Handle closing upload message
  const handleCloseUploadMessage = () => {
    setShowUploadMessage(false);
  };
  
  // Adjust drawer width for non-mobile screens to allow chat visibility
  const drawerWidth = isMobile ? '100%' : '45%';

  return (
    <>
      {/* Use a fixed position div instead of Drawer for desktop to avoid modal behavior */}
      {!isMobile && open ? (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: drawerWidth,
            height: '100%',
            backgroundColor: 'background.paper',
            boxShadow: '-4px 0 8px rgba(0,0,0,0.1)',
            zIndex: theme.zIndex.drawer,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 2,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <FolderIcon sx={{ mr: 1 }} />
              <Typography variant="h6" noWrap>
                Session Files
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <input
                accept="*/*"
                style={{ display: 'none' }}
                id="file-upload"
                multiple
                type="file"
                onChange={handleFileUpload}
                disabled={isUploading}
              />
              <label htmlFor="file-upload">
                <Button
                  component="span"
                  startIcon={<UploadFileIcon />}
                  variant="contained"
                  color="primary"
                  disabled={isUploading}
                  sx={{ 
                    backgroundColor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': {
                      backgroundColor: 'primary.dark',
                    },
                    '&.Mui-disabled': {
                      backgroundColor: 'action.disabledBackground',
                    }
                  }}
                >
                  Upload
                </Button>
              </label>
              <IconButton
                onClick={onClose}
                sx={{ color: 'primary.contrastText' }}
                size="small"
              >
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>
          
          <Divider />
          
          <Box sx={{ 
            height: 'calc(100% - 64px)', // Subtract header height
            overflow: 'hidden',
          }}>
            {/* Split view for larger devices using Stack instead of Grid2 */}
            <Stack 
              direction="row" 
              sx={{ height: '100%' }}
              divider={<Divider orientation="vertical" flexItem />}
            >
              <Box sx={{ width: '40%', height: '100%', overflow: 'auto', p: 1 }}>
                <FileExplorer 
                  chatSessionId={chatSessionId} 
                  onFileSelect={handleFileSelect}
                />
              </Box>
              <Box sx={{ width: '60%', height: '100%', overflow: 'auto', p: 1 }}>
                {selectedFile ? (
                  <FilePreview
                    open={!!selectedFile}
                    onClose={() => setSelectedFile(null)}
                    fileName={selectedFile.name}
                    fileUrl={selectedFile.url || ''}
                    embedded={true}
                    onDelete={() => handleDeleteClick(selectedFile)}
                  />
                ) : (
                  <Paper 
                    elevation={0} 
                    sx={{ 
                      height: '100%', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      bgcolor: 'background.default',
                      p: 3,
                      textAlign: 'center'
                    }}
                  >
                    <Typography color="textSecondary">
                      Select a file to preview its contents
                    </Typography>
                  </Paper>
                )}
              </Box>
            </Stack>
          </Box>

          {/* Upload status message */}
          <Snackbar 
            open={showUploadMessage} 
            autoHideDuration={isUploading ? null : 4000}
            onClose={handleCloseUploadMessage}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          >
            <Alert 
              onClose={handleCloseUploadMessage} 
              severity={isUploading ? "info" : "success"} 
              sx={{ width: '100%' }}
              icon={isUploading ? <CircularProgress size={20} /> : undefined}
            >
              {uploadMessage}
            </Alert>
          </Snackbar>
        </Box>
      ) : (
        /* Use the regular Material-UI Drawer for mobile only */
        <Drawer
          anchor="right"
          open={open && isMobile}
          onClose={onClose}
          variant="temporary"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
            },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 2,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <FolderIcon sx={{ mr: 1 }} />
              <Typography variant="h6" noWrap>
                Session Files
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <input
                accept="*/*"
                style={{ display: 'none' }}
                id="file-upload-mobile"
                multiple
                type="file"
                onChange={handleFileUpload}
                disabled={isUploading}
              />
              <label htmlFor="file-upload-mobile">
                <Button
                  component="span"
                  startIcon={<UploadFileIcon />}
                  variant="contained"
                  color="primary"
                  disabled={isUploading}
                  sx={{ 
                    backgroundColor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': {
                      backgroundColor: 'primary.dark',
                    },
                    '&.Mui-disabled': {
                      backgroundColor: 'action.disabledBackground',
                    }
                  }}
                >
                  Upload
                </Button>
              </label>
              <IconButton
                onClick={onClose}
                sx={{ color: 'primary.contrastText' }}
                size="small"
              >
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>
          
          <Divider />
          
          <Box sx={{ 
            height: 'calc(100% - 64px)', // Subtract header height
            overflow: 'hidden',
          }}>
            {/* Stack view for small devices */}
            <Box sx={{ height: '100%' }}>
              {selectedFile ? (
                // Show file preview with back button on small screens
                <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ p: 1 }}>
                    <IconButton onClick={() => setSelectedFile(null)} size="small">
                      <FolderIcon /> Back to files
                    </IconButton>
                  </Box>
                  <Box sx={{ flexGrow: 1, overflow: 'auto', p: 1 }}>
                    {selectedFile && (
                      <FilePreview
                        open={!!selectedFile}
                        onClose={() => setSelectedFile(null)}
                        fileName={selectedFile.name}
                        fileUrl={selectedFile.url || ''}
                        embedded={true}
                        onDelete={() => handleDeleteClick(selectedFile)}
                      />
                    )}
                  </Box>
                </Box>
              ) : (
                // Show file explorer
                <Box sx={{ height: '100%', overflow: 'auto', p: 1 }}>
                  <FileExplorer 
                    chatSessionId={chatSessionId} 
                    onFileSelect={handleFileSelect}
                  />
                </Box>
              )}
            </Box>
          </Box>

          {/* Upload status message */}
          <Snackbar 
            open={showUploadMessage} 
            autoHideDuration={isUploading ? null : 4000}
            onClose={handleCloseUploadMessage}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          >
            <Alert 
              onClose={handleCloseUploadMessage} 
              severity={isUploading ? "info" : "success"} 
              sx={{ width: '100%' }}
              icon={isUploading ? <CircularProgress size={20} /> : undefined}
            >
              {uploadMessage}
            </Alert>
          </Snackbar>
        </Drawer>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete File</DialogTitle>
        <DialogContent>
          Are you sure you want to delete {fileToDelete?.name}?
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default FileDrawer; 