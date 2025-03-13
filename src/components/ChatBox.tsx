import React, { useState, useEffect, useCallback } from 'react';
import { Box, TextField, Button, List, ListItem, Typography } from '@mui/material';


import { combineAndSortMessages, sendMessage } from '../../utils/amplifyUtils';
import { Message } from '../../utils/types';

import ChatMessage from './ChatMessage';

import { defaultPrompts } from '@/constants/defaultPrompts';

import { generateClient } from "aws-amplify/data";
import { type Schema } from "@/../amplify/data/resource";
const amplifyClient = generateClient<Schema>();

const ChatBox = (params: {
  chatSessionId: string,
}) => {

  const [messages, setMessages] = useState<Message[]>([]);
  const [, setResponseStreamChunks] = useState<(Schema["recieveResponseStreamChunk"]["returnType"] | null)[]>([]);
  const [streamChunkMessage, setStreamChunkMessage] = useState<Message>();
  const [userInput, setUserInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  //Subscribe to the chat messages for the garden
  useEffect(() => {
    const messageSubscriptionHandler = async () => {
      console.log('Creating message subscription for garden: ', params.chatSessionId)
      const messagesSub = amplifyClient.models.ChatMessage.observeQuery({
        filter: {
          chatSessionId: { eq: params.chatSessionId }
        }
      }).subscribe({
        next: ({ items }) => {
          // console.log('Received new messages: ', items)
          //If any of the items have the isResposeComplete flag set to true, set isLoading to false
          // const isResponseComplete = items.some((message) => message.responseComplete)
          // if (isResponseComplete) setIsLoading(false)
          setMessages((prevMessages) => {
            const sortedMessages = combineAndSortMessages(prevMessages, items)
            if (sortedMessages[sortedMessages.length - 1] && sortedMessages[sortedMessages.length - 1].responseComplete) {
              setIsLoading(false)
            }
            // else {
            //   setIsLoading(true)
            // }
            console.log('sortedMessages: ', sortedMessages)
            return sortedMessages
          })
          setStreamChunkMessage(undefined)
          setResponseStreamChunks([])
        }
      })

      return () => {
        messagesSub.unsubscribe();
      };

    }

    messageSubscriptionHandler()

  }, [params.chatSessionId])

  //Subscribe to the response stream chunks for the garden
  useEffect(() => {
    const responseStreamChunkSubscriptionHandler = async () => {
      console.log('Creating response stream chunk subscription for garden: ', params.chatSessionId)
      const responseStreamChunkSub = amplifyClient.subscriptions.recieveResponseStreamChunk({ chatSessionId: params.chatSessionId }).subscribe({
        error: (error) => console.error('Error subscribing stream chunks: ', error),
        next: (newChunk) => {
          // console.log('Received new response stream chunk: ', newChunk)
          setResponseStreamChunks((prevChunks) => {
            //Now Insert the new chunk into the correct position in the array
            if (newChunk.index >= 0 && newChunk.index < prevChunks.length) {
              prevChunks[newChunk.index] = newChunk;
            } else {
              // Extend the list with nulls up to the specified index
              while (prevChunks.length < newChunk.index) {
                prevChunks.push(null)
              }
              prevChunks.push(newChunk)
            }

            //Only set the chunk message if the inital chunk is defined. This prevents the race condition between the message and the chunk
            if (prevChunks[0]) {
              setStreamChunkMessage({
                id: 'streamChunkMessage',
                role: 'ai',
                content: {
                  text: prevChunks.map((chunk) => chunk?.chunkText).join("")
                },
                createdAt: new Date().toISOString()
              })
            }

            return prevChunks
          })
        }
      })

      return () => {
        responseStreamChunkSub.unsubscribe();
      };

    }

    responseStreamChunkSubscriptionHandler()
  }, [params.chatSessionId])



  const handleSend = useCallback(async (userMessage: string) => {
    if (userMessage.trim()) {
      setIsLoading(true);

      const newMessage: Schema['ChatMessage']['createType'] = {
        role: 'human',
        content: {
          text: userMessage
        },
        chatSessionId: params.chatSessionId
      }

      const { newMessageData } = await sendMessage({
        chatSessionId: params.chatSessionId,
        newMessage: newMessage
      })

      // const { data: newMessageData } = await amplifyClient.models.ChatMessage.create(newMessage)
      if (newMessageData) setMessages([...messages, {
        ...newMessage,
        id: newMessageData.id,
        createdAt: newMessageData.createdAt
      }]);

      // const invokeResponse = await amplifyClient.queries.generateGarden({
      //   chatSessionId: params.chatSessionId,
      //   userInput: userInput
      // })

      // console.log('invokeResponse: ', invokeResponse)

      setUserInput('');
    }
  }, [messages, params.chatSessionId]);

  return (
    <Box sx={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'hidden'
    }}>
      <Box sx={{
        flex: 1,
        overflowY: 'auto',
        flexDirection: 'column-reverse',
        display: 'flex',
        mb: 2
      }}>
        <List>
          {[
            ...messages,
            ...(streamChunkMessage ? [streamChunkMessage] : [])
          ].map((message) => (
            <ListItem key={message.id}>
              <ChatMessage
                message={message}
                // setPlannedSteps={params.setPlannedSteps}
                // setGarden={params.setGarden}
              />
            </ListItem>
          ))}
        </List>
      </Box>
      {isLoading && <Box sx={{ textAlign: 'center', margin: '8px 0' }}>Loading...</Box>}
      {messages.length === 0 &&
        <Box sx={{ textAlign: 'center', margin: '8px 0' }}>
          <Typography variant="body2">Tell me about your dream garden</Typography>
          <List>
            {defaultPrompts.map((prompt, index) => (
              <ListItem key={index}>
                <Button
                  onClick={() => handleSend(prompt)}
                >
                  {prompt}
                </Button>
              </ListItem>
            ))}
          </List>
        </Box>
      }
      <Box sx={{ mt: 'auto' }}>
        <TextField
          fullWidth
          multiline
          variant="outlined"
          placeholder="Type a message..."
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              handleSend(userInput);
            }
          }}
          disabled={isLoading}
        />
        <Button variant="contained" color="primary" onClick={() => handleSend(userInput)} sx={{ marginTop: '8px', width: '100%' }}>
          Send
        </Button>
      </Box>
    </Box>
  );
};

export default ChatBox;