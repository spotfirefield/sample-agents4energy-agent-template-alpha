"use client"
import React, { useEffect, useState } from 'react';

import { generateClient } from "aws-amplify/data";
import { type Schema } from "@/../amplify/data/resource";
import { Box, Typography } from '@mui/material';

import ChatBox from "@/components/ChatBox"
import EditableTextBox from '@/components/EditableTextBox';

const amplifyClient = generateClient<Schema>();

function Page({
    params,
}: {
    params: Promise<{ chatSessionId: string }>
}) {
    const [activeChatSession, setActiveChatSession] = useState<Schema["ChatSession"]["createType"]>();

    const setActiveChatSessionAndUpload = async (newChatSession: Schema["ChatSession"]["createType"]) => {
        
        const {data: updatedChatSession} = await amplifyClient.models.ChatSession.update({
            id: (await params).chatSessionId,
            ...newChatSession
        });

        if (updatedChatSession) setActiveChatSession(updatedChatSession);
    }

    //Get the chat session info
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
        <>
            <EditableTextBox
                object={activeChatSession}
                fieldPath="name"
                onUpdate={setActiveChatSessionAndUpload}
                typographyVariant="h3"
            />
            <Box sx={{ 
                height: 'calc(100vh - 150px)', 
                maxHeight: 'calc(100vh - 150px)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'auto'
            }}>
            <ChatBox
                chatSessionId={activeChatSession.id}
            />
            </Box>
            
        </>

    );
}

export default Page;