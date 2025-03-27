import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFile } from "./s3ToolBox";

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
Use this tool to send emails or add items to a work management system.
The messages should never request information.
They should only inform someone besides the user about an action they should take (including to review an item from the chat).
`,
        schema: userInputToolSchema,
    }
);

// Schema for plot data tool
const plotDataToolSchema = z.object({
    filePath: z.string().describe("The path to the CSV file to plot"),
    xAxisColumn: z.string().describe("The name of the column to use for the x-axis"),
    yAxisColumn: z.string().describe("The name of the column to use for the y-axis"),
    plotType: z.enum(["line", "scatter", "bar"]).optional().default("line").describe("The type of plot to create"),
    title: z.string().optional().describe("Optional title for the plot"),
    xAxisLabel: z.string().optional().describe("Optional label for the x-axis"),
    yAxisLabel: z.string().optional().describe("Optional label for the y-axis"),
});

export const plotDataTool = tool(
    async ({ filePath, xAxisColumn, yAxisColumn, plotType = "line", title, xAxisLabel, yAxisLabel }) => {
        try {
            // Read the CSV file
            const fileContent = await readFile.invoke({ filename: filePath });
            const fileData = JSON.parse(fileContent);

            if (fileData.error) {
                return JSON.stringify({
                    error: `Failed to read file: ${fileData.error}`,
                    suggestion: "Check if the file exists and is accessible"
                });
            }

            // Parse the CSV content
            const lines = fileData.content.split('\n');
            if (lines.length < 2) {
                return JSON.stringify({
                    error: "File is empty or has no data rows",
                    suggestion: "Ensure the CSV file contains header and data rows"
                });
            }

            // Get column names from header
            const headers = lines[0].split(',').map((h: string) => h.trim());
            
            // Validate column names
            if (!headers.includes(xAxisColumn)) {
                return JSON.stringify({
                    error: `X-axis column "${xAxisColumn}" not found in file`,
                    availableColumns: headers,
                    suggestion: "Check the column name and try again"
                });
            }
            
            if (!headers.includes(yAxisColumn)) {
                return JSON.stringify({
                    error: `Y-axis column "${yAxisColumn}" not found in file`,
                    availableColumns: headers,
                    suggestion: "Check the column name and try again"
                });
            }

            // Get column indices
            const xIndex = headers.indexOf(xAxisColumn);
            const yIndex = headers.indexOf(yAxisColumn);

            // Extract data points
            const dataPoints = lines.slice(1)
                .filter((line: string) => line.trim()) // Skip empty lines
                .map((line: string) => {
                    const values = line.split(',').map((v: string) => v.trim());
                    return {
                        x: values[xIndex],
                        y: values[yIndex]
                    };
                });

            // Validate data points
            if (dataPoints.length === 0) {
                return JSON.stringify({
                    error: "No valid data points found",
                    suggestion: "Check if the CSV file contains valid data"
                });
            }

            // Return the plot configuration
            return JSON.stringify({
                messageContentType: 'plot_data',
                filePath,
                plotType,
                title: title || `Plot of ${yAxisColumn} vs ${xAxisColumn}`,
                xAxis: {
                    label: xAxisLabel || xAxisColumn,
                    data: dataPoints.map((p: { x: string; y: string }) => p.x)
                },
                yAxis: {
                    label: yAxisLabel || yAxisColumn,
                    data: dataPoints.map((p: { x: string; y: string }) => p.y)
                },
                dataPoints
            });
        } catch (error: any) {
            return JSON.stringify({
                error: `Error processing plot data: ${error.message}`,
                suggestion: "Check the file format and column names"
            });
        }
    },
    {
        name: "plotDataTool",
        description: `
Use this tool to create plots from CSV files.
The tool will validate the file existence and column names before returning the plot configuration.
If the file or columns don't exist, it will return an error message with suggestions.

Example usage:
- Plot temperature vs time from a weather data CSV
- Create a scatter plot of sales vs advertising spend
- Generate a bar chart of monthly revenue

The tool supports line, scatter, and bar plots.
`,
        schema: plotDataToolSchema,
    }
);