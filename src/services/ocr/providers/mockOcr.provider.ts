import type { OcrExtractResult, OcrProvider } from '../ocr.types';

/** Test-only provider — never used in production. */
export class MockOcrProvider implements OcrProvider {
  readonly name = 'mock';

  constructor(private readonly text: string) {}

  async extractText(): Promise<OcrExtractResult> {
    return { text: this.text, provider: this.name, confidence: 0.95 };
  }
}
