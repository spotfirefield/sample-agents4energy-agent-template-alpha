"use client"
import React, { act, useEffect, useState } from 'react';

import { generateClient } from "aws-amplify/data";
import { type Schema } from "@/../amplify/data/resource";
import { Box, Button, Card, CardActions, CardContent, Grid2 as Grid, Typography } from '@mui/material';

import { sendMessage } from '@/../utils/amplifyUtils';
import EditableTextBox from '@/components/EditableTextBox';
import ChatBoxDrawer from '@/components/ChatBoxDrawer';
import ChatBox from "@/components/ChatBox"

const amplifyClient = generateClient<Schema>();

function Page({
    params,
}: {
    params: Promise<{ chatSessionId: string }>
}) {
    const [activeChatSession, setActiveChatSession] = useState<Schema["ChatSession"]["createType"]>();

    //Query the garden
    useEffect(() => {
        const fetchChatSession = async () => {
            const chatSessionId = (await params).chatSessionId
            if (chatSessionId) {
                const { data: newChatSessionData } = await amplifyClient.models.ChatSession.get({
                    id: chatSessionId
                });
                // console.log('newGardenData: ', newGardenData)
                if (newChatSessionData) setActiveChatSession(newChatSessionData);
            }
        }
        fetchChatSession()
    }, [params]);

    if (!activeChatSession || !activeChatSession.id) {
        return <Typography variant="h6">Loading...</Typography>;
    }

    return (
        <ChatBox
            chatSessionId={activeChatSession.id}
            // initialFullScreenStatus={true}//{activeGarden && plannedSteps.length === 0}
        />
    );
}

export default Page;