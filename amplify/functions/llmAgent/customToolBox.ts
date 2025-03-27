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
    filePaths: z.array(z.string()).or(z.string()).describe("Path(s) to the CSV file(s) to plot. Can be a single file path or an array of file paths."),
    dataSeries: z.array(z.object({
        filePath: z.string().describe("The path to the CSV file for this series"),
        xAxisColumn: z.string().describe("The name of the column to use for the x-axis in this file"),
        yAxisColumn: z.string().describe("The name of the column to use for the y-axis in this file"),
        tooltipColumn: z.string().optional().describe("Optional column whose values will be shown in tooltips"),
        label: z.string().optional().describe("Custom label for this data series"),
        color: z.string().optional().describe("Optional color for this data series (hex code or named color)")
    })).optional().describe("Advanced configuration for multiple data series from different files"),
    xAxisColumn: z.string().optional().describe("The name of the column to use for the x-axis (when using a single file)"),
    yAxisColumns: z.array(z.object({
        column: z.string().describe("The name of the column to use for the y-axis"),
        tooltipColumn: z.string().optional().describe("Optional column whose values will be shown in tooltips"),
        label: z.string().optional().describe("Custom label for this data series"),
        color: z.string().optional().describe("Optional color for this data series (hex code or named color)")
    })).or(z.string()).optional().describe("The column(s) to plot on the y-axis for a single file. Can be a single column name or an array of column objects."),
    tooltipColumn: z.string().optional().describe("Optional column whose values will be shown in tooltips for all series (can be overridden per series)"),
    plotType: z.enum(["line", "scatter", "bar"]).optional().default("line").describe("The type of plot to create"),
    title: z.string().optional().describe("Optional title for the plot"),
    xAxisLabel: z.string().optional().describe("Optional label for the x-axis"),
    yAxisLabel: z.string().optional().describe("Optional label for the y-axis"),
});

