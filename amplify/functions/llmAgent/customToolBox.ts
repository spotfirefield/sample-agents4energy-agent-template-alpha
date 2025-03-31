import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFile } from "./s3ToolBox";
import { AthenaClient, StartCalculationExecutionCommand, GetCalculationExecutionCommand, StartSessionCommand, GetSessionStatusCommand } from '@aws-sdk/client-athena';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

// Environment variables
const ATHENA_WORKGROUP = process.env.ATHENA_WORKGROUP_NAME || 'pyspark-workgroup';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

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

// Schema for the PySpark execution tool
const pysparkToolSchema = z.object({
    code: z.string().describe("PySpark code to execute. The 'spark' session is already initialized."),
    timeout: z.number().optional().default(300).describe("Timeout in seconds for the execution"),
    description: z.string().optional().describe("Optional description for the execution")
});

// Helper function to read a file from S3
async function readS3File(s3Uri: string): Promise<string> {
    try {
        // Parse the S3 URI - handle both s3:/ and s3:// formats
        if (!s3Uri.startsWith('s3:/')) {
            throw new Error(`Invalid S3 URI: ${s3Uri}`);
        }

        // Normalize the URI by removing the protocol part
        let uriWithoutProtocol: string;
        if (s3Uri.startsWith('s3://')) {
            uriWithoutProtocol = s3Uri.substring(5); // Remove 's3://'
        } else if (s3Uri.startsWith('s3:/')) {
            uriWithoutProtocol = s3Uri.substring(4); // Remove 's3:/'
        } else {
            throw new Error(`Unexpected S3 URI format: ${s3Uri}`);
        }
        
        const firstSlashIndex = uriWithoutProtocol.indexOf('/');
        
        if (firstSlashIndex === -1) {
            throw new Error(`Invalid S3 URI format: ${s3Uri}`);
        }
        
        const bucket = uriWithoutProtocol.substring(0, firstSlashIndex);
        const key = uriWithoutProtocol.substring(firstSlashIndex + 1);
        
        console.log(`Parsing S3 URI: ${s3Uri}`);
        console.log(`Bucket: ${bucket}, Key: ${key}`);
        
        // Create S3 client
        const s3Client = new S3Client({ region: AWS_REGION });
        
        // Get the object
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key
        });
        
        const response = await s3Client.send(command);
        
        // Convert stream to string
        if (!response.Body) {
            throw new Error('No content found in S3 object');
        }
        
        // Read the stream
        const chunks: Buffer[] = [];
        for await (const chunk of response.Body as any) {
            chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
        }
        
        return Buffer.concat(chunks).toString('utf8');
    } catch (error: any) {
        console.error(`Error reading S3 file ${s3Uri}:`, error);
        return JSON.stringify({
            error: `Error reading S3 object ${s3Uri}: ${error.message}`
        });
    }
}

