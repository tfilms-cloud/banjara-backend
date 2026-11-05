import { AppError } from '../../../utils/AppError';
import type { OcrExtractResult, OcrProvider } from '../ocr.types';

/**
 * Generic HTTP OCR provider (e.g. OCR.space).
 * Secrets stay on the server — never in the Expo app.
 */
export class HttpOcrProvider implements OcrProvider {
  readonly name = 'http';

  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string
  ) {}

  async extractText(image: Buffer, mimeType = 'image/jpeg'): Promise<OcrExtractResult> {
    if (!this.apiKey) {
      throw new AppError('OCR provider is not configured', 503);
    }

    const form = new FormData();
    form.append('apikey', this.apiKey);
    form.append('language', 'eng');
    form.append('isOverlayRequired', 'false');
    form.append('OCREngine', '2');
    const blob = new Blob([new Uint8Array(image)], { type: mimeType });
    form.append('file', blob, 'cnic.jpg');

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      throw new AppError('Could not process CNIC image right now. Please try again.', 502);
    }

    const json = (await response.json()) as {
      ParsedResults?: Array<{ ParsedText?: string; FileParseExitCode?: number }>;
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string | string[];
    };

    if (json.IsErroredOnProcessing) {
      throw new AppError('Please upload a clearer image of your CNIC.', 400);
    }

    const text = json.ParsedResults?.map((r) => r.ParsedText ?? '').join('\n') ?? '';
    if (!text.trim()) {
      throw new AppError('Please upload a clearer image of your CNIC.', 400);
    }

    return { text, provider: this.name, confidence: null };
  }
}