export const plotDataTool = tool(
    async ({ filePaths, dataSeries, xAxisColumn, yAxisColumns, plotType = "line", title, xAxisLabel, yAxisLabel, tooltipColumn }) => {
        try {
            // Handle the case where we have dataSeries already defined (multiple files, advanced config)
            if (dataSeries && dataSeries.length > 0) {
                return await processMultipleFiles(dataSeries, plotType, title, xAxisLabel, yAxisLabel);
            }
            
            // Handle single file path or array of file paths with same column structure
            const normalizedFilePaths = Array.isArray(filePaths) ? filePaths : [filePaths];
            
            if (normalizedFilePaths.length > 1) {
                // Multiple files with same column structure
                if (!xAxisColumn || !yAxisColumns) {
                    return JSON.stringify({
                        error: "When using multiple files, you must specify xAxisColumn and yAxisColumns",
                        suggestion: "Provide both xAxisColumn and yAxisColumns parameters"
                    });
                }
                
                // Create dataSeries from multiple files
                const generatedDataSeries = normalizedFilePaths.map((filePath, index) => {
                    // For multiple files, we'll use the same column in each file
                    // but create series names based on the file names
                    const fileBaseName = filePath.split('/').pop()?.split('.')[0] || `Series ${index + 1}`;
                    
                    // If yAxisColumns is a string, use it for all files
                    if (typeof yAxisColumns === 'string') {
                        return {
                            filePath,
                            xAxisColumn,
                            yAxisColumn: yAxisColumns,
                            tooltipColumn,
                            label: fileBaseName
                        };
                    }
                    
                    // If yAxisColumns is already an array, use the first one for simplicity
                    // (advanced users should use dataSeries directly for more complex cases)
                    const yAxisColumn = Array.isArray(yAxisColumns) ? 
                        yAxisColumns[0].column : 
                        yAxisColumns;
                        
                    return {
                        filePath,
                        xAxisColumn,
                        yAxisColumn,
                        tooltipColumn,
                        label: fileBaseName
                    };
                });
                
                return await processMultipleFiles(generatedDataSeries, plotType, title, xAxisLabel, yAxisLabel);
            }
            
            // Single file case - use the original implementation
            const singleFilePath = normalizedFilePaths[0];
            return await processSingleFile(singleFilePath, xAxisColumn, yAxisColumns, plotType, title, xAxisLabel, yAxisLabel, tooltipColumn);
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
Use this tool to create plots from CSV files with support for multiple data series and multiple files.
The tool will validate file existence and column names before returning the plot configuration.

Example usage:
- Plot temperature vs time from a weather data CSV
- Compare monthly sales for multiple products in a single chart
- Visualize data from multiple CSV files in a single plot
- Display additional information in tooltips using the tooltipColumn parameter

For multiple data series from the same file:
- Provide an array of objects for yAxisColumns to plot multiple columns against the same x-axis
- Optionally specify a tooltipColumn for each series to show custom information in tooltips

For multiple data series from different files:
- Provide an array of file paths to the filePaths parameter
- OR use the dataSeries parameter for more control over how each file's data is plotted
- Use tooltipColumn to specify which column should appear in tooltips

The tool supports line, scatter, and bar plots.
`,
        schema: plotDataToolSchema,
    }
);

// Define interfaces for data structures
interface DataPoint {
    x: string;
    y: Array<{
        column: string;
        label: string;
        color?: string;
        value: string;
        tooltip?: string;
    }>;
}

interface MultiFileDataPoint {
    x: string;
    y: string;
    tooltip?: string;
}

interface SeriesConfig {
    filePath: string;
    xAxisColumn: string;
    yAxisColumn: string;
    tooltipColumn?: string;
    label?: string;
    color?: string;
}

// Helper function to process a single file
async function processSingleFile(filePath: string, xAxisColumn?: string, yAxisColumns?: any, plotType: string = "line", title?: string, xAxisLabel?: string, yAxisLabel?: string, tooltipColumn?: string) {
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
    
    // If no x-axis column specified, use the first column
    const finalXAxisColumn = xAxisColumn || headers[0];
    
    // If no y-axis columns specified, use the second column
    const finalYAxisColumns = yAxisColumns || headers.length > 1 ? headers[1] : headers[0];
    
    // Validate x-axis column
    if (!headers.includes(finalXAxisColumn)) {
        return JSON.stringify({
            error: `X-axis column "${finalXAxisColumn}" not found in file`,
            availableColumns: headers,
            suggestion: "Check the column name and try again"
        });
    }
    
    // Normalize yAxisColumns to always be an array of objects
    const normalizedYColumns = Array.isArray(finalYAxisColumns) 
        ? finalYAxisColumns 
        : [{ column: finalYAxisColumns }];
    
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
    const xIndex = headers.indexOf(finalXAxisColumn);
    const yIndices = normalizedYColumns.map(yCol => ({
        index: headers.indexOf(yCol.column),
        column: yCol.column,
        label: yCol.label || yCol.column,
        color: yCol.color,
        tooltipColumn: yCol.tooltipColumn || tooltipColumn
    }));

    // Add tooltip column indices if specified
    const tooltipIndices: { [columnName: string]: number } = {};
    
    // Process the main tooltipColumn if specified
    if (tooltipColumn && headers.includes(tooltipColumn)) {
        tooltipIndices[tooltipColumn] = headers.indexOf(tooltipColumn);
    }
    
    // Process per-series tooltip columns
    for (const yCol of normalizedYColumns) {
        if (yCol.tooltipColumn && headers.includes(yCol.tooltipColumn)) {
            tooltipIndices[yCol.tooltipColumn] = headers.indexOf(yCol.tooltipColumn);
        }
    }

    // Extract data points
    const dataRows = lines.slice(1)
        .filter((line: string) => line.trim()) // Skip empty lines
        .map((line: string) => {
            const values = line.split(',').map((v: string) => v.trim());
            
            // Extract tooltip data for each row
            const tooltipData: { [column: string]: string } = {};
            Object.entries(tooltipIndices).forEach(([column, index]) => {
                tooltipData[column] = values[index] || '';
            });
            
            return {
                x: values[xIndex],
                y: yIndices.map(y => ({ 
                    column: y.column,
                    label: y.label,
                    color: y.color,
                    value: values[y.index],
                    tooltip: y.tooltipColumn ? tooltipData[y.tooltipColumn] : undefined
                }))
            };
        }) as DataPoint[];

    // Validate data points
    if (dataRows.length === 0) {
        return JSON.stringify({
            error: "No valid data points found",
            suggestion: "Check if the CSV file contains valid data"
        });
    }

    // Extract x-axis data array
    const xAxisData = dataRows.map((p: DataPoint) => p.x);

    // Return the plot configuration with multiple series support
    return JSON.stringify({
        messageContentType: 'plot_data',
        filePath,
        plotType,
        title: title || `${normalizedYColumns.map(c => c.column).join(', ')} vs ${finalXAxisColumn}`,
        xAxis: {
            label: xAxisLabel || finalXAxisColumn,
            data: xAxisData
        },
        series: normalizedYColumns.map((col, idx) => ({
            label: col.label || col.column,
            column: col.column,
            color: col.color,
            data: dataRows.map((p: DataPoint) => p.y[idx].value),
            tooltipData: dataRows.map((p: DataPoint) => p.y[idx].tooltip),
            sourceFile: filePath,
            xData: xAxisData, // Add xData for consistency with multi-file case
            tooltipColumn: col.tooltipColumn || tooltipColumn
        })),
        xAxisColumn: finalXAxisColumn,
        yAxisColumns: normalizedYColumns,
        dataRows,
        sourceFiles: [filePath],
        tooltipColumn
    });
}

// Helper function to process multiple files
async function processMultipleFiles(dataSeries: SeriesConfig[], plotType: string = "line", title?: string, xAxisLabel?: string, yAxisLabel?: string) {
    // Array to store series data
    const allSeries: any[] = [];
    const sourceFiles: string[] = [];
    let combinedXAxisData: string[] = [];
    
    // Process each file in the dataSeries
    for (const series of dataSeries) {
        const { filePath, xAxisColumn, yAxisColumn, label, color, tooltipColumn } = series;
        
        // Read the CSV file
        const fileContent = await readFile.invoke({ filename: filePath });
        const fileData = JSON.parse(fileContent);

        if (fileData.error) {
            return JSON.stringify({
                error: `Failed to read file ${filePath}: ${fileData.error}`,
                suggestion: "Check if all files exist and are accessible"
            });
        }

        // Track source files
        if (!sourceFiles.includes(filePath)) {
            sourceFiles.push(filePath);
        }

        // Parse the CSV content
        const lines = fileData.content.split('\n');
        if (lines.length < 2) {
            return JSON.stringify({
                error: `File ${filePath} is empty or contains only headers`,
                suggestion: "Ensure all CSV files contain header and data rows"
            });
        }

        // Get column names from header
        const headers = lines[0].split(',').map((h: string) => h.trim());
        
        // Validate columns
        if (!headers.includes(xAxisColumn)) {
            return JSON.stringify({
                error: `X-axis column "${xAxisColumn}" not found in file ${filePath}`,
                availableColumns: headers,
                suggestion: "Check column names in each file"
            });
        }
        
        if (!headers.includes(yAxisColumn)) {
            return JSON.stringify({
                error: `Y-axis column "${yAxisColumn}" not found in file ${filePath}`,
                availableColumns: headers,
                suggestion: "Check column names in each file"
            });
        }

        // Validate tooltip column if specified
        if (tooltipColumn && !headers.includes(tooltipColumn)) {
            return JSON.stringify({
                error: `Tooltip column "${tooltipColumn}" not found in file ${filePath}`,
                availableColumns: headers,
                suggestion: "Check column names in each file"
            });
        }

        // Get column indices
        const xIndex = headers.indexOf(xAxisColumn);
        const yIndex = headers.indexOf(yAxisColumn);
        const tooltipIndex = tooltipColumn ? headers.indexOf(tooltipColumn) : -1;

        // Extract data points
        const dataRows = lines.slice(1)
            .filter((line: string) => line.trim()) // Skip empty lines
            .map((line: string) => {
                const values = line.split(',').map((v: string) => v.trim());
                const dataPoint: MultiFileDataPoint = {
                    x: values[xIndex],
                    y: values[yIndex]
                };
                
                // Add tooltip data if available
                if (tooltipIndex >= 0) {
                    dataPoint.tooltip = values[tooltipIndex];
                }
                
                return dataPoint;
            }) as MultiFileDataPoint[];

        // Validate data points
        if (dataRows.length === 0) {
            return JSON.stringify({
                error: `No valid data points found in file ${filePath}`,
                suggestion: "Check if the CSV files contain valid data"
            });
        }

        // Extract X axis data
        const xAxisData = dataRows.map((p: MultiFileDataPoint) => p.x);
        combinedXAxisData = [...new Set([...combinedXAxisData, ...xAxisData])];
        
        // Create the series
        allSeries.push({
            label: label || `${yAxisColumn} (${filePath.split('/').pop()})`,
            column: yAxisColumn,
            color,
            data: dataRows.map((p: MultiFileDataPoint) => p.y),
            tooltipData: dataRows.map((p: MultiFileDataPoint) => p.tooltip),
            xData: xAxisData, // Keep original x data for each series
            sourceFile: filePath,
            tooltipColumn
        });
    }

    // Sort the combined X axis data if it looks like dates or numbers
    if (combinedXAxisData.length > 0) {
        // Check if the values appear to be numbers
        const areNumbers = combinedXAxisData.every(x => !isNaN(Number(x)));
        
        if (areNumbers) {
            combinedXAxisData.sort((a, b) => Number(a) - Number(b));
        } else {
            // Try to parse as dates, if they seem to be dates
            const datePattern = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{2}$/;
            const areDates = combinedXAxisData.some(x => datePattern.test(x));
            
            if (areDates) {
                try {
                    combinedXAxisData.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
                } catch {
                    // If date parsing fails, sort alphabetically
                    combinedXAxisData.sort();
                }
            } else {
                // Default to alphabetical sort
                combinedXAxisData.sort();
            }
        }
    }

    // Default title if none provided
    const defaultTitle = dataSeries.length === 1 
        ? `${dataSeries[0].yAxisColumn} vs ${dataSeries[0].xAxisColumn}`
        : `Comparison of multiple data series`;

    // Return the plot configuration with multiple series from multiple files
    return JSON.stringify({
        messageContentType: 'plot_data',
        plotType,
        title: title || defaultTitle,
        xAxis: {
            label: xAxisLabel || dataSeries[0].xAxisColumn,
            data: combinedXAxisData
        },
        series: allSeries,
        sourceFiles,
        isMultiSource: true
    });
}