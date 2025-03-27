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
    yAxisColumns: z.array(z.object({
        column: z.string().describe("The name of the column to use for the y-axis"),
        label: z.string().optional().describe("Custom label for this data series"),
        color: z.string().optional().describe("Optional color for this data series (hex code or named color)")
    })).or(z.string().describe("Single column name to use for the y-axis")).describe("The column(s) to plot on the y-axis. Can be a single column name or an array of column objects for multiple series."),
    plotType: z.enum(["line", "scatter", "bar"]).optional().default("line").describe("The type of plot to create"),
    title: z.string().optional().describe("Optional title for the plot"),
    xAxisLabel: z.string().optional().describe("Optional label for the x-axis"),
    yAxisLabel: z.string().optional().describe("Optional label for the y-axis"),
});

export const plotDataTool = tool(
    async ({ filePath, xAxisColumn, yAxisColumns, plotType = "line", title, xAxisLabel, yAxisLabel }) => {
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
            
            // Validate x-axis column
            if (!headers.includes(xAxisColumn)) {
                return JSON.stringify({
                    error: `X-axis column "${xAxisColumn}" not found in file`,
                    availableColumns: headers,
                    suggestion: "Check the column name and try again"
                });
            }
            
            // Normalize yAxisColumns to always be an array of objects
            const normalizedYColumns = Array.isArray(yAxisColumns) 
                ? yAxisColumns 
                : [{ column: yAxisColumns }];
            
            // Validate y-axis columns
            for (const yCol of normalizedYColumns) {
                if (!headers.includes(yCol.column)) {
                    return JSON.stringify({
                        error: `Y-axis column "${yCol.column}" not found in file`,
                        availableColumns: headers,
                        suggestion: "Check the column name and try again"
                    });
                }
            }

            // Get column indices
            const xIndex = headers.indexOf(xAxisColumn);
            const yIndices = normalizedYColumns.map(yCol => ({
                index: headers.indexOf(yCol.column),
                column: yCol.column,
                label: yCol.label || yCol.column,
                color: yCol.color
            }));

            // Extract data points
            const dataRows = lines.slice(1)
                .filter((line: string) => line.trim()) // Skip empty lines
                .map((line: string) => {
                    const values = line.split(',').map((v: string) => v.trim());
                    return {
                        x: values[xIndex],
                        y: yIndices.map(y => ({ 
                            column: y.column,
                            label: y.label,
                            color: y.color,
                            value: values[y.index] 
                        }))
                    };
                });

            // Validate data points
            if (dataRows.length === 0) {
                return JSON.stringify({
                    error: "No valid data points found",
                    suggestion: "Check if the CSV file contains valid data"
                });
            }

            // Return the plot configuration with multiple series support
            return JSON.stringify({
                messageContentType: 'plot_data',
                filePath,
                plotType,
                title: title || `${normalizedYColumns.map(c => c.column).join(', ')} vs ${xAxisColumn}`,
                xAxis: {
                    label: xAxisLabel || xAxisColumn,
                    data: dataRows.map((p: any) => p.x)
                },
                series: normalizedYColumns.map((col, idx) => ({
                    label: col.label || col.column,
                    column: col.column,
                    color: col.color,
                    data: dataRows.map((p: any) => p.y[idx].value)
                })),
                xAxisColumn,
                yAxisColumns: normalizedYColumns,
                dataRows
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
Use this tool to create plots from CSV files with support for multiple data series.
The tool will validate the file existence and column names before returning the plot configuration.
If the file or columns don't exist, it will return an error message with suggestions.

Example usage:
- Plot temperature vs time from a weather data CSV
- Create a scatter plot of sales vs advertising spend
- Generate a bar chart of monthly revenue comparing different products

For multiple data series, provide an array of objects for yAxisColumns:
- Plot energy production, consumption, and efficiency against time
- Compare monthly sales for multiple products in a single chart
- Visualize temperature variations across different locations

The tool supports line, scatter, and bar plots.
`,
        schema: plotDataToolSchema,
    }
);