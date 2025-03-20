import { stringify } from "yaml";

import { getConfiguredAmplifyClient } from '../../../utils/amplifyUtils';

import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage, ToolMessage, BaseMessage, SystemMessage, AIMessageChunk } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { Calculator } from "@langchain/community/tools/calculator";

import { publishResponseStreamChunk } from "../graphql/mutations";

import { userInputTool, writeFile, listFiles, readFile, updateFile, setChatSessionId } from "./toolBox";
import { Schema } from '../../data/resource';

import { getLangChainChatMessagesStartingWithHumanMessage, getLangChainMessageTextContent, publishMessage, stringifyLimitStringLength } from '../../../utils/langChainUtils';
import { S3Client } from "@aws-sdk/client-s3";
import { EventEmitter } from "events";

// Increase the default max listeners to prevent warnings
EventEmitter.defaultMaxListeners = 20;

export const handler: Schema["invokeAgent"]["functionHandler"] = async (event, context) => {
    console.log('event:\n', JSON.stringify(event, null, 2))

    try {
        if (event.arguments.chatSessionId === null) throw new Error("chatSessionId is required");
        if (!event.identity) throw new Error("Event does not contain identity");
        if (!('sub' in event.identity)) throw new Error("Event does not contain user");

        // Create S3 client early as we need it for downloading files
        const s3Client = new S3Client();
        
        // Set the chat session ID for use by the S3 tools
        setChatSessionId(event.arguments.chatSessionId);
        
        // Define the S3 prefix for this chat session (needed for env vars)
        const bucketName = process.env.STORAGE_BUCKET_NAME;
        if (!bucketName) throw new Error("STORAGE_BUCKET_NAME is not set");
        
        const amplifyClient = getConfiguredAmplifyClient();

        // This function includes validation to prevent "The text field in the ContentBlock object is blank" errors
        // by ensuring no message content is empty when sent to Bedrock
        const chatSessionMessages = await getLangChainChatMessagesStartingWithHumanMessage(event.arguments.chatSessionId)

        const agentModel = new ChatBedrockConverse({
            model: process.env.MODEL_ID,
            // temperature: 0
        });

        const agentTools = [
            new Calculator(),
            // pythonInterpreterTool,
            userInputTool,
            listFiles,
            readFile,
            updateFile,
            writeFile
        ]

        const agent = createReactAgent({
            llm: agentModel,
            tools: agentTools,
        });

        let systemMessageContent = `
You are a helpful llm agent showing a demo workflow. 
If you don't have the access to the information you need, make a reasonable guess and continue the demo.
Use markdown formatting for your responses (like **bold**, *italic*, ## headings, etc.), but DO NOT wrap your response in markdown code blocks.
Today's date is ${new Date().toLocaleDateString()}.

When using the file management tools:
- The listFiles tool returns separate 'directories' and 'files' fields to clearly distinguish between them
- To access a directory, include the trailing slash in the path or use the directory name
- To read a file, use the readFile tool with the complete path including the filename
- Global files are shared across sessions and are read-only
        `//.replace(/^\s+/gm, '') //This trims the whitespace from the beginning of each line
        
        // If the chatSessionMessages ends with a human message, remove it.
        if (chatSessionMessages.length > 0 && 
            chatSessionMessages[chatSessionMessages.length - 1] instanceof HumanMessage) {
            chatSessionMessages.pop();
        }

        const input = {
            messages: [
                new SystemMessage({
                    content: systemMessageContent
                }),
                ...chatSessionMessages,
                new HumanMessage({
                    content: event.arguments.userInput || " " // Ensure user input is never empty
                })
            ].filter((message): message is BaseMessage => message !== undefined)
        }

        console.log('input:\n', stringify(input))

        const agentEventStream = agent.streamEvents(
            input,
            {
                version: "v2",
            }
        );

        let chunkIndex = 0
        for await (const streamEvent of agentEventStream) {
            switch (streamEvent.event) {
                case "on_chat_model_stream":
                    const tokenStreamChunk = streamEvent.data.chunk as AIMessageChunk
                    if (!tokenStreamChunk.content) continue
                    const chunkText = getLangChainMessageTextContent(tokenStreamChunk)
                    process.stdout.write(chunkText || "")
                    const publishChunkResponse = await amplifyClient.graphql({
                        query: publishResponseStreamChunk,
                        variables: {
                            chunkText: chunkText || "",
                            index: chunkIndex++,
                            chatSessionId: event.arguments.chatSessionId
                        }
                    })
                    // console.log('published chunk response:\n', JSON.stringify(publishChunkResponse, null, 2))
                    if (publishChunkResponse.errors) console.log('Error publishing response chunk:\n', publishChunkResponse.errors)
                    break;
                case "on_tool_end":
                case "on_chat_model_end":
                    chunkIndex = 0 //reset the stream chunk index
                    const streamChunk = streamEvent.data.output as ToolMessage | AIMessageChunk
                    console.log('received on chat model end:\n', stringifyLimitStringLength(streamChunk))
                    await publishMessage({
                        chatSessionId: event.arguments.chatSessionId,
                        owner: event.identity.sub,
                        message: streamChunk
                    })
                    break
            }
        }

    } catch (error) {
        console.error("Error responding to user:", JSON.stringify(error, null, 2));
        if (error instanceof Error) {
            throw new Error(`Error responding to user:\n${error.message}`);
        } else {
            throw new Error("Error responding to user: \nUnknown error");
        }
    }
}