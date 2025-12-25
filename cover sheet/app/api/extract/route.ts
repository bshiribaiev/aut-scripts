// app/api/extract/route.ts
import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { extractEB1 } from '@/lib/eb1-extractor';
import { extractEB2 } from '@/lib/eb2-extractor';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const extractorType = formData.get('type') as string;
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }
    
    if (!file.name.endsWith('.docx')) {
      return NextResponse.json(
        { error: 'Only .docx files are supported' },
        { status: 400 }
      );
    }
    
    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Extract text from docx
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value;
    
    // Extract attachments based on type
    let attachments;
    if (extractorType === 'eb2') {
      attachments = extractEB2(text);
    } else {
      attachments = extractEB1(text);
    }
    
    return NextResponse.json({
      success: true,
      attachments,
      filename: file.name
    });
    
  } catch (error) {
    console.error('Extraction error:', error);
    return NextResponse.json(
      { error: 'Failed to extract attachments' },
      { status: 500 }
    );
  }
}

