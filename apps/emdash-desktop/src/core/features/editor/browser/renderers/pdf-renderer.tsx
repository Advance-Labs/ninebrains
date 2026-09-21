import { useEffect, useState } from 'react';

interface PdfRendererProps {
  file: { path: string; blob: Blob };
}

/**
 * Renders PDF files with Chromium's built-in viewer (zoom, search, thumbnails,
 * print). Requires `webPreferences.plugins` on the host window.
 */
export function PdfRenderer({ file }: PdfRendererProps) {
  const fileName = file.path.split('/').pop() ?? file.path;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file.blob]);

  if (!url) return null;
  return <iframe src={url} title={fileName} className="h-full w-full border-0" />;
}
