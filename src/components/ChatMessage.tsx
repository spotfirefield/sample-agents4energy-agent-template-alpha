import { stringify } from 'yaml'
import { useTheme } from '@mui/material/styles';
import CalculateIcon from '@mui/icons-material/Calculate';
import BuildIcon from '@mui/icons-material/Build';

// import { z } from "zod";

// import { generateClient } from "aws-amplify/data";
// import { type Schema } from "@/../amplify/data/resource";

import { Message } from '@/../utils/types';
// import { createGardenType, plannedStepArrayType } from '../../utils/types';

// import { MuiMarkdown } from 'mui-markdown';
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Typography } from '@mui/material';

// const amplifyClient = generateClient<Schema>();



const ChatMessage = (params: {
    message: Message,
    // setChatSession: (newGarden: Schema["ChatSession"]["createType"]) => void,
    // setPlannedSteps: (newPlannedSteps: PlannedSteps) => void
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


    let messageStyle = {};

    // let proposedGarden: z.infer<typeof createGardenType>
    // let proposedGarden: Schema["ChatSession"]["createType"] = {}
    // const proposedSteps: PlannedSteps = []

    switch (params.message.role) {
        case 'ai':
            messageStyle = aiMessageStyle;
            if (params.message.toolCalls && params.message.toolCalls !== '[]') {
                // console.log('Parsing tool calls: ', params.message.toolCalls)
                const toolCalls = JSON.parse(params.message.toolCalls) as { name: string, args: unknown }[]
                // console.log('toolCalls: ', toolCalls)
                for (const toolCall of toolCalls) {
                    // toolCalls.forEach((toolCall) => {
                    switch (toolCall.name) {
                        case 'createGardenPlannedSteps':
                            // Dummy case
                            break
                        case 'recommendGardenUpdate':
                            // Dummy case

                            break
                    }
                }
            }
            return <div style={messageStyle}>
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
                                    {stringify(toolCall.args, null, 2)}
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

    if (['human', 'ai'].includes(params.message.role || 'noRole')) return (
        <div style={messageStyle}>
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
}

export default ChatMessage