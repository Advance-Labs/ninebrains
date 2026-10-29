import { useEffect, useState } from 'react';

interface PdfRendererProps {
  file: { path: string; blob: Blob };
}

/**
 * Renders PDF files with Chromium's built-in viewer (zoom via Cmd+wheel, search;
 * toolbar and print are disabled, see #168). Requires `webPreferences.plugins`
 * on the host window.
 */
export function PdfRenderer({ file }: PdfRendererProps) {
  const fileName = file.path.split('/').pop() ?? file.path;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file.blob);
    // `#toolbar=0` hides the viewer toolbar, whose Print button crashes macOS 27 (#168).
    setUrl(`${objectUrl}#toolbar=0`);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file.blob]);

  if (!url) return null;
  return <iframe src={url} title={fileName} className="h-full w-full border-0" />;
}
