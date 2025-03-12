import {
    Box,
    Button,
    Card,
    CardContent,
    Typography,
    Grid2 as Grid,
    // Paper
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { z } from "zod";

import { generateClient } from "aws-amplify/data";
import { type Schema } from "@/../amplify/data/resource";

import { Message } from '@/../utils/types';
// import { createGardenType, plannedStepArrayType } from '../../utils/types';

// import { MuiMarkdown } from 'mui-markdown';
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const amplifyClient = generateClient<Schema>();

const ChatMessage = (params: {
    message: Message,
    // setChatSession: (newGarden: Schema["ChatSession"]["createType"]) => void,
    // setPlannedSteps: (newPlannedSteps: PlannedSteps) => void
}) => {
    //Render either ai or human messages based on the params.message.role

    const theme = useTheme();

    let messageStyle = {};

    // let proposedGarden: z.infer<typeof createGardenType>
    let proposedGarden: Schema["ChatSession"]["createType"] = {}
    // const proposedSteps: PlannedSteps = []

    switch (params.message.role) {
        case 'ai':
            messageStyle = {
                backgroundColor: theme.palette.grey[200],
                padding: theme.spacing(1),
                borderRadius: theme.shape.borderRadius,
            };
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
        case 'tool':
            
            break;
        case 'human':
            messageStyle = {
                backgroundColor: theme.palette.primary.light,
                color: theme.palette.primary.contrastText,
                padding: theme.spacing(1),
                borderRadius: theme.shape.borderRadius,
            };
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