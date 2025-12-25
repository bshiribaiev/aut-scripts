# Law Firm Attachment Extractor

A Next.js web application that extracts attachments from EB-1 and EB-2 affidavit documents.

## Features

- Upload .docx files
- Support for both EB-1 and EB-2 formats
- Beautiful, modern UI
- Copy results as plain text or Markdown
- Fast extraction
- Easy deployment to Vercel

## Getting Started

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment to Vercel

1. Push your code to a Git repository (GitHub, GitLab, or Bitbucket)
2. Go to [Vercel](https://vercel.com)
3. Import your repository
4. Vercel will automatically detect Next.js and deploy

Alternatively, use the Vercel CLI:

```bash
npm install -g vercel
vercel
```

## Usage

1. Select the extractor type (EB-1 or EB-2)
2. Upload your .docx affidavit file
3. Click "Extract Attachments"
4. View the results grouped by section
5. Copy results as plain text or Markdown format

## Technology Stack

- Next.js 14
- TypeScript
- TailwindCSS
- Mammoth.js (for .docx parsing)

## Original Python Scripts

This web app is based on the following Python scripts:
- `eb1_cover.py`
- `eb2_cover.py`