export const pysparkTool = tool(
    async (params) => {
        const { code, timeout = 300, description = "PySpark execution" } = params;
        
        try {
            // Create Athena client
            const athenaClient = new AthenaClient({ region: AWS_REGION });
            
            // Start a session
            const sessionToken = uuidv4();
            const startSessionCommand = new StartSessionCommand({
                WorkGroup: ATHENA_WORKGROUP,
                Description: `Session for ${description}`,
                ClientRequestToken: sessionToken,
                EngineConfiguration: {
                    MaxConcurrentDpus: 20
                }
            });
            
            console.log(`Starting Athena session in workgroup: ${ATHENA_WORKGROUP}`);
            const sessionResponse = await athenaClient.send(startSessionCommand);
            
            if (!sessionResponse.SessionId) {
                return JSON.stringify({
                    error: "Failed to create Athena session",
                    details: "No session ID was returned"
                });
            }
            
            const sessionId = sessionResponse.SessionId;
            console.log(`Session ID: ${sessionId}`);
            
            // Wait for the session to be IDLE
            let sessionState = 'CREATING';
            let sessionAttempts = 0;
            const maxSessionAttempts = Math.ceil(timeout / 5); // Poll roughly every 5 seconds
            
            while (sessionState !== 'IDLE' && sessionState !== 'FAILED' && sessionState !== 'TERMINATED' && sessionAttempts < maxSessionAttempts) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                const getSessionStatusCommand = new GetSessionStatusCommand({
                    SessionId: sessionId
                });
                
                try {
                    const getSessionStatusResponse = await athenaClient.send(getSessionStatusCommand);
                    sessionState = getSessionStatusResponse.Status?.State || 'UNKNOWN';
                    console.log(`Current session state: ${sessionState} (Attempt ${sessionAttempts + 1}/${maxSessionAttempts})`);
                } catch (error) {
                    console.error('Error getting session status:', error);
                }
                
                sessionAttempts++;
            }
            
            if (sessionState !== 'IDLE') {
                return JSON.stringify({
                    error: "Session did not reach IDLE state",
                    state: sessionState
                });
            }
            
            // Start the calculation execution
            const clientRequestToken = uuidv4();
            const startCommand = new StartCalculationExecutionCommand({
                SessionId: sessionId,
                CodeBlock: code,
                Description: description,
                ClientRequestToken: clientRequestToken,
            });
            
            console.log('Starting PySpark calculation execution...');
            const startResponse = await athenaClient.send(startCommand);
            
            if (!startResponse.CalculationExecutionId) {
                return JSON.stringify({
                    error: "Failed to start calculation execution",
                    details: "No calculation execution ID was returned"
                });
            }
            
            const calculationId = startResponse.CalculationExecutionId;
            console.log(`Calculation execution ID: ${calculationId}`);
            
            // Poll for completion
            let finalState = 'CREATING';
            let resultData = null;
            let attempts = 0;
            const maxAttempts = Math.ceil(timeout / 5); // Poll roughly every 5 seconds
            
            while (
                finalState !== 'COMPLETED' &&
                finalState !== 'FAILED' &&
                finalState !== 'CANCELED' &&
                attempts < maxAttempts
            ) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                const getCommand = new GetCalculationExecutionCommand({
                    CalculationExecutionId: calculationId
                });
                
                try {
                    const getResponse = await athenaClient.send(getCommand);
                    finalState = getResponse.Status?.State || 'UNKNOWN';
                    
                    if (getResponse.Status?.StateChangeReason) {
                        console.log(`State change reason: ${getResponse.Status.StateChangeReason}`);
                    }
                    
                    if (getResponse.Status?.State === 'COMPLETED' && getResponse.Result) {
                        resultData = getResponse.Result;
                    }
                } catch (error) {
                    console.error('Error getting calculation status:', error);
                }
                
                console.log(`Current execution state: ${finalState} (Attempt ${attempts + 1}/${maxAttempts})`);
                attempts++;
            }
            
            // Check final state
            console.log(`Final state: ${finalState}`);
            
            if (finalState === 'COMPLETED') {
                // Get stdout content
                if (!resultData?.StdOutS3Uri) {
                    return JSON.stringify({
                        status: "COMPLETED",
                        message: "Execution completed but no output location found"
                    });
                }
                
                // Fetch the actual content from stdout
                let stdoutContent = "";
                let stderrContent = "";
                let resultContent = "";
                try {
                    // Use S3 SDK to read files directly
                    const stdoutResult = await readS3File(resultData.StdOutS3Uri);
                    
                    // Check if it's an error response
                    try {
                        const parsedStdout = JSON.parse(stdoutResult);
                        if (parsedStdout.error) {
                            console.error('Error reading stdout file:', parsedStdout.error);
                        } else {
                            stdoutContent = stdoutResult;
                        }
                    } catch {
                        // If not JSON, it's the actual content
                        stdoutContent = stdoutResult;
                    }
                    
                    // Get result content if there is any
                    if (resultData?.ResultS3Uri) {
                        const resultS3Content = await readS3File(resultData.ResultS3Uri);
                        
                        try {
                            const parsedResult = JSON.parse(resultS3Content);
                            if (parsedResult.error) {
                                console.error('Error reading result file:', parsedResult.error);
                            } else {
                                resultContent = resultS3Content;
                            }
                        } catch {
                            resultContent = resultS3Content;
                        }
                    }
                    
                    // Try to get stderr content if there is any
                    if (resultData?.StdErrorS3Uri) {
                        const stderrS3Content = await readS3File(resultData.StdErrorS3Uri);
                        
                        try {
                            const parsedStderr = JSON.parse(stderrS3Content);
                            if (parsedStderr.error) {
                                console.error('Error reading stderr file:', parsedStderr.error);
                            } else {
                                stderrContent = stderrS3Content;
                            }
                        } catch {
                            stderrContent = stderrS3Content;
                        }
                    }
                } catch (error) {
                    console.error('Error fetching calculation output:', error);
                }
                
                return JSON.stringify({
                    status: "COMPLETED",
                    output: {
                        stdout: stdoutContent,
                        result: resultContent,
                        stderr: stderrContent,
                        s3: {
                            stdout: resultData?.StdOutS3Uri,
                            result: resultData?.ResultS3Uri,
                            stderr: resultData?.StdErrorS3Uri
                        },
                        message: "PySpark execution completed successfully."
                    }
                });
            } else {
                return JSON.stringify({
                    status: finalState,
                    error: "PySpark execution did not complete successfully",
                    details: "Check logs for more information"
                });
            }
        } catch (error: any) {
            return JSON.stringify({
                error: `Error executing PySpark code: ${error.message}`,
                suggestion: "Check your code syntax and try again"
            });
        }
    },
    {
        name: "pysparkTool",
        description: `
Use this tool to execute PySpark code using AWS Athena. The tool will create an Athena session,
execute the provided PySpark code, and return the execution results.

Important notes:
- The 'spark' session is already initialized in the execution environment
- You don't need to import SparkSession or create a new session
- The code has access to common Python and PySpark libraries
- The execution results will be returned directly in the response
- S3 URLs for the full output are also provided if needed

Example usage:
- Perform data analysis using PySpark
- Create and manipulate Spark DataFrames
- Run data transformations and aggregations
- Generate visualizations from data

Simple example:
\`\`\`python
# Create a sample DataFrame
data = [("Alice", 34), ("Bob", 45), ("Charlie", 29)]
df = spark.createDataFrame(data, ["Name", "Age"])

# Show the DataFrame
print("Sample DataFrame:")
df.show()

# Perform some analysis
print("Statistics:")
df.describe().show()
\`\`\`
`,
        schema: pysparkToolSchema,
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

// Helper function to validate CSV file extension
function validateCsvFileExtension(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.csv');
}

export const plotDataTool = tool(
    async (params) => {
        const { filePaths, dataSeries, xAxisColumn, yAxisColumns, plotType = "line", title, xAxisLabel, yAxisLabel, tooltipColumn } = params
        try {
            // Check if file paths have .csv extension
            if (filePaths) {
                const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
                for (const path of paths) {
                    if (!validateCsvFileExtension(path)) {
                        return JSON.stringify({
                            error: `Invalid file extension for "${path}". Only CSV files are supported.`,
                            suggestion: "Please provide file paths ending with .csv"
                        });
                    }
                }
            }
            
            // Check dataSeries file paths if they exist
            if (dataSeries && dataSeries.length > 0) {
                for (const series of dataSeries) {
                    if (!validateCsvFileExtension(series.filePath)) {
                        return JSON.stringify({
                            error: `Invalid file extension for "${series.filePath}". Only CSV files are supported.`,
                            suggestion: "Please provide file paths ending with .csv"
                        });
                    }
                }
                
                await processMultipleFiles(dataSeries, plotType, title, xAxisLabel, yAxisLabel);
                return params;
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
                
                await processMultipleFiles(generatedDataSeries, plotType, title, xAxisLabel, yAxisLabel);
                return params;
            }
            
            // Single file case - use the original implementation
            const singleFilePath = normalizedFilePaths[0];
            await processSingleFile(singleFilePath, xAxisColumn, yAxisColumns, plotType, title, xAxisLabel, yAxisLabel, tooltipColumn);
            return params;
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
Only CSV files (with .csv extension) are supported.

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