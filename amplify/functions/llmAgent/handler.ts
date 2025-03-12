import { stringify } from "yaml";

import { getConfiguredAmplifyClient } from '../../../utils/amplifyUtils';
// import { getWeatherForecast, geocode } from '../../../utils/weather';

import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage, AIMessage, ToolMessage, BaseMessage, MessageContentText, SystemMessage, AIMessageChunk } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { Calculator } from "@langchain/community/tools/calculator";

// import { listPlannedSteps } from '../../../utils/graphqlStatements'
// import { createGarden, updateGarden } from '../graphql/mutations';
// import { getGarden, getPlannedStep } from '../graphql/queries';
import { publishResponseStreamChunk } from "../graphql/mutations";
// import { CreateGardenInput, UpdateGardenInput } from "../graphql/API";

import { Schema } from '../../data/resource';

// import { generateGarden } from '../../../utils/amplifyStrucutedOutputs';
import { getLangChainMessageTextContent, publishMessage, stringifyLimitStringLength } from '../../../utils/langChainUtils';
// import { createGardenInfoToolBuilder, createGardenPlanToolBuilder } from "./toolBox";

// import { plantSpacing } from '../../../src/constants/plantSpacing'

export const handler: Schema["invokeAgent"]["functionHandler"] = async (event, context) => {
    console.log('event:\n', JSON.stringify(event, null, 2))

    try {
        if (event.arguments.chatSessionId === null) throw new Error("chatSessionId is required");
        if (!event.identity) throw new Error("Event does not contain identity");
        if (!('sub' in event.identity)) throw new Error("Event does not contain user");

        const amplifyClient = getConfiguredAmplifyClient();

        const agentModel = new ChatBedrockConverse({
            model: process.env.MODEL_ID,
            // temperature: 0
        });

        const agentTools = [
            new Calculator(),
            // createGardenInfoToolBuilder({ gardenId: event.arguments.gardenId }),
            // createGardenPlanToolBuilder({ gardenId: event.arguments.gardenId, owner: event.identity.sub })
        ]

        const agent = createReactAgent({
            llm: agentModel,
            tools: agentTools,
        });

        let systemMessageContent = `
You are a helpful llm agent.
Response chat message text content should be in markdown format.
Today's date is ${new Date().toLocaleDateString()}.
        `//.replace(/^\s+/gm, '') //This trims the whitespace from the beginning of each line

        const input = {
            messages: [
                new SystemMessage({
                    content: systemMessageContent
                }),
                new HumanMessage({
                    content: event.arguments.userInput
                })
            ]
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
        console.error("Error generating garden / steps:", JSON.stringify(error, null, 2));
        if (error instanceof Error) {
            throw new Error(`Failed to generate garden / steps.\n${error.message}`);
        } else {
            throw new Error("Failed to generate garden / steps.\nUnknown error");
        }
    }
}