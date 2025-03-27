import React from 'react';
import { Theme } from '@mui/material/styles';
import { Typography, CircularProgress } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Line, Bar, Scatter } from 'react-chartjs-2';
import { getUrl } from 'aws-amplify/storage';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

// Import Message type for content prop
import { Message } from '@/../utils/types';

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
        yAxis?: { label?: string; data?: string[] };
        dataPoints?: Array<{ x: string; y: string }>;
        error?: string;
        suggestion?: string;
        availableColumns?: string[];
    } | null>(null);
    const [error, setError] = React.useState<boolean>(false);
    const [errorMessage, setErrorMessage] = React.useState<string>('');
    const [csvData, setCsvData] = React.useState<Array<{ [key: string]: string }> | null>(null);
    const [loading, setLoading] = React.useState(false);
    
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

    // Fetch the CSV file when plotData changes
    React.useEffect(() => {
        if (plotData?.filePath) {
            fetchCsvData(plotData.filePath);
        }
    }, [plotData]);

    // Function to fetch and parse CSV data
    const fetchCsvData = async (filePath: string) => {
        setLoading(true);
        try {
            const fullPath = `chatSessionArtifacts/sessionId=${chatSessionId}/${filePath}`;
            console.log('Fetching CSV from path:', fullPath);
            
            const { url } = await getUrl({
                path: fullPath,
            });
            
            const response = await fetch(url.toString());
            
            if (!response.ok) {
                throw new Error(`Failed to fetch CSV file: ${response.statusText} (${response.status})`);
            }
            
            const text = await response.text();
            console.log('CSV text fetched:', text.substring(0, 100) + '...');
            
            if (!text || text.trim() === '') {
                throw new Error('CSV file is empty');
            }
            
            const parsedData = parseCsvData(text, plotData?.xAxis?.label, plotData?.yAxis?.label);
            setCsvData(parsedData);
            console.log('Processed CSV data:', parsedData);
        } catch (error: any) {
            console.error('Error fetching CSV data:', error);
            setError(true);
            setErrorMessage(`Error fetching/parsing CSV: ${error.message || 'Unknown error'}`);
        } finally {
            setLoading(false);
        }
    };

    // Function to parse CSV data
    const parseCsvData = (csvText: string, xColumn?: string, yColumn?: string): Array<{ [key: string]: string }> => {
        // Split the CSV into lines
        const lines = csvText.trim().split('\n');
        if (lines.length <= 1) {
            throw new Error('CSV file is empty or contains only headers');
        }

        // Parse headers (first line)
        const headers = lines[0].split(',').map(header => header.trim());
        
        // Find the column indices to use
        const xColumnIndex = xColumn ? headers.indexOf(xColumn) : 0;
        const yColumnIndex = yColumn ? headers.indexOf(yColumn) : 1;
        
        // If specified columns don't exist, use the first two columns
        const useXIndex = xColumnIndex >= 0 ? xColumnIndex : 0;
        const useYIndex = yColumnIndex >= 0 ? yColumnIndex : 1;
        
        // Parse data rows
        return lines.slice(1).map((line, index) => {
            const values = line.split(',').map(val => val.trim());
            const row: { [key: string]: string } = {};
            
            // Add all columns to the data object
            headers.forEach((header, i) => {
                row[header] = values[i] || '';
            });
            
            // Also add x and y properties for easier access
            row.x = values[useXIndex] || `Row ${index + 1}`;
            row.y = values[useYIndex] || '0';
            
            return row;
        });
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

    // Prepare chart data from CSV
    const chartData = {
        labels: csvData?.map(row => row.x) || [],
        datasets: [
            {
                label: plotData.yAxis?.label || 'Value',
                data: csvData?.map(row => Number(row.y) || 0) || [],
                backgroundColor: theme.palette.primary.main + '66', // Add transparency
                borderColor: theme.palette.primary.main,
                borderWidth: 2,
                pointBackgroundColor: theme.palette.primary.main,
                tension: 0.1 // Slight curve for line charts
            }
        ]
    };

    console.log('Chart data prepared:', chartData);

    // Chart options
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top' as const,
            },
            title: {
                display: true,
                text: plotData.title || 'Data Plot',
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
                cornerRadius: 4
            }
        },
        scales: {
            x: {
                title: {
                    display: true,
                    text: plotData.xAxis?.label || 'X',
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
                title: {
                    display: true,
                    text: plotData.yAxis?.label || 'Y',
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

    // Render the appropriate chart based on plotType
    const renderChart = () => {
        // Ensure we have data to display
        const hasData = (chartData.labels.length > 0 && chartData.datasets[0].data.length > 0);
        
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
                            csvData: csvData?.length || 0,
                            filePath: plotData.filePath
                        })}
                    </Typography>
                </div>
            );
        }
        
        switch (plotData.plotType) {
            case 'bar':
                return <Bar data={chartData} options={chartOptions} />;
            case 'scatter':
                return <Scatter data={chartData} options={chartOptions} />;
            case 'line':
            default:
                return <Line data={chartData} options={chartOptions} />;
        }
    };

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

            <Typography variant="caption" color="textSecondary" style={{ display: 'block', marginTop: theme.spacing(1) }}>
                Source: {plotData.filePath} | {csvData?.length || 0} data points
            </Typography>
        </div>
    );
}; 