import { tool } from "@langchain/core/tools";
import { z } from "zod";

const userInputToolSchema = z.object({
    title: z.string(),
    description: z.string(),
    buttonTextBeforeClick: z.string(),
    buttonTextAfterClick: z.string(),
})

export const userInputTool = tool(
    async (userInputToolArgs) => {

        return {
            ...userInputToolArgs,
        }
    },
    {
        name: "userInputTool",
        description: `
Give the user a tool to act on the information you provided. 
The action should be external to the chat, like sending an email or adding an item to a work management system.
The tool can't be used to return any new information to the user. It should only propose actions that the user can take.
`,
        schema: userInputToolSchema,
    }
);
