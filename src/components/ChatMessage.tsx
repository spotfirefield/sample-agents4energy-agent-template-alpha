import { stringify } from 'yaml'
import { useTheme } from '@mui/material/styles';
import { Button, Typography } from '@mui/material';
import CalculateIcon from '@mui/icons-material/Calculate';
import BuildIcon from '@mui/icons-material/Build';

import { Message } from '@/../utils/types';

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { stringifyLimitStringLength } from '../../utils/langChainUtils';


const ChatMessage = (params: {
    message: Message,
}) => {
    //Render either ai or human messages based on the params.message.role

    const theme = useTheme();

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