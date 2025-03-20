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
  Stack
} from '@mui/material';

import FolderIcon from '@mui/icons-material/Folder';
import CloseIcon from '@mui/icons-material/Close';
import FileExplorer from './FileExplorer';
import FilePreview from './FilePreview';

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
  chatSessionId, 
  variant = 'temporary' 
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isSmall = useMediaQuery(theme.breakpoints.down('sm'));
  
  // State for the currently selected file to preview
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  
  // Handle file selection for preview
  const handleFileSelect = (file: FileItem) => {
    if (!file.isFolder) {
      setSelectedFile(file);
    }
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
            <IconButton
              onClick={onClose}
              sx={{ color: 'primary.contrastText' }}
              size="small"
            >
              <CloseIcon />
            </IconButton>
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
            <IconButton
              onClick={onClose}
              sx={{ color: 'primary.contrastText' }}
              size="small"
            >
              <CloseIcon />
            </IconButton>
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
        </Drawer>
      )}
    </>
  );
};

export default FileDrawer; 