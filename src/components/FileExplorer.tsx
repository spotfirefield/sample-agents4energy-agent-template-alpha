import React, { useState, useEffect } from 'react';
import { list, getUrl } from 'aws-amplify/storage';
import { 
  Box, 
  Typography, 
  List, 
  ListItem, 
  ListItemButton,
  ListItemIcon, 
  ListItemText, 
  CircularProgress,
  Collapse,
  IconButton,
  Breadcrumbs,
  Link as MuiLink
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { styled } from '@mui/material/styles';
import FilePreview from './FilePreview';

// File extensions to icon mapping
const fileIcons: Record<string, React.ReactNode> = {
  '.txt': <InsertDriveFileIcon style={{ color: '#2196f3' }} />,
  '.pdf': <InsertDriveFileIcon style={{ color: '#f44336' }} />,
  '.png': <InsertDriveFileIcon style={{ color: '#4caf50' }} />,
  '.jpg': <InsertDriveFileIcon style={{ color: '#4caf50' }} />,
  '.jpeg': <InsertDriveFileIcon style={{ color: '#4caf50' }} />,
  '.gif': <InsertDriveFileIcon style={{ color: '#4caf50' }} />,
  '.csv': <InsertDriveFileIcon style={{ color: '#ff9800' }} />,
  '.json': <InsertDriveFileIcon style={{ color: '#9c27b0' }} />,
  '.md': <InsertDriveFileIcon style={{ color: '#795548' }} />,
  '.html': <InsertDriveFileIcon style={{ color: '#e91e63' }} />,
  '.js': <InsertDriveFileIcon style={{ color: '#ffc107' }} />,
  '.css': <InsertDriveFileIcon style={{ color: '#03a9f4' }} />,
};

// Helper function to get file icon based on extension
const getFileIcon = (fileName: string) => {
  const extension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
  return fileIcons[extension] || <InsertDriveFileIcon />;
};

// Interface for file/folder items
interface FileItem {
  key: string;
  path: string;
  isFolder: boolean;
  name: string;
  url?: string;
  children?: FileItem[];
}

interface FileExplorerProps {
  chatSessionId: string;
  onFileSelect?: (file: FileItem) => void;
}

const StyledListItem = styled(ListItemButton)(({ theme }) => ({
  borderRadius: 8,
  '&:hover': {
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
  },
  marginBottom: 4,
}));

const FileExplorer: React.FC<FileExplorerProps> = ({ chatSessionId, onFileSelect }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileStructure, setFileStructure] = useState<FileItem[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [currentPath, setCurrentPath] = useState<string>('');
  const [breadcrumbs, setBreadcrumbs] = useState<{name: string, path: string}[]>([]);
  
  // File preview state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  
  // Base path for the chat session artifacts
  const basePath = `chatSessionArtifacts/sessionId=${chatSessionId}/`;

  // Function to load files and folders
  const loadFiles = async (path: string = '') => {
    setLoading(true);
    setError(null);
    
    try {
      const fullPath = path ? `${basePath}${path}` : basePath;
      const result = await list({ path: fullPath });
      
      // Process the results to create a hierarchical structure
      const items: FileItem[] = [];
      
      for (const item of result.items) {
        // Extract key from path
        const itemPath = item.path;
        if (!itemPath) continue;
        
        const name = itemPath.split('/').pop() || '';
        const isFolder = itemPath.endsWith('/');
        
        // Skip .s3meta files
        if (name.endsWith('.s3meta')) continue;
        
        let url = '';
        if (!isFolder) {
          try {
            const fileUrl = await getUrl({ path: itemPath });
            url = fileUrl.url.toString();
          } catch (e) {
            console.error(`Error getting URL for ${itemPath}:`, e);
          }
        }
        
        items.push({
          key: itemPath,
          path: itemPath.replace(basePath, ''),
          isFolder,
          name,
          url,
        });
      }
      
      // Sort items - folders first, then files
      items.sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      });
      
      setFileStructure(items);
      
      // Update breadcrumbs
      if (path) {
        const parts = path.split('/').filter(Boolean);
        const newBreadcrumbs = parts.map((part, index) => {
          const pathUpToThis = parts.slice(0, index + 1).join('/');
          return { name: part, path: pathUpToThis };
        });
        
        setBreadcrumbs([{ name: 'Home', path: '' }, ...newBreadcrumbs]);
      } else {
        setBreadcrumbs([{ name: 'Home', path: '' }]);
      }
      
    } catch (err) {
      console.error('Error loading files:', err);
      setError('Failed to load files. Please try again later.');
    } finally {
      setLoading(false);
    }
  };
  
  // Load files when component mounts or when current path changes
  useEffect(() => {
    loadFiles(currentPath);
  }, [currentPath, chatSessionId]);
  
  // Handle folder click
  const handleFolderClick = (folder: FileItem) => {
    // Navigate into the folder
    const relativePath = folder.path;
    setCurrentPath(relativePath);
  };
  
  // Handle file click
  const handleFileClick = (file: FileItem) => {
    if (!file.isFolder && file.url) {
      // Call onFileSelect if provided
      if (onFileSelect) {
        onFileSelect(file);
      } else {
        setSelectedFile(file);
        setPreviewOpen(true);
      }
    }
  };
  
  // Navigate to a specific breadcrumb
  const handleBreadcrumbClick = (path: string) => {
    setCurrentPath(path);
  };
  
  // Go back to parent folder
  const handleBackClick = () => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length === 0) return; // Already at root
    
    const parentPath = parts.slice(0, parts.length - 1).join('/');
    setCurrentPath(parentPath);
  };
  
  // Refresh current directory
  const handleRefresh = () => {
    loadFiles(currentPath);
  };
  
  // Close file preview
  const handleClosePreview = () => {
    setPreviewOpen(false);
    setSelectedFile(null);
  };
  
  if (loading && fileStructure.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        <CircularProgress />
      </Box>
    );
  }
  
  if (error && fileStructure.length === 0) {
    return (
      <Box p={2}>
        <Typography color="error">{error}</Typography>
        <IconButton onClick={handleRefresh} color="primary" size="small" sx={{ mt: 1 }}>
          <RefreshIcon /> Retry
        </IconButton>
      </Box>
    );
  }
  
  if (fileStructure.length === 0 && !loading) {
    return (
      <Box p={2}>
        <Typography variant="body2" color="textSecondary">
          No files found in this folder.
        </Typography>
        <IconButton onClick={handleRefresh} color="primary" size="small" sx={{ mt: 1 }}>
          <RefreshIcon />
        </IconButton>
      </Box>
    );
  }
  
  return (
    <Box>
      {/* Navigation toolbar */}
      <Box display="flex" alignItems="center" px={1} py={0.5} bgcolor="background.paper">
        <IconButton 
          size="small" 
          onClick={handleBackClick} 
          disabled={currentPath === ''}
          sx={{ mr: 1 }}
        >
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        
        <Box flex={1} overflow="hidden">
          <Breadcrumbs maxItems={3} aria-label="breadcrumb" sx={{ fontSize: '0.875rem' }}>
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return isLast ? (
                <Typography key={crumb.path} color="textPrimary" variant="body2" sx={{ fontWeight: 'medium' }}>
                  {crumb.name}
                </Typography>
              ) : (
                <MuiLink
                  key={crumb.path}
                  component="button"
                  variant="body2"
                  onClick={() => handleBreadcrumbClick(crumb.path)}
                  underline="hover"
                  color="inherit"
                >
                  {crumb.name}
                </MuiLink>
              );
            })}
          </Breadcrumbs>
        </Box>
        
        <IconButton size="small" onClick={handleRefresh} sx={{ ml: 1 }}>
          <RefreshIcon fontSize="small" />
        </IconButton>
      </Box>
      
      {/* File list */}
      <List dense>
        {fileStructure.map((item) => (
          <ListItem key={item.key} disablePadding>
            <StyledListItem
              onClick={() => item.isFolder 
                ? handleFolderClick(item) 
                : handleFileClick(item)
              }
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                {item.isFolder ? <FolderIcon color="primary" /> : getFileIcon(item.name)}
              </ListItemIcon>
              <ListItemText
                primary={item.name}
                primaryTypographyProps={{ noWrap: true }}
              />
            </StyledListItem>
          </ListItem>
        ))}
      </List>
      
      {/* Loading indicator for refreshes */}
      {loading && fileStructure.length > 0 && (
        <Box display="flex" justifyContent="center" p={1}>
          <CircularProgress size={24} />
        </Box>
      )}
      
      {/* File Preview Dialog */}
      {selectedFile && (
        <FilePreview
          open={previewOpen}
          onClose={handleClosePreview}
          fileName={selectedFile.name}
          fileUrl={selectedFile.url || ''}
        />
      )}
    </Box>
  );
};

export default FileExplorer; 