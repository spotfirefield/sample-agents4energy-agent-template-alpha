"use client"
import React, { useState, useEffect } from 'react';

import { getUrl } from 'aws-amplify/storage';

type PageParams = {
  s3Key: string[];
};

type FileType = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'xml' | 'other';

export default function Page({ params }: { params: PageParams | Promise<PageParams> }) {
  // Unwrap params with React.use() if it's a Promise
  const unwrappedParams: PageParams = params instanceof Promise ? React.use(params) : params;
  
  const [selectedFileUrl, setSelectedFileUrl] = useState<URL>();
  const [fileType, setFileType] = useState<FileType>('other');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [formattedXml, setFormattedXml] = useState<string | null>(null);

  const determineFileType = (filePath: string): FileType => {
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    // Set the file name for display purposes
    const pathParts = filePath.split('/');
    setFileName(pathParts[pathParts.length - 1]);
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
      return 'image';
    } else if (extension === 'pdf') {
      return 'pdf';
    } else if (['mp4', 'webm', 'mov', 'avi'].includes(extension)) {
      return 'video';
    } else if (['mp3', 'wav', 'ogg', 'aac'].includes(extension)) {
      return 'audio';
    } else if (['xml', 'svg'].includes(extension)) {
      return 'xml';
    } else if (['txt', 'csv', 'json', 'md', 'html', 'css', 'js', 'ts'].includes(extension)) {
      return 'text';
    } else {
      return 'other';
    }
  };

  // Function to format XML with proper indentation
  const formatXml = (xml: string): string => {
    try {
      // Remove whitespace between tags
      let formatted = xml.replace(/>\s*</g, '><');
      
      // Add newlines and indentation
      let indent = '';
      let result = '';
      
      // Process each character
      for (let i = 0; i < formatted.length; i++) {
        const char = formatted.charAt(i);
        
        if (char === '<') {
          // Check if it's a closing tag or a self-closing tag
          if (formatted.charAt(i + 1) === '/') {
            // Closing tag, reduce indent
            indent = indent.substring(2);
            result += '\n' + indent;
          } else if (i + 1 < formatted.length && formatted.charAt(i + 1) !== '?' && formatted.substring(i, i + 4) !== '<!--') {
            // Opening tag, not a processing instruction or comment
            result += '\n' + indent;
            
            // Check if it's not a self-closing tag
            let j = i;
            let tagContent = '';
            while (j < formatted.length && formatted.charAt(j) !== '>') {
              tagContent += formatted.charAt(j);
              j++;
            }
            
            if (j < formatted.length) {
              tagContent += formatted.charAt(j);
            }
            
            if (!tagContent.endsWith('/>') && !tagContent.includes('<!')) {
              indent += '  ';
            }
          }
        } else if (char === '>' && i > 1 && formatted.charAt(i - 1) === '/') {
          // Self-closing tag, don't increase indent
        } else if (char === '>' && i > 1 && formatted.substring(i - 2, i + 1) === '-->') {
          // End of comment
          result += char;
          result += '\n' + indent;
          continue;
        }
        
        result += char;
      }
      
      return result.trim();
    } catch (e) {
      console.error('Error formatting XML:', e);
      return xml; // Return original if formatting fails
    }
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    
    const s3KeyDecoded = unwrappedParams.s3Key.map((item: string) => decodeURIComponent(item)).join('/');
    console.log('s3 Key: ', s3KeyDecoded);
    
    // Determine file type from path
    const detectedFileType = determineFileType(s3KeyDecoded);
    setFileType(detectedFileType);
    
    getUrl({
      path: s3KeyDecoded,
    }).then((response) => {
      setSelectedFileUrl(response.url);
      setLoading(false);
    }).catch((error) => {
      console.error('Error fetching file:', error);
      setError('Failed to load file. Please try again later.');
      setLoading(false);
    });
  }, [unwrappedParams.s3Key]);

  // Function to fetch and display text content directly instead of using iframe
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textFetchError, setTextFetchError] = useState<boolean>(false);

  useEffect(() => {
    if ((fileType === 'text' || fileType === 'xml') && selectedFileUrl) {
      fetch(selectedFileUrl.toString())
        .then(response => {
          if (!response.ok) {
            throw new Error('Failed to fetch text content');
          }
          return response.text();
        })
        .then(text => {
          setTextContent(text);
          
          // If it's XML, format it
          if (fileType === 'xml') {
            setFormattedXml(formatXml(text));
          }
        })
        .catch(error => {
          console.error('Error fetching text content:', error);
          setTextFetchError(true);
        });
    }
  }, [fileType, selectedFileUrl]);

  if (loading) {
    return <div className="flex justify-center items-center h-screen">Loading file...</div>;
  }

  if (error) {
    return <div className="flex justify-center items-center h-screen text-red-500">{error}</div>;
  }

  const renderFileContent = () => {
    if (!selectedFileUrl) return null;

    const url = selectedFileUrl.toString();

    switch (fileType) {
      case 'image':
        return (
          <div className="flex justify-center items-center h-screen bg-gray-100">
            <img 
              src={url} 
              alt="Image File" 
              className="max-h-screen max-w-full object-contain" 
            />
          </div>
        );
      
      case 'pdf':
        return (
          <iframe
            src={url}
            style={{
              position: 'fixed',
              width: '100%',
              height: '100%',
              border: 'none',
              margin: 0,
              padding: 0,
            }}
            title="PDF Viewer"
          />
        );
      
      case 'video':
        return (
          <div className="flex justify-center items-center h-screen bg-black">
            <video 
              src={url} 
              controls 
              autoPlay 
              className="max-h-screen max-w-full"
            >
              Your browser does not support the video tag.
            </video>
          </div>
        );
      
      case 'audio':
        return (
          <div className="flex flex-col justify-center items-center h-screen bg-gray-100 p-4">
            <h2 className="text-xl mb-4">Audio File</h2>
            <audio src={url} controls autoPlay>
              Your browser does not support the audio tag.
            </audio>
          </div>
        );
      
      case 'xml':
        // For XML files, display them like a browser would natively
        if (textFetchError) {
          return (
            <iframe
              src={url}
              style={{
                position: 'fixed',
                width: '100%',
                height: '100%',
                border: 'none',
                margin: 0,
                padding: 0,
                backgroundColor: 'white',
              }}
              title="XML File Viewer"
            />
          );
        }
        
        if (formattedXml !== null) {
          return (
            <div className="flex flex-col h-screen bg-white">
              <div className="bg-gray-800 text-white p-2 flex justify-between items-center">
                <span className="font-mono">{fileName}</span>
                <a 
                  href={url} 
                  download 
                  className="px-2 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition"
                >
                  Download
                </a>
              </div>
              <div className="p-6 overflow-auto" style={{ maxHeight: 'calc(100vh - 40px)' }}>
                <div 
                  className="font-mono text-sm"
                  style={{
                    overflow: 'auto',
                    lineHeight: '1.5'
                  }}
                >
                  <pre className="whitespace-pre bg-gray-50 p-4 rounded border border-gray-200">{formattedXml}</pre>
                </div>
              </div>
            </div>
          );
        }
        
        return <div className="flex justify-center items-center h-screen">Loading XML content...</div>;
      
      case 'text':
        // For regular text files, display the content directly
        if (textFetchError) {
          return (
            <iframe
              src={url}
              style={{
                position: 'fixed',
                width: '100%',
                height: '100%',
                border: 'none',
                margin: 0,
                padding: 0,
                backgroundColor: 'white',
              }}
              title="Text File Viewer"
            />
          );
        }
        
        if (textContent !== null) {
          return (
            <div className="flex flex-col h-screen bg-gray-100">
              <div className="bg-gray-800 text-white p-2 flex justify-between items-center">
                <span className="font-mono">{fileName}</span>
                <a 
                  href={url} 
                  download 
                  className="px-2 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition"
                >
                  Download
                </a>
              </div>
              <div 
                className="flex-grow overflow-auto p-4 bg-white font-mono text-sm whitespace-pre-wrap"
                style={{
                  overflow: 'auto',
                  maxHeight: 'calc(100vh - 40px)'
                }}
              >
                {textContent}
              </div>
            </div>
          );
        }
        
        return <div className="flex justify-center items-center h-screen">Loading text content...</div>;
      
      default:
        // For other/unknown file types, offer a download link
        return (
          <div className="flex flex-col justify-center items-center h-screen bg-gray-100 p-4">
            <h2 className="text-xl mb-4">File Preview Not Available</h2>
            <p className="mb-4">This file type cannot be previewed in the browser.</p>
            <a 
              href={url} 
              download 
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
            >
              Download File
            </a>
          </div>
        );
    }
  };

  return <>{renderFileContent()}</>;
}