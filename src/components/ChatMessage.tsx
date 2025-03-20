import { useTheme } from '@mui/material/styles';
import { Button, Typography } from '@mui/material';
import CalculateIcon from '@mui/icons-material/Calculate';
import BuildIcon from '@mui/icons-material/Build';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DescriptionIcon from '@mui/icons-material/Description';
import UpdateIcon from '@mui/icons-material/Update';
import { useEffect, useRef } from 'react';

import { Message } from '@/../utils/types';
import { useFileSystem } from '@/contexts/FileSystemContext';

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { stringifyLimitStringLength } from '../../utils/langChainUtils';


const ChatMessage = (params: {
    message: Message,
}) => {
    //Render either ai or human messages based on the params.message.role

    const theme = useTheme();
    const { refreshFiles } = useFileSystem();
    
    // Use a ref to track which messages we've already processed
    // to prevent multiple refreshes for the same message
    const processedMessageRef = useRef<{[key: string]: boolean}>({});

    // Effect to handle file operation updates
    useEffect(() => {
        // Skip if we've already processed this message
        const messageId = params.message.id;
        if (!messageId || processedMessageRef.current[messageId]) {
            return;
        }
        
        if (params.message.role === 'tool' && 
            (params.message.toolName === 'writeFile' || 
             params.message.toolName === 'updateFile')) {
            try {
                const fileData = JSON.parse(params.message.content?.text || '{}');
                if (fileData.success) {
                    // Mark this message as processed
                    processedMessageRef.current[messageId] = true;
                    // Refresh file list when operations are successful
                    refreshFiles();
                }
            } catch (error) {
                console.error('Error parsing file operation result:', error);
                // Even on error, mark as processed to prevent infinite retries
                processedMessageRef.current[messageId] = true;
            }
        }
    }, [params.message, refreshFiles]);

    const humanMessageStyle = {
        backgroundColor: theme.palette.primary.light,
        color: theme.palette.primary.contrastText,
        padding: theme.spacing(1),
        borderRadius: theme.shape.borderRadius,
        textAlign: 'right' as const,
        marginLeft: 'auto',
        maxWidth: '80%',
    };
    const aiMessageStyle = {
        backgroundColor: theme.palette.grey[200],
        padding: theme.spacing(1),
        borderRadius: theme.shape.borderRadius,
    };

    switch (params.message.role) {
        case 'ai':
            return <div style={aiMessageStyle}>
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                >
                    {params.message.content?.text}
                </ReactMarkdown>
                {params.message.toolCalls && params.message.toolCalls !== '[]' && (
                    <div style={{
                        backgroundColor: theme.palette.grey[100],
                        padding: theme.spacing(1),
                        borderRadius: theme.shape.borderRadius,
                        marginTop: theme.spacing(1),
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                    }}>
                        <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                            Tool Calls
                        </Typography>
                        {JSON.parse(params.message.toolCalls).map((toolCall: { name: string, args: unknown, id: string }, index: number) => (
                            <div key={toolCall.id || index} style={{
                                backgroundColor: theme.palette.common.white,
                                padding: theme.spacing(1),
                                borderRadius: theme.shape.borderRadius,
                                marginBottom: theme.spacing(1)
                            }}>
                                <Typography variant="body2" color="primary" fontWeight="bold" style={{ display: 'flex', alignItems: 'center' }}>
                                    <BuildIcon fontSize="small" style={{ marginRight: theme.spacing(0.5) }} />
                                    {toolCall.name}
                                </Typography>
                                <div style={{
                                    backgroundColor: theme.palette.grey[50],
                                    padding: theme.spacing(1),
                                    borderRadius: theme.shape.borderRadius,
                                    fontFamily: 'monospace',
                                    fontSize: '0.85rem',
                                    marginTop: theme.spacing(0.5)
                                }}>
                                    <pre>
                                        {stringifyLimitStringLength(toolCall.args, 50)}
                                    </pre>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            break;
        case 'tool':
            switch (params.message.toolName) {
                case 'calculator':
                    return (
                        <div style={{
                            backgroundColor: theme.palette.grey[100],
                            padding: theme.spacing(2),
                            borderRadius: theme.shape.borderRadius,
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            maxWidth: '80%'
                        }}>
                            <div style={{
                                backgroundColor: theme.palette.grey[900],
                                color: theme.palette.common.white,
                                padding: theme.spacing(1),
                                borderTopLeftRadius: theme.shape.borderRadius,
                                borderTopRightRadius: theme.shape.borderRadius,
                                fontWeight: 'bold',
                                display: 'flex',
                                alignItems: 'center',
                                gap: theme.spacing(1)
                            }}>
                                <CalculateIcon fontSize="small" />
                                Calculator Result
                            </div>
                            <div style={{
                                backgroundColor: theme.palette.common.white,
                                padding: theme.spacing(2),
                                borderBottomLeftRadius: theme.shape.borderRadius,
                                borderBottomRightRadius: theme.shape.borderRadius,
                                fontSize: '1.2rem',
                                fontFamily: 'monospace',
                                textAlign: 'right'
                            }}>
                                {params.message.content?.text}
                            </div>
                        </div>
                    )
                    break
                case 'userInputTool':
                    try {
                        const toolData = JSON.parse(params.message.content?.text || '{}');
                        return (
                            <div style={{
                                backgroundColor: theme.palette.background.paper,
                                padding: theme.spacing(2),
                                borderRadius: theme.shape.borderRadius,
                                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                                maxWidth: '90%',
                                margin: theme.spacing(1, 0)
                            }}>
                                <Typography variant="h6" gutterBottom sx={{
                                    color: theme.palette.primary.main,
                                    fontWeight: 'bold'
                                }}>
                                    {toolData.title || 'User Action Required'}
                                </Typography>

                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                >
                                    {toolData.description || 'Please take action by clicking the button below.'}
                                </ReactMarkdown>

                                <Button
                                    variant="contained"
                                    color="primary"
                                    sx={{
                                        fontWeight: 'medium',
                                        textTransform: 'none',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                                        '&:hover': {
                                            boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
                                        }
                                    }}
                                    onClick={(e) => {
                                        const button = e.currentTarget;
                                        button.disabled = true;
                                        button.textContent = toolData.buttonTextAfterClick || 'Done!';
                                        button.style.backgroundColor = theme.palette.success.main;
                                    }}
                                >
                                    {toolData.buttonTextBeforeClick || 'Click to Proceed'}
                                </Button>
                            </div>
                        );
                    } catch (error) {
                        return (
                            <div style={aiMessageStyle}>
                                <Typography variant="subtitle2" color="error" gutterBottom>
                                    Error parsing user input tool data
                                </Typography>
                                <div>
                                    {params.message.content?.text}
                                    {String(error)}
                                </div>
                            </div>
                        );
                    }
                    break;
                case 'listFiles':
                    try {
                        const listData = JSON.parse(params.message.content?.text || '{}');
                        const path = listData.path || '';
                        const directories = listData.directories || [];
                        const files = listData.files || [];
                        
                        return (
                            <div style={{
                                backgroundColor: theme.palette.grey[50],
                                padding: theme.spacing(2),
                                borderRadius: theme.shape.borderRadius,
                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                width: '100%'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: theme.spacing(1),
                                    marginBottom: theme.spacing(1.5),
                                    color: theme.palette.primary.main
                                }}>
                                    <DescriptionIcon />
                                    <Typography variant="subtitle1" fontWeight="medium">
                                        Contents of {path ? `"${path}"` : 'root directory'}
                                    </Typography>
                                </div>
                                
                                {directories.length > 0 && (
                                    <div style={{ marginBottom: theme.spacing(2) }}>
                                        <Typography variant="subtitle2" style={{ color: theme.palette.primary.main, fontWeight: 'bold' }}>
                                            Directories:
                                        </Typography>
                                        <div style={{ 
                                            margin: theme.spacing(1, 0),
                                            maxHeight: directories.length > 10 ? '200px' : 'none',
                                            overflow: directories.length > 10 ? 'auto' : 'visible'
                                        }}>
                                            <ul style={{ paddingLeft: theme.spacing(3), margin: 0 }}>
                                                {directories.map((dir: string, i: number) => (
                                                    <li key={i} style={{ marginBottom: theme.spacing(0.5) }}>
                                                        <Typography variant="body2">
                                                            📁 {dir}/
                                                        </Typography>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                        {directories.length > 10 && (
                                            <Typography variant="caption" color="textSecondary" style={{ fontStyle: 'italic', marginTop: theme.spacing(0.5) }}>
                                                Showing all {directories.length} directories (scroll to see more)
                                            </Typography>
                                        )}
                                    </div>
                                )}
                                
                                {files.length > 0 && (
                                    <div>
                                        <Typography variant="subtitle2" style={{ color: theme.palette.primary.main, fontWeight: 'bold' }}>
                                            Files:
                                        </Typography>
                                        <div style={{ 
                                            margin: theme.spacing(1, 0),
                                            maxHeight: files.length > 10 ? '200px' : 'none',
                                            overflow: files.length > 10 ? 'auto' : 'visible'
                                        }}>
                                            <ul style={{ paddingLeft: theme.spacing(3), margin: 0 }}>
                                                {files.map((file: string, i: number) => (
                                                    <li key={i} style={{ marginBottom: theme.spacing(0.5) }}>
                                                        <Typography variant="body2">
                                                            📄 {file}
                                                        </Typography>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                        {files.length > 10 && (
                                            <Typography variant="caption" color="textSecondary" style={{ fontStyle: 'italic', marginTop: theme.spacing(0.5) }}>
                                                Showing all {files.length} files (scroll to see more)
                                            </Typography>
                                        )}
                                    </div>
                                )}
                                
                                {directories.length === 0 && files.length === 0 && (
                                    <Typography variant="body2" style={{ fontStyle: 'italic', color: theme.palette.text.secondary }}>
                                        No files or directories found.
                                    </Typography>
                                )}
                            </div>
                        );
                    } catch (error) {
                        return (
                            <div style={aiMessageStyle}>
                                <Typography variant="subtitle2" color="textSecondary" gutterBottom>
                                    List of files in the requested directory
                                </Typography>
                                <pre>
                                    {params.message.content?.text}
                                </pre>
                            </div>
                        );
                    }
                    break;
                case 'readFile':
                    try {
                        const fileContent = JSON.parse(params.message.content?.text || '{}').content;
                        return (
                            <div style={{
                                backgroundColor: theme.palette.grey[50],
                                padding: theme.spacing(2),
                                borderRadius: theme.shape.borderRadius,
                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                width: '100%'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: theme.spacing(1),
                                    marginBottom: theme.spacing(1.5),
                                    color: theme.palette.primary.main
                                }}>
                                    <DescriptionIcon />
                                    <Typography variant="subtitle1" fontWeight="medium">
                                        File Content
                                    </Typography>
                                </div>
                                <div style={{
                                    backgroundColor: theme.palette.common.white,
                                    padding: theme.spacing(2),
                                    borderRadius: theme.shape.borderRadius,
                                    border: `1px solid ${theme.palette.grey[200]}`,
                                    overflow: 'auto',
                                    maxHeight: '300px',
                                    fontFamily: 'monospace',
                                    fontSize: '0.9rem',
                                    whiteSpace: 'pre-wrap',
                                    width: '100%',
                                    boxSizing: 'border-box'
                                }}>
                                    {typeof fileContent === 'string' ? fileContent : JSON.stringify(fileContent, null, 2)}
                                </div>
                            </div>
                        );
                    } catch (error) {
                        return (
                            <div style={aiMessageStyle}>
                                <Typography variant="subtitle2" color="error" gutterBottom>
                                    Error processing file content
                                </Typography>
                                <pre>
                                    {params.message.content?.text}
                                </pre>
                            </div>
                        );
                    }
                    break;
                case 'writeFile':
                    try {
                        const fileData = JSON.parse(params.message.content?.text || '{}');
                        return (
                            <div style={{
                                backgroundColor: theme.palette.success.light,
                                padding: theme.spacing(1.5),
                                borderRadius: theme.shape.borderRadius,
                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                maxWidth: '80%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: theme.spacing(1.5)
                            }}>
                                <CheckCircleIcon style={{ color: theme.palette.success.dark }} />
                                <Typography variant="body1" color="textPrimary">
                                    {fileData.success 
                                        ? `File saved successfully` 
                                        : `Error: ${fileData.message || 'Unknown error writing file'}`}
                                </Typography>
                            </div>
                        );
                    } catch (error) {
                        return (
                            <div style={aiMessageStyle}>
                                <Typography variant="subtitle2" color="error" gutterBottom>
                                    Error processing file write result
                                </Typography>
                                <pre>
                                    {params.message.content?.text}
                                </pre>
                            </div>
                        );
                    }
                    break;
                case 'updateFile':
                    try {
                        const fileData = JSON.parse(params.message.content?.text || '{}');
                        return (
                            <div style={{
                                backgroundColor: theme.palette.info.light,
                                padding: theme.spacing(1.5),
                                borderRadius: theme.shape.borderRadius,
                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                maxWidth: '80%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: theme.spacing(1.5)
                            }}>
                                <UpdateIcon style={{ color: theme.palette.info.dark }} />
                                <Typography variant="body1" color="textPrimary">
                                    {fileData.success 
                                        ? `File updated successfully` 
                                        : `Error: ${fileData.message || 'Unknown error updating file'}`}
                                </Typography>
                            </div>
                        );
                    } catch (error) {
                        return (
                            <div style={aiMessageStyle}>
                                <Typography variant="subtitle2" color="error" gutterBottom>
                                    Error processing file update result
                                </Typography>
                                <pre>
                                    {params.message.content?.text}
                                </pre>
                            </div>
                        );
                    }
                    break;

                default:
                    return <>
                        <p>Tool message</p>
                        <pre>
                            {JSON.stringify(params.message, null, 2)}
                        </pre>
                    </>
            }

            break;
        case 'human':
            return (
                <div style={humanMessageStyle}>
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                    >
                        {params.message.content?.text}
                    </ReactMarkdown>

                    {/* <pre>
                        {JSON.stringify(params.message, null, 2)}
                    </pre> */}
                </div>
            )
            break;
    }
}

export default ChatMessage