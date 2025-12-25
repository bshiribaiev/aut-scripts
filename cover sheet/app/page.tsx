// app/page.tsx
'use client';

import { useState } from 'react';
import { GroupedAttachments } from '@/lib/eb1-extractor';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [extractorType, setExtractorType] = useState<'eb1' | 'eb2'>('eb1');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    attachments: GroupedAttachments;
    filename: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setResult(null);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      const droppedFile = files[0];
      if (droppedFile.name.endsWith('.docx')) {
        setFile(droppedFile);
        setError(null);
        setResult(null);
      } else {
        setError('Please upload a .docx file');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', extractorType);

      const response = await fetch('/api/extract', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract attachments');
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!result) return;

    let text = '';
    
    for (const [section, items] of Object.entries(result.attachments)) {
      // Only add section header if it's not empty
      if (section) {
        text += `${section}\n`;
      }
      for (const item of items) {
        text += `(${item.num}) ${item.desc}\n`;
      }
      text += '\n';
    }

    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2 text-center">
            Cover Sheet Attachment Extractor
          </h1>
          <p className="text-gray-600 mb-8 text-center">
            Upload your affidavit document to extract attachments
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Case Type
              </label>
              <div className="flex gap-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="eb1"
                    checked={extractorType === 'eb1'}
                    onChange={(e) => setExtractorType(e.target.value as 'eb1' | 'eb2')}
                    className="mr-2"
                  />
                  <span className="text-gray-700">EB-1</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="eb2"
                    checked={extractorType === 'eb2'}
                    onChange={(e) => setExtractorType(e.target.value as 'eb1' | 'eb2')}
                    className="mr-2"
                  />
                  <span className="text-gray-700">EB-2</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Upload Document (.docx)
              </label>
              <div
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-300 bg-gray-50 hover:border-gray-400'
                }`}
              >
                <input
                  type="file"
                  accept=".docx"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  id="file-upload"
                />
                <div className="space-y-2">
                  <svg
                    className={`mx-auto h-12 w-12 ${isDragging ? 'text-indigo-500' : 'text-gray-400'}`}
                    stroke="currentColor"
                    fill="none"
                    viewBox="0 0 48 48"
                    aria-hidden="true"
                  >
                    <path
                      d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div className="text-gray-600">
                    <label htmlFor="file-upload" className="relative cursor-pointer font-semibold text-indigo-600 hover:text-indigo-500">
                      <span>Click to upload</span>
                    </label>
                    <span className="text-gray-500"> or drag and drop</span>
                  </div>
                  <p className="text-xs text-gray-500">DOCX files only</p>
                  {file && (
                    <p className="text-sm font-medium text-indigo-600 mt-2">
                      Selected: {file.name}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={!file || loading}
              className="w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Extracting...' : 'Extract Attachments'}
            </button>
          </form>

          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {result && (
            <div className="mt-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-900">
                  Results for: {result.filename}
                </h2>
                <button
                  onClick={copyToClipboard}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                >
                  Copy
                </button>
              </div>

              <div className="bg-gray-50 rounded-lg p-6 max-h-[600px] overflow-y-auto">
                {Object.entries(result.attachments).map(([section, items]) => (
                  <div key={section || 'unspecified'} className="mb-6">
                    {section && (
                      <h3 className="text-lg font-bold text-gray-900 mb-3 uppercase">
                        {section}
                      </h3>
                    )}
                    <ul className="space-y-2">
                      {items.map((item) => (
                        <li key={item.num} className="text-gray-700">
                          <span className="font-semibold">({item.num})</span> {item.desc}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="mt-8 text-center text-gray-600 text-sm">
          <p>Supports EB-1 and EB-2 affidavit formats</p>
        </footer>
      </div>
    </div>
  );
}

