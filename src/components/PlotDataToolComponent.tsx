import React, { useMemo } from 'react';
import { Theme } from '@mui/material/styles';
import { Typography, CircularProgress } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, LogarithmicScale, ChartOptions } from 'chart.js';
import { Line, Bar, Scatter } from 'react-chartjs-2';
import { getUrl } from 'aws-amplify/storage';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

// Import Message type for content prop
import { Message } from '@/../utils/types';

// Declare a more specific type for the series data
interface SeriesData {
    label: string;
    column: string;
    color?: string;
    data: string[];
    sourceFile?: string;
    xData?: string[]; // For multi-file datasets
    tooltipData?: string[]; // Custom tooltip data
    tooltipColumn?: string; // Name of column used for tooltips
}

export const PlotDataToolComponent = ({ content, theme, chatSessionId }: { 
    content: Message['content'], 
    theme: Theme,
    chatSessionId: string
}) => {
    const [plotData, setPlotData] = React.useState<{
        messageContentType?: string;
        filePath?: string;
        plotType?: 'line' | 'scatter' | 'bar';
        title?: string;
        xAxis?: { label?: string; data?: string[] };
        series?: Array<SeriesData>;
        xAxisColumn?: string;
        yAxisColumns?: Array<{
            column: string;
            label?: string;
            color?: string;
            tooltipColumn?: string;
        }>;
        dataRows?: Array<any>;
        error?: string;
        suggestion?: string;
        availableColumns?: string[];
        isMultiSource?: boolean;
        sourceFiles?: string[];
        tooltipColumn?: string;
    } | null>(null);
    const [error, setError] = React.useState<boolean>(false);
    const [errorMessage, setErrorMessage] = React.useState<string>('');
    const [csvData, setCsvData] = React.useState<Array<{ [key: string]: string }> | null>(null);
    const [loading, setLoading] = React.useState(false);
    
    // Get array of standard colors to use for series
    const seriesColors = React.useMemo(() => [
        theme.palette.primary.main,
        theme.palette.secondary.main,
        '#FF5722', // deep orange
        '#2196F3', // blue
        '#4CAF50', // green
        '#9C27B0', // purple
        '#FFC107', // amber
        '#795548', // brown
        '#00BCD4', // cyan
        '#E91E63', // pink
        '#673AB7', // deep purple
        '#CDDC39'  // lime
    ], [theme]);

    // Parse the plot data when the component mounts or content changes
    React.useEffect(() => {
        try {
            const parsedData = JSON.parse(content?.text || '{}');
            console.log('Parsed plot data:', parsedData);
            setPlotData(parsedData);
            setError(false);
            setErrorMessage('');
        } catch (e: any) {
            console.error('Error parsing plot data:', e);
            setPlotData(null);
            setError(true);
            setErrorMessage(`Error parsing plot data: ${e.message || 'Unknown error'}`);
        }
    }, [content]);

    // Function to manually parse CSV data from the file content
    const parseCSV = React.useCallback((fileContent: string) => {
        try {
            // Split into lines and remove empty lines
            const lines = fileContent.trim().split('\n');
            
            if (lines.length <= 1) {
                throw new Error('CSV file is empty or contains only headers');
            }
            
            // Extract headers
            const headers = lines[0].split(',').map(h => h.trim());
            
            // Process all rows
            const rows = lines.slice(1).map(line => {
                const values = line.split(',').map(v => v.trim());
                const row: { [key: string]: string } = {};
                
                // Map each value to its column header
                headers.forEach((header, index) => {
                    row[header] = values[index] || '';
                });
                
                return row;
            });
            
            return { headers, rows };
        } catch (error: any) {
            throw new Error(`Failed to parse CSV: ${error.message}`);
        }
    }, []);

    // Process the data when plotData is updated
    React.useEffect(() => {
        if (!plotData?.filePath) return;

        const processData = async () => {
            setLoading(true);
            try {
                // Get file content directly from HTML instead of fetching
                const fileContentEl = document.querySelector(`.file-content[data-file="${plotData.filePath}"]`);
                if (fileContentEl) {
                    const fileContent = fileContentEl.textContent || '';
                    if (!fileContent) {
                        throw new Error('Empty file content');
                    }

                    // Parse CSV data
                    const { headers, rows } = parseCSV(fileContent);
                    setCsvData(rows);
                    console.log('Parsed CSV data from DOM:', rows);
                } else {
                    // Fall back to using the data already in plotData.series
                    if (plotData.series && plotData.series.length > 0) {
                        console.log('Using pre-parsed data from plotData');
                        setCsvData([]); // Just set to empty array to indicate success
                    } else {
                        throw new Error('Cannot find file content in the DOM and no pre-parsed data available');
                    }
                }
            } catch (error: any) {
                console.error('Error processing data:', error);
                setError(true);
                setErrorMessage(`Error processing data: ${error.message}`);
            } finally {
                setLoading(false);
            }
        };

        processData();
    }, [plotData, parseCSV]);

    // Declare a type for chart dataset
    interface ChartDataset {
        label: string;
        data: (number | null)[];
        backgroundColor: string;
        borderColor: string;
        borderWidth: number;
        pointBackgroundColor: string;
        tension: number;
        yAxisID?: string; // Add yAxisID property for multi-axis support
        sourceFile?: string;
        spanGaps?: boolean;
        tooltipData?: string[];
        tooltipColumn?: string;
    }

    // Prepare chart data from multiple sources or direct data
    const chartData = React.useMemo(() => {
        // If we have csvData and need to extract specific columns
        if (csvData && plotData?.xAxisColumn && plotData.yAxisColumns && plotData.yAxisColumns.length > 0) {
            const xValues = csvData.map(row => row[plotData.xAxisColumn || ''] || '');
            
            // Print sample of the CSV data for debugging
            console.log('CSV data sample:', csvData.slice(0, 2));
            console.log('Available columns in CSV:', csvData.length > 0 ? Object.keys(csvData[0]) : []);
            
            console.log('Creating chart with columns:', { 
                xAxisColumn: plotData.xAxisColumn, 
                yAxisColumns: plotData.yAxisColumns,
                xValuesCount: xValues.length,
                csvDataCount: csvData.length
            });
            
            const datasets = plotData.yAxisColumns.map((col, index) => {
                // Check if the column actually exists in the data
                const columnExists = csvData.length > 0 && col.column in csvData[0];
                if (!columnExists) {
                    console.warn(`Column "${col.column}" not found in CSV data. Available columns:`, 
                        csvData.length > 0 ? Object.keys(csvData[0]) : []);
                }
                
                const dataPoints = csvData.map(row => {
                    // Get the numeric value, parse it correctly
                    const rawValue = row[col.column];
                    if (rawValue === undefined) {
                        console.warn(`Value for column "${col.column}" is undefined in row:`, row);
                        return 0;
                    }
                    const value = parseFloat(rawValue);
                    return isNaN(value) ? 0 : value;
                });
                
                console.log(`Column data for "${col.column}":`, { 
                    label: col.label, 
                    dataPoints: dataPoints.slice(0, 5), // Just show first 5 for debugging
                    columnName: col.column,
                    exists: columnExists
                });
                
                return {
                    label: col.label || col.column,
                    data: dataPoints,
                    backgroundColor: col.color || seriesColors[index % seriesColors.length] + '66',
                    borderColor: col.color || seriesColors[index % seriesColors.length],
                    borderWidth: 2,
                    pointBackgroundColor: col.color || seriesColors[index % seriesColors.length],
                    tension: 0.1,
                    // Set the Y axis ID for this dataset - first dataset uses left axis, others use right
                    yAxisID: index === 0 ? 'y' : 'y1'
                };
            });
            
            return {
                labels: xValues,
                datasets: datasets
            };
        }
        
        // If we have plotData with series already prepared
        if (plotData?.series && plotData.xAxis?.data) {
            // Check if this is multi-file data
            if (plotData.isMultiSource) {
                // For multi-file data, we need to map each series to the common x-axis
                const commonXLabels = plotData.xAxis.data;
                
                return {
                    labels: commonXLabels,
                    datasets: plotData.series.map((series, index) => {
                        // For each x value in the common axis, find the corresponding y value from this series
                        // or use null if no match (to create gaps in the line)
                        const alignedData = commonXLabels.map(xValue => {
                            // Find the index of this x value in the series' original x data
                            if (!series.xData) {
                                return null;
                            }
                            const seriesIndex = series.xData.findIndex((x: string) => x === xValue);
                            // Return the y value if found, or null if not
                            return seriesIndex >= 0 ? Number(series.data[seriesIndex]) || 0 : null;
                        });
                        
                        // Also align tooltip data to the common x-axis
                        const alignedTooltipData = commonXLabels.map(xValue => {
                            if (!series.xData || !series.tooltipData) {
                                return undefined;
                            }
                            const seriesIndex = series.xData.findIndex((x: string) => x === xValue);
                            return seriesIndex >= 0 ? series.tooltipData[seriesIndex] : undefined;
                        });
                        
                        return {
                            label: series.label || `Series ${index + 1}`,
                            data: alignedData,
                            backgroundColor: series.color || seriesColors[index % seriesColors.length] + '66', // Add transparency
                            borderColor: series.color || seriesColors[index % seriesColors.length],
                            borderWidth: 2,
                            pointBackgroundColor: series.color || seriesColors[index % seriesColors.length],
                            tension: 0.1,
                            // Allow gaps in line for missing data points
                            spanGaps: true,
                            // Show source file in tooltip
                            sourceFile: series.sourceFile,
                            tooltipData: alignedTooltipData,
                            tooltipColumn: series.tooltipColumn
                        };
                    })
                };
            }
            
            // Single file with multiple series
            return {
                labels: plotData.xAxis.data,
                datasets: plotData.series.map((series, index) => ({
                    label: series.label,
                    data: series.data.map(y => Number(y) || 0),
                    backgroundColor: series.color || seriesColors[index % seriesColors.length] + '66', // Add transparency
                    borderColor: series.color || seriesColors[index % seriesColors.length],
                    borderWidth: 2,
                    pointBackgroundColor: series.color || seriesColors[index % seriesColors.length],
                    tension: 0.1,
                    sourceFile: series.sourceFile,
                    tooltipData: series.tooltipData,
                    tooltipColumn: series.tooltipColumn
                }))
            };
        }
        
        // Default empty data
        return {
            labels: [],
            datasets: []
        };
    }, [plotData, csvData, seriesColors]);

    // Update chart options to show custom tooltips
    const chartOptions = React.useMemo(() => {
        // Determine if we need dual y-axes
        const needsDualAxes = chartData.datasets && chartData.datasets.length > 1;
        
        console.log('Chart needs dual axes:', needsDualAxes, 'with datasets:', chartData.datasets?.length);
        
        const options: any = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top' as const,
                    display: true, // Always show legend when there are multiple series
                },
                title: {
                    display: true,
                    text: plotData?.title || 'Data Plot',
                    font: {
                        size: 16,
                        weight: 'bold' as const
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: theme.palette.grey[800],
                    titleFont: {
                        size: 14
                    },
                    bodyFont: {
                        size: 13
                    },
                    padding: 10,
                    cornerRadius: 4,
                    callbacks: {
                        afterBody: (tooltipItems: any[]) => {
                            const item = tooltipItems[0];
                            if (!item) return '';
                            
                            const dataset = chartData.datasets[item.datasetIndex] as ChartDataset;
                            const tooltipLines = [];
                            
                            // Show source file information if available
                            if (dataset.sourceFile) {
                                tooltipLines.push(`Source: ${dataset.sourceFile.split('/').pop()}`);
                            }
                            
                            // Show custom tooltip data if available
                            if (dataset.tooltipData && dataset.tooltipData[item.dataIndex]) {
                                const tooltipValue = dataset.tooltipData[item.dataIndex];
                                const tooltipLabel = dataset.tooltipColumn || 'Info';
                                tooltipLines.push(`${tooltipLabel}: ${tooltipValue}`);
                            }
                            
                            return tooltipLines.join('\n');
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: plotData?.xAxis?.label || 'X',
                        font: {
                            size: 14,
                            weight: 'bold' as const
                        }
                    },
                    grid: {
                        display: true,
                        color: theme.palette.grey[200]
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: needsDualAxes && plotData?.yAxisColumns && plotData.yAxisColumns.length > 0
                            ? (plotData.yAxisColumns[0].label || plotData.yAxisColumns[0].column)
                            : 'Value',
                        font: {
                            size: 14,
                            weight: 'bold' as const
                        }
                    },
                    grid: {
                        display: true,
                        color: theme.palette.grey[200]
                    }
                }
            }
        };
        
        // Add right y-axis if we need dual axes
        if (needsDualAxes && plotData?.yAxisColumns && plotData.yAxisColumns.length > 1) {
            options.scales.y1 = {
                type: 'linear',
                display: true,
                position: 'right',
                title: {
                    display: true,
                    text: plotData.yAxisColumns[1].label || plotData.yAxisColumns[1].column,
                    font: {
                        size: 14,
                        weight: 'bold' as const
                    }
                },
                grid: {
                    drawOnChartArea: false // only want the grid lines for one axis to show up
                },
            };
            
            console.log('Added secondary Y axis for:', plotData.yAxisColumns[1].column);
        } else {
            console.log('No secondary Y axis needed');
        }
        
        return options;
    }, [plotData, theme, chartData.datasets?.length, chartData.datasets]);

    // Render the appropriate chart based on plotType
    const renderChart = () => {
        // Ensure we have data to display
        const hasData = (chartData.labels.length > 0 && chartData.datasets.length > 0 && chartData.datasets[0].data.length > 0);
        
        if (!hasData) {
            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100%',
                    color: theme.palette.text.secondary
                }}>
                    <Typography variant="body1" gutterBottom>
                        No data to display
                    </Typography>
                    <Typography variant="caption">
                        Data structure received: {JSON.stringify({
                            series: plotData?.series?.length || 0,
                            xAxis: plotData?.xAxis?.data?.length || 0,
                            csvData: csvData?.length || 0,
                            filePath: plotData?.filePath
                        })}
                    </Typography>
                </div>
            );
        }
        
        switch (plotData?.plotType) {
            case 'bar':
                return <Bar data={chartData} options={chartOptions} />;
            case 'scatter':
                return <Scatter data={chartData} options={chartOptions} />;
            case 'line':
            default:
                return <Line data={chartData} options={chartOptions} />;
        }
    };

    // If there's an error processing the plot data
    if (error || !plotData) {
        return (
            <div style={{ 
                backgroundColor: theme.palette.error.light,
                color: theme.palette.error.contrastText,
                padding: theme.spacing(2),
                borderRadius: theme.shape.borderRadius,
                margin: theme.spacing(1, 0)
            }}>
                <Typography variant="subtitle2" fontWeight="bold">
                    Error processing plot data
                </Typography>
                
                {errorMessage && (
                    <Typography variant="body2" style={{ marginTop: theme.spacing(1), marginBottom: theme.spacing(1) }}>
                        {errorMessage}
                    </Typography>
                )}
                
                <div style={{
                    backgroundColor: 'rgba(0,0,0,0.05)',
                    padding: theme.spacing(1.5),
                    borderRadius: theme.shape.borderRadius,
                    maxHeight: '200px',
                    overflow: 'auto'
                }}>
                    <Typography variant="caption" component="div">
                        <strong>Debug information:</strong>
                    </Typography>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', margin: theme.spacing(0.5, 0, 0, 0) }}>
                        Raw content: {content?.text}
                    </pre>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', margin: theme.spacing(0.5, 0, 0, 0) }}>
                        Plot data: {plotData ? JSON.stringify(plotData, null, 2) : 'null'}
                    </pre>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', margin: theme.spacing(0.5, 0, 0, 0) }}>
                        CSV data: {csvData ? `${csvData.length} rows` : 'null'}
                    </pre>
                </div>
                
                <Typography variant="caption" color="textSecondary" style={{ marginTop: theme.spacing(1), display: 'block' }}>
                    Try reloading the page or check the console for more details.
                </Typography>
            </div>
        );
    }

    // If there's an error in the data itself
    if (plotData.error) {
        return (
            <div style={{ 
                backgroundColor: theme.palette.warning.light,
                padding: theme.spacing(2),
                borderRadius: theme.shape.borderRadius,
                margin: theme.spacing(1, 0)
            }}>
                <Typography variant="subtitle2" fontWeight="bold" color={theme.palette.warning.dark}>
                    Plot Error: {plotData.error}
                </Typography>
                {plotData.suggestion && (
                    <Typography variant="body2" style={{ marginTop: theme.spacing(1) }}>
                        Suggestion: {plotData.suggestion}
                    </Typography>
                )}
                {plotData.availableColumns && (
                    <div style={{ marginTop: theme.spacing(1) }}>
                        <Typography variant="body2" fontWeight="medium">
                            Available columns:
                        </Typography>
                        <ul style={{ margin: theme.spacing(0.5, 0, 0, 2) }}>
                            {plotData.availableColumns.map((col, idx) => (
                                <li key={idx}>
                                    <Typography variant="body2" component="span">
                                        {col}
                                    </Typography>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        );
    }

    // Show loading state while fetching CSV
    if (loading) {
        return (
            <div style={{
                backgroundColor: theme.palette.grey[50],
                padding: theme.spacing(2),
                borderRadius: theme.shape.borderRadius,
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '350px'
            }}>
                <CircularProgress size={40} />
                <Typography variant="body2" style={{ marginTop: theme.spacing(2) }}>
                    Loading data from {plotData.filePath}...
                </Typography>
            </div>
        );
    }

    // Render the complete chart
    return (
        <div style={{
            backgroundColor: theme.palette.grey[50],
            padding: theme.spacing(2),
            borderRadius: theme.shape.borderRadius,
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            width: '100%'
        }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing(1),
                marginBottom: theme.spacing(1),
                color: theme.palette.primary.main
            }}>
                <DescriptionIcon />
                <Typography variant="subtitle1" fontWeight="medium">
                    {plotData.title || 'Data Plot'}
                </Typography>
            </div>
            
            <div style={{
                border: `1px solid ${theme.palette.grey[300]}`,
                borderRadius: theme.shape.borderRadius,
                padding: theme.spacing(2),
                backgroundColor: theme.palette.common.white,
                height: '350px',
                width: '100%'
            }}>
                {renderChart()}
            </div>

            <div style={{ 
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: theme.spacing(1)
            }}>
                <Typography variant="caption" color="textSecondary">
                    Source: {plotData.filePath}
                </Typography>
                
                <Typography variant="caption" color="textSecondary">
                    {chartData.datasets.length > 1 
                        ? `${chartData.datasets.length} series, ${chartData.labels.length} data points`
                        : `${chartData.labels.length} data points`}
                </Typography>
            </div>
        </div>
    );
}; 